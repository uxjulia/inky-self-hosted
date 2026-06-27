from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

from .models import LibraryKind, SourceType


class SourceCreate(BaseModel):
    type: SourceType
    name: str = Field(min_length=1, max_length=160)
    url: str = Field(min_length=1)
    username: str | None = None
    password: str | None = None


class SourceUpdate(BaseModel):
    type: SourceType
    name: str = Field(min_length=1, max_length=160)
    url: str = Field(min_length=1)
    username: str | None = None
    password: str | None = None


class SourceReorder(BaseModel):
    source_ids: list[int] = Field(min_length=1)


class SourceRead(BaseModel):
    id: int
    type: SourceType
    name: str
    url: str
    username: str | None = None
    display_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class BrowseItem(BaseModel):
    type: Literal["navigation", "book", "article", "directory", "file"]
    title: str
    url: str | None = None
    path: str | None = None
    image_url: str | None = None
    author: str | None = None
    summary: str | None = None
    published: str | None = None
    size: int | None = None
    media_type: str | None = None


class BrowseResult(BaseModel):
    source_id: int
    source_type: SourceType
    base_url: str
    title: str
    items: list[BrowseItem]
    message: str | None = None
    next_url: str | None = None
    previous_url: str | None = None


class ImportUrlRequest(BaseModel):
    source_id: int | None = None
    url: str
    title: str | None = None
    author: str | None = None
    cover_url: str | None = None
    kind: LibraryKind = LibraryKind.epub


class ArticleImportRequest(BaseModel):
    source_id: int | None = None
    url: HttpUrl
    title: str | None = None
    author: str | None = None
    cover_url: str | None = None


class WebDavImportRequest(BaseModel):
    source_id: int
    path: str
    title: str | None = None
    cover_url: str | None = None


class LocalFileImportRequest(BaseModel):
    source_id: int
    path: str = Field(min_length=1)
    title: str | None = None


class LocalFolderImportRequest(BaseModel):
    path: str = Field(min_length=1)


class LibraryItemRead(BaseModel):
    id: int
    source_id: int | None
    kind: LibraryKind
    title: str
    author: str | None
    original_path: str
    optimized_path: str | None
    source_url: str | None
    cover_url: str | None
    sent_at: datetime | None
    is_missing: bool
    last_scan_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class JobRead(BaseModel):
    id: str
    type: str
    status: str
    progress: int
    message: str
    error: str | None
    item_id: int | None
    result_json: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class OptimizeRequest(BaseModel):
    device: Literal["x4", "x3"] = "x4"
    filename_render_first: str = Field(default="Book Title", max_length=240)
    filename_render_second: str = Field(default="Author", max_length=240)
    quality: int = Field(default=70, ge=1, le=100)
    grayscale: bool = True
    contrast_boost: bool = True
    contrast_factor: float = Field(default=1.5, ge=0.5, le=3.0)
    eink_quantize: bool = True
    light_novel: bool = False
    split_long_sections: bool = True
    words_per_reference_page: int = Field(default=275, ge=1, le=10000)
    remove_fonts: bool = True
    remove_css: bool = True
    text_cleanup: bool = True


class DeviceProbeRequest(BaseModel):
    device_url: str


class ClientLogRequest(BaseModel):
    scope: str = Field(default="client", max_length=40)
    message: str = Field(min_length=1, max_length=500)
    level: Literal["info", "warning", "error"] = "info"


class DeviceSendRequest(OptimizeRequest):
    device_url: str
    destination_path: str = "/"
    optimize_first: bool = True


class LocalFileSendRequest(DeviceSendRequest):
    path: str = Field(min_length=1)
