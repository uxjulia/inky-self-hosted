from __future__ import annotations

from pathlib import Path
from time import perf_counter
from urllib.parse import quote, unquote, urljoin, urlparse
from xml.etree import ElementTree as ET

import feedparser
import httpx
from sqlalchemy.orm import Session

from .config import get_settings
from .models import Source
from .schemas import BrowseItem, BrowseResult
from .utils import display_title_from_url, join_remote


DAV_NS = "{DAV:}"
SENDABLE_FILE_EXTENSIONS = {".epub", ".txt", ".xtc", ".xtch", ".bmp", ".png"}


def _auth(source: Source) -> tuple[str, str] | None:
    if source.username and source.password:
        return source.username, source.password
    return None


async def browse_source(db: Session, source_id: int, target: str | None = None) -> BrowseResult:
    source = db.get(Source, source_id)
    if not source:
        raise ValueError("source not found")

    if source.type == "opds":
        return await browse_opds(source, target)
    if source.type == "feed":
        return await browse_feed(source, target)
    if source.type == "webdav":
        return await browse_webdav(source, target or "/")
    if source.type == "local_folder":
        return browse_local_folder(source, target)
    raise ValueError(f"unsupported source type: {source.type}")


async def search_source(db: Session, source_id: int, query: str, target: str | None = None) -> BrowseResult:
    source = db.get(Source, source_id)
    if not source:
        raise ValueError("source not found")

    normalized_query = query.strip()
    if not normalized_query:
        return await browse_source(db, source_id, target)

    if source.type == "opds":
        return await search_opds(source, normalized_query, target)
    if source.type == "feed":
        return await search_feed(source, normalized_query, target)
    if source.type == "webdav":
        return await search_webdav(source, normalized_query, target or "/")
    if source.type == "local_folder":
        return search_local_folder(source, normalized_query, target)
    raise ValueError(f"unsupported source type: {source.type}")


async def _fetch_text(url: str, source: Source) -> str:
    started = perf_counter()
    async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds, follow_redirects=True) as client:
        response = await client.get(url, auth=_auth(source))
        response.raise_for_status()
        text = response.text
    elapsed_ms = int((perf_counter() - started) * 1000)
    print(f"[opds] fetched {source.name} {url} in {elapsed_ms}ms ({len(text)} chars)", flush=True)
    return text


async def browse_opds(source: Source, target: str | None = None) -> BrowseResult:
    url = join_remote(source.url, target)
    started = perf_counter()
    xml_text = await _fetch_text(url, source)
    result = _parse_opds(xml_text, source, url)
    elapsed_ms = int((perf_counter() - started) * 1000)
    print(f"[opds] browsed {source.name} {url} in {elapsed_ms}ms ({len(result.items)} items)", flush=True)
    return result


async def search_opds(source: Source, query: str, target: str | None = None) -> BrowseResult:
    url = join_remote(source.url, target)
    xml_text = await _fetch_text(url, source)
    root = ET.fromstring(xml_text)
    search_url = None
    search_link = _opds_search_link(root, url)
    if search_link:
        search_href, search_media_type = search_link
        if "opensearchdescription" in search_media_type:
            description_text = await _fetch_text(search_href, source)
            search_url = _opensearch_url(description_text, search_href, query)
        else:
            search_url = _apply_search_template(search_href, query)

    if search_url:
        xml_text = await _fetch_text(search_url, source)
        result = _parse_opds(xml_text, source, search_url)
    else:
        result = _parse_opds(xml_text, source, url)
        result.items = [item for item in result.items if _matches_item(item, query)]

    result.title = f'Search "{query}"'
    result.message = None if result.items else f'No results found for "{query}".'
    return result


def _parse_opds(xml_text: str, source: Source, url: str) -> BrowseResult:
    root = ET.fromstring(xml_text)
    title = _child_text(root, "title") or source.name
    items: list[BrowseItem] = []

    for entry in _children(root, "entry"):
        entry_title = _child_text(entry, "title") or "Untitled"
        author = _first_child(entry, "author")
        author_text = _child_text(author, "name") if author is not None else None

        best_book: tuple[str, str | None] | None = None
        best_nav: str | None = None
        image_url: str | None = None
        for link in _children(entry, "link"):
            href = link.attrib.get("href")
            if not href:
                continue
            href = urljoin(url, href)
            rel = link.attrib.get("rel", "")
            media_type = link.attrib.get("type", "")
            rel_lower = rel.lower()
            media_type_lower = media_type.lower()
            if _is_image_link(rel_lower, media_type_lower) and not image_url:
                image_url = href
            is_book = "acquisition" in rel_lower or "application/epub+zip" in media_type_lower or _has_sendable_extension(href)
            if is_book and not best_book:
                best_book = (href, media_type)
            elif _is_navigation_link(rel_lower, media_type_lower) and not best_nav:
                best_nav = href

        if best_book:
            items.append(
                BrowseItem(
                    type="book",
                    title=entry_title,
                    author=author_text,
                    url=best_book[0],
                    image_url=image_url,
                    media_type=best_book[1],
                )
            )
        elif best_nav:
            items.append(BrowseItem(type="navigation", title=entry_title, url=best_nav, image_url=image_url))

    message = None if items else "No OPDS entries were found in this catalog response."
    return BrowseResult(
        source_id=source.id,
        source_type=source.type,
        base_url=url,
        title=title,
        items=items,
        message=message,
        next_url=_feed_link(root, url, "next"),
        previous_url=_feed_link(root, url, "previous") or _feed_link(root, url, "prev"),
    )


async def browse_feed(source: Source, target: str | None = None) -> BrowseResult:
    url = join_remote(source.url, target)
    text = await _fetch_text(url, source)
    parsed = feedparser.parse(text)
    title = parsed.feed.get("title") or source.name
    items = []
    for entry in parsed.entries:
        entry_url = entry.get("link")
        epub_link = _feed_entry_epub_link(entry, url)
        if not entry_url and not epub_link:
            continue
        item_url = epub_link[0] if epub_link else entry_url
        items.append(
            BrowseItem(
                type="book" if epub_link else "article",
                title=entry.get("title") or display_title_from_url(item_url),
                url=item_url,
                image_url=_feed_entry_image_url(entry),
                author=entry.get("author"),
                summary=entry.get("summary"),
                published=entry.get("published"),
                size=epub_link[2] if epub_link else None,
                media_type=epub_link[1] if epub_link else None,
            )
        )
    message = None if items else "No feed entries were found."
    return BrowseResult(source_id=source.id, source_type=source.type, base_url=url, title=title, items=items, message=message)


def _feed_entry_epub_link(entry, feed_url: str) -> tuple[str, str, int | None] | None:
    candidates: list[tuple[int, str, str, int | None]] = []
    for link in entry.get("links", []):
        href = link.get("href")
        media_type = (link.get("type") or "").lower()
        if not href or "application/epub+zip" not in media_type:
            continue

        normalized_href = urljoin(feed_url, href)
        description = f'{link.get("title") or ""} {normalized_href}'.lower()
        # Prefer the broadly-compatible EPUB over advanced or Kobo variants.
        preference = 1 if "advanced" in description or "kepub" in description else 0
        raw_size = str(link.get("length") or "")
        size = int(raw_size) if raw_size.isdigit() else None
        candidates.append((preference, normalized_href, media_type, size))

    if not candidates:
        return None
    _, href, media_type, size = min(candidates, key=lambda candidate: candidate[0])
    return href, media_type, size


async def search_feed(source: Source, query: str, target: str | None = None) -> BrowseResult:
    result = await browse_feed(source, target)
    result.items = [item for item in result.items if _matches_item(item, query)]
    result.title = f'Search "{query}"'
    result.message = None if result.items else f'No results found for "{query}".'
    return result


async def browse_webdav(source: Source, target: str = "/") -> BrowseResult:
    url = join_remote(source.url, target)
    body = """<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:getcontenttype/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>"""
    async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds, follow_redirects=True) as client:
        response = await client.request(
            "PROPFIND",
            url,
            content=body,
            auth=_auth(source),
            headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
        )
        response.raise_for_status()

    root = ET.fromstring(response.text)
    requested_path = _href_path(url)
    items: list[BrowseItem] = []
    for response_node in root.findall(f"{DAV_NS}response"):
        href = response_node.findtext(f"{DAV_NS}href")
        if not href:
            continue
        path = _href_path(urljoin(url, href))
        if _same_path(path, requested_path):
            continue
        prop = response_node.find(f".//{DAV_NS}prop")
        if prop is None:
            continue
        display_name = prop.findtext(f"{DAV_NS}displayname") or display_title_from_url(path)
        is_dir = prop.find(f"{DAV_NS}resourcetype/{DAV_NS}collection") is not None
        size_text = prop.findtext(f"{DAV_NS}getcontentlength")
        media_type = prop.findtext(f"{DAV_NS}getcontenttype")
        items.append(
            BrowseItem(
                type="directory" if is_dir else "file",
                title=display_name.rstrip("/") or display_title_from_url(path),
                path=path,
                url=urljoin(source.url.rstrip("/") + "/", path.lstrip("/")),
                size=int(size_text) if size_text and size_text.isdigit() else None,
                media_type=media_type,
            )
        )

    items.sort(key=lambda item: (item.type != "directory", item.title.lower()))
    message = None if items else "No WebDAV entries were found."
    return BrowseResult(source_id=source.id, source_type=source.type, base_url=url, title=source.name, items=items, message=message)


async def search_webdav(source: Source, query: str, target: str = "/") -> BrowseResult:
    result = await browse_webdav(source, target)
    result.items = [item for item in result.items if _matches_item(item, query)]
    result.title = f'Search "{query}"'
    result.message = None if result.items else f'No results found for "{query}" in this folder.'
    return result


def browse_local_folder(source: Source, target: str | None = None) -> BrowseResult:
    root = Path(source.url).expanduser().resolve()
    folder = _resolve_local_folder_target(root, target)
    items: list[BrowseItem] = []

    try:
        children = sorted(folder.iterdir(), key=lambda path: (not path.is_dir(), path.name.lower()))
    except OSError as exc:
        raise ValueError(f"Unable to open local folder: {exc}") from exc

    for child in children:
        if child.name.startswith("."):
            continue
        if child.is_dir():
            items.append(
                BrowseItem(
                    type="directory",
                    title=child.name,
                    path=child.resolve().relative_to(root).as_posix(),
                )
            )
            continue
        if child.is_file() and child.suffix.lower() in SENDABLE_FILE_EXTENSIONS:
            items.append(
                BrowseItem(
                    type="file",
                    title=child.name,
                    path=child.resolve().relative_to(root).as_posix(),
                    size=child.stat().st_size,
                    media_type=_local_file_media_type(child),
                )
            )

    relative = "." if folder == root else folder.relative_to(root).as_posix()
    message = None if items else "No sendable files were found in this folder."
    return BrowseResult(
        source_id=source.id,
        source_type=source.type,
        base_url=relative,
        title=source.name if relative == "." else folder.name,
        items=items,
        message=message,
    )


def search_local_folder(source: Source, query: str, target: str | None = None) -> BrowseResult:
    result = browse_local_folder(source, target)
    result.items = [item for item in result.items if _matches_item(item, query)]
    result.title = f'Search "{query}"'
    result.message = None if result.items else f'No results found for "{query}" in this folder.'
    return result


def _resolve_local_folder_target(root: Path, target: str | None) -> Path:
    folder = root if not target or target == "." else (root / target).resolve()
    if not folder.is_relative_to(root):
        raise ValueError("local folder target is outside the source root")
    if not folder.exists() or not folder.is_dir():
        raise ValueError("local folder not found")
    return folder


def _local_file_media_type(path: Path) -> str:
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


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[1]
    if ":" in tag:
        return tag.rsplit(":", 1)[1]
    return tag


def _children(node: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in list(node) if _local_name(child.tag) == name]


def _first_child(node: ET.Element | None, name: str) -> ET.Element | None:
    if node is None:
        return None
    for child in list(node):
        if _local_name(child.tag) == name:
            return child
    return None


def _child_text(node: ET.Element | None, name: str) -> str | None:
    child = _first_child(node, name)
    if child is not None and child.text:
        return child.text.strip()
    return None


def _is_navigation_link(rel: str, media_type: str) -> bool:
    if "acquisition" in rel:
        return False
    if rel in {"search", "self", "start", "next", "previous", "prev"}:
        return False
    return (
        "application/atom+xml" in media_type
        or "application/opds+json" in media_type
        or "application/xml" in media_type
        or "text/xml" in media_type
    )


def _is_image_link(rel: str, media_type: str) -> bool:
    return (
        media_type.startswith("image/")
        or "opds-spec.org/image" in rel
        or rel in {"cover", "thumbnail", "http://opds-spec.org/image", "http://opds-spec.org/image/thumbnail"}
    )


def _has_sendable_extension(url: str) -> bool:
    return urlparse(url).path.lower().endswith(tuple(SENDABLE_FILE_EXTENSIONS))


def _opds_search_link(root: ET.Element, base_url: str) -> tuple[str, str] | None:
    for link in _children(root, "link"):
        rel = link.attrib.get("rel", "").lower()
        if "search" not in rel:
            continue
        href = link.attrib.get("href")
        if not href:
            continue
        return urljoin(base_url, href), link.attrib.get("type", "").lower()
    return None


def _feed_link(root: ET.Element, base_url: str, rel_name: str) -> str | None:
    for link in _children(root, "link"):
        rel_values = link.attrib.get("rel", "").lower().split()
        if rel_name not in rel_values:
            continue
        href = link.attrib.get("href")
        if href:
            return urljoin(base_url, href)
    return None


def _opensearch_url(xml_text: str, base_url: str, query: str) -> str | None:
    root = ET.fromstring(xml_text)
    fallback: str | None = None
    for url_node in _children(root, "Url"):
        template = url_node.attrib.get("template")
        if not template:
            continue
        media_type = url_node.attrib.get("type", "").lower()
        absolute_template = urljoin(base_url, template)
        if "atom" in media_type or "opds" in media_type:
            return _apply_search_template(absolute_template, query)
        if fallback is None:
            fallback = _apply_search_template(absolute_template, query)
    return fallback


def _apply_search_template(template: str, query: str) -> str:
    encoded_query = quote(query)
    replacements = {
        "{searchTerms}": encoded_query,
        "{searchterms}": encoded_query,
        "%7BsearchTerms%7D": encoded_query,
        "%7bsearchterms%7d": encoded_query,
    }
    result = template
    for token, value in replacements.items():
        result = result.replace(token, value)
    return result


def _matches_item(item: BrowseItem, query: str) -> bool:
    needle = query.casefold()
    values = [item.title, item.author, item.summary, item.published, item.path, item.url, item.media_type]
    return any(needle in value.casefold() for value in values if value)


def _feed_entry_image_url(entry) -> str | None:
    for collection_name in ("media_thumbnail", "media_content", "links", "enclosures"):
        for candidate in entry.get(collection_name, []) or []:
            url = candidate.get("url") or candidate.get("href")
            media_type = (candidate.get("type") or candidate.get("medium") or "").lower()
            if url and (media_type.startswith("image/") or media_type == "image" or collection_name == "media_thumbnail"):
                return url

    image = entry.get("image")
    if isinstance(image, dict):
        return image.get("href") or image.get("url")
    return None


def _href_path(value: str) -> str:
    parsed = urlparse(value)
    path = unquote(parsed.path or "/")
    return path if path.startswith("/") else f"/{path}"


def _same_path(left: str, right: str) -> bool:
    return left.rstrip("/") == right.rstrip("/")
