from __future__ import annotations

import json
from typing import Any, Dict, Optional

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
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                raise RuntimeError("Cerebras API rate limit reached. Please wait a moment before trying again.") from None
            raise RuntimeError(f"Cerebras API error: {e.response.status_code} {e.response.text}") from None
        data = resp.json()
    content = data["choices"][0]["message"]["content"]
    return content


def _build_system_prompt(schema_json: str) -> str:
    return (
        "You are a tactical AI converting RTS voice commands into JSON battle orders.\n"
        "You receive detailed battlefield telemetry and output STRICT JSON matching the schema.\n\n"
        "CRITICAL RULES:\n"
        "- Output only valid JSON. No markdown, no comments, no trailing commas.\n"
        "- If the user gives MULTIPLE commands, output {type:'multi', commands:[...]}\n"
        "- If the user gives a SINGLE command, output the command directly\n"
        "- Use world state to make intelligent tactical decisions.\n\n"
        "TACTICAL UNDERSTANDING:\n"
        "- Squad positions are {x,z} coordinates on a 100x100 battlefield\n"
        "- Positive X is east, negative X is west\n"
        "- Positive Z is north, negative Z is south\n"
        "- Speed 1-3 is cautious, 4-6 is normal, 7-10 is urgent/emergency\n"
        "- 'underAttack' means enemies within 30 units\n"
        "- Use 'towards_enemies' or 'away_from_enemies' for smart directions\n"
        "- Each unit is roughly 2 units wide, squads are 10-20 units across\n\n"
        "MOVEMENT AND WAYPOINTS:\n"
        "- 'move right/left/up/down' → relative movement (down=south=positive Z, up=north=negative Z)\n"
        "- 'move to delta' → single waypoint (waypointTargets: ['delta'])\n"
        "- 'cycle between waypoints' → waypointTargets: ['delta','echo','foxtrot'], cycleWaypoints: true\n"
        "- 'patrol between X and Y' → waypointTargets with cycleWaypoints: true\n"
        "- 'all squads on the top right' → targets: ['top_right_squads'] based on position\n"
        "- 'help alpha' → action: 'help', helpTarget: 'alpha'\n"
        "- Default distances: 40 units for directional moves, maintain 15+ unit spacing\n"
        "- Set maintainSpacing: true to prevent squad clustering\n\n"
        "SQUAD SELECTION:\n"
        "- Can use position-based selection: 'top_right_squads', 'left_side_squads', etc.\n"
        "- Can list specific squads: ['alpha', 'bravo', 'charlie']\n"
        "- 'all' selects every active squad\n"
        "- Analyze world.squads positions to determine which squads match descriptions\n\n"
        "DEPLOYMENT SYSTEM:\n"
        "- Players earn 1 squad point per enemy kill\n"
        "- 20 squad points = 1 deployable squad\n"
        "- To deploy: action:'deploy', deployCount:N\n"
        "- Can specify formation: deployFormation: 'circle'|'triangle'|'square'\n"
        "- New squads auto-spawn with names (delta, echo, foxtrot, etc.)\n"
        "- No artificial limit on deployment count\n"
        "- Check deployment.deployableSquads in world context\n\n"
        "COMMAND EXAMPLES:\n"
        "- 'All squads attack' → targets:['all'], action:'attack'\n"
        "- 'Alpha flank left' → targets:['alpha'], action:'flank', direction:'left'\n"
        "- 'All squads move right' → targets:['all'], relativeMovement:{x:40, z:0}, maintainSpacing:true\n"
        "- 'Move right' → targets:['all'], relativeMovement:{x:40, z:0}\n"
        "- 'All squads move down' → targets:['all'], relativeMovement:{x:0, z:40}, maintainSpacing:true\n"
        "- 'Deploy 5 squads' → action:'deploy', deployCount:5, deployFormation:'circle'\n"
        "- 'Deploy 18 squads' → action:'deploy', deployCount:18\n"
        "- 'Top right squads help alpha' → targets:['top_right_squads'], action:'help', helpTarget:'alpha'\n"
        "- 'Cycle between the waypoints' → targets:['all'], action:'patrol', waypointTargets:['delta','echo','foxtrot'], cycleWaypoints:true\n"
        "- 'Cycle between waypoints and deploy 5' → {type:'multi', commands:[\n"
        "    {targets:['all'], waypointTargets:['delta','echo','foxtrot'], cycleWaypoints:true},\n"
        "    {action:'deploy', deployCount:5}\n"
        "  ]}\n"
        "- 'Retreat!' → targets:['all'], action:'retreat', speed:8\n\n"
        f"Schema:\n{schema_json}\n"
    )


async def generate_intent_json(
    *,
    text: str,
    schema_model: Any,  # Can be a Union type or BaseModel
    context: Dict[str, Any],
    model: str,
    api_key: str,
    enforce_schema: bool,
) -> Dict[str, Any]:
    # Handle Union types (FlexibleIntent) by creating a simple schema
    from typing import Union as UnionType
    from typing import get_origin
    
    if get_origin(schema_model) is UnionType:
        # For Union types, we'll use a simplified schema
        schema_instance = {
            "description": "Flexible intent that can be single or multi-command",
            "anyOf": [
                {"$ref": "#/definitions/IntentCommand"},
                {"$ref": "#/definitions/MultiIntent"}
            ],
            "definitions": {
                "IntentCommand": {
                    "type": "object",
                    "properties": {
                        "targets": {"type": "array", "items": {"type": "string"}},
                        "action": {"type": "string"},
                        "formation": {"type": "string"},
                        "direction": {"type": "string"},
                        "speed": {"type": "integer", "minimum": 0, "maximum": 10},
                        "path": {"type": "array"},
                        "zone": {"type": "object"},
                        "deployCount": {"type": "integer", "minimum": 1},
                        "deployFormation": {"type": "string"},
                        "waypointTargets": {"type": "array", "items": {"type": "string"}},
                        "cycleWaypoints": {"type": "boolean"},
                        "pathCycle": {"type": "boolean"},
                        "relativeMove": {"type": "object"},
                        "relativeMovement": {"type": "object"},
                        "helpTarget": {"type": "string"},
                        "targetSquad": {"type": "string"},
                        "maintainSpacing": {"type": "boolean"}
                    }
                },
                "MultiIntent": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "const": "multi"},
                        "commands": {
                            "type": "array",
                            "items": {"$ref": "#/definitions/IntentCommand"}
                        }
                    },
                    "required": ["type", "commands"]
                }
            }
        }
    else:
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


