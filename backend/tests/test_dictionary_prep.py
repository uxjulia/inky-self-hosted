import gzip
import io
import importlib
import os
import struct
import sys
import tarfile
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import zstandard

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

import app.dictionary_prep as dictionary_prep
from app.config import get_settings
from app.dictionary_prep import (
    DictionaryPrepError,
    is_supported_dictionary_archive,
    prepare_dictionary_zip,
    schedule_existing_prepared_dictionary_cleanup,
)


class DictionaryPrepServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory(prefix="inky_dictionary_prep_")
        self.root = Path(self.tmpdir.name)

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_dict_dz_generates_prepared_indexes(self):
        source = self._zip_dictionary(dict_dz=True)
        result = prepare_dictionary_zip(source, self.root / "out")

        names = self._zip_names(Path(result["output_path"]))
        self.assertIn("sample/sample.dict", names)
        self.assertNotIn("sample/sample.dict.dz", names)
        self.assertIn("sample/sample.idx.oft", names)
        self.assertIn("sample/sample.idx.oft.cspt", names)

    def test_uncompressed_dict_remains_valid(self):
        source = self._zip_dictionary(dict_dz=False)
        result = prepare_dictionary_zip(source, self.root / "out")

        names = self._zip_names(Path(result["output_path"]))
        self.assertIn("sample/sample.dict", names)
        self.assertIn("sample/sample.idx.oft", names)
        self.assertNotIn("sample/sample.dict.dz", names)

    def test_tar_zst_generates_prepared_indexes(self):
        source = self.root / "dictionary.tar.zst"
        _write_tar_zst(
            source,
            {
                "sample/sample.ifo": _ifo_bytes("sample"),
                "sample/sample.idx": _idx_bytes(),
                "sample/sample.dict.dz": _gzip_bytes(b"alpha definition\nbeta definition"),
            },
        )

        result = prepare_dictionary_zip(source, self.root / "out")

        names = self._zip_names(Path(result["output_path"]))
        self.assertIn("sample/sample.dict", names)
        self.assertIn("sample/sample.idx.oft", names)
        self.assertIn("sample/sample.idx.oft.cspt", names)

    def test_rar_generates_prepared_indexes(self):
        source = self.root / "dictionary.rar"
        source.write_bytes(b"fake rar bytes")
        archive = _FakeRarArchive(
            {
                "sample/sample.ifo": _ifo_bytes("sample"),
                "sample/sample.idx": _idx_bytes(),
                "sample/sample.dict.dz": _gzip_bytes(b"alpha definition\nbeta definition"),
            }
        )

        with (
            patch("app.dictionary_prep._prefer_available_unar", return_value=None),
            patch("app.dictionary_prep.rarfile.RarFile", return_value=archive),
        ):
            result = prepare_dictionary_zip(source, self.root / "out")

        names = self._zip_names(Path(result["output_path"]))
        self.assertIn("sample/sample.dict", names)
        self.assertIn("sample/sample.idx.oft", names)
        self.assertIn("sample/sample.idx.oft.cspt", names)

    def test_supported_archive_suffixes_include_rar(self):
        self.assertTrue(is_supported_dictionary_archive("dictionary.zip"))
        self.assertTrue(is_supported_dictionary_archive("dictionary.tar.zst"))
        self.assertTrue(is_supported_dictionary_archive("dictionary.rar"))
        self.assertFalse(is_supported_dictionary_archive("dictionary.7z"))

    def test_rar_prefers_unar_outside_process_path(self):
        source = self.root / "dictionary.rar"
        source.write_bytes(b"fake rar bytes")
        unar_path = self.root / "unar"
        unar_path.write_text("#!/bin/sh\nexit 0\n")
        unar_path.chmod(0o755)

        with (
            patch("app.dictionary_prep._UNAR_CANDIDATES", (str(unar_path),)),
            patch("app.dictionary_prep.rarfile.UNAR_TOOL", "unar"),
            patch("app.dictionary_prep.rarfile.CURRENT_SETUP", object()),
            patch("app.dictionary_prep.rarfile.RarFile", return_value=_FakeRarArchive({})),
        ):
            with self.assertRaisesRegex(DictionaryPrepError, "no .ifo"):
                prepare_dictionary_zip(source, self.root / "out")
            self.assertEqual(dictionary_prep.rarfile.UNAR_TOOL, str(unar_path))
            self.assertIsNone(dictionary_prep.rarfile.CURRENT_SETUP)

    def test_rar_failure_identifies_extractor_and_error_type(self):
        source = self.root / "dictionary.rar"
        source.write_bytes(b"broken rar bytes")

        with (
            patch("app.dictionary_prep._UNAR_CANDIDATES", ()),
            patch("app.dictionary_prep.rarfile.CURRENT_SETUP", None),
            patch(
                "app.dictionary_prep.rarfile.RarFile",
                side_effect=dictionary_prep.rarfile.BadRarFile("truncated archive"),
            ),
        ):
            with self.assertRaisesRegex(
                DictionaryPrepError,
                r"RAR extraction failed using automatic extractor \(BadRarFile\): truncated archive",
            ):
                prepare_dictionary_zip(source, self.root / "out")

    def test_existing_prepared_dictionary_cleanup_uses_remaining_retention(self):
        prepared_root = self.root / "prepared"
        recent = prepared_root / "recent-job"
        expired = prepared_root / "expired-job"
        recent.mkdir(parents=True)
        expired.mkdir()
        now = time.time()
        os.utime(recent, (now - 120, now - 120))
        os.utime(expired, (now - 900, now - 900))

        with patch("app.dictionary_prep.schedule_prepared_dictionary_cleanup") as schedule:
            schedule_existing_prepared_dictionary_cleanup(prepared_root)

        delays = {call.args[0].name: call.args[1] for call in schedule.call_args_list}
        self.assertGreater(delays["recent-job"], 470)
        self.assertLessEqual(delays["recent-job"], 480)
        self.assertEqual(delays["expired-job"], 0)

    def test_root_level_stardict_files_are_packaged_under_stem_folder(self):
        source = self.root / "root.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("sample.ifo", _ifo_bytes("sample"))
            archive.writestr("sample.idx", _idx_bytes())
            archive.writestr("sample.dict", b"alpha definition")

        result = prepare_dictionary_zip(source, self.root / "out")

        names = self._zip_names(Path(result["output_path"]))
        self.assertIn("sample/sample.ifo", names)
        self.assertIn("sample/sample.idx.oft", names)

    def test_macos_metadata_entries_are_ignored(self):
        source = self.root / "macos.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("sample/sample.ifo", _ifo_bytes("sample"))
            archive.writestr("__MACOSX/sample/._sample.ifo", b"finder metadata")
            archive.writestr("sample/sample.idx", _idx_bytes())
            archive.writestr("__MACOSX/sample/._sample.idx", b"finder metadata")
            archive.writestr("sample/sample.dict", b"alpha definition")
            archive.writestr("__MACOSX/sample/._sample.dict", b"finder metadata")
            archive.writestr("sample/.DS_Store", b"finder metadata")

        result = prepare_dictionary_zip(source, self.root / "out")

        names = self._zip_names(Path(result["output_path"]))
        self.assertIn("sample/sample.ifo", names)
        self.assertIn("sample/sample.idx", names)
        self.assertNotIn("sample/._sample.ifo", names)
        self.assertNotIn("sample/.DS_Store", names)

    def test_syn_dz_generates_syn_indexes(self):
        source = self._zip_dictionary(dict_dz=True, syn_dz=True)
        result = prepare_dictionary_zip(source, self.root / "out")

        names = self._zip_names(Path(result["output_path"]))
        self.assertIn("sample/sample.syn", names)
        self.assertNotIn("sample/sample.syn.dz", names)
        self.assertIn("sample/sample.syn.oft", names)
        self.assertIn("sample/sample.syn.oft.cspt", names)

    def test_missing_idx_fails_clearly(self):
        source = self._zip_dictionary(include_idx=False)

        with self.assertRaisesRegex(DictionaryPrepError, "missing required file: sample.idx"):
            prepare_dictionary_zip(source, self.root / "out")

    def test_multiple_ifo_stems_fail_clearly(self):
        source = self.root / "multi.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("sample/sample.ifo", _ifo_bytes("sample"))
            archive.writestr("sample/other.ifo", _ifo_bytes("other"))
            archive.writestr("sample/sample.idx", _idx_bytes())
            archive.writestr("sample/sample.dict", b"first")

        with self.assertRaisesRegex(DictionaryPrepError, "multiple .ifo stems"):
            prepare_dictionary_zip(source, self.root / "out")

    def test_zip_slip_entries_are_rejected(self):
        source = self.root / "unsafe.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("../evil.ifo", b"bad")

        with self.assertRaisesRegex(DictionaryPrepError, "unsafe path"):
            prepare_dictionary_zip(source, self.root / "out")

    def _zip_dictionary(
        self,
        *,
        dict_dz: bool = True,
        syn_dz: bool = False,
        include_idx: bool = True,
    ) -> Path:
        source = self.root / "dictionary.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("sample/sample.ifo", _ifo_bytes("sample"))
            if include_idx:
                archive.writestr("sample/sample.idx", _idx_bytes())
            if dict_dz:
                archive.writestr("sample/sample.dict.dz", _gzip_bytes(b"alpha definition\nbeta definition"))
            else:
                archive.writestr("sample/sample.dict", b"alpha definition\nbeta definition")
            if syn_dz:
                archive.writestr("sample/sample.syn.dz", _gzip_bytes(_syn_bytes()))
        return source

    def _zip_names(self, path: Path) -> set[str]:
        with zipfile.ZipFile(path) as archive:
            return set(archive.namelist())


class DictionaryPrepareApiTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory(prefix="inky_dictionary_api_")
        self.root = Path(self.tmpdir.name)
        self.env = patch.dict(
            os.environ,
            {
                "INKY_DATABASE_URL": f"sqlite:///{self.root / 'inky.db'}",
                "INKY_DATA_DIR": str(self.root / "data"),
                "INKY_AUTH_USERNAME": "",
                "INKY_AUTH_PASSWORD": "",
                "INKY_PUBLIC_READ_ONLY": "0",
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

    def test_prepare_endpoint_creates_downloadable_job(self):
        source = self._zip_dictionary()
        app = self._reload_app()

        with TestClient(app) as client, source.open("rb") as upload:
            response = client.post(
                "/api/dictionaries/prepare",
                files={"file": ("dictionary.zip", upload, "application/zip")},
            )
            self.assertEqual(response.status_code, 200, response.text)
            job = self._wait_for_job(client, response.json()["id"])
            self.assertEqual(job["status"], "succeeded", job)

            download = client.get(f"/api/dictionaries/prepared/{job['id']}/download")
            self.assertEqual(download.status_code, 200, download.text)
            self.assertEqual(download.headers["content-type"], "application/zip")
            self.assertGreater(len(download.content), 0)

    def test_failed_prepare_job_records_useful_error(self):
        source = self._zip_dictionary(include_idx=False)
        app = self._reload_app()

        with TestClient(app) as client, source.open("rb") as upload:
            response = client.post(
                "/api/dictionaries/prepare",
                files={"file": ("dictionary.zip", upload, "application/zip")},
            )
            self.assertEqual(response.status_code, 200, response.text)
            job = self._wait_for_job(client, response.json()["id"])
            self.assertEqual(job["status"], "failed", job)
            self.assertIn("missing required file: sample.idx", job["error"])

    def test_public_read_only_allows_prepare_endpoint(self):
        source = self._zip_dictionary()
        os.environ["INKY_PUBLIC_READ_ONLY"] = "1"
        get_settings.cache_clear()
        app = self._reload_app()

        with TestClient(app) as client, source.open("rb") as upload:
            response = client.post(
                "/api/dictionaries/prepare",
                files={"file": ("dictionary.zip", upload, "application/zip")},
            )
            self.assertEqual(response.status_code, 200, response.text)
            job = self._wait_for_job(client, response.json()["id"])
            self.assertEqual(job["status"], "succeeded", job)

    def test_prepare_endpoint_accepts_tar_zst(self):
        source = self.root / "dictionary.tar.zst"
        _write_tar_zst(
            source,
            {
                "sample/sample.ifo": _ifo_bytes("sample"),
                "sample/sample.idx": _idx_bytes(),
                "sample/sample.dict.dz": _gzip_bytes(b"alpha definition"),
            },
        )
        app = self._reload_app()

        with TestClient(app) as client, source.open("rb") as upload:
            response = client.post(
                "/api/dictionaries/prepare",
                files={"file": ("dictionary.tar.zst", upload, "application/zstd")},
            )
            self.assertEqual(response.status_code, 200, response.text)
            job = self._wait_for_job(client, response.json()["id"])
            self.assertEqual(job["status"], "succeeded", job)

    def test_prepare_endpoint_rejects_empty_archive(self):
        app = self._reload_app()

        with TestClient(app) as client:
            response = client.post(
                "/api/dictionaries/prepare",
                files={"file": ("dictionary.rar", b"", "application/vnd.rar")},
            )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["detail"], "dictionary archive is empty")

    def _reload_app(self):
        import app.db as db_module
        import app.jobs as jobs_module

        db_module.engine.dispose()
        importlib.reload(db_module)
        importlib.reload(jobs_module)
        import app.main as main_module

        return importlib.reload(main_module).app

    def _wait_for_job(self, client: TestClient, job_id: str) -> dict:
        for _ in range(40):
            job = client.get(f"/api/jobs/{job_id}").json()
            if job["status"] in {"succeeded", "failed"}:
                return job
            time.sleep(0.05)
        self.fail(f"job {job_id} did not finish")

    def _zip_dictionary(self, *, include_idx: bool = True) -> Path:
        source = self.root / "dictionary.zip"
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("sample/sample.ifo", _ifo_bytes("sample"))
            if include_idx:
                archive.writestr("sample/sample.idx", _idx_bytes())
            archive.writestr("sample/sample.dict.dz", _gzip_bytes(b"alpha definition"))
        return source


def _ifo_bytes(stem: str) -> bytes:
    return f"StarDict's dict ifo file\nversion=2.4.2\nbookname={stem}\nwordcount=2\nidxfilesize=23\n".encode()


def _idx_bytes() -> bytes:
    return b"alpha\x00" + struct.pack(">II", 0, 5) + b"beta\x00" + struct.pack(">II", 5, 4)


def _syn_bytes() -> bytes:
    return b"first\x00" + struct.pack(">I", 0) + b"second\x00" + struct.pack(">I", 1)


def _gzip_bytes(data: bytes) -> bytes:
    with tempfile.TemporaryDirectory(prefix="inky_gzip_") as tmp:
        path = Path(tmp) / "item.gz"
        with gzip.open(path, "wb") as handle:
            handle.write(data)
        return path.read_bytes()


def _write_tar_zst(path: Path, entries: dict[str, bytes]) -> None:
    tar_bytes = io.BytesIO()
    with tarfile.open(fileobj=tar_bytes, mode="w") as archive:
        for name, data in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    path.write_bytes(zstandard.ZstdCompressor().compress(tar_bytes.getvalue()))


class _FakeRarInfo:
    def __init__(self, filename: str, file_size: int):
        self.filename = filename
        self.file_size = file_size

    def isdir(self) -> bool:
        return self.filename.endswith("/")

    def is_file(self) -> bool:
        return not self.isdir()


class _FakeRarArchive:
    def __init__(self, entries: dict[str, bytes]):
        self.entries = entries

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def infolist(self) -> list[_FakeRarInfo]:
        return [_FakeRarInfo(name, len(data)) for name, data in self.entries.items()]

    def open(self, member: _FakeRarInfo):
        return io.BytesIO(self.entries[member.filename])


if __name__ == "__main__":
    unittest.main()
