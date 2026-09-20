import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.config import get_settings
from app.models import Source
from app.schemas import BrowseItem


class OptimizerApiTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory(prefix="inky_optimizer_api_")
        self.root = Path(self.tmpdir.name)
        self.env = patch.dict(
            os.environ,
            {
                "INKY_DATABASE_URL": f"sqlite:///{self.root / 'inky.db'}",
                "INKY_DATA_DIR": str(self.root / "data"),
                "INKY_AUTH_USERNAME": "",
                "INKY_AUTH_PASSWORD": "",
            },
            clear=False,
        )
        self.env.start()
        get_settings.cache_clear()

    def tearDown(self):
        import app.db as db_module

        db_module.engine.dispose()
        self.env.stop()
        get_settings.cache_clear()
        self.tmpdir.cleanup()

    def test_invalid_uploaded_epub_returns_a_clear_client_error(self):
        from app.main import app

        with TestClient(app) as client:
            response = client.post(
                "/api/optimizer/epub",
                files={"file": ("not-a-book.epub", b"This is not a ZIP archive.", "application/epub+zip")},
            )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["detail"], "invalid EPUB: the file is not a complete EPUB archive")

    def test_uploaded_epub_surfaces_optimizer_failure(self):
        from app.main import app

        async def fail_optimization(*_args, **_kwargs):
            raise RuntimeError("This EPUB is DRM-protected. Please remove DRM first.")

        with (
            patch("app.main.init_db"),
            patch("app.main.run_in_threadpool", fail_optimization),
            TestClient(app) as client,
        ):
            response = client.post(
                "/api/optimizer/epub",
                files={"file": ("book.epub", complete_epub_bytes(), "application/epub+zip")},
            )

        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"], "This EPUB is DRM-protected. Please remove DRM first.")


def complete_epub_bytes() -> bytes:
    with tempfile.SpooledTemporaryFile() as archive_file:
        with zipfile.ZipFile(archive_file, "w") as archive:
            archive.writestr("mimetype", "application/epub+zip")
            archive.writestr(
                "META-INF/container.xml",
                """<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles>
</container>""",
            )
            archive.writestr(
                "OEBPS/content.opf",
                """<package xmlns="http://www.idpf.org/2007/opf">
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>""",
            )
            archive.writestr("OEBPS/chapter.xhtml", "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>Complete</body></html>")
        archive_file.seek(0)
        return archive_file.read()


class SourceDownloadAuthTests(unittest.IsolatedAsyncioTestCase):
    async def test_source_download_keeps_an_empty_basic_auth_password(self):
        captured: dict[str, object] = {}

        class FakeResponse:
            def raise_for_status(self):
                return None

            async def aiter_bytes(self, _chunk_size: int):
                yield b"epub bytes"

        class FakeStream:
            async def __aenter__(self):
                return FakeResponse()

            async def __aexit__(self, _exc_type, _exc, _traceback):
                return False

        class FakeClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, _exc_type, _exc, _traceback):
                return False

            def stream(self, method, url, *, auth):
                captured.update(method=method, url=url, auth=auth)
                return FakeStream()

        from app.main import source_item_to_temp_epub

        source = Source(type="opds", name="Mayberry", url="https://mayberry.pub", username="234444593", password="")
        item = BrowseItem(type="book", title="Example", url="https://mayberry.pub/download/example", media_type="application/epub+zip")
        with tempfile.TemporaryDirectory(prefix="inky_source_download_") as tmp:
            with patch("app.main.httpx.AsyncClient", FakeClient), patch("app.main.validate_downloaded_epub"):
                await source_item_to_temp_epub(source, item, Path(tmp))

        self.assertEqual(captured["method"], "GET")
        self.assertEqual(captured["auth"], ("234444593", ""))


if __name__ == "__main__":
    unittest.main()
