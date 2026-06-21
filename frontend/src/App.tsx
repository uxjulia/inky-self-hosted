import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  CircleHelp,
  GripVertical,
  Folder,
  Home,
  Library,
  LogIn,
  LogOut,
  MoreVertical,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Rss,
  Save,
  Search,
  Send,
  Server,
  SlidersHorizontal,
  TabletSmartphone,
  Sun,
  Trash2,
  Wifi,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { HelpPage } from "./HelpPage";

declare global {
  interface Window {
    inkyDesktop?: {
      apiBaseUrl?: string;
      selectLibraryFolder?: () => Promise<string | null>;
    };
  }
}

const API = window.inkyDesktop?.apiBaseUrl || import.meta.env.VITE_API_BASE_URL || "";
const themeStorageKey = "inky-theme";
const localSourceIndexStorageKey = "inky-local-source-index";
const optimizerSettingsStorageKey = "inky-optimizer-settings";
const authStorageKey = "inky-basic-auth";
const localSourceId = -1;

type AppView = "app" | "help";
type RemoteSourceType = "opds" | "webdav" | "feed" | "local_folder";
type SourceType = "local" | RemoteSourceType;
type Theme = "light" | "dark";
type SortMode = "source" | "title_asc" | "title_desc" | "type";
type ToastState = { message: string; tone: "success" | "error" };
type PendingBrowseAction = { key: string; action: "save" | "send" };
type OptimizerSettings = {
  quality: number;
  grayscale: boolean;
  contrast_boost: boolean;
  contrast_factor: number;
  eink_quantize: boolean;
  light_novel: boolean;
  remove_fonts: boolean;
  remove_css: boolean;
  text_cleanup: boolean;
};

type Source = {
  id: number;
  type: SourceType;
  name: string;
  url: string;
  username?: string | null;
  display_order?: number;
};

type BrowseItem = {
  type: "navigation" | "book" | "article" | "directory" | "file";
  title: string;
  url?: string | null;
  path?: string | null;
  image_url?: string | null;
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
  cover_url?: string | null;
  sent_at?: string | null;
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
const sourceTypes: RemoteSourceType[] = ["opds", "webdav", "feed", "local_folder"];
const isDesktopApp = Boolean(window.inkyDesktop?.selectLibraryFolder);
const browsePageSize = 25;
const defaultOptimizerSettings: OptimizerSettings = {
  quality: 70,
  grayscale: true,
  contrast_boost: true,
  contrast_factor: 1.1,
  eink_quantize: true,
  light_novel: false,
  remove_fonts: true,
  remove_css: true,
  text_cleanup: true
};

export default function App() {
  const [view, setView] = useState<AppView>(() => getInitialView());
  const [authChecked, setAuthChecked] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
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
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [form, setForm] = useState<SourceForm>(emptySourceForm);
  const [deviceUrl, setDeviceUrl] = useState("crosspoint.local");
  const [destinationPath, setDestinationPath] = useState("/");
  const [device, setDevice] = useState<"x4" | "x3">("x4");
  const [optimizerSettings, setOptimizerSettings] = useState<OptimizerSettings>(() => getInitialOptimizerSettings());
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [localSourceIndex, setLocalSourceIndex] = useState(() => getInitialLocalSourceIndex());
  const [busy, setBusy] = useState(false);
  const [pendingBrowseAction, setPendingBrowseAction] = useState<PendingBrowseAction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [deviceStatus, setDeviceStatus] = useState("");
  const [testingDevice, setTestingDevice] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [optimizerModalOpen, setOptimizerModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [draggedSourceId, setDraggedSourceId] = useState<number | null>(null);
  const [dragOverSourceId, setDragOverSourceId] = useState<number | null>(null);
  const [sourceMenuId, setSourceMenuId] = useState<number | null>(null);
  const allSources = useMemo(() => insertLocalSource(sources, localSourceIndex), [sources, localSourceIndex]);
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
  const activeSortMode = !isLocalSource && sortMode === "type" ? "source" : sortMode;
  const sortOptions: SortMode[] = isLocalSource ? ["source", "type", "title_asc", "title_desc"] : ["source", "title_asc", "title_desc"];
  const availableSourceTypes = useMemo(
    () => sourceTypes.filter((type) => type !== "local_folder" || isDesktopApp),
    []
  );
  const sortedLibrary = useMemo(() => sortLibraryItems(displayedLibrary, sortMode), [displayedLibrary, sortMode]);
  const sortedRemoteItems = useMemo(() => sortBrowseItems(remoteItems, activeSortMode), [remoteItems, activeSortMode]);
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
  const sortLabel = sortLabelForMode(activeSortMode);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) return;

    refreshAll(false);
    const interval = window.setInterval(() => {
      loadLibrary();
    }, 2500);
    return () => window.clearInterval(interval);
  }, [authChecked, isAuthenticated]);

  useEffect(() => {
    const updateViewFromHash = () => setView(getInitialView());
    window.addEventListener("hashchange", updateViewFromHash);
    return () => window.removeEventListener("hashchange", updateViewFromHash);
  }, []);

  useEffect(() => {
    if (!activeJobId) return;

    const pollJob = async () => {
      const job = await loadVisibleJob(activeJobId);
      if (job && (job.status === "succeeded" || job.status === "failed")) {
        setActiveJobId(null);
        if (job.status === "failed") {
          showToast(job.error || job.message || "Send failed", "error");
        } else if (job.type === "send") {
          showToast("Sent to device");
        }
        await loadLibrary();
      }
    };

    const interval = window.setInterval(pollJob, 1500);
    return () => window.clearInterval(interval);
  }, [activeJobId]);

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

  useEffect(() => {
    window.localStorage.setItem(optimizerSettingsStorageKey, JSON.stringify(optimizerSettings));
  }, [optimizerSettings]);

  useEffect(() => {
    const clampedIndex = clampLocalSourceIndex(localSourceIndex, sources.length);
    if (clampedIndex === localSourceIndex) return;
    setLocalSourceIndex(clampedIndex);
    window.localStorage.setItem(localSourceIndexStorageKey, String(clampedIndex));
  }, [localSourceIndex, sources.length]);

  useEffect(() => {
    if (!error) return;
    if (window.matchMedia("(max-width: 760px)").matches) {
      showToast(readableError(error), "error");
    }
  }, [error]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const sourceIcon = useMemo(() => {
    if (selectedSource?.type === "local") return <Folder size={16} />;
    if (selectedSource?.type === "local_folder") return <Folder size={16} />;
    if (selectedSource?.type === "webdav") return <Server size={16} />;
    if (selectedSource?.type === "feed") return <Rss size={16} />;
    return <BookOpen size={16} />;
  }, [selectedSource]);

  async function checkAuth() {
    try {
      const status = await publicApi<{ enabled: boolean }>("/api/auth/status");
      setAuthEnabled(status.enabled);
      if (!status.enabled) {
        setIsAuthenticated(true);
        return;
      }

      if (!window.sessionStorage.getItem(authStorageKey)) {
        setIsAuthenticated(false);
        return;
      }

      try {
        await api("/api/auth/login");
        setIsAuthenticated(true);
      } catch {
        window.sessionStorage.removeItem(authStorageKey);
        setIsAuthenticated(false);
      }
    } finally {
      setAuthChecked(true);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    const token = window.btoa(`${loginUsername}:${loginPassword}`);
    window.sessionStorage.setItem(authStorageKey, `Basic ${token}`);
    try {
      await api("/api/auth/login");
      setIsAuthenticated(true);
      setLoginPassword("");
    } catch {
      window.sessionStorage.removeItem(authStorageKey);
      setIsAuthenticated(false);
      setLoginError("Invalid username or password.");
    }
  }

  function logout() {
    window.sessionStorage.removeItem(authStorageKey);
    setIsAuthenticated(false);
    setSources([]);
    setLibrary([]);
    setJobs([]);
    setSelectedSourceId(null);
  }

  async function refreshAll(showFeedback = true) {
    setRefreshing(true);
    try {
      const refreshed = await runAction(async () => {
        await Promise.all([loadSources(), loadLibrary(), activeJobId ? loadVisibleJob(activeJobId) : Promise.resolve()]);

        if (selectedSourceId && selectedSourceId !== localSourceId) {
          if (trimmedSearchQuery) {
            const params = new URLSearchParams({ q: trimmedSearchQuery });
            const currentTarget = browseStack[browseStack.length - 1];
            if (currentTarget) params.set("target", currentTarget);
            setSearchResult(await api<BrowseResult>(`/api/sources/${selectedSourceId}/search?${params.toString()}`));
          } else {
            const target = activeBrowseResult?.base_url || browseStack[browseStack.length - 1];
            const query = target ? `?target=${encodeURIComponent(target)}` : "";
            setBrowseResult(await api<BrowseResult>(`/api/sources/${selectedSourceId}/browse${query}`));
          }
        }
      });

      if (showFeedback && refreshed !== undefined) {
        showToast("Refreshed");
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function loadSources() {
    const data = await api<Source[]>("/api/sources");
    setSources(data);
    if (!selectedSourceId) setSelectedSourceId(localSourceId);
  }

  async function loadLibrary() {
    setLibrary(await api<LibraryItem[]>("/api/library"));
  }

  async function loadVisibleJob(jobId: string) {
    const job = await api<Job>(`/api/jobs/${jobId}`);
    setJobs([job]);
    return job;
  }

  function trackJob(job: Job) {
    setJobs([job]);
    setActiveJobId(job.id);
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

  function openAddSourceModal() {
    setSourceMenuId(null);
    setEditingSource(null);
    setForm(emptySourceForm);
    setSourceModalOpen(true);
  }

  function openEditSource(source: Source) {
    if (source.type === "local") return;
    setSourceMenuId(null);
    setEditingSource(source);
    setForm({
      type: source.type,
      name: source.name,
      url: source.url,
      username: source.username || "",
      password: ""
    });
    setSourceModalOpen(true);
  }

  function closeSourceModal() {
    setSourceModalOpen(false);
    setEditingSource(null);
    setForm(emptySourceForm);
  }

  async function selectSourceType(type: RemoteSourceType) {
    if (type !== "local_folder") {
      setForm((current) => ({ ...current, type }));
      return;
    }

    const selectLibraryFolder = window.inkyDesktop?.selectLibraryFolder;
    if (!selectLibraryFolder) {
      showToast("Local Folder sources are available in the desktop app.", "error");
      return;
    }

    const folderPath = await selectLibraryFolder();
    if (!folderPath) return;
    setForm((current) => ({
      ...current,
      type,
      name: current.name || folderNameFromPath(folderPath),
      url: folderPath,
      username: "",
      password: ""
    }));
  }

  async function saveSource(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await runAction(async () => {
        if (editingSource) {
          const updatedSource = await api<Source>(`/api/sources/${editingSource.id}`, {
            method: "PUT",
            body: JSON.stringify({
              type: form.type,
              name: form.name,
              url: form.url,
              username: form.type === "local_folder" ? null : form.username || null,
              password: form.type === "local_folder" ? null : form.password || null
            })
          });
          setSelectedSourceId(updatedSource.id);
          await loadSources();
          showToast("Source updated");
          closeSourceModal();
          return;
        }

        const source = await api<Source>("/api/sources", {
          method: "POST",
          body: JSON.stringify({
            type: form.type,
            name: form.name,
            url: form.url,
            username: form.type === "local_folder" ? null : form.username || null,
            password: form.type === "local_folder" ? null : form.password || null
          })
        });
        setForm(emptySourceForm);
        await loadSources();
        setSelectedSourceId(source.id);
        await browse(source.id, null);
        showToast("Source added");
        closeSourceModal();
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSource(sourceId: number) {
    if (sourceId === localSourceId) return;
    setSourceMenuId(null);
    await runAction(async () => {
      await api(`/api/sources/${sourceId}`, { method: "DELETE" });
      setSelectedSourceId(localSourceId);
      await loadSources();
    });
  }

  async function reorderSources(nextAllSources: Source[]) {
    const previousSources = sources;
    const previousLocalSourceIndex = localSourceIndex;
    const nextSources = nextAllSources.filter((source) => source.id !== localSourceId);
    const nextLocalSourceIndex = Math.max(0, nextAllSources.findIndex((source) => source.id === localSourceId));
    setSources(nextSources);
    setLocalSourceIndex(nextLocalSourceIndex);
    window.localStorage.setItem(localSourceIndexStorageKey, String(nextLocalSourceIndex));

    if (nextSources.length > 0) {
      const reordered = await runAction(() =>
        api<Source[]>("/api/sources/reorder", {
          method: "PUT",
          body: JSON.stringify({ source_ids: nextSources.map((source) => source.id) })
        })
      );
      if (reordered) {
        setSources(reordered);
      } else {
        setSources(previousSources);
        setLocalSourceIndex(previousLocalSourceIndex);
        window.localStorage.setItem(localSourceIndexStorageKey, String(previousLocalSourceIndex));
      }
    }

    setSourceMenuId(null);
  }

  async function dropSource(event: DragEvent<HTMLDivElement>, targetSourceId: number) {
    event.preventDefault();
    if (draggedSourceId === null || draggedSourceId === targetSourceId) {
      setDraggedSourceId(null);
      setDragOverSourceId(null);
      return;
    }

    const targetBounds = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientY > targetBounds.top + targetBounds.height / 2;
    const nextSources = moveSource(allSources, draggedSourceId, targetSourceId, insertAfter);
    setDraggedSourceId(null);
    setDragOverSourceId(null);
    await reorderSources(nextSources);
  }

  async function moveSourceByOffset(sourceId: number, offset: -1 | 1) {
    const currentIndex = allSources.findIndex((source) => source.id === sourceId);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= allSources.length) return;

    const nextSources = [...allSources];
    const [source] = nextSources.splice(currentIndex, 1);
    nextSources.splice(nextIndex, 0, source);
    await reorderSources(nextSources);
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

  function updateOptimizerSetting<K extends keyof OptimizerSettings>(key: K, value: OptimizerSettings[K]) {
    setOptimizerSettings((current) => ({ ...current, [key]: value }));
  }

  function resetOptimizerSettings() {
    setOptimizerSettings(defaultOptimizerSettings);
  }

  function showToast(message: string, tone: ToastState["tone"] = "success") {
    setToast({ message, tone });
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
    setPendingBrowseAction({ key: browseItemKey(item), action: "save" });
    setBusy(true);
    try {
      await runAction(async () => {
        const imported = await importBrowseItem(item);
        if (!imported) return;
        showToast("Saved to Local Library");
        await loadLibrary();
      }, { toastOnError: true });
    } finally {
      setPendingBrowseAction(null);
      setBusy(false);
    }
  }

  async function sendBrowseItem(item: BrowseItem) {
    if (!selectedSourceId || selectedSourceId === localSourceId) return;
    setPendingBrowseAction({ key: browseItemKey(item), action: "send" });
    setBusy(true);
    try {
      await runAction(async () => {
        if (selectedSource?.type === "local_folder" && item.path) {
          const job = await api<Job>(`/api/sources/${selectedSourceId}/send-local-file`, {
            method: "POST",
            body: JSON.stringify({
              ...defaultOptimizePayload(),
              path: item.path,
              device_url: deviceUrl,
              destination_path: destinationPath,
              optimize_first: true
            })
          });
          trackJob(job);
          showToast("Send queued");
          return;
        }

        const imported = await importBrowseItem(item);
        if (!imported) return;
        const job = await api<Job>(`/api/library/${imported.id}/send`, {
          method: "POST",
          body: JSON.stringify({
            ...defaultOptimizePayload(),
            device_url: deviceUrl,
            destination_path: destinationPath,
            optimize_first: true
          })
        });
        trackJob(job);
        showToast("Send queued");
        await loadLibrary();
      }, { toastOnError: true });
    } finally {
      setPendingBrowseAction(null);
      setBusy(false);
    }
  }

  async function importBrowseItem(item: BrowseItem): Promise<LibraryItem | null> {
    if (!selectedSourceId || selectedSourceId === localSourceId) return null;

    if (item.type === "article" && item.url) {
      return api<LibraryItem>("/api/library/import-article", {
        method: "POST",
        body: JSON.stringify({
          source_id: selectedSourceId,
          url: item.url,
          title: item.title,
          author: item.author,
          cover_url: item.image_url
        })
      });
    }

    if (item.type === "file" && item.path && selectedSource?.type === "webdav") {
      return api<LibraryItem>("/api/library/import-webdav", {
        method: "POST",
        body: JSON.stringify({ source_id: selectedSourceId, path: item.path, title: item.title, cover_url: item.image_url })
      });
    }

    if (item.type === "file" && item.path && selectedSource?.type === "local_folder") {
      return api<LibraryItem>("/api/library/import-local-file", {
        method: "POST",
        body: JSON.stringify({ source_id: selectedSourceId, path: item.path, title: item.title })
      });
    }

    if (item.url) {
      return api<LibraryItem>("/api/library/import-url", {
        method: "POST",
        body: JSON.stringify({
          source_id: selectedSourceId,
          url: item.url,
          title: item.title,
          author: item.author,
          cover_url: item.image_url
        })
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
      showToast("Uploaded");
      await loadLibrary();
    });
  }

  async function removeLocalItem(item: LibraryItem) {
    const confirmed = window.confirm(`Remove "${item.title}" from the local library?`);
    if (!confirmed) return;
    await runAction(async () => {
      await api(`/api/library/${item.id}`, { method: "DELETE" });
      showToast("Removed");
      await loadLibrary();
    });
  }

  async function sendToDevice(item: LibraryItem) {
    await runAction(async () => {
      const job = await api<Job>(`/api/library/${item.id}/send`, {
        method: "POST",
        body: JSON.stringify({
          ...defaultOptimizePayload(),
          device_url: deviceUrl,
          destination_path: destinationPath,
          optimize_first: true
        })
      });
      trackJob(job);
      showToast("Send queued");
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

  async function runAction<T>(action: () => Promise<T>, options: { toastOnError?: boolean } = {}): Promise<T | undefined> {
    setError("");
    try {
      return await action();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      if (options.toastOnError) showToast(readableError(message), "error");
      return undefined;
    }
  }

  function defaultOptimizePayload() {
    return {
      device,
      ...optimizerSettings
    };
  }

  function openHelp() {
    if (window.location.hash !== "#help") {
      window.location.hash = "help";
    }
    setView("help");
  }

  function openApp() {
    if (window.location.hash === "#help") {
      window.history.pushState("", document.title, window.location.pathname + window.location.search);
    }
    setView("app");
  }

  if (!authChecked) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-card">
          <span className="brand-logo" aria-hidden="true" />
          <h1>Inky</h1>
          <p>Starting up...</p>
        </section>
      </main>
    );
  }

  if (authEnabled && !isAuthenticated) {
    return (
      <main className="app-shell auth-shell">
        <form className="auth-card" onSubmit={login}>
          <span className="brand-logo" aria-hidden="true" />
          <h1>Inky</h1>
          <p>Sign in to access your self-hosted library.</p>
          {loginError && <div className="auth-error">{loginError}</div>}
          <input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} placeholder="Username" autoComplete="username" />
          <input
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            placeholder="Password"
            type="password"
            autoComplete="current-password"
          />
          <button className="primary" type="submit" disabled={!loginUsername || !loginPassword}>
            <LogIn size={16} />
            Sign in
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo" aria-hidden="true" />
          <div>
            <h1>Inky</h1>
            <span>A Cross<span className="serif">I</span>nk Companion App</span>
          </div>
        </div>
        <div className="topbar-actions">
          {view === "help" ? (
            <button className="primary icon-text" type="button" onClick={openApp} title="Open app">
              <Home size={16} />
              App
            </button>
          ) : (
            <button className="icon-text" type="button" onClick={openHelp} title="Help">
              <CircleHelp size={16} />
              Help
            </button>
          )}
          <button
            type="button"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Use light mode" : "Use dark mode"}
            aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {view === "app" && (
            <button className="icon-text" type="button" onClick={() => refreshAll()} title="Refresh" disabled={refreshing}>
              <RefreshCw className={refreshing ? "spin" : ""} size={15} />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          )}
          {authEnabled && (
            <button type="button" onClick={logout} title="Sign out" aria-label="Sign out">
              <LogOut size={16} />
            </button>
          )}
        </div>
      </header>

      {view === "help" ? (
        <HelpPage onOpenApp={openApp} isDesktopApp={isDesktopApp} />
      ) : (
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
                {testingDevice ? "Searching" : "Test Connection"}
              </button>
            </div>
            {deviceError && (
              <div className="empty-state status-state error-state">
                <span>{readableError(deviceError)}</span>
                <button className="border-0" type="button" onClick={() => setDeviceError("")} title="Dismiss device error" aria-label="Dismiss device error">
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
              <span>Destination folder (created if needed)</span>
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
            <button className="icon-text optimizer-settings-button" type="button" onClick={() => setOptimizerModalOpen(true)} title="EPUB Optimizer Settings">
              <SlidersHorizontal size={16} />
              EPUB Optimizer Settings
            </button>
            {jobs.length > 0 && (
              <pre className="job-log" aria-label="Latest device job">
                <code>{jobs.map(formatJobLog).join("\n")}</code>
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
                className="border-0"
                type="button"
                onClick={openAddSourceModal}
                title="Add source"
                aria-label="Add source"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="source-list">
              {allSources.map((source, index) => (
                <div
                  className={`source-row ${source.id === selectedSourceId ? "selected" : ""} ${
                    source.id === draggedSourceId ? "dragging" : ""
                  } ${source.id === dragOverSourceId ? "drag-over" : ""}`}
                  draggable
                  key={source.id}
                  onClick={() => {
                    setSourceMenuId(null);
                    setSelectedSourceId(source.id);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDraggedSourceId(source.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverSourceId(source.id);
                  }}
                  onDragLeave={() => setDragOverSourceId((current) => (current === source.id ? null : current))}
                  onDragEnd={() => {
                    setDraggedSourceId(null);
                    setDragOverSourceId(null);
                  }}
                  onDrop={(event) => dropSource(event, source.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedSourceId(source.id);
                    }
                  }}
                >
                  <GripVertical className="source-drag-icon" size={15} aria-hidden="true" />
                  <span className="source-type">{sourceTypeShortLabel(source.type)}</span>
                  <span className="source-name">{source.name}</span>
                  <div className="source-menu-wrap">
                    <button
                      className="source-menu-button"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSourceMenuId((current) => (current === source.id ? null : source.id));
                      }}
                      title={`${source.name} settings`}
                      aria-label={`${source.name} settings`}
                      aria-expanded={sourceMenuId === source.id}
                    >
                      <MoreVertical size={15} />
                    </button>
                    {sourceMenuId === source.id && (
                      <div className="source-menu" role="menu">
                        {source.id !== localSourceId && (source.type !== "local_folder" || isDesktopApp) && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditSource(source);
                            }}
                            role="menuitem"
                          >
                            <Pencil size={15} />
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            moveSourceByOffset(source.id, -1);
                          }}
                          disabled={index === 0}
                          role="menuitem"
                        >
                          <ArrowUp size={15} />
                          Move up
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            moveSourceByOffset(source.id, 1);
                          }}
                          disabled={index === allSources.length - 1}
                          role="menuitem"
                        >
                          <ArrowDown size={15} />
                          Move down
                        </button>
                        {source.id !== localSourceId && (
                          <button
                            type="button"
                            className="danger-menu-item"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteSource(source.id);
                            }}
                            role="menuitem"
                          >
                            <Trash2 size={15} />
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
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
                <>
                  <label className="file-button border-0" title="Upload file" aria-label="Upload file">
                    <Plus size={16} />
                    <input type="file" accept=".epub,.txt,.xtc,.xtch,.bmp,.png" onChange={(event) => uploadLocalFile(event.target.files?.[0] || null)} />
                  </label>
                </>
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
                    {sortOptions.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={activeSortMode === mode ? "active" : ""}
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
            {error && (
              <div className="empty-state status-state error-state">
                <span>{readableError(error)}</span>
                <button type="button" onClick={() => setError("")} title="Dismiss error" aria-label="Dismiss error">
                  <X size={16} />
                </button>
              </div>
            )}
            {!error && isLocalSource && displayedLibrary.length === 0 && (
              <div className="empty-state">
                {trimmedSearchQuery ? `No results found for "${trimmedSearchQuery}".` : "No local files yet."}
              </div>
            )}
            {!error &&
              isLocalSource &&
              paginatedLibrary.map((item) => {
                const itemMeta = formatLibraryItemMeta(item);
                const canRemoveItem = !isMountedLibraryItem(item);
                const sendTitle = canOptimizeLibraryItem(item) ? `Optimize for ${deviceLabel} & Send` : "Send to device";
                const fileType = libraryFileType(item);
                return (
                  <div className="item-row local-library-row" key={item.id}>
                    <div className={item.cover_url ? "item-cover" : "item-icon"}>
                      {item.cover_url ? <img src={mediaUrl(item.cover_url)} alt="" loading="lazy" /> : <BookOpen size={16} />}
                    </div>
                    <div className="item-main">
                      <div className="item-title-line">
                        <strong>{item.title}</strong>
                      </div>
                      {itemMeta && <span>{itemMeta}</span>}
                    </div>

                    <div className="row-actions">
                      {fileType && <span className={`file-type-tag file-type-${fileType}`}>{fileType}</span>}
                      <button type="button" onClick={() => sendToDevice(item)} title={sendTitle}>
                        <Send size={16} />
                      </button>
                      {canRemoveItem && (
                        <button type="button" onClick={() => removeLocalItem(item)} title="Remove">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            {!error && !isLocalSource && activeBrowseResult?.message && <div className="empty-state">{activeBrowseResult.message}</div>}
            {!error && !isLocalSource && selectedSource && !browseResult && (
              <div className="empty-state">Select refresh to browse this source.</div>
            )}
            {!isLocalSource && paginatedRemoteItems.map((item, index) => {
              const opensBrowseTarget = item.type === "navigation" || item.type === "directory";
              const isSendableItem = item.type === "book" || item.type === "article" || item.type === "file";
              const itemKey = browseItemKey(item);
              const savingItem = pendingBrowseAction?.key === itemKey && pendingBrowseAction.action === "save";
              const sendingItem = pendingBrowseAction?.key === itemKey && pendingBrowseAction.action === "send";
              const sendTitle = canOptimizeBrowseItem(item) ? `Optimize for ${deviceLabel} & Send` : "Send to device";
              const sendingTitle = canOptimizeBrowseItem(item) ? `Optimizing for ${deviceLabel} & sending` : "Sending to device";
              return (
                <div
                  className={`item-row ${isSendableItem ? "sendable-row" : "navigation-row"} ${opensBrowseTarget ? "clickable-row" : ""}`}
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
                  <div className={item.image_url ? "item-cover" : "item-icon"}>
                    {item.image_url ? <img src={mediaUrl(item.image_url)} alt="" loading="lazy" /> : iconForItem(item)}
                  </div>
                  <div className="item-main">
                    <strong>{item.title}</strong>
                    <span>
                      {[item.author, item.published, item.size ? formatBytes(item.size) : null].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {isSendableItem && (
                    <div className="row-actions">
                      <button
                        type="button"
                        onClick={() => importItem(item)}
                        title={savingItem ? "Saving to Local Library" : "Save to Local Library"}
                        aria-label={savingItem ? "Saving to Local Library" : "Save to Local Library"}
                        disabled={busy}
                      >
                        {savingItem ? <RefreshCw className="spin" size={15} /> : <Save size={16} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => sendBrowseItem(item)}
                        title={sendingItem ? sendingTitle : sendTitle}
                        aria-label={sendingItem ? sendingTitle : sendTitle}
                        disabled={busy}
                      >
                        {sendingItem ? <RefreshCw className="spin" size={15} /> : <Send size={16} />}
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
      )}

      {view === "app" && sourceModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="panel form-panel modal-card" onSubmit={saveSource} role="dialog" aria-modal="true" aria-labelledby="source-modal-title">
            <div className="panel-header">
              <h2 id="source-modal-title">{editingSource ? "Edit Source" : "Add Source"}</h2>
              <button type="button" onClick={closeSourceModal} title="Close" aria-label="Close source modal">
                <X size={16} />
              </button>
            </div>
            <div className="source-form-body">
              <div className="segmented source-type-segmented">
                {availableSourceTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={form.type === type ? "active" : ""}
                    onClick={() => selectSourceType(type)}
                  >
                    {sourceTypeLabel(type)}
                  </button>
                ))}
              </div>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Name" />
              {form.type === "local_folder" ? (
                <div className="folder-source-field">
                  <input value={form.url} readOnly placeholder="Select a folder" />
                  <button type="button" onClick={() => selectSourceType("local_folder")}>
                    Browse
                  </button>
                </div>
              ) : (
                <>
                  <input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="URL" />
                  <input
                    value={form.username}
                    onChange={(event) => setForm({ ...form, username: event.target.value })}
                    placeholder="Username"
                  />
                  <input
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    placeholder={editingSource ? "New password (leave blank to keep current)" : "Password"}
                    type="password"
                  />
                </>
              )}
              <div className="modal-actions">
                <button type="button" onClick={closeSourceModal}>
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={busy || !form.name || !form.url}>
                  {editingSource ? <Save size={16} /> : <Plus size={16} />}
                  {editingSource ? "Save Source" : "Add Source"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {view === "app" && optimizerModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="panel form-panel modal-card optimizer-modal-card" role="dialog" aria-modal="true" aria-labelledby="optimizer-modal-title">
            <div className="panel-header">
              <h2 id="optimizer-modal-title">EPUB Optimizer Settings</h2>
              <button type="button" onClick={() => setOptimizerModalOpen(false)} title="Close" aria-label="Close optimizer settings">
                <X size={16} />
              </button>
            </div>
            <div className="settings-grid">
              <label className="field">
                <span>JPEG quality</span>
                <div className="range-field">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={optimizerSettings.quality}
                    onChange={(event) => updateOptimizerSetting("quality", clampNumber(Number(event.target.value), 1, 100))}
                  />
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={optimizerSettings.quality}
                    onChange={(event) => updateOptimizerSetting("quality", clampNumber(Number(event.target.value), 1, 100))}
                    aria-label="JPEG quality"
                  />
                </div>
              </label>
              <label className="field">
                <span>Contrast multiplier</span>
                <div className="range-field">
                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.1"
                    value={optimizerSettings.contrast_factor}
                    disabled={!optimizerSettings.contrast_boost}
                    onChange={(event) => updateOptimizerSetting("contrast_factor", clampNumber(Number(event.target.value), 0.5, 3))}
                  />
                  <input
                    type="number"
                    min="0.5"
                    max="3"
                    step="0.1"
                    value={optimizerSettings.contrast_factor}
                    disabled={!optimizerSettings.contrast_boost}
                    onChange={(event) => updateOptimizerSetting("contrast_factor", clampNumber(Number(event.target.value), 0.5, 3))}
                    aria-label="Contrast multiplier"
                  />
                </div>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={optimizerSettings.grayscale}
                  onChange={(event) => updateOptimizerSetting("grayscale", event.target.checked)}
                />
                <span>Convert images to grayscale</span>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={optimizerSettings.contrast_boost}
                  onChange={(event) => updateOptimizerSetting("contrast_boost", event.target.checked)}
                />
                <span>Boost image contrast</span>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={optimizerSettings.eink_quantize}
                  onChange={(event) => updateOptimizerSetting("eink_quantize", event.target.checked)}
                />
                <span>Use 4-level e-ink grayscale</span>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={optimizerSettings.light_novel}
                  onChange={(event) => updateOptimizerSetting("light_novel", event.target.checked)}
                />
                <span>Rotate and split landscape images</span>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={optimizerSettings.remove_fonts}
                  onChange={(event) => updateOptimizerSetting("remove_fonts", event.target.checked)}
                />
                <span>Remove embedded fonts</span>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={optimizerSettings.remove_css}
                  onChange={(event) => updateOptimizerSetting("remove_css", event.target.checked)}
                />
                <span>Remove unused CSS</span>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={optimizerSettings.text_cleanup}
                  onChange={(event) => updateOptimizerSetting("text_cleanup", event.target.checked)}
                />
                <span>Clean text punctuation and spacing</span>
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={resetOptimizerSettings}>
                Reset Defaults
              </button>
              <button className="primary" type="button" onClick={() => setOptimizerModalOpen(false)}>
                <Save size={16} />
                Save Settings
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.tone === "error" ? "error-toast" : "success-toast"}`} role={toast.tone === "error" ? "alert" : "status"}>
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} title="Close" aria-label="Close notification">
            <X size={16} />
          </button>
        </div>
      )}
    </main>
  );
}

function formatJobLog(job: Job) {
  const status = job.error ? "error" : job.status;
  const message = job.error || job.message || job.status;
  const progress = message.startsWith("Uploading to device (") ? ` ${job.progress}%` : "";
  return `[${status}] ${job.type}${progress}${message ? ` - ${message}` : ""}`;
}

function formatSentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatLibraryItemMeta(item: LibraryItem) {
  return [item.author, item.sent_at ? `Sent on ${formatSentDate(item.sent_at)}` : null].filter(Boolean).join(" · ");
}

function libraryFileType(item: LibraryItem) {
  const path = item.original_path.split(/[?#]/, 1)[0].toLowerCase();
  if (path.endsWith(".epub")) return "epub";
  if (path.endsWith(".xtc") || path.endsWith(".xtch")) return "xtc";
  if (path.endsWith(".txt")) return "txt";
  if (path.endsWith(".bmp")) return "bmp";
  if (path.endsWith(".png")) return "png";
  return null;
}

function librarySortType(item: LibraryItem) {
  return libraryFileType(item) || item.original_path.split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase() || "";
}

function isMountedLibraryItem(item: LibraryItem) {
  return item.source_url?.startsWith("mounted-library://") || item.source_url?.startsWith("desktop-folder://") || false;
}

function canOptimizeLibraryItem(item: LibraryItem) {
  return hasEpubExtension(item.original_path);
}

function canOptimizeBrowseItem(item: BrowseItem) {
  if (item.type === "article") return true;
  return item.media_type?.toLowerCase().includes("application/epub+zip") || hasEpubExtension(item.url) || hasEpubExtension(item.path);
}

function hasEpubExtension(value: string | null | undefined) {
  return (value || "").split(/[?#]/, 1)[0].toLowerCase().endsWith(".epub");
}

function browseItemKey(item: BrowseItem) {
  return [item.type, item.url || item.path || "", item.title].join(":");
}

function mediaUrl(url: string) {
  return API && url.startsWith("/api/") ? `${API}${url}` : url;
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

function getInitialView(): AppView {
  return window.location.hash === "#help" ? "help" : "app";
}

function getInitialOptimizerSettings(): OptimizerSettings {
  const stored = window.localStorage.getItem(optimizerSettingsStorageKey);
  if (!stored) return defaultOptimizerSettings;
  try {
    return normalizeOptimizerSettings(JSON.parse(stored));
  } catch {
    return defaultOptimizerSettings;
  }
}

function normalizeOptimizerSettings(value: unknown): OptimizerSettings {
  if (!value || typeof value !== "object") return defaultOptimizerSettings;
  const stored = value as Partial<OptimizerSettings>;
  return {
    quality: clampNumber(Number(stored.quality ?? defaultOptimizerSettings.quality), 1, 100),
    grayscale: booleanOrDefault(stored.grayscale, defaultOptimizerSettings.grayscale),
    contrast_boost: booleanOrDefault(stored.contrast_boost, defaultOptimizerSettings.contrast_boost),
    contrast_factor: clampNumber(Number(stored.contrast_factor ?? defaultOptimizerSettings.contrast_factor), 0.5, 3),
    eink_quantize: booleanOrDefault(stored.eink_quantize, defaultOptimizerSettings.eink_quantize),
    light_novel: booleanOrDefault(stored.light_novel, defaultOptimizerSettings.light_novel),
    remove_fonts: booleanOrDefault(stored.remove_fonts, defaultOptimizerSettings.remove_fonts),
    remove_css: booleanOrDefault(stored.remove_css, defaultOptimizerSettings.remove_css),
    text_cleanup: booleanOrDefault(stored.text_cleanup, defaultOptimizerSettings.text_cleanup)
  };
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function getInitialLocalSourceIndex() {
  const stored = Number(window.localStorage.getItem(localSourceIndexStorageKey));
  return Number.isFinite(stored) && stored >= 0 ? Math.floor(stored) : 0;
}

function clampLocalSourceIndex(index: number, remoteSourceCount: number) {
  return Math.max(0, Math.min(index, remoteSourceCount));
}

function insertLocalSource(sources: Source[], localSourceIndex: number) {
  const nextSources = [...sources];
  nextSources.splice(clampLocalSourceIndex(localSourceIndex, sources.length), 0, localSource);
  return nextSources;
}

function iconForItem(item: BrowseItem) {
  if (item.type === "article") return <Rss size={16} />;
  if (item.type === "directory" || item.type === "navigation") return <Folder size={16} />;
  return <BookOpen size={16} />;
}

function sortBrowseItems(items: BrowseItem[], sortMode: SortMode) {
  if (sortMode === "source" || sortMode === "type") return items;
  return [...items].sort((left, right) => compareTitles(left.title, right.title, sortMode));
}

function sortLibraryItems(items: LibraryItem[], sortMode: SortMode) {
  if (sortMode === "source") return items;
  if (sortMode === "type") {
    return [...items].sort((left, right) => {
      const typeResult = librarySortType(left).localeCompare(librarySortType(right), undefined, { numeric: true, sensitivity: "base" });
      return typeResult || compareTitles(left.title, right.title, "title_asc");
    });
  }
  return [...items].sort((left, right) => compareTitles(left.title, right.title, sortMode));
}

function compareTitles(left: string, right: string, sortMode: SortMode) {
  const result = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  return sortMode === "title_desc" ? -result : result;
}

function sortLabelForMode(sortMode: SortMode) {
  if (sortMode === "type") return "Type";
  if (sortMode === "title_asc") return "Title A-Z";
  if (sortMode === "title_desc") return "Title Z-A";
  return "Source order";
}

function sourceTypeLabel(type: RemoteSourceType) {
  if (type === "local_folder") return "Local Folder";
  return type.toUpperCase();
}

function sourceTypeShortLabel(type: SourceType) {
  if (type === "local_folder") return "Folder";
  return type;
}

function folderNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || "Local Folder";
}

function moveSource(sources: Source[], draggedSourceId: number, targetSourceId: number, insertAfter: boolean) {
  const draggedSource = sources.find((source) => source.id === draggedSourceId);
  if (!draggedSource) return sources;

  const nextSources = sources.filter((source) => source.id !== draggedSourceId);
  const targetIndex = nextSources.findIndex((source) => source.id === targetSourceId);
  if (targetIndex < 0) return sources;

  nextSources.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedSource);
  return nextSources;
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
  const authHeader = window.sessionStorage.getItem(authStorageKey);
  if (authHeader) headers.set("Authorization", authHeader);
  const response = await fetch(`${API}${path}`, { ...init, headers });
  if (response.status === 401) {
    window.sessionStorage.removeItem(authStorageKey);
  }
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

async function publicApi<T = unknown>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}
