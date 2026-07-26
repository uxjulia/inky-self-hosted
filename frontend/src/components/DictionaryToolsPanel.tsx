import { Archive, BookOpen, Download, Folder, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import type { DictionaryInputFile, Job, PreparedDictionaryDownload } from "../appTypes";
import { JobLog } from "./JobLog";

type DictionaryToolsPanelProps = {
  busy: boolean;
  dictionaryFiles: DictionaryInputFile[];
  jobs: Job[];
  recentPreparedDictionaryDownload: PreparedDictionaryDownload | null;
  onSelectDictionaryFiles: (files: DictionaryInputFile[]) => void;
  onPrepareDictionaryZip: (event: FormEvent) => void;
  onDownloadPreparedDictionaryFile: () => void;
};

export function DictionaryToolsPanel({
  busy,
  dictionaryFiles,
  jobs,
  recentPreparedDictionaryDownload,
  onSelectDictionaryFiles,
  onPrepareDictionaryZip,
  onDownloadPreparedDictionaryFile
}: DictionaryToolsPanelProps) {
  const [dragOver, setDragOver] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  function handleDictionaryDrag(event: DragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function handleDictionaryDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragOver(false);
    }
  }

  async function handleDictionaryDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragOver(false);
    const entries = Array.from(event.dataTransfer.items)
      .map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => Boolean(entry));
    if (entries.some((entry) => entry.isDirectory)) {
      onSelectDictionaryFiles((await Promise.all(entries.map((entry) => readDroppedEntry(entry)))).flat());
      return;
    }
    const [file] = Array.from(event.dataTransfer.files);
    onSelectDictionaryFiles(file ? [{ file }] : []);
  }

  const selectedName = dictionaryFiles[0]?.relativePath?.split("/")[0] || dictionaryFiles[0]?.file.name;

  function selectArchive() {
    setPickerOpen(false);
    archiveInputRef.current?.click();
  }

  function selectFolder() {
    setPickerOpen(false);
    folderInputRef.current?.click();
  }

  return (
    <section className="dictionary-tools-page" role="tabpanel" id="dictionary-tools-panel" aria-labelledby="dictionary-tools-tab">
      <form className="panel form-panel dictionary-tools-card" onSubmit={onPrepareDictionaryZip}>
        <div className="panel-header">
          <div className="heading-line">
            <BookOpen size={16} />
            <h2>Dictionary Preparation</h2>
          </div>
        </div>
        <p className="text-center">Use this tool to generate index files for your dictionary that will improve lookup speeds in Cross<span className="serif">I</span>nk.</p>
        <div className="field">
          <span>StarDict archive or folder</span>
          <button
            type="button"
            className={`dictionary-drop-zone ${dragOver ? "drag-over" : ""}`}
            onDragEnter={handleDictionaryDrag}
            onDragOver={handleDictionaryDrag}
            onDragLeave={handleDictionaryDragLeave}
            onDrop={handleDictionaryDrop}
            onClick={() => setPickerOpen(true)}
          >
            <Upload size={18} />
            <span>{selectedName ? dictionaryFiles.length > 1 ? `${selectedName} folder (${dictionaryFiles.length} files)` : selectedName : "Drop a dictionary archive or folder here, or click to browse"}</span>
          </button>
          <input
            ref={archiveInputRef}
            className="dictionary-picker-input"
            type="file"
            accept=".zip,.tar.zst,.zst,.rar,application/zip,application/x-zip-compressed,application/zstd,application/x-zstd,application/vnd.rar,application/x-rar-compressed"
            onChange={(event) => {
              const [file] = Array.from(event.target.files || []);
              onSelectDictionaryFiles(file ? [{ file }] : []);
            }}
          />
          <input
            ref={(input) => {
              folderInputRef.current = input;
              input?.setAttribute("webkitdirectory", "");
            }}
            className="dictionary-picker-input"
            type="file"
            multiple
            onChange={(event) => onSelectDictionaryFiles(Array.from(event.target.files || []).map((file) => ({ file, relativePath: file.webkitRelativePath || file.name })))}
          />
          {pickerOpen && (
            <div className="dictionary-picker-choices" role="dialog" aria-label="Choose dictionary input">
              <p>Choose what to prepare</p>
              <div>
                <button type="button" className="secondary icon-text" onClick={selectArchive}>
                  <Archive size={16} />
                  Archive
                </button>
                <button type="button" className="secondary icon-text" onClick={selectFolder}>
                  <Folder size={16} />
                  Folder
                </button>
              </div>
              <button type="button" className="text-button" onClick={() => setPickerOpen(false)}>Cancel</button>
            </div>
          )}
        </div>
        <div className="form-help dictionary-help">
          <p>Drop one StarDict <code>.zip</code>, <code>.tar.zst</code>, or <code>.rar</code> archive, or drop its uncompressed folder. Clicking the area lets you choose an archive or folder. Archives can contain the files directly or inside one folder.</p>
          <p>Required files must share the same name: <code>.ifo</code>, <code>.idx</code>, and <code>.dict</code> or <code>.dict.dz</code>. Synonym files like <code>.syn</code> or <code>.syn.dz</code> are optional.</p>
          <p>After preparation, download the new ZIP and unzip its folder into <code>/.dictionaries</code> or <code>/dictionaries</code> on your SD card. Prepared downloads remain available for 10 minutes.</p>
        </div>
        <button className="primary icon-text dictionary-action-button" type="submit" disabled={busy || dictionaryFiles.length === 0}>
          <BookOpen size={16} />
          Prepare Dictionary
        </button>
        {recentPreparedDictionaryDownload && (
          <button className="icon-text recent-download-button prepared-download-button dictionary-action-button" type="button" onClick={onDownloadPreparedDictionaryFile} title={`Download ${recentPreparedDictionaryDownload.filename}`}>
            <Download size={16} />
            Download Prepared Dictionary
          </button>
        )}
        <JobLog jobs={jobs} ariaLabel="Latest dictionary job" />
      </form>
    </section>
  );
}

async function readDroppedEntry(entry: FileSystemEntry, relativePath = ""): Promise<DictionaryInputFile[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([{ file, relativePath: relativePath || undefined }]),
        reject
      );
    });
  }

  const directory = entry as FileSystemDirectoryEntry;
  const entries = await readDirectoryEntries(directory.createReader());
  return (await Promise.all(entries.map((child) => readDroppedEntry(child, `${relativePath}${entry.name}/`)))).flat();
}

async function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
}
