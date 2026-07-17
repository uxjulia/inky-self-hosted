import { BookOpen, Download } from "lucide-react";
import type { FormEvent } from "react";
import type { PreparedDictionaryDownload } from "../appTypes";

type DictionaryToolsPanelProps = {
  busy: boolean;
  dictionaryZipFile: File | null;
  recentPreparedDictionaryDownload: PreparedDictionaryDownload | null;
  onSelectDictionaryZip: (file: File | null) => void;
  onPrepareDictionaryZip: (event: FormEvent) => void;
  onDownloadPreparedDictionaryFile: () => void;
};

export function DictionaryToolsPanel({
  busy,
  dictionaryZipFile,
  recentPreparedDictionaryDownload,
  onSelectDictionaryZip,
  onPrepareDictionaryZip,
  onDownloadPreparedDictionaryFile
}: DictionaryToolsPanelProps) {
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
            <h2>Dictionary Tools</h2>
          </div>
        </div>
        <label className="field">
          <span>StarDict archive</span>
          <input
            type="file"
            accept=".zip,.tar.zst,.zst,.rar,application/zip,application/x-zip-compressed,application/zstd,application/x-zstd,application/vnd.rar,application/x-rar-compressed"
            onChange={(event) => onSelectDictionaryZip(event.target.files?.[0] || null)}
          />
        </label>
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
            After preparation, download the new ZIP and unzip its folder into <code>/.dictionaries/</code> on your
            CrossInk SD card.
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
            className="icon-text recent-download-button dictionary-action-button"
            type="button"
            onClick={onDownloadPreparedDictionaryFile}
            title={`Download ${recentPreparedDictionaryDownload.filename}`}
          >
            <Download size={16} />
            Download Prepared Dictionary
          </button>
        )}
      </form>
    </section>
  );
}
