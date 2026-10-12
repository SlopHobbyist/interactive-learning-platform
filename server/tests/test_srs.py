"""Spaced-repetition functions (plan §7)."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from server.app.progress import srs

T0 = datetime(2026, 1, 1, 12, 0, 0)


def days(n: float) -> datetime:
    return T0 + timedelta(days=n)


def test_retrievability_curve():
    assert srs.retrievability(1.0, 0) == 1.0
    assert srs.retrievability(1.0, 9) == pytest.approx(0.5)
    assert srs.retrievability(10.0, 90) == pytest.approx(0.5)
    assert srs.retrievability(1.0, -5) == 1.0  # negative time clamps
    assert 0 < srs.retrievability(0.0001, 1000) < 0.01


def test_first_review_ratings():
    again = srs.first_review("again", T0)
    good = srs.first_review("good", T0)
    easy = srs.first_review("easy", T0)
    hard = srs.first_review("hard", T0)
    assert again.lapses == 1 and again.stability == pytest.approx(0.2)
    assert again.difficulty > good.difficulty
    assert hard.stability < good.stability < easy.stability
    assert easy.difficulty < good.difficulty < hard.difficulty
    assert good.reps == 1


def test_correct_answer_grows_stability_more_when_nearly_forgotten():
    state = srs.ItemSRS(stability=2.0, difficulty=5.0, last_review=T0)
    soon = srs.review(state, "good", days(0.1))
    late = srs.review(state, "good", days(30))
    assert soon.stability > state.stability  # always grows a little
    assert late.stability > soon.stability  # recalling something nearly forgotten counts more
    assert late.reps == 1 and late.lapses == 0


def test_difficulty_shrinks_growth():
    easy_item = srs.ItemSRS(stability=2.0, difficulty=2.0, last_review=T0)
    hard_item = srs.ItemSRS(stability=2.0, difficulty=9.0, last_review=T0)
    e = srs.review(easy_item, "good", days(10))
    h = srs.review(hard_item, "good", days(10))
    assert e.stability > h.stability


def test_wrong_answer_resets():
    state = srs.ItemSRS(stability=20.0, difficulty=4.0, last_review=T0, reps=5, lapses=0)
    out = srs.review(state, "again", days(3))
    assert out.stability == pytest.approx(6.0)  # 0.3 × 20
    assert out.lapses == 1 and out.reps == 6
    assert out.difficulty == 5.0
    tiny = srs.review(srs.ItemSRS(0.3, 5.0, T0), "again", days(1))
    assert tiny.stability == pytest.approx(0.2)  # floor


def test_difficulty_is_clamped():
    state = srs.ItemSRS(stability=1.0, difficulty=10.0, last_review=T0)
    assert srs.review(state, "again", days(1)).difficulty == 10.0
    state = srs.ItemSRS(stability=1.0, difficulty=1.0, last_review=T0)
    assert srs.review(state, "easy", days(1)).difficulty == 1.0


def test_rating_mapping():
    assert srs.rating_for(False, 0, 100) == "again"
    assert srs.rating_for(True, 1.0, 3000) == "good"
    assert srs.rating_for(True, 0.5, 3000) == "hard"
    assert srs.rating_for(True, 1.0, 60_000) == "hard"
    assert srs.rating_for(True, 1.0, 100, "easy") == "easy"
    assert srs.rating_for(False, 0, 100, "bogus") == "again"


def test_strength_and_due():
    fresh = srs.ItemSRS(stability=10.0, difficulty=5.0, last_review=T0)
    assert srs.strength([fresh], T0) == 100.0
    assert srs.strength([fresh], days(90)) == pytest.approx(50.0)
    # Missing states count as zero.
    assert srs.strength([fresh], T0, expected_items=2) == 50.0
    assert srs.strength([], T0) == 100.0
    due = srs.due_date(fresh)
    assert srs.current_retrievability(fresh, due) == pytest.approx(0.9, abs=1e-6)


def test_review_rejects_unknown_rating():
    with pytest.raises(ValueError):
        srs.review(srs.ItemSRS(1.0, 5.0, T0), "meh", T0)
