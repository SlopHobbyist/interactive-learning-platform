from fastapi.testclient import TestClient

from server.app.main import app


def test_health():
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_spa_fallback_and_api_404():
    client = TestClient(app)
    assert client.get("/").status_code == 200
    assert "text/html" in client.get("/some/client/route").headers["content-type"]
    assert client.get("/missing.css").status_code == 404
    assert client.get("/api/nope").status_code == 404
