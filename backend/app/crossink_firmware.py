from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx


CROSSINK_RELEASE_API_URL = "https://api.github.com/repos/uxjulia/CrossInk/releases?per_page=30"
CROSSINK_RELEASE_PAGE_PREFIX = "https://github.com/uxjulia/CrossInk/releases/"
RELEASE_CACHE_SECONDS = 300
STABLE_RELEASE_LIMIT = 3
PRERELEASE_LIMIT = 3
SUPPORTED_VARIANTS = ("tiny", "xlarge", "x3-x4", "sticky")
_FIRMWARE_NAME_PATTERN = re.compile(r"^firmware-(tiny|xlarge|x3-x4|sticky)-[^/]+\.bin$")
_PRERELEASE_FIRMWARE_NAME_PATTERN = re.compile(
    r"^firmware-(tiny|xlarge|x3-x4|sticky)-v\d+(?:\.\d+){2,3}-[0-9a-f]{7,40}-RC\.bin$"
)


class CrossInkFirmwareError(RuntimeError):
    pass


@dataclass(frozen=True)
class CrossInkFirmwareAsset:
    variant: str
    filename: str
    size: int
    download_url: str


@dataclass(frozen=True)
class CrossInkStableRelease:
    tag: str
    published_at: str
    html_url: str
    assets: dict[str, CrossInkFirmwareAsset]


_release_cache: tuple[
    float,
    tuple[CrossInkStableRelease, ...],
    tuple[CrossInkStableRelease, ...],
] | None = None
_release_cache_lock = asyncio.Lock()


def parse_stable_release(payload: object, *, allow_prerelease_filename: bool = False) -> CrossInkStableRelease:
    if not isinstance(payload, dict):
        raise CrossInkFirmwareError("GitHub returned invalid release metadata.")

    tag = payload.get("tag_name")
    published_at = payload.get("published_at")
    html_url = payload.get("html_url")
    raw_assets = payload.get("assets")
    if not isinstance(tag, str) or not tag or not isinstance(raw_assets, list):
        raise CrossInkFirmwareError("The CrossInk release metadata is incomplete.")
    if not isinstance(published_at, str):
        published_at = ""
    if not isinstance(html_url, str) or not html_url.startswith(CROSSINK_RELEASE_PAGE_PREFIX):
        html_url = f"https://github.com/uxjulia/CrossInk/releases/tag/{tag}"

    assets: dict[str, CrossInkFirmwareAsset] = {}
    for raw_asset in raw_assets:
        if not isinstance(raw_asset, dict):
            continue
        filename = raw_asset.get("name")
        download_url = raw_asset.get("browser_download_url")
        size = raw_asset.get("size")
        if not isinstance(filename, str) or not isinstance(download_url, str):
            continue
        match = _FIRMWARE_NAME_PATTERN.fullmatch(filename)
        if not match or not _is_trusted_release_asset_url(download_url, tag):
            continue
        variant = match.group(1)
        if (
            (
                allow_prerelease_filename
                and not _PRERELEASE_FIRMWARE_NAME_PATTERN.fullmatch(filename)
            )
            or (not allow_prerelease_filename and filename != f"firmware-{variant}-{tag}.bin")
            or type(size) is not int
            or size <= 0
        ):
            continue
        assets[variant] = CrossInkFirmwareAsset(
            variant=variant,
            filename=filename,
            size=size,
            download_url=download_url,
        )

    if not assets:
        raise CrossInkFirmwareError("The CrossInk release has no supported firmware files.")

    return CrossInkStableRelease(tag=tag, published_at=published_at, html_url=html_url, assets=assets)


def parse_stable_releases(payload: object) -> tuple[CrossInkStableRelease, ...]:
    if not isinstance(payload, list):
        raise CrossInkFirmwareError("GitHub returned invalid release metadata.")

    releases: list[CrossInkStableRelease] = []
    for raw_release in payload:
        if not isinstance(raw_release, dict) or raw_release.get("draft") or raw_release.get("prerelease"):
            continue
        try:
            releases.append(parse_stable_release(raw_release))
        except CrossInkFirmwareError:
            continue
        if len(releases) == STABLE_RELEASE_LIMIT:
            break

    if not releases:
        raise CrossInkFirmwareError("No supported CrossInk releases are currently available.")
    return tuple(releases)


def parse_prerelease_releases(payload: object) -> tuple[CrossInkStableRelease, ...]:
    if not isinstance(payload, list):
        raise CrossInkFirmwareError("GitHub returned invalid release metadata.")

    releases: list[CrossInkStableRelease] = []
    for raw_release in payload:
        if not isinstance(raw_release, dict) or raw_release.get("draft") or not raw_release.get("prerelease"):
            continue
        try:
            releases.append(parse_stable_release(raw_release, allow_prerelease_filename=True))
        except CrossInkFirmwareError:
            continue
        if len(releases) == PRERELEASE_LIMIT:
            break
    return tuple(releases)


async def get_crossink_releases() -> tuple[
    tuple[CrossInkStableRelease, ...],
    tuple[CrossInkStableRelease, ...],
]:
    global _release_cache

    now = time.monotonic()
    if _release_cache and now - _release_cache[0] < RELEASE_CACHE_SECONDS:
        return _release_cache[1], _release_cache[2]

    async with _release_cache_lock:
        now = time.monotonic()
        if _release_cache and now - _release_cache[0] < RELEASE_CACHE_SECONDS:
            return _release_cache[1], _release_cache[2]

        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(
                    CROSSINK_RELEASE_API_URL,
                    headers={
                        "Accept": "application/vnd.github+json",
                        "User-Agent": "Inky",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise CrossInkFirmwareError("Unable to load CrossInk releases from GitHub.") from exc

        payload = response.json()
        stable_releases = parse_stable_releases(payload)
        prerelease_releases = parse_prerelease_releases(payload)
        _release_cache = (time.monotonic(), stable_releases, prerelease_releases)
        return stable_releases, prerelease_releases


def clear_release_cache() -> None:
    global _release_cache
    _release_cache = None


def _is_trusted_release_asset_url(url: str, tag: str) -> bool:
    parsed = urlparse(url)
    return (
        parsed.scheme == "https"
        and parsed.hostname == "github.com"
        and parsed.path.startswith(f"/uxjulia/CrossInk/releases/download/{tag}/")
    )
