"""Server-side rendering of authored text.

Fields that an element's schema marks with ``x-format`` are rendered here, at load time, so the
browser never needs a markdown parser:

* ``markdown``          — block markdown (paragraphs, lists, fenced code, images, math).
* ``markdown-inline``   — inline markdown only (no ``<p>`` wrapper); for choices, labels, pairs.
* ``code``              — verbatim code highlighted with Pygments; the sibling ``language`` field
                          picks the lexer.

Math written as ``$…$`` or ``$$…$$`` is lifted out before markdown runs and put back as
``<span class="math" data-display="0|1">`` holding the raw TeX, for client-side KaTeX.

A property may also declare ``"x-blanks": true``: runs of three or more underscores are then
protected from markdown and emitted as ``<span class="blank" data-blank="n"></span>`` so an element
can swap in inputs.

All output passes through ``nh3`` (an HTML sanitiser) with a fixed allow-list.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any

import nh3
from markdown_it import MarkdownIt
from markdown_it.token import Token
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name, guess_lexer
from pygments.util import ClassNotFound


class RenderError(Exception):
    pass


_MATH_DISPLAY = re.compile(r"\$\$(.+?)\$\$", re.DOTALL)
# Inline math: a dollar not followed by whitespace/digit, content without newlines, closing dollar
# not preceded by whitespace and not followed by a digit (so "$5 and $6" is left alone).
_MATH_INLINE = re.compile(r"(?<![\\$\w])\$(?![\s$\d])((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?!\d)")
_BLANK = re.compile(r"_{3,}")
# Private-use characters survive both markdown-it and the sanitiser untouched.
_PLACEHOLDER = re.compile("(MATH|BLANK)(\\d+)")

_ALLOWED_TAGS = {
    "a",
    "abbr",
    "b",
    "blockquote",
    "br",
    "code",
    "dd",
    "del",
    "div",
    "dl",
    "dt",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "kbd",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "s",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
}
_ALLOWED_ATTRS = {
    "*": {"class", "lang", "dir", "title"},
    "a": {"href", "target"},
    "img": {"src", "alt", "width", "height", "loading"},
    "span": {"data-display", "data-blank", "data-tex"},
    "td": {"colspan", "rowspan", "align"},
    "th": {"colspan", "rowspan", "align", "scope"},
    "ol": {"start", "type"},
    "code": {"data-lang"},
    "pre": {"data-lang"},
}


def _highlight(code: str, lang: str | None) -> str:
    lexer = None
    if lang:
        try:
            lexer = get_lexer_by_name(lang)
        except ClassNotFound:
            lexer = None
    if lexer is None:
        if lang in (None, "", "text", "plain", "txt"):
            return html.escape(code)
        try:
            lexer = guess_lexer(code)
        except ClassNotFound:
            return html.escape(code)
    formatter = HtmlFormatter(nowrap=True, classprefix="tok-")
    return highlight(code, lexer, formatter)


def _code_block(code: str, lang: str | None) -> str:
    lang_attr = f' data-lang="{html.escape(lang)}"' if lang else ""
    body = _highlight(code, lang)
    cls = "code-block highlight"
    return f'<pre class="{cls}"{lang_attr}><code{lang_attr}>{body}</code></pre>\n'


def _make_md() -> MarkdownIt:
    md = MarkdownIt("commonmark", {"html": False, "linkify": False, "typographer": False})
    md.enable(["table", "strikethrough"])

    def fence(self: Any, tokens: list[Token], idx: int, options: Any, env: Any) -> str:
        token = tokens[idx]
        info = token.info.strip().split(maxsplit=1)
        lang = info[0] if info else None
        return _code_block(token.content.rstrip("\n") + "\n", lang)

    def code_block(self: Any, tokens: list[Token], idx: int, options: Any, env: Any) -> str:
        return _code_block(tokens[idx].content, None)

    md.add_render_rule("fence", fence)
    md.add_render_rule("code_block", code_block)
    return md


_md = _make_md()


@dataclass
class RenderContext:
    """Where relative links and images resolve to (the lesson's directory URL)."""

    base_url: str = ""

    def resolve(self, url: str) -> str:
        if not self.base_url:
            return url
        if re.match(r"^[a-z][a-z0-9+.-]*:", url) or url.startswith(("/", "#", "?")):
            return url
        return f"{self.base_url.rstrip('/')}/{url}"


def _protect(text: str, blanks: bool) -> tuple[str, list[str]]:
    stash: list[str] = []

    def keep(kind: str, payload: str) -> str:
        stash.append(payload)
        return f"{kind}{len(stash) - 1}"

    def display(m: re.Match[str]) -> str:
        tex = m.group(1).strip()
        return keep("MATH", f'<span class="math" data-display="1">{html.escape(tex)}</span>')

    def inline(m: re.Match[str]) -> str:
        tex = m.group(1).replace(r"\$", "$")
        return keep("MATH", f'<span class="math" data-display="0">{html.escape(tex)}</span>')

    # Fenced code must not have its contents touched: split on fences first.
    parts = re.split(r"(^```.*?^```[ \t]*$|^~~~.*?^~~~[ \t]*$)", text, flags=re.M | re.S)
    out: list[str] = []
    blank_n = 0
    for i, part in enumerate(parts):
        if i % 2 == 1:
            out.append(part)
            continue
        # Inline code spans are left alone too.
        segs = re.split(r"(`+[^`]*`+)", part)
        for j, seg in enumerate(segs):
            if j % 2 == 1:
                out.append(seg)
                continue
            seg = _MATH_DISPLAY.sub(display, seg)
            seg = _MATH_INLINE.sub(inline, seg)
            if blanks:

                def blank(_m: re.Match[str]) -> str:
                    nonlocal blank_n
                    tag = f'<span class="blank" data-blank="{blank_n}"></span>'
                    blank_n += 1
                    return keep("BLANK", tag)

                seg = _BLANK.sub(blank, seg)
            out.append(seg)
    return "".join(out), stash


def _restore(rendered: str, stash: list[str]) -> str:
    def put(m: re.Match[str]) -> str:
        return stash[int(m.group(2))]

    return _PLACEHOLDER.sub(put, rendered)


def _rewrite_urls(tokens: list[Token], ctx: RenderContext) -> None:
    for tok in tokens:
        if tok.children:
            _rewrite_urls(tok.children, ctx)
        if tok.type == "link_open":
            href = tok.attrGet("href")
            if href:
                tok.attrSet("href", ctx.resolve(href))
                if re.match(r"^https?:", href):
                    tok.attrSet("target", "_blank")
                    tok.attrSet("rel", "noopener")
        elif tok.type == "image":
            src = tok.attrGet("src")
            if src:
                tok.attrSet("src", ctx.resolve(src))
                tok.attrSet("loading", "lazy")


def sanitize(markup: str) -> str:
    return nh3.clean(
        markup,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        link_rel="noopener",
        url_schemes={"http", "https", "mailto"},
    )


def render_markdown(
    text: str, *, inline: bool = False, blanks: bool = False, ctx: RenderContext | None = None
) -> str:
    """Render markdown to sanitised HTML."""
    ctx = ctx or RenderContext()
    if text is None:
        return ""
    try:
        protected, stash = _protect(str(text), blanks)
        if inline:
            tokens = _md.parseInline(protected, {})
        else:
            tokens = _md.parse(protected, {})
        _rewrite_urls(tokens, ctx)
        rendered = _md.renderer.render(tokens, _md.options, {})
    except Exception as exc:  # markdown-it is forgiving; this is a safety net
        raise RenderError(f"markdown render failed: {exc}") from exc
    rendered = _restore(rendered, stash)
    return sanitize(rendered).strip()


def render_code(code: str, language: str | None) -> str:
    return sanitize(_code_block(str(code), language)).strip()


def render_fields(
    value: Any, schema: dict[str, Any], ctx: RenderContext | None = None, siblings: Any = None
) -> Any:
    """Walk ``value`` guided by ``schema`` and add ``<field>_html`` next to every x-format field.

    Returns a new structure; the input is not modified. ``siblings`` is the enclosing object,
    used so an ``x-format: code`` field can find its ``language``.
    """
    ctx = ctx or RenderContext()
    schema = _resolve_variant(value, schema)
    stype = schema.get("type")
    if isinstance(value, dict) and (stype == "object" or "properties" in schema):
        out: dict[str, Any] = {}
        props = schema.get("properties", {})
        for key, sub in value.items():
            sub_schema = props.get(key)
            if sub_schema is None:
                out[key] = sub
                continue
            out[key] = render_fields(sub, sub_schema, ctx, siblings=value)
            fmt = sub_schema.get("x-format")
            if fmt and isinstance(sub, str):
                out[f"{key}_html"] = _render_scalar(sub, fmt, sub_schema, value, ctx)
            elif isinstance(sub, list):
                item_schema = sub_schema.get("items")
                ifmt = item_schema.get("x-format") if isinstance(item_schema, dict) else None
                if ifmt:
                    out[f"{key}_html"] = [
                        _render_scalar(s, ifmt, item_schema, value, ctx)
                        if isinstance(s, str)
                        else s
                        for s in sub
                    ]
        return out
    if isinstance(value, list) and (stype == "array" or "items" in schema):
        item_schema = schema.get("items", {})
        fmt = item_schema.get("x-format") if isinstance(item_schema, dict) else None
        if fmt:
            # A list of x-format strings: the caller emits `<field>_html` as a parallel list.
            return [
                render_fields(v, item_schema, ctx, siblings) if not isinstance(v, str) else v
                for v in value
            ]
        return [render_fields(v, item_schema, ctx, siblings) for v in value]
    return value


def _render_scalar(
    text: str, fmt: str, schema: dict[str, Any], siblings: Any, ctx: RenderContext
) -> str:
    blanks = bool(schema.get("x-blanks"))
    if fmt == "markdown":
        return render_markdown(text, inline=False, blanks=blanks, ctx=ctx)
    if fmt == "markdown-inline":
        return render_markdown(text, inline=True, blanks=blanks, ctx=ctx)
    if fmt == "code":
        lang = None
        if isinstance(siblings, dict):
            lang = siblings.get("language") or siblings.get("lang")
        return render_code(text, lang)
    raise RenderError(f"unknown x-format {fmt!r}")


def _resolve_variant(value: Any, schema: dict[str, Any]) -> dict[str, Any]:
    """Pick the matching branch of oneOf/anyOf so nested x-format fields are found."""
    for key in ("oneOf", "anyOf"):
        variants = schema.get(key)
        if not variants:
            continue
        for variant in variants:
            vt = variant.get("type")
            if vt == "object" and isinstance(value, dict):
                return variant
            if vt == "array" and isinstance(value, list):
                return variant
            if vt == "string" and isinstance(value, str):
                return variant
            if vt in ("number", "integer") and isinstance(value, int | float):
                return variant
            if vt == "boolean" and isinstance(value, bool):
                return variant
    return schema


def collect_format_fields(schema: dict[str, Any], prefix: str = "") -> list[str]:
    """List dotted paths of x-format fields in a schema (used by tests and docs)."""
    out: list[str] = []
    for key, sub in schema.get("properties", {}).items():
        path = f"{prefix}{key}"
        if sub.get("x-format"):
            out.append(path)
        if sub.get("type") == "object":
            out.extend(collect_format_fields(sub, path + "."))
        if sub.get("type") == "array" and isinstance(sub.get("items"), dict):
            items = sub["items"]
            if items.get("x-format"):
                out.append(path + "[]")
            out.extend(collect_format_fields(items, path + "[]."))
    return out
