"""Accounts against the real stack: Kratos, Mailpit and the app from ``docker compose up``
(with ``ILP_SMTP_URL`` unset, so Mailpit catches the mail).

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


def _mail(email: str, word: str, timeout: float = 15.0) -> dict:
    """The newest email to ``email`` whose subject has ``word`` (verify, recover), in full."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = httpx.get(f"{MAIL}/api/v1/search", params={"query": f"to:{email}"}).json()
        for message in found.get("messages", []):  # newest first
            if word in message["Subject"]:
                return httpx.get(f"{MAIL}/api/v1/message/{message['ID']}").json()
        time.sleep(0.5)
    raise AssertionError(f"no '{word}' email for {email}")


def _code(email: str, word: str) -> str:
    return re.search(r"\b(\d{6})\b", _mail(email, word)["Subject"]).group(1)


def _sign_up(page: Page, name: str, email: str) -> str:
    page.goto(f"{APP}/register?nosw")
    page.get_by_label("Username", exact=True).fill(name)
    page.get_by_label("Email", exact=True).fill(email)
    page.get_by_text("I'm a human").click()
    page.get_by_role("button", name="Create account").click()
    return _reveal_and_continue(page)


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

    # Then they confirm their email with the code sign-up mailed.
    expect(page.get_by_role("heading", name="Check your email")).to_be_visible()
    page.locator(".otp-slot").first.press_sequentially("000000")
    expect(page.get_by_role("alert")).to_be_visible()
    page.locator(".otp-slot").first.press_sequentially(_code(email, "verify"))

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
    page.locator(".otp-slot").first.press_sequentially(_code(email, "recover"))
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
    page.goto(f"{APP}/account?nosw")
    expect(page.get_by_text("Confirmed. Where")).to_be_visible()
    expect(page.get_by_role("link", name="Confirm email")).to_have_count(0)


def test_confirm_email_later_by_link(page: Page):
    name = f"e2e{secrets.token_hex(3)}"
    email = f"{name}@example.com"
    _sign_up(page, name, email)

    # Skipping leaves the address unconfirmed, and the account page offers to confirm it.
    expect(page.get_by_role("heading", name="Check your email")).to_be_visible()
    page.get_by_role("link", name="Do this later").click()
    expect(page).to_have_url(f"{APP}/subjects")
    page.goto(f"{APP}/account?nosw")
    expect(page.get_by_role("link", name="Confirm email")).to_be_visible()

    # The link in the sign-up email confirms it on its own.
    text = _mail(email, "verify")["Text"]
    link = re.search(r"http\S+/kratos/self-service/verification\?\S+", text).group(0)
    page.goto(link.replace("http://localhost:8000", APP))
    expect(page).to_have_url(f"{APP}/")
    page.goto(f"{APP}/account?nosw")
    expect(page.get_by_text("Confirmed. Where")).to_be_visible()
    expect(page.get_by_role("link", name="Confirm email")).to_have_count(0)
