from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.app.config import REPO_ROOT, Settings
from server.app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings(
        content_dir=REPO_ROOT / "content",
        elements_dir=REPO_ROOT / "elements",
        web_dir=REPO_ROOT / "web",
        data_dir=FIXTURES / "_data",
        dev=True,
    )


@pytest.fixture(scope="session")
def client(settings: Settings):
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture(scope="session")
def bad_content_dir() -> Path:
    return FIXTURES / "bad"
