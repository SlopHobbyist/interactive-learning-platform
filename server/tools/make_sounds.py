"""Generate the player's three tiny sound effects as WAV files (no external assets).

Run: uv run python server/tools/make_sounds.py
Writes web/assets/sounds/{correct,wrong,complete}.wav (mono, 22.05 kHz, 16-bit).
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parents[2] / "web" / "assets" / "sounds"


def tone(freq: float, seconds: float, volume: float = 0.4, shape: str = "sine") -> list[float]:
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


def write(name: str, samples: list[float]) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.wav"
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes(
            b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples)
        )
    return path


def main() -> None:
    correct = tone(660, 0.09) + tone(880, 0.14)
    wrong = tone(180, 0.18, 0.3, "square")
    complete = tone(523.25, 0.1) + tone(659.25, 0.1) + tone(783.99, 0.1) + tone(1046.5, 0.22)
    for name, samples in (("correct", correct), ("wrong", wrong), ("complete", complete)):
        p = write(name, samples)
        print(f"wrote {p} ({p.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
