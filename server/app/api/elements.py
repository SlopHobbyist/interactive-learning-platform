"""Element registry endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..content.render import RenderContext, render_fields
from ..content.store import ContentStore
from .deps import get_store

router = APIRouter(prefix="/api/elements", tags=["elements"])


@router.get("")
def list_elements(store: ContentStore = Depends(get_store)) -> list[dict[str, Any]]:
    return store.registry.to_api()


@router.get("/{type_}")
def get_element(type_: str, store: ContentStore = Depends(get_store)) -> dict[str, Any]:
    manifest = store.registry.get(type_)
    if manifest is None:
        raise HTTPException(status_code=404, detail="element not found")
    return manifest.to_api()


@router.get("/{type_}/examples")
def element_examples(type_: str, store: ContentStore = Depends(get_store)) -> list[dict[str, Any]]:
    """Rendered example items from the element's ``examples.yaml`` (used by the dev gallery)."""
    manifest = store.registry.get(type_)
    if manifest is None:
        raise HTTPException(status_code=404, detail="element not found")
    ctx = RenderContext(base_url=f"/elements/{manifest.dir.name}")
    out = []
    for i, item in enumerate(manifest.examples()):
        item.setdefault("id", f"example-{i}")
        rendered = render_fields(item, manifest.schema, ctx)
        rendered["graded"] = manifest.graded
        out.append(rendered)
    return out
