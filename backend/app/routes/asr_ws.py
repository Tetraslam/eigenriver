from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services.asr_stream import AsrEngine as WhisperAsrEngine
from ..services.asr_vosk import VoskAsrEngine
from ..settings import get_settings

router = APIRouter()


# Protocol: client connects and sends JSON control messages and binary PCM chunks.
# Messages:
# - JSON {"type":"start", "sample_rate":16000, "language":"en"}
# - Binary: int16 PCM little-endian frames (80-120ms).
# - JSON {"type":"stop"} to end segment; server replies with final transcript.


@router.websocket("/stream")
async def ws_asr(websocket: WebSocket) -> None:
    await websocket.accept()
    engine: Optional[object] = None
    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"] is not None:
                if engine is None:
                    # Drop until we receive a start message
                    continue
                engine.push_audio(message["bytes"])  # type: ignore[arg-type]
                # No partial decoding: wait for explicit stop
                continue

            data = message.get("text")
            if not data:
                continue
            try:
                obj = json.loads(data)
            except json.JSONDecodeError:
                continue

            mtype = obj.get("type")
            if mtype == "start":
                if engine is not None:
                    engine.close()
                sample_rate = int(obj.get("sample_rate", 16000))
                language = str(obj.get("language", "en"))
                s = get_settings()
                if s.asr_provider.lower() == "vosk":
                    engine = VoskAsrEngine(sample_rate=sample_rate, language=language)
                else:
                    engine = WhisperAsrEngine(sample_rate=sample_rate, language=language)
                await websocket.send_json({"type": "ready"})
            elif mtype == "stop":
                if engine is None:
                    await websocket.send_json({"type": "error", "error": "no session"})
                    continue
                final_text = await engine.finalize_segment()
                await websocket.send_json({"type": "final", "text": final_text})
            else:
                await websocket.send_json({"type": "error", "error": f"unknown type: {mtype}"})
    except WebSocketDisconnect:
        pass
    finally:
        if engine is not None:
            engine.close()


