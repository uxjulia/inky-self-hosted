import { ArrowUpDown, BookOpen, Paintbrush, Plus, RefreshCw, Save, Search, Send, Trash2, Upload, X } from "lucide-react";
import type { Dispatch, DragEvent, FormEvent, KeyboardEvent, ReactNode, RefObject, SetStateAction } from "react";
import { localSource } from "../appConstants";
import type { BrowseItem, BrowseResult, LibraryItem, PendingBrowseAction, SortMode, Source } from "../appTypes";
import {
  browseItemKey,
  canOptimizeBrowseItem,
  canOptimizeLibraryItem,
  formatBytes,
  formatLibraryItemMeta,
  iconForItem,
  isMountedLibraryItem,
  libraryFileType,
  readableError,
  sortLabelForMode
} from "../appUtils";
import { AuthenticatedImage } from "./AuthenticatedImage";

type BrowsePanelProps = {
  sourceIcon: ReactNode;
  isLocalSource: boolean;
  selectedSource: Source | null;
  activeBrowseResult: BrowseResult | null;
  browseResult: BrowseResult | null;
  browseStackLength: number;
  usesBrowserLibrary: boolean;
  isHostedApp: boolean;
  refreshing: boolean;
  localFileInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  trimmedSearchQuery: string;
  searching: boolean;
  activeSortMode: SortMode;
  sortLabel: string;
  sortMenuOpen: boolean;
  sortOptions: SortMode[];
  localFileDragOver: boolean;
  error: string;
  showBrowseLoading: boolean;
  displayedLibrary: LibraryItem[];
  paginatedLibrary: LibraryItem[];
  selectedLocalItems: LibraryItem[];
  selectedLocalItemIds: Set<number>;
  paginatedRemoteItems: BrowseItem[];
  pendingBrowseAction: PendingBrowseAction | null;
  optimizingLibraryItemId: number | null;
  deviceLabel: string;
  busy: boolean;
  showPagination: boolean;
  paginationLabel: string;
  clampedBrowsePage: number;
  totalPages: number;
  apiFetch: (path: string) => Promise<Response>;
  mediaUrl: (url: string) => string;
  onBrowseBack: () => void;
  onRefresh: () => void;
  onUploadLocalFiles: (files: FileList | null) => void | Promise<void>;
  onSearchSelectedSource: (event: FormEvent) => void | Promise<void>;
  onUpdateSearchQuery: (value: string) => void;
  onClearSearch: () => void;
  onSetSortMenuOpen: Dispatch<SetStateAction<boolean>>;
  onUpdateSortMode: (mode: SortMode) => void;
  onDragLocalFiles: (event: DragEvent<HTMLElement>) => void;
  onLeaveLocalFiles: (event: DragEvent<HTMLElement>) => void;
  onDropLocalFiles: (event: DragEvent<HTMLElement>) => void;
  onOpenLocalFilePicker: () => void;
  onKeyOpenLocalFilePicker: (event: KeyboardEvent<HTMLElement>) => void;
  onSetError: (value: string) => void;
  onOptimizeLibraryItem: (item: LibraryItem) => void;
  onSendToDevice: (item: LibraryItem) => void;
  onRemoveLocalItem: (item: LibraryItem) => void;
  onToggleLocalItemSelected: (itemId: number) => void;
  onSetVisibleLocalItemsSelected: (items: LibraryItem[], selected: boolean) => void;
  onClearLocalItemSelection: () => void;
  onOptimizeSelectedLocalItems: () => void;
  onSendSelectedLocalItems: () => void;
  onRemoveSelectedLocalItems: () => void;
  onOpenBrowseItem: (item: BrowseItem) => void;
  onImportItem: (item: BrowseItem) => void;
  onOptimizeBrowseItem: (item: BrowseItem) => void;
  onSendBrowseItem: (item: BrowseItem) => void;
  onSetBrowsePage: Dispatch<SetStateAction<number>>;
  onOpenResultPage: (target: string | null | undefined, direction: "next" | "previous") => void;
};

export function BrowsePanel({
  sourceIcon,
  isLocalSource,
  selectedSource,
  activeBrowseResult,
  browseResult,
  browseStackLength,
  usesBrowserLibrary,
  isHostedApp,
  refreshing,
  localFileInputRef,
  searchQuery,
  trimmedSearchQuery,
  searching,
  activeSortMode,
  sortLabel,
  sortMenuOpen,
  sortOptions,
  localFileDragOver,
  error,
  showBrowseLoading,
  displayedLibrary,
  paginatedLibrary,
  selectedLocalItems,
  selectedLocalItemIds,
  paginatedRemoteItems,
  pendingBrowseAction,
  optimizingLibraryItemId,
  deviceLabel,
  busy,
  showPagination,
  paginationLabel,
  clampedBrowsePage,
  totalPages,
  apiFetch,
  mediaUrl,
  onBrowseBack,
  onRefresh,
  onUploadLocalFiles,
  onSearchSelectedSource,
  onUpdateSearchQuery,
  onClearSearch,
  onSetSortMenuOpen,
  onUpdateSortMode,
  onDragLocalFiles,
  onLeaveLocalFiles,
  onDropLocalFiles,
  onOpenLocalFilePicker,
  onKeyOpenLocalFilePicker,
  onSetError,
  onOptimizeLibraryItem,
  onSendToDevice,
  onRemoveLocalItem,
  onToggleLocalItemSelected,
  onSetVisibleLocalItemsSelected,
  onClearLocalItemSelection,
  onOptimizeSelectedLocalItems,
  onSendSelectedLocalItems,
  onRemoveSelectedLocalItems,
  onOpenBrowseItem,
  onImportItem,
  onOptimizeBrowseItem,
  onSendBrowseItem,
  onSetBrowsePage,
  onOpenResultPage
}: BrowsePanelProps) {
  const selectedLocalCount = selectedLocalItems.length;
  const selectedSendableCount = selectedLocalItems.filter((item) => !item.is_missing).length;
  const selectedOptimizableCount = selectedLocalItems.filter(
    (item) => !item.is_missing && canOptimizeLibraryItem(item)
  ).length;
  const selectedRemovableCount = selectedLocalItems.filter((item) => !isMountedLibraryItem(item)).length;
  const allVisibleSelected =
    paginatedLibrary.length > 0 && paginatedLibrary.every((item) => selectedLocalItemIds.has(item.id));

  return (
    <section className="panel browse-panel">
      <div className="panel-header">
        <div className="heading-line">
          {sourceIcon}
          <h2>{isLocalSource ? localSource.name : activeBrowseResult?.title || selectedSource?.name || "Browse"}</h2>
        </div>
        <div className="toolbar">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title={
              isLocalSource
                ? usesBrowserLibrary
                  ? "Refresh local library"
                  : "Refresh and sync mounted library"
                : "Refresh sources and library"
            }
          >
            <RefreshCw className={refreshing ? "spin" : ""} size={15} />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
          {!isLocalSource && (
            <button style={{ padding: "8px", width: "unset" }} type="button" onClick={onBrowseBack} disabled={browseStackLength <= 1} title="Back">
              Back
            </button>
          )}
          {isLocalSource && (
            <>
              <label className="file-button border-0" title="Upload file" aria-label="Upload file">
                <Plus size={16} />
                <input
                  ref={localFileInputRef}
                  type="file"
                  multiple
                  accept={isHostedApp ? ".epub" : ".epub,.txt,.xtc,.xtch,.bmp,.png"}
                  onChange={(event) => {
                    void onUploadLocalFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </>
          )}
        </div>
      </div>
      {selectedSource && (
        <form className="search-bar" onSubmit={onSearchSelectedSource}>
          <input
            value={searchQuery}
            onChange={(event) => onUpdateSearchQuery(event.target.value)}
            placeholder={`Search ${selectedSource.name}`}
            aria-label={`Search ${selectedSource.name}`}
          />
          {searchQuery && (
            <button type="button" onClick={onClearSearch} title="Clear search" aria-label="Clear search">
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
              className={`sort-button ${activeSortMode === "source" ? "" : "active"}`}
              onClick={() => onSetSortMenuOpen((open) => !open)}
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
                    onClick={() => onUpdateSortMode(mode)}
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
      {isLocalSource && (
        <section
          className={`local-drop-zone ${localFileDragOver ? "drag-over" : ""}`}
          onDragEnter={onDragLocalFiles}
          onDragOver={onDragLocalFiles}
          onDragLeave={onLeaveLocalFiles}
          onDrop={onDropLocalFiles}
          onClick={onOpenLocalFilePicker}
          onKeyDown={onKeyOpenLocalFilePicker}
          role="button"
          tabIndex={0}
          aria-label="Add files to Local Library"
        >
          <Upload size={18} />
          <span>Drop files here or click to browse</span>
        </section>
      )}
      {isLocalSource && (paginatedLibrary.length > 0 || selectedLocalCount > 0) && (
        <div className="bulk-action-bar">
          <label className="bulk-select-toggle">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={paginatedLibrary.length === 0}
              onChange={(event) => onSetVisibleLocalItemsSelected(paginatedLibrary, event.target.checked)}
            />
            <span>{selectedLocalCount > 0 ? `${selectedLocalCount} selected` : "Select page"}</span>
          </label>
          {selectedLocalCount > 0 && (
            <div className="bulk-actions">
              <button
                type="button"
                onClick={onOptimizeSelectedLocalItems}
                disabled={busy || selectedOptimizableCount === 0}
              >
                <Paintbrush size={15} />
                Optimize {selectedOptimizableCount}
              </button>
              <button type="button" onClick={onSendSelectedLocalItems} disabled={busy || selectedSendableCount === 0}>
                <Send size={15} />
                Send {selectedSendableCount}
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={onRemoveSelectedLocalItems}
                disabled={busy || selectedRemovableCount === 0}
              >
                <Trash2 size={15} />
                Delete {selectedRemovableCount}
              </button>
              <button type="button" onClick={onClearLocalItemSelection}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}
      <div className="table-list">
        {error && (
          <div className="empty-state status-state error-state">
            <span>{readableError(error)}</span>
            <button type="button" onClick={() => onSetError("")} title="Dismiss error" aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {!error && showBrowseLoading && (
          <div className="empty-state loading-state">
            <RefreshCw className="spin" size={16} />
            <span>Loading source</span>
          </div>
        )}
        {!error && isLocalSource && displayedLibrary.length === 0 && (
          <div className="empty-state">
            {trimmedSearchQuery ? `No results found for "${trimmedSearchQuery}".` : "No local files yet."}
          </div>
        )}
        {!error &&
          !showBrowseLoading &&
          isLocalSource &&
          paginatedLibrary.map((item) => {
            const itemMeta = formatLibraryItemMeta(item);
            const canRemoveItem = !isMountedLibraryItem(item);
            const canSendItem = !item.is_missing;
            const canOptimizeItem = canSendItem && canOptimizeLibraryItem(item);
            const optimizingItem = optimizingLibraryItemId === item.id;
            const sendTitle = item.is_missing
              ? "File is missing from the mounted library folder"
              : canOptimizeLibraryItem(item)
                ? `Optimize for ${deviceLabel} & Send`
                : "Send to device";
            const fileType = libraryFileType(item);
            const coverUrl = item.is_missing ? null : item.cover_url;
            const selected = selectedLocalItemIds.has(item.id);
            return (
              <div
                className={`item-row local-library-row ${item.is_missing ? "missing-library-row" : ""} ${selected ? "selected-library-row" : ""
                  }`}
                key={item.id}
              >
                <label className="library-select-checkbox" aria-label={`Select ${item.title}`}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleLocalItemSelected(item.id)}
                  />
                </label>
                <div className={coverUrl ? "item-cover" : "item-icon"}>
                  {coverUrl ? (
                    <AuthenticatedImage src={coverUrl} alt="" apiFetch={apiFetch} mediaUrl={mediaUrl} />
                  ) : (
                    <BookOpen size={16} />
                  )}
                </div>
                <div className="item-main">
                  <div className="item-title-line">
                    <strong>{item.title}</strong>
                  </div>
                  {itemMeta && <span>{itemMeta}</span>}
                </div>

                <div className="row-actions">
                  {fileType && <span className={`file-type-tag file-type-${fileType}`}>{fileType}</span>}
                  {canOptimizeItem && (
                    <button
                      type="button"
                      onClick={() => onOptimizeLibraryItem(item)}
                      title={optimizingItem ? `Optimizing for ${deviceLabel}` : `Optimize for ${deviceLabel}`}
                      aria-label={optimizingItem ? `Optimizing for ${deviceLabel}` : `Optimize for ${deviceLabel}`}
                      disabled={optimizingItem}
                    >
                      {optimizingItem ? <RefreshCw className="spin" size={15} /> : <Paintbrush size={16} />}
                    </button>
                  )}
                  <button type="button" onClick={() => onSendToDevice(item)} title={sendTitle} disabled={!canSendItem}>
                    <Send size={16} />
                  </button>
                  {canRemoveItem && (
                    <button type="button" onClick={() => onRemoveLocalItem(item)} title="Remove">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        {!error && !showBrowseLoading && !isLocalSource && activeBrowseResult?.message && (
          <div className="empty-state">{activeBrowseResult.message}</div>
        )}
        {!error && !showBrowseLoading && !isLocalSource && selectedSource && !browseResult && (
          <div className="empty-state">Select refresh to browse this source.</div>
        )}
        {!isLocalSource &&
          !showBrowseLoading &&
          paginatedRemoteItems.map((item, index) => {
            const opensBrowseTarget = item.type === "navigation" || item.type === "directory";
            const isSendableItem = item.type === "book" || item.type === "article" || item.type === "file";
            const itemKey = browseItemKey(item);
            const savingItem = pendingBrowseAction?.key === itemKey && pendingBrowseAction.action === "save";
            const sendingItem = pendingBrowseAction?.key === itemKey && pendingBrowseAction.action === "send";
            const optimizingItem = pendingBrowseAction?.key === itemKey && pendingBrowseAction.action === "optimize";
            const canOptimizeItem = canOptimizeBrowseItem(item);
            const canSaveItem = !usesBrowserLibrary;
            const sendTitle = canOptimizeBrowseItem(item) ? `Optimize for ${deviceLabel} & Send` : "Send to device";
            const sendingTitle = canOptimizeBrowseItem(item)
              ? `Optimizing for ${deviceLabel} & sending`
              : "Sending to device";
            return (
              <div
                className={`item-row ${isSendableItem ? "sendable-row" : "navigation-row"} ${opensBrowseTarget ? "clickable-row" : ""
                  }`}
                key={`${item.type}-${item.url || item.path}-${index}`}
                onClick={opensBrowseTarget ? () => onOpenBrowseItem(item) : undefined}
                onKeyDown={
                  opensBrowseTarget
                    ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenBrowseItem(item);
                      }
                    }
                    : undefined
                }
                role={opensBrowseTarget ? "button" : undefined}
                tabIndex={opensBrowseTarget ? 0 : undefined}
              >
                <div className={item.image_url ? "item-cover" : "item-icon"}>
                  {item.image_url ? (
                    <AuthenticatedImage src={item.image_url} alt="" apiFetch={apiFetch} mediaUrl={mediaUrl} />
                  ) : (
                    iconForItem(item)
                  )}
                </div>
                <div className="item-main">
                  <strong>{item.title}</strong>
                  <span>
                    {[item.author, item.published, item.size ? formatBytes(item.size) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {isSendableItem && (
                  <div className="row-actions">
                    {canSaveItem && (
                      <button
                        type="button"
                        onClick={() => onImportItem(item)}
                        title={savingItem ? "Saving to Local Library" : "Save to Local Library"}
                        aria-label={savingItem ? "Saving to Local Library" : "Save to Local Library"}
                        disabled={busy}
                      >
                        {savingItem ? <RefreshCw className="spin" size={15} /> : <Save size={16} />}
                      </button>
                    )}
                    {canOptimizeItem && (
                      <button
                        type="button"
                        onClick={() => onOptimizeBrowseItem(item)}
                        title={optimizingItem ? `Optimizing for ${deviceLabel}` : `Optimize for ${deviceLabel}`}
                        aria-label={optimizingItem ? `Optimizing for ${deviceLabel}` : `Optimize for ${deviceLabel}`}
                        disabled={busy}
                      >
                        {optimizingItem ? <RefreshCw className="spin" size={15} /> : <Paintbrush size={16} />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSendBrowseItem(item)}
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
          <span>{paginationLabel}</span>
          <div className="pagination-actions">
            <button
              type="button"
              onClick={() =>
                clampedBrowsePage > 1
                  ? onSetBrowsePage((page) => Math.max(1, page - 1))
                  : onOpenResultPage(activeBrowseResult?.previous_url, "previous")
              }
              disabled={clampedBrowsePage <= 1 && !activeBrowseResult?.previous_url}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() =>
                clampedBrowsePage < totalPages
                  ? onSetBrowsePage((page) => Math.min(totalPages, page + 1))
                  : onOpenResultPage(activeBrowseResult?.next_url, "next")
              }
              disabled={clampedBrowsePage >= totalPages && !activeBrowseResult?.next_url}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
