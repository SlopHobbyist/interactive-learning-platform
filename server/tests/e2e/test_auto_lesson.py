"""Phase 8 "done when": a lesson made only of facts and cloze plays well in the player.
Drives the generated items generically by reading each item from the player's session."""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

pytestmark = pytest.mark.e2e

DATES = "/l/history/revolution/revolution/dates"  # notes + facts + cloze, all auto


def _item(page: Page) -> dict:
    return page.evaluate(
        "() => { const s = document.querySelector('.player').session; "
        "const it = s.current.item; "
        "return { type: it.type, answer: it.answer, answers: it.answers, bank: it.bank, "
        "pairs: it.pairs ? it.pairs.length : 0, steps: it.steps ? it.steps.length : 0 }; }"
    )


def _answer(page: Page, it: dict) -> None:
    host = page.locator(".player-element")
    t = it["type"]
    if t == "explanation":
        return
    if t == "multiple-choice":
        for i in it["answer"] if isinstance(it["answer"], list) else [it["answer"]]:
            host.locator(f'.el-option[data-index="{i}"]').click()
    elif t == "true-false":
        host.locator(f'.el-option[data-value="{str(it["answer"]).lower()}"]').click()
    elif t == "short-answer":
        host.locator(".el-input").fill(it["answers"][0])
    elif t == "fill-blank":
        accepted = [a if isinstance(a, list) else [a] for a in it["answers"]]
        if it.get("bank") is not None:
            for alts in accepted:
                host.locator(f'.el-bank .chip[data-word="{alts[0]}"]').click()
        else:
            inputs = host.locator("input.el-blank")
            for i, alts in enumerate(accepted):
                inputs.nth(i).fill(alts[0])
    elif t == "match-pairs":
        for i in range(it["pairs"]):
            host.locator(f'.el-pair[data-side="left"][data-index="{i}"]').click()
            host.locator(f'.el-pair[data-side="right"][data-index="{i}"]').click()
    else:  # pragma: no cover
        raise AssertionError(f"no driver for {t}")


def test_auto_arranged_lesson_plays_through(page: Page, live_server: str):
    page.set_viewport_size({"width": 1100, "height": 900})
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(live_server + DATES)
    page.get_by_role("button", name="Start").click()
    player = page.locator(".player")
    check = page.locator(".player-check")
    sheet = page.locator(".player-sheet")
    seen: list[str] = []
    for _ in range(60):
        if player.get_attribute("data-state") == "summary":
            break
        page.locator(".player-element .el-prompt, .player-element .el-explanation").first.wait_for()
        it = _item(page)
        seen.append(it["type"])
        _answer(page, it)
        if it["type"] == "explanation":
            check.click()
            continue
        if it["type"] != "match-pairs":  # match-pairs submits itself
            expect(check).to_be_enabled()
            check.click()
        expect(sheet).to_have_attribute("data-open", "true")
        expect(sheet.locator(".player-sheet-title")).to_contain_text("Correct")
        sheet.get_by_role("button", name="Continue").click()
        expect(sheet).to_have_attribute("data-open", "false")
    expect(player).to_have_attribute("data-state", "summary")
    expect(page.locator(".player-card h2")).to_have_text("Perfect!")
    # The generated sequence: explanation, recognition, matching, recall, then cloze (bank, typed).
    assert seen[0] == "explanation"
    assert "multiple-choice" in seen and "match-pairs" in seen
    assert "short-answer" in seen and seen.count("fill-blank") >= 2
    assert seen.index("multiple-choice") < seen.index("match-pairs") < seen.index("short-answer")
    assert errors == [], errors
