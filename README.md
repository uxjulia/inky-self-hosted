# Inky

Self-hosted companion app for CrossInk devices. The MVP stores OPDS catalogs,
WebDAV libraries, and RSS/Atom feeds; imports books/articles into a local
library; optimizes EPUBs with the vendored `auto-epub-optimizer` Python pipeline;
and sends files to an X3/X4 running CrossInk File Transfer mode.

## Run With Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Open:

```text
http://localhost:3000
```

The API is also exposed at:

```text
http://localhost:8000
```

## Local Development

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
INKY_DATABASE_URL=sqlite:///./storage/inky.db INKY_DATA_DIR=./storage uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## Device Send Flow

1. On the reader, open **File Transfer**.
2. Use **Join Network** or **Create Hotspot**.
3. Put the shown host/IP in Inky's Device field.
4. Import an item, then send it from the Library panel.

The current transport uses CrossInk's HTTP `/upload` endpoint. WebSocket upload
and BLE can be added as alternate transports behind the same backend route.

## Architecture Notes

- `backend/app/connectors.py` handles OPDS, WebDAV, and RSS/Atom browsing.
- `backend/app/article_epub.py` turns feed articles into simple EPUBs.
- `backend/app/optimizer/epubkit_pipeline/` is copied from
  `~/code/auto-epub-optimizer`.
- `backend/app/jobs.py` runs optimize/send work as API background jobs.
- SQLite is the default store, but `INKY_DATABASE_URL` is isolated so Postgres
  can replace it when multi-user auth becomes real.

