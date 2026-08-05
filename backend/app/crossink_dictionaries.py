from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from urllib.parse import quote

import httpx


DICTIONARY_DOWNLOAD_URL_PREFIX = "https://raw.githubusercontent.com/uxjulia/crossink-dictionaries/main/English/"
DICTIONARY_MANIFEST_URL = "https://raw.githubusercontent.com/uxjulia/crossink-dictionaries/refs/heads/main/English/manifest.json"
DICTIONARY_CACHE_SECONDS = 300


class CrossInkDictionariesError(RuntimeError):
    pass


@dataclass(frozen=True)
class CrossInkDictionary:
    filename: str
    size: int
    description: str
    download_url: str


_dictionary_cache: tuple[float, tuple[CrossInkDictionary, ...]] | None = None
_dictionary_cache_lock = asyncio.Lock()


def parse_dictionaries(payload: object) -> tuple[CrossInkDictionary, ...]:
    if isinstance(payload, dict):
        items = payload.get("dictionaries")
        manifest_payload = True
    elif isinstance(payload, list):
        # Keep accepting the GitHub contents response while the catalog migrates
        # to the checked-in manifest format.
        items = payload
        manifest_payload = False
    else:
        raise CrossInkDictionariesError("GitHub returned invalid dictionary metadata.")
    if not isinstance(items, list):
        raise CrossInkDictionariesError("GitHub returned invalid dictionary metadata.")

    dictionaries: list[CrossInkDictionary] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        filename = item.get("filename" if manifest_payload else "name")
        size = item.get("size")
        description = item.get("description", "")
        download_url = item.get("download_url")
        if (
            (not manifest_payload and item.get("type") != "file")
            or not isinstance(filename, str)
            or not filename.endswith(".zip")
            or "/" in filename
            or type(size) is not int
            or size <= 0
            or not isinstance(description, str)
        ):
            continue
        expected_download_url = f"{DICTIONARY_DOWNLOAD_URL_PREFIX}{quote(filename)}"
        if manifest_payload:
            download_url = expected_download_url
        elif not isinstance(download_url, str) or download_url != expected_download_url:
            continue
        dictionaries.append(
            CrossInkDictionary(
                filename=filename,
                size=size,
                description=description.strip(),
                download_url=download_url,
            )
        )

    if not dictionaries:
        raise CrossInkDictionariesError("No downloadable CrossInk dictionary packages are available.")
    return tuple(sorted(dictionaries, key=lambda dictionary: dictionary.filename.casefold()))


async def get_crossink_dictionaries() -> tuple[CrossInkDictionary, ...]:
    global _dictionary_cache

    now = time.monotonic()
    if _dictionary_cache and now - _dictionary_cache[0] < DICTIONARY_CACHE_SECONDS:
        return _dictionary_cache[1]

    async with _dictionary_cache_lock:
        now = time.monotonic()
        if _dictionary_cache and now - _dictionary_cache[0] < DICTIONARY_CACHE_SECONDS:
            return _dictionary_cache[1]

        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(
                    DICTIONARY_MANIFEST_URL,
                    headers={"Accept": "application/json", "User-Agent": "Inky"},
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise CrossInkDictionariesError("Unable to load CrossInk dictionary packages from GitHub.") from exc

        dictionaries = parse_dictionaries(response.json())
        _dictionary_cache = (time.monotonic(), dictionaries)
        return dictionaries


def clear_dictionary_cache() -> None:
    global _dictionary_cache
    _dictionary_cache = None
