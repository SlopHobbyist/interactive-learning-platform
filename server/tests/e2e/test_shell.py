"""Browser tests for the web shell (Phase 2).

Run with ``uv run pytest -m e2e`` after ``uv run playwright install chromium``.
"""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import Page, expect

pytestmark = pytest.mark.e2e

VIEWPORTS = {"phone": (375, 740), "desktop": (1280, 800)}


def _set_theme(page: Page, theme: str) -> None:
    page.add_init_script(f"localStorage.setItem('design-language-theme', '{theme}')")


@pytest.mark.parametrize("theme", ["dark", "light"])
@pytest.mark.parametrize("viewport", list(VIEWPORTS))
def test_browse_subjects_to_lessons(page: Page, live_server: str, viewport: str, theme: str):
    width, height = VIEWPORTS[viewport]
    page.set_viewport_size({"width": width, "height": height})
    _set_theme(page, theme)
    requests: list[str] = []
    page.on("request", lambda req: requests.append(req.url))
    failures: list[str] = []
    page.on("requestfailed", lambda req: failures.append(req.url))
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    page.goto(live_server + "/")
    expect(page).to_have_title("Subjects · Learn")
    expect(page.locator("html")).to_have_attribute("data-theme", theme)
    expect(page.get_by_role("heading", level=1)).to_have_text("Subjects")

    # Subject card → courses
    page.get_by_role("link", name="Example, 1 course").click()
    expect(page.get_by_role("heading", level=1)).to_have_text("Example")
    expect(page).to_have_url(live_server + "/s/example")

    # Course card → lesson list grouped by unit
    page.get_by_role("link", name="Demo course").click()
    expect(page.get_by_role("heading", level=1)).to_have_text("Demo course")
    rows = page.locator(".lesson-row")
    expect(rows).to_have_count(4)
    expect(rows.nth(0)).to_have_attribute("data-state", "available")
    expect(rows.nth(1)).to_have_attribute("data-state", "locked")
    expect(page.get_by_role("heading", level=2).first).to_contain_text("Basics")

    # First lesson opens
    rows.nth(0).click()
    expect(page).to_have_url(live_server + "/l/example/demo/basics/waves")
    expect(page.get_by_role("heading", level=1)).to_have_text("What is a wave?")

    # Back button works (History API)
    page.go_back()
    expect(page.get_by_role("heading", level=1)).to_have_text("Demo course")

    # Nothing left the origin, nothing failed, no JS errors.
    external = [u for u in requests if not u.startswith(live_server)]
    assert external == [], external
    assert failures == [], failures
    assert errors == [], errors
    # The self-hosted fonts were actually used.
    assert any(u.endswith(".woff2") for u in requests)


def test_drawer_on_phone(page: Page, live_server: str):
    page.set_viewport_size({"width": 375, "height": 740})
    page.goto(live_server + "/c/example/demo")
    drawer = page.locator("#app-drawer")
    expect(drawer).to_have_attribute("data-open", "false")
    page.get_by_role("button", name="Open navigation").click()
    expect(drawer).to_have_attribute("data-open", "true")
    expect(drawer.get_by_role("link", name="Example 1")).to_have_attribute("aria-current", "page")
    drawer.get_by_role("link", name="Settings").click()
    expect(page).to_have_url(live_server + "/settings")
    expect(drawer).to_have_attribute("data-open", "false")
    expect(page.get_by_role("heading", level=1)).to_have_text("Settings")


def test_drawer_docked_on_desktop(page: Page, live_server: str):
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(live_server + "/")
    drawer = page.locator("#app-drawer")
    expect(drawer).to_have_class(re.compile(r"(^| )drawer-docked( |$)"))
    expect(drawer).to_have_attribute("data-open", "true")
    expect(page.get_by_role("button", name="Open navigation")).to_be_hidden()


def test_unknown_route_shows_404(page: Page, live_server: str):
    page.goto(live_server + "/no/such/page")
    expect(page.get_by_role("heading", level=1)).to_have_text("There is nothing here")


def test_theme_toggle(page: Page, live_server: str):
    _set_theme(page, "dark")
    page.goto(live_server + "/")
    page.get_by_role("button", name="Switch to light theme").click()
    expect(page.locator("html")).to_have_attribute("data-theme", "light")
    page.get_by_role("button", name="Switch to dark theme").click()
    expect(page.locator("html")).to_have_attribute("data-theme", "dark")
