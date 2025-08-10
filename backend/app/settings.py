from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    cerebras_api_key: str = ""
    model_id: str = "gpt-oss-120b"
    json_enforce_strict: bool = True

    # ASR / Whisper
    whisper_model_id: str = "small.en"  # set to tiny.en for lower latency
    whisper_device: str = "cuda"        # "cuda" or "cpu"
    whisper_compute_type: str = "int8_float16"  # good default for RTX GPUs
    whisper_initial_prompt: str = (
        "alpha bravo charlie all carriers interceptors "
        "flank pincer hold advance screen intercept retreat patrol rally escort "
        "wall wedge sphere swarm column left right center speed zero one two three four five"
    )

    # Optional alternate ASR backend
    asr_provider: str = "whisper"  # or "vosk"
    vosk_model_path: str = ""       # e.g., C:/models/vosk-model-small-en-us-0.15


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


