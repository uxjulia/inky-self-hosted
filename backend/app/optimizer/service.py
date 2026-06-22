from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

from app.schemas import OptimizeRequest
from app.utils import safe_filename

PIPELINE_DIR = Path(__file__).resolve().parent / "epubkit_pipeline"
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from epub_processor import ProcessingOptions, process_epub  # noqa: E402


def optimize_epub(input_path: Path, output_dir: Path, request: OptimizeRequest, progress=None) -> tuple[Path, dict]:
    output_dir.mkdir(parents=True, exist_ok=True)
    max_width, max_height = (800, 480) if request.device == "x4" else (792, 528)
    temp = tempfile.NamedTemporaryFile(prefix=".inky-", suffix=".epub", dir=output_dir, delete=False)
    temp_path = Path(temp.name)
    temp.close()

    try:
        options = ProcessingOptions(
            grayscale=request.grayscale,
            contrast_boost=request.contrast_boost,
            contrast_factor=request.contrast_factor,
            quality=request.quality,
            max_width=max_width,
            max_height=max_height,
            eink_quantize=request.eink_quantize,
            remove_fonts=request.remove_fonts,
            remove_unused_css=request.remove_css,
            light_novel_mode=request.light_novel,
            split_long_sections=request.split_long_sections,
            text_cleanup=request.text_cleanup,
        )
        report = process_epub(str(input_path), str(temp_path), options, progress)
        if not report.success:
            raise RuntimeError(report.error or "EPUB optimization failed")

        name = report.output_filename or input_path.name
        if not name.lower().endswith(".epub"):
            name += ".epub"
        final_path = _unique_path(output_dir / safe_filename(name, "optimized.epub"))
        os.replace(temp_path, final_path)
        return final_path, {
            "original_size": report.original_size,
            "optimized_size": report.optimized_size,
            "summary": report.summary(),
            "output_filename": final_path.name,
        }
    except Exception:
        if temp_path.exists():
            temp_path.unlink()
        raise


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(2, 10_000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"could not create unique filename for {path.name}")
