"""Accounts (Phase 11): single mode ignores auth; multi mode registers, logs in, migrates the
local user's progress to the first account, isolates users, and ranks the weekly league."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from server.app import auth
from server.app.config import REPO_ROOT, Settings
from server.app.main import create_app

WAVES = "example/demo/basics/waves"


def _app(tmp_path: Path, mode: str) -> TestClient:
    s = Settings(
        content_dir=REPO_ROOT / "content",
        elements_dir=REPO_ROOT / "elements",
        web_dir=REPO_ROOT / "web",
        data_dir=tmp_path,
        dev=True,
        mode=mode,
    )
    return TestClient(create_app(s))


def test_password_and_session_primitives(tmp_path: Path):
    h = auth.hash_password("correct horse")
    assert auth.verify_password(h, "correct horse") and not auth.verify_password(h, "nope")
    assert not auth.verify_password(None, "x") and not auth.verify_password("garbage", "x")
    assert (
        auth.valid_username("ada_1")
        and not auth.valid_username("Ada")
        and not auth.valid_username("a")
    )
    assert auth.validate_password("short") and auth.validate_password("long enough") is None
    signer = auth.SessionSigner(tmp_path / "session.key")
    token = signer.issue(7, now=1000)
    assert signer.verify(token, now=2000) == 7
    assert signer.verify(token, now=1000 + auth.SESSION_DAYS * 86400 + 1) is None
    assert signer.verify(token[:-1] + ("0" if token[-1] != "0" else "1")) is None
    assert signer.verify("bad") is None and signer.verify(None) is None
    # The key persists, so sessions survive a restart.
    assert auth.SessionSigner(tmp_path / "session.key").verify(token, now=2000) == 7


def test_single_mode_ignores_accounts(tmp_path: Path):
    with _app(tmp_path, "single") as c:
        assert c.get("/api/auth/mode").json() == {
            "mode": "single",
            "authenticated": True,
            "user": {"id": 1, "username": "local"},
            "accounts": 0,
        }
        assert (
            c.post(
                "/api/auth/register", json={"username": "ada", "password": "password1"}
            ).status_code
            == 404
        )
        assert c.get("/api/me").status_code == 200


def test_multi_mode_register_login_and_migration(tmp_path: Path):
    # Earn progress as `local` in single mode first.
    with _app(tmp_path, "single") as c:
        c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 10}).raise_for_status()
        assert c.get("/api/me").json()["xp_total"] == 10

    with _app(tmp_path, "multi") as c:
        assert c.get("/api/auth/mode").json()["authenticated"] is False
        assert c.get("/api/me").status_code == 401
        assert c.get("/api/progress/example/demo").status_code == 401
        assert (
            c.post(
                "/api/auth/register", json={"username": "ad a", "password": "password1"}
            ).status_code
            == 422
        )
        assert (
            c.post("/api/auth/register", json={"username": "ada", "password": "short"}).status_code
            == 422
        )
        r = c.post("/api/auth/register", json={"username": "ada", "password": "password1"})
        assert r.status_code == 201 and r.json()["migrated_local_progress"] is True
        assert auth.COOKIE in c.cookies
        me = c.get("/api/me").json()
        assert me["username"] == "ada" and me["xp_total"] == 10  # inherited from `local`
        assert c.get("/api/auth/me").json()["user"]["username"] == "ada"
        assert (
            c.post(
                "/api/auth/register", json={"username": "ada", "password": "password2"}
            ).status_code
            == 409
        )

        # A second account starts empty and is isolated.
        c.post("/api/auth/logout")
        assert c.get("/api/me").status_code == 401
        r = c.post("/api/auth/register", json={"username": "bob", "password": "password1"})
        assert r.status_code == 201 and r.json()["migrated_local_progress"] is False
        assert c.get("/api/me").json()["xp_total"] == 0
        c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 5})
        assert c.get("/api/me").json()["xp_total"] == 5
        c.post("/api/auth/logout")

        assert (
            c.post("/api/auth/login", json={"username": "ada", "password": "wrong"}).status_code
            == 401
        )
        assert (
            c.post("/api/auth/login", json={"username": "ada", "password": "password1"}).status_code
            == 200
        )
        assert c.get("/api/me").json()["xp_total"] == 10

    # Sessions and data persist across restarts.
    with _app(tmp_path, "multi") as c:
        assert c.get("/api/auth/mode").json()["accounts"] == 2


def test_weekly_league_is_opt_in(tmp_path: Path):
    with _app(tmp_path, "multi") as c:
        c.post("/api/auth/register", json={"username": "ada", "password": "password1"})
        c.put("/api/settings", json={"drops": False})
        c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 30})
        table = c.get("/api/league").json()
        assert table["entries"] == [] and table["opted_in"] is False
        c.put("/api/settings", json={"league": True})
        table = c.get("/api/league").json()
        assert table["opted_in"] is True
        assert table["entries"] == [{"username": "ada", "xp": 30, "rank": 1, "me": True}]
        c.post("/api/auth/logout")
        c.post("/api/auth/register", json={"username": "bob", "password": "password1"})
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
