from __future__ import annotations

import posixpath
import zipfile
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET


class EpubValidationError(ValueError):
    pass


def validate_epub_archive(path: Path) -> None:
    """Reject corrupt or structurally incomplete EPUB archives."""
    try:
        with zipfile.ZipFile(path) as archive:
            corrupt_entry = archive.testzip()
            if corrupt_entry:
                raise EpubValidationError(f"archive entry is corrupt: {corrupt_entry}")

            names = set(archive.namelist())
            container_path = "META-INF/container.xml"
            if container_path not in names:
                raise EpubValidationError("META-INF/container.xml is missing")

            container = ET.fromstring(archive.read(container_path))
            rootfile = _first_element(container, "rootfile")
            opf_path = _archive_path(rootfile.attrib.get("full-path", "")) if rootfile is not None else ""
            if not opf_path or opf_path not in names:
                raise EpubValidationError("the package document is missing")

            package = ET.fromstring(archive.read(opf_path))
            manifest = {
                item.attrib["id"]: item.attrib.get("href", "")
                for item in package.iter()
                if _local_name(item.tag) == "item" and item.attrib.get("id")
            }
            spine_refs = [
                item.attrib.get("idref", "")
                for item in package.iter()
                if _local_name(item.tag) == "itemref"
            ]
            if not spine_refs:
                raise EpubValidationError("the reading order is empty")

            opf_dir = posixpath.dirname(opf_path)
            for idref in spine_refs:
                href = manifest.get(idref)
                if not href:
                    raise EpubValidationError(f"reading-order item {idref!r} is not in the manifest")
                content_path = _archive_path(posixpath.join(opf_dir, href))
                if content_path not in names:
                    raise EpubValidationError(f"reading-order file is missing: {content_path}")
    except EpubValidationError:
        raise
    except Exception as exc:
        raise EpubValidationError("the file is not a complete EPUB archive") from exc


def _archive_path(value: str) -> str:
    return posixpath.normpath(unquote(value.split("#", 1)[0].split("?", 1)[0]).lstrip("/"))


def _first_element(root: ET.Element, name: str) -> ET.Element | None:
    return next((element for element in root.iter() if _local_name(element.tag) == name), None)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
