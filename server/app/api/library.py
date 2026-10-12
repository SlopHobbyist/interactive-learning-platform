"""The learner's subject library: the subjects they added from the catalog.

``GET /api/subjects`` is the master catalog (every subject on disk). The library is the short
list shown on the home page and in the sidebar. Removing a subject only hides it; its progress
stays in the database and comes back when the subject is added again.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..content.store import ContentStore
from ..db.models import User, UserSubject
from ..db.session import current_user, get_db
from .deps import get_store

router = APIRouter(prefix="/api/me/subjects", tags=["library"])


def _library(db: Session, user: User, store: ContentStore) -> list[dict[str, Any]]:
    rows = (
        db.query(UserSubject)
        .filter_by(user_id=user.id)
        .order_by(UserSubject.added_at, UserSubject.id)
        .all()
    )
    out = []
    for row in rows:
        subject = store.index.subject(row.subject_id)
        if subject is None:  # deleted from content/; keep the row in case it comes back
            continue
        out.append({**subject.to_summary(), "added_at": row.added_at.isoformat() + "Z"})
    return out


@router.get("")
def list_library(
    request: Request, db: Session = Depends(get_db), store: ContentStore = Depends(get_store)
) -> list[dict[str, Any]]:
    return _library(db, current_user(request, db), store)


@router.put("/{subject}")
def add_subject(
    subject: str,
    request: Request,
    db: Session = Depends(get_db),
    store: ContentStore = Depends(get_store),
) -> list[dict[str, Any]]:
    user = current_user(request, db)
    if store.index.subject(subject) is None:
        raise HTTPException(status_code=404, detail="subject not found")
    if db.query(UserSubject).filter_by(user_id=user.id, subject_id=subject).first() is None:
        db.add(UserSubject(user_id=user.id, subject_id=subject))
        db.commit()
    return _library(db, user, store)


@router.delete("/{subject}")
def remove_subject(
    subject: str,
    request: Request,
    db: Session = Depends(get_db),
    store: ContentStore = Depends(get_store),
) -> list[dict[str, Any]]:
    user = current_user(request, db)
    db.query(UserSubject).filter_by(user_id=user.id, subject_id=subject).delete()
    db.commit()
    return _library(db, user, store)
