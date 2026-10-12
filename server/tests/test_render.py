from __future__ import annotations

from server.app.content.render import RenderContext, render_fields, render_markdown


def test_basic_markdown_and_sanitising():
    html = render_markdown("**bold** and <script>alert(1)</script> *em*")
    assert "<strong>bold</strong>" in html
    assert "<script" not in html
    assert "alert(1)" in html  # text kept, tag stripped
    assert "<em>em</em>" in html


def test_inline_has_no_paragraph():
    assert render_markdown("just `code`", inline=True) == "just <code>code</code>"


def test_math_is_protected_from_markdown():
    html = render_markdown(r"Energy: $E = mc^2$ and $$a_b * c_d$$")
    assert '<span class="math" data-display="0">E = mc^2</span>' in html
    assert '<span class="math" data-display="1">a_b * c_d</span>' in html
    assert "<em>" not in html  # the underscores and * did not become emphasis
    # Currency is left alone.
    assert "math" not in render_markdown("It costs $5 and then $6 more.")


def test_fenced_code_is_highlighted_and_untouched_by_math():
    html = render_markdown("```python\nprint('$x$')\n```")
    assert 'class="code-block highlight"' in html
    assert 'data-lang="python"' in html
    assert 'class="tok-' in html
    assert "math" not in html


def test_blanks():
    html = render_markdown("The ___ is ___.", blanks=True)
    assert html.count('<span class="blank"') == 2
    assert 'data-blank="1"' in html
    # Without the flag the underscores are plain text.
    assert "blank" not in render_markdown("The ___ is here.")


def test_relative_images_and_links_resolve_against_base_url():
    ctx = RenderContext(base_url="/content/s/c/u")
    html = render_markdown("![map](map.png) [doc](notes.md) [ext](https://example.org)", ctx=ctx)
    assert 'src="/content/s/c/u/map.png"' in html
    assert 'href="/content/s/c/u/notes.md"' in html
    assert 'href="https://example.org"' in html
    assert 'rel="noopener"' in html
    assert 'loading="lazy"' in html


def test_render_fields_adds_html_siblings():
    schema = {
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "x-format": "markdown"},
            "choices": {
                "type": "array",
                "items": {"type": "string", "x-format": "markdown-inline"},
            },
            "pairs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "left": {"type": "string", "x-format": "markdown-inline"},
                        "right": {"type": "string", "x-format": "markdown-inline"},
                    },
                },
            },
            "snippet": {"type": "string", "x-format": "code"},
            "language": {"type": "string"},
            "answer": {"type": "integer"},
        },
    }
    item = {
        "type": "x",
        "id": "i",
        "prompt": "*p*",
        "choices": ["**a**", "b"],
        "pairs": [{"left": "`l`", "right": "r"}],
        "snippet": "x = 1",
        "language": "python",
        "answer": 0,
    }
    out = render_fields(item, schema)
    assert out["prompt_html"] == "<p><em>p</em></p>"
    assert out["choices_html"] == ["<strong>a</strong>", "b"]
    assert out["pairs"][0]["left_html"] == "<code>l</code>"
    assert out["pairs"][0]["right_html"] == "r"
    assert 'class="tok-' in out["snippet_html"]
    assert out["answer"] == 0 and out["type"] == "x" and out["id"] == "i"
    assert "answer_html" not in out
    # Input untouched.
    assert "prompt_html" not in item
