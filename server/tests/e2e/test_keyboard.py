"""Keyboard-only journeys: every lesson in the demo course, the map, and the code editor.

The rule these tests hold the app to: a keyboard user never gets stuck. Input is page.keyboard
only (no clicks, no locator.focus(), no Tab to get back in), and after every step focus must be
somewhere useful, never stranded on <body> where no shortcut reaches anything. Tab appears only
where it is ordinary navigation to a control, never as a way out.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

pytestmark = pytest.mark.e2e

WAVES = "/l/example/demo/basics/waves"
TYPING = "/l/example/demo/basics/typing"
MATCHING = "/l/example/demo/practice/matching"
REVIEW = "/l/example/demo/practice/review"
CODE = "/l/coding/intro/basics/write-code"  # a test fixture


def held(page: Page) -> None:
    """Focus is on a real control (the focus keeper restores it within a tick)."""
    page.wait_for_function(
        "() => document.activeElement && document.activeElement !== document.body", timeout=2000
    )


def active(page: Page, prop: str) -> str | None:
    return page.evaluate(f"() => document.activeElement.{prop}")


def start(page: Page, live_server: str, path: str) -> None:
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(live_server + path)
    expect(page.get_by_role("button", name="Start")).to_be_focused()
    page.keyboard.press("Enter")
    expect(page.locator(".player")).to_have_attribute("data-state", "item")
    held(page)


def answer_then_continue(page: Page, expected: str = "Correct") -> None:
    """The item was answered: Enter checks, the sheet shows `expected`, Enter continues."""
    sheet = page.locator(".player-sheet")
    expect(sheet).to_have_attribute("data-open", "true")
    expect(sheet.locator(".player-sheet-title")).to_contain_text(expected)
    expect(sheet.get_by_role("button", name="Continue")).to_be_focused()
    page.keyboard.press("Enter")
    expect(sheet).to_have_attribute("data-open", "false")
    held(page)


def key_of(page: Page, selector: str) -> str:
    return page.locator(selector).locator(".el-key").inner_text().strip()


def test_waves_lesson_and_back_to_the_map(page: Page, live_server: str):
    start(page, live_server, WAVES)
    kb = page.keyboard
    kb.press("Enter")  # explanation

    # multiple choice: the number key picks, Enter checks
    kb.press(key_of(page, '.el-option[data-index="0"]'))
    kb.press("Enter")
    answer_then_continue(page)

    # true/false: focus starts on True, but unseen (no ring) until the learner moves it, and
    # Enter does not press what they cannot see. Arrowing there makes it theirs: Enter picks
    # it, Enter on the picked option checks.
    true_btn = page.locator('.el-option[data-value="true"]')
    expect(true_btn).to_be_focused()
    kb.press("Enter")
    expect(true_btn).to_have_attribute("aria-pressed", "false")
    kb.press("ArrowRight")
    kb.press("ArrowLeft")
    expect(true_btn).to_be_focused()
    kb.press("Enter")
    expect(page.locator('.el-option[data-value="true"]')).to_have_attribute("aria-pressed", "true")
    kb.press("Enter")
    answer_then_continue(page)

    # select-all multiple choice: arrows walk the checkboxes, Space ticks, Enter checks
    options = page.locator(".el-option")
    for pos in range(options.count()):
        if options.nth(pos).get_attribute("data-index") in ("0", "1", "2"):
            kb.press("Space")
        kb.press("ArrowDown")
    expect(page.locator(".el-option input:checked")).to_have_count(3)
    kb.press("Enter")
    answer_then_continue(page)

    kb.press("Enter")  # closing explanation
    expect(page.locator(".player")).to_have_attribute("data-state", "summary")
    expect(page.get_by_role("link", name="Continue")).to_be_focused()

    # Back on the map, focus waits on Continue: Enter goes straight into the next lesson.
    kb.press("Enter")
    expect(page).to_have_url(live_server + "/c/example/demo")
    expect(page.locator('[data-action="continue"]')).to_be_focused()
    # The map's single tab stop is the frontier tile, not the finished first one.
    expect(page.locator('.map-tile[tabindex="0"]')).to_have_attribute("data-key", "basics/typing")
    kb.press("Enter")
    expect(page).to_have_url(live_server + TYPING)
    expect(page.get_by_role("button", name="Start")).to_be_focused()


def test_matching_lesson(page: Page, live_server: str):
    start(page, live_server, MATCHING)
    kb = page.keyboard

    # match-pairs with Enter and arrows only: picking a left option moves focus to the right
    # column, a match hands focus to the next open left option. An arrow first, as a keyboard
    # navigator would: Enter only presses an option the learner moved to.
    expect(page.locator('.el-pair[data-side="left"]').first).to_be_focused()
    kb.press("ArrowDown")
    for _ in range(4):
        assert active(page, "dataset.side") == "left"
        want = active(page, "dataset.index")
        kb.press("Enter")
        held(page)
        assert active(page, "dataset.side") == "right"
        for _ in range(4):
            if active(page, "dataset.index") == want:
                break
            kb.press("ArrowDown")
        assert active(page, "dataset.index") == want
        kb.press("Enter")
        held(page)  # the matched pair locks; focus must not go down with it
    answer_then_continue(page)  # the last match submits by itself

    # order: Up/Down choose a row, Space lifts, Up/Down move it, Space drops, Enter checks.
    def order() -> list[int]:
        return [
            int(i)
            for i in page.eval_on_selector_all(
                ".sortable-item", "els => els.map(e => e.dataset.index)"
            )
        ]

    def focused_row() -> int:
        return page.evaluate(
            "() => [...document.querySelectorAll('.sortable-handle')].indexOf(document.activeElement)"
        )

    expect(page.locator(".sortable-handle").first).to_be_focused()
    for target in range(4):
        pos = order().index(target)
        while focused_row() < pos:
            kb.press("ArrowDown")
        while focused_row() > pos:
            kb.press("ArrowUp")
        kb.press("Space")
        for _ in range(pos - target):
            kb.press("ArrowUp")
        kb.press("Space")
        assert order()[target] == target
    kb.press("Enter")
    answer_then_continue(page)

    # match-pairs with the number and letter keys
    lefts = page.locator('.el-pair[data-side="left"]')
    rights = page.locator('.el-pair[data-side="right"]')
    right_idx = [rights.nth(i).get_attribute("data-index") for i in range(rights.count())]
    for p in range(lefts.count()):
        kb.press(str(p + 1))
        kb.press(chr(97 + right_idx.index(lefts.nth(p).get_attribute("data-index"))))
        held(page)
    answer_then_continue(page)
    expect(page.locator(".player")).to_have_attribute("data-state", "summary")


def test_typing_lesson_word_bank_toggles(page: Page, live_server: str):
    start(page, live_server, TYPING)
    kb = page.keyboard
    kb.press("Enter")  # explanation
    kb.type("energy")
    kb.press("Enter")
    answer_then_continue(page)

    words = page.locator(".el-bank .chip").all_inner_texts()
    one = str(words.index("wavefront") + 1)
    two = str(words.index("wavelength") + 1)
    kb.press(one)
    chip = page.locator(".el-bank .chip").nth(int(one) - 1)
    expect(chip).to_be_focused()
    expect(chip).to_have_attribute("aria-pressed", "true")
    kb.press(one)  # pressing a placed word returns it to the bank
    expect(chip).to_have_attribute("aria-pressed", "false")
    expect(page.locator(".el-slot").first).to_have_text("")
    kb.press(one)
    kb.press(two)
    kb.press("Enter")  # on the placed chip: checks
    answer_then_continue(page)


def test_review_lesson_flashcards(page: Page, live_server: str):
    start(page, live_server, REVIEW)
    kb = page.keyboard

    # The hint button disables itself; focus moves on to "Show answer" first.
    expect(page.get_by_role("button", name="Show answer")).to_be_focused()
    kb.press("Tab")  # ordinary navigation to the next control
    expect(page.get_by_role("button", name="Hint")).to_be_focused()
    kb.press("Enter")
    expect(page.locator(".el-card-hint")).to_be_visible()
    expect(page.get_by_role("button", name="Show answer")).to_be_focused()
    kb.press("Enter")  # flip; focus goes to "Good"
    expect(page.locator('.el-rate[data-rating="good"]')).to_be_focused()
    kb.press("Enter")
    answer_then_continue(page)

    kb.press("Space")  # flip
    kb.press("3")  # rate Good
    answer_then_continue(page)

    kb.press("1")  # unshuffled multiple choice
    kb.press("Enter")
    answer_then_continue(page)

    kb.press("2")  # False
    kb.press("Enter")
    answer_then_continue(page)

    kb.type("frequency")
    kb.press("Enter")
    answer_then_continue(page)
    expect(page.locator(".player")).to_have_attribute("data-state", "summary")


def test_keys_still_work_after_clicking_away(page: Page, live_server: str):
    """A click on lesson text parks focus on the item container (or drops it to <body>); the
    next key still reaches the lesson instead of needing a click on a control or a Tab."""
    start(page, live_server, WAVES)
    kb = page.keyboard
    kb.press("Enter")  # explanation

    page.locator(".el-prompt").click()  # read the question with the mouse...
    kb.press(key_of(page, '.el-option[data-index="0"]'))  # ...answer with the keyboard
    expect(page.locator('.el-option[data-index="0"] input')).to_be_checked()
    page.locator(".el-prompt").click()
    kb.press("Enter")
    sheet = page.locator(".player-sheet")
    expect(sheet).to_have_attribute("data-open", "true")
    page.locator(".player-sheet-title").click()  # plain text in the sheet: focus leaves Continue
    assert active(page, "tagName") in ("BODY", "MAIN")
    kb.press("Enter")
    expect(sheet).to_have_attribute("data-open", "false")
    held(page)

    # typed letters land in the field, as if it had been focused all along
    start(page, live_server, TYPING)
    kb.press("Enter")  # explanation
    expect(page.locator("input.el-blank")).to_be_focused()
    page.locator(".player-counter").click()
    kb.type("energy")
    expect(page.locator("input.el-blank")).to_have_value("energy")


def test_code_editor_lets_the_keyboard_out(page: Page, live_server: str):
    start(page, live_server, CODE)
    kb = page.keyboard
    kb.press("Enter")  # explanation
    editor = page.locator(".code-editor-input")
    expect(editor).to_be_focused()

    kb.press("Tab")  # Tab indents
    expect(editor).to_be_focused()
    assert editor.input_value().endswith("    ")  # at the caret, the end of the starter
    kb.press("Escape")
    kb.press("Tab")  # Esc then Tab leaves
    expect(page.get_by_role("button", name="Run")).to_be_focused()
    kb.press("Shift+Tab")
    expect(editor).to_be_focused()

    kb.press("Control+a")
    kb.insert_text('name = input()\nprint(f"Hello, {name}!")\n')
    kb.press("Control+Enter")  # runs (Python loads on first use)
    expect(page.locator(".code-status")).to_contain_text("2 / 2 tests pass", timeout=120_000)
    expect(editor).to_be_focused()
    kb.press("Control+Enter")  # this code has run: submits
    answer_then_continue(page)


def ring(page: Page) -> str:
    """The outline colour on the focused control (or its option label)."""
    return page.evaluate(
        "() => { const a = document.activeElement; const n = a.closest('.el-option') || a;"
        " return getComputedStyle(n).outlineColor; }"
    )


def test_shortcut_keys_show_no_focus_ring(page: Page, live_server: str):
    """Typing 1 then a moves focus on to the next open pair, but shows no ring there: the
    learner did not move it. Tab or an arrow brings rings back."""
    start(page, live_server, MATCHING)
    kb = page.keyboard
    lefts = page.locator('.el-pair[data-side="left"]')
    rights = page.locator('.el-pair[data-side="right"]')
    expect(lefts.first).to_be_focused()  # mounted
    right_idx = [rights.nth(i).get_attribute("data-index") for i in range(rights.count())]
    kb.press("1")
    kb.press(chr(97 + right_idx.index(lefts.nth(0).get_attribute("data-index"))))
    expect(lefts.nth(0)).to_be_disabled()  # matched
    held(page)
    assert active(page, "dataset.side") == "left"
    assert page.evaluate("document.documentElement.hasAttribute('data-keyboard-nav')") is False
    assert ring(page) == "rgba(0, 0, 0, 0)"

    kb.press("ArrowDown")  # moving focus on purpose: the ring shows
    assert page.evaluate("document.documentElement.hasAttribute('data-keyboard-nav')") is True
    assert ring(page) != "rgba(0, 0, 0, 0)"
    kb.press("2")  # a shortcut again: hidden
    assert ring(page) == "rgba(0, 0, 0, 0)"


def test_keys_reach_the_lesson_from_anywhere_in_the_window(page: Page, live_server: str):
    """After a click on the theme toggle or Check, typed keys still answer the item, and Enter
    checks instead of pressing the clicked button again."""
    start(page, live_server, WAVES)
    kb = page.keyboard
    kb.press("Enter")  # explanation
    html = page.locator("html")
    theme = html.get_attribute("data-theme")
    toggle = page.locator("[data-theme-toggle]")

    toggle.click()
    toggle.click()  # back to the original theme; focus stays on the toggle
    expect(html).to_have_attribute("data-theme", theme)
    expect(toggle).to_be_focused()
    kb.press(key_of(page, '.el-option[data-index="0"]'))
    expect(page.locator('.el-option[data-index="0"] input')).to_be_checked()
    toggle.focus()  # as after another click on it
    kb.press("Enter")
    expect(page.locator(".player-sheet")).to_have_attribute("data-open", "true")
    expect(html).to_have_attribute("data-theme", theme)  # Enter did not toggle the theme
    answer_then_continue(page)

    # true/false: click Check-adjacent chrome (the progress bar), then answer by key
    page.locator(".player-progress").click()
    kb.press("1")
    kb.press("Enter")
    answer_then_continue(page)
