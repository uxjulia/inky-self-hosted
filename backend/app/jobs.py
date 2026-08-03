from __future__ import annotations

import asyncio
import errno
import json
import logging
import shutil
import tempfile
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from .config import get_settings
from .db import SessionLocal
from .dictionary_prep import prepare_dictionary_zip, schedule_prepared_dictionary_cleanup
from .library import send_file_to_device
from .models import Job, JobStatus, LibraryItem, utc_now
from .optimizer.service import optimize_epub, preferred_output_filename
from .schemas import DeviceSendRequest, OptimizeRequest


logger = logging.getLogger("uvicorn.error")


def create_job(db: Session, job_type: str, item_id: int | None = None) -> Job:
    job = Job(id=str(uuid.uuid4()), type=job_type, item_id=item_id, status=JobStatus.queued.value, progress=0)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def set_job(job_id: str, **updates) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        for key, value in updates.items():
            setattr(job, key, value)
        db.commit()
    finally:
        db.close()


def run_optimize_job(job_id: str, item_id: int, request: OptimizeRequest) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        item = db.get(LibraryItem, item_id)
        if not job or not item:
            return
        job.status = JobStatus.running.value
        job.progress = 2
        job.message = "Starting optimizer"
        db.commit()

        def progress(percent: int, message: str) -> None:
            set_job(job_id, progress=percent, message=message)

        output_path, result = optimize_epub(Path(item.original_path), get_settings().optimized_dir, request, progress)
        item.optimized_path = str(output_path)
        job.status = JobStatus.succeeded.value
        job.progress = 100
        job.message = "Optimization complete"
        job.result_json = json.dumps(result)
        db.commit()
    except Exception as exc:
        set_job(job_id, status=JobStatus.failed.value, progress=100, message="Optimization failed", error=str(exc))
    finally:
        db.close()


def run_send_job(job_id: str, item_id: int, request: DeviceSendRequest) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        item = db.get(LibraryItem, item_id)
        if not job or not item:
            return
        job.status = JobStatus.running.value
        job.progress = 5
        job.message = "Preparing file"
        db.commit()

        file_path, device_filename = _send_path(
            job_id,
            job,
            Path(item.original_path),
            request,
            Path(item.optimized_path) if item.optimized_path else None,
        )
        if request.optimize_first and item.original_path.lower().endswith(".epub") and not item.optimized_path:
            item.optimized_path = str(file_path)
            db.commit()

        _send_file(job_id, job, file_path, request, device_filename)
        item.sent_at = utc_now()
        db.commit()
    except Exception as exc:
        set_job(job_id, status=JobStatus.failed.value, progress=100, message="Send failed", error=str(exc))
    finally:
        db.close()


def run_dictionary_prepare_job(
    job_id: str,
    source_zip: str,
    original_filename: str | None = None,
    archive_sha256: str | None = None,
) -> None:
    db = SessionLocal()
    output_dir = get_settings().dictionaries_dir / "prepared" / job_id
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.running.value
        job.progress = 2
        job.message = "Preparing dictionary"
        db.commit()

        source_path = Path(source_zip)
        logger.info(
            "Dictionary prep started: job_id=%s filename=%r source_bytes=%d archive_sha256=%s",
            job_id,
            original_filename or source_path.name,
            _dictionary_source_size(source_path),
            archive_sha256 or "unavailable",
        )

        def progress(percent: int, message: str) -> None:
            set_job(job_id, progress=max(0, min(100, percent)), message=message)

        result = prepare_dictionary_zip(Path(source_zip), output_dir, progress)
        result["download_url"] = f"/api/dictionaries/prepared/{job_id}/download"
        set_job(
            job_id,
            status=JobStatus.succeeded.value,
            progress=100,
            message="Dictionary prepared",
            result_json=json.dumps(result),
        )
        schedule_prepared_dictionary_cleanup(output_dir)
        logger.info("Dictionary prep completed: job_id=%s filename=%r", job_id, original_filename or source_path.name)
    except Exception as exc:
        data_free_bytes = shutil.disk_usage(get_settings().data_dir).free
        temp_free_bytes = shutil.disk_usage(tempfile.gettempdir()).free
        error = _dictionary_prepare_user_error(exc)
        logger.exception(
            "Dictionary prep failed: job_id=%s filename=%r archive_sha256=%s error_type=%s "
            "data_free_bytes=%d temp_free_bytes=%d user_error=%r",
            job_id,
            original_filename or Path(source_zip).name,
            archive_sha256 or "unavailable",
            type(exc).__name__,
            data_free_bytes,
            temp_free_bytes,
            error,
        )
        shutil.rmtree(output_dir, ignore_errors=True)
        set_job(job_id, status=JobStatus.failed.value, progress=100, message="Dictionary prep failed", error=error)
    finally:
        source_path = Path(source_zip)
        if source_path.is_dir():
            shutil.rmtree(source_path, ignore_errors=True)
        else:
            source_path.unlink(missing_ok=True)
        db.close()


def _dictionary_source_size(source_path: Path) -> int:
    if source_path.is_file():
        return source_path.stat().st_size
    return sum(path.stat().st_size for path in source_path.rglob("*") if path.is_file())


def _dictionary_prepare_user_error(exc: Exception) -> str:
    if isinstance(exc, OSError) and exc.errno == errno.ENOSPC:
        return "The server ran out of temporary storage while extracting this dictionary"

    detail = str(exc)
    if "Attempted to read more data than was available" in detail:
        return (
            "This RAR archive appears incomplete, damaged, or unsupported by the server's extractor. "
            "Please download it again and upload the new copy. If it still fails, extract it locally and upload "
            "the resulting ZIP instead."
        )
    return detail


def _send_path(
    job_id: str,
    job: Job,
    original_path: Path,
    request: DeviceSendRequest,
    optimized_path: Path | None = None,
) -> tuple[Path, str | None]:
    file_path = optimized_path or original_path
    is_epub = original_path.suffix.lower() == ".epub"
    device_filename = preferred_output_filename(original_path, request) if request.optimize_first and is_epub else None
    if request.optimize_first and is_epub and optimized_path is None:
        def progress(percent: int, message: str) -> None:
            set_job(job_id, progress=max(5, min(80, int(percent * 0.8))), message=message)

        output_path, result = optimize_epub(original_path, get_settings().optimized_dir, request, progress)
        file_path = output_path
        device_filename = result.get("device_filename") or device_filename
        job.result_json = json.dumps({"optimization": result})
    elif request.optimize_first and not is_epub:
        job.result_json = json.dumps({"optimization": "skipped for non-EPUB file"})
    return file_path, device_filename


def _send_file(job_id: str, job: Job, file_path: Path, request: DeviceSendRequest, device_filename: str | None = None) -> None:
    set_job(
        job_id,
        progress=0,
        message="Uploading to device",
    )

    def send_progress(percent: int, message: str) -> None:
        set_job(job_id, progress=max(0, min(100, percent)), message=message)

    send_result = asyncio.run(
        send_file_to_device(file_path, request.device_url, request.destination_path, send_progress, device_filename)
    )
    result = {"send": send_result}
    if job.result_json:
        result.update(json.loads(job.result_json))
    set_job(
        job_id,
        status=JobStatus.succeeded.value,
        progress=100,
        message="Sent to device",
        result_json=json.dumps(result),
    )
