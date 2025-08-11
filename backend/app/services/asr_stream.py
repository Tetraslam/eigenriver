from __future__ import annotations

import io
import threading
from dataclasses import dataclass
from typing import Optional

import numpy as np
from faster_whisper import WhisperModel

from ..settings import get_settings

_MODEL_SINGLETON: dict[str, WhisperModel] = {}


def _get_model() -> WhisperModel:
    # Lazy-load singleton model (small.en by default for quality; tune to tiny.en for latency)
    if "model" not in _MODEL_SINGLETON:
        s = get_settings()
        print(f"[ASR] Loading Whisper model: {s.whisper_model_id} on {s.whisper_device}")
        try:
            _MODEL_SINGLETON["model"] = WhisperModel(
                s.whisper_model_id,
                device=s.whisper_device,
                compute_type=s.whisper_compute_type,
            )
        except Exception:
            # Fallback to CPU if CUDA/cuDNN not available
            _MODEL_SINGLETON["model"] = WhisperModel(
                s.whisper_model_id,
                device="cpu",
                compute_type="int8",
            )
    return _MODEL_SINGLETON["model"]


def ensure_model_loaded() -> None:
    """Preload the ASR model at process start to avoid first-request stall."""
    _ = _get_model()


@dataclass
class _Buffer:
    sample_rate: int
    pcm: bytearray


class AsrEngine:
    def __init__(self, sample_rate: int = 16000, language: str = "en") -> None:
        self.sample_rate = sample_rate
        self.language = language
        self._buf = _Buffer(sample_rate=sample_rate, pcm=bytearray())
        self._lock = threading.Lock()

    def push_audio(self, pcm_bytes: bytes) -> None:
        with self._lock:
            self._buf.pcm.extend(pcm_bytes)

    def try_partial(self) -> Optional[str]:
        # Cheap heuristic: decode only when buffer is long enough; return last segment text
        with self._lock:
            if len(self._buf.pcm) < int(0.8 * self.sample_rate) * 2:  # ~0.8s at 16kHz, 16-bit
                return None
            # Copy a snapshot to avoid long lock
            snapshot = bytes(self._buf.pcm)

        audio = np.frombuffer(snapshot, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = _get_model().transcribe(
            audio,
            language=self.language,
            condition_on_previous_text=False,
            vad_filter=True,
            beam_size=1,
            initial_prompt=get_settings().whisper_initial_prompt or None,
            no_speech_threshold=0.8,
        )
        # Take only the last segment text to avoid hallucinated prefixes
        last_text = ""
        for seg in segments:
            last_text = seg.text
        last_text = last_text.strip()
        return last_text or None

    async def finalize_segment(self) -> str:
        with self._lock:
            snapshot = bytes(self._buf.pcm)
            self._buf.pcm.clear()

        if not snapshot:
            return ""

        audio = np.frombuffer(snapshot, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = _get_model().transcribe(
            audio,
            language=self.language,
            condition_on_previous_text=False,
            vad_filter=True,
            beam_size=1,
            initial_prompt=get_settings().whisper_initial_prompt or None,
            no_speech_threshold=0.8,
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return text

    def close(self) -> None:
        # Nothing to close per-session; model is global
        pass


