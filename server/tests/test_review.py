"""Review queue: weakest items first, interleaved across lessons, re-tune per tile, XP."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from server.app.config import REPO_ROOT, Settings
from server.app.main import create_app

WAVES = "example/demo/basics/waves"
TYPING = "example/demo/basics/typing"


def _app(tmp_path: Path) -> TestClient:
    s = Settings(
        content_dir=REPO_ROOT / "content",
        elements_dir=REPO_ROOT / "elements",
        web_dir=REPO_ROOT / "web",
        data_dir=tmp_path,
        dev=True,
    )
    return TestClient(create_app(s))


def _complete(c: TestClient, lesson: str, items: dict[str, bool], now: str | None = None) -> None:
    q = f"?now={now}" if now else ""
    c.post(
        f"/api/attempts{q}",
        json={
            "attempts": [
                {"item_path": f"{lesson}#{k}", "correct": v, "partial": 1 if v else 0, "ms": 1000}
                for k, v in items.items()
            ]
        },
    ).raise_for_status()
    c.post(f"/api/lessons/{lesson}/complete{q}", json={"xp": 10}).raise_for_status()


def test_review_empty_before_any_completion(tmp_path: Path):
    with _app(tmp_path) as c:
        r = c.get("/api/review/example/demo").json()
        assert r["items"] == [] and r["due"] == 0 and r["xp"] == 0
        assert c.get("/api/review/example/nope").status_code == 404


def test_review_orders_weakest_first_and_interleaves(tmp_path: Path):
    with _app(tmp_path) as c:
        _complete(c, WAVES, {"what-moves": False, "wavefront-def": True, "wave-types": True})
        _complete(
            c,
            TYPING,
            {
                "fill-typed": True,
                "fill-bank": True,
                "sa-unit": True,
                "num-speed": True,
                "num-sound": False,
            },
        )
        r = c.get("/api/review/example/demo?limit=4").json()
        assert len(r["items"]) == 4
        assert r["xp"] == 8
        # The two "again" items come first (lowest R), one from each lesson, then the rest
        # interleave.
        paths = [it["_path"].split("#")[1] for it in r["items"]]
        assert set(paths[:2]) == {"what-moves", "num-sound"}
        lessons = [it["_lesson"]["key"] for it in r["items"]]
        assert lessons[0] != lessons[1]
        for it in r["items"]:
            assert it["graded"] is True
            assert "_retrievability" in it and 0 <= it["_retrievability"] <= 1
            assert it["id"].count("--") == 2  # unique per session

        # Re-tune restricts to one tile.
        r = c.get("/api/review/example/demo?lesson=basics/waves").json()
        assert {it["_lesson"]["key"] for it in r["items"]} == {"basics/waves"}
        assert len(r["items"]) == 3 and r["title"].startswith("Re-tune")

        # Thirty days later everything is due; a review at +30d restores the strength.
        due = c.get("/api/review/example/demo?now=%2B30d").json()["due"]
        assert due == 8
        before = c.get("/api/progress/example/demo?now=%2B30d").json()["strength"]["basics/waves"]
        assert before < 40
        c.post(
            "/api/attempts?now=%2B30d",
            json={
                "attempts": [
                    {
                        "item_path": f"{WAVES}#{k}",
                        "correct": True,
                        "partial": 1,
                        "ms": 1000,
                        "ts": "2026-01-01T00:00:00Z",
                    }
                    for k in ("what-moves", "wavefront-def", "wave-types")
                ],
                "mode": "review",
            },
        ).raise_for_status()
        after = c.get("/api/progress/example/demo?now=%2B30d").json()["strength"]["basics/waves"]
        assert after > 95
        res = c.post(
            "/api/review/example/demo/complete?now=%2B30d", json={"xp": 6, "items": 3}
        ).json()
        assert res["xp"] == 6 and res["me"]["xp_total"] == 26
