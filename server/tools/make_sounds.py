"""Generate the player's sound packs as WAV files (no external assets).

Run: uv run python server/tools/make_sounds.py
Writes web/assets/sounds/<pack>/{correct,wrong,complete}.wav (mono, 22.05 kHz, 16-bit) for each
pack in the shop (server/app/shop.yaml). Combo Climb writes correct-1.wav .. correct-8.wav
instead of correct.wav: one note per step of a run of correct answers.
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parents[2] / "web" / "assets" / "sounds"


def note(n: int) -> float:
    """Frequency of a MIDI note number (69 = A4 = 440 Hz)."""
    return 440.0 * 2 ** ((n - 69) / 12)


def tone(freq: float, seconds: float, volume: float = 0.4, shape: str = "sine") -> list[float]:
    """The classic pack's voice: a tone with a quick fade in and out."""
    n = int(RATE * seconds)
    out = []
    for i in range(n):
        t = i / RATE
        env = min(1.0, i / (RATE * 0.01)) * min(1.0, (n - i) / (RATE * 0.05))  # quick fade in/out
        if shape == "sine":
            v = math.sin(2 * math.pi * freq * t)
        else:  # soft square for the "wrong" buzz
            v = 0.6 * (1 if math.sin(2 * math.pi * freq * t) >= 0 else -1) + 0.4 * math.sin(
                2 * math.pi * freq * t
            )
        out.append(v * volume * env)
    return out


def mallet(freq: float, seconds: float, volume: float = 0.5, decay: float = 9.0) -> list[float]:
    """A struck bar: the fundamental plus the marimba's 4th partial, both decaying fast."""
    n = int(RATE * seconds)
    out = []
    for i in range(n):
        t = i / RATE
        attack = min(1.0, i / (RATE * 0.003))
        v = math.sin(2 * math.pi * freq * t) * math.exp(-decay * t)
        v += 0.25 * math.sin(2 * math.pi * freq * 3.93 * t) * math.exp(-decay * 3 * t)
        out.append(v * volume * attack)
    return out


def pulse(freq: float, seconds: float, volume: float = 0.22, duty: float = 0.5) -> list[float]:
    """A chiptune pulse wave with a hard on and a short release."""
    n = int(RATE * seconds)
    out = []
    for i in range(n):
        phase = (i * freq / RATE) % 1.0
        env = min(1.0, (n - i) / (RATE * 0.015))
        out.append((1.0 if phase < duty else -1.0) * volume * env)
    return out


def slide(f0: float, f1: float, seconds: float, volume: float = 0.22) -> list[float]:
    """A pulse that bends from f0 to f1 (the chiptune "wrong")."""
    n = int(RATE * seconds)
    out, phase = [], 0.0
    for i in range(n):
        f = f0 + (f1 - f0) * i / n
        phase = (phase + f / RATE) % 1.0
        env = min(1.0, (n - i) / (RATE * 0.03))
        out.append((1.0 if phase < 0.5 else -1.0) * volume * env)
    return out


def bell(freq: float, seconds: float, volume: float = 0.4) -> list[float]:
    """A soft bell: the fundamental and its octave, with a gentle decay."""
    n = int(RATE * seconds)
    out = []
    for i in range(n):
        t = i / RATE
        attack = min(1.0, i / (RATE * 0.004))
        v = math.sin(2 * math.pi * freq * t) * math.exp(-5 * t)
        v += 0.3 * math.sin(2 * math.pi * freq * 2 * t) * math.exp(-8 * t)
        out.append(v * volume * attack)
    return out


def rest(seconds: float) -> list[float]:
    return [0.0] * int(RATE * seconds)


def overlap(*parts: tuple[float, list[float]]) -> list[float]:
    """Mix sounds that start at the given offsets (seconds)."""
    length = max(int(RATE * at) + len(s) for at, s in parts)
    out = [0.0] * length
    for at, s in parts:
        start = int(RATE * at)
        for i, v in enumerate(s):
            out[start + i] += v
    return out


def write(pack: str, name: str, samples: list[float]) -> Path:
    folder = OUT / pack
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{name}.wav"
    peak = max((abs(s) for s in samples), default=0.0)
    if peak > 0.9:  # overlapping notes add up; scale down rather than clip
        samples = [s * 0.9 / peak for s in samples]
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes(
            b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples)
        )
    return path


def packs() -> dict[str, dict[str, list[float]]]:
    C5, E5, G5, C6 = 72, 76, 79, 84
    climb_scale = [72, 74, 76, 77, 79, 81, 83, 84]  # C major, C5 to C6
    return {
        "classic": {
            "correct": tone(660, 0.09) + tone(880, 0.14),
            "wrong": tone(180, 0.18, 0.3, "square"),
            "complete": tone(523.25, 0.1)
            + tone(659.25, 0.1)
            + tone(783.99, 0.1)
            + tone(1046.5, 0.22),
        },
        "marimba": {
            "correct": overlap((0, mallet(note(C5), 0.35)), (0.08, mallet(note(G5), 0.45))),
            "wrong": overlap(
                (0, mallet(note(52), 0.3, 0.5, 14)), (0.1, mallet(note(48), 0.35, 0.5, 14))
            ),
            "complete": overlap(
                *[(i * 0.09, mallet(note(n), 0.5)) for i, n in enumerate((C5, E5, G5, C6))],
                (0.36, mallet(note(G5), 0.6, 0.3)),
            ),
        },
        "chiptune": {
            "correct": pulse(note(C6), 0.05, duty=0.25) + pulse(note(88), 0.1, duty=0.25),
            "wrong": slide(note(55), note(43), 0.22),
            "complete": pulse(note(C5), 0.07)
            + pulse(note(E5), 0.07)
            + pulse(note(G5), 0.07)
            + pulse(note(C6), 0.07)
            + rest(0.03)
            + pulse(note(G5), 0.06)
            + pulse(note(C6), 0.22),
        },
        "climb": {
            **{f"correct-{i + 1}": bell(note(n), 0.4) for i, n in enumerate(climb_scale)},
            "wrong": bell(note(45), 0.35, 0.35),
            "complete": overlap(
                *[(i * 0.06, bell(note(n), 0.5, 0.3)) for i, n in enumerate(climb_scale)],
                (0.5, bell(note(C6), 0.8, 0.35)),
            ),
        },
    }


def main() -> None:
    for pack, sounds in packs().items():
        for name, samples in sounds.items():
            p = write(pack, name, samples)
            print(f"wrote {p.relative_to(OUT)} ({p.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
