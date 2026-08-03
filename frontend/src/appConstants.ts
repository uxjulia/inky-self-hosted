import type { OptimizerSettings, RemoteSourceType, Source, SourceForm } from "./appTypes";

export const themeStorageKey = "inky-theme";
export const localSourceIndexStorageKey = "inky-local-source-index";
export const sortModeBySourceStorageKey = "inky-sort-mode-by-source";
export const optimizerSettingsStorageKey = "inky-optimizer-settings";
export const deviceStorageKey = "inky-device-target";
export const transferModeStorageKey = "inky-transfer-mode";
export const authStorageKey = "inky-basic-auth";
export const helpStorageBannerDismissedStorageKey = "inky-help-storage-banner-dismissed";
export const localSourceId = -1;

export const emptySourceForm: SourceForm = { type: "opds", name: "", url: "", username: "", password: "" };
export const localSource: Source = { id: localSourceId, type: "local", name: "Local Library", url: "local://library" };
export const sourceTypes: RemoteSourceType[] = ["opds", "webdav", "feed"];

export const defaultOptimizerSettings: OptimizerSettings = {
  use_original_filename: true,
  filename_render_first: "Book Title",
  filename_render_second: "Author",
  quality: 70,
  grayscale: true,
  contrast_boost: true,
  contrast_factor: 1.2,
  eink_quantize: true,
  light_novel: false,
  characters_per_reference_page: 1500,
  split_long_sections: true,
  section_split_word_threshold: 8000,
  section_split_byte_threshold: 32768,
  section_split_hard_byte_limit: 49152,
  remove_fonts: true,
  remove_css: true,
  text_cleanup: true
};
