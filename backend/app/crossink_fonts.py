from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from urllib.parse import quote, urlparse

import httpx


FONT_CACHE_SECONDS = 300


class CrossInkFontsError(RuntimeError):
    pass


@dataclass(frozen=True)
class CrossInkFont:
    filename: str
    size: int
    download_url: str


@dataclass(frozen=True)
class CrossInkFontCatalog:
    contents_api_url: str
    download_url_prefix: str


FONT_CATALOGS = {
    "reader": CrossInkFontCatalog(
        contents_api_url="https://api.github.com/repos/uxjulia/crossink-fonts/contents/cpfonts",
        download_url_prefix="https://raw.githubusercontent.com/uxjulia/crossink-fonts/main/cpfonts/",
    ),
    "dictionary": CrossInkFontCatalog(
        contents_api_url="https://api.github.com/repos/uxjulia/crossink-fonts/contents/dictionary-fonts",
        download_url_prefix="https://raw.githubusercontent.com/uxjulia/crossink-fonts/main/dictionary-fonts/",
    ),
}


_font_cache: dict[str, tuple[float, tuple[CrossInkFont, ...]]] = {}
_font_cache_lock = asyncio.Lock()


def parse_fonts(payload: object, catalog: CrossInkFontCatalog | None = None) -> tuple[CrossInkFont, ...]:
    catalog = catalog or FONT_CATALOGS["reader"]
    if not isinstance(payload, list):
        raise CrossInkFontsError("GitHub returned invalid font metadata.")

    fonts: list[CrossInkFont] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        filename = item.get("name")
        size = item.get("size")
        download_url = item.get("download_url")
        if (
            item.get("type") != "file"
            or not isinstance(filename, str)
            or not filename.endswith(".zip")
            or "/" in filename
            or type(size) is not int
            or size <= 0
            or not isinstance(download_url, str)
            or download_url != f"{catalog.download_url_prefix}{quote(filename)}"
        ):
            continue
        fonts.append(CrossInkFont(filename=filename, size=size, download_url=download_url))

    if not fonts:
        raise CrossInkFontsError("No downloadable CrossInk font packages are available.")
    return tuple(sorted(fonts, key=lambda font: font.filename.casefold()))


async def get_crossink_fonts(catalog_name: str = "reader") -> tuple[CrossInkFont, ...]:
    catalog = FONT_CATALOGS.get(catalog_name)
    if not catalog:
        raise CrossInkFontsError("Unknown CrossInk font catalog.")

    now = time.monotonic()
    cached = _font_cache.get(catalog_name)
    if cached and now - cached[0] < FONT_CACHE_SECONDS:
        return cached[1]

    async with _font_cache_lock:
        now = time.monotonic()
        cached = _font_cache.get(catalog_name)
        if cached and now - cached[0] < FONT_CACHE_SECONDS:
            return cached[1]

        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(
                    catalog.contents_api_url,
                    headers={
                        "Accept": "application/vnd.github+json",
                        "User-Agent": "Inky",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise CrossInkFontsError("Unable to load CrossInk font packages from GitHub.") from exc

        fonts = parse_fonts(response.json(), catalog)
        _font_cache[catalog_name] = (time.monotonic(), fonts)
        return fonts


def clear_font_cache() -> None:
    _font_cache.clear()
