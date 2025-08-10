from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from typing import Optional

import numpy as np

from ..settings import get_settings

try:
    import vosk  # type: ignore
except Exception as e:  # pragma: no cover - optional dependency
    vosk = None  # type: ignore


_VOSK_SINGLETON: dict[str, "vosk.Model"] = {}


def _get_vosk_model(path: str):
    if vosk is None:
        raise RuntimeError("Vosk is not installed. Run: uv add vosk")
    if path == "":
        raise RuntimeError("Set VOSK_MODEL_PATH (or settings.vosk_model_path) to a local model directory")
    if path not in _VOSK_SINGLETON:
        _VOSK_SINGLETON[path] = vosk.Model(path)  # type: ignore[attr-defined]
    return _VOSK_SINGLETON[path]


GRAMMAR_TERMS = [
    # squads
    "alpha", "bravo", "charlie", "all", "carriers", "interceptors",
    # actions
    "flank", "pincer", "hold", "advance", "screen", "intercept", "retreat", "patrol", "rally", "escort",
    # formations
    "wall", "wedge", "sphere", "swarm", "column",
    # direction + params
    "left", "right", "center", "speed", "one", "two", "three", "four", "five", "zero",
]


@dataclass
class _Buffer:
    sample_rate: int
    pcm: bytearray


class VoskAsrEngine:
    def __init__(self, sample_rate: int = 16000, language: str = "en") -> None:
        s = get_settings()
        model = _get_vosk_model(s.vosk_model_path)
        if vosk is None:
            raise RuntimeError("Vosk not available")
        self.rec = vosk.KaldiRecognizer(model, sample_rate)  # type: ignore[attr-defined]
        self.rec.SetWords(True)
        # Restrict to our command grammar for robustness
        self.rec.SetGrammar(json.dumps(GRAMMAR_TERMS))
        self._buf = _Buffer(sample_rate=sample_rate, pcm=bytearray())
        self._lock = threading.Lock()

    def push_audio(self, pcm_bytes: bytes) -> None:
        with self._lock:
            self._buf.pcm.extend(pcm_bytes)
        # Feed recognizer immediately for partials
        self.rec.AcceptWaveform(pcm_bytes)

    def try_partial(self) -> Optional[str]:
        if vosk is None:
            return None
        j = self.rec.PartialResult()
        try:
            data = json.loads(j)
            return (data.get("partial") or "").strip() or None
        except Exception:
            return None

    async def finalize_segment(self) -> str:
        if vosk is None:
            return ""
        res = self.rec.FinalResult()
        try:
            data = json.loads(res)
            return (data.get("text") or "").strip()
        finally:
            # Reset buffer/stream state between segments
            self.rec.Reset()
            with self._lock:
                self._buf.pcm.clear()

    def close(self) -> None:
        # Vosk objects are GC-managed; nothing to close explicitly
        pass


