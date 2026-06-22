const dbName = "inky-standalone-library";
const dbVersion = 1;
const fileStoreName = "files";

export type StandaloneFileRecord = {
  id: number;
  title: string;
  filename: string;
  mediaType: string;
  size: number;
  createdAt: string;
  sentAt?: string | null;
};

type StoredStandaloneFile = StandaloneFileRecord & {
  blob: Blob;
};

export async function loadStandaloneLibrary(): Promise<StandaloneFileRecord[]> {
  const db = await openStandaloneDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(fileStoreName, "readonly").objectStore(fileStoreName).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const records = (request.result as StoredStandaloneFile[])
        .map(({ blob: _blob, ...record }) => record)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      resolve(records);
    };
  });
}

export async function addStandaloneFile(file: File): Promise<StandaloneFileRecord> {
  const db = await openStandaloneDb();
  const now = new Date().toISOString();
  const record: Omit<StoredStandaloneFile, "id"> = {
    title: titleFromFilename(file.name),
    filename: file.name,
    mediaType: file.type || mediaTypeForFilename(file.name),
    size: file.size,
    createdAt: now,
    sentAt: null,
    blob: file
  };

  return new Promise((resolve, reject) => {
    const request = db.transaction(fileStoreName, "readwrite").objectStore(fileStoreName).add(record);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const { blob: _blob, ...savedRecord } = { ...record, id: Number(request.result) };
      resolve(savedRecord);
    };
  });
}

export async function getStandaloneFile(id: number): Promise<{ record: StandaloneFileRecord; blob: Blob }> {
  const db = await openStandaloneDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(fileStoreName, "readonly").objectStore(fileStoreName).get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const stored = request.result as StoredStandaloneFile | undefined;
      if (!stored) {
        reject(new Error("File not found in local library."));
        return;
      }
      const { blob, ...record } = stored;
      resolve({ record, blob });
    };
  });
}

export async function markStandaloneFileSent(id: number): Promise<void> {
  const db = await openStandaloneDb();
  const current = await getStandaloneFile(id);
  const updated: StoredStandaloneFile = {
    ...current.record,
    sentAt: new Date().toISOString(),
    blob: current.blob
  };

  return new Promise((resolve, reject) => {
    const request = db.transaction(fileStoreName, "readwrite").objectStore(fileStoreName).put(updated);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function deleteStandaloneFile(id: number): Promise<void> {
  const db = await openStandaloneDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(fileStoreName, "readwrite").objectStore(fileStoreName).delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

function openStandaloneDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(dbName, dbVersion);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(fileStoreName)) {
        db.createObjectStore(fileStoreName, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function titleFromFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, "").trim() || filename;
}

function mediaTypeForFilename(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".epub")) return "application/epub+zip";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
