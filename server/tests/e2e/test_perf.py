"""Hardening (Phase 12): the map handles 200 tiles smoothly, the PWA assets are served, and a
crashing element is skipped without breaking the session."""

from __future__ import annotations

import httpx
import pytest
from playwright.sync_api import Page

pytestmark = pytest.mark.e2e


def test_map_renders_200_tiles_fast(page: Page, live_server: str):
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(live_server + "/")
    result = page.evaluate(
        """async () => {
          const { renderMap } = await import('/js/map/map.js');
          const units = [];
          let n = 0;
          for (let u = 0; u < 20; u++) {
            const lessons = [];
            for (let l = 0; l < 10; l++) {
              lessons.push({ id: 'l' + l, title: 'Lesson ' + (++n), requires: l ? ['u' + u + '/l' + (l - 1)] : [], map: null });
            }
            units.push({ id: 'u' + u, title: 'Unit ' + (u + 1), requires: u ? ['u' + (u - 1)] : [], lessons });
          }
          const course = { title: 'Big', units, subject: { id: 's' } };
          const progress = { lessons: {}, strength: {} };
          units.slice(0, 10).forEach((u) => u.lessons.forEach((l, i) => { progress.lessons[u.id + '/' + l.id] = 'complete'; progress.strength[u.id + '/' + l.id] = (i * 10) % 100; }));
          progress.lessons['u10/l0'] = 'available';
          const host = document.getElementById('main');
          host.innerHTML = '';
          const t0 = performance.now();
          const map = renderMap({ course, progress, hrefFor: () => '#' });
          host.append(map);
          // Force layout.
          const h = map.getBoundingClientRect().height;
          const t1 = performance.now();
          // Keyboard: End jumps to the last tile.
          map.tiles[0].focus();
          map.tiles[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
          const t2 = performance.now();
          return { tiles: map.tiles.length, renderMs: t1 - t0, navMs: t2 - t1, height: h,
                   focused: document.activeElement === map.tiles[map.tiles.length - 1],
                   edges: map.querySelectorAll('.map-edges line').length };
        }"""
    )
    assert result["tiles"] == 200 and result["edges"] >= 199
    assert result["focused"] is True
    assert result["renderMs"] < 500, result
    assert result["navMs"] < 50, result
    assert result["height"] > 1000


def test_pwa_assets_are_served(live_server: str):
    manifest = httpx.get(f"{live_server}/manifest.webmanifest")
    assert manifest.status_code == 200
    data = manifest.json()
    assert data["start_url"] == "/" and data["display"] == "standalone"
    for icon in data["icons"]:
        assert httpx.get(f"{live_server}{icon['src']}").status_code == 200
    sw = httpx.get(f"{live_server}/sw.js")
    assert sw.status_code == 200 and "javascript" in sw.headers["content-type"]
    assert "caches.open" in sw.text


def test_crashing_element_is_skipped_not_fatal(page: Page, live_server: str):
    """A broken element module must not break a session: the item shows a skip card and the
    lesson continues. We simulate a crash by overriding the element loader at runtime."""
    page.set_viewport_size({"width": 1100, "height": 900})
    page.goto(live_server + "/")
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    text = page.evaluate(
        """async () => {
          const { mountItem } = await import('/js/lib/elements.js');
          // A manifest that points at a module which throws on mount.
          const blob = new Blob(["export default { type: 'boom', mount() { throw new Error('kaboom'); } }"], { type: 'text/javascript' });
          const url = URL.createObjectURL(blob);
          const reg = await (await import('/js/lib/elements.js')).registry();
          reg.set('boom', { type: 'boom', graded: true, self_graded: false, module: url, css: null });
          const root = document.createElement('div');
          document.getElementById('main').append(root);
          let ready = false;
          const r = await mountItem(root, { type: 'boom', id: 'x', graded: true }, { onChange: (v) => { ready = v; } });
          return { text: root.textContent, ready, check: r.handle.check(null), error: String(r.error) };
        }"""
    )
    assert "crashed" in text["text"] and "kaboom" in text["text"]
    assert text["ready"] is True
    assert text["check"]["skipped"] is True
    assert errors == []
