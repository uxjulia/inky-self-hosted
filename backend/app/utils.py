from pathlib import Path
from urllib.parse import urljoin, urlparse


def normalize_device_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if not value:
        raise ValueError("device URL is required")
    if "://" not in value:
        value = f"http://{value}"
    return value


def safe_filename(value: str, fallback: str = "item") -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in " ._-" else "_" for ch in value).strip(" .")
    cleaned = " ".join(cleaned.split())
    return cleaned[:180] or fallback


def extension_from_url(url: str, fallback: str = ".epub") -> str:
    suffix = Path(urlparse(url).path).suffix
    if suffix and len(suffix) <= 12:
        return suffix
    return fallback


def join_remote(base_url: str, path: str | None) -> str:
    if not path:
        return base_url
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))


def display_title_from_url(url: str) -> str:
    name = Path(urlparse(url).path).name
    return safe_filename(name.rsplit(".", 1)[0] if name else "Untitled", "Untitled")

