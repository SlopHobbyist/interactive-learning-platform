"""Walk ``content/`` and build an in-memory index.

Rules implemented here:

* Directory and file slugs are the ids. A numeric prefix (``01-``) sets the order and is stripped.
  ``id:`` in the YAML overrides the slug.
* A unit requires the previous unit unless it declares ``requires``.
* A lesson requires the previous lesson in its unit unless it declares ``requires``. Entries may
  be ``lesson`` (same unit) or ``unit/lesson``; they are normalised to ``unit/lesson``.
* An item without ``id`` gets ``<type>-<8 hex chars of a content hash>``.

Structural problems are collected, not raised, so one broken file never takes the app down.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from .models import CourseMeta, LessonFile, SubjectMeta, UnitMeta
from .problems import Problem
from .yamlio import YamlError, line_of, load_yaml, to_plain

PREFIX_RE = re.compile(r"^\d+[-_.]?")
LESSON_SUFFIX = ".lesson.yaml"


def slug_of(name: str) -> str:
    """``01-greetings`` → ``greetings``; ``03_intro.lesson.yaml`` → ``intro``."""
    if name.endswith(LESSON_SUFFIX):
        name = name[: -len(LESSON_SUFFIX)]
    elif name.endswith(".yaml"):
        name = name[:-5]
    stripped = PREFIX_RE.sub("", name)
    return (stripped or name).lower()


def sort_key(path: Path) -> tuple[int, str]:
    m = re.match(r"^(\d+)", path.name)
    return (int(m.group(1)) if m else 10**9, path.name)


def item_hash_id(type_: str, fields: dict[str, Any]) -> str:
    canon = json.dumps(fields, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha1(canon.encode("utf-8")).hexdigest()[:8]
    return f"{type_}-{digest}"


@dataclass
class Lesson:
    id: str
    title: str
    description: str
    xp: int
    requires: list[str]  # normalised to "unit/lesson"
    explicit_requires: bool
    items: list[dict[str, Any]]  # plain dicts, each with a resolved "id"
    arrange: str | None
    source: dict[str, Any] | None
    map: dict[str, float] | None
    file: Path
    raw: Any
    order: int
    unit_id: str = ""
    course_id: str = ""
    subject_id: str = ""
    generated: bool = False  # items were (partly) produced by the arranger

    @property
    def path(self) -> str:
        return f"{self.subject_id}/{self.course_id}/{self.unit_id}/{self.id}"

    @property
    def key(self) -> str:
        """``unit/lesson`` — unique inside a course."""
        return f"{self.unit_id}/{self.id}"

    def to_summary(self, registry: Any = None) -> dict[str, Any]:
        graded = None
        if registry is not None:
            graded = sum(
                1 for it in self.items if (m := registry.get(it["type"])) is not None and m.graded
            )
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "xp": self.xp,
            "requires": self.requires,
            "path": self.path,
            "item_count": len(self.items),
            "graded_count": graded,
            "arrange": self.arrange,
            "map": self.map,
        }


@dataclass
class Unit:
    id: str
    title: str
    description: str
    requires: list[str]
    explicit_requires: bool
    lessons: list[Lesson]
    dir: Path
    raw: Any
    order: int
    course_id: str = ""
    subject_id: str = ""

    def lesson(self, lesson_id: str) -> Lesson | None:
        return next((lsn for lsn in self.lessons if lsn.id == lesson_id), None)


@dataclass
class Course:
    id: str
    title: str
    description: str
    level: str
    tags: list[str]
    units: list[Unit]
    dir: Path
    raw: Any
    order: int
    subject_id: str = ""

    def unit(self, unit_id: str) -> Unit | None:
        return next((u for u in self.units if u.id == unit_id), None)

    def lessons(self) -> list[Lesson]:
        return [lsn for u in self.units for lsn in u.lessons]

    def lesson_by_key(self, key: str) -> Lesson | None:
        unit_id, _, lesson_id = key.partition("/")
        unit = self.unit(unit_id)
        return unit.lesson(lesson_id) if unit else None

    def to_summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "level": self.level,
            "tags": self.tags,
            "unit_count": len(self.units),
            "lesson_count": sum(len(u.lessons) for u in self.units),
        }


@dataclass
class Subject:
    id: str
    title: str
    icon: str
    description: str
    color: str | None
    courses: list[Course]
    dir: Path
    order: int

    def course(self, course_id: str) -> Course | None:
        return next((c for c in self.courses if c.id == course_id), None)

    def to_summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "icon": self.icon,
            "description": self.description,
            "color": self.color,
            "course_count": len(self.courses),
        }


@dataclass
class ContentIndex:
    root: Path
    subjects: list[Subject] = field(default_factory=list)
    problems: list[Problem] = field(default_factory=list)

    def subject(self, subject_id: str) -> Subject | None:
        return next((s for s in self.subjects if s.id == subject_id), None)

    def course(self, subject_id: str, course_id: str) -> Course | None:
        s = self.subject(subject_id)
        return s.course(course_id) if s else None

    def lesson(
        self, subject_id: str, course_id: str, unit_id: str, lesson_id: str
    ) -> Lesson | None:
        c = self.course(subject_id, course_id)
        if not c:
            return None
        u = c.unit(unit_id)
        return u.lesson(lesson_id) if u else None

    def all_lessons(self) -> list[Lesson]:
        return [lsn for s in self.subjects for c in s.courses for lsn in c.lessons()]

    def errors(self) -> list[Problem]:
        return [p for p in self.problems if p.level == "error"]


# --------------------------------------------------------------------------- loading


def _pydantic_problems(exc: ValidationError, path: Path, raw: Any) -> list[Problem]:
    out = []
    for err in exc.errors():
        loc = list(err["loc"])
        where = ".".join(str(p) for p in loc) if loc else "(document)"
        msg = err["msg"]
        if err["type"] == "extra_forbidden":
            msg = f"unknown field {loc[-1]!r}"
            where = ".".join(str(p) for p in loc[:-1]) or "(document)"
        elif err["type"] == "missing":
            msg = f"missing required field {loc[-1]!r}"
            where = ".".join(str(p) for p in loc[:-1]) or "(document)"
        elif err["type"] == "value_error":
            msg = msg.removeprefix("Value error, ")
        out.append(
            Problem(path, line_of(raw, loc), f"{where}: {msg}" if where != "(document)" else msg)
        )
    return out


def _load_meta(
    path: Path, model: type[BaseModel], problems: list[Problem], tolerant: bool = False
) -> tuple[Any, Any]:
    """Return (model_instance | None, raw).

    With ``tolerant=True`` a file that fails validation still yields a best-effort instance (its
    problems are recorded) so that the children of a subject/course/unit are still checked.
    """
    try:
        raw = load_yaml(path)
    except YamlError as exc:
        problems.append(Problem(path, exc.line, exc.message))
        return (_fallback(model, None) if tolerant else None), None
    if not isinstance(raw, dict):
        problems.append(Problem(path, 1, "top level must be a mapping (key: value pairs)"))
        return (_fallback(model, None) if tolerant else None), raw
    try:
        return model.model_validate(to_plain(raw)), raw
    except ValidationError as exc:
        problems.extend(_pydantic_problems(exc, path, raw))
        return (_fallback(model, raw) if tolerant else None), raw


def _fallback(model: type[BaseModel], raw: Any) -> BaseModel:
    """An unvalidated instance keeping only the simple string fields that are present."""
    data = to_plain(raw) if isinstance(raw, dict) else {}
    kwargs = {k: v for k, v in data.items() if k in model.model_fields and isinstance(v, str)}
    kwargs.setdefault("title", "(invalid)")
    return model.model_construct(**kwargs)


def load_lesson(path: Path, order: int, problems: list[Problem]) -> Lesson | None:
    model, raw = _load_meta(path, LessonFile, problems)
    if model is None:
        return None
    assert isinstance(model, LessonFile)
    items: list[dict[str, Any]] = []
    for it in model.items:
        data = it.model_dump()
        fields = {k: v for k, v in data.items() if k not in {"type", "id"}}
        data["id"] = it.id or item_hash_id(it.type, fields)
        items.append(data)
    return Lesson(
        id=model.id or slug_of(path.name),
        title=model.title,
        description=model.description,
        xp=model.xp,
        requires=list(model.requires) if model.requires is not None else [],
        explicit_requires=model.requires is not None,
        items=items,
        arrange=model.arrange,
        source=model.source.model_dump() if model.source else None,
        map=model.map.model_dump() if model.map else None,
        file=path,
        raw=raw,
        order=order,
    )


def load_unit(dir_: Path, order: int, problems: list[Problem]) -> Unit | None:
    meta_path = dir_ / "unit.yaml"
    if not meta_path.is_file():
        problems.append(Problem(dir_, 1, "unit directory has no unit.yaml"))
        return None
    model, raw = _load_meta(meta_path, UnitMeta, problems, tolerant=True)
    if model is None:
        return None
    assert isinstance(model, UnitMeta)
    lessons: list[Lesson] = []
    files = sorted((p for p in dir_.iterdir() if p.name.endswith(LESSON_SUFFIX)), key=sort_key)
    for i, f in enumerate(files):
        lesson = load_lesson(f, i, problems)
        if lesson:
            lessons.append(lesson)
    unit = Unit(
        id=model.id or slug_of(dir_.name),
        title=model.title,
        description=model.description,
        requires=list(model.requires) if model.requires is not None else [],
        explicit_requires=model.requires is not None,
        lessons=lessons,
        dir=dir_,
        raw=raw,
        order=order,
    )
    if not lessons:
        problems.append(Problem(meta_path, 1, "unit has no *.lesson.yaml files", "warning"))
    return unit


def load_course(dir_: Path, order: int, problems: list[Problem]) -> Course | None:
    meta_path = dir_ / "course.yaml"
    if not meta_path.is_file():
        problems.append(Problem(dir_, 1, "course directory has no course.yaml"))
        return None
    model, raw = _load_meta(meta_path, CourseMeta, problems, tolerant=True)
    if model is None:
        return None
    assert isinstance(model, CourseMeta)
    units: list[Unit] = []
    dirs = sorted(
        (p for p in dir_.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))),
        key=sort_key,
    )
    for i, d in enumerate(dirs):
        unit = load_unit(d, i, problems)
        if unit:
            units.append(unit)
    return Course(
        id=model.id or slug_of(dir_.name),
        title=model.title,
        description=model.description,
        level=model.level,
        tags=list(model.tags),
        units=units,
        dir=dir_,
        raw=raw,
        order=order,
    )


def load_subject(dir_: Path, order: int, problems: list[Problem]) -> Subject | None:
    meta_path = dir_ / "subject.yaml"
    if not meta_path.is_file():
        problems.append(Problem(dir_, 1, "subject directory has no subject.yaml"))
        return None
    model, _raw = _load_meta(meta_path, SubjectMeta, problems, tolerant=True)
    if model is None:
        return None
    assert isinstance(model, SubjectMeta)
    courses: list[Course] = []
    dirs = sorted(
        (p for p in dir_.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))),
        key=sort_key,
    )
    for i, d in enumerate(dirs):
        course = load_course(d, i, problems)
        if course:
            courses.append(course)
    return Subject(
        id=model.id or slug_of(dir_.name),
        title=model.title,
        icon=model.icon,
        description=model.description,
        color=model.color,
        courses=courses,
        dir=dir_,
        order=order,
    )


def _wire(index: ContentIndex) -> None:
    """Fill parent ids, apply default ``requires`` and normalise lesson requires."""
    for s in index.subjects:
        for c in s.courses:
            c.subject_id = s.id
            for ui, u in enumerate(c.units):
                u.course_id = c.id
                u.subject_id = s.id
                if not u.explicit_requires and ui > 0:
                    u.requires = [c.units[ui - 1].id]
                for li, lsn in enumerate(u.lessons):
                    lsn.unit_id = u.id
                    lsn.course_id = c.id
                    lsn.subject_id = s.id
                    if not lsn.explicit_requires:
                        lsn.requires = [u.lessons[li - 1].key] if li > 0 else []
                    else:
                        lsn.requires = [r if "/" in r else f"{u.id}/{r}" for r in lsn.requires]


def _check_duplicates(index: ContentIndex) -> None:
    def dupes(things: list[Any], what: str, where: Any) -> None:
        seen: dict[str, Any] = {}
        for t in things:
            if t.id in seen:
                first = seen[t.id]
                index.problems.append(
                    Problem(
                        getattr(t, "file", None) or t.dir / where,
                        1,
                        f"duplicate {what} id {t.id!r} "
                        f"(also used by {getattr(first, 'file', None) or first.dir})",
                    )
                )
            else:
                seen[t.id] = t

    dupes(index.subjects, "subject", "subject.yaml")
    for s in index.subjects:
        dupes(s.courses, "course", "course.yaml")
        for c in s.courses:
            dupes(c.units, "unit", "unit.yaml")
            for u in c.units:
                dupes(u.lessons, "lesson", "")
                for lsn in u.lessons:
                    seen: dict[str, int] = {}
                    for i, it in enumerate(lsn.items):
                        if it["id"] in seen:
                            index.problems.append(
                                Problem(
                                    lsn.file,
                                    line_of(lsn.raw, ["items", i]),
                                    f"duplicate item id {it['id']!r} (first used by item "
                                    f"{seen[it['id']] + 1})",
                                )
                            )
                        else:
                            seen[it["id"]] = i


def load_content(root: Path) -> ContentIndex:
    index = ContentIndex(root=root)
    if not root.is_dir():
        index.problems.append(Problem(root, 1, "content directory does not exist"))
        return index
    dirs = sorted(
        (p for p in root.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))),
        key=sort_key,
    )
    for i, d in enumerate(dirs):
        subject = load_subject(d, i, index.problems)
        if subject:
            index.subjects.append(subject)
    _wire(index)
    from .arranger import expand_auto  # local import: the arranger imports this module

    expand_auto(index)
    _check_duplicates(index)
    return index
