from __future__ import annotations

import json
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError, field_validator

from ..services.cerebras import generate_intent_json
from ..settings import get_settings

router = APIRouter()


Target = Literal[
    "alpha",
    "bravo",
    "charlie",
    "all",
    "carriers",
    "interceptors",
]

Action = Literal[
    "flank",
    "pincer",
    "hold",
    "advance",
    "screen",
    "intercept",
    "retreat",
    "patrol",
    "rally",
    "escort",
    "attack",
    "defend",
    "regroup",
    "focus_fire",
    "deploy",  # Deploy new squads
]

Formation = Literal["none", "wall", "wedge", "sphere", "swarm", "column", "line", "diamond"]
Direction = Literal["left", "right", "center", "north", "south", "east", "west", "bearing", "vector", "none", "towards_enemies", "away_from_enemies"]


class Zone(BaseModel):
    type: Literal["sphere"]
    center: Tuple[float, float, float]
    r: float = Field(gt=0)


class SingleIntent(BaseModel):
    targets: List[Target]
    action: Action
    formation: Formation
    direction: Direction
    speed: int = Field(ge=0, le=10)
    path: Optional[List[Tuple[float, float, float]]] = None
    zone: Optional[Zone] = None
    deployCount: Optional[int] = Field(None, ge=1, le=10)  # For deploy action

    @field_validator("path")
    @classmethod
    def valid_path(cls, v: Optional[List[Tuple[float, float, float]]]):
        if v is None:
            return v
        if len(v) == 0:
            raise ValueError("path cannot be empty when provided")
        return v

class MultiIntent(BaseModel):
    type: Literal["multi"]
    commands: List[SingleIntent]

from typing import Union

Intent = Union[SingleIntent, MultiIntent]


class IntentRequest(BaseModel):
    text: str
    # Optional lightweight world context; forwarded to the LLM for grounding
    context: Optional[Dict[str, Any]] = None


class IntentResponse(BaseModel):
    intent: Intent
    source: Literal["grammar", "llm", "repaired"]


@router.post("/", response_model=IntentResponse)
async def post_intent(body: IntentRequest) -> IntentResponse:
    settings = get_settings()

    # 1) TODO: fast grammar path — keep for later; always fallthrough to LLM for now
    # For hackathon day 1, rely on LLM + strict server validation

    # 2) LLM call - use SingleIntent as the base schema
    try:
        raw_json = await generate_intent_json(
            text=body.text,
            schema_model=SingleIntent,  # Use SingleIntent for schema generation
            context=body.context or {},
            model=settings.model_id,
            api_key=settings.cerebras_api_key,
            enforce_schema=settings.json_enforce_strict,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    # 3) Validate & return - check if it's a multi-command response
    try:
        # First check if it's a multi-command
        if isinstance(raw_json, dict) and raw_json.get("type") == "multi":
            intent = MultiIntent.model_validate(raw_json)
        else:
            intent = SingleIntent.model_validate(raw_json)
        return IntentResponse(intent=intent, source="llm")
    except ValidationError as e:
        # If enforce_schema is on, the generator already tried to repair once.
        raise HTTPException(status_code=422, detail=e.errors()) from e


