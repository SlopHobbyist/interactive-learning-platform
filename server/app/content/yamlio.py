"""YAML loading that keeps line numbers.

Everything that reports a problem to an author goes through here so messages can be printed as
``file:line: message``. ruamel's round-trip loader attaches ``.lc`` (line/column) data to every
mapping and sequence; :func:`line_of` walks a location path (the same shape as a Pydantic ``loc``
or a jsonschema ``absolute_path``) down that tree and returns the deepest line it can find.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.error import MarkedYAMLError


class YamlError(Exception):
    def __init__(self, path: Path, line: int, message: str):
        super().__init__(f"{path}:{line}: {message}")
        self.path = path
        self.line = line
        self.message = message


def _yaml() -> YAML:
    y = YAML(typ="rt")
    y.preserve_quotes = True
    return y


def load_yaml(path: Path) -> Any:
    """Load one YAML document, raising :class:`YamlError` with a line number on syntax errors."""
    text = path.read_text(encoding="utf-8")
    try:
        data = _yaml().load(text)
    except MarkedYAMLError as exc:
        mark = exc.problem_mark or exc.context_mark
        line = (mark.line + 1) if mark else 1
        problem = (exc.problem or exc.context or "invalid YAML").strip()
        raise YamlError(path, line, f"YAML syntax error: {problem}") from exc
    if data is None:
        return CommentedMap()
    return data


def dump_yaml(data: Any, path: Path) -> None:
    y = _yaml()
    y.indent(mapping=2, sequence=4, offset=2)
    y.width = 100
    with path.open("w", encoding="utf-8") as fh:
        y.dump(data, fh)


def line_of(node: Any, loc: Sequence[Any] = ()) -> int:
    """Return the 1-based line of the value addressed by ``loc`` inside ``node``.

    Falls back to the nearest ancestor that has a position; returns 1 when nothing has one.
    """
    best = _own_line(node, 1)
    current = node
    for key in loc:
        if isinstance(current, CommentedMap):
            if key in current:
                try:
                    best = current.lc.key(key)[0] + 1
                except (KeyError, AttributeError, TypeError):
                    pass
                current = current[key]
                continue
            # The key is missing (e.g. a "field required" error). Point at the mapping itself.
            return _own_line(current, best)
        if isinstance(current, CommentedSeq):
            if isinstance(key, int) and 0 <= key < len(current):
                try:
                    best = current.lc.item(key)[0] + 1
                except (KeyError, AttributeError, TypeError):
                    pass
                current = current[key]
                continue
            return _own_line(current, best)
        # Scalar reached early: whatever line we have is the best answer.
        break
    return best


def _own_line(node: Any, fallback: int) -> int:
    try:
        return node.lc.line + 1
    except AttributeError:
        return fallback


def to_plain(value: Any) -> Any:
    """Convert ruamel's commented containers and scalar subclasses into plain Python objects."""
    if isinstance(value, dict):
        return {str(k): to_plain(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [to_plain(v) for v in value]
    if isinstance(value, bool):
        return bool(value)
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    if isinstance(value, str):
        return str(value)
    return value
