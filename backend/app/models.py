from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, relationship


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class SourceType(str, Enum):
    opds = "opds"
    webdav = "webdav"
    feed = "feed"


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class LibraryKind(str, Enum):
    epub = "epub"
    article = "article"
    file = "file"


class Source(Base):
    __tablename__ = "sources"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(20), index=True, nullable=False)
    name = Column(String(160), nullable=False)
    url = Column(Text, nullable=False)
    username = Column(String(255), nullable=True)
    password = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    items = relationship("LibraryItem", back_populates="source")


class LibraryItem(Base):
    __tablename__ = "library_items"

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(ForeignKey("sources.id"), nullable=True)
    kind = Column(String(20), default=LibraryKind.epub.value, nullable=False)
    title = Column(String(255), nullable=False)
    author = Column(String(255), nullable=True)
    original_path = Column(Text, nullable=False)
    optimized_path = Column(Text, nullable=True)
    source_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    source = relationship("Source", back_populates="items")


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String(36), primary_key=True)
    type = Column(String(40), index=True, nullable=False)
    status = Column(String(20), default=JobStatus.queued.value, index=True, nullable=False)
    progress = Column(Integer, default=0, nullable=False)
    message = Column(Text, default="", nullable=False)
    error = Column(Text, nullable=True)
    item_id = Column(ForeignKey("library_items.id"), nullable=True)
    result_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

