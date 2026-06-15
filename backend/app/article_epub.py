from __future__ import annotations

import html
import mimetypes
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

from .config import get_settings
from .utils import safe_filename


async def fetch_article_as_epub(url: str, output_dir: Path, title: str | None = None, author: str | None = None) -> Path:
    async with httpx.AsyncClient(timeout=get_settings().http_timeout_seconds, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")
    inferred_title = title or _text(soup.find("meta", property="og:title"), "content") or (soup.title.text if soup.title else None)
    inferred_author = author or _text(soup.find("meta", attrs={"name": "author"}), "content")
    content = _extract_content(soup)

    output_dir.mkdir(parents=True, exist_ok=True)
    filename = safe_filename(inferred_title or "article", "article") + ".epub"
    output_path = _unique_path(output_dir / filename)
    _write_epub(output_path, inferred_title or "Untitled Article", inferred_author or "", content, url)
    return output_path


def _extract_content(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "form", "nav", "aside", "footer", "header"]):
        tag.decompose()
    root = soup.find("article") or soup.find("main") or soup.body or soup
    chunks: list[str] = []
    for node in root.find_all(["h1", "h2", "h3", "p", "blockquote", "li"]):
        text = " ".join(node.get_text(" ", strip=True).split())
        if len(text) < 2:
            continue
        tag = "p" if node.name == "li" else node.name
        chunks.append(f"<{tag}>{html.escape(text)}</{tag}>")
    return "\n".join(chunks) or "<p>No readable article text was found.</p>"


def _text(node, attr: str) -> str | None:
    if node and node.get(attr):
        return str(node.get(attr))
    return None


def _write_epub(path: Path, title: str, author: str, body_html: str, source_url: str) -> None:
    identifier = f"urn:uuid:{uuid.uuid4()}"
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    chapter = f"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>{html.escape(title)}</title>
    <meta charset="utf-8"/>
  </head>
  <body>
    <h1>{html.escape(title)}</h1>
    <p><small>Source: {html.escape(source_url)}</small></p>
    {body_html}
  </body>
</html>
"""
    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">{identifier}</dc:identifier>
    <dc:title>{html.escape(title)}</dc:title>
    <dc:creator>{html.escape(author)}</dc:creator>
    <dc:language>en</dc:language>
    <dc:date>{modified}</dc:date>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter"/>
  </spine>
</package>
"""
    toc = f"""<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="{identifier}"/></head>
  <docTitle><text>{html.escape(title)}</text></docTitle>
  <navMap>
    <navPoint id="chapter" playOrder="1">
      <navLabel><text>{html.escape(title)}</text></navLabel>
      <content src="chapter.xhtml"/>
    </navPoint>
  </navMap>
</ncx>
"""
    with zipfile.ZipFile(path, "w") as epub:
        epub.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        epub.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
""",
        )
        epub.writestr("OEBPS/content.opf", opf)
        epub.writestr("OEBPS/toc.ncx", toc)
        epub.writestr("OEBPS/chapter.xhtml", chapter)


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(2, 10_000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"could not create unique filename for {path.name}")

