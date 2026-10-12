"""Every browser test starts from empty progress (the live server is shared per session)."""

from __future__ import annotations

import httpx
import pytest


@pytest.fixture(autouse=True)
def fresh_progress(live_server: str):
    httpx.post(f"{live_server}/api/dev/reset-progress").raise_for_status()
    yield
