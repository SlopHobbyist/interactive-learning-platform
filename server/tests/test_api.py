from __future__ import annotations


def test_subjects(client):
    r = client.get("/api/subjects")
    assert r.status_code == 200
    subjects = r.json()
    assert {s["id"] for s in subjects} >= {"example", "capitals", "coding"}
    assert subjects[0]["course_count"] == 1

    r = client.get("/api/subjects/example")
    assert r.status_code == 200
    assert [c["id"] for c in r.json()["courses"]] == ["demo"]
    assert client.get("/api/subjects/nope").status_code == 404


def test_course_tree_has_no_item_bodies(client):
    r = client.get("/api/courses/example/demo")
    assert r.status_code == 200
    course = r.json()
    assert course["subject"]["id"] == "example"
    assert [u["id"] for u in course["units"]] == ["basics", "practice"]
    basics = course["units"][0]
    assert [lsn["id"] for lsn in basics["lessons"]] == ["waves", "typing"]
    typing = basics["lessons"][1]
    assert typing["requires"] == ["basics/waves"]
    assert typing["path"] == "example/demo/basics/typing"
    assert typing["item_count"] == 6
    assert typing["graded_count"] == 5
    assert "items" not in typing
    assert course["units"][1]["requires"] == ["basics"]
    assert client.get("/api/courses/example/nope").status_code == 404


def test_course_textbook_downloads(client):
    [book] = client.get("/api/courses/example/demo").json()["textbooks"]
    assert book["url"] == "/content/example/demo/textbook.pdf"
    assert (book["label"], book["filename"], book["format"]) == (
        "textbook.pdf",
        "textbook.pdf",
        "PDF",
    )
    r = client.get(book["url"])
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF-") and len(r.content) == book["size"]
    # Course cards on the subject page carry it too; courses without one get [].
    cards = client.get("/api/subjects/example").json()["courses"]
    assert cards[0]["textbooks"] == [book]
    assert client.get("/api/courses/capitals/europe").json()["textbooks"] == []


def test_lesson_renders_items(client):
    r = client.get("/api/lessons/example/demo/basics/waves")
    assert r.status_code == 200
    lesson = r.json()
    assert lesson["path"] == "example/demo/basics/waves"
    assert lesson["base_url"] == "/content/example/demo/01-basics"
    items = lesson["items"]
    assert [it["type"] for it in items][:3] == ["explanation", "multiple-choice", "true-false"]
    intro = items[0]
    assert intro["graded"] is False
    assert "<strong>wave</strong>" in intro["body_html"]
    mc = items[1]
    assert mc["graded"] is True
    assert mc["answer"] == 0
    assert mc["choices_html"] == ["Energy", "The water itself", "The pebble", "Nothing"]
    assert "<strong>energy</strong>" in mc["explain_html"]
    formula = items[4]
    assert '<span class="math" data-display="1">v = f \\lambda</span>' in formula["body_html"]
    assert client.get("/api/lessons/example/demo/basics/nope").status_code == 404


def test_lesson_blanks_and_pairs(client):
    typing = client.get("/api/lessons/example/demo/basics/typing").json()
    bank = next(it for it in typing["items"] if it["id"] == "fill-bank")
    assert bank["prompt_html"].count('class="blank"') == 2
    matching = client.get("/api/lessons/example/demo/practice/matching").json()
    pairs = matching["items"][0]["pairs"]
    assert pairs[0]["left_html"] == "Wavefront"
    assert pairs[0]["right_html"] == "Where the wave has reached"


def test_elements_registry(client):
    r = client.get("/api/elements")
    assert r.status_code == 200
    elements = {e["type"]: e for e in r.json()}
    assert len(elements) == 10
    mc = elements["multiple-choice"]
    assert mc["module"] == "/elements/multiple-choice/element.js"
    assert mc["graded"] is True
    assert "choices" in mc["schema"]["properties"]
    assert elements["explanation"]["graded"] is False
    assert elements["flashcard"]["self_graded"] is True

    examples = client.get("/api/elements/order/examples").json()
    assert examples[0]["id"] == "events"
    assert len(examples[0]["steps_html"]) == 4
    assert client.get("/api/elements/nope").status_code == 404


def test_static_mounts(client):
    assert client.get("/elements/multiple-choice/element.json").status_code == 200
    assert client.get("/content/example/subject.yaml").status_code == 200
    assert client.get("/api/health").json()["status"] == "ok"
