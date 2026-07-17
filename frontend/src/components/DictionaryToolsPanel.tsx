import { BookOpen, Download, Upload } from "lucide-react";
import { useState } from "react";
import type { DragEvent, FormEvent } from "react";
import type { Job, PreparedDictionaryDownload } from "../appTypes";
import { JobLog } from "./JobLog";

type DictionaryToolsPanelProps = {
  busy: boolean;
  dictionaryZipFile: File | null;
  jobs: Job[];
  recentPreparedDictionaryDownload: PreparedDictionaryDownload | null;
  onSelectDictionaryZip: (file: File | null) => void;
  onPrepareDictionaryZip: (event: FormEvent) => void;
  onDownloadPreparedDictionaryFile: () => void;
};

export function DictionaryToolsPanel({
  busy,
  dictionaryZipFile,
  jobs,
  recentPreparedDictionaryDownload,
  onSelectDictionaryZip,
  onPrepareDictionaryZip,
  onDownloadPreparedDictionaryFile
}: DictionaryToolsPanelProps) {
  const [dragOver, setDragOver] = useState(false);

  function handleDictionaryDrag(event: DragEvent<HTMLLabelElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function handleDictionaryDragLeave(event: DragEvent<HTMLLabelElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragOver(false);
    }
  }

  function handleDictionaryDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragOver(false);
    onSelectDictionaryZip(event.dataTransfer.files[0] || null);
  }

  return (
    <section
      className="dictionary-tools-page"
      role="tabpanel"
      id="dictionary-tools-panel"
      aria-labelledby="dictionary-tools-tab"
    >
      <form className="panel form-panel dictionary-tools-card" onSubmit={onPrepareDictionaryZip}>
        <div className="panel-header">
          <div className="heading-line">
            <BookOpen size={16} />
            <h2>Dictionary Preparation</h2>
          </div>
        </div>
        <div>
          <p className="text-center">Use this tool to generate files that will improve dictionary lookup speeds in Crossink.</p>
        </div>
        <div className="field">
          <span>StarDict archive</span>
          <label
            className={`dictionary-drop-zone ${dragOver ? "drag-over" : ""}`}
            onDragEnter={handleDictionaryDrag}
            onDragOver={handleDictionaryDrag}
            onDragLeave={handleDictionaryDragLeave}
            onDrop={handleDictionaryDrop}
          >
            <Upload size={18} />
            <span>{dictionaryZipFile?.name || "Drop a dictionary archive here or click to browse"}</span>
            <input
              key={dictionaryZipFile ? "selected" : "empty"}
              type="file"
              accept=".zip,.tar.zst,.zst,.rar,application/zip,application/x-zip-compressed,application/zstd,application/x-zstd,application/vnd.rar,application/x-rar-compressed"
              onChange={(event) => onSelectDictionaryZip(event.target.files?.[0] || null)}
            />
          </label>
        </div>
        <div className="form-help dictionary-help">
          <p>
            Upload one StarDict dictionary as a <code>.zip</code>, <code>.tar.zst</code>, or <code>.rar</code> archive.
            It can contain the files directly or inside one folder.
          </p>
          <p>
            Required files must share the same name: <code>.ifo</code>, <code>.idx</code>, and <code>.dict</code> or{" "}
            <code>.dict.dz</code>. Synonym files like <code>.syn</code> or <code>.syn.dz</code> are optional.
          </p>
          <p>
            After preparation, download the new ZIP and unzip its folder into <code>/.dictionaries</code> or <code>/dictionaries</code> on your
            SD card.
          </p>
        </div>
        <button
          className="primary icon-text dictionary-action-button"
          type="submit"
          disabled={busy || !dictionaryZipFile}
        >
          <BookOpen size={16} />
          Prepare Dictionary
        </button>
        {recentPreparedDictionaryDownload && (
          <button
            className="icon-text recent-download-button prepared-download-button dictionary-action-button"
            type="button"
            onClick={onDownloadPreparedDictionaryFile}
            title={`Download ${recentPreparedDictionaryDownload.filename}`}
          >
            <Download size={16} />
            Download Prepared Dictionary
          </button>
        )}
        <JobLog jobs={jobs} ariaLabel="Latest dictionary job" />
      </form>
    </section>
  );
}
