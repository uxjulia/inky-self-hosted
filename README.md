# Inky

Inky is a self-hosted companion app for [CrossInk](https://github.com/uxjulia/CrossInk) e-readers. It collects books and articles, prepares them for an e-ink display, and sends them to a reader over Wi-Fi or USB.

> Inky is under active development. Back up your library before upgrading and review the changelog when moving between versions.

## Features

- Browse OPDS catalogs, WebDAV libraries, and RSS/Atom feeds.
- Import EPUBs and turn feed articles into EPUBs.
- Optimize EPUB images, CSS, typography, locations, and reference-page data for CrossInk devices.
- Send EPUB, TXT, XTC, XTCH, BMP, and PNG files to a reader.
- Transfer over the local network or through Web Serial in Chrome and Edge.
- Download CrossInk fonts and dictionaries.
- Prepare StarDict archives for installation on a reader.
- Scan a host folder as a read-only Local Library.

## Self-host with Docker

### Requirements

- Docker Engine with Docker Compose v2, or Docker Desktop
- A CrossInk reader for device transfers

Copy the example configuration and start Inky:

```bash
cp .env.example .env
docker compose up --build -d
```

Open [http://localhost:8000](http://localhost:8000). Docker keeps the API inside the Compose network and routes browser requests through the web service.

Stop Inky with:

```bash
docker compose down
```

Library metadata and managed files live in the `inky-data` Docker volume, so a normal `docker compose down` does not delete them. Do not add `--volumes` unless you intend to remove that data.

## Self-host without Docker

This runs the React frontend and FastAPI server directly on the host. It is the recommended path when you already manage Python and Node.js on the server.

### Requirements

- Node.js 22 or later with npm
- Python 3.12
- Cairo, required for SVG rasterization
- `unar`, required only for RAR-packaged dictionaries

Install the native packages before installing Inky:

```bash
# macOS
brew install cairo unar

# Debian or Ubuntu
sudo apt-get install -y libcairo2 unar
```

Create the configuration, install dependencies, build the browser app, and start the server:

```bash
cp .env.example .env
npm install
npm run build
npm run start
```

Open [http://localhost:8000](http://localhost:8000). `npm run start` serves the built frontend and API from the same address. By default it stores Inky data in `backend/storage/`; set `INKY_DATA_DIR` and `INKY_DATABASE_URL` in `.env` to place persistent data elsewhere.

For a LAN server, keep `INKY_HOST=0.0.0.0` and set `INKY_PORT` to the port you want to expose. Put Inky behind HTTPS or a VPN before making it reachable from outside your trusted network.

## Configuration

Edit `.env` before starting either deployment. These are the main options:

| Variable                   | Default                               | Used by     | Purpose                                                                                            |
| -------------------------- | ------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `INKY_DATABASE_URL`        | `sqlite:///./backend/storage/inky.db` | Direct host | The SQLite file that remembers your sources, library entries, and jobs.                            |
| `INKY_DATA_DIR`            | `./backend/storage`                   | Direct host | Where Inky saves uploaded books, optimized EPUBs, and prepared dictionaries.                       |
| `INKY_MOUNTED_LIBRARY_DIR` | empty (or `./library` for Docker)     | Both        | Read-only folder of books to show in Local Library.                                                |
| `INKY_HOST`                | `0.0.0.0`                             | Direct host | Network address the server listens on. Keep `0.0.0.0` to open Inky from other devices on your LAN. |
| `INKY_PORT`                | `8000`                                | Both        | Port to open in your browser. Docker maps it to the web service automatically.                     |
| `INKY_AUTH_USERNAME`       | empty                                 | Both        | Username for the optional sign-in prompt.                                                          |
| `INKY_AUTH_PASSWORD`       | empty                                 | Both        | Password for the optional sign-in prompt.                                                          |
| `INKY_AUTH_REALM`          | `Inky`                                | Both        | Name shown by the browser's sign-in prompt.                                                        |

Note: `Both` in the table above means the variable is used by a Direct Host (without Docker) and by Docker installations.

Set both authentication values to enable sign-in:

```bash
INKY_AUTH_USERNAME=your-user
INKY_AUTH_PASSWORD=choose-a-long-unique-password
```

Basic Auth is suitable for a trusted private network. Put Inky behind HTTPS or a VPN before making it reachable from outside your LAN.

To show an existing book folder (like your Calibre library), set the following environment variable:

```bash
INKY_MOUNTED_LIBRARY_DIR=/path/to/books
```

When using Docker Compose, this is the host path that Docker mounts at `/library`; leave it blank to use `./library`. The Local Library folder is always read-only. Inky can scan and send supported files from it, but cannot rename, replace, or delete the originals.

## Send Files to a Reader

1. On the reader, open **File Transfer**.
2. For Wi-Fi, choose **Join Network** so the reader and Inky server are on the same network, then enter the address shown by the reader in Inky's Device panel.
3. For USB, connect the reader by cable, choose **USB**, and select the device when the browser asks. Web Serial requires desktop Chrome or Edge.
4. Add or import a file, then choose **Send**.

Wi-Fi transfers use the reader's local HTTP upload endpoint. USB transfers use CrossInk's serial file-transfer protocol. A successful build or connection test does not replace testing transfers on physical hardware.

> **Hotspot mode:** Choose **Create Hotspot** only when the Inky server itself can reach the reader's hotspot, such as when Inky runs locally on the same computer. A typical server on your home network cannot reach a reader hotspot without losing its LAN connection; use **Join Network** or USB instead.

## Local Development

After `npm install`, start the Vite frontend and FastAPI backend together:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to the backend at `http://localhost:8001`.

Useful checks:

```bash
npm run build
npm run format:check
git diff --check
```

## Project Structure

- `frontend/src` contains the React/Vite interface and browser transfer code.
- `backend/app` contains the FastAPI API, connectors, library, jobs, and EPUB optimizer.
- `scripts/dev.mjs` starts the local frontend and backend development servers.
- `docker-compose.yml`, `backend/Dockerfile`, and `frontend/Dockerfile` define the optional Docker deployment.

## License

Inky is licensed under the [GNU General Public License v3.0](LICENSE).
