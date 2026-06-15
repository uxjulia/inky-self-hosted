import { spawn } from "node:child_process";

const children = new Set();
let shuttingDown = false;

function spawnChild(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  children.add(child);
  child.on("exit", (code) => {
    children.delete(child);
    if (!shuttingDown && code) {
      stopAll();
      process.exit(code);
    }
  });
  child.on("error", (error) => {
    console.error(`[${name}] ${error.message}`);
    stopAll();
    process.exit(1);
  });
  return child;
}

function stopAll() {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

async function waitFor(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopAll();
  process.exit(143);
});

spawnChild("web", "npm", ["run", "dev:web"]);

try {
  await waitFor("http://localhost:5173");
  spawnChild("electron", "npx", ["electron", "."], {
    env: { INKY_DESKTOP_DEV_SERVER: "http://localhost:5173" }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  stopAll();
  process.exit(1);
}
