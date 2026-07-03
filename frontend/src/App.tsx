import {
  BookOpen,
  CircleHelp,
  Download,
  Folder,
  Home,
  LogIn,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  Rss,
  Save,
  Server,
  SlidersHorizontal,
  TabletSmartphone,
  Sun,
  Usb,
  Wifi,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent, KeyboardEvent } from "react";
import { optimizeEpubInBrowser } from "./browserEpubOptimizer";
import { probeStandaloneDevice, sendBlobToDevice } from "./deviceTransfer";
import { HelpPage } from "./HelpPage";
import { probeSerialDevice, sendBlobToSerialDevice, serialTransferSupported } from "./serialTransfer";
import {
  addStandaloneFile,
  deleteStandaloneFile,
  getStandaloneFile,
  loadStandaloneLibrary,
  markStandaloneFileSent
} from "./standaloneLibrary";
import {
  apiBaseUrlStorageKey,
  authStorageKey,
  defaultOptimizerSettings,
  deviceStorageKey,
  emptySourceForm,
  localSource,
  localSourceId,
  localSourceIndexStorageKey,
  optimizerSettingsStorageKey,
  sortModeBySourceStorageKey,
  sourceTypes,
  themeStorageKey,
  transferModeStorageKey
} from "./appConstants";
import type {
  AppView,
  BrowseItem,
  BrowseResult,
  ClientLogLevel,
  DeviceTarget,
  FloatingTooltipPosition,
  InkyAppMode,
  Job,
  LibraryItem,
  OptimizerSettings,
  PendingBrowseAction,
  PreparedDictionaryDownload,
  RecentOptimizedDownload,
  RemoteSourceType,
  SortMode,
  Source,
  SourceForm,
  SourceType,
  Theme,
  ToastState,
  TransferMode
} from "./appTypes";
import {
  browseItemKey,
  canOptimizeBrowseItem,
  canOptimizeLibraryItem,
  clampLocalSourceIndex,
  clampNumber,
  downloadBlob,
  filenameFromContentDisposition,
  folderNameFromPath,
  hasEpubExtension,
  insertLocalSource,
  libraryItemFilename,
  messageFromUnknown,
  moveSource,
  normalizeApiBaseUrl,
  normalizeAppMode,
  normalizeOptimizerSettings,
  normalizeSortModeForSource,
  optimizedDeviceFilename,
  preparedDictionaryDownloadFromJob,
  readableError,
  readableDeviceError,
  safeDownloadStem,
  sortBrowseItems,
  sortLabelForMode,
  sortLibraryItems,
  sourceTypeLabel,
  sourceTypeShortLabel,
  standaloneRecordToLibraryItem
} from "./appUtils";
import { BrowsePanel } from "./components/BrowsePanel";
import { JobLog } from "./components/JobLog";
import { OptimizerSettingsModal } from "./components/OptimizerSettingsModal";
import { SourcePanel } from "./components/SourcePanel";

declare global {
  interface Window {
    inkyDesktop?: {
      apiBaseUrl?: string;
      selectLibraryFolder?: () => Promise<string | null>;
    };
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}

const bundledApiBaseUrl = window.inkyDesktop?.apiBaseUrl || import.meta.env.VITE_API_BASE_URL || "";

const appMode = normalizeAppMode(import.meta.env.VITE_INKY_APP_MODE);
const isHostedApp = appMode === "hosted";
const isPublicApp = appMode === "public";
const usesBrowserLibraryByDefault = isPublicApp || import.meta.env.VITE_INKY_LIBRARY_MODE === "browser";
const isPublicReadOnly = isPublicApp || import.meta.env.VITE_INKY_PUBLIC_READ_ONLY === "1";
const dictionaryToolsEnabled = import.meta.env.VITE_INKY_DICTIONARY_TOOLS === "1";
const isDesktopApp = Boolean(window.inkyDesktop?.selectLibraryFolder);
const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
const isIosApp = window.Capacitor?.getPlatform?.() === "ios";
const iosServerSettingsEnabled = isIosApp && import.meta.env.VITE_INKY_IOS_SERVER_SETTINGS === "1";
const canConfigureApiBaseUrl = !window.inkyDesktop?.apiBaseUrl && iosServerSettingsEnabled;
const initialStandaloneMode = (isNativeApp || isHostedApp) && !getInitialApiBaseUrl();
const isSelfHostedBrowser = !isDesktopApp && !isNativeApp && !isHostedApp;
const canUseWifiTransfer = !isHostedApp && !isPublicReadOnly;
const browsePageSize = 25;
const defaultDeviceHost = isSelfHostedBrowser ? "" : "crosspoint.local";
const deviceHostPlaceholder = isSelfHostedBrowser ? "192.168." : "crosspoint.local";
export default function App() {
  const libraryLoadSeq = useRef(0);
  const browseLoadSeq = useRef(0);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const stablePageTooltipButtonRef = useRef<HTMLButtonElement | null>(null);
  const sectionSplitTooltipButtonRef = useRef<HTMLButtonElement | null>(null);
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
  const [recentOptimizedDownload, setRecentOptimizedDownload] = useState<RecentOptimizedDownload | null>(null);
  const [recentPreparedDictionaryDownload, setRecentPreparedDictionaryDownload] =
    useState<PreparedDictionaryDownload | null>(null);
  const [optimizingLibraryItemId, setOptimizingLibraryItemId] = useState<number | null>(null);
  const [form, setForm] = useState<SourceForm>(emptySourceForm);
  const [deviceUrl, setDeviceUrl] = useState(defaultDeviceHost);
  const [destinationPath, setDestinationPath] = useState("/");
  const [device, setDevice] = useState<DeviceTarget>(() => getInitialDevice());
  const [transferMode, setTransferMode] = useState<TransferMode>(() => getInitialTransferMode());
  const [optimizerSettings, setOptimizerSettings] = useState<OptimizerSettings>(() => getInitialOptimizerSettings());
  const [qualityDraft, setQualityDraft] = useState(() => String(optimizerSettings.quality));
  const [contrastFactorDraft, setContrastFactorDraft] = useState(() => String(optimizerSettings.contrast_factor));
  const [sectionSplitThresholdDraft, setSectionSplitThresholdDraft] = useState(() =>
    String(optimizerSettings.section_split_word_threshold ?? defaultOptimizerSettings.section_split_word_threshold)
  );
  const [referencePageWordsDraft, setReferencePageWordsDraft] = useState(() =>
    String(optimizerSettings.words_per_reference_page)
  );
  const [apiBaseUrlDraft, setApiBaseUrlDraft] = useState(() => getInitialApiBaseUrl());
  const [standaloneMode, setStandaloneMode] = useState(initialStandaloneMode);
  const usesBrowserLibrary = standaloneMode || usesBrowserLibraryByDefault;
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [localSourceIndex, setLocalSourceIndex] = useState(() => getInitialLocalSourceIndex());
  const [busy, setBusy] = useState(false);
  const [pendingBrowseAction, setPendingBrowseAction] = useState<PendingBrowseAction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rescanningLibrary, setRescanningLibrary] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState("");
  const [apiConnectionError, setApiConnectionError] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [deviceStatus, setDeviceStatus] = useState("");
  const [testingDevice, setTestingDevice] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [optimizerModalOpen, setOptimizerModalOpen] = useState(false);
  const [dictionaryModalOpen, setDictionaryModalOpen] = useState(false);
  const [dictionaryZipFile, setDictionaryZipFile] = useState<File | null>(null);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [stablePageTooltipPosition, setStablePageTooltipPosition] = useState<FloatingTooltipPosition | null>(null);
  const [sectionSplitTooltipPosition, setSectionSplitTooltipPosition] = useState<FloatingTooltipPosition | null>(null);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [draggedSourceId, setDraggedSourceId] = useState<number | null>(null);
  const [dragOverSourceId, setDragOverSourceId] = useState<number | null>(null);
  const [localFileDragOver, setLocalFileDragOver] = useState(false);
  const [sourceMenuId, setSourceMenuId] = useState<number | null>(null);
  const allSources = useMemo(() => insertLocalSource(sources, localSourceIndex), [sources, localSourceIndex]);
  const selectedSource = allSources.find((source) => source.id === selectedSourceId) || null;
  const isLocalSource = selectedSourceId === localSourceId;
  const deviceLabel = device.toUpperCase();
  const resolvedDeviceUrl = resolveDeviceHostInput(deviceUrl);
  const trimmedSearchQuery = searchQuery.trim();
  const activeBrowseResult = searchResult || browseResult;
  const showBrowseLoading = !isLocalSource && (browseLoading || searching);
  function tooltipPositionForButton(button: HTMLButtonElement | null) {
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const gutter = 12;
    const width = Math.min(340, window.innerWidth - gutter * 2);
    const estimatedHeight = 132;
    const left = Math.min(Math.max(gutter, rect.right - width), window.innerWidth - width - gutter);
    const preferredTop = rect.top - estimatedHeight - 8;
    const top =
      preferredTop >= gutter ? preferredTop : Math.min(rect.bottom + 8, window.innerHeight - estimatedHeight - gutter);
    return { top: Math.max(gutter, top), left };
  }

  function updateStablePageTooltipPosition() {
    const position = tooltipPositionForButton(stablePageTooltipButtonRef.current);
    if (position) setStablePageTooltipPosition(position);
  }

  function updateSectionSplitTooltipPosition() {
    const position = tooltipPositionForButton(sectionSplitTooltipButtonRef.current);
    if (position) setSectionSplitTooltipPosition(position);
  }

  function showStablePageTooltip() {
    updateStablePageTooltipPosition();
  }

  function hideStablePageTooltip() {
    setStablePageTooltipPosition(null);
  }

  function showSectionSplitTooltip() {
    updateSectionSplitTooltipPosition();
  }

  function hideSectionSplitTooltip() {
    setSectionSplitTooltipPosition(null);
  }

  const displayedLibrary = useMemo(() => {
    if (!trimmedSearchQuery) return library;
    const needle = trimmedSearchQuery.toLocaleLowerCase();
    return library.filter((item) =>
      [item.title, item.author, item.source_url, item.original_path].some((value) =>
        value?.toLocaleLowerCase().includes(needle)
      )
    );
  }, [library, trimmedSearchQuery]);
  const remoteItems = activeBrowseResult?.items || [];
  const activeSortMode = !isLocalSource && (sortMode === "type" || sortMode === "date_added") ? "source" : sortMode;
  const sortOptions: SortMode[] = isLocalSource
    ? ["source", "date_added", "type", "title_asc", "title_desc"]
    : ["source", "title_asc", "title_desc"];
  const availableSourceTypes = useMemo(() => sourceTypes.filter((type) => type !== "local_folder" || isDesktopApp), []);
  const sortedLibrary = useMemo(() => sortLibraryItems(displayedLibrary, sortMode), [displayedLibrary, sortMode]);
  const sortedRemoteItems = useMemo(() => sortBrowseItems(remoteItems, activeSortMode), [remoteItems, activeSortMode]);
  const displayedItems = isLocalSource ? sortedLibrary : sortedRemoteItems;
  const totalPages = Math.max(1, Math.ceil(displayedItems.length / browsePageSize));
  const clampedBrowsePage = Math.min(browsePage, totalPages);
  const paginatedLibrary = sortedLibrary.slice(
    (clampedBrowsePage - 1) * browsePageSize,
    clampedBrowsePage * browsePageSize
  );
  const paginatedRemoteItems = sortedRemoteItems.slice(
    (clampedBrowsePage - 1) * browsePageSize,
    clampedBrowsePage * browsePageSize
  );
  const hasRemotePagination =
    !isLocalSource && Boolean(activeBrowseResult?.previous_url || activeBrowseResult?.next_url);
  const showPagination = displayedItems.length > browsePageSize || hasRemotePagination;
  const paginationLabel = hasRemotePagination
    ? totalPages > 1
      ? `Catalog Page ${remotePage} · results page ${clampedBrowsePage} of ${totalPages}`
      : `Catalog Page ${remotePage}`
    : `Page ${clampedBrowsePage} of ${totalPages}`;
  const sortLabel = sortLabelForMode(activeSortMode);
  const canPrepareDictionaries = dictionaryToolsEnabled && !standaloneMode && !isHostedApp;
  const effectiveEinkQuantize = optimizerSettings.grayscale && optimizerSettings.eink_quantize;

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) return;

    refreshAll(false);
    if (usesBrowserLibrary) return;
    const interval = window.setInterval(() => {
      loadLibrary();
    }, 2500);
    return () => window.clearInterval(interval);
  }, [authChecked, isAuthenticated, usesBrowserLibrary]);

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
        } else if (job.type === "dictionary_prepare") {
          const download = preparedDictionaryDownloadFromJob(job);
          if (download) setRecentPreparedDictionaryDownload(download);
          showToast("Prepared dictionary ready to download");
        }
        await loadLibrary();
      }
    };

    const interval = window.setInterval(pollJob, 1500);
    return () => window.clearInterval(interval);
  }, [activeJobId]);

  useEffect(() => {
    browseLoadSeq.current += 1;
    setSortMode(getStoredSortModeForSource(selectedSourceId));
    setSortMenuOpen(false);
    clearSearch();
    if (selectedSourceId === localSourceId) {
      setBrowseStack([null]);
      setBrowseResult(null);
      setBrowseLoading(false);
    } else if (selectedSourceId) {
      setBrowseStack([null]);
      browse(selectedSourceId, null);
    } else {
      setBrowseResult(null);
      setBrowseLoading(false);
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
    window.localStorage.setItem(deviceStorageKey, device);
  }, [device]);

  useEffect(() => {
    window.localStorage.setItem(transferModeStorageKey, transferMode);
  }, [transferMode]);

  useEffect(() => {
    if (!optimizerModalOpen) {
      hideStablePageTooltip();
      hideSectionSplitTooltip();
    }
  }, [optimizerModalOpen]);

  useEffect(() => {
    if (!stablePageTooltipPosition) return;
    window.addEventListener("resize", updateStablePageTooltipPosition);
    window.addEventListener("scroll", updateStablePageTooltipPosition, true);
    return () => {
      window.removeEventListener("resize", updateStablePageTooltipPosition);
      window.removeEventListener("scroll", updateStablePageTooltipPosition, true);
    };
  }, [stablePageTooltipPosition]);

  useEffect(() => {
    if (!sectionSplitTooltipPosition) return;
    window.addEventListener("resize", updateSectionSplitTooltipPosition);
    window.addEventListener("scroll", updateSectionSplitTooltipPosition, true);
    return () => {
      window.removeEventListener("resize", updateSectionSplitTooltipPosition);
      window.removeEventListener("scroll", updateSectionSplitTooltipPosition, true);
    };
  }, [sectionSplitTooltipPosition]);

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

  async function checkAuth(forceStandaloneMode = standaloneMode) {
    if (forceStandaloneMode) {
      setApiConnectionError("");
      setAuthEnabled(false);
      setIsAuthenticated(true);
      setAuthChecked(true);
      return true;
    }

    setApiConnectionError("");
    try {
      const status = await publicApi<{ enabled: boolean }>("/api/auth/status");
      setApiBaseUrlDraft(getApiBaseUrl());
      setAuthEnabled(status.enabled);
      if (!status.enabled) {
        setIsAuthenticated(true);
        return true;
      }

      if (!window.sessionStorage.getItem(authStorageKey)) {
        setIsAuthenticated(false);
        return true;
      }

      try {
        await api("/api/auth/login");
        setIsAuthenticated(true);
        return true;
      } catch {
        window.sessionStorage.removeItem(authStorageKey);
        setIsAuthenticated(false);
        return true;
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setApiConnectionError(message);
      setIsAuthenticated(false);
      return false;
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

  async function saveServerSettings(event: FormEvent) {
    event.preventDefault();
    const nextApiBaseUrl = persistApiBaseUrl(apiBaseUrlDraft);
    setApiBaseUrlDraft(nextApiBaseUrl);
    const nextStandaloneMode = isNativeApp && !nextApiBaseUrl;
    setStandaloneMode(nextStandaloneMode);
    if (nextStandaloneMode) {
      setSources([]);
      setSelectedSourceId(localSourceId);
      setBrowseResult(null);
      setSearchResult(null);
      setJobs([]);
      setActiveJobId(null);
    }
    setAuthChecked(false);
    const connected = await checkAuth(nextStandaloneMode);
    if (connected) {
      setServerModalOpen(false);
      await refreshAll(false);
      showToast("Server updated");
    }
  }

  function openServerSettings() {
    setApiBaseUrlDraft(getApiBaseUrl());
    setServerModalOpen(true);
  }

  async function refreshAll(showFeedback = true) {
    setRefreshing(true);
    try {
      const refreshed = await runAction(async () => {
        if (standaloneMode) {
          await loadLibrary();
          return;
        }

        await Promise.all([
          loadSources(),
          loadLibrary(),
          activeJobId ? loadVisibleJob(activeJobId) : Promise.resolve()
        ]);

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
    if (standaloneMode) {
      setSources([]);
      if (!selectedSourceId) setSelectedSourceId(localSourceId);
      return;
    }

    const data = await api<Source[]>("/api/sources");
    setSources(data);
    if (!selectedSourceId) setSelectedSourceId(localSourceId);
  }

  async function loadLibrary() {
    const loadSeq = ++libraryLoadSeq.current;
    if (usesBrowserLibrary) {
      const data = (await loadStandaloneLibrary()).map(standaloneRecordToLibraryItem);
      if (loadSeq === libraryLoadSeq.current) setLibrary(data);
      return;
    }

    const data = await api<LibraryItem[]>("/api/library");
    if (loadSeq === libraryLoadSeq.current) setLibrary(data);
  }

  async function rescanLibrary() {
    if (usesBrowserLibrary) return;
    const loadSeq = ++libraryLoadSeq.current;
    setRescanningLibrary(true);
    try {
      const refreshed = await runAction(
        async () => {
          const data = await api<LibraryItem[]>("/api/library/rescan", { method: "POST" });
          if (loadSeq === libraryLoadSeq.current) setLibrary(data);
        },
        { toastOnError: true }
      );
      if (refreshed !== undefined) showToast("Library rescan complete");
    } finally {
      setRescanningLibrary(false);
    }
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
    const loadSeq = ++browseLoadSeq.current;
    if (sourceId === localSourceId) {
      setBrowseResult(null);
      setBrowseLoading(false);
      return;
    }
    const query = target ? `?target=${encodeURIComponent(target)}` : "";
    setBrowseLoading(true);
    setBrowseResult(null);
    setSearchResult(null);
    await runAction(async () => {
      const result = await api<BrowseResult>(`/api/sources/${sourceId}/browse${query}`);
      if (loadSeq !== browseLoadSeq.current) return;
      setBrowseResult(result);
      setBrowsePage(1);
      setRemotePage(1);
    });
    if (loadSeq === browseLoadSeq.current) setBrowseLoading(false);
  }

  function openAddSourceModal() {
    if (isPublicReadOnly) return;
    setSourceMenuId(null);
    setEditingSource(null);
    setForm(emptySourceForm);
    setSourceModalOpen(true);
  }

  function openEditSource(source: Source) {
    if (isPublicReadOnly) return;
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
    if (isPublicReadOnly) return;
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
    if (isPublicReadOnly) return;
    if (sourceId === localSourceId) return;
    setSourceMenuId(null);
    await runAction(async () => {
      await api(`/api/sources/${sourceId}`, { method: "DELETE" });
      setSelectedSourceId(localSourceId);
      await loadSources();
    });
  }

  async function reorderSources(nextAllSources: Source[]) {
    if (isPublicReadOnly) return;
    const previousSources = sources;
    const previousLocalSourceIndex = localSourceIndex;
    const nextSources = nextAllSources.filter((source) => source.id !== localSourceId);
    const nextLocalSourceIndex = Math.max(
      0,
      nextAllSources.findIndex((source) => source.id === localSourceId)
    );
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
      const loadSeq = ++browseLoadSeq.current;
      setSearchResult(null);
      await runAction(async () => {
        const result = await api<BrowseResult>(`/api/sources/${selectedSourceId}/search?${params.toString()}`);
        if (loadSeq !== browseLoadSeq.current) return;
        setSearchResult(result);
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
    const nextSortMode = normalizeSortModeForSource(value, selectedSourceId);
    setSortMode(nextSortMode);
    saveSortModeForSource(selectedSourceId, nextSortMode);
    setBrowsePage(1);
    setSortMenuOpen(false);
  }

  function updateOptimizerSetting<K extends keyof OptimizerSettings>(key: K, value: OptimizerSettings[K]) {
    setOptimizerSettings((current) => ({ ...current, [key]: value }));
  }

  function updateQualityFromSlider(value: string) {
    const nextValue = clampNumber(Number(value), 1, 100);
    updateOptimizerSetting("quality", nextValue);
    setQualityDraft(String(nextValue));
  }

  function updateQualityDraft(value: string) {
    setQualityDraft(value);
    commitOptimizerNumberDraft("quality", value, 1, 100, setQualityDraft);
  }

  function commitQualityDraft() {
    commitOptimizerNumberDraft("quality", qualityDraft, 1, 100, setQualityDraft, true);
  }

  function updateContrastFactorFromSlider(value: string) {
    const nextValue = clampNumber(Number(value), 0.5, 3);
    updateOptimizerSetting("contrast_factor", nextValue);
    setContrastFactorDraft(String(nextValue));
  }

  function updateContrastFactorDraft(value: string) {
    setContrastFactorDraft(value);
    commitOptimizerNumberDraft("contrast_factor", value, 0.5, 3, setContrastFactorDraft);
  }

  function commitContrastFactorDraft() {
    commitOptimizerNumberDraft("contrast_factor", contrastFactorDraft, 0.5, 3, setContrastFactorDraft, true);
  }

  function updateSectionSplitThresholdDraft(value: string) {
    setSectionSplitThresholdDraft(value);
    commitOptimizerNumberDraft("section_split_word_threshold", value, 1, 10000, setSectionSplitThresholdDraft);
  }

  function commitSectionSplitThresholdDraft() {
    commitOptimizerNumberDraft(
      "section_split_word_threshold",
      sectionSplitThresholdDraft,
      1,
      10000,
      setSectionSplitThresholdDraft,
      true
    );
  }

  function updateReferencePageWordsDraft(value: string) {
    setReferencePageWordsDraft(value);
    commitOptimizerNumberDraft("words_per_reference_page", value, 1, 10000, setReferencePageWordsDraft);
  }

  function commitReferencePageWordsDraft() {
    commitOptimizerNumberDraft(
      "words_per_reference_page",
      referencePageWordsDraft,
      1,
      10000,
      setReferencePageWordsDraft,
      true
    );
  }

  function commitOptimizerNumberDraft<
    K extends "quality" | "contrast_factor" | "section_split_word_threshold" | "words_per_reference_page"
  >(key: K, draft: string, min: number, max: number, setDraft: (value: string) => void, force = false) {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === "." || trimmed.endsWith(".")) {
      if (force) setDraft(String(optimizerSettings[key] ?? defaultOptimizerSettings[key]));
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      if (force) setDraft(String(optimizerSettings[key] ?? defaultOptimizerSettings[key]));
      return;
    }

    const nextValue = clampNumber(parsed, min, max);
    updateOptimizerSetting(key, nextValue);
    if (force || String(nextValue) !== trimmed) setDraft(String(nextValue));
  }

  function resetOptimizerSettings() {
    setOptimizerSettings(defaultOptimizerSettings);
    setQualityDraft(String(defaultOptimizerSettings.quality));
    setContrastFactorDraft(String(defaultOptimizerSettings.contrast_factor));
    setSectionSplitThresholdDraft(String(defaultOptimizerSettings.section_split_word_threshold));
    setReferencePageWordsDraft(String(defaultOptimizerSettings.words_per_reference_page));
  }

  function swapFilenameRenderFields() {
    setOptimizerSettings((current) => ({
      ...current,
      filename_render_first: current.filename_render_second,
      filename_render_second: current.filename_render_first
    }));
  }

  function showToast(message: string, tone: ToastState["tone"] = "success") {
    setToast({ message, tone });
  }

  async function openResultPage(target: string | null | undefined, direction: "next" | "previous") {
    if (!target || !selectedSourceId || isLocalSource) return;
    const loadSeq = ++browseLoadSeq.current;
    setBrowseLoading(true);
    setBrowseResult(null);
    setSearchResult(null);
    await runAction(async () => {
      const result = await api<BrowseResult>(
        `/api/sources/${selectedSourceId}/browse?target=${encodeURIComponent(target)}`
      );
      if (loadSeq !== browseLoadSeq.current) return;
      if (searchResult) {
        setSearchResult(result);
      } else {
        setBrowseResult(result);
      }
      setBrowsePage(1);
      setRemotePage((page) => (direction === "next" ? page + 1 : Math.max(1, page - 1)));
    });
    if (loadSeq === browseLoadSeq.current) setBrowseLoading(false);
  }

  async function importItem(item: BrowseItem) {
    if (!selectedSourceId || selectedSourceId === localSourceId) return;
    if (usesBrowserLibrary) {
      showToast(
        "Public mode keeps Local Library in this browser. Add local files from the Local Library panel.",
        "error"
      );
      return;
    }
    setPendingBrowseAction({ key: browseItemKey(item), action: "save" });
    setBusy(true);
    try {
      await runAction(
        async () => {
          const imported = await importBrowseItem(item);
          if (!imported) return;
          showToast("Saved to Local Library");
          await loadLibrary();
        },
        { toastOnError: true }
      );
    } finally {
      setPendingBrowseAction(null);
      setBusy(false);
    }
  }

  async function sendBrowseItem(item: BrowseItem) {
    if (!selectedSourceId || selectedSourceId === localSourceId) return;
    if (usesBrowserLibrary) {
      showToast("Public mode can send files added to this browser's Local Library.", "error");
      return;
    }
    setPendingBrowseAction({ key: browseItemKey(item), action: "send" });
    setBusy(true);
    try {
      await runAction(
        async () => {
          if (transferMode === "usb") {
            const imported = await importBrowseItem(item);
            if (!imported) return;
            await sendLibraryItemViaUsb(imported);
            await loadLibrary();
            return;
          }

          if (selectedSource?.type === "local_folder" && item.path) {
            const job = await api<Job>(`/api/sources/${selectedSourceId}/send-local-file`, {
              method: "POST",
              body: JSON.stringify({
                ...defaultOptimizePayload(),
                path: item.path,
                device_url: resolvedDeviceUrl,
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
              device_url: resolvedDeviceUrl,
              destination_path: destinationPath,
              optimize_first: true
            })
          });
          trackJob(job);
          showToast("Send queued");
          await loadLibrary();
        },
        { toastOnError: true }
      );
    } finally {
      setPendingBrowseAction(null);
      setBusy(false);
    }
  }

  async function optimizeBrowseItem(item: BrowseItem) {
    if (!selectedSourceId || selectedSourceId === localSourceId || !canOptimizeBrowseItem(item)) return;
    setPendingBrowseAction({ key: browseItemKey(item), action: "optimize" });
    setBusy(true);
    try {
      await runAction(
        async () => {
          setRecentOptimizedDownload(null);
          const response = await apiFetch(`/api/sources/${selectedSourceId}/optimize-epub`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              item,
              settings: defaultOptimizePayload()
            })
          });
          const blob = await response.blob();
          const filename =
            filenameFromContentDisposition(response.headers.get("content-disposition")) ||
            `${safeDownloadStem(item.title || "optimized")}.epub`;
          setRecentOptimizedDownload({ blob, filename });
          showToast("Optimized EPUB ready to download");
        },
        { toastOnError: true }
      );
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
        body: JSON.stringify({
          source_id: selectedSourceId,
          path: item.path,
          title: item.title,
          cover_url: item.image_url
        })
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

  async function uploadLocalFiles(files: FileList | File[] | null) {
    const selectedFiles = Array.from(files || []);
    if (selectedFiles.length === 0) return;
    await runAction(async () => {
      if (usesBrowserLibrary) {
        for (const file of selectedFiles) {
          await addStandaloneFile(file);
        }
        showToast(`${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"} saved`);
        await loadLibrary();
        return;
      }

      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append("file", file);
        await api("/api/library/upload", { method: "POST", body: formData, rawBody: true });
      }
      showToast(`${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"} uploaded`);
      await loadLibrary();
    });
  }

  function openLocalFilePicker() {
    if (!isLocalSource) return;
    localFileInputRef.current?.click();
  }

  function keyOpenLocalFilePicker(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openLocalFilePicker();
  }

  function dragHasFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function dragLocalFiles(event: DragEvent<HTMLElement>) {
    if (!isLocalSource || !dragHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setLocalFileDragOver(true);
  }

  function leaveLocalFiles(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setLocalFileDragOver(false);
    }
  }

  async function dropLocalFiles(event: DragEvent<HTMLElement>) {
    if (!isLocalSource) return;
    event.preventDefault();
    setLocalFileDragOver(false);
    await uploadLocalFiles(event.dataTransfer.files);
  }

  async function removeLocalItem(item: LibraryItem) {
    const confirmed = window.confirm(`Remove "${item.title}" from the local library?`);
    if (!confirmed) return;
    await runAction(async () => {
      if (usesBrowserLibrary) {
        await deleteStandaloneFile(item.id);
        showToast("Removed");
        await loadLibrary();
        return;
      }

      await api(`/api/library/${item.id}`, { method: "DELETE" });
      showToast("Removed");
      await loadLibrary();
    });
  }

  async function optimizeLibraryItem(item: LibraryItem) {
    if (!canOptimizeLibraryItem(item)) return;
    setOptimizingLibraryItemId(item.id);
    try {
      await runAction(
        async () => {
          if (usesBrowserLibrary) {
            const { record, blob } = await getStandaloneFile(item.id);
            await prepareStandaloneBlobForSend(blob, record.filename, item.id);
            showToast("Optimized EPUB ready to download");
            return;
          }

          setRecentOptimizedDownload(null);
          const job = await api<Job>(`/api/library/${item.id}/optimize`, {
            method: "POST",
            body: JSON.stringify(defaultOptimizePayload())
          });
          const completedJob = await waitForJobCompletion(job);
          const { blob, filename } = await downloadLibraryItemFile(item);
          setRecentOptimizedDownload({
            blob,
            filename: optimizedDeviceFilename(completedJob) || filename || libraryItemFilename(item)
          });
          showToast("Optimized EPUB ready to download");
        },
        { toastOnError: true }
      );
    } finally {
      setOptimizingLibraryItemId(null);
    }
  }

  async function sendToDevice(item: LibraryItem) {
    await runAction(async () => {
      if (transferMode === "usb") {
        if (usesBrowserLibrary) {
          const { record, blob } = await getStandaloneFile(item.id);
          const prepared = await prepareStandaloneBlobForSend(blob, record.filename, item.id);
          await sendBlobViaUsb(prepared.blob, prepared.filename, item.id);
          await markStandaloneFileSent(item.id);
          showToast("Sent to device");
          await loadLibrary();
          return;
        }

        await sendLibraryItemViaUsb(item);
        showToast("Sent to device");
        await loadLibrary();
        return;
      }

      if (usesBrowserLibrary) {
        const { record, blob } = await getStandaloneFile(item.id);
        const prepared = await prepareStandaloneBlobForSend(blob, record.filename, item.id);
        const jobId = crypto.randomUUID();
        const transferLog = createTransferLogger("wifi", prepared.filename);
        updateBrowserSendJob(jobId, item.id, 0, "Preparing upload", "running");
        transferLog(0, `Starting Wi-Fi upload to ${destinationPath || "/"}`);
        try {
          await sendBlobToDevice(
            prepared.blob,
            prepared.filename,
            record.mediaType,
            resolvedDeviceUrl,
            destinationPath,
            (progress, message) => {
              updateBrowserSendJob(jobId, item.id, progress, message, "running");
              transferLog(progress, message);
            }
          );
          transferLog(100, "Wi-Fi upload complete");
        } catch (error) {
          transferLog(null, `Wi-Fi upload failed: ${messageFromUnknown(error)}`, "error");
          throw error;
        }
        await markStandaloneFileSent(item.id);
        updateBrowserSendJob(jobId, item.id, 100, "Sent to device", "succeeded");
        showToast("Sent to device");
        await loadLibrary();
        return;
      }

      const job = await api<Job>(`/api/library/${item.id}/send`, {
        method: "POST",
        body: JSON.stringify({
          ...defaultOptimizePayload(),
          device_url: resolvedDeviceUrl,
          destination_path: destinationPath,
          optimize_first: true
        })
      });
      trackJob(job);
      showToast("Send queued");
    });
  }

  async function prepareStandaloneBlobForSend(blob: Blob, filename: string, itemId: number) {
    if (!hasEpubExtension(filename)) return { blob, filename };
    const jobId = crypto.randomUUID();
    setRecentOptimizedDownload(null);
    if (canOptimizeBrowserFileOnServer()) {
      updateBrowserSendJob(jobId, itemId, 0, "Optimizing EPUB on server", "running");
      const result = await optimizeBrowserFileOnServer(blob, filename);
      setRecentOptimizedDownload(result);
      updateBrowserSendJob(jobId, itemId, 100, "EPUB optimized on server", "succeeded");
      return result;
    }

    updateBrowserSendJob(jobId, itemId, 0, "Optimizing EPUB in browser", "running");
    const result = await optimizeEpubInBrowser(blob, filename, device, optimizerSettings, (progress, message) => {
      updateBrowserSendJob(jobId, itemId, progress, message, "running");
    });
    setRecentOptimizedDownload(result);
    updateBrowserSendJob(jobId, itemId, 100, "EPUB optimized in browser", "succeeded");
    return result;
  }

  function canOptimizeBrowserFileOnServer() {
    return usesBrowserLibrary && !standaloneMode && !isHostedApp;
  }

  async function optimizeBrowserFileOnServer(blob: Blob, filename: string) {
    const formData = new FormData();
    formData.append("file", blob, filename);
    formData.append("settings", JSON.stringify(defaultOptimizePayload()));
    const response = await apiFetch("/api/optimizer/epub", {
      method: "POST",
      body: formData
    });
    return {
      blob: await response.blob(),
      filename: filenameFromContentDisposition(response.headers.get("content-disposition")) || filename
    };
  }

  async function sendLibraryItemViaUsb(item: LibraryItem) {
    if (!serialTransferSupported()) {
      throw new Error("USB serial is not available in this browser. Use Chrome, Edge, or the Inky desktop app.");
    }

    if (canOptimizeLibraryItem(item)) {
      setRecentOptimizedDownload(null);
      const job = await api<Job>(`/api/library/${item.id}/optimize`, {
        method: "POST",
        body: JSON.stringify(defaultOptimizePayload())
      });
      const completedJob = await waitForJobCompletion(job);
      const { blob, filename } = await downloadLibraryItemFile(item);
      const optimizedFilename = optimizedDeviceFilename(completedJob) || filename || libraryItemFilename(item);
      setRecentOptimizedDownload({ blob, filename: optimizedFilename });
      await sendBlobViaUsb(blob, optimizedFilename, item.id);
      return;
    }

    const { blob, filename } = await downloadLibraryItemFile(item);
    await sendBlobViaUsb(blob, filename || libraryItemFilename(item), item.id);
  }

  async function sendBlobViaUsb(blob: Blob, filename: string, itemId: number) {
    const jobId = crypto.randomUUID();
    const transferLog = createTransferLogger("usb", filename);
    let lastProgress = 0;
    let lastMessage = "Preparing USB upload";
    updateBrowserSendJob(jobId, itemId, 0, "Preparing USB upload", "running");
    transferLog(0, `Starting USB upload to ${destinationPath || "/"}`);
    try {
      await sendBlobToSerialDevice(
        blob,
        filename,
        destinationPath,
        (progress, message) => {
          lastProgress = progress;
          lastMessage = message;
          updateBrowserSendJob(jobId, itemId, progress, message, "running");
          transferLog(progress, message);
        },
        (message) => transferLog(null, message)
      );
      transferLog(100, "USB upload complete");
    } catch (error) {
      const message = messageFromUnknown(error);
      updateBrowserSendJob(jobId, itemId, lastProgress, message, "failed");
      transferLog(null, `USB upload failed after ${lastMessage}: ${message}`, "error");
      throw error;
    }
    updateBrowserSendJob(jobId, itemId, 100, "Sent to device over USB", "succeeded");
  }

  async function waitForJobCompletion(job: Job) {
    setActiveJobId(null);
    setJobs([job]);

    for (let attempts = 0; attempts < 240; attempts += 1) {
      const current = await loadVisibleJob(job.id);
      if (current.status === "failed") {
        throw new Error(current.error || current.message || "Job failed");
      }
      if (current.status === "succeeded") {
        await loadLibrary();
        return current;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 750));
    }

    throw new Error("Timed out waiting for optimization to finish.");
  }

  async function downloadLibraryItemFile(item: LibraryItem) {
    const response = await apiFetch(`/api/library/${item.id}/download`);
    const blob = await response.blob();
    return {
      blob,
      filename: filenameFromContentDisposition(response.headers.get("content-disposition")) || libraryItemFilename(item)
    };
  }

  function downloadRecentOptimizedFile() {
    if (!recentOptimizedDownload) return;
    downloadBlob(recentOptimizedDownload.blob, recentOptimizedDownload.filename);
  }

  async function prepareDictionaryZip(event: FormEvent) {
    event.preventDefault();
    if (!dictionaryZipFile || !canPrepareDictionaries) return;

    setBusy(true);
    try {
      await runAction(
        async () => {
          setRecentPreparedDictionaryDownload(null);
          const formData = new FormData();
          formData.append("file", dictionaryZipFile, dictionaryZipFile.name);
          const job = await api<Job>("/api/dictionaries/prepare", {
            method: "POST",
            body: formData,
            rawBody: true
          });
          trackJob(job);
          setDictionaryModalOpen(false);
          setDictionaryZipFile(null);
          showToast("Dictionary prep queued");
        },
        { toastOnError: true }
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadPreparedDictionaryFile() {
    if (!recentPreparedDictionaryDownload) return;
    await runAction(
      async () => {
        const response = await apiFetch(recentPreparedDictionaryDownload.downloadUrl);
        const blob = await response.blob();
        const filename =
          filenameFromContentDisposition(response.headers.get("content-disposition")) ||
          recentPreparedDictionaryDownload.filename;
        downloadBlob(blob, filename);
      },
      { toastOnError: true }
    );
  }

  async function probeDevice() {
    setDeviceError("");
    setDeviceStatus("");
    setTestingDevice(true);
    try {
      const status =
        transferMode === "usb"
          ? await probeSerialDevice()
          : usesBrowserLibrary
            ? await probeStandaloneDevice(resolvedDeviceUrl)
            : await api<Record<string, unknown>>("/api/devices/probe", {
                method: "POST",
                body: JSON.stringify({ device_url: resolvedDeviceUrl })
              });
      setDeviceStatus(
        `Successfully connected to: ${status.device || "Device"} at ${transferMode === "usb" ? "USB" : status.ip || resolvedDeviceUrl}`
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setDeviceError(readableDeviceError(message));
    } finally {
      setTestingDevice(false);
    }
  }

  async function runAction<T>(
    action: () => Promise<T>,
    options: { toastOnError?: boolean } = {}
  ): Promise<T | undefined> {
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
      ...optimizerSettings,
      eink_quantize: effectiveEinkQuantize
    };
  }

  function updateBrowserSendJob(
    jobId: string,
    itemId: number,
    progress: number,
    message: string,
    status: Job["status"]
  ) {
    setJobs([
      {
        id: jobId,
        type: "send",
        status,
        progress,
        message,
        item_id: itemId
      }
    ]);
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

  if (apiConnectionError && canConfigureApiBaseUrl) {
    return (
      <main className="app-shell auth-shell">
        <form className="auth-card" onSubmit={saveServerSettings}>
          <span className="brand-logo" aria-hidden="true" />
          <h1>Inky</h1>
          <p>{isNativeApp ? "Connect to your Inky server." : "Connect to the Inky API."}</p>
          <div className="auth-error">{readableError(apiConnectionError)}</div>
          <label className="field">
            <span>{isNativeApp ? "Inky server URL" : "API server URL"}</span>
            <input
              value={apiBaseUrlDraft}
              onChange={(event) => setApiBaseUrlDraft(event.target.value)}
              placeholder="http://192.168.1.25:8000"
              inputMode="url"
              autoCapitalize="none"
            />
          </label>
          <div className="server-actions">
            <button type="button" onClick={() => setApiBaseUrlDraft("")}>
              Clear
            </button>
            <button className="primary" type="submit">
              <Server size={16} />
              Connect
            </button>
          </div>
        </form>
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
          <input
            value={loginUsername}
            onChange={(event) => setLoginUsername(event.target.value)}
            placeholder="Username"
            autoComplete="username"
          />
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
            <span>
              A Cross<span className="serif">I</span>nk Companion App
            </span>
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
            <button
              className="icon-text"
              type="button"
              onClick={() => refreshAll()}
              title="Refresh"
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "spin" : ""} size={15} />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          )}
          {canConfigureApiBaseUrl && (
            <button className="icon-text" type="button" onClick={openServerSettings} title="Server">
              <Server size={16} />
              Server
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
        <HelpPage
          onOpenApp={openApp}
          isDesktopApp={isDesktopApp}
          isSelfHostedBrowser={isSelfHostedBrowser}
          standaloneMode={standaloneMode}
          isHostedApp={isHostedApp}
          isPublicReadOnly={isPublicReadOnly}
        />
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
                  {testingDevice ? (
                    <RefreshCw className="spin" size={15} />
                  ) : transferMode === "usb" ? (
                    <Usb size={15} />
                  ) : (
                    <Wifi size={15} />
                  )}
                  {testingDevice ? "Searching" : "Test Connection"}
                </button>
              </div>
              {deviceError && (
                <div className="empty-state status-state error-state">
                  <span>{readableError(deviceError)}</span>
                  <button
                    className="border-0"
                    type="button"
                    onClick={() => setDeviceError("")}
                    title="Dismiss device error"
                    aria-label="Dismiss device error"
                  >
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
                <span>Transfer method</span>
                {canUseWifiTransfer ? (
                  <div className="segmented transfer-mode-segmented">
                    <button
                      type="button"
                      className={transferMode === "wifi" ? "active" : ""}
                      onClick={() => setTransferMode("wifi")}
                    >
                      <Wifi size={14} />
                      Wi-Fi
                    </button>
                    <button
                      type="button"
                      className={transferMode === "usb" ? "active" : ""}
                      onClick={() => setTransferMode("usb")}
                    >
                      <Usb size={14} />
                      USB
                    </button>
                  </div>
                ) : (
                  <div className="segmented transfer-mode-segmented">
                    <span className="active selected-option">
                      <Usb size={14} />
                      USB
                    </span>
                  </div>
                )}
              </label>
              {canUseWifiTransfer && transferMode === "wifi" && (
                <label className="field">
                  <span>Device host</span>
                  <input
                    value={deviceUrl}
                    onChange={(event) => {
                      setDeviceError("");
                      setDeviceStatus("");
                      setDeviceUrl(event.target.value);
                    }}
                    placeholder={deviceHostPlaceholder}
                  />
                </label>
              )}
              <label className="field">
                <span>Destination folder (created if needed)</span>
                <input
                  value={destinationPath}
                  onChange={(event) => setDestinationPath(event.target.value)}
                  placeholder="/"
                />
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
              <button
                className="icon-text optimizer-settings-button"
                type="button"
                onClick={() => setOptimizerModalOpen(true)}
                title="EPUB Optimizer Settings"
              >
                <SlidersHorizontal size={16} />
                EPUB Optimizer Settings
              </button>
              {canPrepareDictionaries && (
                <button
                  className="icon-text dictionary-tools-button"
                  type="button"
                  onClick={() => setDictionaryModalOpen(true)}
                  title="Dictionary Tools"
                >
                  <BookOpen size={16} />
                  Dictionary Tools
                </button>
              )}
              {recentOptimizedDownload && (
                <button
                  className="icon-text recent-download-button"
                  type="button"
                  onClick={downloadRecentOptimizedFile}
                  title={`Download ${recentOptimizedDownload.filename}`}
                >
                  <Download size={16} />
                  Download Optimized EPUB
                </button>
              )}
              {recentPreparedDictionaryDownload && (
                <button
                  className="icon-text recent-download-button"
                  type="button"
                  onClick={downloadPreparedDictionaryFile}
                  title={`Download ${recentPreparedDictionaryDownload.filename}`}
                >
                  <Download size={16} />
                  Download Prepared Dictionary
                </button>
              )}
              <JobLog jobs={jobs} />
            </section>

            <SourcePanel
              allSources={allSources}
              selectedSourceId={selectedSourceId}
              draggedSourceId={draggedSourceId}
              dragOverSourceId={dragOverSourceId}
              sourceMenuId={sourceMenuId}
              standaloneMode={standaloneMode}
              isPublicReadOnly={isPublicReadOnly}
              isDesktopApp={isDesktopApp}
              onOpenAddSourceModal={openAddSourceModal}
              onSelectSource={setSelectedSourceId}
              onSetSourceMenuId={setSourceMenuId}
              onSetDraggedSourceId={setDraggedSourceId}
              onSetDragOverSourceId={setDragOverSourceId}
              onDropSource={dropSource}
              onOpenEditSource={openEditSource}
              onMoveSourceByOffset={moveSourceByOffset}
              onDeleteSource={deleteSource}
            />
          </aside>

          <BrowsePanel
            sourceIcon={sourceIcon}
            isLocalSource={isLocalSource}
            selectedSource={selectedSource}
            activeBrowseResult={activeBrowseResult}
            browseResult={browseResult}
            browseStackLength={browseStack.length}
            usesBrowserLibrary={usesBrowserLibrary}
            isHostedApp={isHostedApp}
            rescanningLibrary={rescanningLibrary}
            localFileInputRef={localFileInputRef}
            searchQuery={searchQuery}
            trimmedSearchQuery={trimmedSearchQuery}
            searching={searching}
            activeSortMode={activeSortMode}
            sortLabel={sortLabel}
            sortMenuOpen={sortMenuOpen}
            sortOptions={sortOptions}
            localFileDragOver={localFileDragOver}
            error={error}
            showBrowseLoading={showBrowseLoading}
            displayedLibrary={displayedLibrary}
            paginatedLibrary={paginatedLibrary}
            paginatedRemoteItems={paginatedRemoteItems}
            pendingBrowseAction={pendingBrowseAction}
            optimizingLibraryItemId={optimizingLibraryItemId}
            deviceLabel={deviceLabel}
            busy={busy}
            showPagination={showPagination}
            paginationLabel={paginationLabel}
            clampedBrowsePage={clampedBrowsePage}
            totalPages={totalPages}
            apiFetch={apiFetch}
            mediaUrl={mediaUrl}
            onBrowseBack={browseBack}
            onRescanLibrary={rescanLibrary}
            onUploadLocalFiles={uploadLocalFiles}
            onSearchSelectedSource={searchSelectedSource}
            onUpdateSearchQuery={updateSearchQuery}
            onClearSearch={clearSearch}
            onSetSortMenuOpen={setSortMenuOpen}
            onUpdateSortMode={updateSortMode}
            onDragLocalFiles={dragLocalFiles}
            onLeaveLocalFiles={leaveLocalFiles}
            onDropLocalFiles={dropLocalFiles}
            onOpenLocalFilePicker={openLocalFilePicker}
            onKeyOpenLocalFilePicker={keyOpenLocalFilePicker}
            onSetError={setError}
            onOptimizeLibraryItem={optimizeLibraryItem}
            onSendToDevice={sendToDevice}
            onRemoveLocalItem={removeLocalItem}
            onOpenBrowseItem={openBrowseItem}
            onImportItem={importItem}
            onOptimizeBrowseItem={optimizeBrowseItem}
            onSendBrowseItem={sendBrowseItem}
            onSetBrowsePage={setBrowsePage}
            onOpenResultPage={openResultPage}
          />
        </section>
      )}

      <footer className="app-footer">
        Made by{" "}
        <a href="https://github.com/uxjulia" target="_blank" rel="noreferrer">
          @uxjulia
        </a>
      </footer>

      {stablePageTooltipPosition && (
        <div
          id="stable-page-numbers-tooltip"
          className="advanced-tooltip-content"
          role="tooltip"
          style={{
            left: `${stablePageTooltipPosition.left}px`,
            top: `${stablePageTooltipPosition.top}px`
          }}
        >
          Stable Page Numbers remain the same regardless of the book you're reading or the font size, margins, or other
          page layout settings you use. This is a great way to compare how many pages you read across different books.
          The average paperback book has between 250-300 words per page, therefore CrossInk defaults to 275.
        </div>
      )}

      {sectionSplitTooltipPosition && (
        <div
          id="section-split-threshold-tooltip"
          className="advanced-tooltip-content"
          role="tooltip"
          style={{
            left: `${sectionSplitTooltipPosition.left}px`,
            top: `${sectionSplitTooltipPosition.top}px`
          }}
        >
          Placeholder tooltip content for the long-section split threshold.
        </div>
      )}

      {view === "app" && sourceModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="panel form-panel modal-card"
            onSubmit={saveSource}
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-modal-title"
          >
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
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Name"
              />
              {form.type === "local_folder" ? (
                <div className="folder-source-field">
                  <input value={form.url} readOnly placeholder="Select a folder" />
                  <button type="button" onClick={() => selectSourceType("local_folder")}>
                    Browse
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={form.url}
                    onChange={(event) => setForm({ ...form, url: event.target.value })}
                    placeholder="URL"
                  />
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

      {view === "app" && dictionaryModalOpen && canPrepareDictionaries && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="panel form-panel modal-card dictionary-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dictionary-modal-title"
            onSubmit={prepareDictionaryZip}
          >
            <div className="panel-header">
              <h2 id="dictionary-modal-title">Dictionary Tools</h2>
              <button
                type="button"
                onClick={() => setDictionaryModalOpen(false)}
                title="Close"
                aria-label="Close dictionary tools"
              >
                <X size={16} />
              </button>
            </div>
            <label className="field">
              <span>StarDict ZIP</span>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => setDictionaryZipFile(event.target.files?.[0] || null)}
              />
            </label>
            <p className="form-help">
              Unzip this folder into <code>/.dictionaries/</code> on your CrossInk SD card.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  setDictionaryModalOpen(false);
                  setDictionaryZipFile(null);
                }}
              >
                Cancel
              </button>
              <button className="primary" type="submit" disabled={busy || !dictionaryZipFile}>
                <BookOpen size={16} />
                Prepare Dictionary
              </button>
            </div>
          </form>
        </div>
      )}

      {view === "app" && optimizerModalOpen && (
        <OptimizerSettingsModal
          optimizerSettings={optimizerSettings}
          effectiveEinkQuantize={effectiveEinkQuantize}
          standaloneMode={standaloneMode}
          qualityDraft={qualityDraft}
          contrastFactorDraft={contrastFactorDraft}
          sectionSplitThresholdDraft={sectionSplitThresholdDraft}
          referencePageWordsDraft={referencePageWordsDraft}
          sectionSplitTooltipButtonRef={sectionSplitTooltipButtonRef}
          stablePageTooltipButtonRef={stablePageTooltipButtonRef}
          onClose={() => setOptimizerModalOpen(false)}
          onSwapFilenameRenderFields={swapFilenameRenderFields}
          onUpdateOptimizerSetting={updateOptimizerSetting}
          onUpdateQualityFromSlider={updateQualityFromSlider}
          onUpdateQualityDraft={updateQualityDraft}
          onCommitQualityDraft={commitQualityDraft}
          onUpdateContrastFactorFromSlider={updateContrastFactorFromSlider}
          onUpdateContrastFactorDraft={updateContrastFactorDraft}
          onCommitContrastFactorDraft={commitContrastFactorDraft}
          onUpdateSectionSplitThresholdDraft={updateSectionSplitThresholdDraft}
          onCommitSectionSplitThresholdDraft={commitSectionSplitThresholdDraft}
          onUpdateReferencePageWordsDraft={updateReferencePageWordsDraft}
          onCommitReferencePageWordsDraft={commitReferencePageWordsDraft}
          onShowSectionSplitTooltip={showSectionSplitTooltip}
          onHideSectionSplitTooltip={hideSectionSplitTooltip}
          onShowStablePageTooltip={showStablePageTooltip}
          onHideStablePageTooltip={hideStablePageTooltip}
          onResetOptimizerSettings={resetOptimizerSettings}
        />
      )}

      {serverModalOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="panel form-panel modal-card"
            onSubmit={saveServerSettings}
            role="dialog"
            aria-modal="true"
            aria-labelledby="server-modal-title"
          >
            <div className="panel-header">
              <h2 id="server-modal-title">Server</h2>
              <button
                type="button"
                onClick={() => setServerModalOpen(false)}
                title="Close"
                aria-label="Close server settings"
              >
                <X size={16} />
              </button>
            </div>
            <label className="field">
              <span>{isNativeApp ? "Inky server URL" : "API server URL"}</span>
              <input
                value={apiBaseUrlDraft}
                onChange={(event) => setApiBaseUrlDraft(event.target.value)}
                placeholder="http://192.168.1.25:8000"
                inputMode="url"
                autoCapitalize="none"
              />
            </label>
            {apiConnectionError && <div className="auth-error">{readableError(apiConnectionError)}</div>}
            <div className="modal-actions">
              <button type="button" onClick={() => setApiBaseUrlDraft("")}>
                Clear
              </button>
              <button className="primary" type="submit">
                <Save size={16} />
                Save Server
              </button>
            </div>
          </form>
        </div>
      )}

      {toast && (
        <div
          className={`toast ${toast.tone === "error" ? "error-toast" : "success-toast"}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} title="Close" aria-label="Close notification">
            <X size={16} />
          </button>
        </div>
      )}
    </main>
  );
}

function mediaUrl(url: string) {
  const apiBaseUrl = getApiBaseUrl();
  return apiBaseUrl && url.startsWith("/api/") ? `${apiBaseUrl}${url}` : url;
}

function getInitialApiBaseUrl() {
  return normalizeApiBaseUrl(
    window.inkyDesktop?.apiBaseUrl || window.localStorage.getItem(apiBaseUrlStorageKey) || bundledApiBaseUrl
  );
}

function getApiBaseUrl() {
  return normalizeApiBaseUrl(
    window.inkyDesktop?.apiBaseUrl || window.localStorage.getItem(apiBaseUrlStorageKey) || bundledApiBaseUrl
  );
}

function persistApiBaseUrl(value: string) {
  const apiBaseUrl = normalizeApiBaseUrl(value);
  if (apiBaseUrl) {
    window.localStorage.setItem(apiBaseUrlStorageKey, apiBaseUrl);
  } else {
    window.localStorage.removeItem(apiBaseUrlStorageKey);
  }
  return apiBaseUrl;
}

function getInitialTheme(): Theme {
  const stored = window.localStorage.getItem(themeStorageKey);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialDevice(): DeviceTarget {
  const stored = window.localStorage.getItem(deviceStorageKey);
  return stored === "x3" || stored === "x4" ? stored : "x4";
}

function getInitialTransferMode(): TransferMode {
  if (!canUseWifiTransfer) return "usb";
  const stored = window.localStorage.getItem(transferModeStorageKey);
  return stored === "usb" ? "usb" : "wifi";
}

function resolveDeviceHostInput(value: string) {
  const trimmed = value.trim();
  if (!isSelfHostedBrowser) return trimmed;

  const partialPrivateIp = /^(\d{1,3})\.(\d{1,3})$/.exec(trimmed);
  if (!partialPrivateIp) return trimmed;

  const thirdOctet = Number(partialPrivateIp[1]);
  const fourthOctet = Number(partialPrivateIp[2]);
  if (thirdOctet > 255 || fourthOctet > 255) return trimmed;
  return `192.168.${thirdOctet}.${fourthOctet}`;
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

function getInitialLocalSourceIndex() {
  const stored = Number(window.localStorage.getItem(localSourceIndexStorageKey));
  return Number.isFinite(stored) && stored >= 0 ? Math.floor(stored) : 0;
}

function getStoredSortModeForSource(sourceId: number | null): SortMode {
  const storageKey = sortStorageKeyForSource(sourceId);
  if (!storageKey) return "source";

  try {
    const stored = JSON.parse(window.localStorage.getItem(sortModeBySourceStorageKey) || "{}");
    if (!stored || typeof stored !== "object") return "source";
    return normalizeSortModeForSource((stored as Record<string, unknown>)[storageKey], sourceId);
  } catch {
    return "source";
  }
}

function saveSortModeForSource(sourceId: number | null, sortMode: SortMode) {
  const storageKey = sortStorageKeyForSource(sourceId);
  if (!storageKey) return;

  let stored: Record<string, SortMode> = {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(sortModeBySourceStorageKey) || "{}");
    if (parsed && typeof parsed === "object") {
      stored = parsed as Record<string, SortMode>;
    }
  } catch {
    stored = {};
  }

  stored[storageKey] = normalizeSortModeForSource(sortMode, sourceId);
  window.localStorage.setItem(sortModeBySourceStorageKey, JSON.stringify(stored));
}

function sortStorageKeyForSource(sourceId: number | null) {
  if (sourceId === null) return null;
  return sourceId === localSourceId ? "local" : `source:${sourceId}`;
}

function createTransferLogger(transport: "usb" | "wifi", filename: string) {
  let lastLoggedPercent = -10;
  let lastLoggedAt = 0;

  return (percent: number | null, message: string, level: ClientLogLevel = "info") => {
    const now = Date.now();
    const shouldLog =
      level !== "info" ||
      percent === null ||
      percent <= 0 ||
      percent >= 100 ||
      percent - lastLoggedPercent >= 10 ||
      now - lastLoggedAt >= 10000;

    if (!shouldLog) return;
    if (typeof percent === "number") lastLoggedPercent = percent;
    lastLoggedAt = now;

    const progress = typeof percent === "number" ? `[${percent}%] ` : "";
    void logClientEvent("transfer", `${transport} ${filename}: ${progress}${message}`, level);
  };
}

async function logClientEvent(scope: string, message: string, level: ClientLogLevel = "info") {
  console[level === "error" ? "error" : level === "warning" ? "warn" : "info"](`[client:${scope}] ${message}`);
  try {
    await api("/api/client-log", {
      method: "POST",
      body: JSON.stringify({ scope, message, level })
    });
  } catch {
    // Logging should never make a transfer fail.
  }
}

async function api<T = unknown>(path: string, init: RequestInit & { rawBody?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!init.rawBody) headers.set("Content-Type", "application/json");
  const authHeader = window.sessionStorage.getItem(authStorageKey);
  if (authHeader) headers.set("Authorization", authHeader);
  const response = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });
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

async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const authHeader = window.sessionStorage.getItem(authStorageKey);
  if (authHeader) headers.set("Authorization", authHeader);
  const response = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });
  if (response.status === 401) {
    window.sessionStorage.removeItem(authStorageKey);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response;
}

async function publicApi<T = unknown>(path: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}
