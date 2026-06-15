from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from .config import get_settings
from .db import SessionLocal
from .library import send_file_to_device
from .models import Job, JobStatus, LibraryItem, utc_now
from .optimizer.service import optimize_epub
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

        file_path = Path(item.optimized_path) if item.optimized_path else Path(item.original_path)
        is_epub = item.original_path.lower().endswith(".epub")
        if request.optimize_first and is_epub and not item.optimized_path:
            def progress(percent: int, message: str) -> None:
                set_job(job_id, progress=max(5, min(80, int(percent * 0.8))), message=message)

            output_path, result = optimize_epub(Path(item.original_path), get_settings().optimized_dir, request, progress)
            item.optimized_path = str(output_path)
            file_path = output_path
            job.result_json = json.dumps({"optimization": result})
            db.commit()
        elif request.optimize_first and not is_epub:
            job.result_json = json.dumps({"optimization": "skipped for non-EPUB file"})
            db.commit()

        set_job(job_id, progress=85, message="Uploading to device")
        send_result = asyncio.run(send_file_to_device(file_path, request.device_url, request.destination_path))
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
        item.sent_at = utc_now()
        db.commit()
    except Exception as exc:
        set_job(job_id, status=JobStatus.failed.value, progress=100, message="Send failed", error=str(exc))
    finally:
        db.close()
