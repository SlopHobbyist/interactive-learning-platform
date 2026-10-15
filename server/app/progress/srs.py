"""Spaced repetition: a small FSRS-style model, as pure functions.

State per item: stability S (days), difficulty D (1–10), last_review, reps, lapses.

* Retrievability after t days:  R(t) = (1 + t / (9 S)) ** -1
* Correct: S grows by a factor that rises with (1 - R) (recalling something nearly forgotten
  counts for more) and shrinks with difficulty; the rating (hard/good/easy) scales it.
* Wrong ("again"): S = max(0.2, 0.3 S), lapses += 1, D += 1.

All constants live in :class:`SRSConfig` so they are easy to read and tune.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta

Rating = str  # "again" | "hard" | "good" | "easy"
RATINGS = ("again", "hard", "good", "easy")


@dataclass(frozen=True)
class SRSConfig:
    initial_stability: float = 1.0  # days, after the first correct answer at "good"
    initial_difficulty: float = 5.0
    min_difficulty: float = 1.0
    max_difficulty: float = 10.0
    growth: float = 3.0  # how strongly S grows on success (scaled by 1 - R and ease)
    min_growth_factor: float = 1.1  # a correct answer always lengthens the interval a little
    lapse_factor: float = 0.3
    lapse_min_stability: float = 0.2
    lapse_difficulty_step: float = 1.0
    rating_multiplier: tuple[float, float, float] = (0.6, 1.0, 1.6)  # hard, good, easy
    rating_difficulty_step: tuple[float, float, float] = (0.4, 0.0, -0.3)  # hard, good, easy
    retention_target: float = 0.9  # R below which an item counts as "due"


DEFAULT_CONFIG = SRSConfig()


@dataclass(frozen=True)
class ItemSRS:
    stability: float
    difficulty: float
    last_review: datetime
    reps: int = 0
    lapses: int = 0


def retrievability(stability: float, days_since: float) -> float:
    """R(t) in [0, 1]. Clamped so odd inputs (negative t) never exceed 1."""
    t = max(0.0, days_since)
    s = max(1e-6, stability)
    return 1.0 / (1.0 + t / (9.0 * s))


def days_between(earlier: datetime, later: datetime) -> float:
    return max(0.0, (later - earlier).total_seconds() / 86400.0)


def current_retrievability(state: ItemSRS, now: datetime) -> float:
    return retrievability(state.stability, days_between(state.last_review, now))


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def first_review(rating: Rating, now: datetime, cfg: SRSConfig = DEFAULT_CONFIG) -> ItemSRS:
    """State after the very first answer to an item."""
    if rating == "again":
        return ItemSRS(
            cfg.lapse_min_stability,
            cfg.initial_difficulty + cfg.lapse_difficulty_step,
            now,
            reps=1,
            lapses=1,
        )
    idx = RATINGS.index(rating) - 1
    mult = cfg.rating_multiplier[idx]
    difficulty = _clamp(
        cfg.initial_difficulty + cfg.rating_difficulty_step[idx],
        cfg.min_difficulty,
        cfg.max_difficulty,
    )
    return ItemSRS(cfg.initial_stability * mult, difficulty, now, reps=1, lapses=0)


def review(
    state: ItemSRS, rating: Rating, now: datetime, cfg: SRSConfig = DEFAULT_CONFIG
) -> ItemSRS:
    """State after answering an item that already has state."""
    if rating not in RATINGS:
        raise ValueError(f"unknown rating {rating!r}")
    r = current_retrievability(state, now)
    if rating == "again":
        return ItemSRS(
            stability=max(cfg.lapse_min_stability, state.stability * cfg.lapse_factor),
            difficulty=_clamp(
                state.difficulty + cfg.lapse_difficulty_step, cfg.min_difficulty, cfg.max_difficulty
            ),
            last_review=now,
            reps=state.reps + 1,
            lapses=state.lapses + 1,
        )
    idx = RATINGS.index(rating) - 1
    mult = cfg.rating_multiplier[idx]
    ease = (
        cfg.max_difficulty + 1 - state.difficulty
    ) / cfg.max_difficulty  # 1.0 easy … 0.1 hardest
    factor = 1.0 + cfg.growth * (1.0 - r) * ease * mult
    factor = max(cfg.min_growth_factor * (mult if mult < 1 else 1.0), factor)
    return ItemSRS(
        stability=state.stability * factor,
        difficulty=_clamp(
            state.difficulty + cfg.rating_difficulty_step[idx],
            cfg.min_difficulty,
            cfg.max_difficulty,
        ),
        last_review=now,
        reps=state.reps + 1,
        lapses=state.lapses,
    )


def rating_for(correct: bool, partial: float, ms: int, self_rating: str | None = None) -> Rating:
    """Map an attempt to a rating. Flashcards bring their own; other items use speed and partial."""
    if self_rating in RATINGS:
        return self_rating
    if not correct:
        return "again"
    if partial < 1.0 or ms > 20_000:
        return "hard"
    return "good"


def strength(states: list[ItemSRS], now: datetime, expected_items: int | None = None) -> float:
    """Tile strength 0–100: mean R over the graded items (missing states count as 0)."""
    n = expected_items if expected_items else len(states)
    if not n:
        return 100.0
    total = sum(current_retrievability(s, now) for s in states)
    return round(100.0 * total / n, 1)


def due_date(state: ItemSRS, cfg: SRSConfig = DEFAULT_CONFIG) -> datetime:
    """When R drops to the retention target: t = 9 S (1/R - 1)."""
    t = 9.0 * state.stability * (1.0 / cfg.retention_target - 1.0)
    return state.last_review + timedelta(days=t)


def with_time(state: ItemSRS, now: datetime) -> ItemSRS:
    return replace(state, last_review=now)
