"""Environment-driven settings.

Every path can be overridden with an ``ILP_*`` variable so the same code runs from a checkout,
from a Docker image with volumes mounted, and from the test-suite with fixture directories.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _env_path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value).resolve() if value else default


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    content_dir: Path = field(
        default_factory=lambda: _env_path("ILP_CONTENT_DIR", REPO_ROOT / "content")
    )
    elements_dir: Path = field(
        default_factory=lambda: _env_path("ILP_ELEMENTS_DIR", REPO_ROOT / "elements")
    )
    web_dir: Path = field(default_factory=lambda: _env_path("ILP_WEB_DIR", REPO_ROOT / "web"))
    data_dir: Path = field(default_factory=lambda: _env_path("ILP_DATA_DIR", REPO_ROOT / "data"))
    dev: bool = field(default_factory=lambda: _env_bool("ILP_DEV"))
    mode: str = field(default_factory=lambda: os.environ.get("ILP_MODE", "single"))

    @property
    def db_url(self) -> str:
        explicit = os.environ.get("ILP_DB_URL")
        if explicit:
            return explicit
        return f"sqlite:///{(self.data_dir / 'ilp.sqlite3').as_posix()}"


settings = Settings()
