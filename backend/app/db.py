from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings
from .models import Base, Source


def _connect_args() -> dict:
    if get_settings().database_url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


engine = create_engine(get_settings().database_url, connect_args=_connect_args())
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_source_columns()


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


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
