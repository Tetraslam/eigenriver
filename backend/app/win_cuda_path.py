from __future__ import annotations

import os
import sys
from pathlib import Path


def add_cuda_paths() -> None:
    """On Windows, extend DLL search path so CUDA/cuDNN DLLs are discoverable.

    Python 3.8+ restricts DLL search paths. If cuDNN is installed under CUDA, or a
    custom directory is set via CUDNN_PATH, add their /bin folder.
    """
    if sys.platform != "win32":
        return

    add_dir = getattr(os, "add_dll_directory", None)
    if add_dir is None:
        return

    candidates: list[Path] = []
    cuda_path = os.environ.get("CUDA_PATH")
    if cuda_path:
        candidates.append(Path(cuda_path) / "bin")

    # Common default install locations
    for ver in ("v12.6", "v12.5", "v12.4", "v12.3", "v12.2", "v12.1", "v12.0"):
        candidates.append(Path("C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA") / ver / "bin")

    cudnn_path = os.environ.get("CUDNN_PATH")
    if cudnn_path:
        candidates.append(Path(cudnn_path))

    # Deduplicate and add
    seen: set[Path] = set()
    for p in candidates:
        p = p.resolve()
        if p in seen:
            continue
        seen.add(p)
        if p.exists():
            try:
                add_dir(str(p))  # type: ignore[misc]
            except Exception:
                pass


