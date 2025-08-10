from __future__ import annotations

import json
from typing import Any, Dict, Optional, Type

import httpx
from pydantic import BaseModel


async def _post_chat(api_key: str, model: str, messages: list[dict[str, str]]) -> str:
    url = "https://api.cerebras.ai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        # We will request plain text JSON string; server will validate.
        "temperature": 0.2,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    content = data["choices"][0]["message"]["content"]
    return content


def _build_system_prompt(schema_json: str) -> str:
    return (
        "You are a tactical AI converting RTS voice commands into JSON battle orders.\n"
        "You receive detailed battlefield telemetry and output STRICT JSON matching the schema.\n\n"
        "CRITICAL RULES:\n"
        "- Output only valid JSON. No markdown, no comments, no trailing commas.\n"
        "- For now, output a SINGLE command following the schema below.\n"
        "- Use world state to make intelligent tactical decisions.\n\n"
        "TACTICAL UNDERSTANDING:\n"
        "- Squad positions are {x,z} coordinates on a 100x100 battlefield\n"
        "- Positive X is east, negative X is west\n"
        "- Positive Z is north, negative Z is south\n"
        "- Speed 1-3 is cautious, 4-6 is normal, 7-10 is urgent/emergency\n"
        "- 'underAttack' means enemies within 30 units\n"
        "- Use 'towards_enemies' or 'away_from_enemies' for smart directions\n\n"
        "COMMAND EXAMPLES:\n"
        "- 'All squads attack' → targets:['alpha','bravo','charlie'], action:'attack'\n"
        "- 'Alpha flank left' → targets:['alpha'], action:'flank', direction:'left'\n"
        "- 'Retreat!' → targets:['all'], action:'retreat', speed:8\n\n"
        f"Schema:\n{schema_json}\n"
    )


async def generate_intent_json(
    *,
    text: str,
    schema_model: Type[BaseModel],
    context: Dict[str, Any],
    model: str,
    api_key: str,
    enforce_schema: bool,
) -> Dict[str, Any]:
    schema_instance = schema_model.model_json_schema()
    system_prompt = _build_system_prompt(json.dumps(schema_instance))
    user_prompt = (
        "Text command: " + text + "\n" +
        ("World state:\n" + json.dumps(context, indent=2) if context else "No context")
    )

    content = await _post_chat(
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    def try_parse(obj: str) -> Optional[Dict[str, Any]]:
        try:
            return json.loads(obj)
        except Exception:
            return None

    parsed = try_parse(content)
    if parsed is not None:
        try:
            schema_model.model_validate(parsed)
            return parsed
        except Exception:
            parsed = None

    if not enforce_schema:
        if parsed is None:
            raise RuntimeError("Model did not return valid JSON")
        return parsed

    # One-shot repair
    repair_prompt = (
        "The previous output failed validation. Return corrected JSON ONLY, no extra text.\n"
        f"Schema:\n{json.dumps(schema_instance)}\n"
        f"Previous output:\n{content}"
    )

    repaired = await _post_chat(
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
            {"role": "assistant", "content": content},
            {"role": "user", "content": repair_prompt},
        ],
    )
    parsed2 = try_parse(repaired)
    if parsed2 is None:
        raise RuntimeError("Repair failed: non-JSON output")
    # Final validation happens in route
    return parsed2


