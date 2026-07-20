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
`.xtc`, `.xtch`, `.bmp`, and `.png` files from there into the Local Library view
so they can be sent to a device without importing or copying them into Inky
storage. Only EPUBs are optimized before sending.

## Deployment Modes

Inky has three frontend modes:

- `self-hosted`: private backend-backed app. Sources, Local Library, optimizer
  jobs, and sends use the local FastAPI backend.
- `public`: public backend-backed app. Visitors can browse backend-seeded
  sources, but their Local Library stays in their browser and sends use USB
  only. Pair this with `INKY_PUBLIC_READ_ONLY=1` on the backend.
- `hosted`: static browser-only app. No backend sources are used; visitors add
  EPUBs in the browser, optimize locally, and send over USB.

## Hosted Browser Build

Use the `hosted` build for a public static frontend where users add an EPUB,
optimize it locally in their browser, and send it to a CrossInk device over USB.
This mode does not use the FastAPI backend, and files are not uploaded to an
Inky server.

```bash
npm run build:hosted
```

Deploy the generated `frontend/dist` folder to any static host. The hosted build:

- Starts in local-file mode and stores selected EPUBs in that browser's local
  storage until the user removes them.
- Uses the browser-side EPUB optimizer before USB sends.
- Uses Web Serial for USB transfer, so users need Chrome or Edge on desktop and
  the site must be served over HTTPS.
- Does not include OPDS, WebDAV, RSS/Atom, local folder browsing, or backend
  article conversion.

The current private self-hosted default remains
`VITE_INKY_APP_MODE=self-hosted`.

## Deploy On Railway

Railway should use the root `Dockerfile`, which builds the React frontend and
runs it with the FastAPI backend in one web service. The included `railway.json`
selects Dockerfile builds and checks `/api/health` after deploy.

The Railway build uses `VITE_INKY_APP_MODE=public` by default. That lets the
public app read backend-seeded sources while keeping each visitor's Local
Library in that browser instead of the shared Railway database. The backend
still needs `INKY_PUBLIC_READ_ONLY=1` so public visitors can read and browse
seeded sources without writing to the backend.

Public EPUB sends use the server optimizer through a temporary upload. The
optimized EPUB is streamed back to the browser for USB transfer, and the server
removes the temporary input/output files after the response. To keep small
Railway instances responsive, temporary public optimizations run one at a time
in a worker thread.

Recommended Railway variables for an open public instance:

```bash
INKY_DATA_DIR=/data
INKY_DATABASE_URL=sqlite:////data/inky.db
INKY_PUBLIC_READ_ONLY=1
VITE_INKY_APP_MODE=public
VITE_INKY_DICTIONARY_TOOLS=1
```

`VITE_` variables are baked into the React frontend during the Docker build. If
you change one in Railway, redeploy the service so Railway rebuilds the frontend
bundle.

Attach a Railway volume mounted at `/data` if you want the library database and
uploaded files to survive redeploys.

The temporary Sticky beta is enabled by default in the public Flash Tools tab.
These service variables can override its R2 object or label:

```bash
INKY_STICKY_BETA_FIRMWARE_URL=https://downloads.crossink.dev/firmwares/sticky/firmware-sticky.bin
INKY_STICKY_BETA_VERSION=Sticky Beta
```

The backend reads the firmware metadata from R2 and proxies the download, so no
R2 credentials or frontend `VITE_` variable are required for a public object.

Only set `INKY_AUTH_USERNAME` and `INKY_AUTH_PASSWORD` for a private instance.

## Local Development

Install all frontend and backend dependencies:

```bash
# Required by backend SVG rasterization.
# Debian/Ubuntu/WSL: sudo apt-get install -y libcairo2
# macOS: brew install cairo

npm install
```

Run the API and frontend together with live reload:

```bash
npm run dev
```

Format supported frontend, desktop, config, and documentation files:

```bash
npm run format
```

Open:

```text
http://localhost:5173
```

To test public backend-backed mode locally:

```bash
INKY_PUBLIC_READ_ONLY=1 VITE_INKY_APP_MODE=public npm run dev
```

To test the static hosted browser mode locally:

```bash
VITE_INKY_APP_MODE=hosted npm run dev --prefix frontend
```

The root `postinstall` script installs the frontend packages and creates the
backend Python virtualenv at `backend/.venv`. The API runs on
`http://localhost:8001`, and Vite proxies `/api` to it.

## iOS App For Local Testing

The iOS target wraps the React frontend with Capacitor. When no Inky server URL
is configured, the iOS app runs in standalone mode: it stores local files on the
phone and sends them directly to a CrossInk device in File Transfer mode.

Open the iOS project:

```bash
npm run ios:open
```

To show the development-only Server button for testing against a LAN backend,
sync the iOS build with:

```bash
VITE_INKY_IOS_SERVER_SETTINGS=1 npm run ios:open
```

In Xcode, choose your personal Apple Account as the signing team, select your
iPhone, and run the app.

Standalone mode currently supports local file import and direct device sends.
Backend-backed catalog sources, RSS article conversion, WebDAV browsing, and
EPUB optimization still require the FastAPI backend.

To use the iOS app with a backend instead of standalone mode, start the backend
on your LAN:

```bash
npm run dev:api:lan
```

Find your Mac's Wi-Fi IP address:

```bash
ipconfig getifaddr en0
```

Then use the development Server button in the iOS app and set the Inky server
URL to:

```text
http://YOUR_MAC_IP:8000
```

The iOS build uses local-network HTTP so it can talk to CrossInk device transfer
endpoints and, optionally, a development backend.

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
2. For Wi-Fi, use **Join Network** or **Create Hotspot**, then put the shown
   host/IP in Inky's Device field.
3. For USB, connect the reader by cable and select **USB** in the Device panel.
4. Import an item, then send it from the Library panel.

Wi-Fi sends use CrossInk's HTTP `/upload` endpoint. USB sends use the browser
Web Serial API and the reader's `CMND` serial file-write protocol.

## Architecture Notes

- `backend/app/connectors.py` handles OPDS, WebDAV, and RSS/Atom browsing.
- `backend/app/article_epub.py` turns feed articles into simple EPUBs.
- `backend/app/optimizer/epubkit_pipeline/` is copied from
  `~/code/auto-epub-optimizer`.
- `backend/app/jobs.py` runs optimize/send work as API background jobs.
- The frontend treats local uploads as a virtual Local Library source; files
  saved from external sources are persisted by the backend library store.
- Desktop folder picks are modeled as Local Folder sources and can be browsed
  without copying their files into Local Library.
- SQLite is the default store, but `INKY_DATABASE_URL` is isolated so Postgres
  can replace it when multi-user auth becomes real.
