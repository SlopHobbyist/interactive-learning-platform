"""Accounts (Kratos): single mode ignores them; multi mode maps Kratos sessions to users,
migrates the local user's progress to the first account, isolates users, proxies the
self-service API, checks Turnstile in the registration webhook, and ranks the weekly league.

Kratos is faked with an httpx MockTransport; the real thing is exercised by
``server/tests/e2e/test_accounts_stack.py`` against ``docker compose up``."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from server.app import accounts
from server.app.config import REPO_ROOT, Settings
from server.app.main import create_app

WAVES = "example/demo/basics/waves"
COOKIE = accounts.SESSION_COOKIE


class FakeKratos:
    """Sessions by cookie value, plus a log of every request the app made to Kratos."""

    def __init__(self):
        self.sessions: dict[str, dict] = {}
        self.calls: list[httpx.Request] = []
        self.down = False

    def sign_in(self, token: str, identity_id: str, username: str, email: str = "") -> None:
        self.sessions[token] = {
            "id": identity_id,
            "traits": {"username": username, "email": email or f"{username}@example.com"},
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        if request.url.path == "/sessions/whoami":
            cookie = request.headers.get("cookie", "")
            token = cookie.split(f"{COOKIE}=", 1)[1] if f"{COOKIE}=" in cookie else ""
            identity = self.sessions.get(token)
            if identity is None:
                return httpx.Response(401, json={"error": {"id": "session_inactive"}})
            return httpx.Response(200, json={"active": True, "identity": identity})
        if request.url.path == "/self-service/login/browser":
            return httpx.Response(
                200,
                json={"id": "flow-1", "ui": {"nodes": []}},
                headers=[
                    ("set-cookie", "csrf_token_abc=1; Path=/; HttpOnly"),
                    ("set-cookie", "other=2; Path=/"),
                ],
            )
        if request.url.path == "/self-service/logout":
            return httpx.Response(204)
        return httpx.Response(
            200,
            json={
                "echo": request.url.path,
                "query": request.url.query.decode(),
                "body": request.content.decode(),
            },
        )


def _app(tmp_path: Path, mode: str, fake: FakeKratos | None = None, **extra) -> TestClient:
    s = Settings(
        content_dir=REPO_ROOT / "content",
        elements_dir=REPO_ROOT / "elements",
        web_dir=REPO_ROOT / "web",
        data_dir=tmp_path,
        dev=True,
        mode=mode,
        kratos_url="http://kratos.test",
        **extra,
    )
    app = create_app(s)
    if fake is not None:
        app.state.kratos = accounts.Kratos(
            "http://kratos.test", transport=httpx.MockTransport(fake.handler)
        )
        app.state.kratos_proxy = accounts.proxy_client(
            "http://kratos.test", transport=httpx.MockTransport(fake.handler)
        )
    return TestClient(app)


def test_single_mode_ignores_accounts(tmp_path: Path):
    with _app(tmp_path, "single") as c:
        mode = c.get("/api/auth/mode").json()
        assert mode["mode"] == "single" and mode["authenticated"] is True
        assert mode["user"]["username"] == "local"
        assert mode["turnstile"]["mode"] == "placeholder"
        assert c.get("/kratos/self-service/login/browser").status_code == 404
        assert c.post("/api/auth/hooks/registration", json={}).status_code == 404
        assert c.get("/api/me").status_code == 200


def test_multi_mode_links_kratos_identities(tmp_path: Path):
    # Earn progress as `local` in single mode first.
    with _app(tmp_path, "single") as c:
        c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 10}).raise_for_status()

    fake = FakeKratos()
    fake.sign_in("tok-ada", "11111111-aaaa", "ada", "ada@example.com")
    fake.sign_in("tok-bob", "22222222-bbbb", "bob")
    with _app(tmp_path, "multi", fake) as c:
        mode = c.get("/api/auth/mode").json()
        assert mode["authenticated"] is False and mode["user"] is None
        assert c.get("/api/me").status_code == 401
        assert c.get("/api/progress/example/demo").status_code == 401

        # The first account inherits everything `local` earned.
        c.cookies.set(COOKIE, "tok-ada")
        mode = c.get("/api/auth/mode").json()
        assert mode["authenticated"] is True
        assert mode["user"]["username"] == "ada" and mode["user"]["email"] == "ada@example.com"
        assert c.get("/api/me").json()["xp_total"] == 10

        # A second account starts empty and is isolated.
        c.cookies.set(COOKIE, "tok-bob")
        assert c.get("/api/me").json()["xp_total"] == 0
        c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 5}).raise_for_status()
        assert c.get("/api/me").json()["xp_total"] == 5
        c.cookies.set(COOKIE, "tok-ada")
        assert c.get("/api/me").json()["xp_total"] == 10

        # An unknown or expired session is signed out.
        c.cookies.set(COOKIE, "tok-nobody")
        assert c.get("/api/me").status_code == 401

    # Links persist across restarts, and a username changed in Kratos follows.
    fake.sessions["tok-ada"]["traits"]["username"] = "ada2"
    with _app(tmp_path, "multi", fake) as c:
        c.cookies.set(COOKIE, "tok-ada")
        me = c.get("/api/me").json()
        assert me["username"] == "ada2" and me["xp_total"] == 10


def test_whoami_is_cached_and_logout_forgets_it(tmp_path: Path):
    fake = FakeKratos()
    fake.sign_in("tok", "33333333-cccc", "cy")
    with _app(tmp_path, "multi", fake) as c:
        c.cookies.set(COOKIE, "tok")
        for _ in range(3):
            assert c.get("/api/me").status_code == 200
        whoamis = [r for r in fake.calls if r.url.path == "/sessions/whoami"]
        assert len(whoamis) == 1
        assert c.get("/kratos/self-service/logout?token=x").status_code == 204
        del fake.sessions["tok"]
        assert c.get("/api/me").status_code == 401


def test_kratos_down_is_a_503(tmp_path: Path):
    fake = FakeKratos()
    fake.down = True
    with _app(tmp_path, "multi", fake) as c:
        c.cookies.set(COOKIE, "tok")
        assert c.get("/api/me").status_code == 503
        assert c.get("/kratos/self-service/login/browser").status_code == 503


def test_proxy_forwards_requests_and_cookies(tmp_path: Path):
    fake = FakeKratos()
    with _app(tmp_path, "multi", fake) as c:
        r = c.get("/kratos/self-service/login/browser", headers={"Accept": "application/json"})
        assert r.status_code == 200 and r.json()["id"] == "flow-1"
        # Both cookies arrive, as separate Set-Cookie headers.
        assert sorted(r.headers.get_list("set-cookie")) == [
            "csrf_token_abc=1; Path=/; HttpOnly",
            "other=2; Path=/",
        ]
        r = c.post(
            "/kratos/self-service/registration?flow=abc",
            json={"method": "password", "traits": {"username": "dee"}},
        )
        echoed = r.json()
        assert echoed["echo"] == "/self-service/registration" and echoed["query"] == "flow=abc"
        assert json.loads(echoed["body"])["traits"] == {"username": "dee"}
        sent = fake.calls[-1]
        assert sent.headers["x-forwarded-proto"] == "http" and "x-forwarded-for" in sent.headers
        # The proxy is shared by every browser: a cookie Kratos set for one must never ride
        # along on another's request.
        c.cookies.clear()
        c.get("/kratos/self-service/registration/browser")
        assert "cookie" not in fake.calls[-1].headers
        # Only the self-service API and whoami are reachable through the proxy.
        assert c.get("/kratos/admin/identities").status_code == 404
        assert c.get("/kratos/health/ready").status_code == 404


def test_registration_hook_checks_turnstile(tmp_path: Path):
    with _app(tmp_path, "multi", FakeKratos()) as c:
        ok = c.post(
            "/api/auth/hooks/registration",
            json={"username": "ada", "turnstile": accounts.PLACEHOLDER_TOKEN, "remote_ip": ""},
        )
        assert ok.status_code == 204
        for token in ("", "forged"):
            bad = c.post(
                "/api/auth/hooks/registration", json={"username": "ada", "turnstile": token}
            )
            assert bad.status_code == 400
            message = bad.json()["messages"][0]
            assert message["instance_ptr"] == "#/"
            assert message["messages"][0]["type"] == "error"
        assert c.get("/api/auth/mode").json()["turnstile"] == {
            "mode": "placeholder",
            "site_key": None,
            "placeholder_token": accounts.PLACEHOLDER_TOKEN,
        }


@pytest.mark.parametrize("success", [True, False])
def test_turnstile_siteverify_with_a_secret(success: bool):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"success": success})

    transport = httpx.MockTransport(handler)
    assert accounts.verify_turnstile("tok", "s3cret", "1.2.3.4", transport=transport) is success
    form = dict(httpx.QueryParams(seen[0].content.decode()))
    assert str(seen[0].url) == accounts.SITEVERIFY_URL
    assert form == {"secret": "s3cret", "response": "tok", "remoteip": "1.2.3.4"}
    # With a secret, the placeholder token is just another token Cloudflare must accept.
    assert accounts.verify_turnstile("", "s3cret", transport=transport) is False


def test_weekly_league_is_opt_in(tmp_path: Path):
    fake = FakeKratos()
    fake.sign_in("tok-ada", "11111111-aaaa", "ada")
    fake.sign_in("tok-bob", "22222222-bbbb", "bob")
    with _app(tmp_path, "multi", fake) as c:
        c.cookies.set(COOKIE, "tok-ada")
        c.put("/api/settings", json={"drops": False})
        c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 30})
        table = c.get("/api/league").json()
        assert table["entries"] == [] and table["opted_in"] is False
        c.put("/api/settings", json={"league": True})
        table = c.get("/api/league").json()
        assert table["opted_in"] is True
        assert table["entries"] == [{"username": "ada", "xp": 30, "rank": 1, "me": True}]
        c.cookies.set(COOKIE, "tok-bob")
        c.put("/api/settings", json={"league": True, "drops": False})
        c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 40})
        entries = c.get("/api/league").json()["entries"]
        assert [(e["username"], e["rank"], e["me"]) for e in entries] == [
            ("bob", 1, True),
            ("ada", 2, False),
        ]
        # Next week the table is empty again.
        assert c.get("/api/league?now=%2B8d").json()["entries"] == [
            {"username": "ada", "xp": 0, "rank": 1, "me": False},
            {"username": "bob", "xp": 0, "rank": 2, "me": True},
        ]
