"""The subject library: learners add subjects from the catalog; removing one keeps progress;
migration 0002 seeds libraries from existing progress."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import text

from server.app.config import REPO_ROOT, Settings
from server.app.db.session import Database
from server.app.main import create_app
from server.tests.conftest import build_test_content

WAVES = "example/demo/basics/waves"


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        content_dir=build_test_content(tmp_path / "content"),
        elements_dir=REPO_ROOT / "elements",
        web_dir=REPO_ROOT / "web",
        data_dir=tmp_path,
        dev=True,
    )


def test_add_list_remove(tmp_path: Path):
    with TestClient(create_app(_settings(tmp_path))) as c:
        assert c.get("/api/me/subjects").json() == []
        assert len(c.get("/api/subjects").json()) >= 3  # the catalog is everything on disk

        lib = c.put("/api/me/subjects/capitals").json()
        assert [s["id"] for s in lib] == ["capitals"]
        assert lib[0]["title"] and lib[0]["course_count"] >= 1 and lib[0]["added_at"]
        lib = c.put("/api/me/subjects/example").json()
        assert [s["id"] for s in lib] == ["capitals", "example"]  # in the order added
        assert [s["id"] for s in c.put("/api/me/subjects/capitals").json()] == [
            "capitals",
            "example",
        ]  # idempotent
        assert c.put("/api/me/subjects/no-such-subject").status_code == 404

        # Removing a subject hides it; its progress stays and is there when it is re-added.
        c.post(f"/api/lessons/{WAVES}/complete", json={"xp": 10}).raise_for_status()
        assert [s["id"] for s in c.delete("/api/me/subjects/example").json()] == ["capitals"]
        assert c.get("/api/me").json()["xp_total"] == 10
        c.put("/api/me/subjects/example")
        lessons = c.get("/api/progress/example/demo").json()["lessons"]
        assert lessons["basics/waves"] == "complete"
        assert c.delete("/api/me/subjects/not-there").status_code == 200


def test_migration_seeds_library_from_progress(tmp_path: Path):
    from alembic import command
    from alembic.config import Config

    from server.app.db.session import MIGRATIONS_DIR

    settings = _settings(tmp_path)
    db = Database(settings)
    Path(db.url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", db.url)
    cfg.attributes["engine"] = db.engine
    command.upgrade(cfg, "0001")
    with db.engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, username, password_hash, created_at)"
                " VALUES (1, 'local', NULL, '2026-01-01'), (2, 'old', 'argon2…', '2026-01-01')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO lesson_completions"
                " (user_id, lesson_path, completed_at, xp, accuracy, perfect, elapsed_ms)"
                " VALUES (1, 'french/a1/greetings/hello', '2026-01-03', 10, 1, 1, 0)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO attempts (user_id, item_path, lesson_path, correct, partial,"
                " rating, ms, ts, mode) VALUES"
                " (1, 'chemistry/intro/atoms/what#a', 'chemistry/intro/atoms/what', 1, 0,"
                "  'good', 0, '2026-01-02', 'lesson'),"
                " (2, 'music/theory/scales/major#a', 'music/theory/scales/major',"
                "  0, 0, 'again', 0, '2026-01-05', 'lesson')"
            )
        )
    db.migrate()
    with db.engine.connect() as conn:
        rows = conn.execute(
            text("SELECT user_id, subject_id FROM user_subjects ORDER BY user_id, added_at")
        ).all()
        columns = [r[1] for r in conn.execute(text("PRAGMA table_info(users)"))]
    assert rows == [(1, "chemistry"), (1, "french"), (2, "music")]
    assert "identity_id" in columns and "password_hash" not in columns
