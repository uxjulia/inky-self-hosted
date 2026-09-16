from __future__ import annotations

import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.epub_validation import EpubValidationError, validate_epub_archive


class EpubValidationTests(unittest.TestCase):
    def test_accepts_complete_epub(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.epub"
            write_epub(path)
            validate_epub_archive(path)

    def test_rejects_missing_spine_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.epub"
            write_epub(path, include_chapter=False)
            with self.assertRaisesRegex(EpubValidationError, "reading-order file is missing"):
                validate_epub_archive(path)

    def test_accepts_missing_optional_cover_manifest_item(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.epub"
            write_epub(path, spine_idrefs=["cover", "chapter"])
            validate_epub_archive(path)

    def test_rejects_missing_non_cover_manifest_item(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.epub"
            write_epub(path, spine_idrefs=["missing", "chapter"])
            with self.assertRaisesRegex(EpubValidationError, "reading-order item 'missing' is not in the manifest"):
                validate_epub_archive(path)

    def test_rejects_truncated_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "book.epub"
            write_epub(path)
            path.write_bytes(path.read_bytes()[:-20])
            with self.assertRaisesRegex(EpubValidationError, "not a complete EPUB archive"):
                validate_epub_archive(path)


def write_epub(path: Path, *, include_chapter: bool = True, spine_idrefs: list[str] | None = None) -> None:
    spine_idrefs = spine_idrefs or ["chapter"]
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip")
        archive.writestr(
            "META-INF/container.xml",
            """<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
</container>""",
        )
        archive.writestr(
            "OEBPS/content.opf",
            f"""<package xmlns="http://www.idpf.org/2007/opf">
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine>{"".join(f'<itemref idref="{idref}"/>' for idref in spine_idrefs)}</spine>
</package>""",
        )
        if include_chapter:
            archive.writestr("OEBPS/chapter.xhtml", "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>Complete</body></html>")


if __name__ == "__main__":
    unittest.main()
