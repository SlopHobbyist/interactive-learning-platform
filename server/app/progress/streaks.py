"""Streaks (plan §6): consecutive local days with the daily goal met, with freezes.

Pure functions over day records so the edge cases (midnight rollover, a missed day with or
without a freeze, a timezone change) are unit-testable without a database. The day boundary is
the user's local date, computed by the caller from the timezone the client sends.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta


@dataclass
class Day:
    local_date: str  # YYYY-MM-DD
    xp: int = 0
    goal: int = 20
    met: bool = False
    freeze_used: bool = False

    @property
    def counts(self) -> bool:
        return self.met or self.freeze_used


def _d(s: str) -> date:
    return date.fromisoformat(s)


def streak_length(days: dict[str, Day], today: str) -> int:
    """Consecutive counting days ending today, or ending yesterday when today is still open."""
    cur = _d(today)
    if not (today in days and days[today].counts):
        cur -= timedelta(days=1)
    n = 0
    while True:
        d = days.get(cur.isoformat())
        if d is None or not d.counts:
            return n
        n += 1
        cur -= timedelta(days=1)


def best_streak(days: dict[str, Day]) -> int:
    best = run = 0
    prev: date | None = None
    for key in sorted(days):
        d = days[key]
        cur = _d(key)
        if d.counts:
            run = run + 1 if prev is not None and (cur - prev).days == 1 and run else 1
            best = max(best, run)
        else:
            run = 0
        prev = cur if d.counts else None
    return best


def gap_days(days: dict[str, Day], today: str) -> list[str]:
    """Missed days strictly between the last counting day and today (empty without history)."""
    counting = sorted(k for k, d in days.items() if d.counts and k < today)
    if not counting:
        return []
    last = _d(counting[-1])
    cur = last + timedelta(days=1)
    out: list[str] = []
    end = _d(today)
    while cur < end:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


def apply_freezes(days: dict[str, Day], today: str, available: int) -> tuple[list[str], int]:
    """Bridge the gap before today with freezes, oldest day first, only when the whole gap can be
    covered (a freeze is never wasted on a streak that is lost anyway).

    Returns (days frozen, freezes left). Mutates ``days``.
    """
    gap = [g for g in gap_days(days, today) if not (g in days and days[g].counts)]
    if not gap or len(gap) > available:
        return [], available
    for g in gap:
        day = days.get(g) or Day(local_date=g)
        day.freeze_used = True
        days[g] = day
    return gap, available - len(gap)
