from __future__ import annotations

import shutil
from pathlib import Path
from urllib.parse import quote

import httpx
from sqlalchemy.orm import Session

from .article_epub import fetch_article_as_epub
from .config import get_settings
from .models import Job, LibraryItem, Source
from .utils import display_title_from_url, extension_from_url, join_remote, normalize_device_url, safe_filename


async def import_url(
    db: Session,
    url: str,
    source_id: int | None = None,
    title: str | None = None,
    author: str | None = None,
    kind: str = "epub",
    auth: tuple[str, str] | None = None,
) -> LibraryItem:
    title = title or display_title_from_url(url)
    extension = extension_from_url(url, ".epub")
    dest = _unique_path(get_settings().originals_dir / f"{safe_filename(title)}{extension}")

    async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
        async with client.stream("GET", url, auth=auth) as response:
            response.raise_for_status()
            with dest.open("wb") as handle:
                async for chunk in response.aiter_bytes(64 * 1024):
                    handle.write(chunk)

    item = LibraryItem(
        source_id=source_id,
        kind=kind,
        title=title,
        author=author,
        original_path=str(dest),
        source_url=url,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


async def import_article(
    db: Session,
    url: str,
    source_id: int | None = None,
    title: str | None = None,
    author: str | None = None,
) -> LibraryItem:
    output_path = await fetch_article_as_epub(url, get_settings().originals_dir, title, author)
    item = LibraryItem(
        source_id=source_id,
        kind="article",
        title=title or output_path.stem,
        author=author,
        original_path=str(output_path),
        source_url=url,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


async def import_webdav_file(db: Session, source: Source, path: str, title: str | None = None) -> LibraryItem:
    url = join_remote(source.url, path)
    auth = (source.username, source.password) if source.username and source.password else None
    return await import_url(db, url, source.id, title or Path(path).name, kind="file", auth=auth)


def copy_uploaded_file(db: Session, source_path: Path, filename: str) -> LibraryItem:
    title = Path(filename).stem
    destination = _unique_path(get_settings().originals_dir / safe_filename(filename, "upload.epub"))
    shutil.copyfile(source_path, destination)
    item = LibraryItem(kind="epub", title=title, original_path=str(destination))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


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
            files = {"file": (file_path.name, handle, "application/epub+zip")}
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
