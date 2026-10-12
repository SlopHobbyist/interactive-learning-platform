"""Accounts: mode, register, login, logout, whoami. Only active with ``ILP_MODE=multi``."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import auth
from ..db.models import User
from ..db.session import LOCAL_USERNAME, get_db, optional_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=1, max_length=256)


def _multi(request: Request) -> None:
    if request.app.state.settings.mode != "multi":
        raise HTTPException(status_code=404, detail="accounts are off (ILP_MODE=single)")


def _set_cookie(request: Request, response: Response, user: User) -> None:
    token = request.app.state.signer.issue(user.id)
    response.set_cookie(
        auth.COOKIE,
        token,
        max_age=auth.SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )


def _public(user: User | None) -> dict[str, Any]:
    return {"id": user.id, "username": user.username} if user else None


@router.get("/mode")
def get_mode(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    mode = request.app.state.settings.mode
    user = optional_user(request, db)
    accounts = (
        db.query(User).filter(User.password_hash.isnot(None)).count() if mode == "multi" else 0
    )
    return {
        "mode": mode,
        "authenticated": user is not None,
        "user": _public(user),
        "accounts": accounts,
    }


@router.post("/register", status_code=201)
def register(
    body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict[str, Any]:
    _multi(request)
    username = body.username.strip().lower()
    if not auth.valid_username(username):
        raise HTTPException(
            status_code=422,
            detail="username: 2-32 characters, lowercase letters, digits, '.', '-' or '_'",
        )
    if (problem := auth.validate_password(body.password)) is not None:
        raise HTTPException(status_code=422, detail=f"password: {problem}")
    if db.query(User).filter(User.username == username, User.password_hash.isnot(None)).first():
        raise HTTPException(status_code=409, detail="that username is taken")
    local = db.query(User).filter_by(username=LOCAL_USERNAME).first()
    has_accounts = db.query(User).filter(User.password_hash.isnot(None)).count() > 0
    if local is not None and not has_accounts:
        # The first account inherits everything the single-user `local` profile earned.
        local.username = username
        local.password_hash = auth.hash_password(body.password)
        user = local
        migrated = True
    else:
        if db.query(User).filter_by(username=username).first():
            raise HTTPException(status_code=409, detail="that username is taken")
        user = User(username=username, password_hash=auth.hash_password(body.password))
        db.add(user)
        migrated = False
    db.commit()
    _set_cookie(request, response, user)
    return {"user": _public(user), "migrated_local_progress": migrated}


@router.post("/login")
def login(
    body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict[str, Any]:
    _multi(request)
    user = db.query(User).filter_by(username=body.username.strip().lower()).first()
    if user is None or not auth.verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=401, detail="wrong username or password")
    _set_cookie(request, response, user)
    return {"user": _public(user)}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, Any]:
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def whoami(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    user = optional_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="not signed in")
    return {"user": _public(user)}
