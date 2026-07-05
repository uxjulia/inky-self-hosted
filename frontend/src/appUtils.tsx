import { BookOpen, Folder, Rss } from "lucide-react";
import type { StandaloneFileRecord } from "./standaloneLibrary";
import { defaultOptimizerSettings, localSource, localSourceId } from "./appConstants";
import type {
  BrowseItem,
  InkyAppMode,
  Job,
  LibraryItem,
  OptimizerSettings,
  PreparedDictionaryDownload,
  RecentOptimizedDownload,
  RemoteSourceType,
  SortMode,
  Source,
  SourceType
} from "./appTypes";
import JSZip from "jszip";

export function preparedDictionaryDownloadFromJob(job: Job): PreparedDictionaryDownload | null {
  if (!job.result_json) return null;
  try {
    const result = JSON.parse(job.result_json) as { download_url?: string; filename?: string };
    return {
      downloadUrl: result.download_url || `/api/dictionaries/prepared/${job.id}/download`,
      filename: result.filename || "prepared-dictionary.zip"
    };
  } catch {
    return null;
  }
}

export function standaloneRecordToLibraryItem(record: StandaloneFileRecord): LibraryItem {
  return {
    id: record.id,
    kind: libraryKindForFilename(record.filename),
    title: record.title,
    original_path: record.filename,
    source_url: `standalone://library/${record.id}`,
    cover_url: record.coverUrl || null,
    sent_at: record.sentAt || null,
    is_missing: false,
    last_scan_at: null,
    created_at: record.createdAt
  };
}

export function libraryKindForFilename(filename: string): LibraryItem["kind"] {
  return filename.toLowerCase().endsWith(".epub") ? "epub" : "file";
}

export function formatSentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function formatLibraryItemMeta(item: LibraryItem) {
  return [
    item.author,
    item.is_missing ? "Missing from mounted folder" : null,
    item.sent_at ? `Sent on ${formatSentDate(item.sent_at)}` : null
  ]
    .filter(Boolean)
    .join(" · ");
}

export function libraryFileType(item: LibraryItem) {
  const path = item.original_path.split(/[?#]/, 1)[0].toLowerCase();
  if (path.endsWith(".epub")) return "epub";
  if (path.endsWith(".xtc") || path.endsWith(".xtch")) return "xtc";
  if (path.endsWith(".txt")) return "txt";
  if (path.endsWith(".bmp")) return "bmp";
  if (path.endsWith(".png")) return "png";
  return null;
}

export function librarySortType(item: LibraryItem) {
  return libraryFileType(item) || item.original_path.split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase() || "";
}

export function libraryItemFilename(item: LibraryItem) {
  const path = item.optimized_path || item.original_path;
  return path.split(/[\\/]/).pop() || `${item.title || "book"}.${libraryFileType(item) || "epub"}`;
}

export function filenameFromContentDisposition(value: string | null) {
  if (!value) return "";
  const encodedMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }
  const quotedMatch = value.match(/filename="([^"]+)"/i);
  if (quotedMatch) return quotedMatch[1];
  const plainMatch = value.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || "";
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "optimized.epub";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadOptimizedFiles(downloads: RecentOptimizedDownload[]) {
  if (downloads.length === 0) return;
  if (downloads.length === 1) {
    downloadBlob(downloads[0].blob, downloads[0].filename);
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const download of downloads) {
    const filename = uniqueZipFilename(download.filename || "optimized.epub", usedNames);
    zip.file(filename, await download.blob.arrayBuffer(), {
      binary: true,
      compression: "STORE"
    });
  }
  const zipBytes = await zip.generateAsync({
    type: "arraybuffer",
    compression: "STORE",
    mimeType: "application/zip"
  });
  const blob = new Blob([zipBytes], { type: "application/zip" });
  downloadBlob(blob, "optimized-epubs.zip");
}

function uniqueZipFilename(filename: string, usedNames: Set<string>) {
  const fallback = "optimized.epub";
  const cleaned = filename
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || fallback;
  const extensionStart = cleaned.lastIndexOf(".");
  const hasExtension = extensionStart > 0;
  const stem = hasExtension ? cleaned.slice(0, extensionStart) : cleaned;
  const extension = hasExtension ? cleaned.slice(extensionStart) : "";
  let candidate = cleaned;
  let counter = 2;

  while (usedNames.has(candidate)) {
    candidate = `${stem}-${counter}${extension}`;
    counter += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

export function safeDownloadStem(value: string) {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 120) || "optimized";
}

export function optimizedDeviceFilename(job: Job) {
  if (!job.result_json) return "";
  try {
    const result = JSON.parse(job.result_json) as {
      device_filename?: unknown;
      optimization?: { device_filename?: unknown };
    };
    const filename = result.optimization?.device_filename ?? result.device_filename;
    return typeof filename === "string" ? filename : "";
  } catch {
    return "";
  }
}

export function isMountedLibraryItem(item: LibraryItem) {
  return item.source_url?.startsWith("mounted-library://") || item.source_url?.startsWith("desktop-folder://") || false;
}

export function canOptimizeLibraryItem(item: LibraryItem) {
  return hasEpubExtension(item.original_path);
}

export function canOptimizeBrowseItem(item: BrowseItem) {
  if (item.type === "article") return true;
  return (
    item.media_type?.toLowerCase().includes("application/epub+zip") ||
    hasEpubExtension(item.url) ||
    hasEpubExtension(item.path)
  );
}

export function hasEpubExtension(value: string | null | undefined) {
  return (value || "").split(/[?#]/, 1)[0].toLowerCase().endsWith(".epub");
}

export function browseItemKey(item: BrowseItem) {
  return [item.type, item.url || item.path || "", item.title].join(":");
}

export function readableError(message: string) {
  try {
    const parsed = JSON.parse(message);
    if (Object.prototype.hasOwnProperty.call(parsed, "detail")) {
      const detail = String(parsed.detail || "").trim();
      return detail || "The request failed without an error message.";
    }
  } catch {
    // Keep original text below.
  }
  return message;
}

export function readableDeviceError(message: string) {
  const detail = readableError(message);
  if (!detail) {
    return "Unable to connect to device.";
  }
  return `Unable to connect to device. ${detail}`;
}

export function normalizeAppMode(value: unknown): InkyAppMode {
  if (value === "public" || value === "hosted" || value === "self-hosted") {
    return value;
  }
  return "self-hosted";
}

export function normalizeApiBaseUrl(value: string | null | undefined) {
  return (value || "").trim().replace(/\/+$/, "");
}

export function normalizeOptimizerSettings(value: unknown): OptimizerSettings {
  if (!value || typeof value !== "object") return defaultOptimizerSettings;
  const stored = value as Partial<OptimizerSettings> & { words_per_reference_page?: number };
  const legacyCharactersPerReferencePage =
    stored.words_per_reference_page == null ? undefined : Math.round(Number(stored.words_per_reference_page) * 5.5);
  const storedCharactersPerReferencePage =
    stored.characters_per_reference_page == null ? undefined : Number(stored.characters_per_reference_page);
  const normalizedCharactersPerReferencePage =
    storedCharactersPerReferencePage != null && storedCharactersPerReferencePage <= 500
      ? Math.round(storedCharactersPerReferencePage * 5.5)
      : storedCharactersPerReferencePage;
  return {
    use_original_filename: booleanOrDefault(
      stored.use_original_filename,
      defaultOptimizerSettings.use_original_filename
    ),
    filename_render_first: filenameRenderValueOrDefault(
      stored.filename_render_first,
      defaultOptimizerSettings.filename_render_first
    ),
    filename_render_second: filenameRenderValueOrDefault(
      stored.filename_render_second,
      defaultOptimizerSettings.filename_render_second
    ),
    quality: clampNumber(Number(stored.quality ?? defaultOptimizerSettings.quality), 1, 100),
    grayscale: booleanOrDefault(stored.grayscale, defaultOptimizerSettings.grayscale),
    contrast_boost: booleanOrDefault(stored.contrast_boost, defaultOptimizerSettings.contrast_boost),
    contrast_factor: clampNumber(Number(stored.contrast_factor ?? defaultOptimizerSettings.contrast_factor), 0.5, 3),
    eink_quantize: booleanOrDefault(stored.eink_quantize, defaultOptimizerSettings.eink_quantize),
    light_novel: booleanOrDefault(stored.light_novel, defaultOptimizerSettings.light_novel),
    characters_per_reference_page: clampNumber(
      Number(
        normalizedCharactersPerReferencePage ??
          legacyCharactersPerReferencePage ??
          defaultOptimizerSettings.characters_per_reference_page
      ),
      1,
      10000
    ),
    remove_fonts: booleanOrDefault(stored.remove_fonts, defaultOptimizerSettings.remove_fonts),
    remove_css: booleanOrDefault(stored.remove_css, defaultOptimizerSettings.remove_css),
    text_cleanup: booleanOrDefault(stored.text_cleanup, defaultOptimizerSettings.text_cleanup)
  };
}

export function filenameRenderValueOrDefault(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

export function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampLocalSourceIndex(index: number, remoteSourceCount: number) {
  return Math.max(0, Math.min(index, remoteSourceCount));
}

export function normalizeSortModeForSource(value: unknown, sourceId: number | null): SortMode {
  if (!isSortMode(value)) return "source";
  if (sourceId !== localSourceId && (value === "date_added" || value === "type")) return "source";
  return value;
}

export function isSortMode(value: unknown): value is SortMode {
  return (
    value === "source" || value === "date_added" || value === "type" || value === "title_asc" || value === "title_desc"
  );
}

export function insertLocalSource(sources: Source[], localSourceIndex: number) {
  const nextSources = [...sources];
  nextSources.splice(clampLocalSourceIndex(localSourceIndex, sources.length), 0, localSource);
  return nextSources;
}

export function iconForItem(item: BrowseItem) {
  if (item.type === "article") return <Rss size={16} />;
  if (item.type === "directory" || item.type === "navigation") return <Folder size={16} />;
  return <BookOpen size={16} />;
}

export function sortBrowseItems(items: BrowseItem[], sortMode: SortMode) {
  if (sortMode === "source" || sortMode === "type" || sortMode === "date_added") return items;
  return [...items].sort((left, right) => compareTitles(left.title, right.title, sortMode));
}

export function sortLibraryItems(items: LibraryItem[], sortMode: SortMode) {
  if (sortMode === "source") return items;
  if (sortMode === "date_added") {
    return [...items].sort(
      (left, right) => compareDateAdded(left, right) || compareTitles(left.title, right.title, "title_asc")
    );
  }
  if (sortMode === "type") {
    return [...items].sort((left, right) => {
      const typeResult = librarySortType(left).localeCompare(librarySortType(right), undefined, {
        numeric: true,
        sensitivity: "base"
      });
      return typeResult || compareTitles(left.title, right.title, "title_asc");
    });
  }
  return [...items].sort((left, right) => compareTitles(left.title, right.title, sortMode));
}

export function compareTitles(left: string, right: string, sortMode: SortMode) {
  const result = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  return sortMode === "title_desc" ? -result : result;
}

export function compareDateAdded(left: LibraryItem, right: LibraryItem) {
  const leftTime = timestampForSort(left.created_at);
  const rightTime = timestampForSort(right.created_at);
  return rightTime - leftTime;
}

export function timestampForSort(value?: string | null) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortLabelForMode(sortMode: SortMode) {
  if (sortMode === "date_added") return "Date Added";
  if (sortMode === "type") return "Type";
  if (sortMode === "title_asc") return "Title A-Z";
  if (sortMode === "title_desc") return "Title Z-A";
  return "Source order";
}

export function sourceTypeLabel(type: RemoteSourceType) {
  if (type === "local_folder") return "Local Folder";
  return type.toUpperCase();
}

export function sourceTypeShortLabel(type: SourceType) {
  if (type === "local_folder") return "Folder";
  return type;
}

export function folderNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || "Local Folder";
}

export function moveSource(sources: Source[], draggedSourceId: number, targetSourceId: number, insertAfter: boolean) {
  const draggedSource = sources.find((source) => source.id === draggedSourceId);
  if (!draggedSource) return sources;

  const nextSources = sources.filter((source) => source.id !== draggedSourceId);
  const targetIndex = nextSources.findIndex((source) => source.id === targetSourceId);
  if (targetIndex < 0) return sources;

  nextSources.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedSource);
  return nextSources;
}

export function formatBytes(size: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
