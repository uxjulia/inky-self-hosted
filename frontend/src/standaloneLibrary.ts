import JSZip from "jszip";

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
  coverUrl?: string | null;
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
  const mediaType = file.type || mediaTypeForFilename(file.name);
  const record: Omit<StoredStandaloneFile, "id"> = {
    title: titleFromFilename(file.name),
    filename: file.name,
    mediaType,
    size: file.size,
    createdAt: now,
    sentAt: null,
    coverUrl: await extractEpubCoverDataUrl(file),
    blob: new Blob([file], { type: mediaType })
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
      if (!(blob instanceof Blob)) {
        reject(new Error("The stored file data is unavailable. Remove this file and add it to Inky again."));
        return;
      }
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

async function extractEpubCoverDataUrl(file: File) {
  if (!file.name.toLowerCase().endsWith(".epub")) return null;

  try {
    const zip = await JSZip.loadAsync(file);
    const containerText = await zip.file("META-INF/container.xml")?.async("text");
    if (!containerText) return null;

    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerText, "application/xml");
    if (hasParserError(containerDoc)) return null;

    const rootfile = firstElementByLocalName(containerDoc, "rootfile");
    const opfPath = rootfile?.getAttribute("full-path");
    if (!opfPath) return null;

    const opfText = await zip.file(opfPath)?.async("text");
    if (!opfText) return null;

    const opfDoc = parser.parseFromString(opfText, "application/xml");
    if (hasParserError(opfDoc)) return null;

    const coverPath = findCoverPath(opfDoc, opfPath);
    if (!coverPath) return null;

    const coverEntry = zip.file(coverPath);
    if (!coverEntry) return null;

    const coverBlob = await coverEntry.async("blob");
    return await blobToDataUrl(new Blob([coverBlob], { type: mediaTypeForFilename(coverPath) }));
  } catch {
    return null;
  }
}

function findCoverPath(opfDoc: Document, opfPath: string) {
  const items = Array.from(opfDoc.getElementsByTagName("*")).filter((element) => localName(element) === "item");
  const coverId = Array.from(opfDoc.getElementsByTagName("*"))
    .find((element) => localName(element) === "meta" && element.getAttribute("name") === "cover")
    ?.getAttribute("content");

  const coverImage = items.find((item) => (item.getAttribute("properties") || "").split(/\s+/).includes("cover-image"));
  if (coverImage) return resolveEpubPath(opfPath, coverImage.getAttribute("href"));

  if (coverId) {
    const epub2Cover = items.find((item) => item.getAttribute("id") === coverId);
    if (epub2Cover) return resolveEpubPath(opfPath, epub2Cover.getAttribute("href"));
  }

  const filenameCover = items.find((item) => {
    const mediaType = item.getAttribute("media-type") || "";
    const href = item.getAttribute("href") || "";
    const id = item.getAttribute("id") || "";
    return mediaType.startsWith("image/") && `${id} ${href}`.toLowerCase().includes("cover");
  });
  return filenameCover ? resolveEpubPath(opfPath, filenameCover.getAttribute("href")) : null;
}

function resolveEpubPath(opfPath: string, href: string | null) {
  if (!href) return null;
  const baseParts = opfPath.split("/");
  baseParts.pop();
  const parts = [...baseParts, ...href.split(/[?#]/, 1)[0].split("/")];
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return resolved.join("/");
}

function firstElementByLocalName(doc: Document, name: string) {
  return Array.from(doc.getElementsByTagName("*")).find((element) => localName(element) === name) || null;
}

function localName(element: Element) {
  return element.localName || element.tagName.split(":").pop() || element.tagName;
}

function hasParserError(doc: Document) {
  return doc.getElementsByTagName("parsererror").length > 0;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}
