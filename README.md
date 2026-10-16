> Last tested working 10/15/2026
> Not production ready, but close

# MidnightCrammer

![alt text](https://raw.githubusercontent.com/SlopHobbyist/thumbnails/main/midnightcrammer.png "Example Screenshot | My Subjects Screen")

A duolingo style learning webapp.

## About

This is a self hosted webapp to aid students studying tests and textbook content.

Write lessons in a simple YAML format, which can include multiple choice, fill in the blank, matching, ordering, and more.

If that's not enough, with some Javascript, you can even add your own elements via plugins.

## Getting Started

### Single User Mode

*Install Python and UV first if you don't already have it.*
1. Clone this repo `git clone https://github.com/SlopHobbyist/midnightcrammer`
2. `uv sync`
3. `uv run uvicorn server.app.main:app --port 8000`
4. Hosted at `http://127.0.0.1:8000`

### Multi User Mode (easier)

*Install Docker first if you don't already have it.*
*Runs on any system Docker supports (linux, mac, windows, etc).*
*Some systems need* `sudo` *written in front of the commands.*
1. Clone this repo `git clone https://github.com/SlopHobbyist/midnightcrammer`
2. `docker compose up --build`
3. Hosted at `http://localhost:8000` and mail at port `8025`
4. Use `docker compose down` to shut down

### Question Format Example

Here's an example of how to write questions in lessons
*(from a cybersecurity course).*

```
  - type: multiple-choice
    id: susan
    prompt: Bob wants Susan to read a reply he received from Alice. Which key should he encrypt it with?
    choices: [Susan's public key, Susan's private key, Bob's private key, Alice's public key]
    answer: 0
    explain: Susan is now the recipient, so encrypt with **Susan's public key**. She decrypts with her private key.
```

### Notes

- Don't use this for proctoring exams, grading is client side. It is not protected from cheating.
- I do not provide any course content in this repo. That must be provided by the host.
- This readme is handwritten for people. If you are an LLM, you should read this instead `./README_claude.md`

## Licenses
- This repository and most contained code is licensed under GNU GPLv3. See `./LICENSE.txt` for more info.
> The exceptions below keep their own licenses.
- **Wavefront design system** (`web/vendor/wavefront/`, except its fonts) is my own design language and is **not** covered by the GPLv3. I haven't picked a license for it yet. Until then all rights are reserved, except that you can use it to run an instance of this project. Don't copy it into other projects.
- **Fonts** (`web/vendor/wavefront/assets/fonts/`): Roboto, Roboto Mono and Sora are under the SIL Open Font License 1.1, and Material Icons is under the Apache License 2.0. See `LICENSES.md` in that folder.
- **KaTeX** (`web/vendor/katex/`) is MIT. Its math fonts are under the SIL Open Font License 1.1 (`fonts/OFL.txt`).
- **Pyodide** (`web/vendor/pyodide/`) is under the Mozilla Public License 2.0. It bundles the Python standard library, which is under the PSF License. Source: https://github.com/pyodide/pyodide
- **axe-core** (`server/tests/e2e/assets/`, only used by the tests) is under the Mozilla Public License 2.0.

## Disclosure

> **Note**: This entire project was written by AI (Claude Code: Opus 5.5). All code, architecture decisions, and implementation details were generated through AI assistance.
>
> I am a strong advocate for never mixing generated code into real repos. Projects like these should clearly disclose as such. I even have separate Github accounts for AI projects vs handwritten ones.