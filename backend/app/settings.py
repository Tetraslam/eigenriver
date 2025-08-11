from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    cerebras_api_key: str = ""
    model_id: str = "gpt-oss-120b"
    json_enforce_strict: bool = True

    # ASR / Whisper
    whisper_model_id: str = "large-v3"  # set to tiny.en for lower latency
    whisper_device: str = "cuda"        # "cuda" or "cpu"
    whisper_compute_type: str = "int8_float16"  # good default for RTX GPUs
    whisper_initial_prompt: str = (
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike "
        "november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu "
        "all squads deploy cycle between waypoints move help "
        "flank pincer hold advance screen intercept retreat patrol rally escort attack defend regroup "
        "wall wedge sphere swarm column circle triangle square "
        "left right up down forward backward center north south east west "
        "speed zero one two three four five six seven eight nine ten "
        "eighteen twenty thirty forty fifty hundred"
    )

    # Optional alternate ASR backend
    asr_provider: str = "whisper"  # or "vosk"
    vosk_model_path: str = ""       # e.g., C:/models/vosk-model-small-en-us-0.15


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


