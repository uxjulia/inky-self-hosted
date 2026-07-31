import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const python =
  process.platform === "win32"
    ? path.join(root, "backend", ".venv", "Scripts", "python.exe")
    : path.join(root, "backend", ".venv", "bin", "python");

if (!fs.existsSync(python)) {
  console.error("Missing backend virtualenv. Run `npm install` first.");
  process.exit(1);
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${python} ${args.join(" ")} exited with ${code}`));
      }
    });
    child.on("error", reject);
  });
}

await run(["-m", "pip", "install", "pyinstaller==6.21.0"]);
await run([
  "-m",
  "PyInstaller",
  "backend/desktop_entry.py",
  "--name",
  "inky-api",
  "--distpath",
  "backend/desktop-dist",
  "--workpath",
  "backend/desktop-build",
  "--specpath",
  "backend/desktop-build",
  "--paths",
  "backend/app/optimizer/epubkit_pipeline",
  "--noconfirm",
  "--clean",
  "--hidden-import",
  "app.dictionary_prep",
  "--hidden-import",
  "epub_processor",
  "--hidden-import",
  "image_processor",
  "--hidden-import",
  "metadata_handler",
  "--hidden-import",
  "html_cleaner",
  "--hidden-import",
  "text_cleaner",
  "--hidden-import",
  "epub_packager",
  "--hidden-import",
  "epub_structure",
  "--collect-all",
  "uvicorn",
  "--collect-all",
  "pydantic",
  "--collect-all",
  "pydantic_settings",
  "--collect-all",
  "feedparser",
  "--collect-all",
  "cssutils",
  "--collect-all",
  "lxml",
  "--collect-all",
  "PIL",
  "--collect-all",
  "py7zr"
]);
