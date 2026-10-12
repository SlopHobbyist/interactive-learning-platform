"""Progress API: attempts → SRS state, completion → XP/unlocks/streak, persistence across apps."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from server.app.config import REPO_ROOT, Settings
from server.app.main import create_app

WAVES = "example/demo/basics/waves"
TYPING = "example/demo/basics/typing"


def _settings(data_dir: Path) -> Settings:
    return Settings(
        content_dir=REPO_ROOT / "content",
        elements_dir=REPO_ROOT / "elements",
        web_dir=REPO_ROOT / "web",
        data_dir=data_dir,
        dev=True,
    )


def _attempt(item: str, correct: bool, ms: int = 2000, **extra) -> dict:
    return {
        "item_path": f"{WAVES}#{item}",
        "answer": [0],
        "correct": correct,
        "partial": 1.0 if correct else 0.0,
        "ms": ms,
        **extra,
    }


def test_me_starts_empty(tmp_path: Path):
    with TestClient(create_app(_settings(tmp_path))) as client:
        me = client.get("/api/me").json()
        assert me["xp_today"] == 0 and me["streak"] == 0 and me["daily_goal"] == 20
        assert me["username"] == "local"


def test_attempts_and_completion_flow(tmp_path: Path):
    with TestClient(create_app(_settings(tmp_path))) as c:
        before = c.get("/api/progress/example/demo").json()
        assert before["lessons"]["basics/waves"] == "available"
        assert before["lessons"]["basics/typing"] == "locked"
        assert before["strength"] == {} and before["due"] == 0

        r = c.post(
            "/api/attempts",
            json={
                "attempts": [
                    _attempt("what-moves", False),
                    _attempt("wavefront-def", True),
                    _attempt("wave-types", True),
                    _attempt("what-moves", True, attempt=2),
                    {
                        "item_path": f"{WAVES}#intro",
                        "answer": None,
                        "correct": True,
                        "graded": False,
                    },
                ],
                "timezone": "Europe/Madrid",
            },
        )
        assert r.status_code == 200 and r.json()["recorded"] == 5

        r = c.post(
            f"/api/lessons/{WAVES}/complete",
            json={
                "xp": 12,
                "accuracy": 0.67,
                "perfect": False,
                "elapsed_ms": 60000,
                "timezone": "Europe/Madrid",
            },
        )
        assert r.status_code == 200
        res = r.json()
        assert res["xp"] == 12 and res["repeat"] is False
        assert res["unlocked"] == ["basics/typing"]
        assert res["daily"] == {"xp": 12, "goal": 20, "met": False}
        assert res["me"]["xp_today"] == 12 and res["me"]["streak"] == 0

        after = c.get("/api/progress/example/demo").json()
        assert after["lessons"]["basics/waves"] == "complete"
        assert after["lessons"]["basics/typing"] == "available"
        assert after["units"] == {"basics": "available", "practice": "locked"}
        # Strength just after review is ~100 (R ≈ 1 for every graded item).
        assert after["strength"]["basics/waves"] > 95
        assert after["completed"] == 1 and after["total"] == 4

        # Meeting the goal today starts the streak.
        c.post(
            f"/api/lessons/{TYPING}/complete",
            json={"xp": 10, "accuracy": 1, "perfect": True, "elapsed_ms": 1000},
        )
        me = c.get("/api/me").json()
        assert me["xp_today"] == 22 and me["goal_met"] is True and me["streak"] == 1
        assert me["xp_total"] == 22 and me["lessons_completed"] == 2
        assert me["timezone"] == "Europe/Madrid"

        # A repeat completion counts XP but not a new lesson.
        res = c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 5}).json()
        assert res["repeat"] is True and res["unlocked"] == []
        assert c.get("/api/me").json()["lessons_completed"] == 2

        # Time travel (dev only): 30 days later the tile has faded and items are due.
        later = c.get("/api/progress/example/demo?now=+30d").json()
        assert later["strength"]["basics/waves"] < 40
        assert later["due"] >= 3

        assert c.post("/api/lessons/example/demo/basics/nope/complete", json={}).status_code == 404

    # Progress survives an app restart (new engine, same file).
    with TestClient(create_app(_settings(tmp_path))) as c:
        assert c.get("/api/progress/example/demo").json()["lessons"]["basics/waves"] == "complete"
        assert c.get("/api/me").json()["xp_total"] == 27


def test_settings_roundtrip(tmp_path: Path):
    with TestClient(create_app(_settings(tmp_path))) as c:
        assert c.get("/api/settings").json()["dailyGoal"] == 20
        r = c.put("/api/settings", json={"dailyGoal": 50, "sounds": True, "bogus": 1})
        assert r.status_code == 200
        s = r.json()
        assert s["dailyGoal"] == 50 and s["sounds"] is True and "bogus" not in s
        assert c.get("/api/me").json()["daily_goal"] == 50
        assert c.put("/api/settings", json={"dailyGoal": 0}).status_code == 422


def test_time_travel_requires_dev(tmp_path: Path):
    s = Settings(
        content_dir=REPO_ROOT / "content",
        elements_dir=REPO_ROOT / "elements",
        web_dir=REPO_ROOT / "web",
        data_dir=tmp_path,
        dev=False,
    )
    with TestClient(create_app(s)) as c:
        assert c.get("/api/me?now=+1d").status_code == 400
        assert c.get("/api/me").status_code == 200


def test_check_db_reports_orphans(tmp_path: Path):
    from server.app.content.loader import load_content
    from server.app.db.checks import orphaned_paths
    from server.app.db.session import Database

    settings = _settings(tmp_path)
    with TestClient(create_app(settings)) as c:
        c.post(
            "/api/attempts",
            json={
                "attempts": [
                    _attempt("what-moves", True),
                    {"item_path": f"{WAVES}#gone", "correct": True},
                ]
            },
        )
        c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 1})
    index = load_content(settings.content_dir)
    problems = orphaned_paths(index, Database(settings))
    msgs = [p.message for p in problems]
    assert any("#gone" in m for m in msgs)
    assert all(p.level == "warning" for p in problems)
    assert not any("what-moves" in m for m in msgs)
