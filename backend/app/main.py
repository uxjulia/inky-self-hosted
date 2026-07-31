from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import shutil
import tempfile
import threading
from pathlib import Path, PurePosixPath

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import httpx
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from .article_epub import fetch_article_as_epub
from .auth import require_basic_auth
from .config import ensure_data_dirs, get_settings
from .connectors import browse_source, search_source
from .crossink_firmware import (
    CrossInkFirmwareError,
    SUPPORTED_VARIANTS,
    get_crossink_releases,
    get_sticky_beta_release,
)
from .crossink_fonts import CrossInkFontsError, get_crossink_fonts
from .crossink_dictionaries import CrossInkDictionariesError, get_crossink_dictionaries
from .db import SessionLocal, get_db, init_db
from .dictionary_prep import (
    dictionary_archive_suffix,
    is_supported_dictionary_archive,
    schedule_existing_prepared_dictionary_cleanup,
)
from .jobs import create_job, run_dictionary_prepare_job, run_optimize_job, run_send_job, run_send_path_job
from .library import (
    copy_uploaded_file,
    delete_library_item,
    get_library_item_cover,
    get_library_item_file_path,
    import_article,
    import_local_source_file,
    import_url,
    import_webdav_file,
    probe_device,
    register_desktop_library_folder,
    resolve_local_source_file,
    sync_mounted_library,
    validate_downloaded_epub,
)
from .models import Job, LibraryItem, Source
from .optimizer.service import optimize_epub
from .schemas import (
    ArticleImportRequest,
    BrowseItem,
    BrowseResult,
    ClientLogRequest,
    DeviceProbeRequest,
    DeviceSendRequest,
    ImportUrlRequest,
    JobRead,
    LibraryItemRead,
    LocalFileImportRequest,
    LocalFileSendRequest,
    LocalFolderImportRequest,
    OptimizeRequest,
    SourceCreate,
    SourceOptimizeRequest,
    SourceReorder,
    SourceRead,
    SourceUpdate,
    WebDavImportRequest,
)
from .utils import join_remote, safe_filename


logger = logging.getLogger("uvicorn.error")


PUBLIC_TEMP_OPTIMIZE_PATH = "/api/optimizer/epub"
PUBLIC_SOURCE_OPTIMIZE_SUFFIX = "/optimize-epub"
PUBLIC_DICTIONARY_PREP_PATH = "/api/dictionaries/prepare"
PUBLIC_TEMP_OPTIMIZE_SEMAPHORE = asyncio.Semaphore(1)

app = FastAPI(title="Inky API", version="0.1.0", dependencies=[Depends(require_basic_auth)])
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def block_public_writes(request: Request, call_next):
    public_temp_optimize = (
        request.method == "POST"
        and (
            request.url.path == PUBLIC_TEMP_OPTIMIZE_PATH
            or request.url.path == PUBLIC_DICTIONARY_PREP_PATH
            or (request.url.path.startswith("/api/sources/") and request.url.path.endswith(PUBLIC_SOURCE_OPTIMIZE_SUFFIX))
        )
    )
    if get_settings().public_read_only and request.method not in {"GET", "HEAD", "OPTIONS"} and not public_temp_optimize:
        return JSONResponse({"detail": "This public Inky instance is read-only."}, status_code=403)
    return await call_next(request)


@app.on_event("startup")
def startup() -> None:
    ensure_data_dirs()
    init_db()
    schedule_existing_prepared_dictionary_cleanup(get_settings().dictionaries_dir / "prepared")
    if not get_settings().public_read_only:
        threading.Thread(target=sync_mounted_library_on_startup, daemon=True).start()


def sync_mounted_library_on_startup() -> None:
    try:
        with SessionLocal() as db:
            sync_mounted_library(db, force=True)
    except Exception as exc:
        print(f"Mounted library startup scan failed: {exc}", flush=True)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/firmware/crossink/releases")
async def crossink_firmware_releases() -> JSONResponse:
    try:
        stable_releases, prerelease_releases = await get_crossink_releases()
    except CrossInkFirmwareError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    settings = get_settings()
    release_entries = [(release, "stable") for release in stable_releases]
    release_entries.extend((release, "prerelease") for release in prerelease_releases)
    if settings.sticky_beta_firmware_url:
        try:
            sticky_beta = await get_sticky_beta_release(
                settings.sticky_beta_firmware_url,
                settings.sticky_beta_version,
            )
            release_entries.append((sticky_beta, "beta"))
        except CrossInkFirmwareError as exc:
            print(f"Sticky beta metadata unavailable: {exc}", flush=True)

    return JSONResponse(
        {
            "releases": [
                {
                    "tag": release.tag,
                    "channel": channel,
                    "published_at": release.published_at,
                    "html_url": release.html_url,
                    "variants": [
                        {
                            "id": variant,
                            "filename": release.assets[variant].filename,
                            "size": release.assets[variant].size,
                        }
                        for variant in SUPPORTED_VARIANTS
                        if variant in release.assets
                    ],
                }
                for release, channel in release_entries
            ]
        },
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/api/firmware/crossink/releases/{tag}/{variant}")
async def download_crossink_firmware(tag: str, variant: str) -> StreamingResponse:
    if variant not in SUPPORTED_VARIANTS:
        raise HTTPException(status_code=404, detail="Unknown CrossInk firmware variant.")

    try:
        stable_releases, prerelease_releases = await get_crossink_releases()
    except CrossInkFirmwareError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    releases = (*stable_releases, *prerelease_releases)
    release = next((item for item in releases if item.tag == tag), None)
    settings = get_settings()
    if (
        not release
        and variant == "sticky"
        and settings.sticky_beta_firmware_url
        and tag == settings.sticky_beta_version.strip()
    ):
        try:
            release = await get_sticky_beta_release(
                settings.sticky_beta_firmware_url,
                settings.sticky_beta_version,
            )
        except CrossInkFirmwareError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not release:
        raise HTTPException(status_code=404, detail="CrossInk release is not available.")
    asset = release.assets.get(variant)
    if not asset:
        raise HTTPException(status_code=404, detail=f"CrossInk {tag} does not include the {variant} variant.")

    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None), follow_redirects=True)
    try:
        upstream = await client.send(
            client.build_request(
                "GET",
                asset.download_url,
                headers={"Accept-Encoding": "identity", "User-Agent": "Inky"},
            ),
            stream=True,
        )
        upstream.raise_for_status()
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail="Unable to download CrossInk firmware.") from exc

    async def close_download() -> None:
        await upstream.aclose()
        await client.aclose()

    return StreamingResponse(
        upstream.aiter_bytes(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{asset.filename}"',
            "Content-Length": str(asset.size),
            "Cache-Control": "public, max-age=300",
        },
        background=BackgroundTask(close_download),
    )


@app.get("/api/fonts/crossink")
async def crossink_fonts() -> JSONResponse:
    try:
        fonts = await get_crossink_fonts()
    except CrossInkFontsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return JSONResponse(
        {"fonts": [{"filename": font.filename, "size": font.size} for font in fonts]},
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/api/fonts/crossink/{filename}")
async def download_crossink_font(filename: str) -> StreamingResponse:
    try:
        fonts = await get_crossink_fonts()
    except CrossInkFontsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    font = next((item for item in fonts if item.filename == filename), None)
    if not font:
        raise HTTPException(status_code=404, detail="CrossInk font package is not available.")

    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None), follow_redirects=True)
    try:
        upstream = await client.send(
            client.build_request(
                "GET",
                font.download_url,
                headers={"Accept-Encoding": "identity", "User-Agent": "Inky"},
            ),
            stream=True,
        )
        upstream.raise_for_status()
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail="Unable to download CrossInk font package.") from exc

    async def close_download() -> None:
        await upstream.aclose()
        await client.aclose()

    return StreamingResponse(
        upstream.aiter_bytes(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{font.filename}"',
            "Content-Length": str(font.size),
            "Cache-Control": "public, max-age=300",
        },
        background=BackgroundTask(close_download),
    )


@app.get("/api/fonts/dictionary")
async def crossink_dictionary_fonts() -> JSONResponse:
    try:
        fonts = await get_crossink_fonts("dictionary")
    except CrossInkFontsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return JSONResponse(
        {"fonts": [{"filename": font.filename, "size": font.size} for font in fonts]},
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/api/fonts/dictionary/{filename}")
async def download_crossink_dictionary_font(filename: str) -> StreamingResponse:
    try:
        fonts = await get_crossink_fonts("dictionary")
    except CrossInkFontsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    font = next((item for item in fonts if item.filename == filename), None)
    if not font:
        raise HTTPException(status_code=404, detail="CrossInk dictionary font package is not available.")

    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None), follow_redirects=True)
    try:
        upstream = await client.send(
            client.build_request(
                "GET",
                font.download_url,
                headers={"Accept-Encoding": "identity", "User-Agent": "Inky"},
            ),
            stream=True,
        )
        upstream.raise_for_status()
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail="Unable to download CrossInk dictionary font package.") from exc

    async def close_download() -> None:
        await upstream.aclose()
        await client.aclose()

    return StreamingResponse(
        upstream.aiter_bytes(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{font.filename}"',
            "Content-Length": str(font.size),
            "Cache-Control": "public, max-age=300",
        },
        background=BackgroundTask(close_download),
    )


@app.get("/api/dictionaries/catalog")
async def crossink_dictionary_catalog() -> JSONResponse:
    try:
        dictionaries = await get_crossink_dictionaries()
    except CrossInkDictionariesError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return JSONResponse(
        {"dictionaries": [{"filename": item.filename, "size": item.size} for item in dictionaries]},
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/api/dictionaries/catalog/{filename}")
async def download_crossink_dictionary(filename: str) -> StreamingResponse:
    try:
        dictionaries = await get_crossink_dictionaries()
    except CrossInkDictionariesError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    dictionary = next((item for item in dictionaries if item.filename == filename), None)
    if not dictionary:
        raise HTTPException(status_code=404, detail="Dictionary package is not available.")

    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None), follow_redirects=True)
    try:
        upstream = await client.send(
            client.build_request(
                "GET",
                dictionary.download_url,
                headers={"Accept-Encoding": "identity", "User-Agent": "Inky"},
            ),
            stream=True,
        )
        upstream.raise_for_status()
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail="Unable to download dictionary package.") from exc

    async def close_download() -> None:
        await upstream.aclose()
        await client.aclose()

    return StreamingResponse(
        upstream.aiter_bytes(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{dictionary.filename}"',
            "Content-Length": str(dictionary.size),
            "Cache-Control": "public, max-age=300",
        },
        background=BackgroundTask(close_download),
    )


@app.get("/api/auth/status")
def auth_status() -> dict:
    return {"enabled": get_settings().auth_enabled}


@app.get("/api/auth/login")
def auth_login() -> dict:
    return {"ok": True}


@app.post("/api/client-log")
def client_log(payload: ClientLogRequest) -> dict:
    safe_scope = "".join(char if char.isalnum() or char in ".:-_" else "_" for char in payload.scope)[:40] or "client"
    print(f"[client:{safe_scope}] {payload.level.upper()}: {payload.message}", flush=True)
    return {"ok": True}


def raise_download_error(exc: httpx.HTTPError) -> None:
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        reason = exc.response.reason_phrase
        detail = f"Unable to download from source. The source returned {status_code} {reason}."
    else:
        detail = "Unable to download from source. Check the source connection and try again."
    raise HTTPException(status_code=502, detail=detail) from exc


@app.get("/api/sources", response_model=list[SourceRead])
def list_sources(db: Session = Depends(get_db)) -> list[Source]:
    return db.query(Source).order_by(Source.display_order.asc(), Source.created_at.desc()).all()


@app.post("/api/sources", response_model=SourceRead)
def create_source(payload: SourceCreate, db: Session = Depends(get_db)) -> Source:
    next_order = (db.query(func.max(Source.display_order)).scalar() or -1) + 1
    source = Source(**payload.model_dump(mode="json"), display_order=next_order)
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


@app.put("/api/sources/reorder", response_model=list[SourceRead])
def reorder_sources(payload: SourceReorder, db: Session = Depends(get_db)) -> list[Source]:
    sources = db.query(Source).filter(Source.id.in_(payload.source_ids)).all()
    sources_by_id = {source.id: source for source in sources}
    if len(sources_by_id) != len(set(payload.source_ids)):
        raise HTTPException(status_code=400, detail="invalid source order")

    for index, source_id in enumerate(payload.source_ids):
        sources_by_id[source_id].display_order = index

    db.commit()
    return db.query(Source).order_by(Source.display_order.asc(), Source.created_at.desc()).all()


@app.put("/api/sources/{source_id}", response_model=SourceRead)
def update_source(source_id: int, payload: SourceUpdate, db: Session = Depends(get_db)) -> Source:
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="source not found")

    source.type = payload.type.value
    source.name = payload.name
    source.url = payload.url
    source.username = payload.username
    if payload.password:
        source.password = payload.password

    db.commit()
    db.refresh(source)
    return source


@app.delete("/api/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db)) -> dict:
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="source not found")
    db.delete(source)
    db.commit()
    return {"ok": True}


@app.get("/api/sources/{source_id}/browse", response_model=BrowseResult)
async def browse(source_id: int, target: str | None = None, db: Session = Depends(get_db)) -> BrowseResult:
    try:
        return await browse_source(db, source_id, target)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=source_error_detail(exc)) from exc


@app.get("/api/sources/{source_id}/search", response_model=BrowseResult)
async def search(source_id: int, q: str, target: str | None = None, db: Session = Depends(get_db)) -> BrowseResult:
    try:
        return await search_source(db, source_id, q, target)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=source_error_detail(exc)) from exc


def source_error_detail(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "The source timed out while Inky was trying to browse it. Try again in a moment."
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        reason = exc.response.reason_phrase
        return f"The source returned {status_code} {reason} while Inky was trying to browse it."
    if isinstance(exc, httpx.RequestError):
        return "Inky could not connect to the source. Check the source URL and try again."
    detail = str(exc).strip()
    return detail or f"Unable to browse source ({type(exc).__name__})."


@app.get("/api/library", response_model=list[LibraryItemRead])
def list_library(db: Session = Depends(get_db)) -> list[LibraryItem]:
    return db.query(LibraryItem).order_by(LibraryItem.updated_at.desc()).all()


@app.post("/api/library/rescan", response_model=list[LibraryItemRead])
def rescan_library(db: Session = Depends(get_db)) -> list[LibraryItem]:
    sync_mounted_library(db, force=True)
    return db.query(LibraryItem).order_by(LibraryItem.updated_at.desc()).all()


@app.post("/api/library/import-url", response_model=LibraryItemRead)
async def import_remote(payload: ImportUrlRequest, db: Session = Depends(get_db)) -> LibraryItem:
    auth = None
    if payload.source_id:
        source = db.get(Source, payload.source_id)
        if source and source.username and source.password:
            auth = (source.username, source.password)
    try:
        return await import_url(db, payload.url, payload.source_id, payload.title, payload.author, payload.cover_url, payload.kind.value, auth)
    except httpx.HTTPError as exc:
        raise_download_error(exc)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/library/import-article", response_model=LibraryItemRead)
async def import_feed_article(payload: ArticleImportRequest, db: Session = Depends(get_db)) -> LibraryItem:
    try:
        return await import_article(db, str(payload.url), payload.source_id, payload.title, payload.author, payload.cover_url)
    except httpx.HTTPError as exc:
        raise_download_error(exc)


@app.post("/api/library/import-webdav", response_model=LibraryItemRead)
async def import_from_webdav(payload: WebDavImportRequest, db: Session = Depends(get_db)) -> LibraryItem:
    source = db.get(Source, payload.source_id)
    if not source or source.type != "webdav":
        raise HTTPException(status_code=404, detail="WebDAV source not found")
    try:
        return await import_webdav_file(db, source, payload.path, payload.title, payload.cover_url)
    except httpx.HTTPError as exc:
        raise_download_error(exc)


@app.post("/api/library/import-local-file", response_model=LibraryItemRead)
def import_from_local_folder(payload: LocalFileImportRequest, db: Session = Depends(get_db)) -> LibraryItem:
    source = db.get(Source, payload.source_id)
    if not source or source.type != "local_folder":
        raise HTTPException(status_code=404, detail="Local folder source not found")
    try:
        return import_local_source_file(db, source, payload.path, payload.title)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/library/upload", response_model=LibraryItemRead)
async def upload_file(file: UploadFile = File(...), db: Session = Depends(get_db)) -> LibraryItem:
    suffix = Path(file.filename or "upload.epub").suffix or ".epub"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp:
        temp_path = Path(temp.name)
        while chunk := await file.read(1024 * 1024):
            temp.write(chunk)
    try:
        return copy_uploaded_file(db, temp_path, file.filename or "upload.epub")
    finally:
        temp_path.unlink(missing_ok=True)


@app.post("/api/dictionaries/prepare", response_model=JobRead)
async def prepare_dictionary(
    background: BackgroundTasks,
    file: UploadFile | None = File(None),
    folder_files: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
) -> Job:
    if file and folder_files:
        raise HTTPException(status_code=400, detail="upload either a dictionary archive or one dictionary folder")
    if folder_files:
        return await _prepare_dictionary_folder(background, folder_files, db)
    if not file:
        raise HTTPException(status_code=400, detail="choose a dictionary archive or folder")

    filename = file.filename or "dictionary.zip"
    if not is_supported_dictionary_archive(filename):
        raise HTTPException(status_code=400, detail="only StarDict ZIP, 7Z, TAR, or RAR archives can be prepared")

    with tempfile.NamedTemporaryFile(
        suffix=dictionary_archive_suffix(filename),
        prefix="inky-dictionary-upload-",
        delete=False,
    ) as temp:
        temp_path = Path(temp.name)
        upload_bytes = 0
        archive_hash = hashlib.sha256()
        while chunk := await file.read(1024 * 1024):
            temp.write(chunk)
            upload_bytes += len(chunk)
            archive_hash.update(chunk)

    if upload_bytes == 0:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="dictionary archive is empty")

    job = create_job(db, "dictionary_prepare")
    logger.info(
        "Dictionary upload accepted: job_id=%s filename=%r content_type=%r archive_bytes=%d archive_sha256=%s",
        job.id,
        filename,
        file.content_type,
        upload_bytes,
        archive_hash.hexdigest(),
    )
    background.add_task(
        run_dictionary_prepare_job,
        job.id,
        str(temp_path),
        filename,
        archive_hash.hexdigest(),
    )
    return job


async def _prepare_dictionary_folder(
    background: BackgroundTasks,
    folder_files: list[UploadFile],
    db: Session,
) -> Job:
    temp_path = Path(tempfile.mkdtemp(prefix="inky-dictionary-folder-"))
    upload_bytes = 0
    folder_hash = hashlib.sha256()
    try:
        for upload in folder_files:
            relative_path = _safe_dictionary_folder_upload_path(upload.filename)
            if relative_path is None:
                continue
            destination = temp_path / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("wb") as target:
                while chunk := await upload.read(1024 * 1024):
                    target.write(chunk)
                    upload_bytes += len(chunk)
                    folder_hash.update(chunk)
        if upload_bytes == 0:
            raise HTTPException(status_code=400, detail="dictionary folder is empty")

        job = create_job(db, "dictionary_prepare")
        logger.info(
            "Dictionary folder accepted: job_id=%s files=%d folder_bytes=%d folder_sha256=%s",
            job.id,
            len(folder_files),
            upload_bytes,
            folder_hash.hexdigest(),
        )
        background.add_task(
            run_dictionary_prepare_job,
            job.id,
            str(temp_path),
            "dictionary folder",
            folder_hash.hexdigest(),
        )
        return job
    except Exception:
        shutil.rmtree(temp_path, ignore_errors=True)
        raise


def _safe_dictionary_folder_upload_path(filename: str | None) -> Path | None:
    path = PurePosixPath(filename or "")
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise HTTPException(status_code=400, detail="dictionary folder contains an unsafe path")
    if path.parts[0] == "__MACOSX" or path.parts[-1] == ".DS_Store" or path.parts[-1].startswith("._"):
        return None
    return Path(*path.parts)


@app.get("/api/dictionaries/prepared/{job_id}/download")
def download_prepared_dictionary(job_id: str, db: Session = Depends(get_db)) -> FileResponse:
    job = db.get(Job, job_id)
    if not job or job.type != "dictionary_prepare":
        raise HTTPException(status_code=404, detail="dictionary prepare job not found")
    if job.status != "succeeded" or not job.result_json:
        raise HTTPException(status_code=400, detail="dictionary is not ready")

    try:
        result = json.loads(job.result_json)
        output_path = Path(result["output_path"]).resolve()
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="dictionary job result is invalid") from exc

    prepared_root = (get_settings().dictionaries_dir / "prepared").resolve()
    if output_path != prepared_root and prepared_root not in output_path.parents:
        raise HTTPException(status_code=404, detail="prepared dictionary not found")
    if not output_path.is_file():
        raise HTTPException(status_code=404, detail="prepared dictionary not found")

    filename = str(result.get("filename") or output_path.name)
    return FileResponse(output_path, media_type="application/zip", filename=filename)


@app.post(PUBLIC_TEMP_OPTIMIZE_PATH)
async def optimize_uploaded_epub(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    settings: str = Form("{}"),
) -> FileResponse:
    filename = file.filename or "upload.epub"
    if Path(filename).suffix.lower() != ".epub":
        raise HTTPException(status_code=400, detail="only EPUB files can be optimized")

    try:
        request = OptimizeRequest.model_validate_json(settings)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors()) from exc

    temp_dir = Path(tempfile.mkdtemp(prefix="inky-optimize-", dir=get_settings().data_dir))
    input_path = temp_dir / safe_filename(filename, "upload.epub")
    try:
        with input_path.open("wb") as temp:
            while chunk := await file.read(1024 * 1024):
                temp.write(chunk)
        async with PUBLIC_TEMP_OPTIMIZE_SEMAPHORE:
            output_path, result = await run_in_threadpool(optimize_epub, input_path, temp_dir, request)
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

    background.add_task(shutil.rmtree, temp_dir, ignore_errors=True)
    return FileResponse(
        output_path,
        media_type="application/epub+zip",
        filename=result.get("device_filename") or output_path.name,
        background=background,
    )


@app.post("/api/sources/{source_id}" + PUBLIC_SOURCE_OPTIMIZE_SUFFIX)
async def optimize_source_epub(
    source_id: int,
    payload: SourceOptimizeRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> FileResponse:
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="source not found")

    temp_dir = Path(tempfile.mkdtemp(prefix="inky-source-optimize-", dir=get_settings().data_dir))
    try:
        input_path = await source_item_to_temp_epub(source, payload.item, temp_dir)
        async with PUBLIC_TEMP_OPTIMIZE_SEMAPHORE:
            output_path, result = await run_in_threadpool(optimize_epub, input_path, temp_dir, payload.settings)
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

    background.add_task(shutil.rmtree, temp_dir, ignore_errors=True)
    return FileResponse(
        output_path,
        media_type="application/epub+zip",
        filename=result.get("device_filename") or output_path.name,
        background=background,
    )


async def source_item_to_temp_epub(source: Source, item: BrowseItem, temp_dir: Path) -> Path:
    if item.type == "article" and item.url:
        return await fetch_article_as_epub(item.url, temp_dir, item.title, item.author)

    if item.type == "file" and item.path and source.type == "local_folder":
        source_path = resolve_local_source_file(source, item.path)
        if source_path.suffix.lower() != ".epub":
            raise HTTPException(status_code=400, detail="only EPUB files can be optimized")
        destination = temp_dir / safe_filename(source_path.name, "source.epub")
        shutil.copyfile(source_path, destination)
        return destination

    url = item.url
    if not url and item.path and source.type == "webdav":
        url = join_remote(source.url, item.path)
    if not url or not is_epub_browse_item(item):
        raise HTTPException(status_code=400, detail="only EPUB files can be optimized")

    auth = (source.username, source.password) if source.username and source.password else None
    filename = safe_filename(f"{item.title or Path(url).stem}{Path(url).suffix or '.epub'}", "source.epub")
    if not filename.lower().endswith(".epub"):
        filename += ".epub"
    destination = temp_dir / filename
    try:
        async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
            async with client.stream("GET", url, auth=auth) as response:
                response.raise_for_status()
                with destination.open("wb") as handle:
                    async for chunk in response.aiter_bytes(64 * 1024):
                        handle.write(chunk)
        validate_downloaded_epub(destination)
    except httpx.HTTPError as exc:
        raise_download_error(exc)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return destination


def is_epub_browse_item(item: BrowseItem) -> bool:
    media_type = (item.media_type or "").lower()
    return (
        "application/epub+zip" in media_type
        or Path((item.url or "").split("?", 1)[0]).suffix.lower() == ".epub"
        or Path((item.path or "").split("?", 1)[0]).suffix.lower() == ".epub"
    )


@app.post("/api/library/folders", response_model=list[LibraryItemRead])
def add_library_folder(payload: LocalFolderImportRequest, db: Session = Depends(get_db)) -> list[LibraryItem]:
    try:
        return register_desktop_library_folder(db, Path(payload.path))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/library/{item_id}/cover")
def library_cover(item_id: int, db: Session = Depends(get_db)) -> Response:
    item = db.get(LibraryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="library item not found")
    try:
        content, media_type = get_library_item_cover(item)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="cover not found") from exc
    return Response(content=content, media_type=media_type)


@app.get("/api/library/{item_id}/download")
def library_download(item_id: int, db: Session = Depends(get_db)) -> FileResponse:
    item = db.get(LibraryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="library item not found")
    try:
        path = get_library_item_file_path(item)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="library file not found") from exc
    return FileResponse(path, media_type=_media_type_for_download(path), filename=path.name)


@app.delete("/api/library/{item_id}")
def remove_library_item(item_id: int, db: Session = Depends(get_db)) -> dict:
    item = db.get(LibraryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="library item not found")
    try:
        delete_library_item(db, item)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/api/library/{item_id}/optimize", response_model=JobRead)
def optimize_item(item_id: int, payload: OptimizeRequest, background: BackgroundTasks, db: Session = Depends(get_db)) -> Job:
    item = db.get(LibraryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="library item not found")
    if not item.original_path.lower().endswith(".epub"):
        raise HTTPException(status_code=400, detail="only EPUB files can be optimized")
    job = create_job(db, "optimize", item_id)
    background.add_task(run_optimize_job, job.id, item_id, payload)
    return job


@app.post("/api/library/{item_id}/send", response_model=JobRead)
def send_item(item_id: int, payload: DeviceSendRequest, background: BackgroundTasks, db: Session = Depends(get_db)) -> Job:
    item = db.get(LibraryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="library item not found")
    job = create_job(db, "send", item_id)
    background.add_task(run_send_job, job.id, item_id, payload)
    return job


@app.post("/api/sources/{source_id}/send-local-file", response_model=JobRead)
def send_local_source_file(
    source_id: int,
    payload: LocalFileSendRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> Job:
    source = db.get(Source, source_id)
    if not source or source.type != "local_folder":
        raise HTTPException(status_code=404, detail="Local folder source not found")
    try:
        file_path = resolve_local_source_file(source, payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    job = create_job(db, "send")
    background.add_task(run_send_path_job, job.id, str(file_path), payload)
    return job


@app.post("/api/devices/probe")
async def probe(payload: DeviceProbeRequest) -> dict:
    try:
        return await probe_device(payload.device_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/jobs", response_model=list[JobRead])
def list_jobs(db: Session = Depends(get_db)) -> list[Job]:
    return db.query(Job).order_by(Job.created_at.desc()).limit(50).all()


@app.get("/api/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: str, db: Session = Depends(get_db)) -> Job:
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


def _media_type_for_download(path: Path) -> str:
    extension = path.suffix.lower()
    if extension == ".epub":
        return "application/epub+zip"
    if extension == ".txt":
        return "text/plain"
    if extension == ".bmp":
        return "image/bmp"
    if extension == ".png":
        return "image/png"
    return "application/octet-stream"


static_dir = Path(os.environ.get("INKY_STATIC_DIR", "frontend/dist"))
if static_dir.exists():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
