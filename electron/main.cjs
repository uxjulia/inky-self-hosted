const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const DEFAULT_PORT = 18131;
const isDev = !app.isPackaged;

let backendProcess = null;
let mainWindow = null;
let apiBaseUrl = "";

ipcMain.handle("select-library-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Add Local Folder Source",
    properties: ["openDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

function projectRoot() {
  return isDev ? path.resolve(__dirname, "..") : process.resourcesPath;
}

function backendDir() {
  return path.join(projectRoot(), "backend");
}

function backendBinaryPath() {
  const binaryName = process.platform === "win32" ? "inky-api.exe" : "inky-api";
  return path.join(projectRoot(), "backend-bin", "inky-api", binaryName);
}

function frontendIndexPath() {
  return path.join(projectRoot(), "frontend", "dist", "index.html");
}

function pythonExecutable() {
  if (process.env.INKY_PYTHON_PATH) return process.env.INKY_PYTHON_PATH;

  const venvPython =
    process.platform === "win32"
      ? path.join(backendDir(), ".venv", "Scripts", "python.exe")
      : path.join(backendDir(), ".venv", "bin", "python");

  if (fs.existsSync(venvPython)) return venvPython;
  return process.platform === "win32" ? "python" : "python3";
}

function backendCommand(port, dataDir, mountedLibraryDir) {
  const binary = backendBinaryPath();
  if (app.isPackaged && fs.existsSync(binary)) {
    return {
      command: binary,
      args: [],
      cwd: path.dirname(binary),
      env: {
        INKY_DESKTOP_API_PORT: String(port),
        INKY_DATABASE_URL: `sqlite:///${path.join(dataDir, "inky.db")}`,
        INKY_DATA_DIR: dataDir,
        INKY_MOUNTED_LIBRARY_DIR: mountedLibraryDir,
        INKY_PUBLIC_READ_ONLY: "0"
      }
    };
  }

  return {
    command: pythonExecutable(),
    args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port), "--no-access-log"],
    cwd: backendDir(),
    env: {
      INKY_DATABASE_URL: `sqlite:///${path.join(dataDir, "inky.db")}`,
      INKY_DATA_DIR: dataDir,
      INKY_MOUNTED_LIBRARY_DIR: mountedLibraryDir,
      INKY_PUBLIC_READ_ONLY: "0",
      PYTHONUNBUFFERED: "1"
    }
  };
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function pickPort(startPort = DEFAULT_PORT) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error("No available local API port found.");
}

async function waitForBackend(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // Keep waiting until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for the local API to start.");
}

async function startBackend() {
  const port = await pickPort();
  const dataDir = path.join(app.getPath("userData"), "data");
  const mountedLibraryDir = path.join(app.getPath("userData"), "mounted-library");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(mountedLibraryDir, { recursive: true });

  apiBaseUrl = `http://127.0.0.1:${port}`;
  const backend = backendCommand(port, dataDir, mountedLibraryDir);
  backendProcess = spawn(backend.command, backend.args, {
    cwd: backend.cwd,
    env: { ...process.env, ...backend.env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  backendProcess.stdout.on("data", (chunk) => console.log(`[api] ${chunk}`.trimEnd()));
  backendProcess.stderr.on("data", (chunk) => console.error(`[api] ${chunk}`.trimEnd()));
  backendProcess.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      console.error(`Local API exited with code ${code ?? "unknown"} signal ${signal ?? "none"}`);
    }
    backendProcess = null;
  });

  await waitForBackend(apiBaseUrl);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    title: "Inky",
    backgroundColor: "#f8f8f8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [`--inky-api-base-url=${apiBaseUrl}`]
    }
  });

  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === "serial") return true;
    return false;
  });

  mainWindow.webContents.session.on("select-serial-port", (event, portList, _webContents, callback) => {
    event.preventDefault();
    const crossInkPort = portList.find((port) => isCrossInkSerialPort(port));
    callback(crossInkPort?.portId || "");
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.INKY_DESKTOP_DEV_SERVER) {
    await mainWindow.loadURL(process.env.INKY_DESKTOP_DEV_SERVER);
  } else {
    await mainWindow.loadFile(frontendIndexPath());
  }
}

function isCrossInkSerialPort(port) {
  const vendorId = normalizeDeviceId(port.vendorId);
  return [0x303a, 0x2886, 0x10c4, 0x1a86].includes(vendorId);
}

function normalizeDeviceId(value) {
  if (typeof value !== "string") return Number(value);
  if (value.startsWith("0x")) return Number(value);
  const decimal = Number(value);
  return Number.isNaN(decimal) ? parseInt(value, 16) : decimal;
}

app.whenReady().then(async () => {
  try {
    await startBackend();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox("Unable to start Inky", error instanceof Error ? error.message : String(error));
    app.quit();
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
