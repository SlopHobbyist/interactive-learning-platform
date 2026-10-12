"""Lesson player tests (Phase 4): a full lesson by mouse (with a deliberate mistake and the
re-queue), by keyboard only, and by touch emulation."""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import Browser, Page, expect

pytestmark = pytest.mark.e2e

WAVES = "/l/example/demo/basics/waves"
TYPING = "/l/example/demo/basics/typing"


def _start(page: Page, live_server: str, path: str) -> None:
    page.goto(live_server + path)
    expect(page.locator(".player")).to_have_attribute("data-state", "intro")
    page.get_by_role("button", name="Start").click()
    expect(page.locator(".player")).to_have_attribute("data-state", "item")


def _counter(page: Page) -> str:
    return page.locator(".player-counter").inner_text()


def test_lesson_by_mouse_with_a_mistake_and_requeue(page: Page, live_server: str):
    page.set_viewport_size({"width": 390, "height": 780})
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    _start(page, live_server, WAVES)
    player = page.locator(".player")
    check = page.locator(".player-check")

    # 1/5 explanation → Continue (no feedback sheet)
    assert _counter(page).startswith("1 / 5")
    expect(check).to_have_text("Continue")
    check.click()

    # 2/5 multiple choice: deliberately wrong
    assert _counter(page).startswith("2 / 5")
    expect(check).to_be_disabled()
    page.locator('.el-option[data-index="1"]').click()
    expect(check).to_be_enabled()
    check.click()
    expect(player).to_have_attribute("data-state", "feedback")
    sheet = page.locator(".player-sheet")
    expect(sheet).to_have_attribute("data-open", "true")
    expect(sheet).to_have_class(re.compile(r"(^| )is-wrong( |$)"))
    expect(sheet.locator(".player-sheet-title")).to_have_text("Not quite")
    expect(sheet.locator(".player-sheet-answer")).to_contain_text("Energy")
    expect(page.locator('.el-option[data-index="1"]')).to_have_class(
        re.compile(r"(^| )is-wrong( |$)")
    )
    page.get_by_role("button", name="Continue").click()
    expect(sheet).to_have_attribute("data-open", "false")

    # 3/5 true/false: right
    assert _counter(page).startswith("2 / 5")  # the wrong item is not complete, so the count stays
    page.locator('.el-option[data-value="true"]').click()
    check.click()
    expect(sheet.locator(".player-sheet-title")).to_have_text("Correct!")
    expect(sheet.locator(".chip-primary")).to_contain_text("XP")
    page.get_by_role("button", name="Continue").click()

    # 4/5 multi-select: right
    for i in (0, 1, 2):
        page.locator(f'.el-option[data-index="{i}"]').click()
    check.click()
    expect(sheet.locator(".player-sheet-title")).to_have_text("Correct!")
    page.get_by_role("button", name="Continue").click()

    # 5/5 explanation
    expect(check).to_have_text("Continue")
    check.click()

    # Retry round for the missed item
    expect(player).to_have_attribute("data-state", "retry")
    expect(page.locator(".player-card h2")).to_contain_text("try those again")
    page.get_by_role("button", name="Let’s go").click()
    assert "retry" in _counter(page)
    page.locator('.el-option[data-index="0"]').click()
    check.click()
    expect(sheet.locator(".player-sheet-title")).to_contain_text("Correct")
    page.get_by_role("button", name="Continue").click()

    # Summary
    expect(player).to_have_attribute("data-state", "summary")
    expect(page.locator(".player-card h2")).to_have_text("Lesson complete")
    stats = page.locator(".player-stats .stat-value")
    expect(stats.nth(1)).to_have_text("67%")  # 2 of 3 graded items right first time
    expect(page.locator(".player-progress")).to_have_attribute("aria-valuenow", "100")
    expect(page.locator(".player-card")).to_contain_text("1 miss")

    # Back on the course page the lesson is complete and the next one is available.
    page.get_by_role("link", name="Continue").click()
    expect(page).to_have_url(live_server + "/c/example/demo")
    rows = page.locator(".lesson-row")
    expect(rows.nth(0)).to_have_attribute("data-state", "complete")
    expect(rows.nth(1)).to_have_attribute("data-state", "available")
    assert errors == [], errors


def test_lesson_by_keyboard_only(page: Page, live_server: str):
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(live_server + TYPING)
    kb = page.keyboard
    player = page.locator(".player")
    sheet = page.locator(".player-sheet")
    title = sheet.locator(".player-sheet-title")
    check = page.locator(".player-check")

    def checked(expected: str) -> None:
        expect(sheet).to_have_attribute("data-open", "true")
        expect(title).to_contain_text(expected)
        # Focus moves to Continue once the sheet has slid up.
        expect(sheet.get_by_role("button", name="Continue")).to_be_focused()

    def proceed() -> None:
        kb.press("Enter")  # Continue is focused while the sheet is open
        expect(sheet).to_have_attribute("data-open", "false")

    # Start is focused on load
    expect(page.get_by_role("button", name="Start")).to_be_focused()
    kb.press("Enter")
    expect(player).to_have_attribute("data-state", "item")

    expect(check).to_have_text("Continue")
    expect(check).to_be_enabled()
    kb.press("Enter")  # explanation → continue

    # typed blank: focus lands in the input; Enter in the field checks
    expect(page.locator("input.el-blank")).to_be_focused()
    kb.type("energy")
    kb.press("Enter")
    checked("Correct")
    proceed()

    # word bank: focus the right chips and activate them with Enter, then Tab to Check
    page.get_by_role("button", name="wavefront", exact=True).focus()
    kb.press("Enter")
    page.get_by_role("button", name="wavelength", exact=True).focus()
    kb.press("Enter")
    expect(check).to_be_enabled()
    check.focus()
    kb.press("Enter")
    checked("Correct")
    proceed()

    # short answer
    expect(page.locator(".el-input")).to_be_focused()
    kb.type("Hertz")
    kb.press("Enter")
    checked("Correct")
    proceed()

    # numeric ×2
    expect(page.locator(".el-input")).to_be_focused()
    kb.type("10")
    kb.press("Enter")
    checked("Correct")
    proceed()
    expect(page.locator(".el-input")).to_be_focused()
    kb.type("340")  # within 5 %
    kb.press("Enter")
    checked("Correct")
    proceed()

    expect(player).to_have_attribute("data-state", "summary")
    expect(page.locator(".player-card h2")).to_have_text("Perfect!")
    expect(page.locator(".player-stats .stat-value").nth(1)).to_have_text("100%")


def test_lesson_by_touch(browser: Browser, live_server: str):
    context = browser.new_context(
        viewport={"width": 390, "height": 780}, has_touch=True, is_mobile=True
    )
    page = context.new_page()
    try:
        page.goto(live_server + WAVES)
        page.get_by_role("button", name="Start").tap()
        check = page.locator(".player-check")
        check.tap()  # explanation
        page.locator('.el-option[data-index="0"]').tap()
        check.tap()
        page.get_by_role("button", name="Continue").tap()
        page.locator('.el-option[data-value="true"]').tap()
        check.tap()
        page.get_by_role("button", name="Continue").tap()
        for i in (0, 1, 2):
            page.locator(f'.el-option[data-index="{i}"]').tap()
        check.tap()
        page.get_by_role("button", name="Continue").tap()
        check.tap()  # last explanation
        expect(page.locator(".player")).to_have_attribute("data-state", "summary")
        expect(page.locator(".player-card h2")).to_have_text("Perfect!")
        # The topbar is hidden on phones while playing.
        expect(page.locator("#app-topbar")).to_be_hidden()
    finally:
        context.close()


def test_quit_returns_to_course(page: Page, live_server: str):
    _start(page, live_server, WAVES)
    page.get_by_role("link", name="Quit lesson").click()
    expect(page).to_have_url(live_server + "/c/example/demo")
