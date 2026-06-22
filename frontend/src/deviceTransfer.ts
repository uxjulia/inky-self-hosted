export type DeviceTransferProgress = (percent: number, message: string) => void;

export type DeviceTransferResult = {
  device_url: string;
  destination_path: string;
  filename: string;
  created_folders: string[];
  response: string;
};

export async function probeStandaloneDevice(deviceUrl: string): Promise<Record<string, unknown>> {
  const base = normalizeDeviceUrl(deviceUrl);
  const response = await fetch(`${base}/api/status`);
  await raiseForDeviceResponse(response, "Device probe failed");
  return response.json();
}

export async function sendBlobToDevice(
  blob: Blob,
  filename: string,
  mediaType: string,
  deviceUrl: string,
  destinationPath: string,
  progress?: DeviceTransferProgress
): Promise<DeviceTransferResult> {
  const base = normalizeDeviceUrl(deviceUrl);
  const normalizedDestination = normalizeDestinationPath(destinationPath);
  const createdFolders = await ensureDeviceFolder(base, normalizedDestination);
  const finalName = deviceFilename(filename);
  const tempName = temporaryUploadName(finalName);
  const tempPath = joinDeviceFolder(normalizedDestination, tempName);
  const finalPath = joinDeviceFolder(normalizedDestination, finalName);

  try {
    progress?.(10, `Uploading ${finalName}`);
    const uploadResponse = await postFileToDevice(base, blob, mediaType, normalizedDestination, tempName);
    await raiseForDeviceResponse(uploadResponse, "Device upload failed");

    progress?.(95, "Finalizing on device");
    let renameResponse = await postDeviceForm(base, "/rename", { path: tempPath, name: finalName });
    const renameText = await renameResponse.clone().text();
    if (renameResponse.status === 409 && renameText.toLowerCase().includes("target already exists")) {
      await deleteDeviceFileIfPresent(base, finalPath);
      renameResponse = await postDeviceForm(base, "/rename", { path: tempPath, name: finalName });
    }
    await raiseForDeviceResponse(renameResponse, "Device finalize failed");

    progress?.(100, "Sent to device");
    return {
      device_url: base,
      destination_path: normalizedDestination,
      filename: finalName,
      created_folders: createdFolders,
      response: await uploadResponse.text()
    };
  } catch (error) {
    await cleanupDeviceFile(base, tempPath);
    throw error;
  }
}

async function ensureDeviceFolder(base: string, destinationPath: string) {
  const createdFolders: string[] = [];
  let parent = "/";

  for (const segment of destinationFolderSegments(destinationPath)) {
    const response = await postDeviceForm(base, "/mkdir", { path: parent, name: segment });
    const text = await response.clone().text();
    if (response.status === 400 && text.toLowerCase().includes("already exists")) {
      parent = joinDeviceFolder(parent, segment);
      continue;
    }
    await raiseForDeviceResponse(response, "Device folder creation failed");
    parent = joinDeviceFolder(parent, segment);
    createdFolders.push(parent);
  }

  return createdFolders;
}

async function postFileToDevice(base: string, blob: Blob, mediaType: string, destinationPath: string, uploadName: string) {
  const formData = new FormData();
  formData.append("file", new Blob([blob], { type: mediaType || "application/octet-stream" }), uploadName);
  return fetch(`${base}/upload?path=${encodeURIComponent(destinationPath)}`, {
    method: "POST",
    body: formData
  });
}

async function postDeviceForm(base: string, path: string, data: Record<string, string>) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data)
  });
}

async function deleteDeviceFileIfPresent(base: string, path: string) {
  const response = await postDeviceForm(base, "/delete", { path });
  const text = await response.clone().text();
  if (response.ok || text.toLowerCase().includes("not found")) return;
  await raiseForDeviceResponse(response, "Device overwrite cleanup failed");
}

async function cleanupDeviceFile(base: string, path: string) {
  try {
    await postDeviceForm(base, "/delete", { path });
  } catch {
    // Best-effort cleanup only.
  }
}

async function raiseForDeviceResponse(response: Response, prefix: string) {
  if (response.ok) return;
  const detail = (await response.text()).trim() || response.statusText || `HTTP ${response.status}`;
  throw new Error(`${prefix} (${response.status}): ${detail}`);
}

function normalizeDeviceUrl(deviceUrl: string) {
  const trimmed = deviceUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Device host is required.");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function normalizeDestinationPath(destinationPath: string) {
  let normalized = (destinationPath || "/").replace(/\\/g, "/").trim();
  if (!normalized || normalized === ".") return "/";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/+$/, "");
  return normalized || "/";
}

function destinationFolderSegments(destinationPath: string) {
  const segments = normalizeDestinationPath(destinationPath).split("/").filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Destination folder cannot contain '..'.");
  }
  return segments;
}

function joinDeviceFolder(parent: string, child: string) {
  const normalizedParent = normalizeDestinationPath(parent);
  return normalizedParent === "/" ? `/${child}` : `${normalizedParent}/${child}`;
}

function temporaryUploadName(filename: string) {
  return deviceFilename(`inky-upload-${crypto.randomUUID().slice(0, 8)}-${filename}`);
}

function deviceFilename(filename: string, maxBytes = 255) {
  const trimmed = filename.trim().replace(/^[ .]+|[ .]+$/g, "");
  const extensionStart = safeExtensionStart(trimmed);
  if (extensionStart !== null) {
    const extension = trimmed.slice(extensionStart);
    const base = deviceFilenamePart(trimmed.slice(0, extensionStart), maxBytes - byteLength(extension));
    if (base) return `${base}${extension}`;
  }
  return deviceFilenamePart(filename, maxBytes);
}

function safeExtensionStart(filename: string) {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot + 1 >= filename.length) return null;
  const extension = filename.slice(dot);
  if (byteLength(extension) > 16 || !/^[A-Za-z0-9]+$/.test(extension.slice(1))) return null;
  return dot;
}

function deviceFilenamePart(filename: string, maxBytes: number) {
  let result = "";
  for (const rawChar of filename.replace(/^[ .]+/, "")) {
    const char = /[/\\:*?"<>|]/.test(rawChar) || rawChar.charCodeAt(0) < 32 ? "_" : rawChar;
    const candidate = `${result}${char}`;
    if (byteLength(candidate) > maxBytes) break;
    result = candidate;
  }
  return result.replace(/[ .]+$/, "") || "book";
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}
