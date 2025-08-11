# Eigenriver

## What is this?

Single-laptop, browser 3D "commander" game: control human starfleets with **hands + voice**. Hands do spatial intent (where); voice sets strategy (what/which/how fast). Survive waves; style points for clean formations and chained kills. Inspired by Ender's Game.

## Recent Improvements (12/2024)

### Features Added:
- **Waypoint Navigation**: Voice commands like "move to delta" or "all squads move to echo" for landmark-based navigation
- **Relative Movement**: Commands like "move right", "alpha and bravo move left" with intelligent distance calculations
- **4 Squad Types** with unique abilities:
  - **Assault** (Red): Fast, rapid fire, low HP
  - **Sniper** (Purple): Slow, long range, high damage
  - **Bomber** (Orange): Medium speed, spread shots
  - **Defender** (Blue): Tanky, dual cannons
- **GPU-Optimized Rendering**: Instanced rendering for 1000s of units at 60fps on RTX 4080
- **Progressive Wave System**: 6 wave patterns (surround, blitz, pincer, artillery, swarm, boss)
- **Sound Effects**: Strategic audio with laser sounds, announcements, and wave alerts
- **Squad Deployment System**: Earn squad points from kills, deploy new squads dynamically

## Core loop (how it feels)

* Raise right hand: a fingertip reticle appears.
* Pinch to select a squad; pinch-drag to sketch a spline path; release to commit.
* Speak: “Bravo wedge speed two, pincer right.” Fleets reflow; a short confirm plays.
* Left hand open = camera clutch: move to orbit, palm up/down to dolly, pinch to zoom.
* Enemy waves escalate; keep fleets alive and stylish.

## Stack (final cut)

* Frontend: **Vite + React + Three.js** (WebGPU preferred; WebGL fallback), **postprocessing**, **WebAudio** for SFX/TTS.
* Vision: **MediaPipe Tasks JS – Hand Landmarker**.
* Voice:

  * **WebRTC VAD** gating (and use **Picovoice Cobra** as fallback option).
  * **faster-whisper (CTranslate2)** for streaming ASR (tiny.en/small.en, int8, greedy).
  * **GPT-OSS-120B on Cerebras** for intent and complex instructions→strict JSON schema using structured output.
* Backend: **FastAPI + Pydantic** (intent router + Cerebras proxy). Langgraph for confirm/clarify/help (tiny).
* Simulation/Render: **WebGPU compute** boids + utility fields; **instanced meshes** for rendering. WebGL fallback uses GPGPU textures.
* Tooling: **TypeScript**, **ESBuild/Vite**, **pnpm**.

## Input mapping (simple & intuitive)

**Voice = strategy + nouns + parameters**
**Hands = spatial intent + camera**

* Voice (examples):

  * “Alpha and Bravo wedge speed two pincer right”
  * “All units form wall tight”
  * “Carriers launch interceptors, screen front”
* Right hand (commanding):

  * Pinch near squad icon = select
  * Pinch-drag = draw path spline
  * Flick = short dash/boost
  * Open palm to camera = hold/defend
* Left hand (camera clutch):

  * Open = clutch; move to orbit (azimuth/elevation)
  * Palm up/down = dolly
  * Pinch = zoom
  * Wrist yaw = mild roll
* Two-hand:

  * Spread = widen formation
  * Rotate (both) = rotate formation
  * Both open = tactical tilt map + slight slow-mo (0.7x)

**Mode ring** at fingertip for clarity:

* white idle / blue select / green path / gold camera / purple voice-active

## Voice pipeline (low-latency)

1. Mic → **WebRTC VAD** (aggressiveness 2–3, hangover \~300ms)
2. Chunk 80–120ms frames with 50–100ms overlap
3. **faster-whisper** (GPU, int8, beam=1) → partials + final
4. Router:

   * If matches grammar → emit JSON immediately
   * Else → send text to **GPT-OSS-120B (Cerebras)** with strict JSON schema
5. Client receives JSON → updates GPU buffers; TTS a 1-sec confirmation

**Swap to Cobra**: set `VAD_PROVIDER=cobra` if venue noise causes chattiness.

## Strict JSON schema

Example JSON schema (this is a work in progress, NOT FINAL):

```json
{
  "targets": ["alpha","bravo","charlie","all","carriers","interceptors"],
  "action": "flank|pincer|hold|advance|screen|intercept|retreat|patrol|rally|escort",
  "formation": "none|wall|wedge|sphere|swarm|column",
  "direction": "left|right|center|bearing|vector|none",
  "speed": 1,
  "path": [[0,0,0]],          // optional; from drawn spline
  "zone": {"type":"sphere","center":[0,0,0],"r":10}  // optional area command
}
```

Hands fill `path`/`zone`. Voice fills everything else. If voice omits geometry, use the **last drawn** path/point.

## Intent/confirm FSM (LangGraph)

States: `Idle → Heard → Parsed → (NeedsClarify? yes:no) → Confirm → Dispatch → Idle`

* “help” branch: list 6 example commands + highlight visible squads.
* Clarify pattern (one-shot): “Confirm: ‘Bravo pincer right speed two’?” Y/N.
* Cooldown: 300ms to avoid partial spam.

## Enemy behavior

* **Utility AI** on top of boids:

  * Influence fields in SSBOs: threat, ally density, objective pull.
  * Roles (add more):

    * Interceptors: maximize TTK on nearest path
    * Bombers: seek low-threat corridors to capital ships
    * Capitals: anchor objectives, directional shields (force flanks)
  * Decision per tick: `argmax {attack, flee, regroup, capture}` with simple linear scores.
* Waves: seeded, escalating (speed+, HP+, archetypes). Boss = spawner + shield arc.

## Performance targets (RTX 4080 laptop; don't optimize for this)

* WebGPU compute: **20–50k** ships @ 60 FPS (instancing + compact SSBOs)
* WebGL fallback: **8–12k** via GPGPU textures
* Mesh budgets: \~60 verts fighter, \~120 verts cruiser; distant LOD = billboards

## Fallbacks & safety rails

* Confidence gates: ignore gestures <0.7, and only chest and above
* “High-confidence only” toggle for MediaPipe
* Keyboard cheats: `1/2/3` pick group, `G` draw sample spline, `R` reset wave
* Overlay HUD (debug): FPS, ship count, mode, last JSON command, ASR latency

## Setup

```bash
# Frontend
cd frontend
pnpm i
pnpm dev   # http://localhost:5173

# Backend (FastAPI)
cd backend
uv venv
uv pip install -r requirements.txt
uv run main.py

# Env
# FRONTEND
VITE_VAD_PROVIDER=webrtc        # or cobra
VITE_ASR_BACKEND=http://localhost:8000/asr
VITE_INTENT_BACKEND=http://localhost:8000/intent
VITE_WEBGPU=1                   # set 0 to force WebGL

# BACKEND
CEREBRAS_API_KEY=...
MODEL_ID=gpt-oss-120b
JSON_ENFORCE_STRICT=1
```

## Folder structure  (NOT FINAL)

```
/frontend
  /src
    /engine          # render, instancing, post, assets
    /sim             # boids compute, fields, SSBO mgmt
    /input
      mediapipe/     # hand tracker wrapper
      gestures/      # pinch/drag/flick FSM + $1 recognizer
      vad/           # webrtc or cobra adapter
      asr/           # faster-whisper client
    /voice
      grammar.ts     # fast local matches
      schema.ts      # JSON types
      router.ts      # local->Cerebras fallthrough
    /ui              # HUD, debug overlay
/backend
  main.py            # FastAPI app
  routes/intent.py   # Pydantic validate -> Cerebras call
  routes/asr.py      # (optional) server-side ASR path
  intent_fsm/        # tiny confirm/clarify/help reducer
```

## Tuning cheatsheet

* **WebRTC VAD**: aggressiveness 2–3; hangover 250–400ms; 16kHz mono
* **Whisper**: tiny.en/small.en; int8; beam=1; chunk 0.6–0.8s; 50–100ms overlap
* **Gestures**: pinch\_strength > 0.7; fingertip accel threshold for flick; palm normal dot(camera) > 0.5 for “hold”
* **Camera**: left-hand clutch only; clamp zoom; ease orbit

## Demo script (90s, NOT FINAL)

1. Calibrate: left-hand orbit, zoom in/out; mode ring shows gold.
2. Select Alpha (blue), draw arc (green). Ships align as you draw.
3. “Bravo wedge speed two pincer right” → purple pulse + JSON overlay → formation shifts.
4. Two-hand spread to widen; flick to dash; interceptors chain kills with shockwave FX.
5. Clarify: “Carriers launch… screen front” → “Confirm?” → “Yes.”

Also this is an arcade-like game, so there will be a score system and a leaderboard.

## Roadmap (post-hack)

* Multi-squad lasso; spline libraries; saved maneuvers
* Threat-aware auto-formations
* Headset mode (WebXR Hand Input / Unity + XR Hands)
* Replay system and highlight reels