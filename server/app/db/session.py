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


def make_engine(url: str):
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args, future=True)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _pragmas(dbapi_connection, _record):  # pragma: no cover - trivial
            cur = dbapi_connection.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

    return engine


class Database:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.url = settings.db_url
        self.engine = make_engine(self.url)
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
    """The signed-in user, or ``local`` in single mode, or None."""
    settings = request.app.state.settings
    if settings.mode != "multi":
        return _local_user(db)
    from ..auth import COOKIE

    signer = request.app.state.signer
    user_id = signer.verify(request.cookies.get(COOKIE))
    if user_id is None:
        return None
    return db.query(User).filter_by(id=user_id).first()


def current_user(request: Request, db: Session) -> User:
    """The acting user. Single mode: ``local``. Multi mode: the session cookie's user, or 401."""
    user = optional_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="sign in first")
    return user
