# Inky

Self-hosted companion app for CrossInk devices. The MVP stores OPDS catalogs,
WebDAV libraries, RSS/Atom feeds, and local uploads; imports books/articles into
a local library; optimizes EPUBs with the vendored `auto-epub-optimizer` Python
pipeline; and sends files to an X3/X4 running CrossInk File Transfer mode.

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

To expose an existing local library folder in the app, set this in `.env` before
starting Docker Compose:

```bash
INKY_LOCAL_LIBRARY_PATH=/path/to/your/books
```

Docker mounts that folder read-only at `/library`. Inky scans `.epub`, `.txt`,
`.xtc`, and `.xtch` files from there into the Local Library view so they can be
sent to a device without importing or copying them into Inky storage. Only EPUBs
are optimized before sending.

## Local Development

Install all frontend and backend dependencies:

```bash
npm install
```

Run the API and frontend together with live reload:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

The root `postinstall` script installs the frontend packages and creates the
backend Python virtualenv at `backend/.venv`. The API runs on
`http://localhost:8000`, and Vite proxies `/api` to it.

If Docker Compose is running, stop it first with `docker compose down` so the
local API can use port `8000`.

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
- The frontend treats local uploads as a virtual source; uploaded files are still
  persisted by the backend library store.
- SQLite is the default store, but `INKY_DATABASE_URL` is isolated so Postgres
  can replace it when multi-user auth becomes real.
