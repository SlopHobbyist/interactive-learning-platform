"""Element tests (Phase 3), driven through the dev gallery at /dev/elements.

For every example item of every installed element: give a correct answer and a wrong answer and
assert what check() returns; and show that the element is keyboard-operable with visible focus.
The drivers below know each starter element's UI; that knowledge lives here, not in the app.
"""

from __future__ import annotations

import json
import re

import httpx
import pytest
from playwright.sync_api import Locator, Page, expect

pytestmark = pytest.mark.e2e


def _elements(live_server: str) -> list[dict]:
    return httpx.get(f"{live_server}/api/elements").json()


def _examples(live_server: str, type_: str) -> list[dict]:
    return httpx.get(f"{live_server}/api/elements/{type_}/examples").json()


def _card(page: Page, item: dict) -> Locator:
    return page.locator(f'[data-example="{item["type"]}/{item["id"]}"]')


def _result(card: Locator) -> dict:
    out = card.locator(".gallery-result")
    expect(out).to_be_visible()
    return json.loads(out.inner_text())


def _check(card: Locator) -> dict:
    btn = card.locator('[data-action="check"]')
    expect(btn).to_be_enabled()
    btn.click()
    return _result(card)


def _reset(card: Locator) -> None:
    card.locator('[data-action="reset"]').click()
    expect(card.locator(".gallery-result")).to_be_hidden()


# ------------------------------------------------------------------ drivers
# Each driver answers the item; `correct` says whether to give the right answer.


def drive_multiple_choice(card: Locator, item: dict, correct: bool) -> None:
    answers = item["answer"] if isinstance(item["answer"], list) else [item["answer"]]
    if correct:
        picks = answers
    else:
        picks = [i for i in range(len(item["choices"])) if i not in answers][:1]
    for i in picks:
        card.locator(f'.el-option[data-index="{i}"]').click()


def drive_true_false(card: Locator, item: dict, correct: bool) -> None:
    value = item["answer"] if correct else not item["answer"]
    card.locator(f'.el-option[data-value="{str(value).lower()}"]').click()


def drive_fill_blank(card: Locator, item: dict, correct: bool) -> None:
    accepted = [a if isinstance(a, list) else [a] for a in item["answers"]]
    if "bank" in item:
        if not correct:
            distractor = next(w for w in item["bank"] if all(w not in a for a in accepted))
            card.locator(f'.el-bank .chip[data-word="{distractor}"]').click()
            # fill the remaining blanks correctly so the item is "ready"
            for alts in accepted[1:]:
                card.locator(f'.el-bank .chip[data-word="{alts[0]}"]').click()
        else:
            for alts in accepted:
                card.locator(f'.el-bank .chip[data-word="{alts[0]}"]').click()
    else:
        inputs = card.locator("input.el-blank")
        for i, alts in enumerate(accepted):
            inputs.nth(i).fill(alts[0] if correct or i > 0 else "zzz")


def drive_short_answer(card: Locator, item: dict, correct: bool) -> None:
    if correct:
        text = (
            item["answers"][0] if item.get("answers") else "4"
        )  # the regex example accepts 2/4/6/8
    else:
        text = "definitely wrong"
    card.locator(".el-input").fill(text)


def drive_numeric(card: Locator, item: dict, correct: bool) -> None:
    value = item["answer"] if correct else item["answer"] * 10 + 1000
    card.locator(".el-input").fill(str(value))


def drive_match_pairs(card: Locator, item: dict, correct: bool) -> None:
    n = len(item["pairs"])
    if not correct:
        card.locator('.el-pair[data-side="left"][data-index="0"]').click()
        card.locator(f'.el-pair[data-side="right"][data-index="{n - 1}"]').click()
    for i in range(n):
        card.locator(f'.el-pair[data-side="left"][data-index="{i}"]').click()
        card.locator(f'.el-pair[data-side="right"][data-index="{i}"]').click()
    # auto-submits when all pairs are matched


def _order_indexes(card: Locator) -> list[int]:
    return [
        int(v)
        for v in card.locator(".sortable-item").evaluate_all("els => els.map(e => e.dataset.index)")
    ]


def drive_order(card: Locator, item: dict, correct: bool) -> None:
    """Sort with the keyboard: Space grabs a handle, arrows move it, Space drops it."""
    n = len(item["steps"])
    target = list(range(n)) if correct else [n - 1, *range(n - 1)]
    for pos, want in enumerate(target):
        current = _order_indexes(card)
        at = current.index(want)
        if at == pos:
            continue
        # The row moves in the DOM on every arrow press, so resolve the handle once and
        # drive the keyboard directly rather than re-querying by position.
        handle = card.locator(".sortable-item").nth(at).locator(".sortable-handle")
        handle.focus()
        keyboard = card.page.keyboard
        keyboard.press("Space")
        for _ in range(at - pos):
            keyboard.press("ArrowUp")
        keyboard.press("Space")
    assert _order_indexes(card) == target


def drive_flashcard(card: Locator, item: dict, correct: bool) -> None:
    card.get_by_role("button", name="Show answer").click()
    expect(card.locator(".el-card-back")).to_be_visible()
    card.locator(f'.el-rate[data-rating="{"good" if correct else "again"}"]').click()
    # self-graded: rating submits


def drive_code(card: Locator, item: dict, correct: bool) -> None:
    """Type the solution (or a wrong program), Run, and wait for the tests to settle."""
    editor = card.locator(".code-editor-input")
    code = item.get("solution") or item.get("starter") or ""
    if not correct:
        code = "print('wrong')" if item["language"] == "python" else "console.log('wrong')"
    editor.fill(code)
    card.get_by_role("button", name="Run").click()
    expect(card.locator(".code-status")).to_contain_text("tests pass", timeout=90_000)


DRIVERS = {
    "code": drive_code,
    "multiple-choice": drive_multiple_choice,
    "true-false": drive_true_false,
    "fill-blank": drive_fill_blank,
    "short-answer": drive_short_answer,
    "numeric": drive_numeric,
    "match-pairs": drive_match_pairs,
    "order": drive_order,
    "flashcard": drive_flashcard,
}
SELF_SUBMITTING = {"match-pairs", "flashcard"}


def _all_examples(live_server: str) -> list[tuple[dict, dict]]:
    out = []
    for m in _elements(live_server):
        for item in _examples(live_server, m["type"]):
            out.append((m, item))
    return out


@pytest.fixture(scope="module")
def cases(live_server: str):
    return _all_examples(live_server)


@pytest.fixture()
def gallery(page: Page, live_server: str):
    page.set_viewport_size({"width": 1100, "height": 900})
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(live_server + "/dev/elements")
    expect(page.get_by_role("heading", level=1)).to_have_text("Element gallery")
    yield page
    assert errors == [], errors


def test_every_starter_element_is_installed_with_examples(cases):
    types = {m["type"] for m, _ in cases}
    assert types == {
        "code",
        "explanation",
        "multiple-choice",
        "true-false",
        "fill-blank",
        "short-answer",
        "numeric",
        "match-pairs",
        "order",
        "flashcard",
    }
    for m, _ in cases:
        assert m["module"].startswith("/elements/")


def test_every_example_mounts_without_error(gallery: Page, cases):
    for m, item in cases:
        card = _card(gallery, item)
        expect(card).to_be_visible()
        expect(card.locator(".alert-warning")).to_have_count(0)
        if not m["graded"]:
            expect(card.locator('[data-role="ready"]')).to_have_text("ungraded")


def test_every_example_correct_and_wrong(gallery: Page, cases):
    for m, item in cases:
        if not m["graded"]:
            continue
        driver = DRIVERS[m["type"]]
        card = _card(gallery, item)
        card.scroll_into_view_if_needed()

        driver(card, item, correct=True)
        res = _result(card) if m["type"] in SELF_SUBMITTING else _check(card)
        assert res["result"]["correct"] is True, (item["id"], res)
        assert res["result"].get("partial", 1) == 1 or m["type"] == "flashcard", (item["id"], res)

        _reset(card)
        driver(card, item, correct=False)
        res = _result(card) if m["type"] in SELF_SUBMITTING else _check(card)
        assert res["result"]["correct"] is False, (item["id"], res)
        if m["type"] not in ("flashcard", "match-pairs"):
            assert "correct_answer_html" in res["result"], item["id"]
        # The locked state shows a result fill somewhere in the element.
        expect(
            card.locator(".is-wrong, .is-invalid, .is-locked, .el-rate[aria-pressed='true']").first
        ).to_be_visible()


def _fill_typed(card: Locator, words: list[str]) -> dict:
    inputs = card.locator("input.el-blank")
    for i, w in enumerate(words):
        inputs.nth(i).fill(w)
    return _check(card)


def test_fill_blank_order(gallery: Page, cases):
    """ordered (the default) needs each answer in its blank; ordered: false takes any order."""
    by_id = {item["id"]: item for m, item in cases if m["type"] == "fill-blank"}
    ordered = _card(gallery, by_id["two-blanks"])
    res = _fill_typed(ordered, ["Madrid", "Paris"])
    assert res["result"]["correct"] is False, res

    any_order = _card(gallery, by_id["any-order"])
    res = _fill_typed(any_order, ["Blue", "red", "green"])
    assert res["result"]["correct"] is True, res

    _reset(any_order)
    res = _fill_typed(any_order, ["red", "red", "blue"])  # an answer counts once
    assert res["result"]["correct"] is False, res
    assert res["result"]["blanks"] == [True, False, True], res
    expect(any_order.locator("input.el-blank").nth(1)).to_have_attribute("title", "Expected: green")


def test_keyboard_operability(gallery: Page, cases):
    """Number keys pick options; typed fields take focus; Tab reaches every control."""
    by_type = {m["type"]: item for m, item in cases}
    page = gallery

    mc = _card(page, by_type["multiple-choice"])
    mc.locator(".el-option").first.focus()
    page.keyboard.press("2")
    expect(mc.locator("input:checked")).to_have_count(1)
    expect(mc.locator(".el-option").nth(1).locator("input")).to_be_checked()
    expect(mc.locator('[data-action="check"]')).to_be_enabled()

    tf = _card(page, by_type["true-false"])
    tf.locator(".el-option").first.focus()
    page.keyboard.press("2")
    expect(tf.locator('.el-option[aria-pressed="true"]')).to_have_count(1)

    fb = _card(page, by_type["fill-blank"])
    fb.locator("input.el-blank").first.focus()
    page.keyboard.type("Hola")
    expect(fb.locator('[data-action="check"]')).to_be_enabled()

    mp = _card(page, by_type["match-pairs"])
    mp.locator(".el-pair").first.focus()
    page.keyboard.press("1")
    expect(mp.locator('.el-pair[data-side="left"][aria-pressed="true"]')).to_have_count(1)

    fc = _card(page, by_type["flashcard"])
    fc.get_by_role("button", name="Show answer").focus()
    page.keyboard.press("Space")
    expect(fc.locator(".el-card-back")).to_be_visible()
    page.keyboard.press("3")
    expect(fc.locator(".gallery-result")).to_be_visible()

    od = _card(page, by_type["order"])
    handle = od.locator(".sortable-handle").first
    handle.focus()
    before = _order_indexes(od)
    page.keyboard.press("Space")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Space")
    assert _order_indexes(od) != before

    # Visible focus: the focused control gets the kit's focus ring (outline) or the
    # option's outline rule from app.css.
    mc.locator(".el-option").first.locator("input").focus()
    outline = page.evaluate(
        "() => { const l = document.activeElement.closest('.el-option'); "
        "return getComputedStyle(l).outlineStyle; }"
    )
    assert outline not in ("none", ""), outline


def test_missing_element_shows_fallback_not_crash(page: Page, live_server: str):
    """An item whose element is not installed renders a skip card and the page keeps working."""
    page.goto(live_server + "/dev/elements?type=explanation")
    fallback = page.evaluate(
        """async () => {
          const { mountItem } = await import('/js/lib/elements.js');
          const root = document.createElement('div');
          document.body.append(root);
          const r = await mountItem(root, { type: 'no-such-element', id: 'x' }, {});
          return { text: root.textContent, graded: r.manifest.graded, check: r.handle.check(null) };
        }"""
    )
    assert "not installed" in fallback["text"]
    assert fallback["graded"] is False
    assert fallback["check"]["correct"] is True and fallback["check"]["skipped"] is True
    assert re.search(r"explanation", page.locator("h2.view-section-title").first.inner_text())
