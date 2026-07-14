from __future__ import annotations

import os
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree

from app.schemas import OptimizeRequest
from app.utils import safe_filename

PIPELINE_DIR = Path(__file__).resolve().parent / "epubkit_pipeline"
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from epub_processor import ProcessingOptions, process_epub  # noqa: E402
from metadata_handler import extract_metadata, format_filename  # noqa: E402


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
            eink_quantize=request.grayscale and request.eink_quantize,
            remove_fonts=request.remove_fonts,
            remove_unused_css=request.remove_css,
            light_novel_mode=request.light_novel,
            characters_per_reference_page=request.characters_per_reference_page,
            split_long_sections=request.split_long_sections,
            section_split_word_threshold=request.section_split_word_threshold,
            section_split_byte_threshold=request.section_split_byte_threshold,
            section_split_hard_byte_limit=request.section_split_hard_byte_limit,
            text_cleanup=request.text_cleanup,
            use_original_filename=request.use_original_filename,
            filename_render_first=request.filename_render_first,
            filename_render_second=request.filename_render_second,
        )
        report = process_epub(str(input_path), str(temp_path), options, progress)
        if not report.success:
            raise RuntimeError(report.error or "EPUB optimization failed")

        device_filename = preferred_output_filename(input_path, request, report.output_filename)
        final_path = _unique_path(output_dir / device_filename)
        os.replace(temp_path, final_path)
        return final_path, {
            "original_size": report.original_size,
            "optimized_size": report.optimized_size,
            "summary": report.summary(),
            "output_filename": final_path.name,
            "device_filename": device_filename,
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


def preferred_output_filename(input_path: Path, request: OptimizeRequest, rendered_name: str | None = None) -> str:
    if request.use_original_filename:
        return safe_filename(input_path.name, "optimized.epub")
    name = rendered_name or _render_output_filename(input_path, request) or input_path.name
    if not name.lower().endswith(".epub"):
        name += ".epub"
    return safe_filename(name, "optimized.epub")


def _render_output_filename(input_path: Path, request: OptimizeRequest) -> str:
    metadata = _epub_metadata_for_filename(input_path)
    first_value = _resolve_filename_render_value(request.filename_render_first, metadata)
    second_value = _resolve_filename_render_value(request.filename_render_second, metadata)
    return format_filename(first_value, second_value, "title-author")


def _resolve_filename_render_value(template: str, metadata: dict) -> str:
    value = (template or "").strip()
    if not value:
        return ""
    replacements = {
        "Book Title": metadata.get("title", ""),
        "Author": metadata.get("author", ""),
    }
    for token, replacement in replacements.items():
        value = value.replace(token, replacement or "")
    return " ".join(value.split())


def _epub_metadata_for_filename(path: Path) -> dict:
    try:
        with zipfile.ZipFile(path) as archive:
            container = etree.fromstring(archive.read("META-INF/container.xml"))
            rootfile = _first_element_by_local_name(container, "rootfile")
            if rootfile is None:
                return {}
            opf_path = rootfile.get("full-path")
            if not opf_path:
                return {}
            opf_tree = etree.ElementTree(etree.fromstring(archive.read(opf_path)))
            return extract_metadata(opf_tree)
    except (KeyError, OSError, zipfile.BadZipFile, etree.XMLSyntaxError):
        return {}


def _first_element_by_local_name(root: etree._Element, local_name: str) -> etree._Element | None:
    for element in root.iter():
        if not isinstance(element.tag, str):
            continue
        if etree.QName(element).localname == local_name:
            return element
    return None
