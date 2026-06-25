from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings
from .models import Base, Source


DEFAULT_SOURCES = [
    {"type": "opds", "name": "Mayberry", "url": "https://mayberry.pub"},
    {"type": "feed", "name": "Standard Ebooks", "url": "https://standardebooks.org/feeds/atom/new-releases"},
    {"type": "opds", "name": "Project Gutenberg", "url": "https://m.gutenberg.org/ebooks.opds/"},
]


def _connect_args() -> dict:
    if get_settings().database_url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


engine = create_engine(get_settings().database_url, connect_args=_connect_args())
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_source_columns()
    _ensure_library_columns()
    _seed_default_sources()


def _ensure_source_columns() -> None:
    columns = {column["name"] for column in inspect(engine).get_columns("sources")}
    if "display_order" in columns:
        return

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE sources ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0"))

    with Session(engine) as db:
        sources = db.query(Source).order_by(Source.created_at.desc(), Source.id.desc()).all()
        for index, source in enumerate(sources):
            source.display_order = index
        db.commit()


def _ensure_library_columns() -> None:
    columns = {column["name"] for column in inspect(engine).get_columns("library_items")}

    with engine.begin() as connection:
        if "sent_at" not in columns:
            connection.execute(text("ALTER TABLE library_items ADD COLUMN sent_at DATETIME"))
        if "cover_url" not in columns:
            connection.execute(text("ALTER TABLE library_items ADD COLUMN cover_url TEXT"))
        if "is_missing" not in columns:
            connection.execute(text("ALTER TABLE library_items ADD COLUMN is_missing BOOLEAN NOT NULL DEFAULT 0"))
        if "last_scan_at" not in columns:
            connection.execute(text("ALTER TABLE library_items ADD COLUMN last_scan_at DATETIME"))


def _seed_default_sources() -> None:
    with Session(engine) as db:
        existing_urls = {url for (url,) in db.query(Source.url).all()}
        current_order = db.query(Source.display_order).order_by(Source.display_order.desc()).first()
        next_order = 0 if current_order is None else current_order[0] + 1

        for source_data in DEFAULT_SOURCES:
            if source_data["url"] in existing_urls:
                continue
            db.add(Source(**source_data, display_order=next_order))
            next_order += 1
        db.commit()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
