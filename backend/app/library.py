from __future__ import annotations

import shutil
import posixpath
import threading
import time
import uuid
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from xml.etree import ElementTree as ET
from pathlib import Path
from urllib.parse import quote, unquote

import httpx
from sqlalchemy.orm import Session

from .article_epub import fetch_article_as_epub
from .config import get_settings
from .epub_validation import EpubValidationError, validate_epub_archive
from .models import Job, LibraryItem, Source, utc_now
from .utils import display_title_from_url, extension_from_url, join_remote, normalize_device_url, safe_filename


MOUNTED_LIBRARY_SOURCE_PREFIX = "mounted-library://"
LOCAL_LIBRARY_EXTENSIONS = {".epub", ".txt", ".xtc", ".xtch"}
IMAGE_LIBRARY_EXTENSIONS = {".bmp", ".png"}
SENDABLE_LIBRARY_EXTENSIONS = LOCAL_LIBRARY_EXTENSIONS | IMAGE_LIBRARY_EXTENSIONS
EPUB_EXTENSION = ".epub"
EMPTY_MOUNTED_SCAN_GRACE_SECONDS = 30
MOUNTED_LIBRARY_SYNC_INTERVAL_SECONDS = 30
CONTAINER_NS = {"container": "urn:oasis:names:tc:opendocument:xmlns:container"}
OPF_NS = {"dc": "http://purl.org/dc/elements/1.1/"}
_last_empty_synced_scan_at: float | None = None
_last_mounted_library_sync_at: float | None = None
_mounted_library_sync_lock = threading.Lock()


@dataclass(frozen=True)
class EpubMetadata:
    title: str | None = None
    author: str | None = None
    cover_path: str | None = None
    cover_media_type: str | None = None


async def import_url(
    db: Session,
    url: str,
    source_id: int | None = None,
    title: str | None = None,
    author: str | None = None,
    cover_url: str | None = None,
    kind: str = "epub",
    auth: tuple[str, str] | None = None,
) -> LibraryItem:
    title = title or display_title_from_url(url)
    extension = extension_from_url(url, ".epub")
    dest = _unique_path(get_settings().originals_dir / f"{safe_filename(title)}{extension}")

    try:
        async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
            async with client.stream("GET", url, auth=auth) as response:
                response.raise_for_status()
                with dest.open("wb") as handle:
                    async for chunk in response.aiter_bytes(64 * 1024):
                        handle.write(chunk)
        if _is_epub(dest):
            validate_downloaded_epub(dest)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    metadata = _epub_metadata(dest) if _is_epub(dest) else EpubMetadata()

    item_kind = _library_kind_for_path(dest) if kind == "epub" else kind
    item = LibraryItem(
        source_id=source_id,
        kind=item_kind,
        title=title,
        author=author,
        original_path=str(dest),
        source_url=url,
        cover_url=cover_url,
    )
    db.add(item)
    db.flush()
    if not item.cover_url and metadata.cover_path:
        item.cover_url = _library_cover_url(item.id)
    db.commit()
    db.refresh(item)
    return item


async def import_article(
    db: Session,
    url: str,
    source_id: int | None = None,
    title: str | None = None,
    author: str | None = None,
    cover_url: str | None = None,
) -> LibraryItem:
    output_path = await fetch_article_as_epub(url, get_settings().originals_dir, title, author)
    item = LibraryItem(
        source_id=source_id,
        kind="article",
        title=title or output_path.stem,
        author=author,
        original_path=str(output_path),
        source_url=url,
        cover_url=cover_url,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


async def import_webdav_file(db: Session, source: Source, path: str, title: str | None = None, cover_url: str | None = None) -> LibraryItem:
    url = join_remote(source.url, path)
    auth = (source.username, source.password) if source.username and source.password else None
    return await import_url(db, url, source.id, title or Path(path).name, cover_url=cover_url, kind="file", auth=auth)


def copy_uploaded_file(db: Session, source_path: Path, filename: str) -> LibraryItem:
    destination = _unique_path(get_settings().originals_dir / safe_filename(filename, "upload.epub"))
    shutil.copyfile(source_path, destination)
    metadata = _epub_metadata(destination) if _is_epub(destination) else EpubMetadata()
    title = metadata.title or Path(filename).stem
    item = LibraryItem(kind=_library_kind_for_path(destination), title=title, author=metadata.author, original_path=str(destination))
    db.add(item)
    db.flush()
    if metadata.cover_path:
        item.cover_url = _library_cover_url(item.id)
    db.commit()
    db.refresh(item)
    return item


def sync_mounted_library(db: Session, *, force: bool = False) -> None:
    global _last_empty_synced_scan_at, _last_mounted_library_sync_at

    now = time.monotonic()
    if not force and _last_mounted_library_sync_at is not None and now - _last_mounted_library_sync_at < MOUNTED_LIBRARY_SYNC_INTERVAL_SECONDS:
        return
    if not _mounted_library_sync_lock.acquire(blocking=force):
        return
    _last_mounted_library_sync_at = now
    try:
        _sync_mounted_library_now(db)
    finally:
        _mounted_library_sync_lock.release()


def _sync_mounted_library_now(db: Session) -> None:
    global _last_empty_synced_scan_at

    scan_time = utc_now()
    current_source_urls: set[str] = set()
    mounted_dir = get_settings().mounted_library_dir
    if mounted_dir and mounted_dir.exists() and mounted_dir.is_dir():
        _sync_library_root(
            db,
            mounted_dir.resolve(),
            MOUNTED_LIBRARY_SOURCE_PREFIX,
            current_source_urls,
            include_root_in_source_url=False,
            scan_time=scan_time,
        )

    folder_items = db.query(LibraryItem).filter(LibraryItem.source_url.like(f"{MOUNTED_LIBRARY_SOURCE_PREFIX}%")).all()
    if folder_items and not current_source_urls:
        now = time.monotonic()
        if _last_empty_synced_scan_at is None or now - _last_empty_synced_scan_at < EMPTY_MOUNTED_SCAN_GRACE_SECONDS:
            if _last_empty_synced_scan_at is None:
                _last_empty_synced_scan_at = now
            print("Mounted library scan returned no files; preserving existing synced library records.", flush=True)
            db.commit()
            return
    else:
        _last_empty_synced_scan_at = None

    for item in folder_items:
        if item.source_url not in current_source_urls:
            item.is_missing = True
            item.last_scan_at = scan_time
    db.commit()


def _sync_library_root(
    db: Session,
    root: Path,
    source_prefix: str,
    current_source_urls: set[str],
    *,
    include_root_in_source_url: bool,
    scan_time,
) -> None:
    for file_path in sorted(root.rglob("*")):
        if not file_path.is_file() or file_path.suffix.lower() not in SENDABLE_LIBRARY_EXTENSIONS:
            continue

        resolved_path = file_path.resolve()
        relative_path = resolved_path.relative_to(root).as_posix()
        source_url = f"{source_prefix}{resolved_path.as_posix() if include_root_in_source_url else relative_path}"
        current_source_urls.add(source_url)
        metadata = _epub_metadata(file_path) if _is_epub(file_path) else EpubMetadata()
        title = metadata.title or file_path.stem
        item = db.query(LibraryItem).filter(LibraryItem.source_url == source_url).first()
        if item:
            item.title = title
            item.author = metadata.author
            item.original_path = str(resolved_path)
            item.cover_url = _library_cover_url(item.id) if metadata.cover_path else None
            item.is_missing = False
            item.last_scan_at = scan_time
            continue
        item = LibraryItem(
            kind=_library_kind_for_path(resolved_path),
            title=title,
            author=metadata.author,
            original_path=str(resolved_path),
            source_url=source_url,
            is_missing=False,
            last_scan_at=scan_time,
        )
        db.add(item)
        db.flush()
        if metadata.cover_path:
            item.cover_url = _library_cover_url(item.id)


def get_library_item_cover(item: LibraryItem) -> tuple[bytes, str]:
    path = Path(item.original_path)
    if not _is_readable_library_path(path):
        raise FileNotFoundError("library file is outside configured storage")
    return _epub_cover_bytes(path)


def get_library_item_file_path(item: LibraryItem, prefer_optimized: bool = True) -> Path:
    selected = item.optimized_path if prefer_optimized and item.optimized_path else item.original_path
    path = Path(selected)
    if not _is_readable_library_path(path) or not path.is_file():
        raise FileNotFoundError("library file not found")
    return path


def _epub_metadata(path: Path) -> EpubMetadata:
    try:
        with zipfile.ZipFile(path) as archive:
            container = ET.fromstring(archive.read("META-INF/container.xml"))
            rootfile = container.find(".//container:rootfile", CONTAINER_NS)
            if rootfile is None:
                return EpubMetadata()
            opf_path = rootfile.attrib.get("full-path")
            if not opf_path:
                return EpubMetadata()
            opf_root = ET.fromstring(archive.read(opf_path))
            title = _first_metadata_text(opf_root, "title")
            author = _first_metadata_text(opf_root, "creator")
            cover_path, cover_media_type = _cover_manifest_entry(opf_root, opf_path)
            return EpubMetadata(title=title, author=author, cover_path=cover_path, cover_media_type=cover_media_type)
    except (KeyError, ET.ParseError, OSError, zipfile.BadZipFile):
        return EpubMetadata()


def _epub_cover_bytes(path: Path) -> tuple[bytes, str]:
    metadata = _epub_metadata(path)
    if not metadata.cover_path:
        raise FileNotFoundError("cover not found")

    with zipfile.ZipFile(path) as archive:
        return archive.read(metadata.cover_path), metadata.cover_media_type or _media_type_from_path(metadata.cover_path)


def _cover_manifest_entry(root: ET.Element, opf_path: str) -> tuple[str | None, str | None]:
    items = [element for element in root.iter() if _local_name(element.tag) == "item"]
    cover_id = _epub2_cover_id(root)

    for item in items:
        properties = (item.attrib.get("properties") or "").split()
        if "cover-image" in properties:
            return _resolve_epub_href(opf_path, item.attrib.get("href")), item.attrib.get("media-type")

    if cover_id:
        for item in items:
            if item.attrib.get("id") == cover_id:
                return _resolve_epub_href(opf_path, item.attrib.get("href")), item.attrib.get("media-type")

    for item in items:
        href = item.attrib.get("href") or ""
        item_id = item.attrib.get("id") or ""
        media_type = item.attrib.get("media-type") or ""
        if media_type.startswith("image/") and "cover" in f"{item_id} {href}".lower():
            return _resolve_epub_href(opf_path, href), media_type

    return None, None


def _epub2_cover_id(root: ET.Element) -> str | None:
    for element in root.iter():
        if _local_name(element.tag) == "meta" and element.attrib.get("name") == "cover":
            return element.attrib.get("content")
    return None


def _resolve_epub_href(opf_path: str, href: str | None) -> str | None:
    if not href:
        return None
    return posixpath.normpath(posixpath.join(posixpath.dirname(opf_path), unquote(href)))


def _media_type_from_path(path: str) -> str:
    suffix = Path(path).suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".gif":
        return "image/gif"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".svg":
        return "image/svg+xml"
    return "application/octet-stream"


def _media_type_for_device_upload(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".epub":
        return "application/epub+zip"
    if suffix == ".txt":
        return "text/plain"
    if suffix == ".bmp":
        return "image/bmp"
    if suffix == ".png":
        return "image/png"
    return "application/octet-stream"


def _library_kind_for_path(path: Path) -> str:
    return "epub" if _is_epub(path) else "file"


def _is_epub(path: Path) -> bool:
    return path.suffix.lower() == EPUB_EXTENSION


def validate_downloaded_epub(path: Path) -> None:
    try:
        validate_epub_archive(path)
    except EpubValidationError as exc:
        raise ValueError(f"The downloaded EPUB is incomplete or invalid: {exc}") from exc


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _first_metadata_text(root: ET.Element, name: str) -> str | None:
    element = root.find(f".//dc:{name}", OPF_NS)
    if element is None or not element.text:
        return None
    value = " ".join(element.text.split())
    return value or None


def _library_cover_url(item_id: int) -> str:
    return f"/api/library/{item_id}/cover"


def _is_readable_library_path(path: Path) -> bool:
    settings = get_settings()
    roots = [settings.data_dir.resolve()]
    if settings.mounted_library_dir and settings.mounted_library_dir.exists():
        roots.append(settings.mounted_library_dir.resolve())
    resolved = path.resolve()
    return any(resolved.is_relative_to(root) for root in roots)


def _is_synced_library_item(item: LibraryItem) -> bool:
    return bool(item.source_url and item.source_url.startswith(MOUNTED_LIBRARY_SOURCE_PREFIX))


def delete_library_item(db: Session, item: LibraryItem) -> None:
    if _is_synced_library_item(item):
        raise ValueError("Synced library items must be removed from the mounted library folder.")

    for file_path in (item.original_path, item.optimized_path):
        if file_path:
            _unlink_data_file(Path(file_path))

    db.query(Job).filter(Job.item_id == item.id).update({Job.item_id: None})
    db.delete(item)
    db.commit()


async def probe_device(device_url: str) -> dict:
    base = normalize_device_url(device_url)
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
        response = await client.get(f"{base}/api/status")
        response.raise_for_status()
        return response.json()


SendProgress = Callable[[int, str], None]


async def send_file_to_device(
    file_path: Path,
    device_url: str,
    destination_path: str = "/",
    progress: SendProgress | None = None,
    filename: str | None = None,
) -> dict:
    base = normalize_device_url(device_url)
    destination_path = _normalize_destination_path(destination_path)
    async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
        created_folders = await _ensure_device_folder(client, base, destination_path)
        return await _upload_file_atomically(client, base, file_path, destination_path, created_folders, progress, filename)


async def _ensure_device_folder(client: httpx.AsyncClient, base: str, destination_path: str) -> list[str]:
    segments = _destination_folder_segments(destination_path)
    created_folders: list[str] = []
    parent = "/"

    for segment in segments:
        response = await client.post(f"{base}/mkdir", data={"path": parent, "name": segment})
        if response.status_code == 400 and "already exists" in response.text.lower():
            parent = _join_device_folder(parent, segment)
            continue
        response.raise_for_status()
        parent = _join_device_folder(parent, segment)
        created_folders.append(parent)

    return created_folders


def _destination_folder_segments(destination_path: str) -> list[str]:
    normalized = _normalize_destination_path(destination_path)
    segments = [segment for segment in normalized.split("/") if segment and segment != "."]
    if any(segment == ".." for segment in segments):
        raise ValueError("destination folder cannot contain '..'")
    return segments


def _normalize_destination_path(destination_path: str) -> str:
    normalized = (destination_path or "/").replace("\\", "/").strip()
    if not normalized or normalized == ".":
        return "/"
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return normalized.rstrip("/") or "/"


async def _upload_file_atomically(
    client: httpx.AsyncClient,
    base: str,
    file_path: Path,
    destination_path: str,
    created_folders: list[str],
    progress: SendProgress | None,
    filename: str | None,
) -> dict:
    final_name = _device_filename(filename or file_path.name)
    temp_name = _temporary_upload_name(final_name)
    temp_path = _join_device_folder(destination_path, temp_name)
    final_path = _join_device_folder(destination_path, final_name)

    try:
        _send_log(f"Uploading {file_path.name} to {destination_path} as temporary file {temp_name}")
        upload_response = await _post_file_to_device(client, base, file_path, destination_path, temp_name, progress)
        _send_log(f"Upload response {upload_response.status_code}: {_response_summary(upload_response)}")
        _raise_for_device_response(upload_response, "Device upload failed")

        if progress:
            progress(100, "Finalizing on device")
        rename_response = await client.post(f"{base}/rename", data={"path": temp_path, "name": final_name})
        if rename_response.status_code == 409 and "target already exists" in rename_response.text.lower():
            await _delete_device_file_if_present(client, base, final_path)
            rename_response = await client.post(f"{base}/rename", data={"path": temp_path, "name": final_name})
        _send_log(f"Finalize response {rename_response.status_code}: {_response_summary(rename_response)}")
        _raise_for_device_response(rename_response, "Device finalize failed")
    except Exception:
        await _cleanup_device_file(client, base, temp_path)
        raise

    return {
        "device_url": base,
        "destination_path": destination_path,
        "filename": final_name,
        "created_folders": created_folders,
        "response": upload_response.text,
    }


async def _post_file_to_device(
    client: httpx.AsyncClient,
    base: str,
    file_path: Path,
    destination_path: str,
    upload_name: str,
    progress: SendProgress | None,
) -> httpx.Response:
    with file_path.open("rb") as handle:
        upload_file = _ProgressFile(handle, file_path.stat().st_size, progress)
        files = {"file": (upload_name, upload_file, _media_type_for_device_upload(file_path))}
        return await client.post(f"{base}/upload?path={quote(destination_path)}", files=files)


async def _delete_device_file_if_present(client: httpx.AsyncClient, base: str, path: str) -> None:
    response = await client.post(f"{base}/delete", data={"path": path})
    if response.status_code < 400 or "not found" in response.text.lower():
        if response.status_code < 400:
            _send_log(f"Removed existing device file before finalize: {path}")
        return
    _raise_for_device_response(response, "Device overwrite cleanup failed")


async def _cleanup_device_file(client: httpx.AsyncClient, base: str, path: str) -> None:
    try:
        response = await client.post(f"{base}/delete", data={"path": path})
        _send_log(f"Temporary cleanup response {response.status_code}: {_response_summary(response)}")
    except httpx.HTTPError as exc:
        _send_log(f"Temporary cleanup request failed: {exc}")


def _raise_for_device_response(response: httpx.Response, prefix: str) -> None:
    if response.status_code < 400:
        return
    detail = response.text.strip() or response.reason_phrase or f"HTTP {response.status_code}"
    raise RuntimeError(f"{prefix} ({response.status_code}): {detail}")


def _temporary_upload_name(file_name: str) -> str:
    return _device_filename(f"inky-upload-{uuid.uuid4().hex[:8]}-{file_name}")


def _device_filename(file_name: str, max_bytes: int = 255) -> str:
    trimmed = file_name.strip(" .")
    extension_start = _safe_extension_start(trimmed)
    if extension_start is not None:
        extension = trimmed[extension_start:]
        base_budget = max_bytes - len(extension.encode("utf-8"))
        base = _device_filename_part(trimmed[:extension_start], base_budget)
        if base:
            return f"{base}{extension}"
    return _device_filename_part(file_name, max_bytes)


def _safe_extension_start(file_name: str) -> int | None:
    dot = file_name.rfind(".")
    if dot <= 0 or dot + 1 >= len(file_name):
        return None
    extension = file_name[dot:]
    if len(extension.encode("utf-8")) > 16 or not extension[1:].isalnum():
        return None
    return dot


def _device_filename_part(file_name: str, max_bytes: int) -> str:
    result = ""
    for char in file_name.lstrip(" ."):
        char = "_" if char in '/\\:*?"<>|' or ord(char) < 32 else char
        candidate = f"{result}{char}"
        if len(candidate.encode("utf-8")) > max_bytes:
            break
        result = candidate
    return result.rstrip(" .") or "book"


def _response_summary(response: httpx.Response) -> str:
    return (response.text or response.reason_phrase or "").strip()[:240]


def _send_log(message: str) -> None:
    print(f"[send] {message}", flush=True)


class _ProgressFile:
    def __init__(self, handle, total_bytes: int, progress: SendProgress | None):
        self._handle = handle
        self._total_bytes = max(1, total_bytes)
        self._progress = progress
        self._sent = 0
        self._last_percent = -1

    def read(self, size=-1):
        chunk = self._handle.read(size)
        if chunk and self._progress:
            self._sent += len(chunk)
            percent = min(100, int((self._sent / self._total_bytes) * 100))
            if percent > self._last_percent:
                self._last_percent = percent
                self._progress(percent, "Uploading to device")
        return chunk

    def __getattr__(self, name):
        return getattr(self._handle, name)


def _join_device_folder(parent: str, segment: str) -> str:
    if parent == "/":
        return f"/{segment}"
    return f"{parent.rstrip('/')}/{segment}"


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(2, 10_000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"could not create unique filename for {path.name}")


def _unlink_data_file(path: Path) -> None:
    data_dir = get_settings().data_dir.resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(data_dir) or not resolved.is_file():
        return
    resolved.unlink(missing_ok=True)
