from __future__ import annotations

import tempfile
import threading
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

from .auth import require_basic_auth
from .config import ensure_data_dirs, get_settings
from .connectors import browse_source, search_source
from .db import SessionLocal, get_db, init_db
from .jobs import create_job, run_optimize_job, run_send_job, run_send_path_job
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
)
from .models import Job, LibraryItem, Source
from .schemas import (
    ArticleImportRequest,
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
    SourceReorder,
    SourceRead,
    SourceUpdate,
    WebDavImportRequest,
)


app = FastAPI(title="Inky API", version="0.1.0", dependencies=[Depends(require_basic_auth)])
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    ensure_data_dirs()
    init_db()
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
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/sources/{source_id}/search", response_model=BrowseResult)
async def search(source_id: int, q: str, target: str | None = None, db: Session = Depends(get_db)) -> BrowseResult:
    try:
        return await search_source(db, source_id, q, target)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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
