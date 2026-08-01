# Inky

Inky is a self-hosted and desktop companion app for
[CrossInk](https://github.com/uxjulia/CrossInk) e-readers. It provides one place
to collect books and articles, prepare them for an e-ink display, and send them
to a reader over Wi-Fi or USB.

> Inky is under active development. Back up your library before upgrading and
> review the changelog when moving between versions.

## Features

- Browse OPDS catalogs, WebDAV libraries, and RSS/Atom feeds.
- Import EPUBs and turn feed articles into EPUBs.
- Optimize EPUB images, CSS, typography, locations, and reference-page data for
  CrossInk devices.
- Send EPUB, TXT, XTC, XTCH, BMP, and PNG files to a reader.
- Transfer over the local network or through Web Serial in Chrome and Edge.
- Download CrossInk fonts and dictionaries.
- Prepare StarDict archives for installation on a reader.
- Browse a host folder without copying its contents into Inky's managed
  library.

## Self-host With Docker

### Requirements

- Docker Engine with Docker Compose v2, or Docker Desktop
- A CrossInk reader for device transfers

Copy the example configuration and start the services:

```bash
cp .env.example .env
docker compose up --build -d
```

Open [http://localhost:3000](http://localhost:3000). The API is available at
`http://localhost:8000`, and the in-app guide is at
`http://localhost:3000/#help`.

Stop Inky with:

```bash
docker compose down
```

Library metadata and managed files live in the `inky-data` Docker volume, so a
normal `docker compose down` does not delete them. Do not add `--volumes` unless
you intend to remove that data.

### Configuration

Edit `.env` before starting the containers. The main options are:

| Variable                     | Default     | Purpose                                                  |
| ---------------------------- | ----------- | -------------------------------------------------------- |
| `FRONTEND_PORT`              | `3000`      | Port used by the web interface.                          |
| `INKY_AUTH_USERNAME`         | empty       | Username for optional HTTP Basic Auth.                   |
| `INKY_AUTH_PASSWORD`         | empty       | Password for optional HTTP Basic Auth.                   |
| `INKY_AUTH_REALM`            | `Inky`      | Realm shown by the authentication challenge.             |
| `INKY_LOCAL_LIBRARY_PATH`    | `./library` | Host folder mounted read-only as a local library.        |
| `VITE_INKY_DICTIONARY_TOOLS` | `0`         | Set to `1` to include Dictionary Tools in the web build. |

Set both authentication values to enable sign-in:

```bash
INKY_AUTH_USERNAME=your-user
INKY_AUTH_PASSWORD=choose-a-long-unique-password
```

Basic Auth is suitable for a trusted private network. Put Inky behind HTTPS or
a VPN before making it reachable from outside your LAN.

To expose an existing folder of books, set an absolute host path:

```bash
INKY_LOCAL_LIBRARY_PATH=/path/to/your/books
```

The folder is mounted read-only. Inky can scan and send its supported files,
but it cannot rename, replace, or delete the originals.

## Send Files to a Reader

1. On the reader, open **File Transfer**.
2. For Wi-Fi, choose **Join Network** or **Create Hotspot**, then enter the
   address shown by the reader in Inky's Device panel.
3. For USB, connect the reader by cable, choose **USB**, and select the device
   when the browser asks. Web Serial requires desktop Chrome or Edge.
4. Add or import a file, then choose **Send**.

Wi-Fi transfers use the reader's local HTTP upload endpoint. USB transfers use
CrossInk's serial file-transfer protocol. A successful build or connection test
does not replace testing transfers on physical hardware.

## Build the Desktop App

The desktop app packages the React interface in Electron and bundles the
FastAPI backend as a local PyInstaller executable. Build on each target
operating system and CPU architecture; the compiled Python dependencies are not
portable between platforms.

### Requirements

- Node.js 22 or later with npm
- Python 3.12
- Cairo, required for SVG rasterization

Install Cairo before installing the project dependencies:

```bash
# macOS
brew install cairo unar

# Debian or Ubuntu
sudo apt-get install -y libcairo2 unar
```

`unar` is used when preparing RAR-packaged dictionaries.

Then install the JavaScript and Python dependencies:

```bash
npm install
```

The root `postinstall` script installs the frontend packages and creates the
Python virtual environment at `backend/.venv`.

Run the desktop app with live frontend reload:

```bash
npm run desktop:dev
```

Create an unpacked app for a local smoke test:

```bash
npm run desktop:pack
```

Create distributable packages for the current platform:

```bash
npm run desktop:dist
```

Build output is written to `release/`. The configured targets are DMG and ZIP
on macOS, NSIS on Windows, and AppImage and DEB on Linux. Code signing and
notarization are not configured by this repository.

Desktop data is stored in the operating system's application-data directory,
separate from the development database under `backend/storage`.

## Local Development

After `npm install`, start the Vite frontend and FastAPI backend together:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to the
backend at `http://localhost:8001`.

Useful checks:

```bash
npm run build
npm run format:check
git diff --check
```

## Project Structure

- `frontend/src` contains the React/Vite interface and browser transfer code.
- `backend/app` contains the FastAPI API, connectors, library, jobs, and EPUB
  optimizer.
- `electron` contains the desktop shell and its restricted preload bridge.
- `scripts` contains the development and desktop packaging helpers.
- `docker-compose.yml`, `backend/Dockerfile`, and `frontend/Dockerfile` define
  the self-hosted deployment.

## License

Inky is licensed under the [GNU General Public License v3.0](LICENSE).
