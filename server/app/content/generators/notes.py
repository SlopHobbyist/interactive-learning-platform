"""``notes`` → one opening explanation."""

from __future__ import annotations

from typing import Any

from ..models import AutoSource
from . import ArrangeContext, stable_id

NAME = "notes"


def generate(source: AutoSource, ctx: ArrangeContext) -> list[dict[str, Any]]:
    if not source.notes or not source.notes.strip():
        return []
    return [{"type": "explanation", "id": stable_id("notes", source.notes), "body": source.notes}]
