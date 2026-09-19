"""Run memory-intensive EPUB optimization outside the web-server process."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

from ..config import get_settings
from ..heavy_work import HEAVY_WORK_LOCK, WAITING_FOR_HEAVY_WORK_MESSAGE
from ..schemas import OptimizeRequest


ProgressCallback = Callable[[int, str], None]


def optimize_epub_isolated(
    input_path: Path,
    output_dir: Path,
    request: OptimizeRequest,
    progress: ProgressCallback | None = None,
) -> tuple[Path, dict]:
    """Optimize one EPUB in a child process and return only its small result."""

    output_dir.mkdir(parents=True, exist_ok=True)
    result_file = tempfile.NamedTemporaryFile(
        prefix=".inky-worker-result-", suffix=".json", dir=output_dir, delete=False
    )
    result_path = Path(result_file.name)
    result_file.close()

    try:
        if progress:
            progress(10, WAITING_FOR_HEAVY_WORK_MESSAGE)
        with HEAVY_WORK_LOCK:
            if progress:
                progress(15, "Optimizing EPUB")
            try:
                completed = subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "app.optimizer.worker",
                        str(input_path),
                        str(output_dir),
                        request.model_dump_json(),
                        str(result_path),
                    ],
                    cwd=Path(__file__).resolve().parents[2],
                    env=os.environ.copy(),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=get_settings().optimizer_timeout_seconds,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError("EPUB optimization exceeded the server time limit") from exc

        if completed.returncode != 0:
            detail = completed.stderr.strip()[-2000:] or "worker exited without an error message"
            raise RuntimeError(f"EPUB optimization worker failed: {detail}")

        try:
            payload = json.loads(result_path.read_text())
            output_path = Path(payload["output_path"])
            result = payload["result"]
        except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError("EPUB optimization worker returned an invalid result") from exc
        if not output_path.is_file() or not isinstance(result, dict):
            raise RuntimeError("EPUB optimization worker did not produce an EPUB")
        if progress:
            progress(95, "Finishing optimization")
        return output_path, result
    finally:
        result_path.unlink(missing_ok=True)
