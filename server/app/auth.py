"""Accounts (Phase 11): argon2 password hashing and signed session cookies.

``ILP_MODE=single`` (default): every request is the ``local`` user; nothing here is used.
``ILP_MODE=multi``: local username/password accounts. Sessions are stateless cookies signed
with an HMAC key stored in the data directory (``session.key``), so no sessions table is needed.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

COOKIE = "ilp_session"
SESSION_DAYS = 30
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{1,31}$")

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:  # malformed hash
        return False


def valid_username(name: str) -> bool:
    return bool(USERNAME_RE.match(name))


def validate_password(password: str) -> str | None:
    """Return a problem description, or None when the password is acceptable."""
    if len(password) < 8:
        return "use at least 8 characters"
    if len(password) > 256:
        return "that is too long"
    return None


class SessionSigner:
    def __init__(self, key_file: Path):
        self.key_file = key_file
        self._key: bytes | None = None

    @property
    def key(self) -> bytes:
        if self._key is None:
            if self.key_file.is_file():
                self._key = self.key_file.read_bytes().strip()
            else:
                self.key_file.parent.mkdir(parents=True, exist_ok=True)
                self._key = secrets.token_bytes(32)
                self.key_file.write_bytes(base64.b64encode(self._key))
                self._key = base64.b64encode(self._key)
        return self._key

    def _sign(self, payload: str) -> str:
        return hmac.new(self.key, payload.encode("utf-8"), hashlib.sha256).hexdigest()

    def issue(self, user_id: int, now: float | None = None) -> str:
        expires = int((now or time.time()) + SESSION_DAYS * 86400)
        payload = f"{user_id}:{expires}"
        return f"{payload}:{self._sign(payload)}"

    def verify(self, token: str | None, now: float | None = None) -> int | None:
        """Return the user id for a valid, unexpired token, else None."""
        if not token or token.count(":") != 2:
            return None
        user_id, expires, signature = token.split(":")
        payload = f"{user_id}:{expires}"
        if not hmac.compare_digest(self._sign(payload), signature):
            return None
        try:
            if int(expires) < (now or time.time()):
                return None
            return int(user_id)
        except ValueError:
            return None
