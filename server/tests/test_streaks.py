"""Streak edge cases (plan §Phase 7): midnight rollover, a missed day with and without a
freeze, and a timezone change. Pure functions first, then the service with a database."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from server.app.config import REPO_ROOT, Settings
from server.app.main import create_app
from server.app.progress.service import local_date
from server.app.progress.streaks import Day, apply_freezes, best_streak, gap_days, streak_length


def met(*dates: str) -> dict[str, Day]:
    return {d: Day(d, xp=20, goal=20, met=True) for d in dates}


def test_streak_counts_consecutive_met_days():
    days = met("2026-03-01", "2026-03-02", "2026-03-03")
    assert streak_length(days, "2026-03-03") == 3
    assert best_streak(days) == 3


def test_today_still_open_counts_from_yesterday():
    """At 00:05 the new day has no XP yet; the streak must not drop to zero (midnight rollover)."""
    days = met("2026-03-01", "2026-03-02")
    assert streak_length(days, "2026-03-03") == 2
    # ... but a whole missed day in between breaks it.
    assert streak_length(days, "2026-03-04") == 0
    # Meeting today's goal extends it.
    days["2026-03-03"] = Day("2026-03-03", 25, 20, True)
    assert streak_length(days, "2026-03-03") == 3


def test_partial_day_does_not_count():
    days = met("2026-03-01")
    days["2026-03-02"] = Day("2026-03-02", xp=5, goal=20, met=False)
    assert streak_length(days, "2026-03-02") == 1  # yesterday still carries it
    assert streak_length(days, "2026-03-03") == 0


def test_missed_day_without_freeze_breaks():
    days = met("2026-03-01", "2026-03-02")
    frozen, left = apply_freezes(days, "2026-03-04", available=0)
    assert frozen == [] and left == 0
    assert streak_length(days, "2026-03-04") == 0


def test_missed_day_with_freeze_is_bridged():
    days = met("2026-03-01", "2026-03-02")
    assert gap_days(days, "2026-03-04") == ["2026-03-03"]
    frozen, left = apply_freezes(days, "2026-03-04", available=2)
    assert frozen == ["2026-03-03"] and left == 1
    assert days["2026-03-03"].freeze_used and not days["2026-03-03"].met
    assert streak_length(days, "2026-03-04") == 3  # today open: 1st, 2nd, frozen 3rd


def test_freezes_are_not_wasted_on_a_gap_they_cannot_cover():
    days = met("2026-03-01")
    frozen, left = apply_freezes(days, "2026-03-05", available=2)  # three missed days
    assert frozen == [] and left == 2
    assert streak_length(days, "2026-03-05") == 0


def test_no_history_means_nothing_to_freeze():
    assert gap_days({}, "2026-03-05") == []
    assert apply_freezes({}, "2026-03-05", available=3) == ([], 3)


def test_timezone_change_keeps_local_days():
    # 23:30 in Tokyo on the 2nd is still the 1st in Los Angeles.
    t = datetime(2026, 3, 2, 14, 30, tzinfo=UTC)  # 23:30 JST
    assert local_date(t, "Asia/Tokyo") == "2026-03-02"
    assert local_date(t, "America/Los_Angeles") == "2026-03-02"  # 06:30 PST, same date here
    t2 = datetime(2026, 3, 2, 2, 0, tzinfo=UTC)  # 11:00 JST on the 2nd, 18:00 PST on the 1st
    assert local_date(t2, "Asia/Tokyo") == "2026-03-02"
    assert local_date(t2, "America/Los_Angeles") == "2026-03-01"
    assert local_date(t2, "Not/AZone") == "2026-03-02"  # unknown zones fall back to UTC


def _app(tmp_path: Path) -> TestClient:
    s = Settings(
        content_dir=REPO_ROOT / "content",
        elements_dir=REPO_ROOT / "elements",
        web_dir=REPO_ROOT / "web",
        data_dir=tmp_path,
        dev=True,
    )
    return TestClient(create_app(s))


def test_streak_through_the_api_with_a_timezone_change(tmp_path: Path):
    waves = "example/demo/basics/waves"
    with _app(tmp_path) as c:
        c.put("/api/settings", json={"dailyGoal": 10, "drops": False})
        # Day 1 in Tokyo (18:00 UTC on Mar 1 = 03:00 JST Mar 2 → local date Mar 2).
        r = c.post(
            f"/api/lessons/{waves}/complete?now=2026-03-01T18:00:00Z",
            json={"xp": 10, "timezone": "Asia/Tokyo"},
        )
        assert r.json()["daily"]["met"] is True
        assert c.get("/api/me?now=2026-03-01T18:00:00Z&tz=Asia/Tokyo").json()["streak"] == 1
        # The learner flies to Los Angeles; it is still Mar 2 there at 20:00 PST (04:00 UTC Mar 3).
        r = c.post(
            f"/api/lessons/{waves}/complete?now=2026-03-03T04:00:00Z",
            json={"xp": 10, "timezone": "America/Los_Angeles"},
        )
        assert r.json()["daily"] == {
            "xp": 20,
            "goal": 10,
            "met": True,
        }  # same local day, no double count
        assert r.json()["me"]["streak"] == 1
        # Next local day in LA keeps the streak going.
        r = c.post(
            f"/api/lessons/{waves}/complete?now=2026-03-04T04:00:00Z",
            json={"xp": 10, "timezone": "America/Los_Angeles"},
        )
        assert r.json()["me"]["streak"] == 2
        # A missed day with no freeze: zero.
        assert c.get("/api/me?now=2026-03-06T04:00:00Z").json()["streak"] == 0
