export type InkyAppMode = "self-hosted" | "public" | "hosted";
export type AppView = "app" | "help";
export type RemoteSourceType = "opds" | "webdav" | "feed" | "local_folder";
export type SourceType = "local" | RemoteSourceType;
export type Theme = "light" | "dark";
export type DeviceTarget = "x4" | "x3";
export type TransferMode = "wifi" | "usb";
export type SortMode = "source" | "date_added" | "title_asc" | "title_desc" | "type";
export type ToastState = { message: string; tone: "success" | "error" };
export type PendingBrowseAction = { key: string; action: "save" | "send" | "optimize" };
export type FloatingTooltipPosition = { top: number; left: number };

export type OptimizerSettings = {
  use_original_filename: boolean;
  filename_render_first: string;
  filename_render_second: string;
  quality: number;
  grayscale: boolean;
  contrast_boost: boolean;
  contrast_factor: number;
  eink_quantize: boolean;
  light_novel: boolean;
  split_long_sections: boolean;
  section_split_word_threshold: number;
  characters_per_reference_page: number;
  remove_fonts: boolean;
  remove_css: boolean;
  text_cleanup: boolean;
};

export type Source = {
  id: number;
  type: SourceType;
  name: string;
  url: string;
  username?: string | null;
  display_order?: number;
};

export type BrowseItem = {
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

export type BrowseResult = {
  source_id: number;
  source_type: SourceType;
  base_url: string;
  title: string;
  items: BrowseItem[];
  message?: string | null;
  next_url?: string | null;
  previous_url?: string | null;
};

export type LibraryItem = {
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
  is_missing?: boolean;
  last_scan_at?: string | null;
  created_at?: string | null;
};

export type Job = {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  error?: string | null;
  item_id?: number | null;
  result_json?: string | null;
};

export type RecentOptimizedDownload = {
  blob: Blob;
  filename: string;
};

export type PreparedDictionaryDownload = {
  downloadUrl: string;
  filename: string;
};

export type SourceForm = {
  type: RemoteSourceType;
  name: string;
  url: string;
  username: string;
  password: string;
};

export type ClientLogLevel = "info" | "warning" | "error";
