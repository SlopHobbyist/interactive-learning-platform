"""A problem found in content, printed as ``file:line: message``."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Level = Literal["error", "warning"]


@dataclass(frozen=True, order=True)
class Problem:
    file: Path
    line: int
    message: str
    level: Level = "error"

    def format(self, relative_to: Path | None = None) -> str:
        path = self.file
        if relative_to is not None:
            try:
                path = path.relative_to(relative_to)
            except ValueError:
                pass
        prefix = "warning: " if self.level == "warning" else ""
        return f"{path.as_posix()}:{self.line}: {prefix}{self.message}"

    def __str__(self) -> str:
        return self.format()
