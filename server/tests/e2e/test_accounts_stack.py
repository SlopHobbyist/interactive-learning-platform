"""Accounts against the real stack: Kratos, Mailpit and the app from ``docker compose up``.

Skipped unless ``ILP_STACK_URL`` points at a running stack (``http://localhost:8000``);
``ILP_STACK_MAIL_URL`` is Mailpit (default ``http://localhost:8025``). It creates a fresh
account each run, so it is safe to repeat:

    docker compose up -d --build
    ILP_STACK_URL=http://localhost:8000 uv run pytest -m e2e server/tests/e2e/test_accounts_stack.py
"""

from __future__ import annotations

import os
import re
import secrets
import time

import httpx
import pytest
from playwright.sync_api import Page, expect

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(not os.environ.get("ILP_STACK_URL"), reason="needs ILP_STACK_URL"),
]

APP = os.environ.get("ILP_STACK_URL", "").rstrip("/")
MAIL = os.environ.get("ILP_STACK_MAIL_URL", "http://localhost:8025").rstrip("/")


def _recovery_code(email: str, timeout: float = 15.0) -> str:
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = httpx.get(f"{MAIL}/api/v1/search", params={"query": f"to:{email}"}).json()
        for message in found.get("messages", []):
            m = re.search(r"\b(\d{6})\b", message["Subject"])
            if m:
                return m.group(1)
        time.sleep(0.5)
    raise AssertionError(f"no recovery email for {email}")


def _reveal_and_continue(page: Page) -> str:
    value = page.locator(".password-reveal-value")
    expect(value).to_be_visible()
    password = value.inner_text()
    assert len(password) == 32 and all(33 <= ord(ch) <= 126 for ch in password)
    cont = page.get_by_role("button", name="Continue")
    expect(cont).to_be_disabled()
    page.get_by_text("I saved my password").click()
    cont.click()
    return password


def _sign_out(page: Page) -> None:
    page.goto(f"{APP}/account?nosw")
    page.get_by_role("button", name="Sign out").click()
    expect(page).to_have_url(f"{APP}/login")


def _sign_in(page: Page, identifier: str, password: str) -> None:
    page.goto(f"{APP}/login?nosw")
    page.get_by_label("Username or email").fill(identifier)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_role("button", name="Sign in").click()


def test_sign_up_sign_in_and_recover(page: Page):
    name = f"e2e{secrets.token_hex(3)}"
    email = f"{name}@example.com"

    # Everything but the account pages needs a session.
    page.goto(f"{APP}/?nosw")
    expect(page).to_have_url(re.compile(r"/login\?next="))

    # Sign up: the human check is required, the password is generated and shown once.
    page.goto(f"{APP}/register?nosw")
    page.get_by_label("Username", exact=True).fill(name)
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_role("button", name="Create account").click()
    expect(page.get_by_role("alert")).to_contain_text("Complete the human check")
    page.get_by_text("I'm a human").click()
    page.get_by_role("button", name="Create account").click()
    first = _reveal_and_continue(page)

    # New learners land in the catalog with an empty library.
    expect(page).to_have_url(f"{APP}/subjects")
    page.locator("#goal-dialog-save").click()
    page.get_by_role("button", name="Add Example to my subjects").click()
    expect(page.locator("#nav-subjects").get_by_role("link", name="Example")).to_be_visible()

    # The same username cannot be taken twice.
    signed_in = page.context.cookies()
    page.context.clear_cookies()
    page.goto(f"{APP}/register?nosw")
    page.get_by_label("Username", exact=True).fill(name)
    page.get_by_label("Email", exact=True).fill(f"other-{email}")
    page.get_by_text("I'm a human").click()
    page.get_by_role("button", name="Create account").click()
    expect(page.get_by_role("alert")).to_contain_text("exists already")
    page.context.add_cookies(signed_in)

    # Sign out, then back in with the generated password.
    _sign_out(page)
    _sign_in(page, name, "x" * 32)
    expect(page.get_by_role("alert")).to_contain_text("credentials are invalid")
    _sign_in(page, email, first)
    expect(page).to_have_url(f"{APP}/")
    expect(page.locator(".subject-card .card-title")).to_have_text(["Example"])

    # Lost password: a code by email, then a new generated password.
    _sign_out(page)
    page.get_by_role("link", name="Forgot your password?").click()
    expect(page.get_by_role("heading", name="Get a new password")).to_be_visible()
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_role("button", name="Send me a code").click()
    page.locator(".otp-slot").first.press_sequentially(_recovery_code(email))
    expect(page.get_by_role("heading", name="Your new password")).to_be_visible()
    second = _reveal_and_continue(page)
    assert second != first
    expect(page).to_have_url(f"{APP}/")

    # The old password is dead, the new one works.
    _sign_out(page)
    _sign_in(page, name, first)
    expect(page.get_by_role("alert")).to_contain_text("credentials are invalid")
    _sign_in(page, name, second)
    expect(page).to_have_url(f"{APP}/")
