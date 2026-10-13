"""Chests, daily quests and the shop in the browser (shop_plan.md): a chest opened on the
summary, the quests on home, buying and equipping in the shop, and the equipped effect."""

from __future__ import annotations

import re
import sqlite3

import httpx
import pytest
from playwright.sync_api import Page, expect

from server.app.config import Settings

pytestmark = pytest.mark.e2e

WAVES = "/l/example/demo/basics/waves"


def _settings(live_server: str, **patch) -> None:
    httpx.put(f"{live_server}/api/settings", json=patch).raise_for_status()


def _grant_coins(settings: Settings, amount: int) -> None:
    with sqlite3.connect(settings.data_dir / "ilp.sqlite3") as conn:
        conn.execute(
            "INSERT INTO coin_events (user_id, amount, kind, ref, local_date, ts) "
            "SELECT id, ?, 'test', NULL, date('now'), datetime('now') FROM users "
            "WHERE username = 'local'",
            (amount,),
        )


def _play_waves_perfectly(page: Page, live_server: str) -> None:
    page.goto(live_server + WAVES)
    page.get_by_role("button", name="Start").click()
    check = page.locator(".player-check")
    sheet_continue = page.locator(".player-sheet").get_by_role("button", name="Continue")
    check.click()  # explanation
    page.locator('.el-option[data-index="0"]').click()
    check.click()
    sheet_continue.click()
    page.locator('.el-option[data-value="true"]').click()
    check.click()
    sheet_continue.click()
    for i in (0, 1, 2):
        page.locator(f'.el-option[data-index="{i}"]').click()
    check.click()
    sheet_continue.click()
    check.click()  # closing explanation
    expect(page.locator(".player")).to_have_attribute("data-state", "summary")


def test_first_lesson_gives_a_chest_opened_on_the_summary(page: Page, live_server: str):
    _settings(live_server, chests=True, dailyGoal=10)
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    _play_waves_perfectly(page, live_server)
    card = page.locator(".player-card")
    expect(card.get_by_text("+20 coins")).to_be_visible()  # 5 + 5 perfect + 10 daily goal
    chests = card.locator(".chest")
    expect(chests.first).to_contain_text("Lesson chest")  # the first lesson always gives one
    n = chests.count()
    assert n >= 2  # and "finish a lesson" / "earn ½ goal" quests are met too
    expect(card.locator(".player-next-chance")).to_contain_text(re.compile(r"\d+% chest chance"))
    expect(card.locator(".quest")).to_have_count(3)
    # Enter opens the focused chest; focus walks to the next one, then to Continue.
    expect(card.locator(".chest-open").first).to_be_focused()
    for i in range(n):
        page.keyboard.press("Enter")
        expect(chests.nth(i)).to_have_attribute("data-reward", re.compile(r"xp_boost|freeze|coins"))
    expect(card.get_by_role("link", name="Continue")).to_be_focused()
    me = httpx.get(f"{live_server}/api/me").json()
    assert me["chests_unopened"] == 0
    expect(page.locator("#chip-coins [data-value]")).to_have_text(str(me["coins"]))
    assert errors == [], errors


def test_quests_and_waiting_chests_on_home(page: Page, live_server: str):
    _settings(live_server, chests=True, dailyGoal=10)
    httpx.post(f"{live_server}/api/lessons/example/demo/basics/waves/complete", json={"xp": 10})
    page.goto(live_server + "/")
    expect(page.get_by_role("heading", name="Daily quests")).to_be_visible()
    expect(page.locator(".quest")).to_have_count(3)
    expect(page.get_by_text(re.compile(r"new quests in \d+ (h|min)"))).to_be_visible()
    # The chests earned by that lesson wait here until opened.
    waiting = page.locator(".chest .chest-open")
    expect(waiting.first).to_be_visible()
    before = waiting.count()
    waiting.first.click()
    expect(page.locator(".chest[data-reward]")).to_have_count(1)
    expect(waiting).to_have_count(before - 1)


def test_buy_and_equip_in_the_shop(page: Page, live_server: str, settings: Settings):
    _grant_coins(settings, 1000)
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(live_server + "/shop")
    expect(page.locator(".page-lede")).to_contain_text("1000 coins")
    classic = page.locator('[data-item="sounds_classic"]')
    marimba = page.locator('[data-item="sounds_marimba"]')
    expect(classic).to_have_class(re.compile(r"\bis-equipped\b"))
    marimba.get_by_role("button", name="Preview").click()  # plays; must not throw
    marimba.get_by_role("button", name=re.compile("Buy Marimba")).click()
    expect(marimba).to_have_class(re.compile(r"\bis-equipped\b"))
    expect(marimba.get_by_text("In use")).to_be_visible()
    expect(page.locator("#chip-coins [data-value]")).to_have_text("700")
    expect(page.locator(".page-lede")).to_contain_text("700 coins")
    # Switch back to the free pack, then buy two freezes; a third is refused at the cap.
    classic.get_by_role("button", name="Use").click()
    expect(classic).to_have_class(re.compile(r"\bis-equipped\b"))
    assert httpx.get(f"{live_server}/api/me").json()["equipped"]["sounds"]["asset"] == "classic"
    freeze = page.locator('[data-item="streak_freeze"]')
    for held in (1, 2):
        freeze.get_by_role("button", name=re.compile("Buy Streak freeze")).click()
        expect(freeze).to_contain_text(f"You hold {held} of 2")
    expect(freeze.get_by_role("button", name=re.compile("Buy Streak freeze"))).to_be_disabled()
    # The odds are public.
    expect(page.get_by_role("heading", name="What a chest holds")).to_be_visible()
    expect(page.get_by_text("40%").first).to_be_visible()
    assert errors == [], errors


def test_the_equipped_effect_plays_on_a_right_answer(
    page: Page, live_server: str, settings: Settings
):
    _grant_coins(settings, 300)
    httpx.post(f"{live_server}/api/shop/effect_confetti/buy").raise_for_status()
    page.goto(live_server + WAVES)
    page.get_by_role("button", name="Start").click()
    page.locator(".player-check").click()  # explanation
    page.locator('.el-option[data-index="0"]').click()
    page.locator(".player-check").click()
    expect(page.locator(".fx-layer .fx-confetti").first).to_be_attached()
    # With reduced motion it is a flash instead.
    page.emulate_media(reduced_motion="reduce")
    page.locator(".player-sheet").get_by_role("button", name="Continue").click()
    page.locator('.el-option[data-value="true"]').click()
    page.locator(".player-check").click()
    expect(page.locator(".fx-layer .fx-flash")).to_be_attached()
