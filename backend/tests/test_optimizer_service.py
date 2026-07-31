import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.optimizer.service import _unique_path, optimize_epub, preferred_output_filename
from app.schemas import OptimizeRequest


class OptimizerServiceTests(unittest.TestCase):
    def test_device_filename_does_not_use_local_collision_suffix(self):
        with tempfile.TemporaryDirectory(prefix="inky_optimizer_service_") as tmp:
            tmpdir = Path(tmp)
            epub_path = tmpdir / "source.epub"
            write_minimal_epub(epub_path, "The Book", "O'Brian")

            request = OptimizeRequest(filename_render_first="Book Title", filename_render_second="Author")
            device_filename = preferred_output_filename(epub_path, request)

            existing = tmpdir / device_filename
            existing.touch()
            local_cache_path = _unique_path(existing)

            self.assertEqual(device_filename, "The Book - O'Brian.epub")
            self.assertEqual(local_cache_path.name, "The Book - O'Brian-2.epub")

    def test_device_filename_can_use_original_filename(self):
        with tempfile.TemporaryDirectory(prefix="inky_optimizer_service_") as tmp:
            tmpdir = Path(tmp)
            epub_path = tmpdir / "Original Upload.epub"
            write_minimal_epub(epub_path, "The Book", "O'Brian")

            request = OptimizeRequest(use_original_filename=True)
            device_filename = preferred_output_filename(epub_path, request)

            self.assertEqual(device_filename, "Original Upload.epub")

    def test_device_filename_can_use_custom_render_text(self):
        with tempfile.TemporaryDirectory(prefix="inky_optimizer_service_") as tmp:
            tmpdir = Path(tmp)
            epub_path = tmpdir / "source.epub"
            write_minimal_epub(epub_path, "The Book", "O'Brian")

            request = OptimizeRequest(filename_render_first="My Copy", filename_render_second="Author")
            device_filename = preferred_output_filename(epub_path, request)

            self.assertEqual(device_filename, "My Copy - O'Brian.epub")

    def test_use_original_filename_is_passed_to_processor(self):
        captured_options = None

        def fake_process_epub(_input_path, output_path, options, _progress):
            nonlocal captured_options
            captured_options = options
            Path(output_path).write_bytes(Path(_input_path).read_bytes())
            return SimpleNamespace(
                success=True,
                error=None,
                output_filename="Original Upload.epub",
                original_size=100,
                optimized_size=50,
                summary=lambda: "optimized",
            )

        with tempfile.TemporaryDirectory(prefix="inky_optimizer_service_") as tmp:
            tmpdir = Path(tmp)
            epub_path = tmpdir / "Original Upload.epub"
            write_minimal_epub(epub_path, "The Book", "O'Brian")
            request = OptimizeRequest(use_original_filename=True)

            with patch("app.optimizer.service.process_epub", fake_process_epub):
                output_path, result = optimize_epub(epub_path, tmpdir / "out", request)

        self.assertIsNotNone(captured_options)
        self.assertTrue(captured_options.use_original_filename)
        self.assertEqual(output_path.name, "Original Upload.epub")
        self.assertEqual(result["device_filename"], "Original Upload.epub")

    def test_eink_quantize_is_disabled_when_grayscale_is_disabled(self):
        captured_options = None

        def fake_process_epub(_input_path, output_path, options, _progress):
            nonlocal captured_options
            captured_options = options
            Path(output_path).write_bytes(Path(_input_path).read_bytes())
            return SimpleNamespace(
                success=True,
                error=None,
                output_filename="optimized.epub",
                original_size=100,
                optimized_size=50,
                summary=lambda: "optimized",
            )

        with tempfile.TemporaryDirectory(prefix="inky_optimizer_service_") as tmp:
            tmpdir = Path(tmp)
            epub_path = tmpdir / "source.epub"
            write_minimal_epub(epub_path, "The Book", "O'Brian")
            request = OptimizeRequest(grayscale=False, eink_quantize=True)

            with patch("app.optimizer.service.process_epub", fake_process_epub):
                optimize_epub(epub_path, tmpdir / "out", request)

        self.assertIsNotNone(captured_options)
        self.assertFalse(captured_options.grayscale)
        self.assertFalse(captured_options.eink_quantize)

    def test_device_targets_are_forwarded_to_processor(self):
        expected_targets = {
            "x4": (800, 480),
            "x3": (792, 528),
            "sticky": (800, 480),
        }

        for device, (expected_width, expected_height) in expected_targets.items():
            with self.subTest(device=device), tempfile.TemporaryDirectory(prefix="inky_optimizer_service_") as tmp:
                captured_options = None

                def fake_process_epub(_input_path, output_path, options, _progress):
                    nonlocal captured_options
                    captured_options = options
                    Path(output_path).write_bytes(Path(_input_path).read_bytes())
                    return SimpleNamespace(
                        success=True,
                        error=None,
                        output_filename="optimized.epub",
                        original_size=100,
                        optimized_size=50,
                        summary=lambda: "optimized",
                    )

                tmpdir = Path(tmp)
                epub_path = tmpdir / "source.epub"
                write_minimal_epub(epub_path, "The Book", "O'Brian")

                with patch("app.optimizer.service.process_epub", fake_process_epub):
                    optimize_epub(epub_path, tmpdir / "out", OptimizeRequest(device=device))

                self.assertIsNotNone(captured_options)
                self.assertEqual(captured_options.target_device, device)
                self.assertEqual(captured_options.max_width, expected_width)
                self.assertEqual(captured_options.max_height, expected_height)


def write_minimal_epub(path: Path, title: str, author: str) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip")
        archive.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>""",
        )
        archive.writestr(
            "OEBPS/content.opf",
            f"""<?xml version="1.0"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata><dc:title>{title}</dc:title><dc:creator>{author}</dc:creator></metadata>
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>""",
        )
        archive.writestr("OEBPS/chapter.xhtml", "<html><body>Complete</body></html>")


if __name__ == "__main__":
    unittest.main()
