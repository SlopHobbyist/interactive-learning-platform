"""Accounts (Kratos): single mode ignores them; multi mode maps Kratos sessions to users,
migrates the local user's progress to the first account, isolates users, proxies the
self-service API, reports email verification and the help address, checks Turnstile on sign-up
and sign-in in the proxy, and ranks the weekly league.

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
        assert c.post("/kratos/self-service/registration?flow=abc", json={}).status_code == 404
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


def test_email_verification_shows_and_refreshes_the_cache(tmp_path: Path):
    fake = FakeKratos()
    fake.sign_in("tok", "44444444-dddd", "di", "Di@example.com")
    address = {"value": "di@example.com", "via": "email", "verified": False}
    fake.sessions["tok"]["verifiable_addresses"] = [address]
    with _app(tmp_path, "multi", fake) as c:
        c.cookies.set(COOKIE, "tok")
        assert c.get("/api/auth/mode").json()["user"]["email_verified"] is False
        address["verified"] = True
        # Cached for now; a verification request through the proxy drops the cached answer.
        assert c.get("/api/auth/mode").json()["user"]["email_verified"] is False
        c.post("/kratos/self-service/verification?flow=f", json={"method": "code", "code": "1"})
        assert c.get("/api/auth/mode").json()["user"]["email_verified"] is True
        # A verified address that is no longer the email trait does not count.
        address["value"] = "old@example.com"
        c.get("/kratos/self-service/verification?flow=f&code=1")
        assert c.get("/api/auth/mode").json()["user"]["email_verified"] is False


def test_help_email_is_shown_only_when_set(tmp_path: Path):
    with _app(tmp_path, "single") as c:
        assert c.get("/api/auth/mode").json()["help_email"] is None
    with _app(tmp_path, "multi", FakeKratos(), help_email="help@example.com") as c:
        assert c.get("/api/auth/mode").json()["help_email"] == "help@example.com"


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
            json={
                "method": "password",
                "traits": {"username": "dee"},
                "transient_payload": {"turnstile": accounts.PLACEHOLDER_TOKEN},
            },
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


def _sign_up(c: TestClient, token, **kwargs) -> httpx.Response:
    """A registration submission through the proxy carrying ``token`` (None: no payload)."""
    body = {"method": "password", "traits": {"username": "ada"}}
    if token is not None:
        body["transient_payload"] = {"turnstile": token}
    return c.post("/kratos/self-service/registration?flow=abc", json=body, **kwargs)


def test_sign_up_needs_the_placeholder_token_while_turnstile_is_off(tmp_path: Path):
    fake = FakeKratos()
    with _app(tmp_path, "multi", fake) as c:
        before = len(fake.calls)
        for token in (None, "", "forged"):
            bad = _sign_up(c, token)
            assert bad.status_code == 400, token
            assert bad.json()["error"]["id"] == "turnstile_failed", token
            assert bad.json()["error"]["reason"] == accounts.TURNSTILE_MESSAGE, token
        # A form-encoded body cannot get around the check either.
        form = c.post(
            "/kratos/self-service/registration?flow=abc",
            data={"transient_payload[turnstile]": accounts.PLACEHOLDER_TOKEN},
        )
        assert form.status_code == 400
        # Kratos never saw a refused registration.
        assert len(fake.calls) == before
        ok = _sign_up(c, accounts.PLACEHOLDER_TOKEN)
        assert ok.status_code == 200 and ok.json()["echo"] == "/self-service/registration"
        # Starting a flow is not gated.
        assert c.get("/kratos/self-service/registration/browser").status_code == 200
        assert c.get("/api/auth/mode").json()["turnstile"] == {
            "mode": "placeholder",
            "site_key": None,
            "placeholder_token": accounts.PLACEHOLDER_TOKEN,
        }


KEYS = {"turnstile_site_key": "site-key", "turnstile_secret": "s3cret"}


def _fake_siteverify(monkeypatch, good: str = "good") -> list[tuple[str, str, str]]:
    """Cloudflare says yes to one token. Records (token, secret, remote_ip) per check."""
    seen: list[tuple[str, str, str]] = []

    def verify(token: str, secret: str, remote_ip: str = "", transport=None) -> bool:
        seen.append((token, secret, remote_ip))
        return token == good

    monkeypatch.setattr("server.app.api.kratos.verify_turnstile", verify)
    monkeypatch.setattr(accounts, "verify_turnstile", verify)
    return seen


def test_turnstile_is_off_unless_both_keys_are_set(tmp_path: Path):
    for extra in ({}, {"turnstile_site_key": "site-key"}, {"turnstile_secret": "s3cret"}):
        with _app(tmp_path, "multi", FakeKratos(), **extra) as c:
            mode = c.get("/api/auth/mode").json()["turnstile"]
            assert mode == {
                "mode": "placeholder",
                "site_key": None,
                "placeholder_token": accounts.PLACEHOLDER_TOKEN,
            }
    with _app(tmp_path, "multi", FakeKratos(), **KEYS) as c:
        assert c.get("/api/auth/mode").json()["turnstile"] == {
            "mode": "cloudflare",
            "site_key": "site-key",
            "placeholder_token": None,
        }


def test_sign_up_asks_cloudflare_when_enabled(tmp_path: Path, monkeypatch):
    seen = _fake_siteverify(monkeypatch)
    with _app(tmp_path, "multi", FakeKratos(), **KEYS) as c:
        ok = _sign_up(c, "good", headers={"x-forwarded-for": "9.9.9.9, 10.0.0.1"})
        assert ok.status_code == 200 and seen == [("good", "s3cret", "9.9.9.9")]
        # The placeholder token is no longer enough.
        bad = _sign_up(c, accounts.PLACEHOLDER_TOKEN)
        assert bad.status_code == 400 and bad.json()["error"]["id"] == "turnstile_failed"


def test_sign_in_needs_a_turnstile_token_when_enabled(tmp_path: Path, monkeypatch):
    seen = _fake_siteverify(monkeypatch)
    fake = FakeKratos()
    login = "/kratos/self-service/login?flow=abc"
    with _app(tmp_path, "multi", fake, **KEYS) as c:
        # Starting a flow is not gated.
        assert c.get("/kratos/self-service/login/browser").status_code == 200

        attempts = {
            "no payload": {"json": {"method": "password", "identifier": "ada"}},
            "empty token": {"json": {"transient_payload": {"turnstile": ""}}},
            "wrong token": {"json": {"transient_payload": {"turnstile": "forged"}}},
            "not a string": {"json": {"transient_payload": {"turnstile": ["good"]}}},
            "not an object": {"json": ["good"]},
            "form encoded": {"data": {"transient_payload[turnstile]": "good", "identifier": "ada"}},
        }
        before = len(fake.calls)
        for name, kwargs in attempts.items():
            r = c.post(login, **kwargs)
            assert r.status_code == 400, name
            assert r.json()["error"]["id"] == "turnstile_failed", name
            assert r.json()["error"]["reason"] == accounts.TURNSTILE_MESSAGE, name
        # Kratos never saw a password it was not allowed to check.
        assert len(fake.calls) == before

        ok = c.post(
            login,
            json={
                "method": "password",
                "identifier": "ada",
                "transient_payload": {"turnstile": "good"},
            },
            headers={"x-forwarded-for": "9.9.9.9"},
        )
        assert ok.status_code == 200 and ok.json()["echo"] == "/self-service/login"
        assert seen[-1] == ("good", "s3cret", "9.9.9.9")
        # The body Kratos gets is the one the browser sent, token included.
        assert json.loads(ok.json()["body"])["identifier"] == "ada"


def test_sign_in_has_no_check_while_turnstile_is_off(tmp_path: Path):
    fake = FakeKratos()
    with _app(tmp_path, "multi", fake) as c:
        r = c.post("/kratos/self-service/login?flow=abc", json={"identifier": "ada"})
        assert r.status_code == 200 and r.json()["echo"] == "/self-service/login"


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
    # A private address (a Docker gateway, a proxy that hides the visitor) is not sent.
    for private in ("172.26.0.1", "10.0.0.1", "127.0.0.1", "::1", "not-an-ip"):
        accounts.verify_turnstile("tok", "s3cret", private, transport=transport)
        assert "remoteip" not in dict(httpx.QueryParams(seen[-1].content.decode())), private


def test_weekly_league_is_opt_out(tmp_path: Path):
    fake = FakeKratos()
    fake.sign_in("tok-ada", "11111111-aaaa", "ada")
    fake.sign_in("tok-bob", "22222222-bbbb", "bob")
    with _app(tmp_path, "multi", fake) as c:
        c.cookies.set(COOKIE, "tok-ada")
        c.put("/api/settings", json={"chests": False, "league": False})
        c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 30})
        table = c.get("/api/league").json()
        assert table["entries"] == [] and table["opted_in"] is False
        c.put("/api/settings", json={"league": True})
        table = c.get("/api/league").json()
        assert table["opted_in"] is True
        assert table["entries"] == [{"username": "ada", "xp": 30, "rank": 1, "me": True}]
        # Bob never touches the setting: listed by default.
        c.cookies.set(COOKIE, "tok-bob")
        c.put("/api/settings", json={"chests": False})
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
