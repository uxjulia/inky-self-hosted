from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from .config import get_settings
from .db import SessionLocal
from .dictionary_prep import prepare_dictionary_zip
from .library import format_upload_bytes, send_file_to_device
from .models import Job, JobStatus, LibraryItem, utc_now
from .optimizer.service import optimize_epub, preferred_output_filename
from .schemas import DeviceSendRequest, OptimizeRequest


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


def run_send_path_job(job_id: str, source_path: str, request: DeviceSendRequest) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.running.value
        job.progress = 5
        job.message = "Preparing file"
        db.commit()

        file_path, device_filename = _send_path(job_id, job, Path(source_path), request)
        _send_file(job_id, job, file_path, request, device_filename)
    except Exception as exc:
        set_job(job_id, status=JobStatus.failed.value, progress=100, message="Send failed", error=str(exc))
    finally:
        db.close()


def run_dictionary_prepare_job(job_id: str, source_zip: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status = JobStatus.running.value
        job.progress = 2
        job.message = "Preparing dictionary"
        db.commit()

        def progress(percent: int, message: str) -> None:
            set_job(job_id, progress=max(0, min(100, percent)), message=message)

        output_dir = get_settings().dictionaries_dir / "prepared" / job_id
        result = prepare_dictionary_zip(Path(source_zip), output_dir, progress)
        result["download_url"] = f"/api/dictionaries/prepared/{job_id}/download"
        set_job(
            job_id,
            status=JobStatus.succeeded.value,
            progress=100,
            message="Dictionary prepared",
            result_json=json.dumps(result),
        )
    except Exception as exc:
        set_job(job_id, status=JobStatus.failed.value, progress=100, message="Dictionary prep failed", error=str(exc))
    finally:
        Path(source_zip).unlink(missing_ok=True)
        db.close()


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
        message=f"Uploading to device (0 KB of {format_upload_bytes(file_path.stat().st_size)})",
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
