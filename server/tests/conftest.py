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


@pytest.fixture(scope="session")
def live_server(settings: Settings):
    """Run the app with uvicorn in a background thread; yields its base URL."""
    import socket
    import threading
    import time

    import uvicorn

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    config = uvicorn.Config(create_app(settings), host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True, name="live-server")
    thread.start()
    deadline = time.time() + 15
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    if not server.started:
        raise RuntimeError("live server did not start")
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)
