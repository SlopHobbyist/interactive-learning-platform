"""Holds the loaded content index and element registry; rebuilds them when files change.

In dev mode a ``watchfiles`` thread watches the content and elements directories and marks the
store dirty; the next request reloads. Outside dev mode the index is built once at startup
(``reload()`` can still be called, e.g. by tests).
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from ..config import Settings
from ..elements.registry import ElementRegistry, scan_elements
from .loader import ContentIndex, load_content

log = logging.getLogger(__name__)


class ContentStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = threading.Lock()
        self._index: ContentIndex | None = None
        self._registry: ElementRegistry | None = None
        self._dirty = True
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -- access -----------------------------------------------------------------------------
    def _ensure(self) -> None:
        if self._dirty or self._index is None or self._registry is None:
            with self._lock:
                if self._dirty or self._index is None or self._registry is None:
                    self._registry = scan_elements(self.settings.elements_dir)
                    self._index = load_content(self.settings.content_dir)
                    self._dirty = False
                    n = len(self._index.all_lessons())
                    log.info(
                        "content loaded: %d subjects, %d lessons, %d elements, %d problems",
                        len(self._index.subjects),
                        n,
                        len(self._registry.elements),
                        len(self._index.problems),
                    )

    @property
    def index(self) -> ContentIndex:
        self._ensure()
        assert self._index is not None
        return self._index

    @property
    def registry(self) -> ElementRegistry:
        self._ensure()
        assert self._registry is not None
        return self._registry

    def reload(self) -> None:
        self._dirty = True
        self._ensure()

    def mark_dirty(self) -> None:
        self._dirty = True

    # -- watching ---------------------------------------------------------------------------
    def start_watching(self) -> None:
        if self._thread is not None:
            return
        paths = [p for p in (self.settings.content_dir, self.settings.elements_dir) if p.is_dir()]
        if not paths:
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._watch, args=(paths,), daemon=True, name="content-watch"
        )
        self._thread.start()

    def stop_watching(self) -> None:
        self._stop.set()
        self._thread = None

    def _watch(self, paths: list[Path]) -> None:
        try:
            from watchfiles import watch
        except ImportError:  # pragma: no cover
            log.warning("watchfiles not installed; content auto-reload disabled")
            return
        for changes in watch(*paths, stop_event=self._stop, debounce=300):
            if changes:
                log.info("content changed (%d file(s)); reloading on next request", len(changes))
                self.mark_dirty()
