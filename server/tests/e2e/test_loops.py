"""Gamification loops (Phase 7): the first-run goal dialog, the profile page, and that each loop
can be switched off with no leftover UI."""

from __future__ import annotations

import httpx
import pytest
from playwright.sync_api import Page, expect

pytestmark = pytest.mark.e2e

WAVES = "example/demo/basics/waves"


def _settings(live_server: str, **patch) -> None:
    httpx.put(f"{live_server}/api/settings", json=patch).raise_for_status()


def test_first_run_goal_dialog(page: Page, live_server: str):
    _settings(live_server, goalChosen=False)
    page.goto(live_server + "/")
    dialog = page.locator("#goal-dialog")
    expect(dialog).to_be_visible()
    expect(dialog.get_by_role("button", name="Start learning")).to_be_focused()
    dialog.get_by_role("button", name="30 XP").click()
    dialog.get_by_role("button", name="Start learning").click()
    expect(dialog).to_be_hidden()
    expect(page.locator("#chip-xp [data-value]")).to_have_text("0/30")
    assert httpx.get(f"{live_server}/api/settings").json() == {
        **httpx.get(f"{live_server}/api/settings").json(),
        "dailyGoal": 30,
        "goalChosen": True,
    }
    # It does not come back.
    page.reload()
    expect(page.locator("#goal-dialog")).to_be_hidden()


def test_profile_shows_stats_and_odds(page: Page, live_server: str):
    _settings(live_server, goalChosen=True, dailyGoal=10, drops=True)
    # Complete "today" in the browser's own timezone, which is what the profile page asks for.
    page.goto(live_server + "/")
    tz = page.evaluate("() => Intl.DateTimeFormat().resolvedOptions().timeZone")
    httpx.post(
        f"{live_server}/api/attempts",
        json={
            "attempts": [
                {"item_path": f"{WAVES}#what-moves", "correct": True, "partial": 1, "ms": 1000},
                {"item_path": f"{WAVES}#wavefront-def", "correct": False, "partial": 0, "ms": 1000},
            ]
        },
    ).raise_for_status()
    httpx.post(
        f"{live_server}/api/lessons/{WAVES}/complete", json={"xp": 12, "timezone": tz}
    ).raise_for_status()
    page.goto(live_server + "/me")
    expect(page.get_by_role("heading", level=1)).to_have_text("Profile")
    expect(page.locator(".donut-value")).to_have_text("12")
    expect(page.locator(".stat-value").first).to_contain_text("1 day")
    expect(page.locator(".xp-col")).to_have_count(30)
    expect(page.locator(".streak-day[data-level='met']").first).to_be_visible()
    expect(page.locator("text=Coverage per course")).to_be_visible()
    expect(page.locator(".meter-row").first).to_contain_text("Demo course")
    expect(page.locator("text=Accuracy per element")).to_be_visible()
    expect(page.locator("text=Weakest items")).to_be_visible()
    expect(page.locator("text=Resonance drops")).to_be_visible()
    expect(page.locator("table.table tbody tr")).to_have_count(7)
    expect(page.locator("#chip-streak [data-value]")).to_have_text("1")


def test_loops_can_be_switched_off(page: Page, live_server: str):
    _settings(live_server, goalChosen=True, combo=False, drops=False, sounds=False, hardMode=False)
    page.goto(live_server + "/l/example/demo/basics/waves")
    page.get_by_role("button", name="Start").click()
    expect(page.locator(".player-combo")).to_be_hidden()
    expect(page.locator(".player-hearts")).to_be_hidden()
    page.goto(live_server + "/me")
    expect(page.get_by_role("heading", level=1)).to_have_text("Profile")
    expect(page.locator("text=Resonance drops")).to_have_count(0)

    # Hard mode on: hearts appear; combo on: the multiplier chip appears.
    _settings(live_server, hardMode=True, combo=True)
    page.goto(live_server + "/l/example/demo/basics/waves")
    page.get_by_role("button", name="Start").click()
    expect(page.locator(".player-hearts")).to_be_visible()
    expect(page.locator(".player-hearts [data-value]")).to_have_text("5")
    expect(page.locator(".player-combo")).to_be_visible()
    # A miss costs a heart.
    page.locator(".player-check").click()  # explanation
    page.locator('.el-option[data-index="1"]').click()
    page.locator(".player-check").click()
    expect(page.locator(".player-hearts [data-value]")).to_have_text("4")
