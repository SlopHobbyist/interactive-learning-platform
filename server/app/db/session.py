"""Engine, sessions and schema bootstrap (Alembic upgrade at startup)."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path

from fastapi import HTTPException, Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from ..config import Settings
from .models import User

log = logging.getLogger("ilp.db")
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
LOCAL_USERNAME = "local"


def make_engine(url: str, exclusive: bool = False):
    """SQLite engine with WAL journaling.

    ``exclusive`` sets ``locking_mode=EXCLUSIVE`` before the first WAL access. SQLite then keeps
    the WAL index in heap memory instead of the ``-shm`` file, which is what makes WAL work on
    filesystems without shared-memory support (Docker Desktop bind mounts on Windows and macOS,
    network shares). The cost: only one *connection* can have the database open, because the first
    one to touch it keeps the lock until it closes. So the pool is pinned to a single connection
    and concurrent requests queue for it instead of opening a second one ("database is locked").
    Set with ``ILP_SQLITE_EXCLUSIVE=1``.
    """
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    pool_args = {"pool_size": 1, "max_overflow": 0} if exclusive else {}
    engine = create_engine(url, connect_args=connect_args, future=True, **pool_args)
    if url.startswith("sqlite"):
        warned = False

        @event.listens_for(engine, "connect")
        def _pragmas(dbapi_connection, _record):  # pragma: no cover - trivial
            nonlocal warned
            cur = dbapi_connection.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            if exclusive:
                cur.execute("PRAGMA locking_mode=EXCLUSIVE")
            try:
                cur.execute("PRAGMA journal_mode=WAL")
            except Exception as exc:  # sqlite3.OperationalError: "disk I/O error"
                # WAL needs shared memory (the -shm file) that some filesystems cannot
                # provide: Docker Desktop bind mounts from Windows/macOS, SMB/NFS shares.
                # Fall back to the rollback journal, which works everywhere.
                cur.execute("PRAGMA journal_mode=DELETE")
                if not warned:
                    warned = True
                    log.warning(
                        "SQLite WAL mode unavailable (%s); using journal_mode=DELETE. "
                        "This is normal for a Docker bind mount on Windows or macOS.",
                        exc,
                    )
            cur.close()

    return engine


class Database:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.url = settings.db_url
        self.engine = make_engine(self.url, exclusive=settings.sqlite_exclusive)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)

    def migrate(self) -> None:
        """Bring the schema to head with Alembic (idempotent)."""
        from alembic import command
        from alembic.config import Config

        if self.url.startswith("sqlite:///"):
            Path(self.url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        cfg = Config()
        cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
        cfg.set_main_option("sqlalchemy.url", self.url)
        cfg.attributes["engine"] = self.engine
        command.upgrade(cfg, "head")
        log.info("database ready at %s", self.url)

    def ensure_local_user(self) -> None:
        with self.SessionLocal() as db:
            if db.query(User).filter_by(username=LOCAL_USERNAME).first() is None:
                db.add(User(username=LOCAL_USERNAME))
                db.commit()

    def init(self) -> None:
        self.migrate()
        # Multi mode needs no `local` row; one left over from single mode is inherited by the
        # first account (accounts.link_user).
        if self.settings.mode != "multi":
            self.ensure_local_user()

    def session(self) -> Session:
        return self.SessionLocal()


# ---------------------------------------------------------------- FastAPI deps
def get_db(request: Request) -> Iterator[Session]:
    database: Database = request.app.state.db
    db = database.session()
    try:
        yield db
    finally:
        db.close()


def _local_user(db: Session) -> User:
    user = db.query(User).filter_by(username=LOCAL_USERNAME).first()
    if user is None:
        user = User(username=LOCAL_USERNAME)
        db.add(user)
        db.commit()
    return user


def optional_user(request: Request, db: Session) -> User | None:
    """The signed-in user, or ``local`` in single mode, or None.

    Multi mode asks Kratos who the session cookie belongs to (cached for a few seconds) and maps
    that identity to its ``users`` row, creating it on the first request."""
    settings = request.app.state.settings
    if settings.mode != "multi":
        return _local_user(db)
    from ..accounts import SESSION_COOKIE, KratosUnavailable, link_user

    try:
        identity = request.app.state.kratos.whoami(request.cookies.get(SESSION_COOKIE))
    except KratosUnavailable as exc:
        log.warning("%s", exc)
        raise HTTPException(status_code=503, detail="the account service is unavailable") from exc
    if identity is None:
        return None
    return link_user(db, identity)


def current_user(request: Request, db: Session) -> User:
    """The acting user. Single mode: ``local``. Multi mode: the Kratos session's user, or 401."""
    user = optional_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="sign in first")
    return user
