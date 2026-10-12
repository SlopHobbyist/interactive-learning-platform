"""The frontier: which lessons are locked, available or complete (plan §6).

A lesson is *available* when every unit it requires is complete (all of that unit's lessons
complete) and every lesson it requires is complete. Units and lessons without ``requires`` depend
on nothing (the loader already filled in the "previous" defaults).
"""

from __future__ import annotations

from ..content.loader import Course

State = str  # "locked" | "available" | "complete"


def unit_complete(course: Course, unit_id: str, completed: set[str]) -> bool:
    unit = course.unit(unit_id)
    if unit is None or not unit.lessons:
        return False
    return all(lsn.key in completed for lsn in unit.lessons)


def frontier(course: Course, completed: set[str]) -> dict[str, State]:
    """Map ``unit/lesson`` → state. ``completed`` holds ``unit/lesson`` keys."""
    units_done = {u.id: unit_complete(course, u.id, completed) for u in course.units}
    states: dict[str, State] = {}
    for unit in course.units:
        unit_open = all(units_done.get(r, False) for r in unit.requires)
        for lsn in unit.lessons:
            if lsn.key in completed:
                states[lsn.key] = "complete"
            elif unit_open and all(r in completed for r in lsn.requires):
                states[lsn.key] = "available"
            else:
                states[lsn.key] = "locked"
    return states


def newly_unlocked(course: Course, before: set[str], after: set[str]) -> list[str]:
    """Lesson keys that became available between two completion sets."""
    f0 = frontier(course, before)
    f1 = frontier(course, after)
    return [k for k, s in f1.items() if s == "available" and f0.get(k) != "available"]


def unit_states(course: Course, completed: set[str]) -> dict[str, State]:
    out: dict[str, State] = {}
    states = frontier(course, completed)
    for unit in course.units:
        keys = [lsn.key for lsn in unit.lessons]
        if keys and all(states[k] == "complete" for k in keys):
            out[unit.id] = "complete"
        elif any(states[k] != "locked" for k in keys):
            out[unit.id] = "available"
        else:
            out[unit.id] = "locked"
    return out
