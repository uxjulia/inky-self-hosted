import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.optimizer.service import _unique_path, preferred_output_filename
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
</package>""",
        )


if __name__ == "__main__":
    unittest.main()
