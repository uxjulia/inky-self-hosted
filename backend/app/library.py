from __future__ import annotations

import shutil
import posixpath
import zipfile
from dataclasses import dataclass
from xml.etree import ElementTree as ET
from pathlib import Path
from urllib.parse import quote, unquote

import httpx
from sqlalchemy.orm import Session

from .article_epub import fetch_article_as_epub
from .config import get_settings
from .models import Job, LibraryItem, Source
from .utils import display_title_from_url, extension_from_url, join_remote, normalize_device_url, safe_filename


MOUNTED_LIBRARY_SOURCE_PREFIX = "mounted-library://"
LOCAL_LIBRARY_EXTENSIONS = {".epub", ".txt", ".xtc", ".xtch"}
EPUB_EXTENSION = ".epub"
CONTAINER_NS = {"container": "urn:oasis:names:tc:opendocument:xmlns:container"}
OPF_NS = {"dc": "http://purl.org/dc/elements/1.1/"}


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


def sync_mounted_library(db: Session) -> None:
    mounted_dir = get_settings().mounted_library_dir
    if not mounted_dir.exists() or not mounted_dir.is_dir():
        return

    mounted_dir = mounted_dir.resolve()
    current_source_urls: set[str] = set()
    for file_path in sorted(mounted_dir.rglob("*")):
        if not file_path.is_file() or file_path.suffix.lower() not in LOCAL_LIBRARY_EXTENSIONS:
            continue
        resolved_path = file_path.resolve()
        relative_path = resolved_path.relative_to(mounted_dir).as_posix()
        source_url = f"{MOUNTED_LIBRARY_SOURCE_PREFIX}{relative_path}"
        current_source_urls.add(source_url)
        metadata = _epub_metadata(file_path) if _is_epub(file_path) else EpubMetadata()
        title = metadata.title or file_path.stem
        item = db.query(LibraryItem).filter(LibraryItem.source_url == source_url).first()
        if item:
            item.title = title
            item.author = metadata.author
            item.original_path = str(resolved_path)
            item.cover_url = _library_cover_url(item.id) if metadata.cover_path else None
            continue
        item = LibraryItem(
            kind=_library_kind_for_path(resolved_path),
            title=title,
            author=metadata.author,
            original_path=str(resolved_path),
            source_url=source_url,
        )
        db.add(item)
        db.flush()
        if metadata.cover_path:
            item.cover_url = _library_cover_url(item.id)

    mounted_items = db.query(LibraryItem).filter(LibraryItem.source_url.like(f"{MOUNTED_LIBRARY_SOURCE_PREFIX}%")).all()
    for item in mounted_items:
        if item.source_url not in current_source_urls:
            db.query(Job).filter(Job.item_id == item.id).update({Job.item_id: None})
            db.delete(item)
    db.commit()


def get_library_item_cover(item: LibraryItem) -> tuple[bytes, str]:
    path = Path(item.original_path)
    if not _is_readable_library_path(path):
        raise FileNotFoundError("library file is outside configured storage")
    return _epub_cover_bytes(path)


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
    return "application/octet-stream"


def _library_kind_for_path(path: Path) -> str:
    return "epub" if _is_epub(path) else "file"


def _is_epub(path: Path) -> bool:
    return path.suffix.lower() == EPUB_EXTENSION


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
    if settings.mounted_library_dir.exists():
        roots.append(settings.mounted_library_dir.resolve())
    resolved = path.resolve()
    return any(resolved.is_relative_to(root) for root in roots)


def delete_library_item(db: Session, item: LibraryItem) -> None:
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


async def send_file_to_device(file_path: Path, device_url: str, destination_path: str = "/") -> dict:
    base = normalize_device_url(device_url)
    destination_path = destination_path or "/"
    async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
        with file_path.open("rb") as handle:
            files = {"file": (file_path.name, handle, _media_type_for_device_upload(file_path))}
            response = await client.post(f"{base}/upload?path={quote(destination_path)}", files=files)
            response.raise_for_status()
            return {"device_url": base, "destination_path": destination_path, "response": response.text}


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
