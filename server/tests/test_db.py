from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

from fastapi.testclient import TestClient
from sqlalchemy import text

from server.app.db.session import make_engine
from server.app.main import create_app


def test_exclusive_engine_shares_one_connection(tmp_path):
    # locking_mode=EXCLUSIVE: a second connection would block on the lock and then fail with
    # "database is locked", so concurrent users must queue for the single pooled connection.
    engine = make_engine(f"sqlite:///{tmp_path / 'x.db'}", exclusive=True)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE t (x INTEGER)"))

    def work(i: int) -> int:
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO t VALUES (:i)"), {"i": i})
            return conn.execute(text("SELECT count(*) FROM t")).scalar()

    with ThreadPoolExecutor(8) as pool:
        list(pool.map(work, range(16)))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM t")).scalar() == 16
        assert conn.execute(text("PRAGMA journal_mode")).scalar() == "wal"


def test_exclusive_mode_concurrent_requests(settings, tmp_path):
    # The Docker image sets ILP_SQLITE_EXCLUSIVE=1; the profile page fires parallel API calls.
    app = create_app(replace(settings, data_dir=tmp_path, sqlite_exclusive=True))
    with TestClient(app) as client, ThreadPoolExecutor(8) as pool:
        urls = ["/api/stats?tz=America/New_York", "/api/shop", "/api/me"] * 6
        statuses = list(pool.map(lambda u: client.get(u).status_code, urls))
    assert statuses == [200] * len(urls)
