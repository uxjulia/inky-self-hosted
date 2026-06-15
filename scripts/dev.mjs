import { spawn } from "node:child_process";
import readline from "node:readline";

const commands = [
  {
    name: "api",
    color: "\x1b[36m",
    args: ["run", "dev:api"]
  },
  {
    name: "web",
    color: "\x1b[35m",
    args: ["run", "dev:web"]
  }
];

const reset = "\x1b[0m";
const children = new Set();
let shuttingDown = false;

function prefix(stream, name, color, output) {
  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => {
    output.write(`${color}[${name}]${reset} ${line}\n`);
  });
}

function stopAll(signal = "SIGTERM") {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const command of commands) {
  const child = spawn("npm", command.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
    shell: process.platform === "win32"
  });

  children.add(child);
  prefix(child.stdout, command.name, command.color, process.stdout);
  prefix(child.stderr, command.name, command.color, process.stderr);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) {
      return;
    }
    stopAll();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

process.on("SIGINT", () => {
  stopAll("SIGINT");
});

process.on("SIGTERM", () => {
  stopAll("SIGTERM");
});
