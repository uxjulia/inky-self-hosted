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

### Basic Auth

For a self-hosted install, set both auth variables in `.env` before starting
Compose:

```bash
INKY_AUTH_USERNAME=your-user
INKY_AUTH_PASSWORD=choose-a-long-password
```

When both values are set, the API requires HTTP Basic Auth and the web app shows
a sign-in screen. Leave either value blank to disable authentication. Basic Auth
protects against casual access on a trusted private network; use HTTPS or a VPN
if you expose Inky outside your LAN.

The in-app guide is available at:

```text
http://localhost:3000/#help
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

Set `VITE_INKY_APP_MODE=hosted` when building a future public hosted frontend.
The current self-hosted default is `VITE_INKY_APP_MODE=self-hosted`.

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

## Desktop App

Run the desktop app in development:

```bash
npm run desktop:dev
```

This starts the Vite frontend, opens Electron, and launches the FastAPI backend
on a local loopback port. Desktop storage lives in the operating system app data
folder, separate from `backend/storage`.

Build an unpacked desktop app for local testing:

```bash
npm run desktop:pack
```

Build distributable installers/packages:

```bash
npm run desktop:dist
```

The desktop package includes the React build and a PyInstaller-built FastAPI
backend executable. Build releases on each target OS/architecture so compiled
Python dependencies match that platform.

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
