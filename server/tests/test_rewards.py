"""Resonance drops: the table, deterministic rolls, granting, boosts, freezes, odds and stats."""

from __future__ import annotations

import random
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient

from server.app.config import REPO_ROOT, Settings
from server.app.main import create_app
from server.app.progress import rewards as rw

WAVES = "example/demo/basics/waves"
TYPING = "example/demo/basics/typing"


def test_table_loads_and_odds_sum():
    t = rw.load_table()
    assert 0 < t.drop_chance < 1 and t.perfect_bonus >= 0
    assert abs(sum(t.rarities.values()) - 1.0) < 1e-6
    keys = [r.key for r in t.rewards]
    assert len(keys) == len(set(keys))
    assert {r.kind for r in t.rewards} == {"xp_boost", "freeze", "cosmetic", "title"}
    odds = t.odds()
    assert abs(sum(r["chance"] for r in odds["rewards"]) - t.drop_chance) < 1e-6
    assert all(r["chance_perfect"] >= r["chance"] for r in odds["rewards"])


def test_roll_is_deterministic_and_respects_chance():
    t = rw.load_table()
    hits = sum(1 for i in range(2000) if rw.roll(t, perfect=False, rng=random.Random(i)))
    assert 0.3 * 2000 < hits < 0.4 * 2000  # ≈ drop_chance
    perfect_hits = sum(1 for i in range(2000) if rw.roll(t, perfect=True, rng=random.Random(i)))
    assert perfect_hits > hits
    a = rw.roll(t, perfect=False, rng=random.Random(7))
    b = rw.roll(t, perfect=False, rng=random.Random(7))
    assert a == b


def test_owned_cosmetics_reroll_to_stackables():
    t = rw.load_table()
    owned = {r.key for r in t.rewards if r.kind in ("cosmetic", "title")}
    for i in range(500):
        r = rw.roll(t, perfect=True, rng=random.Random(i), owned=owned)
        assert r is None or r.kind in rw.STACKABLE


def _app(tmp_path: Path) -> TestClient:
    s = Settings(
        content_dir=REPO_ROOT / "content",
        elements_dir=REPO_ROOT / "elements",
        web_dir=REPO_ROOT / "web",
        data_dir=tmp_path,
        dev=True,
    )
    return TestClient(create_app(s))


def test_grant_consume_and_equip(tmp_path: Path):
    from server.app.db.models import User
    from server.app.db.session import LOCAL_USERNAME

    with _app(tmp_path) as c:
        db = c.app.state.db.session()
        user = db.query(User).filter_by(username=LOCAL_USERNAME).one()
        t = rw.load_table()
        now = datetime(2026, 3, 1)
        rw.grant(db, user, t.get("xp_boost"), now)
        rw.grant(db, user, t.get("xp_boost"), now)
        rw.grant(db, user, t.get("streak_freeze"), now)
        rw.grant(db, user, t.get("tile_round"), now)
        rw.grant(db, user, t.get("tile_round"), now)  # owned once only
        rw.grant(db, user, t.get("title_tuner"), now)
        db.commit()
        assert rw.available(db, user, "xp_boost") == 2
        assert rw.available(db, user, "freeze") == 1
        inv = rw.inventory_api(db, user)
        assert {i["key"]: i["quantity"] for i in inv} == {
            "xp_boost": 2,
            "streak_freeze": 1,
            "tile_round": 1,
            "title_tuner": 1,
        }
        eq = rw.equipped(db, user)
        assert eq == {"tile_shape": "tile_round", "tile_pattern": None, "title": "Tuner"}
        assert rw.consume(db, user, "xp_boost", 1) == 1 and rw.available(db, user, "xp_boost") == 1
        assert rw.consume(db, user, "freeze", 5) == 1 and rw.available(db, user, "freeze") == 0
        db.commit()
        # Equip via the API: a second cosmetic in the same slot replaces the first.
        rw.grant(db, user, t.get("tile_hex"), now)
        db.commit()
        hex_id = next(i["id"] for i in rw.inventory_api(db, user) if i["key"] == "tile_hex")
        r = c.put(f"/api/inventory/{hex_id}/equip", json={"equipped": True})
        assert r.status_code == 200 and r.json()["equipped"]["tile_shape"] == "tile_hex"
        boost_id = next(i["id"] for i in rw.inventory_api(db, user) if i["key"] == "xp_boost")
        assert c.put(f"/api/inventory/{boost_id}/equip", json={"equipped": True}).status_code == 400
        assert c.put("/api/inventory/9999/equip", json={"equipped": True}).status_code == 404
        me = c.get("/api/me").json()
        assert me["title"] == "Tuner" and me["cosmetics"]["tile_shape"] == "tile_hex"
        db.close()


def test_drops_boost_and_freeze_through_the_api(tmp_path: Path, monkeypatch):
    with _app(tmp_path) as c:
        # Force a drop of an XP boost, then a streak freeze.
        t = rw.load_table()
        forced = iter([t.get("xp_boost"), t.get("streak_freeze"), None, None, None])
        monkeypatch.setattr(rw, "roll", lambda *a, **k: next(forced))
        c.put("/api/settings", json={"dailyGoal": 10})
        r = c.post(
            f"/api/lessons/{WAVES}/complete?now=2026-03-01T12:00:00Z", json={"xp": 10}
        ).json()
        assert r["drop"]["key"] == "xp_boost" and r["boosted"] is False and r["xp"] == 10
        # The next lesson is boosted ×2 and consumes the boost; it drops a freeze.
        r = c.post(
            f"/api/lessons/{TYPING}/complete?now=2026-03-02T12:00:00Z", json={"xp": 10}
        ).json()
        assert r["boosted"] is True and r["xp"] == 20
        assert r["drop"]["key"] == "streak_freeze"
        assert r["me"]["xp_boosts"] == 0 and r["me"]["freezes"] == 1
        assert r["me"]["streak"] == 2
        # Skip Mar 3; on Mar 4 the freeze is used automatically and the streak survives.
        me = c.get("/api/me?now=2026-03-04T12:00:00Z").json()
        assert me["streak"] == 3 and me["freezes"] == 0
        # Drops can be switched off: no drop, ever.
        c.put("/api/settings", json={"drops": False})
        r = c.post(
            f"/api/lessons/{WAVES}/complete?now=2026-03-04T12:00:00Z", json={"xp": 10}
        ).json()
        assert r["drop"] is None
        # Repeats never drop either (even with drops on).
        c.put("/api/settings", json={"drops": True})
        r = c.post(
            f"/api/lessons/{WAVES}/complete?now=2026-03-04T13:00:00Z", json={"xp": 10}
        ).json()
        assert r["drop"] is None and r["repeat"] is True

        odds = c.get("/api/rewards").json()
        assert odds["drop_chance"] == t.drop_chance and len(odds["rewards"]) == len(t.rewards)
        inv = c.get("/api/inventory").json()
        assert inv["items"] == [] or all(i["quantity"] >= 0 for i in inv["items"])

        stats = c.get("/api/stats?now=2026-03-04T13:00:00Z").json()
        assert stats["best_streak"] == 4
        assert len(stats["xp_by_day"]) == 30 and stats["xp_by_day"][-1]["date"] == "2026-03-04"
        assert stats["calendar"][0]["date"] <= "2026-01-01" or len(stats["calendar"]) >= 84
        assert any(d["freeze"] for d in stats["calendar"])
        assert stats["courses"][0]["course"] == "demo" and stats["courses"][0]["completed"] == 2
        assert stats["lessons_total"] == 4 and stats["me"]["xp_total"] == 50
