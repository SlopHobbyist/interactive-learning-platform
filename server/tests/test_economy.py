"""Chests, coins, daily quests and the shop (shop_plan.md): the config, the lesson-chest chance,
chest contents, quests, payouts, buying and equipping, the boost, the league payout, the
migration's refunds, and the streak tools (milestone chests, repair, wager)."""

from __future__ import annotations

import random
import re
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.app.config import REPO_ROOT, Settings
from server.app.db.models import CoinEvent, DailyLog, User, XpEvent
from server.app.db.session import LOCAL_USERNAME
from server.app.main import create_app
from server.app.progress import chests as ch
from server.app.progress import economy as ec
from server.app.progress import quests as qs
from server.app.progress import shop as sh
from server.app.progress import streak_tools as st
from server.app.progress.streaks import Day

WAVES = "example/demo/basics/waves"
TYPING = "example/demo/basics/typing"
MATCHING = "example/demo/practice/matching"
REVIEW = "example/demo/practice/review"
T0 = datetime(2026, 3, 1, 12, 0)


def at(t: datetime) -> str:
    return "now=" + t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _settings(tmp_path: Path, **kw) -> Settings:
    return Settings(
        content_dir=REPO_ROOT / "content",
        elements_dir=REPO_ROOT / "elements",
        web_dir=REPO_ROOT / "web",
        data_dir=tmp_path,
        dev=True,
        **kw,
    )


def _app(tmp_path: Path) -> TestClient:
    return TestClient(create_app(_settings(tmp_path)))


def _local(c: TestClient):
    db = c.app.state.db.session()
    return db, db.query(User).filter_by(username=LOCAL_USERNAME).one()


# ------------------------------------------------------------------- config
def test_config_loads():
    econ = ec.load()
    assert all(econ.quests[t] for t in ec.TIERS)
    keys = [q.key for t in ec.TIERS for q in econ.quests[t]]
    assert len(keys) == len(set(keys))
    kinds = {"xp", "lessons", "perfect", "run", "review"}  # what quests.metrics measures
    assert {q.kind for t in ec.TIERS for q in econ.quests[t]} <= kinds
    odds = econ.odds()
    assert abs(sum(c["chance"] for c in odds["contents"]) - 1.0) < 1e-6
    assert {c["kind"] for c in odds["contents"]} == {"xp_boost", "freeze", "coins"}
    assert econ.freeze_cap == 2 and econ.boost_minutes == 15


def test_shop_catalog_and_assets():
    cat = sh.load()
    keys = [i.key for i in cat.items]
    assert len(keys) == len(set(keys))
    for slot in sh.SLOTS:
        defaults = [i for i in cat.items if i.slot == slot and i.default]
        assert len(defaults) == 1 and defaults[0].price == 0
    sounds = REPO_ROOT / "web" / "assets" / "sounds"
    player = REPO_ROOT / "web" / "js" / "player"
    effects_js = (player / "effects.js").read_text(encoding="utf-8")
    skins_js = (player / "skins.js").read_text(encoding="utf-8")
    assert {i.kind for i in cat.items} == {
        "freeze",
        "repair",
        "wager",
        "sound_pack",
        "effect",
        "celebration",
        "combo",
        "progress",
    }
    for item in cat.items:
        if item.kind == "sound_pack":
            folder = sounds / item.asset
            names = ["wrong", "complete"] + (
                [f"correct-{n}" for n in range(1, item.steps + 1)] if item.steps else ["correct"]
            )
            for name in names:
                assert (folder / f"{name}.wav").is_file(), f"{item.key}: {name}.wav missing"
        elif item.kind in ("effect", "celebration") and not item.default:
            assert re.search(rf"\b{item.asset}\s*[:(]", effects_js), (
                f"{item.asset} not in effects.js"
            )
        elif item.kind in ("combo", "progress"):
            assert re.search(rf"\b{item.asset}\s*:\s*{{", skins_js), f"{item.asset} not in skins.js"


# ------------------------------------------------------------- the chance
def test_lesson_chest_chance():
    r = ec.load().lesson
    S = ch.LessonState
    assert ch.chance(r, S(session=0, dry=0, today=0, first=True), perfect=False) == 1.0
    assert ch.chance(r, S(0, 0, 0, False), perfect=False) == pytest.approx(0.10)
    assert ch.chance(r, S(2, 0, 0, False), perfect=False) == pytest.approx(0.20)
    assert ch.chance(r, S(10, 0, 0, False), perfect=False) == pytest.approx(0.30)  # session cap
    assert ch.chance(r, S(0, 0, 0, False), perfect=True) == pytest.approx(0.20)
    assert ch.chance(r, S(1, 3, 0, False), perfect=False) == pytest.approx(0.39)
    assert ch.chance(r, S(0, 6, 0, False), perfect=False) == 1.0  # bad-luck protection
    assert ch.chance(r, S(0, 6, 3, True), perfect=True) == 0.0  # the daily cap wins
    s = ch.after(S(1, 4, 1, False), granted=True)
    assert s == S(2, 0, 2, False)
    assert ch.after(s, granted=False) == S(3, 1, 2, False)
    nxt = ch.next_chance(r, S(1, 0, 3, False))
    assert nxt["capped"] is True and nxt["chance"] == 0.0


def test_chest_contents():
    econ = ec.load()
    counts = {"xp_boost": 0, "freeze": 0, "coins": 0}
    for i in range(3000):
        kind, amount = ch.roll_contents(econ, random.Random(i), freezes_held=0)
        counts[kind] += 1
        if kind == "coins":
            assert amount in econ.chest_coins
        elif kind == "xp_boost":
            assert amount == econ.boost_minutes
    assert 0.15 < counts["freeze"] / 3000 < 0.25
    # At the cap a freeze becomes coins.
    for i in range(500):
        kind, _ = ch.roll_contents(econ, random.Random(i), freezes_held=econ.freeze_cap)
        assert kind != "freeze"


# ------------------------------------------------------------------- quests
def test_quest_targets_and_pick():
    econ = ec.load()
    half, double = econ.quest("xp_half"), econ.quest("xp_double")
    assert [half.target_for(g) for g in (10, 20, 30, 50)] == [5, 10, 15, 25]
    assert double.target_for(30) == 60
    assert econ.quest("run_8").target_for(50) == 8
    a = qs.pick(econ, 7, "2026-03-01", 20, 0)
    assert a == qs.pick(econ, 7, "2026-03-01", 20, 0)  # deterministic per learner and day
    assert [t for t, _, _ in a] == [0, 1, 2]
    picks = {
        q.key for d in range(60) for _, q, _ in qs.pick(econ, 1, f"2026-04-{d % 28 + 1:02d}", 20, 0)
    }
    assert "review_10" not in picks  # never offered without items to review
    picks = {
        q.key for d in range(28) for _, q, _ in qs.pick(econ, 1, f"2026-04-{d + 1:02d}", 20, 50)
    }
    assert "review_10" in picks
    assert qs.longest_run([True, True, False, True, True, True]) == 3


def test_quests_reset_at_local_midnight():
    assert qs.day_bounds("2026-03-01", "UTC") == (datetime(2026, 3, 1), datetime(2026, 3, 2))
    start, end = qs.day_bounds("2026-03-01", "America/New_York")
    assert start == datetime(2026, 3, 1, 5) and end == datetime(2026, 3, 2, 5)
    assert qs.resets_in(datetime(2026, 3, 1, 23, 0), "2026-03-01", "UTC") == 3600


# ---------------------------------------------------------- through the API
def test_chests_coins_quests_and_boost_through_the_api(tmp_path: Path, monkeypatch):
    with _app(tmp_path) as c:
        c.put("/api/settings", json={"dailyGoal": 10, "chests": True})
        # The first lesson ever always gives a chest; "finish a lesson" style quests are met too.
        r = c.post(f"/api/lessons/{WAVES}/complete?{at(T0)}", json={"xp": 10}).json()
        sources = [x["source"] for x in r["chests"]]
        assert sources.count("lesson") == 1 and "quest" in sources
        assert all(not x["opened"] and x["reward"] is None for x in r["chests"])
        assert r["coins_earned"] == 5 + 10  # lesson + daily goal
        assert r["chest_next"] == {
            "chance": 0.15,
            "chance_perfect": 0.25,
            "today": 1,
            "cap": 3,
            "capped": False,
        }
        assert len(r["quests"]) == 3 and any(q["done"] for q in r["quests"])
        assert r["me"]["coins"] == 15 and r["me"]["chests_unopened"] == len(r["chests"])

        # Open them: a boost, a freeze, then coins.
        rolls = iter([("xp_boost", 15), ("freeze", 1), ("coins", 20), ("coins", 20)])
        monkeypatch.setattr(ch, "roll_contents", lambda *a, **k: next(rolls))
        ids = [x["id"] for x in r["chests"]]
        o = c.post(f"/api/chests/{ids[0]}/open?{at(T0)}").json()
        assert o["chest"]["reward"]["kind"] == "xp_boost" and o["me"]["boost_seconds"] == 900
        o = c.post(f"/api/chests/{ids[1]}/open?{at(T0)}").json()
        assert o["chest"]["reward"]["kind"] == "freeze" and o["me"]["freezes"] == 1
        for i in ids[2:]:
            c.post(f"/api/chests/{i}/open?{at(T0)}").raise_for_status()
        assert c.post(f"/api/chests/{ids[0]}/open?{at(T0)}").status_code == 400
        assert c.post(f"/api/chests/9999/open?{at(T0)}").status_code == 404
        assert c.get("/api/chests").json()["unopened"] == []

        # From here on no lesson chests, so the rest is deterministic.
        monkeypatch.setattr(ch, "chance", lambda *a, **k: 0.0)
        # Inside the boost window XP doubles; the goal coins are not paid twice.
        r = c.post(
            f"/api/lessons/{TYPING}/complete?{at(T0 + timedelta(minutes=5))}", json={"xp": 10}
        ).json()
        assert r["boosted"] is True and r["xp"] == 20 and r["coins_earned"] == 5
        assert all(x["source"] == "quest" for x in r["chests"])
        # Once it has run out, it does not.
        r = c.post(
            f"/api/lessons/{MATCHING}/complete?{at(T0 + timedelta(minutes=16))}",
            json={"xp": 10, "perfect": True},
        ).json()
        assert r["boosted"] is False and r["xp"] == 10 and r["coins_earned"] == 10
        # A repeat pays no coins and has no chance of a chest.
        r = c.post(
            f"/api/lessons/{WAVES}/complete?{at(T0 + timedelta(minutes=20))}", json={"xp": 10}
        ).json()
        assert r["repeat"] is True and r["coins_earned"] == 0 and r["chest_next"] is None
        # With chests off: no chests, no quests.
        c.put("/api/settings", json={"chests": False})
        r = c.post(
            f"/api/lessons/{REVIEW}/complete?{at(T0 + timedelta(minutes=22))}", json={"xp": 10}
        ).json()
        assert r["chests"] == [] and r["quests"] == [] and r["chest_next"] is None
        assert c.get(f"/api/quests?{at(T0)}").json()["enabled"] is False
        c.put("/api/settings", json={"chests": True})
        q = c.get(f"/api/quests?{at(T0)}").json()
        assert q["enabled"] and q["date"] == "2026-03-01" and q["resets_in"] == 12 * 3600
        assert len(q["quests"]) == 3 and q["chests"] == []  # nothing granted twice

        # The freeze bridges a missed day automatically.
        r = c.post(f"/api/lessons/{WAVES}/complete?{at(T0 + timedelta(days=2))}", json={"xp": 10})
        me = r.json()["me"]
        assert me["streak"] == 3 and me["freezes"] == 0
        stats = c.get(f"/api/stats?{at(T0 + timedelta(days=2))}").json()
        assert any(d["freeze"] for d in stats["calendar"])

        odds = c.get("/api/chests").json()["odds"]
        assert odds["lesson"]["daily_cap"] == 3 and odds["earn"]["lesson"] == 5


def test_review_pays_coins_and_is_boosted(tmp_path: Path):
    with _app(tmp_path) as c:
        c.put("/api/settings", json={"dailyGoal": 50, "chests": False})
        db, user = _local(c)
        user.xp_boost_until = T0 + timedelta(minutes=10)
        db.commit()
        r = c.post(f"/api/review/example/demo/complete?{at(T0)}", json={"xp": 6}).json()
        assert r["boosted"] is True and r["xp"] == 12 and r["coins_earned"] == 3
        for _ in range(6):
            r = c.post(f"/api/review/example/demo/complete?{at(T0)}", json={"xp": 1}).json()
        assert r["coins_earned"] == 0  # past the daily cap of paid review sessions
        db.close()


def test_shop_buy_and_equip(tmp_path: Path):
    with _app(tmp_path) as c:
        shop = c.get("/api/shop").json()
        assert shop["coins"] == 0 and shop["freeze_cap"] == 2
        classic = next(i for i in shop["items"] if i["key"] == "sounds_classic")
        assert classic["owned"] and classic["equipped"]
        assert shop["equipped"]["sounds"]["asset"] == "classic"
        assert shop["equipped"]["effect"]["asset"] == "none"
        r = c.post("/api/shop/sounds_marimba/buy")
        assert r.status_code == 400 and "coins" in r.json()["detail"]

        db, user = _local(c)
        ec.earn(db, user, 1000, "test", None, "2026-03-01", T0)
        db.commit()
        r = c.post("/api/shop/sounds_marimba/buy").json()
        assert r["coins"] == 700 and r["equipped"]["sounds"]["key"] == "sounds_marimba"
        assert r["me"]["equipped"]["sounds"]["asset"] == "marimba"
        assert c.post("/api/shop/sounds_marimba/buy").status_code == 400  # owned
        assert c.post("/api/shop/sounds_classic/buy").status_code == 400  # the free default
        r = c.post("/api/shop/effect_confetti/buy").json()
        assert r["coins"] == 450 and r["equipped"]["effect"]["asset"] == "confetti"
        assert r["equipped"]["sounds"]["key"] == "sounds_marimba"  # other slot untouched

        assert c.put("/api/shop/equip", json={"key": "sounds_chiptune"}).status_code == 400
        assert c.put("/api/shop/equip", json={"key": "streak_freeze"}).status_code == 400
        assert c.put("/api/shop/equip", json={"key": "nope"}).status_code == 404
        eq = c.put("/api/shop/equip", json={"key": "sounds_classic"}).json()["equipped"]
        assert eq["sounds"]["key"] == "sounds_classic"
        eq = c.put("/api/shop/equip", json={"key": "sounds_marimba"}).json()["equipped"]
        assert eq["sounds"]["key"] == "sounds_marimba"

        assert c.post("/api/shop/streak_freeze/buy").json()["me"]["freezes"] == 1
        assert c.post("/api/shop/streak_freeze/buy").json()["coins"] == 250
        r = c.post("/api/shop/streak_freeze/buy")
        assert r.status_code == 400 and "2" in r.json()["detail"]
        assert c.post("/api/shop/nope/buy").status_code == 404
        shop = c.get("/api/shop").json()
        freeze = next(i for i in shop["items"] if i["key"] == "streak_freeze")
        assert freeze["held"] == 2 and freeze["can_buy"] is False
        assert shop["coins"] == ec.balance(db, user) == 250
        db.close()


def test_league_pays_last_weeks_top_three_once(tmp_path: Path):
    with _app(tmp_path) as c:
        db = c.app.state.db.session()
        users = [User(username=n) for n in ("ann", "bob", "cat", "dan")]
        db.add_all(users)
        db.flush()
        last_week = datetime(2026, 3, 3, 12)  # Tue; "now" is the Wednesday after
        for u, xp in zip(users, (90, 60, 30, 10), strict=True):
            db.add(
                XpEvent(
                    user_id=u.id, amount=xp, kind="lesson", local_date="2026-03-03", ts=last_week
                )
            )
        db.commit()
        now = datetime(2026, 3, 11, 9)
        assert ec.settle_league(db, users[0], now, mode="single") == 0
        assert [ec.settle_league(db, u, now, mode="multi") for u in users] == [50, 30, 20, 0]
        assert ec.settle_league(db, users[0], now, mode="multi") == 0  # once a week
        assert ec.balance(db, users[0]) == 50
        # Fewer than three learners with XP: no payout.
        db.query(XpEvent).filter(XpEvent.user_id.in_([users[1].id, users[2].id])).delete()
        db.commit()
        assert ec.settle_league(db, users[0], now + timedelta(days=7), mode="multi") == 0
        db.close()


# ---------------------------------------------------------------- migration
def test_migration_refunds_resonance_leftovers(tmp_path: Path):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    from server.app.db.session import MIGRATIONS_DIR, Database

    database = Database(_settings(tmp_path))
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", database.url)
    cfg.attributes["engine"] = database.engine
    command.upgrade(cfg, "0002")
    with database.engine.begin() as conn:
        conn.execute(
            text("INSERT INTO users (id, username, created_at) VALUES (1, 'x', '2026-01-01')")
        )
        conn.execute(
            text("INSERT INTO settings (user_id, key, value) VALUES (1, 'drops', 'false')")
        )
        rows = [
            ("xp_boost", "xp_boost", 3),
            ("freeze", "streak_freeze", 5),
            ("cosmetic", "tile_hex", 1),
            ("title", "title_tuner", 1),
        ]
        for kind, key, qty in rows:
            conn.execute(
                text(
                    "INSERT INTO inventory"
                    " (user_id, kind, key, rarity, quantity, equipped, obtained_at)"
                    " VALUES (1, :k, :key, 'common', :q, 0, '2026-01-01')"
                ),
                {"k": kind, "key": key, "q": qty},
            )
    command.upgrade(cfg, "head")
    with database.session() as db:
        user = db.get(User, 1)
        assert ec.balance(db, user) == 3 * 25 + 3 * 100 + 100 + 100
        assert {r.kind for r in db.query(CoinEvent)} == {"refund"}
        assert ec.available(db, user, "freeze") == 2
        inv = db.execute(text("SELECT kind FROM inventory")).scalars().all()
        assert inv == ["freeze"]
        assert db.execute(text("SELECT key FROM settings")).scalars().all() == ["chests"]


# ------------------------------------------------------------ streak tools
def _days(spec: dict[str, bool]) -> dict[str, Day]:
    return {d: Day(d, 10, 10, met) for d, met in spec.items()}


def _seed_streak(c: TestClient, last_day: datetime, length: int) -> None:
    """Met-goal days ending on ``last_day`` (inclusive)."""
    db, user = _local(c)
    for i in range(length):
        d = (last_day - timedelta(days=i)).date().isoformat()
        db.add(DailyLog(user_id=user.id, local_date=d, xp=10, goal=10, met=True, lessons=1))
    db.commit()
    db.close()


def test_repair_info_window_and_length():
    tools = ec.load().tools
    five = {f"2026-03-0{d}": True for d in range(1, 6)}  # Mar 1..5
    info = st.repair_info(_days(five), "2026-03-07", tools)  # Mar 6 missed
    assert info == {"missed": ["2026-03-06"], "lost": 5, "restores": 6}
    assert st.repair_info(_days(five), "2026-03-08", tools)["missed"] == [
        "2026-03-06",
        "2026-03-07",
    ]
    assert st.repair_info(_days(five), "2026-03-09", tools) is None  # 3 missed: too late
    assert st.repair_info(_days(five), "2026-03-06", tools) is None  # nothing broke
    two = {"2026-03-01": True, "2026-03-02": True}
    assert st.repair_info(_days(two), "2026-03-04", tools) is None  # too short to repair
    # Met today after the break: today counts on top.
    info = st.repair_info(_days({**five, "2026-03-07": True}), "2026-03-07", tools)
    assert info["restores"] == 7


def test_wager_state():
    from server.app.db.models import Wager

    w = Wager(start_date="2026-03-01", days=3, stake=50, payout=100, status="active")
    met = _days({"2026-03-01": True, "2026-03-02": True})
    assert st.wager_state(w, met, "2026-03-02") == (2, "active")
    assert st.wager_state(w, met, "2026-03-03") == (2, "active")  # today still open
    assert st.wager_state(w, met, "2026-03-04") == (2, "lost")
    all_met = _days({"2026-03-01": True, "2026-03-02": True, "2026-03-03": True})
    assert st.wager_state(w, all_met, "2026-03-03") == (3, "won")
    frozen = {**met, "2026-03-03": Day("2026-03-03", freeze_used=True)}
    assert st.wager_state(w, frozen, "2026-03-05") == (3, "won")  # a freeze keeps the day


def test_milestone_chests_once_per_streak(tmp_path: Path):
    with _app(tmp_path) as c:
        c.put("/api/settings", json={"dailyGoal": 10, "chests": True})
        _seed_streak(c, T0 - timedelta(days=1), 6)
        # Day 7 of the streak: a streak chest (and the usual lesson and quest chests).
        r = c.post(f"/api/lessons/{WAVES}/complete?{at(T0)}", json={"xp": 10}).json()
        assert r["me"]["streak"] == 7
        streak = [x for x in r["chests"] if x["source"] == "streak"]
        assert len(streak) == 1 and streak[0]["title"] == "Streak chest"
        assert streak[0]["subtitle"] == "7-day streak"
        # The same day again: no second one.
        r = c.post(f"/api/lessons/{TYPING}/complete?{at(T0 + timedelta(hours=1))}", json={"xp": 10})
        assert not [x for x in r.json()["chests"] if x["source"] == "streak"]
        db, user = _local(c)
        later = (T0 + timedelta(days=20)).date().isoformat()
        assert st.milestone_chests(db, user, day=later, streak=7, now=T0, econ=ec.load())  # rebuilt
        assert not st.milestone_chests(db, user, day=later, streak=8, now=T0, econ=ec.load())
        assert len(st.milestone_chests(db, user, day=later, streak=30, now=T0, econ=ec.load())) == 2
        db.close()


def test_repair_through_the_shop(tmp_path: Path):
    with _app(tmp_path) as c:
        c.put("/api/settings", json={"dailyGoal": 10, "chests": False})
        _seed_streak(c, T0 - timedelta(days=2), 5)  # yesterday was missed
        assert c.get(f"/api/me?{at(T0)}").json()["streak"] == 0
        shop = c.get(f"/api/shop?{at(T0)}").json()
        repair = next(i for i in shop["items"] if i["key"] == "streak_repair")
        assert repair["repair"]["lost"] == 5 and repair["can_buy"] is False  # no coins yet
        db, user = _local(c)
        ec.earn(db, user, 500, "test", None, "2026-03-01", T0)
        db.commit()
        db.close()
        r = c.post(f"/api/shop/streak_repair/buy?{at(T0)}").json()
        assert r["me"]["streak"] == 6 and r["coins"] == 300
        r = c.post(f"/api/shop/streak_repair/buy?{at(T0)}")
        assert r.status_code == 400 and "repair" in r.json()["detail"]
        # A freeze would have covered it first: repair is only for what freezes could not.
        shop = c.get(f"/api/shop?{at(T0)}").json()
        assert next(i for i in shop["items"] if i["key"] == "streak_repair")["repair"] is None


def test_wager_won_and_lost(tmp_path: Path):
    with _app(tmp_path) as c:
        c.put("/api/settings", json={"dailyGoal": 10, "chests": False})
        db, user = _local(c)
        ec.earn(db, user, 100, "test", None, "2026-03-01", T0)
        db.commit()
        r = c.post(f"/api/shop/streak_wager/buy?{at(T0)}").json()
        assert r["coins"] == 50 and r["me"]["wager"]["days"] == 7
        assert c.post(f"/api/shop/streak_wager/buy?{at(T0)}").status_code == 400  # one at a time
        results = []
        for i in range(7):
            r = c.post(
                f"/api/lessons/{WAVES}/complete?{at(T0 + timedelta(days=i))}", json={"xp": 10}
            )
            results.append(r.json()["me"]["wager_result"])
        assert results[:6] == [None] * 6
        assert results[6]["status"] == "won" and results[6]["kept"] == 7
        assert ec.paid(db, user, "wager", f"wager:{results[6]['id']}")
        # A second wager, then a missed day: lost, and nothing is paid.
        c.post(f"/api/shop/streak_wager/buy?{at(T0 + timedelta(days=7))}").raise_for_status()
        c.post(f"/api/lessons/{WAVES}/complete?{at(T0 + timedelta(days=7))}", json={"xp": 10})
        me = c.get(f"/api/me?{at(T0 + timedelta(days=9))}").json()
        assert me["wager_result"]["status"] == "lost" and me["wager"] is None
        assert not ec.paid(db, user, "wager", f"wager:{me['wager_result']['id']}")
        db.close()
