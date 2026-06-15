import {
  ArrowDownToLine,
  ArrowUpDown,
  BookOpen,
  Folder,
  Library,
  Moon,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Send,
  Server,
  TabletSmartphone,
  Sun,
  Trash2,
  Wifi,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

const API = import.meta.env.VITE_API_BASE_URL || "";
const themeStorageKey = "inky-theme";
const localSourceId = -1;

type RemoteSourceType = "opds" | "webdav" | "feed";
type SourceType = "local" | RemoteSourceType;
type Theme = "light" | "dark";
type SortMode = "source" | "title_asc" | "title_desc";

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
  next_url?: string | null;
  previous_url?: string | null;
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
const browsePageSize = 25;

export default function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [searchResult, setSearchResult] = useState<BrowseResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [browsePage, setBrowsePage] = useState(1);
  const [remotePage, setRemotePage] = useState(1);
  const [sortMode, setSortMode] = useState<SortMode>("source");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [browseStack, setBrowseStack] = useState<(string | null)[]>([null]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [form, setForm] = useState<SourceForm>(emptySourceForm);
  const [deviceUrl, setDeviceUrl] = useState("crosspoint.local");
  const [destinationPath, setDestinationPath] = useState("/");
  const [device, setDevice] = useState<"x4" | "x3">("x4");
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [deviceStatus, setDeviceStatus] = useState("");
  const [testingDevice, setTestingDevice] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const allSources = useMemo(() => [localSource, ...sources], [sources]);
  const selectedSource = allSources.find((source) => source.id === selectedSourceId) || null;
  const isLocalSource = selectedSourceId === localSourceId;
  const deviceLabel = device.toUpperCase();
  const trimmedSearchQuery = searchQuery.trim();
  const activeBrowseResult = searchResult || browseResult;
  const displayedLibrary = useMemo(() => {
    if (!trimmedSearchQuery) return library;
    const needle = trimmedSearchQuery.toLocaleLowerCase();
    return library.filter((item) =>
      [item.title, item.author, item.source_url, item.original_path].some((value) => value?.toLocaleLowerCase().includes(needle))
    );
  }, [library, trimmedSearchQuery]);
  const remoteItems = activeBrowseResult?.items || [];
  const sortedLibrary = useMemo(() => sortLibraryItems(displayedLibrary, sortMode), [displayedLibrary, sortMode]);
  const sortedRemoteItems = useMemo(() => sortBrowseItems(remoteItems, sortMode), [remoteItems, sortMode]);
  const displayedItems = isLocalSource ? sortedLibrary : sortedRemoteItems;
  const totalPages = Math.max(1, Math.ceil(displayedItems.length / browsePageSize));
  const clampedBrowsePage = Math.min(browsePage, totalPages);
  const paginatedLibrary = sortedLibrary.slice((clampedBrowsePage - 1) * browsePageSize, clampedBrowsePage * browsePageSize);
  const paginatedRemoteItems = sortedRemoteItems.slice((clampedBrowsePage - 1) * browsePageSize, clampedBrowsePage * browsePageSize);
  const hasRemotePagination = !isLocalSource && Boolean(activeBrowseResult?.previous_url || activeBrowseResult?.next_url);
  const showPagination =
    displayedItems.length > browsePageSize || hasRemotePagination;
  const paginationLabel = hasRemotePagination
    ? totalPages > 1
      ? `Catalog Page ${remotePage} · results page ${clampedBrowsePage} of ${totalPages}`
      : `Catalog Page ${remotePage}`
    : `Page ${clampedBrowsePage} of ${totalPages}`;
  const sortLabel = sortLabelForMode(sortMode);

  useEffect(() => {
    refreshAll();
    const interval = window.setInterval(() => {
      loadJobs();
      loadLibrary();
    }, 2500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    clearSearch();
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
    if (selectedSource?.type === "local") return <Folder size={16} />;
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
      setBrowsePage(1);
      setRemotePage(1);
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
        setSourceModalOpen(false);
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
    clearSearch();
    setBrowseStack((stack) => [...stack, target]);
    await browse(selectedSourceId, target);
  }

  async function browseBack() {
    if (!selectedSourceId || selectedSourceId === localSourceId || browseStack.length <= 1) return;
    clearSearch();
    const nextStack = browseStack.slice(0, -1);
    setBrowseStack(nextStack);
    await browse(selectedSourceId, nextStack[nextStack.length - 1]);
  }

  async function searchSelectedSource(event: FormEvent) {
    event.preventDefault();
    if (!trimmedSearchQuery) {
      clearSearch();
      return;
    }
    if (isLocalSource) {
      setBrowsePage(1);
      return;
    }
    if (!selectedSourceId) return;

    const params = new URLSearchParams({ q: trimmedSearchQuery });
    const currentTarget = browseStack[browseStack.length - 1];
    if (currentTarget) params.set("target", currentTarget);

    setSearching(true);
    try {
      await runAction(async () => {
        setSearchResult(await api<BrowseResult>(`/api/sources/${selectedSourceId}/search?${params.toString()}`));
        setBrowsePage(1);
        setRemotePage(1);
      });
    } finally {
      setSearching(false);
    }
  }

  function updateSearchQuery(value: string) {
    setSearchQuery(value);
    setBrowsePage(1);
    if (!value.trim()) setSearchResult(null);
  }

  function clearSearch() {
    setSearchQuery("");
    setSearchResult(null);
    setBrowsePage(1);
    setRemotePage(1);
  }

  function updateSortMode(value: SortMode) {
    setSortMode(value);
    setBrowsePage(1);
    setSortMenuOpen(false);
  }

  async function openResultPage(target: string | null | undefined, direction: "next" | "previous") {
    if (!target || !selectedSourceId || isLocalSource) return;
    await runAction(async () => {
      const result = await api<BrowseResult>(`/api/sources/${selectedSourceId}/browse?target=${encodeURIComponent(target)}`);
      if (searchResult) {
        setSearchResult(result);
      } else {
        setBrowseResult(result);
      }
      setBrowsePage(1);
      setRemotePage((page) => (direction === "next" ? page + 1 : Math.max(1, page - 1)));
    });
  }

  async function importItem(item: BrowseItem) {
    if (!selectedSourceId || selectedSourceId === localSourceId) return;
    setBusy(true);
    try {
      await runAction(async () => {
        const imported = await importBrowseItem(item);
        if (!imported) return;
        setToast("Downloaded");
        await loadLibrary();
      });
    } finally {
      setBusy(false);
    }
  }

  async function sendBrowseItem(item: BrowseItem) {
    if (!selectedSourceId || selectedSourceId === localSourceId) return;
    setBusy(true);
    try {
      await runAction(async () => {
        const imported = await importBrowseItem(item);
        if (!imported) return;
        await api(`/api/library/${imported.id}/send`, {
          method: "POST",
          body: JSON.stringify({
            ...defaultOptimizePayload(),
            device_url: deviceUrl,
            destination_path: destinationPath,
            optimize_first: true
          })
        });
        setToast("Send queued");
        await Promise.all([loadLibrary(), loadJobs()]);
      });
    } finally {
      setBusy(false);
    }
  }

  async function importBrowseItem(item: BrowseItem): Promise<LibraryItem | null> {
    if (!selectedSourceId || selectedSourceId === localSourceId) return null;

    if (item.type === "article" && item.url) {
      return api<LibraryItem>("/api/library/import-article", {
        method: "POST",
        body: JSON.stringify({ source_id: selectedSourceId, url: item.url, title: item.title, author: item.author })
      });
    }

    if (item.type === "file" && item.path && selectedSource?.type === "webdav") {
      return api<LibraryItem>("/api/library/import-webdav", {
        method: "POST",
        body: JSON.stringify({ source_id: selectedSourceId, path: item.path, title: item.title })
      });
    }

    if (item.url) {
      return api<LibraryItem>("/api/library/import-url", {
        method: "POST",
        body: JSON.stringify({ source_id: selectedSourceId, url: item.url, title: item.title, author: item.author })
      });
    }

    return null;
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

  async function removeLocalItem(item: LibraryItem) {
    const confirmed = window.confirm(`Remove "${item.title}" from the local library?`);
    if (!confirmed) return;
    await runAction(async () => {
      await api(`/api/library/${item.id}`, { method: "DELETE" });
      setToast("Removed");
      await Promise.all([loadLibrary(), loadJobs()]);
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
    setDeviceError("");
    setDeviceStatus("");
    setTestingDevice(true);
    try {
      const status = await api<Record<string, unknown>>("/api/devices/probe", {
        method: "POST",
        body: JSON.stringify({ device_url: deviceUrl })
      });
      setDeviceStatus(`Successfully connected to: ${status.device || "Device"} at ${status.ip || deviceUrl}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setDeviceError(readableDeviceError(message));
    } finally {
      setTestingDevice(false);
    }
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
          <span className="brand-logo" aria-hidden="true" />
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
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </header>

      <section className="layout">
        <aside className="sidebar">
          <section className="panel device-panel">
            <div className="panel-header">
              <div className="heading-line">
                <TabletSmartphone size={16} />
                <h2>Device</h2>
              </div>
              <button type="button" onClick={probeDevice} title="Test Connection" disabled={testingDevice}>
                {testingDevice ? <RefreshCw className="spin" size={15} /> : <Wifi size={15} />}
                {testingDevice ? "Testing" : "Test Connection"}
              </button>
            </div>
            {deviceError && (
              <div className="empty-state status-state error-state">
                <span>{readableError(deviceError)}</span>
                <button type="button" onClick={() => setDeviceError("")} title="Dismiss device error" aria-label="Dismiss device error">
                  <X size={16} />
                </button>
              </div>
            )}
            {deviceStatus && (
              <div className="empty-state status-state success-state">
                <span>{deviceStatus}</span>
                <button
                  type="button"
                  onClick={() => setDeviceStatus("")}
                  title="Dismiss connection status"
                  aria-label="Dismiss connection status"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <label className="field">
              <span>Device host</span>
              <input
                value={deviceUrl}
                onChange={(event) => {
                  setDeviceError("");
                  setDeviceStatus("");
                  setDeviceUrl(event.target.value);
                }}
                placeholder="crosspoint.local"
              />
            </label>
            <label className="field">
              <span>Destination folder</span>
              <input value={destinationPath} onChange={(event) => setDestinationPath(event.target.value)} placeholder="/" />
            </label>
            <label className="field">
              <span>Optimize for</span>
              <div className="segmented">
                <button type="button" className={device === "x4" ? "active" : ""} onClick={() => setDevice("x4")}>
                  X4
                </button>
                <button type="button" className={device === "x3" ? "active" : ""} onClick={() => setDevice("x3")}>
                  X3
                </button>
              </div>
            </label>
            {jobs.length > 0 && (
              <pre className="job-log" aria-label="Recent device jobs">
                <code>{jobs.slice(0, 8).map(formatJobLog).join("\n")}</code>
              </pre>
            )}
          </section>

          <section className="panel source-panel">
            <div className="panel-header">
              <div className="heading-line">
              <Library size={16} />
              <h2>Sources</h2>
              </div>
              <button
                type="button"
                onClick={() => setSourceModalOpen(true)}
                title="Add source"
                aria-label="Add source"
              >
                <Plus size={16} />
              </button>
            </div>
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
          </section>
        </aside>

        <section className="panel browse-panel">
          <div className="panel-header">
            <div className="heading-line">
              {sourceIcon}
              <h2>{isLocalSource ? localSource.name : activeBrowseResult?.title || selectedSource?.name || "Browse"}</h2>
            </div>
            <div className="toolbar">
              {!isLocalSource && (
                <button type="button" onClick={browseBack} disabled={browseStack.length <= 1} title="Back">
                  Back
                </button>
              )}
              {isLocalSource && (
                <label className="file-button" title="Upload EPUB">
                  <Plus size={16} />
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
          {selectedSource && (
            <form className="search-bar" onSubmit={searchSelectedSource}>
              <input
                value={searchQuery}
                onChange={(event) => updateSearchQuery(event.target.value)}
                placeholder={`Search ${selectedSource.name}`}
                aria-label={`Search ${selectedSource.name}`}
              />
              {searchQuery && (
                <button type="button" onClick={clearSearch} title="Clear search" aria-label="Clear search">
                  <X size={16} />
                </button>
              )}
              <button type="submit" disabled={searching || !trimmedSearchQuery} title="Search">
                {searching ? <RefreshCw className="spin" size={15} /> : <Search size={15} />}
                Search
              </button>
              <div className="sort-menu-wrap">
                <button
                  type="button"
                  className={`sort-button ${sortMode === "source" ? "" : "active"}`}
                  onClick={() => setSortMenuOpen((open) => !open)}
                  title={`Sort: ${sortLabel}`}
                  aria-label={`Sort: ${sortLabel}`}
                  aria-expanded={sortMenuOpen}
                >
                  <ArrowUpDown size={16} />
                </button>
                {sortMenuOpen && (
                  <div className="sort-menu" role="menu">
                    {(["source", "title_asc", "title_desc"] as SortMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={sortMode === mode ? "active" : ""}
                        onClick={() => updateSortMode(mode)}
                        role="menuitem"
                      >
                        {sortLabelForMode(mode)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </form>
          )}
          <div className="table-list">
            {error && <div className="empty-state error-state">{readableError(error)}</div>}
            {!error && isLocalSource && displayedLibrary.length === 0 && (
              <div className="empty-state">
                {trimmedSearchQuery ? `No results found for "${trimmedSearchQuery}".` : "No local EPUBs yet."}
              </div>
            )}
            {!error &&
              isLocalSource &&
              paginatedLibrary.map((item) => (
                <div className="item-row" key={item.id}>
                  <div className="item-icon">
                    <BookOpen size={16} />
                  </div>
                  <div className="item-main">
                    <strong>{item.title}</strong>
                    <span>{item.optimized_path ? "Optimized" : "Not optimized yet"}</span>
                  </div>
                  <div className="row-actions">
                    <button type="button" onClick={() => sendToDevice(item)} title={`Optimize for ${deviceLabel} & Send`}>
                      <Send size={16} />
                    </button>
                    <button type="button" onClick={() => removeLocalItem(item)} title="Remove">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            {!error && !isLocalSource && activeBrowseResult?.message && <div className="empty-state">{activeBrowseResult.message}</div>}
            {!error && !isLocalSource && selectedSource && !browseResult && (
              <div className="empty-state">Select refresh to browse this source.</div>
            )}
            {!isLocalSource && paginatedRemoteItems.map((item, index) => {
              const opensBrowseTarget = item.type === "navigation" || item.type === "directory";
              return (
                <div
                  className={`item-row ${opensBrowseTarget ? "clickable-row" : ""}`}
                  key={`${item.type}-${item.url || item.path}-${index}`}
                  onClick={opensBrowseTarget ? () => openBrowseItem(item) : undefined}
                  onKeyDown={
                    opensBrowseTarget
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openBrowseItem(item);
                          }
                        }
                      : undefined
                  }
                  role={opensBrowseTarget ? "button" : undefined}
                  tabIndex={opensBrowseTarget ? 0 : undefined}
                >
                  <div className="item-icon">{iconForItem(item)}</div>
                  <div className="item-main">
                    <strong>{item.title}</strong>
                    <span>
                      {[item.author, item.published, item.size ? formatBytes(item.size) : null].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {(item.type === "book" || item.type === "article" || item.type === "file") && (
                    <div className="row-actions">
                      <button type="button" onClick={() => importItem(item)} title="Download to Local Library" disabled={busy}>
                        <ArrowDownToLine size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => sendBrowseItem(item)}
                        title={`Download, Optimize for ${deviceLabel} & Send`}
                        disabled={busy}
                      >
                        <Send size={16} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {showPagination && (
            <div className="pagination-bar">
              <span>
                {paginationLabel}
              </span>
              <div className="pagination-actions">
                <button
                  type="button"
                  onClick={() =>
                    clampedBrowsePage > 1
                      ? setBrowsePage((page) => Math.max(1, page - 1))
                      : openResultPage(activeBrowseResult?.previous_url, "previous")
                  }
                  disabled={clampedBrowsePage <= 1 && !activeBrowseResult?.previous_url}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() =>
                    clampedBrowsePage < totalPages
                      ? setBrowsePage((page) => Math.min(totalPages, page + 1))
                      : openResultPage(activeBrowseResult?.next_url, "next")
                  }
                  disabled={clampedBrowsePage >= totalPages && !activeBrowseResult?.next_url}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>

      </section>

      {sourceModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="panel form-panel modal-card" onSubmit={addSource} role="dialog" aria-modal="true" aria-labelledby="add-source-title">
            <div className="panel-header">
              <h2 id="add-source-title">Add Source</h2>
              <button type="button" onClick={() => setSourceModalOpen(false)} title="Close" aria-label="Close add source">
                <X size={16} />
              </button>
            </div>
            <div className="source-form-body">
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
              <div className="modal-actions">
                <button type="button" onClick={() => setSourceModalOpen(false)}>
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={busy || !form.name || !form.url}>
                  <Plus size={16} />
                  Add Source
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {toast && (
        <button className="toast" type="button" onClick={() => setToast("")}>
          {toast}
        </button>
      )}
    </main>
  );
}

function formatJobLog(job: Job) {
  const status = job.error ? "error" : job.status;
  const message = job.error || job.message || job.status;
  return `[${status}] ${job.type} ${job.progress}%${message ? ` - ${message}` : ""}`;
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

function readableDeviceError(message: string) {
  const detail = readableError(message);
  if (!detail || detail === message) {
    return "Unable to connect to device.";
  }
  return `Unable to connect to device. ${detail}`;
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

function sortBrowseItems(items: BrowseItem[], sortMode: SortMode) {
  if (sortMode === "source") return items;
  return [...items].sort((left, right) => compareTitles(left.title, right.title, sortMode));
}

function sortLibraryItems(items: LibraryItem[], sortMode: SortMode) {
  if (sortMode === "source") return items;
  return [...items].sort((left, right) => compareTitles(left.title, right.title, sortMode));
}

function compareTitles(left: string, right: string, sortMode: SortMode) {
  const result = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  return sortMode === "title_desc" ? -result : result;
}

function sortLabelForMode(sortMode: SortMode) {
  if (sortMode === "title_asc") return "Title A-Z";
  if (sortMode === "title_desc") return "Title Z-A";
  return "Source order";
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
