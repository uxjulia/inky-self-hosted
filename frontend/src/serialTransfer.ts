export type SerialTransferProgress = (percent: number, message: string) => void;

export type SerialTransferResult = {
  destination_path: string;
  filename: string;
  response: string;
};

type SerialPortInfo = {
  usbVendorId?: number;
  usbProductId?: number;
};

type SerialPort = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
};

type SerialApi = {
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: { filters?: SerialPortInfo[] }): Promise<SerialPort>;
};

declare global {
  interface Navigator {
    serial?: SerialApi;
  }
}

const esp32SerialFilters = [{ usbVendorId: 0x303a, usbProductId: 0x1001 }];
const commandMagic = new Uint8Array([0x43, 0x4d, 0x4e, 0x44]);
const textEncoder = new TextEncoder();
const crcTable = createCrcTable();

export function serialTransferSupported() {
  return Boolean(navigator.serial);
}

export async function probeSerialDevice(): Promise<Record<string, unknown>> {
  const connection = await openSerialConnection();
  try {
    await connection.write(new Uint8Array([...commandMagic, 0x53]));
    const status = await readUntil(connection, (line) => line.startsWith("STATUS:"), 3000);
    return { device: "USB Serial", ip: status.replace(/^STATUS:/, "") || "USB" };
  } finally {
    await connection.close();
  }
}

export async function sendBlobToSerialDevice(
  blob: Blob,
  filename: string,
  destinationPath: string,
  progress?: SerialTransferProgress
): Promise<SerialTransferResult> {
  const connection = await openSerialConnection();
  const finalName = deviceFilename(filename);
  const devicePath = joinSerialPath(destinationPath, finalName);

  try {
    progress?.(2, "Connected over USB");
    await ensureSerialFolder(connection, destinationPath, progress);
    await writeSerialFile(connection, devicePath, blob, progress);
    progress?.(100, "Sent to device");
    return {
      destination_path: normalizeSerialDestinationPath(destinationPath),
      filename: finalName,
      response: "OK"
    };
  } finally {
    await connection.close();
  }
}

class SerialConnection {
  private buffer: number[] = [];
  private waiters: ((value: number) => void)[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(private readonly port: SerialPort) {
    this.pump();
  }

  async write(data: Uint8Array) {
    if (!this.port.writable) throw new Error("Serial port is not writable.");
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  readByte(timeoutMs = 30000): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.buffer.length > 0) {
        resolve(this.buffer.shift() as number);
        return;
      }

      let timer = 0;
      const waiter = (value: number) => {
        window.clearTimeout(timer);
        if (value === -1) reject(new Error("Serial port closed."));
        else resolve(value);
      };

      this.waiters.push(waiter);
      timer = window.setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new Error("Serial read timed out."));
      }, timeoutMs);
    });
  }

  async readLine(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    let line = "";

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Timed out reading serial response.");
      const byte = await this.readByte(remaining);
      if (byte === 0x0a) return line;
      if (byte !== 0x0d) line += String.fromCharCode(byte);
    }
  }

  async close() {
    try {
      await this.reader?.cancel();
    } catch {
      // Ignore close races.
    }
    try {
      await this.port.close();
    } catch {
      // Ignore close races.
    }
  }

  private async pump() {
    if (!this.port.readable) return;
    this.reader = this.port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        for (const byte of value) {
          const waiter = this.waiters.shift();
          if (waiter) waiter(byte);
          else this.buffer.push(byte);
        }
      }
    } catch {
      // The reader is normally cancelled during close.
    } finally {
      this.reader.releaseLock();
      this.reader = null;
      for (const waiter of this.waiters.splice(0)) waiter(-1);
    }
  }
}

async function openSerialConnection() {
  if (!navigator.serial) {
    throw new Error("USB serial is not available in this browser. Use Chrome, Edge, or the Inky desktop app.");
  }

  const grantedPorts = await navigator.serial.getPorts();
  const port = grantedPorts.find(isEsp32SerialPort) || await navigator.serial.requestPort({ filters: esp32SerialFilters });
  await port.open({ baudRate: 115200 });
  return new SerialConnection(port);
}

async function ensureSerialFolder(connection: SerialConnection, destinationPath: string, progress?: SerialTransferProgress) {
  const segments = destinationFolderSegments(destinationPath);
  let current = "/sdcard";

  for (const segment of segments) {
    current = `${current}/${segment}`;
    progress?.(4, `Creating ${current.replace("/sdcard", "") || "/"}`);
    await serialMkdir(connection, current);
  }
}

async function serialMkdir(connection: SerialConnection, path: string) {
  const pathBytes = textEncoder.encode(path);
  await connection.write(new Uint8Array([...commandMagic, 0x4b, ...u16le(pathBytes.length), ...pathBytes]));
  const response = await readUntil(connection, (line) => line === "OK" || line.startsWith("ERR:"), 5000);
  if (response !== "OK" && response !== "ERR:mkdir_failed") throw new Error(response);
}

async function writeSerialFile(
  connection: SerialConnection,
  fullPath: string,
  blob: Blob,
  progress?: SerialTransferProgress
) {
  const data = new Uint8Array(await blob.arrayBuffer());
  const pathBytes = textEncoder.encode(fullPath);
  const checksum = crc32(data);

  progress?.(8, `Uploading ${fullPath.split("/").pop() || "file"}`);
  await connection.write(new Uint8Array([...commandMagic, 0x57, ...u16le(pathBytes.length), ...pathBytes, ...u32le(data.length)]));
  await readUntil(connection, (line) => {
    if (line.startsWith("ERR:")) throw new Error(line);
    return line === "READY";
  }, 10000);

  const chunkSize = 2048;
  for (let sent = 0; sent < data.length;) {
    const end = Math.min(sent + chunkSize, data.length);
    await connection.write(data.slice(sent, end));
    sent = end;
    progress?.(10 + Math.floor((sent / Math.max(1, data.length)) * 85), `Uploading ${formatBytes(sent)} of ${formatBytes(data.length)}`);
    const ack = await connection.readByte(30000);
    if (ack !== 0x06) throw new Error(`Device returned unexpected ACK 0x${ack.toString(16)}.`);
  }

  await connection.write(new Uint8Array(u32le(checksum)));
  const response = await readUntil(connection, (line) => line === "OK" || line.startsWith("ERR:"), 30000);
  if (response !== "OK") throw new Error(response);
}

async function readUntil(connection: SerialConnection, predicate: (line: string) => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Timed out waiting for device response.");
    const line = await connection.readLine(remaining);
    if (!line || isEspLog(line)) continue;
    if (predicate(line)) return line;
  }
}

function isEsp32SerialPort(port: SerialPort) {
  const { usbVendorId, usbProductId } = port.getInfo();
  return usbVendorId === 0x303a && usbProductId === 0x1001;
}

function isEspLog(line: string) {
  return /^[IWED] \(\d+\)/.test(line);
}

function joinSerialPath(destinationPath: string, filename: string) {
  return `${normalizeSerialDestinationPath(destinationPath)}/${filename}`;
}

function normalizeSerialDestinationPath(destinationPath: string) {
  const segments = destinationFolderSegments(destinationPath);
  return segments.length ? `/sdcard/${segments.join("/")}` : "/sdcard";
}

function destinationFolderSegments(destinationPath: string) {
  let normalized = (destinationPath || "/").replace(/\\/g, "/").trim();
  if (!normalized || normalized === ".") return [];
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  if (segments[0]?.toLowerCase() === "sdcard") segments.shift();
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Destination folder cannot contain '..'.");
  }
  return segments;
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
  return textEncoder.encode(value).length;
}

function u16le(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32le(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
}

function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function formatBytes(size: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
