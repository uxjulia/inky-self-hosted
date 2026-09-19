"""Child-process entry point for EPUB optimization."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from ..schemas import OptimizeRequest
from .service import optimize_epub


def main() -> int:
    if len(sys.argv) != 5:
        raise ValueError("expected input path, output directory, request JSON, and result path")
    input_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    request = OptimizeRequest.model_validate_json(sys.argv[3])
    result_path = Path(sys.argv[4])
    output_path, result = optimize_epub(input_path, output_dir, request)
    result_path.write_text(json.dumps({"output_path": str(output_path), "result": result}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
