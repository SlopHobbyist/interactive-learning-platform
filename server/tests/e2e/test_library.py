"""Browser tests for the subject library: the catalog adds and removes subjects, and the home
page and the sidebar list only the added ones."""

from __future__ import annotations

import httpx
import pytest
from playwright.sync_api import Page, expect

pytestmark = pytest.mark.e2e


def _empty_library(live_server: str) -> None:
    for subject in httpx.get(f"{live_server}/api/me/subjects").json():
        httpx.delete(f"{live_server}/api/me/subjects/{subject['id']}").raise_for_status()


def test_empty_library_points_to_the_catalog(page: Page, live_server: str):
    _empty_library(live_server)
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(live_server + "/")
    expect(page.get_by_role("heading", level=1)).to_have_text("My subjects")
    expect(page.get_by_text("No subjects yet")).to_be_visible()
    drawer = page.locator("#app-drawer")
    expect(drawer.locator('#nav-subjects a[href^="/s/"]')).to_have_count(0)
    drawer.get_by_role("link", name="Choose subjects").click()
    expect(page).to_have_url(live_server + "/subjects")
    expect(page.get_by_role("heading", level=1)).to_have_text("All subjects")


def test_catalog_adds_and_removes_subjects(page: Page, live_server: str):
    _empty_library(live_server)
    page.set_viewport_size({"width": 1280, "height": 800})
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(live_server + "/subjects")
    cards = page.locator(".catalog-card")
    total = len(httpx.get(f"{live_server}/api/subjects").json())
    expect(cards).to_have_count(total)

    # Search narrows the list; clearing it brings everything back.
    search = page.get_by_role("searchbox", name="Search subjects")
    search.fill("spanish")
    expect(page.locator(".catalog-card:visible")).to_have_count(1)
    expect(page.locator(".catalog-count")).to_have_text(f"1 of {total} subjects")
    search.fill("zzzz")
    expect(page.get_by_text("No subjects match")).to_be_visible()
    search.fill("")
    expect(page.locator(".catalog-card:visible")).to_have_count(total)

    add = page.get_by_role("button", name="Add Spanish to my subjects")
    add.click()
    remove = page.get_by_role("button", name="Remove Spanish from my subjects")
    expect(remove).to_have_attribute("aria-pressed", "true")
    expect(remove).to_be_focused()
    nav = page.locator("#nav-subjects")
    expect(nav.get_by_role("link", name="Spanish")).to_be_visible()

    page.get_by_role("button", name="Add Python to my subjects").click()
    expect(nav.locator('a[href^="/s/"]')).to_have_count(2)

    # Home lists the library, in the order added.
    page.goto(live_server + "/")
    expect(page.locator(".subject-card .card-title")).to_have_text(["Spanish", "Python"])

    # The subject page can remove it again; progress is kept server-side.
    page.goto(live_server + "/s/spanish")
    page.get_by_role("button", name="In my subjects").click()
    expect(page.get_by_role("button", name="Add to my subjects")).to_have_attribute(
        "aria-pressed", "false"
    )
    expect(nav.get_by_role("link", name="Spanish")).to_have_count(0)
    assert [s["id"] for s in httpx.get(f"{live_server}/api/me/subjects").json()] == ["python"]
    assert errors == []
