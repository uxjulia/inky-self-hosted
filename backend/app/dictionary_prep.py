from __future__ import annotations

import gzip
import logging
import shutil
import struct
import tarfile
import tempfile
import zipfile
from collections.abc import Callable
from pathlib import Path, PurePosixPath

import rarfile
import zstandard

from .utils import safe_filename


logger = logging.getLogger("uvicorn.error")

# rarfile's small-file optimization rebuilds a partial RAR before invoking the
# extractor. Some valid RAR5 archives cannot be read from that partial archive.
rarfile.USE_EXTRACT_HACK = 0


class DictionaryPrepError(ValueError):
    pass


ProgressCallback = Callable[[int, str], None]

_OFT_HEADER = b"StarDict's Cache, Version: 0.2" + b"\xc1\xd1\xa4\x51\x00\x00\x00\x00"
_STRIDE = 32

_CSPT_MAGIC = b"CSPT"
_CSPT_VERSION = 1
_CSPT_PREFIX_LEN = 16
_CSPT_STRIDE = 16
_UNAR_CANDIDATES = (
    "/opt/homebrew/bin/unar",
    "/usr/local/bin/unar",
    "/usr/bin/unar",
)


def prepare_dictionary_zip(source_zip: Path, output_dir: Path, progress: ProgressCallback | None = None) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    _report(progress, 5, "Reading dictionary archive")

    with tempfile.TemporaryDirectory(prefix="dictionary-", dir=output_dir) as work_path:
        work_dir = Path(work_path)
        _extract_safe_archive(source_zip, work_dir)
        _report(progress, 20, "Validating StarDict files")

        dictionary_dir, stem = _locate_dictionary(work_dir)
        _validate_required_files(dictionary_dir, stem)

        _report(progress, 40, "Expanding compressed dictionary files")
        _decompress_if_needed(dictionary_dir / f"{stem}.dict.dz", dictionary_dir / f"{stem}.dict")
        _decompress_if_needed(dictionary_dir / f"{stem}.syn.dz", dictionary_dir / f"{stem}.syn")

        _report(progress, 65, "Building CrossInk dictionary indexes")
        idx_path = dictionary_dir / f"{stem}.idx"
        idx_oft_path = dictionary_dir / f"{stem}.idx.oft"
        idx_oft_data = _build_oft(idx_path.read_bytes(), skip_bytes_after_null=8)
        idx_oft_path.write_bytes(idx_oft_data)
        (dictionary_dir / f"{stem}.idx.oft.cspt").write_bytes(
            _build_cspt(idx_path.read_bytes(), idx_oft_data, skip_per_entry=8)
        )

        syn_path = dictionary_dir / f"{stem}.syn"
        if syn_path.exists():
            syn_oft_path = dictionary_dir / f"{stem}.syn.oft"
            syn_oft_data = _build_oft(syn_path.read_bytes(), skip_bytes_after_null=4)
            syn_oft_path.write_bytes(syn_oft_data)
            (dictionary_dir / f"{stem}.syn.oft.cspt").write_bytes(
                _build_cspt(syn_path.read_bytes(), syn_oft_data, skip_per_entry=4)
            )

        _report(progress, 88, "Packaging prepared dictionary")
        source_folder_name = stem if dictionary_dir.resolve() == work_dir.resolve() else dictionary_dir.name
        folder_name = safe_filename(source_folder_name, stem) or safe_filename(stem, "dictionary")
        output_zip = output_dir / f"{folder_name}.prepared.zip"
        files = _write_prepared_zip(dictionary_dir, folder_name, output_zip)

    _report(progress, 98, "Prepared dictionary ZIP is ready")
    return {
        "dictionary_name": folder_name,
        "stem": stem,
        "filename": output_zip.name,
        "output_path": str(output_zip),
        "files": files,
    }


def _report(progress: ProgressCallback | None, percent: int, message: str) -> None:
    if progress:
        progress(percent, message)


def is_supported_dictionary_archive(filename: str) -> bool:
    normalized = filename.lower()
    return normalized.endswith(".zip") or normalized.endswith(".tar.zst") or normalized.endswith(".rar")


def dictionary_archive_suffix(filename: str) -> str:
    return ".tar.zst" if filename.lower().endswith(".tar.zst") else Path(filename).suffix or ".zip"


def _extract_safe_archive(source_archive: Path, destination: Path) -> None:
    if source_archive.name.lower().endswith(".tar.zst"):
        _extract_safe_tar_zst(source_archive, destination)
        return
    if source_archive.name.lower().endswith(".rar"):
        _extract_safe_rar(source_archive, destination)
        return
    _extract_safe_zip(source_archive, destination)


def _extract_safe_zip(source_zip: Path, destination: Path) -> None:
    try:
        with zipfile.ZipFile(source_zip) as archive:
            for member in archive.infolist():
                relative_path = _safe_zip_member_path(member.filename)
                if relative_path is None:
                    continue
                target = destination / relative_path
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, target.open("wb") as dest:
                    shutil.copyfileobj(source, dest)
    except zipfile.BadZipFile as exc:
        raise DictionaryPrepError("invalid dictionary zip") from exc


def _extract_safe_tar_zst(source_tar_zst: Path, destination: Path) -> None:
    try:
        with source_tar_zst.open("rb") as compressed:
            reader = zstandard.ZstdDecompressor().stream_reader(compressed)
            with reader, tarfile.open(fileobj=reader, mode="r|") as archive:
                for member in archive:
                    relative_path = _safe_archive_member_path(member.name)
                    if relative_path is None:
                        continue
                    target = destination / relative_path
                    if member.isdir():
                        target.mkdir(parents=True, exist_ok=True)
                        continue
                    if not member.isfile():
                        raise DictionaryPrepError(f"unsupported tar member in archive: {member.name}")
                    extracted = archive.extractfile(member)
                    if extracted is None:
                        raise DictionaryPrepError(f"unable to read tar member: {member.name}")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with extracted, target.open("wb") as dest:
                        shutil.copyfileobj(extracted, dest)
    except (tarfile.TarError, zstandard.ZstdError) as exc:
        raise DictionaryPrepError("invalid dictionary tar.zst") from exc


def _extract_safe_rar(source_rar: Path, destination: Path) -> None:
    configured_extractor = _prefer_available_unar()
    try:
        with rarfile.RarFile(source_rar) as archive:
            members = archive.infolist()
            unpacked_bytes = sum(getattr(member, "file_size", 0) for member in members)
            logger.info(
                "RAR dictionary extraction started: archive_bytes=%d members=%d unpacked_bytes=%d solid=%s extractor=%s",
                source_rar.stat().st_size,
                len(members),
                unpacked_bytes,
                archive.is_solid() if hasattr(archive, "is_solid") else "unknown",
                configured_extractor or "automatic",
            )
            for member in members:
                relative_path = _safe_archive_member_path(member.filename)
                if relative_path is None:
                    continue
                target = destination / relative_path
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if not member.is_file():
                    raise DictionaryPrepError(f"unsupported rar member in archive: {member.filename}")
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, target.open("wb") as dest:
                    shutil.copyfileobj(source, dest)
            logger.info(
                "RAR dictionary extraction completed: members=%d extractor=%s",
                len(members),
                _active_rar_extractor(configured_extractor),
            )
    except rarfile.RarCannotExec as exc:
        logger.exception("RAR extractor is unavailable: configured_extractor=%s", configured_extractor or "automatic")
        raise DictionaryPrepError("RAR extraction is unavailable on this server; no working extractor was found") from exc
    except rarfile.Error as exc:
        extractor = _active_rar_extractor(configured_extractor)
        detail = str(exc).strip() or type(exc).__name__
        logger.exception(
            "RAR dictionary extraction failed: archive_bytes=%d extractor=%s error_type=%s",
            source_rar.stat().st_size,
            extractor,
            type(exc).__name__,
        )
        raise DictionaryPrepError(
            f"RAR extraction failed using {extractor} ({type(exc).__name__}): {detail}"
        ) from exc


def _prefer_available_unar() -> str | None:
    for candidate in _UNAR_CANDIDATES:
        if Path(candidate).is_file():
            if rarfile.UNAR_TOOL != candidate:
                rarfile.UNAR_TOOL = candidate
                rarfile.CURRENT_SETUP = None
            return candidate
    return None


def _active_rar_extractor(configured_extractor: str | None) -> str:
    setup = rarfile.CURRENT_SETUP
    if setup is not None:
        command_setting = setup.setup.get("open_cmd", ("",))[0]
        command = getattr(rarfile, command_setting, command_setting)
        if command:
            return str(command)
    return configured_extractor or "automatic extractor"


def _safe_zip_member_path(name: str) -> Path | None:
    return _safe_archive_member_path(name)


def _safe_archive_member_path(name: str) -> Path | None:
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise DictionaryPrepError(f"unsafe path in archive: {name}")
    if not path.parts:
        return None
    if _is_macos_metadata_path(path.parts):
        return None
    return Path(*path.parts)


def _is_macos_metadata_path(parts: tuple[str, ...]) -> bool:
    return parts[0] == "__MACOSX" or parts[-1] == ".DS_Store" or parts[-1].startswith("._")


def _locate_dictionary(work_dir: Path) -> tuple[Path, str]:
    ifo_files = sorted(path for path in work_dir.rglob("*.ifo") if path.is_file())
    if not ifo_files:
        raise DictionaryPrepError("no .ifo file found")
    stems = {path.stem for path in ifo_files}
    if len(stems) != 1:
        raise DictionaryPrepError("multiple .ifo stems found")
    if len({path.parent.resolve() for path in ifo_files}) != 1:
        raise DictionaryPrepError("multiple dictionary folders found")
    ifo_path = ifo_files[0]
    return ifo_path.parent, ifo_path.stem


def _validate_required_files(dictionary_dir: Path, stem: str) -> None:
    if not (dictionary_dir / f"{stem}.idx").is_file():
        raise DictionaryPrepError(f"missing required file: {stem}.idx")
    if not (dictionary_dir / f"{stem}.dict").is_file() and not (dictionary_dir / f"{stem}.dict.dz").is_file():
        raise DictionaryPrepError(f"missing required file: {stem}.dict or {stem}.dict.dz")


def _decompress_if_needed(source: Path, destination: Path) -> None:
    if not source.exists() or destination.exists():
        return
    with gzip.open(source, "rb") as compressed, destination.open("wb") as decompressed:
        shutil.copyfileobj(compressed, decompressed)


def _build_oft(data: bytes, skip_bytes_after_null: int) -> bytes:
    offsets: list[int] = []
    entry_count = 0
    pos = 0
    while pos < len(data):
        try:
            null = data.index(b"\x00", pos)
        except ValueError as exc:
            raise DictionaryPrepError("invalid StarDict index: missing null terminator") from exc
        pos = null + 1 + skip_bytes_after_null
        if pos > len(data):
            raise DictionaryPrepError("invalid StarDict index: truncated entry")
        entry_count += 1
        if entry_count % _STRIDE == 0:
            offsets.append(pos)
    offsets.append(len(data))
    return _OFT_HEADER + b"".join(struct.pack("<I", offset) for offset in offsets)


def _build_cspt(src_data: bytes, oft_data: bytes, skip_per_entry: int = 8) -> bytes:
    table_bytes = oft_data[len(_OFT_HEADER) :]
    num_oft_entries = len(table_bytes) // 4
    if num_oft_entries > 0:
        num_oft_entries -= 1

    page_offsets = [0]
    for index in range(num_oft_entries):
        page_offsets.append(struct.unpack_from("<I", table_bytes, index * 4)[0])

    entries: list[bytes] = []
    for page_offset in page_offsets:
        pos = page_offset
        if pos >= len(src_data):
            break
        word = _read_word(src_data, pos)
        if word is None:
            break
        entries.append(_cspt_entry(word, pos))

        scan_pos = pos
        for _ in range(_CSPT_STRIDE):
            next_pos = _next_entry_pos(src_data, scan_pos, skip_per_entry)
            if next_pos is None:
                scan_pos = len(src_data)
                break
            scan_pos = next_pos
        if scan_pos >= len(src_data):
            continue
        word = _read_word(src_data, scan_pos)
        if word is not None:
            entries.append(_cspt_entry(word, scan_pos))

    header = (
        _CSPT_MAGIC
        + struct.pack("<B", _CSPT_VERSION)
        + struct.pack("<B", _CSPT_PREFIX_LEN)
        + struct.pack("<H", _CSPT_STRIDE)
        + struct.pack("<I", len(entries))
    )
    return header + b"".join(entries)


def _read_word(data: bytes, pos: int) -> bytes | None:
    try:
        null = data.index(b"\x00", pos)
    except ValueError:
        return None
    return data[pos:null]


def _next_entry_pos(data: bytes, pos: int, skip_per_entry: int) -> int | None:
    try:
        null = data.index(b"\x00", pos)
    except ValueError:
        return None
    next_pos = null + 1 + skip_per_entry
    return next_pos if next_pos <= len(data) else None


def _cspt_entry(word: bytes, offset: int) -> bytes:
    prefix = word[:_CSPT_PREFIX_LEN].ljust(_CSPT_PREFIX_LEN, b"\x00")
    return prefix + struct.pack("<I", offset)


def _write_prepared_zip(dictionary_dir: Path, folder_name: str, output_zip: Path) -> list[str]:
    entries: list[str] = []
    with zipfile.ZipFile(output_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(dictionary_dir.iterdir()):
            if not path.is_file():
                continue
            if path.suffix == ".dz":
                continue
            arcname = f"{folder_name}/{path.name}"
            archive.write(path, arcname)
            entries.append(arcname)
    return entries
