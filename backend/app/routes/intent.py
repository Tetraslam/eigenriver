from __future__ import annotations

import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError

from ..schemas.intent_schema import FlexibleIntent, IntentCommand, MultiIntent
from ..services.cerebras import generate_intent_json
from ..services.game_logger import get_game_logger
from ..settings import get_settings

router = APIRouter()


class IntentRequest(BaseModel):
    text: str
    # Optional lightweight world context; forwarded to the LLM for grounding
    context: Optional[Dict[str, Any]] = None


class IntentResponse(BaseModel):
    intent: FlexibleIntent
    source: str  # "llm" or "fallback"


@router.post("/", response_model=IntentResponse)
async def post_intent(body: IntentRequest) -> IntentResponse:
    settings = get_settings()
    logger = get_game_logger()
    
    # Clean up the text (remove filler words)
    import re
    cleaned_text = re.sub(r'\b(uh|um|ah|er|like)\b', '', body.text, flags=re.IGNORECASE)
    cleaned_text = ' '.join(cleaned_text.split()).strip()  # Remove extra spaces
    
    if not cleaned_text:
        # If text is empty after cleanup, return empty intent
        logger.log_intent_request(body.text, body.context)
        intent = IntentCommand()
        logger.log_intent_response(intent.model_dump(), True)
        return IntentResponse(intent=intent, source="fallback")
    
    # Log the incoming request
    logger.log_intent_request(cleaned_text, body.context)

    # LLM call - use flexible schema that supports both single and multi-commands
    try:
        raw_json = await generate_intent_json(
            text=cleaned_text,
            schema_model=FlexibleIntent,  # Use the flexible union schema
            context=body.context or {},
            model=settings.model_id,
            api_key=settings.cerebras_api_key,
            enforce_schema=settings.json_enforce_strict,
        )
    except RuntimeError as e:
        logger.log_intent_response({}, False, str(e))
        raise HTTPException(status_code=502, detail=str(e)) from e

    # Validate & return - handle both single and multi-command responses
    try:
        # Check if it's a multi-command response
        if isinstance(raw_json, dict) and raw_json.get("type") == "multi":
            intent = MultiIntent.model_validate(raw_json)
        else:
            intent = IntentCommand.model_validate(raw_json)
        
        # Log successful response
        logger.log_intent_response(intent.model_dump(), True)
        
        return IntentResponse(intent=intent, source="llm")
    except ValidationError as e:
        # Log the error with the raw response for debugging
        error_msg = str(e)
        logger.log_intent_response(raw_json, False, f"Validation error: {error_msg}\n  Raw Response: {raw_json}")
        
        # Print for debugging
        print(f"[Intent] Validation failed. Raw response: {raw_json}")
        print(f"[Intent] Validation errors: {error_msg}")
        
        # Return an empty command as fallback
        intent = IntentCommand()
        return IntentResponse(intent=intent, source="fallback")