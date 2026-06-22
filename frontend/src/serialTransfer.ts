export type SerialTransferProgress = (percent: number, message: string) => void;
export type SerialTransferDiagnostic = (message: string) => void;

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
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
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
const serialAckTimeoutMs = 45000;
const serialWriteTimeoutMs = 45000;
const serialOpenDrainMs = 200;
const serialCloseTimeoutMs = 1500;
let activeSerialOperation: Promise<unknown> | null = null;

export function serialTransferSupported() {
  return Boolean(navigator.serial);
}

export async function probeSerialDevice(): Promise<Record<string, unknown>> {
  return withSerialOperation(async () => {
    const connection = await openSerialConnection();
    try {
      await connection.write(new Uint8Array([...commandMagic, 0x53]));
      const status = await readUntil(connection, (line) => line.startsWith("STATUS:"), 3000, "USB serial status");
      return { device: "USB Serial", ip: status.replace(/^STATUS:/, "") || "USB" };
    } catch (error) {
      if (error instanceof Error && error.message.includes("Timed out")) {
        throw new Error(
          "USB serial opened, but the reader did not answer Inky's serial transfer protocol. Install CrossInk firmware with USB serial transfer support."
        );
      }
      throw error;
    } finally {
      await connection.close();
    }
  });
}

export async function sendBlobToSerialDevice(
  blob: Blob,
  filename: string,
  destinationPath: string,
  progress?: SerialTransferProgress,
  diagnostic?: SerialTransferDiagnostic
): Promise<SerialTransferResult> {
  return withSerialOperation(async () => {
    const connection = await openSerialConnection();
    const finalName = deviceFilename(filename);
    const devicePath = joinSerialPath(destinationPath, finalName);

    try {
      progress?.(2, "Connected over USB");
      await ensureSerialFolder(connection, destinationPath, progress);
      await writeSerialFile(connection, devicePath, blob, progress, diagnostic);
      progress?.(100, "Sent to device");
      return {
        destination_path: normalizeSerialDestinationPath(destinationPath),
        filename: finalName,
        response: "OK"
      };
    } finally {
      await connection.close();
    }
  });
}

class SerialConnection {
  private buffer: number[] = [];
  private waiters: ((value: number) => void)[] = [];
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readonly pumpPromise: Promise<void>;

  constructor(private readonly port: SerialPort) {
    this.pumpPromise = this.pump();
  }

  async write(data: Uint8Array, timeoutMs = serialWriteTimeoutMs, label = "serial write", onStillWaiting?: () => void) {
    if (!this.port.writable) throw new Error("Serial port is not writable.");
    const writer = this.port.writable.getWriter();
    let didTimeout = false;
    const waitTimer = window.setTimeout(() => onStillWaiting?.(), 3000);
    try {
      await withTimeout(writer.write(data), timeoutMs, label, () => {
        didTimeout = true;
      });
    } catch (error) {
      if (didTimeout) {
        try {
          await writer.abort(error);
        } catch {
          // The port is already going to be closed by the caller.
        }
      }
      throw error;
    } finally {
      window.clearTimeout(waitTimer);
      try {
        writer.releaseLock();
      } catch {
        // Releasing after an aborted write can race with stream shutdown.
      }
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
      await withTimeout(this.pumpPromise, serialCloseTimeoutMs, "serial reader shutdown");
    } catch {
      // The pump handles normal shutdown internally.
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

  async drainInput(timeoutMs = serialOpenDrainMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.buffer.length > 0) {
        this.buffer.length = 0;
        continue;
      }

      try {
        await this.readByte(Math.max(1, deadline - Date.now()));
      } catch (error) {
        if (error instanceof Error && error.message === "Serial read timed out.") return;
        if (error instanceof Error && error.message === "Serial port closed.") return;
        throw error;
      }
    }
  }
}

async function openSerialConnection() {
  if (!navigator.serial) {
    throw new Error("USB serial is not available in this browser. Use Chrome, Edge, or the Inky desktop app.");
  }

  const grantedPorts = await navigator.serial.getPorts();
  const port = grantedPorts.find(isEsp32SerialPort) || await navigator.serial.requestPort({ filters: esp32SerialFilters });
  try {
    await port.open({ baudRate: 115200, bufferSize: 8192 });
  } catch (error) {
    if (error instanceof Error && /busy|already open|access denied|in use/i.test(error.message)) {
      throw new Error("USB serial port is busy. Close any serial monitor or other Inky window using the reader, then try again.");
    }
    throw error;
  }

  const connection = new SerialConnection(port);
  try {
    await connection.drainInput();
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
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
  const response = await readUntil(connection, (line) => line === "OK" || line.startsWith("ERR:"), 5000, `mkdir ${path}`);
  if (response !== "OK" && response !== "ERR:mkdir_failed") throw new Error(response);
}

async function writeSerialFile(
  connection: SerialConnection,
  fullPath: string,
  blob: Blob,
  progress?: SerialTransferProgress,
  diagnostic?: SerialTransferDiagnostic
) {
  const data = new Uint8Array(await blob.arrayBuffer());
  const pathBytes = textEncoder.encode(fullPath);
  const checksum = crc32(data);

  progress?.(8, `Uploading ${fullPath.split("/").pop() || "file"}`);
  await connection.write(new Uint8Array([...commandMagic, 0x57, ...u16le(pathBytes.length), ...pathBytes, ...u32le(data.length)]));
  await readUntil(connection, (line) => {
    if (line.startsWith("ERR:")) throw new Error(line);
    return line === "READY";
  }, 10000, `write ${fullPath}`);

  const chunkSize = 256;
  for (let sent = 0; sent < data.length;) {
    const end = Math.min(sent + chunkSize, data.length);
    await connection.write(data.slice(sent, end), serialWriteTimeoutMs, `serial write at ${formatBytes(sent)} of ${formatBytes(data.length)}`, () => {
      diagnostic?.(`Waiting for browser to write ${formatBytes(sent)} of ${formatBytes(data.length)}`);
    });
    sent = end;
    progress?.(10 + Math.floor((sent / Math.max(1, data.length)) * 85), `Uploading ${formatBytes(sent)} of ${formatBytes(data.length)}`);
    await readAck(
      connection,
      serialAckTimeoutMs,
      `upload ACK after ${formatBytes(sent)} of ${formatBytes(data.length)}`,
      () => {
        diagnostic?.(`Waiting for device to confirm ${formatBytes(sent)} of ${formatBytes(data.length)}`);
      },
      (line) => {
        if (line.startsWith("BUSY:write:")) {
          diagnostic?.(`Device writing to SD (${formatBytes(sent)} of ${formatBytes(data.length)}): ${line}`);
        } else if (line.startsWith("BUSY:read:")) {
          diagnostic?.(`Device waiting for serial bytes (${formatBytes(sent)} of ${formatBytes(data.length)}): ${line}`);
        }
      }
    );
  }

  await connection.write(new Uint8Array(u32le(checksum)));
  const response = await readUntil(connection, (line) => line === "OK" || line.startsWith("ERR:"), 30000, `finish ${fullPath}`);
  if (response !== "OK") throw new Error(response);
}

async function readAck(
  connection: SerialConnection,
  timeoutMs: number,
  label: string,
  onStillWaiting?: () => void,
  onDeviceStatus?: (line: string) => void
) {
  let deadline = Date.now() + timeoutMs;
  let waitTimer = window.setTimeout(() => onStillWaiting?.(), 3000);

  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timed out waiting for ${label}.`);

      let byte: number;
      try {
        byte = await connection.readByte(remaining);
      } catch (error) {
        if (error instanceof Error && error.message === "Serial read timed out.") {
          throw new Error(`Timed out waiting for ${label}.`);
        }
        throw error;
      }
      if (byte === 0x06) return;

      const line = await readLineAfterFirstByte(connection, byte, Math.max(1, deadline - Date.now()));
      if (line.startsWith("BUSY:")) {
        onDeviceStatus?.(line);
        deadline = Date.now() + timeoutMs;
        continue;
      }
      if (!line || isSerialLog(line)) continue;
      if (line.startsWith("ERR:")) throw new Error(`${line} while waiting for ${label}.`);
      throw new Error(`Device returned unexpected serial response while waiting for ${label}: ${line}`);
    }
  } finally {
    window.clearTimeout(waitTimer);
  }
}

async function readLineAfterFirstByte(connection: SerialConnection, firstByte: number, timeoutMs: number) {
  if (firstByte === 0x0a) return "";

  const deadline = Date.now() + timeoutMs;
  let line = firstByte === 0x0d ? "" : String.fromCharCode(firstByte);
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return line;

    const byte = await connection.readByte(remaining);
    if (byte === 0x0a) return line;
    if (byte !== 0x0d) line += String.fromCharCode(byte);
  }
}

async function readUntil(connection: SerialConnection, predicate: (line: string) => boolean, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for ${label} response.`);
    const line = await connection.readLine(remaining);
    if (!line || isSerialLog(line)) continue;
    if (predicate(line)) return line;
  }
}

function isEsp32SerialPort(port: SerialPort) {
  const { usbVendorId, usbProductId } = port.getInfo();
  return usbVendorId === 0x303a && usbProductId === 0x1001;
}

function isSerialLog(line: string) {
  return /^[IWED] \(\d+\)/.test(line) || /^\[\d+\] \[[^\]]+\]/.test(line);
}

async function withSerialOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (activeSerialOperation) {
    throw new Error("Another USB serial operation is already in progress. Wait for it to finish, then try again.");
  }

  const promise = operation();
  activeSerialOperation = promise;
  try {
    return await promise;
  } finally {
    if (activeSerialOperation === promise) activeSerialOperation = null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, onTimeout?: () => void): Promise<T> {
  let timeout = 0;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timeout = window.setTimeout(() => {
        onTimeout?.();
        reject(new Error(`Timed out during ${label}.`));
      }, timeoutMs);
    })
  ]).finally(() => window.clearTimeout(timeout));
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
