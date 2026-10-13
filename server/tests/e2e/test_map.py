"""The Wavefront map and review (Phase 6): decay at +30 days, review restoring strength,
keyboard navigation, the unlock wave, and an axe accessibility check."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Page, expect

pytestmark = pytest.mark.e2e

AXE = Path(__file__).parent / "assets" / "axe.min.js"
WAVES = "example/demo/basics/waves"
TYPING = "example/demo/basics/typing"


def _complete(live_server: str, lesson: str, items: list[str], now: str | None = None) -> None:
    q = f"?now={now}" if now else ""
    httpx.post(
        f"{live_server}/api/attempts{q}",
        json={
            "attempts": [
                {"item_path": f"{lesson}#{i}", "correct": True, "partial": 1, "ms": 1500}
                for i in items
            ]
        },
    ).raise_for_status()
    httpx.post(
        f"{live_server}/api/lessons/{lesson}/complete{q}", json={"xp": 10}
    ).raise_for_status()


def _set_dev_now(page: Page, offset: str) -> None:
    page.evaluate(
        "(o) => { const s = JSON.parse(localStorage.getItem('ilp-settings') || '{}'); "
        "s.devNow = o; "
        "localStorage.setItem('ilp-settings', JSON.stringify(s)); }",
        offset,
    )


def test_map_states_and_decay(page: Page, live_server: str):
    _complete(live_server, WAVES, ["what-moves", "wavefront-def", "wave-types"])
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(live_server + "/c/example/demo")
    tiles = page.locator(".map-tile")
    expect(tiles).to_have_count(4)
    waves = page.locator('.map-tile[data-key="basics/waves"]')
    expect(waves).to_have_attribute("data-state", "complete")
    expect(waves).to_have_attribute("data-step", "fresh")
    expect(page.locator('.map-tile[data-key="basics/typing"]')).to_have_attribute(
        "data-state", "available"
    )
    expect(page.locator('.map-tile[data-key="practice/matching"]')).to_have_attribute(
        "data-state", "locked"
    )
    expect(page.locator('.map-tile[data-key="practice/matching"]')).to_have_attribute(
        "aria-disabled", "true"
    )
    assert "strength 100%" in waves.get_attribute("aria-label")
    cov = int(page.locator("[data-coverage]").get_attribute("data-coverage"))
    assert cov == 25  # one fresh tile of four
    expect(page.locator('[data-action="review"]')).to_contain_text("Review")
    expect(page.locator('[data-action="review"]')).not_to_contain_text("due")

    # Thirty days later the tile has faded through the steps and items are due.
    _set_dev_now(page, "+30d")
    page.reload()
    waves = page.locator('.map-tile[data-key="basics/waves"]')
    expect(waves).to_have_attribute("data-state", "complete")
    assert waves.get_attribute("data-step") in ("faint", "fading")
    expect(page.locator('[data-action="review"]')).to_contain_text("due")
    assert int(page.locator("[data-coverage]").get_attribute("data-coverage")) < cov

    # Tapping the faded tile starts a re-tune of that tile.
    waves.click()
    expect(page).to_have_url(live_server + "/review/example/demo?lesson=basics%2Fwaves")
    expect(page.locator(".player-card h2")).to_contain_text("Re-tune")

    # Play the review (3 MC/TF items); strength is restored at +30d.
    page.get_by_role("button", name="Start review").click()
    for _ in range(3):
        card = page.locator(".player-element")
        card.locator(".el-option").first.wait_for()
        kind, answer = _current_item(page)
        if kind == "true-false":
            card.locator(f'.el-option[data-value="{str(answer).lower()}"]').click()
        else:  # multiple choice, single or multi
            for i in answer if isinstance(answer, list) else [answer]:
                card.locator(f'.el-option[data-index="{i}"]').click()
        page.locator(".player-check").click()
        page.get_by_role("button", name="Continue").click()
    expect(page.locator(".player")).to_have_attribute("data-state", "summary")
    expect(page.locator(".player-card h2")).to_have_text("Review done")
    page.get_by_role("link", name="Continue").click()
    expect(page.locator('.map-tile[data-key="basics/waves"]')).to_have_attribute(
        "data-step", "fresh"
    )


def test_retune_offers_relearn(page: Page, live_server: str):
    """A re-tune can instead replay the whole lesson, explanations and all."""
    _complete(live_server, WAVES, ["what-moves", "wavefront-def", "wave-types"])
    page.goto(live_server + "/c/example/demo")
    page.locator('.map-tile[data-key="basics/waves"]').click()
    expect(page.get_by_role("button", name="Start review")).to_be_focused()
    page.get_by_role("link", name="Relearn").click()
    expect(page).to_have_url(live_server + "/l/" + WAVES)
    expect(page.locator(".player")).to_have_attribute("data-mode", "lesson")
    expect(page.locator(".player-card h2")).to_have_text("What is a wave?")
    page.get_by_role("button", name="Start", exact=True).click()
    expect(page.locator(".player-counter")).to_have_text("1 / 5")
    assert _current_item(page)[0] == "explanation"


def _current_item(page: Page) -> tuple[str, object]:
    """The current item's type and correct answer, read from the player's session."""
    data = page.evaluate(
        "() => { const s = document.querySelector('.player').session; "
        "return [s.current.item.type, s.current.item.answer]; }"
    )
    return data[0], data[1]


def test_wave_animation_after_completion(page: Page, live_server: str):
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(live_server + "/l/example/demo/basics/waves")
    page.get_by_role("button", name="Start").click()
    check = page.locator(".player-check")
    check.click()  # explanation
    page.locator('.el-option[data-index="0"]').click()
    check.click()
    page.get_by_role("button", name="Continue").click()
    page.locator('.el-option[data-value="true"]').click()
    check.click()
    page.get_by_role("button", name="Continue").click()
    for i in (0, 1, 2):
        page.locator(f'.el-option[data-index="{i}"]').click()
    check.click()
    page.get_by_role("button", name="Continue").click()
    check.click()  # last explanation
    expect(page.locator(".player")).to_have_attribute("data-state", "summary")
    page.get_by_role("link", name="Continue").click()
    expect(page).to_have_url(live_server + "/c/example/demo")
    assert "is-source" in page.locator('.map-tile[data-key="basics/waves"]').get_attribute("class")
    typing = page.locator('.map-tile[data-key="basics/typing"]')
    expect(typing).to_have_attribute("data-state", "available")
    assert "is-waking" in typing.get_attribute("class")
    # The note is consumed: a reload shows no animation classes.
    page.reload()
    assert "is-waking" not in page.locator('.map-tile[data-key="basics/typing"]').get_attribute(
        "class"
    )


def test_map_keyboard_navigation(page: Page, live_server: str):
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(live_server + "/c/example/demo")
    first = page.locator(".map-tile").first
    first.focus()
    expect(first).to_be_focused()
    # One tab stop: only one tile has tabindex=0.
    assert page.locator('.map-tile[tabindex="0"]').count() == 1
    page.keyboard.press("ArrowRight")
    expect(page.locator('.map-tile[data-key="basics/typing"]')).to_be_focused()
    page.keyboard.press("ArrowDown")  # the tile straight below "typing"
    expect(page.locator('.map-tile[data-key="practice/review"]')).to_be_focused()
    page.keyboard.press("ArrowLeft")
    expect(page.locator('.map-tile[data-key="practice/matching"]')).to_be_focused()
    page.keyboard.press("ArrowUp")
    expect(page.locator('.map-tile[data-key="basics/waves"]')).to_be_focused()
    page.keyboard.press("End")
    expect(page.locator('.map-tile[data-key="practice/review"]')).to_be_focused()
    assert page.locator('.map-tile[tabindex="0"]').count() == 1
    # Enter on the available tile opens the lesson.
    page.keyboard.press("Home")
    page.keyboard.press("Enter")
    expect(page).to_have_url(live_server + "/l/example/demo/basics/waves")


def test_skip_ahead_opens_locked_tiles(page: Page, live_server: str):
    page.goto(live_server + "/c/example/demo")
    locked = page.locator('.map-tile[data-key="practice/matching"]')
    expect(locked).to_have_attribute("aria-disabled", "true")
    expect(page.get_by_role("checkbox", name="Skip ahead")).not_to_be_checked()
    page.get_by_text("Skip ahead").click()  # the label; the input itself is visually hidden
    locked = page.locator('.map-tile[data-key="practice/matching"]')
    expect(locked).to_have_attribute("data-state", "locked")
    expect(locked).to_have_attribute("href", "/l/example/demo/practice/matching")
    expect(locked).not_to_have_attribute("aria-disabled", "true")
    # The choice is a setting: it survives a reload.
    page.reload()
    expect(page.get_by_role("checkbox", name="Skip ahead")).to_be_checked()
    page.locator('.map-tile[data-key="practice/matching"]').click()
    expect(page).to_have_url(live_server + "/l/example/demo/practice/matching")
    expect(page.locator(".player")).to_have_attribute("data-mode", "lesson")
    # Unchecking locks them again.
    page.goto(live_server + "/c/example/demo")
    page.get_by_text("Skip ahead").click()
    expect(page.get_by_role("checkbox", name="Skip ahead")).not_to_be_checked()
    expect(page.locator('.map-tile[data-key="practice/matching"]')).to_have_attribute(
        "aria-disabled", "true"
    )


def test_map_accessibility_with_axe(page: Page, live_server: str):
    _complete(live_server, WAVES, ["what-moves", "wavefront-def", "wave-types"])
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(live_server + "/c/example/demo")
    expect(page.locator(".map-tile")).to_have_count(4)
    page.add_script_tag(path=str(AXE))
    results = page.evaluate(
        "async () => await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })"
    )
    serious = [v for v in results["violations"] if v["impact"] in ("serious", "critical")]
    assert serious == [], json.dumps(
        [{k: v[k] for k in ("id", "impact", "help")} for v in serious], indent=1
    )
    # Score proxy: passes / (passes + violations) >= 0.95
    score = len(results["passes"]) / max(1, len(results["passes"]) + len(results["violations"]))
    assert score >= 0.95, (score, [v["id"] for v in results["violations"]])
