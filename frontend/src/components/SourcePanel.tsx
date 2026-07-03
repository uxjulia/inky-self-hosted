import { ArrowDown, ArrowUp, GripVertical, Library, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import type { DragEvent } from "react";
import { localSourceId } from "../appConstants";
import type { Source } from "../appTypes";
import { sourceTypeShortLabel } from "../appUtils";

type SourcePanelProps = {
  allSources: Source[];
  selectedSourceId: number | null;
  draggedSourceId: number | null;
  dragOverSourceId: number | null;
  sourceMenuId: number | null;
  standaloneMode: boolean;
  isPublicReadOnly: boolean;
  isDesktopApp: boolean;
  onOpenAddSourceModal: () => void;
  onSelectSource: (sourceId: number) => void;
  onSetSourceMenuId: (sourceId: number | null | ((current: number | null) => number | null)) => void;
  onSetDraggedSourceId: (sourceId: number | null) => void;
  onSetDragOverSourceId: (sourceId: number | null | ((current: number | null) => number | null)) => void;
  onDropSource: (event: DragEvent<HTMLDivElement>, sourceId: number) => void;
  onOpenEditSource: (source: Source) => void;
  onMoveSourceByOffset: (sourceId: number, offset: -1 | 1) => void;
  onDeleteSource: (sourceId: number) => void;
};

export function SourcePanel({
  allSources,
  selectedSourceId,
  draggedSourceId,
  dragOverSourceId,
  sourceMenuId,
  standaloneMode,
  isPublicReadOnly,
  isDesktopApp,
  onOpenAddSourceModal,
  onSelectSource,
  onSetSourceMenuId,
  onSetDraggedSourceId,
  onSetDragOverSourceId,
  onDropSource,
  onOpenEditSource,
  onMoveSourceByOffset,
  onDeleteSource
}: SourcePanelProps) {
  return (
    <section className="panel source-panel">
      <div className="panel-header">
        <div className="heading-line">
          <Library size={16} />
          <h2>Sources</h2>
        </div>
        {!standaloneMode && !isPublicReadOnly && (
          <button
            className="border-0"
            type="button"
            onClick={onOpenAddSourceModal}
            title="Add source"
            aria-label="Add source"
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      <div className="source-list">
        {allSources.map((source, index) => (
          <div
            className={`source-row ${source.id === selectedSourceId ? "selected" : ""} ${
              source.id === draggedSourceId ? "dragging" : ""
            } ${source.id === dragOverSourceId ? "drag-over" : ""}`}
            draggable={!isPublicReadOnly}
            key={source.id}
            onClick={() => {
              onSetSourceMenuId(null);
              onSelectSource(source.id);
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              onSetDraggedSourceId(source.id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              onSetDragOverSourceId(source.id);
            }}
            onDragLeave={() => onSetDragOverSourceId((current) => (current === source.id ? null : current))}
            onDragEnd={() => {
              onSetDraggedSourceId(null);
              onSetDragOverSourceId(null);
            }}
            onDrop={(event) => onDropSource(event, source.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectSource(source.id);
              }
            }}
          >
            {!isPublicReadOnly && <GripVertical className="source-drag-icon" size={15} aria-hidden="true" />}
            <span className="source-type">{sourceTypeShortLabel(source.type)}</span>
            <span className="source-name">{source.name}</span>
            {!isPublicReadOnly && (
              <div className="source-menu-wrap">
                <button
                  className="source-menu-button"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetSourceMenuId((current) => (current === source.id ? null : source.id));
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
                          onOpenEditSource(source);
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
                        onMoveSourceByOffset(source.id, -1);
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
                        onMoveSourceByOffset(source.id, 1);
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
                          onDeleteSource(source.id);
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
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
