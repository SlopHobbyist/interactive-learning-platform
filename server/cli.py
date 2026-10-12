"""``ilp`` command line: validate, schema, ids, new, arrange."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer
from ruamel.yaml.comments import CommentedMap

from .app.config import settings
from .app.content.loader import LESSON_SUFFIX, item_hash_id, load_content
from .app.content.schema import write_schemas
from .app.content.validator import validate_index
from .app.content.yamlio import YamlError, dump_yaml, load_yaml, to_plain
from .app.elements.registry import scan_elements

app = typer.Typer(no_args_is_help=True, help="Interactive Learning Platform tools.")


@app.callback()
def _root() -> None:
    """Interactive Learning Platform tools."""


def _content_root(path: Path | None) -> tuple[Path, Path | None]:
    """Resolve (content root, optional sub-path filter) from an argument."""
    root = settings.content_dir
    if path is None:
        return root, None
    path = path.resolve()
    try:
        path.relative_to(root.resolve())
        return root, path
    except ValueError:
        # A path outside the configured content dir: treat it as its own content root.
        return path, None


@app.command()
def validate(
    path: Annotated[
        Path | None, typer.Argument(help="Content dir, subject/course/unit dir or lesson file.")
    ] = None,
    check_db: Annotated[
        bool,
        typer.Option("--check-db", help="Warn about progress rows whose paths no longer exist."),
    ] = False,
    warnings_as_errors: Annotated[
        bool, typer.Option("--strict", help="Treat warnings as errors.")
    ] = False,
) -> None:
    """Validate content. Prints `file:line: message` and exits non-zero on errors."""
    root, only = _content_root(path)
    registry = scan_elements(settings.elements_dir)
    index = load_content(root)
    problems = validate_index(index, registry, only=only)
    if check_db:
        from .app.db.checks import orphaned_paths  # lazy: Phase 5

        for p in orphaned_paths(index):
            problems.append(p)
    errors = 0
    for p in problems:
        typer.echo(p.format(Path.cwd()))
        if p.level == "error" or warnings_as_errors:
            errors += 1
    n_lessons = len(index.all_lessons())
    scope = f" under {only.relative_to(root)}" if only else ""
    if errors:
        typer.echo(f"\n{errors} error(s), {len(problems) - errors} warning(s){scope}.", err=True)
        raise typer.Exit(code=1)
    typer.echo(
        f"OK: {len(index.subjects)} subject(s), {n_lessons} lesson(s), "
        f"{len(registry.elements)} element(s), {len(problems)} warning(s){scope}."
    )


@app.command()
def schema(
    out: Annotated[Path | None, typer.Option(help="Output dir (default content/_schema).")] = None,
) -> None:
    """Write JSON Schemas for subject, course, unit and lesson files."""
    out_dir = out or (settings.content_dir / "_schema")
    registry = scan_elements(settings.elements_dir)
    for rp in registry.problems:
        typer.echo(str(rp), err=True)
    written = write_schemas(registry, out_dir)
    try:
        from .app.content.llm_context import write_llm_context  # Phase 9
    except ImportError:
        write_llm_context = None
    if write_llm_context is not None:
        written.append(write_llm_context(registry, out_dir))
    for p in written:
        typer.echo(f"wrote {p.relative_to(Path.cwd()) if p.is_relative_to(Path.cwd()) else p}")


@app.command()
def ids(
    path: Annotated[Path | None, typer.Argument(help="Content dir or lesson file.")] = None,
    write: Annotated[
        bool, typer.Option("--write", help="Fill explicit ids into the YAML files.")
    ] = False,
) -> None:
    """Show (or with --write, persist) the generated ids of items that have none."""
    root, only = _content_root(path)
    files = [only] if only and only.is_file() else sorted((only or root).rglob(f"*{LESSON_SUFFIX}"))
    changed = 0
    for f in files:
        try:
            raw = load_yaml(f)
        except YamlError as exc:
            typer.echo(str(exc), err=True)
            continue
        items = raw.get("items") if isinstance(raw, dict) else None
        if not isinstance(items, list):
            continue
        touched = False
        for i, item in enumerate(items):
            if not isinstance(item, CommentedMap) or "type" not in item or item.get("id"):
                continue
            plain = to_plain(item)
            fields = {k: v for k, v in plain.items() if k not in {"type", "id"}}
            new_id = item_hash_id(str(plain["type"]), fields)
            typer.echo(f"{f.relative_to(root).as_posix()} items[{i}] ({plain['type']}): {new_id}")
            if write:
                item.insert(1, "id", new_id)
                touched = True
        if touched:
            dump_yaml(raw, f)
            changed += 1
    if write:
        typer.echo(f"updated {changed} file(s)")


TEMPLATES = {
    "subject": (
        "subject.yaml",
        "title: New subject\n"
        "icon: school            # Material icon ligature name\n"
        "description: What this subject is about.\n",
    ),
    "course": (
        "course.yaml",
        "title: New course\n"
        "description: One learning goal, in a sentence.\n"
        "level: beginner\n"
        "tags: []\n",
    ),
    "unit": (
        "unit.yaml",
        "title: New unit\n"
        "description: A themed group of lessons.\n"
        "# requires: [other-unit]   # default: the previous unit\n",
    ),
    "lesson": (
        None,
        "title: New lesson\n"
        "xp: 10\n"
        "# requires: [other-lesson]   # default: the previous lesson in this unit\n"
        "items:\n"
        "  - type: explanation\n"
        "    body: |\n"
        "      Introduce the idea in a paragraph or two. **Markdown** works.\n"
        "  - type: multiple-choice\n"
        "    prompt: A question about the idea?\n"
        "    choices: [Right answer, Wrong answer, Another wrong answer]\n"
        "    answer: 0\n"
        "    explain: Why the right answer is right.\n",
    ),
}


@app.command()
def new(
    kind: Annotated[str, typer.Argument(help="subject | course | unit | lesson")],
    path: Annotated[Path, typer.Argument(help="Directory (subject/course/unit) or file (lesson).")],
) -> None:
    """Write a template file for a new subject, course, unit or lesson."""
    if kind not in TEMPLATES:
        typer.echo(f"kind must be one of {', '.join(TEMPLATES)}", err=True)
        raise typer.Exit(code=2)
    filename, body = TEMPLATES[kind]
    if filename is None:
        target = (
            path if path.name.endswith(LESSON_SUFFIX) else path.with_name(path.name + LESSON_SUFFIX)
        )
    else:
        target = path / filename
    if target.exists():
        typer.echo(f"{target} already exists", err=True)
        raise typer.Exit(code=1)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body, encoding="utf-8")
    typer.echo(f"wrote {target}")


@app.command()
def arrange(
    lesson: Annotated[Path, typer.Argument(help="A lesson file with arrange: auto.")],
    print_: Annotated[
        bool, typer.Option("--print", help="Print the generated items as YAML.")
    ] = True,
) -> None:
    """Show the items the auto-arranger generates for a lesson (Phase 8)."""
    try:
        from .app.content.arranger import arrange_lesson_file
    except ImportError:
        typer.echo("auto-arrange is not available yet (Phase 8)", err=True)
        raise typer.Exit(code=1) from None
    sys.stdout.write(arrange_lesson_file(lesson, scan_elements(settings.elements_dir)))


if __name__ == "__main__":
    app()
