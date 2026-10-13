"""Every browser test starts from empty progress (the live server is shared per session) with
every subject in the learner's library, so the sidebar and home page list them all."""

from __future__ import annotations

import httpx
import pytest


@pytest.fixture(autouse=True)
def fresh_progress(live_server: str):
    httpx.post(f"{live_server}/api/dev/reset-progress").raise_for_status()
    # The first-run goal dialog is modal; tests that want it set goalChosen back to False.
    httpx.put(
        f"{live_server}/api/settings", json={"goalChosen": True, "chests": False}
    ).raise_for_status()
    for subject in httpx.get(f"{live_server}/api/subjects").json():
        httpx.put(f"{live_server}/api/me/subjects/{subject['id']}").raise_for_status()
    yield
