import {
  ArrowDownToLine,
  BookOpen,
  Folder,
  Globe2,
  Library,
  Moon,
  Plus,
  Paintbrush,
  RefreshCw,
  Rss,
  Send,
  Server,
  Settings2,
  Sun,
  Trash2,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

const API = import.meta.env.VITE_API_BASE_URL || "";
const themeStorageKey = "inky-theme";
const localSourceId = -1;

type RemoteSourceType = "opds" | "webdav" | "feed";
type SourceType = "local" | RemoteSourceType;
type Theme = "light" | "dark";

type Source = {
  id: number;
  type: SourceType;
  name: string;
  url: string;
  username?: string | null;
};

type BrowseItem = {
  type: "navigation" | "book" | "article" | "directory" | "file";
  title: string;
  url?: string | null;
  path?: string | null;
  author?: string | null;
  summary?: string | null;
  published?: string | null;
  size?: number | null;
  media_type?: string | null;
};

type BrowseResult = {
  source_id: number;
  source_type: SourceType;
  base_url: string;
  title: string;
  items: BrowseItem[];
  message?: string | null;
};

type LibraryItem = {
  id: number;
  source_id?: number | null;
  kind: "epub" | "article" | "file";
  title: string;
  author?: string | null;
  original_path: string;
  optimized_path?: string | null;
  source_url?: string | null;
};

type Job = {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  error?: string | null;
  item_id?: number | null;
};

type SourceForm = {
  type: RemoteSourceType;
  name: string;
  url: string;
  username: string;
  password: string;
};

const emptySourceForm: SourceForm = { type: "opds", name: "", url: "", username: "", password: "" };
const localSource: Source = { id: localSourceId, type: "local", name: "Local Library", url: "local://library" };

export default function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [browseStack, setBrowseStack] = useState<(string | null)[]>([null]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [form, setForm] = useState<SourceForm>(emptySourceForm);
  const [deviceUrl, setDeviceUrl] = useState("crosspoint.local");
  const [destinationPath, setDestinationPath] = useState("/");
  const [device, setDevice] = useState<"x4" | "x3">("x4");
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const allSources = useMemo(() => [localSource, ...sources], [sources]);
  const selectedSource = allSources.find((source) => source.id === selectedSourceId) || null;
  const isLocalSource = selectedSourceId === localSourceId;

  useEffect(() => {
    refreshAll();
    const interval = window.setInterval(() => {
      loadJobs();
      loadLibrary();
    }, 2500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedSourceId === localSourceId) {
      setBrowseStack([null]);
      setBrowseResult(null);
    } else if (selectedSourceId) {
      setBrowseStack([null]);
      browse(selectedSourceId, null);
    } else {
      setBrowseResult(null);
    }
  }, [selectedSourceId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  const sourceIcon = useMemo(() => {
    if (selectedSource?.type === "local") return <Library size={16} />;
    if (selectedSource?.type === "webdav") return <Server size={16} />;
    if (selectedSource?.type === "feed") return <Rss size={16} />;
    return <BookOpen size={16} />;
  }, [selectedSource]);

  async function refreshAll() {
    await runAction(() => Promise.all([loadSources(), loadLibrary(), loadJobs()]));
  }

  async function loadSources() {
    const data = await api<Source[]>("/api/sources");
    setSources(data);
    if (!selectedSourceId) setSelectedSourceId(localSourceId);
  }

  async function loadLibrary() {
    setLibrary(await api<LibraryItem[]>("/api/library"));
  }

  async function loadJobs() {
    setJobs(await api<Job[]>("/api/jobs"));
  }

  async function browse(sourceId: number, target: string | null) {
    if (sourceId === localSourceId) {
      setBrowseResult(null);
      return;
    }
    const query = target ? `?target=${encodeURIComponent(target)}` : "";
    await runAction(async () => {
      setBrowseResult(await api<BrowseResult>(`/api/sources/${sourceId}/browse${query}`));
    });
  }

  async function addSource(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await runAction(async () => {
        const source = await api<Source>("/api/sources", {
          method: "POST",
          body: JSON.stringify({
            type: form.type,
            name: form.name,
            url: form.url,
            username: form.username || null,
            password: form.password || null
          })
        });
        setForm(emptySourceForm);
        await loadSources();
        setSelectedSourceId(source.id);
        await browse(source.id, null);
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSource(sourceId: number) {
    if (sourceId === localSourceId) return;
    await runAction(async () => {
      await api(`/api/sources/${sourceId}`, { method: "DELETE" });
      setSelectedSourceId(localSourceId);
      await loadSources();
    });
  }

  async function openBrowseItem(item: BrowseItem) {
    const target = item.path || item.url || null;
    if (!selectedSourceId || selectedSourceId === localSourceId || !target) return;
    setBrowseStack((stack) => [...stack, target]);
    await browse(selectedSourceId, target);
  }

  async function browseBack() {
    if (!selectedSourceId || selectedSourceId === localSourceId || browseStack.length <= 1) return;
    const nextStack = browseStack.slice(0, -1);
    setBrowseStack(nextStack);
    await browse(selectedSourceId, nextStack[nextStack.length - 1]);
  }

  async function importItem(item: BrowseItem) {
    if (!selectedSourceId || selectedSourceId === localSourceId) return;
    setBusy(true);
    try {
      await runAction(async () => {
        if (item.type === "article" && item.url) {
          await api("/api/library/import-article", {
            method: "POST",
            body: JSON.stringify({ source_id: selectedSourceId, url: item.url, title: item.title, author: item.author })
          });
        } else if (item.type === "file" && item.path && selectedSource?.type === "webdav") {
          await api("/api/library/import-webdav", {
            method: "POST",
            body: JSON.stringify({ source_id: selectedSourceId, path: item.path, title: item.title })
          });
        } else if (item.url) {
          await api("/api/library/import-url", {
            method: "POST",
            body: JSON.stringify({ source_id: selectedSourceId, url: item.url, title: item.title, author: item.author })
          });
        }
        setToast("Imported");
        await loadLibrary();
      });
    } finally {
      setBusy(false);
    }
  }

  async function uploadLocalFile(file: File | null) {
    if (!file) return;
    await runAction(async () => {
      const formData = new FormData();
      formData.append("file", file);
      await api("/api/library/upload", { method: "POST", body: formData, rawBody: true });
      setToast("Uploaded");
      await loadLibrary();
    });
  }

  async function optimize(item: LibraryItem) {
    await runAction(async () => {
      await api(`/api/library/${item.id}/optimize`, {
        method: "POST",
        body: JSON.stringify(defaultOptimizePayload())
      });
      await loadJobs();
    });
  }

  async function sendToDevice(item: LibraryItem) {
    await runAction(async () => {
      await api(`/api/library/${item.id}/send`, {
        method: "POST",
        body: JSON.stringify({
          ...defaultOptimizePayload(),
          device_url: deviceUrl,
          destination_path: destinationPath,
          optimize_first: true
        })
      });
      await loadJobs();
    });
  }

  async function probeDevice() {
    await runAction(async () => {
      const status = await api<Record<string, unknown>>("/api/devices/probe", {
        method: "POST",
        body: JSON.stringify({ device_url: deviceUrl })
      });
      setToast(`${status.device || "Device"} ${status.version || ""} at ${status.ip || deviceUrl}`);
    });
  }

  async function runAction<T>(action: () => Promise<T>): Promise<T | undefined> {
    setError("");
    try {
      return await action();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      return undefined;
    }
  }

  function defaultOptimizePayload() {
    return {
      device,
      quality: 70,
      grayscale: true,
      contrast_boost: true,
      contrast_factor: 1.5,
      eink_quantize: true,
      light_novel: false,
      remove_fonts: true,
      remove_css: true,
      text_cleanup: true
    };
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Globe2 size={22} />
          <div>
            <h1>Inky</h1>
            <span>OPDS, WebDAV, feeds, optimizer, device send</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Use light mode" : "Use dark mode"}
            aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="icon-text" type="button" onClick={refreshAll} title="Refresh">
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </header>

      <section className="layout">
        <aside className="sidebar">
          <form className="panel form-panel" onSubmit={addSource}>
            <h2>Sources</h2>
            <div className="segmented">
              {(["opds", "webdav", "feed"] as RemoteSourceType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={form.type === type ? "active" : ""}
                  onClick={() => setForm((current) => ({ ...current, type }))}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Name" />
            <input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="URL" />
            <input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              placeholder="Username"
            />
            <input
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="Password"
              type="password"
            />
            <button className="primary" type="submit" disabled={busy || !form.name || !form.url}>
              <Plus size={16} />
              Add
            </button>
          </form>

          <div className="source-list">
            {allSources.map((source) => (
              <button
                type="button"
                className={`source-row ${source.id === selectedSourceId ? "selected" : ""}`}
                key={source.id}
                onClick={() => setSelectedSourceId(source.id)}
              >
                <span className="source-type">{source.type}</span>
                <span>{source.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel browse-panel">
          <div className="panel-header">
            <div className="heading-line">
              {sourceIcon}
              <h2>{isLocalSource ? localSource.name : browseResult?.title || selectedSource?.name || "Browse"}</h2>
            </div>
            <div className="toolbar">
              {!isLocalSource && (
                <button type="button" onClick={browseBack} disabled={browseStack.length <= 1} title="Back">
                  Back
                </button>
              )}
              {isLocalSource && (
                <label className="file-button" title="Upload EPUB">
                  <Upload size={16} />
                  <input type="file" accept=".epub" onChange={(event) => uploadLocalFile(event.target.files?.[0] || null)} />
                </label>
              )}
              {selectedSource && !isLocalSource && (
                <button type="button" onClick={() => deleteSource(selectedSource.id)} title="Delete source">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="table-list">
            {error && <div className="empty-state error-state">{readableError(error)}</div>}
            {!error && isLocalSource && library.length === 0 && <div className="empty-state">No local EPUBs yet.</div>}
            {!error &&
              isLocalSource &&
              library.map((item) => (
                <div className="item-row" key={item.id}>
                  <div className="item-icon">
                    <BookOpen size={16} />
                  </div>
                  <div className="item-main">
                    <strong>{item.title}</strong>
                    <span>{item.optimized_path ? "Optimized" : "Original"}</span>
                  </div>
                  <div className="row-actions">
                    <button type="button" onClick={() => optimize(item)} title="Optimize">
                      <Paintbrush size={16} />
                    </button>
                    <button type="button" onClick={() => sendToDevice(item)} title="Send">
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              ))}
            {!error && !isLocalSource && browseResult?.message && <div className="empty-state">{browseResult.message}</div>}
            {!error && !isLocalSource && selectedSource && !browseResult && (
              <div className="empty-state">Select refresh to browse this source.</div>
            )}
            {!isLocalSource && browseResult?.items.map((item, index) => (
              <div className="item-row" key={`${item.type}-${item.url || item.path}-${index}`}>
                <div className="item-icon">{iconForItem(item)}</div>
                <div className="item-main">
                  <strong>{item.title}</strong>
                  <span>
                    {[item.author, item.published, item.size ? formatBytes(item.size) : null].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="row-actions">
                  {(item.type === "navigation" || item.type === "directory") && (
                    <button type="button" onClick={() => openBrowseItem(item)} title="Open">
                      <Folder size={16} />
                    </button>
                  )}
                  {(item.type === "book" || item.type === "article" || item.type === "file") && (
                    <button type="button" onClick={() => importItem(item)} title="Import">
                      <ArrowDownToLine size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="right-rail">
          <section className="panel device-panel">
            <div className="panel-header">
              <div className="heading-line">
                <Settings2 size={16} />
                <h2>Device</h2>
              </div>
              <button type="button" onClick={probeDevice} title="Probe">
                Probe
              </button>
            </div>
            <input value={deviceUrl} onChange={(event) => setDeviceUrl(event.target.value)} placeholder="crosspoint.local" />
            <input value={destinationPath} onChange={(event) => setDestinationPath(event.target.value)} placeholder="/" />
            <div className="segmented">
              <button type="button" className={device === "x4" ? "active" : ""} onClick={() => setDevice("x4")}>
                X4
              </button>
              <button type="button" className={device === "x3" ? "active" : ""} onClick={() => setDevice("x3")}>
                X3
              </button>
            </div>
          </section>

          <section className="panel library-panel">
            <div className="panel-header">
              <div className="heading-line">
                <Library size={16} />
                <h2>Library</h2>
              </div>
            </div>
            <div className="library-list">
              {library.map((item) => (
                <div className="library-item" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.optimized_path ? "Optimized" : "Original"}</span>
                  </div>
                  <div className="row-actions">
                    <button type="button" onClick={() => optimize(item)} title="Optimize">
                      <Paintbrush size={16} />
                    </button>
                    <button type="button" onClick={() => sendToDevice(item)} title="Send">
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel jobs-panel">
            <h2>Jobs</h2>
            {jobs.slice(0, 8).map((job) => (
              <div className="job-row" key={job.id}>
                <div>
                  <strong>{job.type}</strong>
                  <span>{job.error || job.message || job.status}</span>
                </div>
                <progress value={job.progress} max={100} />
              </div>
            ))}
          </section>
        </aside>
      </section>

      {toast && (
        <button className="toast" type="button" onClick={() => setToast("")}>
          {toast}
        </button>
      )}
    </main>
  );
}

function readableError(message: string) {
  try {
    const parsed = JSON.parse(message);
    if (parsed.detail) return String(parsed.detail);
  } catch {
    // Keep original text below.
  }
  return message;
}

function getInitialTheme(): Theme {
  const stored = window.localStorage.getItem(themeStorageKey);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function iconForItem(item: BrowseItem) {
  if (item.type === "article") return <Rss size={16} />;
  if (item.type === "directory" || item.type === "navigation") return <Folder size={16} />;
  return <BookOpen size={16} />;
}

function formatBytes(size: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function api<T = unknown>(path: string, init: RequestInit & { rawBody?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!init.rawBody) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return undefined as T;
}
