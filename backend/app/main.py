from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes.asr_ws import router as asr_ws_router
from .routes.intent import router as intent_router
from .services.asr_stream import ensure_model_loaded
from .win_cuda_path import add_cuda_paths


def create_app() -> FastAPI:
    # Ensure CUDA/cuDNN DLL directories are in the DLL search path (Windows)
    add_cuda_paths()
    app = FastAPI(title="Eigenriver Backend", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True}

    app.include_router(intent_router, prefix="/intent", tags=["intent"])
    app.include_router(asr_ws_router, prefix="/asr", tags=["asr"])

    return app


app = create_app()


@app.on_event("startup")
async def _warm_start() -> None:
    # Preload the ASR model so it is ready when the first WS connects
    ensure_model_loaded()


