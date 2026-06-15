from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import ensure_data_dirs
from .connectors import browse_source, search_source
from .db import get_db, init_db
from .jobs import create_job, run_optimize_job, run_send_job
from .library import copy_uploaded_file, delete_library_item, import_article, import_url, import_webdav_file, probe_device
from .models import Job, LibraryItem, Source
from .schemas import (
    ArticleImportRequest,
    BrowseResult,
    DeviceProbeRequest,
    DeviceSendRequest,
    ImportUrlRequest,
    JobRead,
    LibraryItemRead,
    OptimizeRequest,
    SourceCreate,
    SourceReorder,
    SourceRead,
    SourceUpdate,
    WebDavImportRequest,
)


app = FastAPI(title="Inky API", version="0.1.0")
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


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


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


@app.post("/api/library/import-url", response_model=LibraryItemRead)
async def import_remote(payload: ImportUrlRequest, db: Session = Depends(get_db)) -> LibraryItem:
    auth = None
    if payload.source_id:
        source = db.get(Source, payload.source_id)
        if source and source.username and source.password:
            auth = (source.username, source.password)
    return await import_url(db, payload.url, payload.source_id, payload.title, payload.author, payload.kind.value, auth)


@app.post("/api/library/import-article", response_model=LibraryItemRead)
async def import_feed_article(payload: ArticleImportRequest, db: Session = Depends(get_db)) -> LibraryItem:
    return await import_article(db, str(payload.url), payload.source_id, payload.title, payload.author)


@app.post("/api/library/import-webdav", response_model=LibraryItemRead)
async def import_from_webdav(payload: WebDavImportRequest, db: Session = Depends(get_db)) -> LibraryItem:
    source = db.get(Source, payload.source_id)
    if not source or source.type != "webdav":
        raise HTTPException(status_code=404, detail="WebDAV source not found")
    return await import_webdav_file(db, source, payload.path, payload.title)


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


@app.delete("/api/library/{item_id}")
def remove_library_item(item_id: int, db: Session = Depends(get_db)) -> dict:
    item = db.get(LibraryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="library item not found")
    delete_library_item(db, item)
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
