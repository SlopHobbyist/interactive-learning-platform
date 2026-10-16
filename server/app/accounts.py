"""Accounts for ``ILP_MODE=multi``, delegated to Ory Kratos.

Kratos owns identities, passwords, sessions, and verification and recovery emails. The app only:

- reverse-proxies Kratos's public API at ``/kratos/`` (``api/kratos.py``) so the browser talks to
  one origin and Kratos's cookies are first-party;
- asks Kratos who a session cookie belongs to (``Kratos.whoami``, cached briefly) and maps that
  identity to a row in ``users`` (``link_user``), which every progress table hangs off; the proxy
  drops the cached answer after a sign-out or a verified email;
- checks the Cloudflare Turnstile token in Kratos's registration webhook, and on sign-in in the
  ``/kratos/`` proxy before the password reaches Kratos (``verify_turnstile``).

``ILP_MODE=single`` (the default outside Docker) uses none of this: every request is ``local``.
"""

from __future__ import annotations

import hashlib
import http.cookiejar
import logging
import threading
import time
from dataclasses import dataclass

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db.models import User
from .db.session import LOCAL_USERNAME

log = logging.getLogger("ilp.accounts")

SESSION_COOKIE = "ory_kratos_session"

# The token Cloudflare's always-pass test site key (1x00000000000000000000AA) produces. In
# placeholder mode (no ILP_TURNSTILE_SECRET) the sign-up form sends it and nothing else passes.
PLACEHOLDER_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"
SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TURNSTILE_MESSAGE = "Please complete the human check, then try again."


class _RefuseCookies(http.cookiejar.DefaultCookiePolicy):
    def set_ok(self, cookie, request):
        return False

    def return_ok(self, cookie, request):
        return False


def cookieless_jar() -> http.cookiejar.CookieJar:
    """A jar that never stores a cookie. httpx clients keep cookies from responses and send them
    on later requests; a client shared by every browser (the proxy, whoami) must not, or one
    learner's session cookie would be replayed for everyone else."""
    return http.cookiejar.CookieJar(policy=_RefuseCookies())


def proxy_client(public_url: str, transport: httpx.AsyncBaseTransport | None = None):
    """The client the ``/kratos/`` proxy forwards browser requests with (api/kratos.py)."""
    return httpx.AsyncClient(
        base_url=public_url.rstrip("/"), timeout=15.0, transport=transport, cookies=cookieless_jar()
    )


class KratosUnavailable(RuntimeError):
    """Kratos could not be reached or answered with something unexpected."""


@dataclass(frozen=True)
class Identity:
    id: str
    username: str
    email: str
    email_verified: bool = False


class Kratos:
    """A small client for the one Kratos call the server makes itself: ``/sessions/whoami``.

    Answers are cached per session cookie for ``ttl`` seconds, because one page load fires
    several API requests in parallel. Signing out through the proxy drops the cache entry.
    """

    def __init__(
        self, public_url: str, ttl: float = 30.0, transport: httpx.BaseTransport | None = None
    ):
        self.public_url = public_url.rstrip("/")
        self.ttl = ttl
        self._client = httpx.Client(
            base_url=self.public_url, timeout=5.0, transport=transport, cookies=cookieless_jar()
        )
        self._cache: dict[str, tuple[float, Identity]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _key(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def whoami(self, token: str | None) -> Identity | None:
        """The identity behind a session cookie value, or None for no or an expired session."""
        if not token:
            return None
        key = self._key(token)
        now = time.monotonic()
        with self._lock:
            hit = self._cache.get(key)
            if hit and hit[0] > now:
                return hit[1]
        try:
            response = self._client.get(
                "/sessions/whoami",
                headers={"Cookie": f"{SESSION_COOKIE}={token}", "Accept": "application/json"},
            )
        except httpx.HTTPError as exc:
            raise KratosUnavailable(f"Kratos is unreachable at {self.public_url}: {exc}") from exc
        if response.status_code in (401, 403):  # no session, or one that needs a second factor
            self.forget(token)
            return None
        if response.status_code != 200:
            raise KratosUnavailable(f"Kratos answered whoami with HTTP {response.status_code}")
        data = response.json()
        if not data.get("active"):
            return None
        ident = data.get("identity") or {}
        traits = ident.get("traits") or {}
        email = str(traits.get("email") or "")
        identity = Identity(
            id=str(ident["id"]),
            username=str(traits.get("username") or ""),
            email=email,
            email_verified=any(
                a.get("verified") and str(a.get("value") or "").lower() == email.lower()
                for a in ident.get("verifiable_addresses") or []
            ),
        )
        with self._lock:
            if len(self._cache) > 5000:
                self._cache = {k: v for k, v in self._cache.items() if v[0] > now}
            self._cache[key] = (now + self.ttl, identity)
        return identity

    def forget(self, token: str | None) -> None:
        if token:
            with self._lock:
                self._cache.pop(self._key(token), None)

    def close(self) -> None:
        self._client.close()


def _free_username(db: Session, wanted: str, user: User) -> str:
    """``wanted``, or ``wanted-2``, ``wanted-3``… if another row already uses it.

    Kratos keeps usernames unique among accounts; this only matters for rows Kratos does not
    know about (a leftover ``local`` user, accounts from before Kratos)."""
    base = wanted or f"learner-{user.id or 'new'}"
    candidate, n = base, 1
    while True:
        other = db.query(User).filter(User.username == candidate).first()
        if other is None or other is user:
            return candidate
        n += 1
        candidate = f"{base}-{n}"


def link_user(db: Session, identity: Identity) -> User:
    """The ``users`` row for a Kratos identity, created on its first request.

    The first identity ever linked inherits the ``local`` user (and so everything earned in
    single mode before accounts were switched on). Later identities start empty."""
    user = db.query(User).filter_by(identity_id=identity.id).first()
    if user is not None:
        if identity.username and user.username != identity.username:
            user.username = _free_username(db, identity.username, user)
            db.commit()
        return user
    any_linked = db.query(User).filter(User.identity_id.isnot(None)).first() is not None
    local = db.query(User).filter_by(username=LOCAL_USERNAME, identity_id=None).first()
    if local is not None and not any_linked:
        user = local
        log.info("first account %s inherits the local user's progress", identity.username)
    else:
        user = User(username=f"pending-{identity.id}")
        db.add(user)
        db.flush()
    user.identity_id = identity.id
    user.username = _free_username(db, identity.username, user)
    try:
        db.commit()
    except IntegrityError:
        # A parallel request linked the same identity first; use its row.
        db.rollback()
        user = db.query(User).filter_by(identity_id=identity.id).one()
    return user


def verify_turnstile(
    token: str,
    secret: str,
    remote_ip: str = "",
    transport: httpx.BaseTransport | None = None,
) -> bool:
    """Check a Turnstile token. Without a secret (placeholder mode) only the dummy token passes."""
    if not token or len(token) > 2048:
        return False
    if not secret:
        return token == PLACEHOLDER_TOKEN
    data = {"secret": secret, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        with httpx.Client(timeout=10.0, transport=transport) as client:
            response = client.post(SITEVERIFY_URL, data=data)
        return response.status_code == 200 and response.json().get("success") is True
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("turnstile siteverify failed: %s", exc)
        return False
