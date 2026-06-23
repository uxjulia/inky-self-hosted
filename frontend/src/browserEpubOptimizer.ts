import JSZip from "jszip";

export type BrowserOptimizerSettings = {
  filename_render_first: "Book Title" | "Author";
  filename_render_second: "Book Title" | "Author";
  quality: number;
  grayscale: boolean;
  contrast_boost: boolean;
  contrast_factor: number;
  eink_quantize: boolean;
  remove_fonts: boolean;
  remove_css: boolean;
  text_cleanup: boolean;
};

export type BrowserOptimizeDevice = "x4" | "x3";
export type BrowserOptimizeProgress = (percent: number, message: string) => void;

export type BrowserOptimizeResult = {
  blob: Blob;
  filename: string;
};

type ImageProcessResult = {
  blob: Blob;
  width: number;
  height: number;
};

type Metadata = {
  title: string;
  author: string;
};

const imageExtensionPattern = /\.(png|gif|webp|bmp|jpe?g)$/i;
const xhtmlExtensionPattern = /\.(xhtml|html|htm)$/i;
const cssExtensionPattern = /\.css$/i;
const fontExtensionPattern = /\.(ttf|otf|woff2?|eot)$/i;
const crossInkLocationManifestPath = "META-INF/crossink-locations.json";
const crossInkOptimizerManifestPath = "META-INF/crossink/optimizer-v1.json";
const wordsPerLocation = 64;
const wordsPerReferencePage = 250;

export async function optimizeEpubInBrowser(
  file: Blob,
  filename: string,
  device: BrowserOptimizeDevice,
  settings: BrowserOptimizerSettings,
  progress?: BrowserOptimizeProgress
): Promise<BrowserOptimizeResult> {
  progress?.(5, "Reading EPUB");
  const zip = await JSZip.loadAsync(file);
  const out = new JSZip();
  const entries = Object.entries(zip.files);
  const imageRenameMap = buildImageRenameMap(entries);
  const xhtmlFiles: Record<string, string> = {};
  const cssFiles = new Set<string>();
  let opfPath = "";
  let opfText = "";

  const mimetype = zip.file("mimetype");
  if (mimetype) {
    out.file("mimetype", await mimetype.async("arraybuffer"), {
      compression: "STORE",
      createFolders: false
    });
  }

  progress?.(18, "Preparing images");
  for (const [path, entry] of entries) {
    if (entry.dir || path === "mimetype") continue;
    if (path === crossInkLocationManifestPath || path === crossInkOptimizerManifestPath) continue;
    const lower = path.toLowerCase();
    if (lower.endsWith(".opf")) {
      opfPath = path;
      opfText = await entry.async("text");
      continue;
    }
    if (cssExtensionPattern.test(path)) {
      cssFiles.add(path);
      if (settings.remove_css) continue;
    }
    if (settings.remove_fonts && fontExtensionPattern.test(path)) continue;

    if (imageExtensionPattern.test(path)) {
      try {
        const result = await processImage(await entry.async("arraybuffer"), device, settings);
        const outputPath = imageRenameMap.get(path) || path;
        out.file(outputPath, result.blob, {
          compression: "DEFLATE",
          compressionOptions: { level: 8 },
          createFolders: false
        });
      } catch {
        out.file(path, await entry.async("arraybuffer"), {
          compression: "DEFLATE",
          compressionOptions: { level: 8 },
          createFolders: false
        });
      }
      continue;
    }

    if (xhtmlExtensionPattern.test(path)) {
      const text = await entry.async("text");
      const processed = processXhtml(text, path, imageRenameMap, cssFiles, settings);
      xhtmlFiles[path] = processed;
      out.file(path, processed, {
        compression: "DEFLATE",
        compressionOptions: { level: 8 },
        createFolders: false
      });
      continue;
    }

    out.file(path, await entry.async("arraybuffer"), {
      compression: "DEFLATE",
      compressionOptions: { level: 8 },
      createFolders: false
    });
  }

  if (!opfPath || !opfText) {
    throw new Error("Could not find the EPUB package document.");
  }

  progress?.(72, "Updating EPUB metadata");
  const updatedOpf = processOpf(opfText, opfPath, imageRenameMap, settings);
  out.file(opfPath, updatedOpf, {
    compression: "DEFLATE",
    compressionOptions: { level: 8 },
    createFolders: false
  });

  progress?.(84, "Writing CrossInk metadata");
  const locations = buildCrossInkLocationManifest(updatedOpf, opfPath, xhtmlFiles);
  if (locations) {
    out.file(crossInkLocationManifestPath, JSON.stringify(locations), {
      compression: "DEFLATE",
      compressionOptions: { level: 8 },
      createFolders: false
    });
  }
  out.file(crossInkOptimizerManifestPath, JSON.stringify(buildOptimizerManifest(device, settings)), {
    compression: "DEFLATE",
    compressionOptions: { level: 8 },
    createFolders: false
  });

  progress?.(94, "Packaging EPUB");
  const blob = await out.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 8 }
  });

  const metadata = extractMetadata(updatedOpf);
  return {
    blob,
    filename: formatOutputFilename(filename, metadata, settings)
  };
}

function buildImageRenameMap(entries: [string, JSZip.JSZipObject][]) {
  const renameMap = new Map<string, string>();
  for (const [path, entry] of entries) {
    if (!entry.dir && imageExtensionPattern.test(path)) {
      renameMap.set(path, path.replace(imageExtensionPattern, ".jpg"));
    }
  }
  return renameMap;
}

async function processImage(data: ArrayBuffer, device: BrowserOptimizeDevice, settings: BrowserOptimizerSettings): Promise<ImageProcessResult> {
  const dimensions = device === "x4" ? { width: 800, height: 480 } : { width: 792, height: 528 };
  const image = await loadImage(data);
  const scale = Math.min(1, dimensions.width / image.naturalWidth, dimensions.height / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: settings.grayscale || settings.contrast_boost || settings.eink_quantize });
  if (!context) throw new Error("Canvas is not available.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(image.src);

  if (settings.grayscale || settings.contrast_boost || settings.eink_quantize) {
    const imageData = context.getImageData(0, 0, width, height);
    applyImageTone(imageData.data, settings);
    context.putImageData(imageData, 0, 0);
  }

  const blob = await canvasToBlob(canvas, settings.quality);
  return { blob, width, height };
}

function loadImage(data: ArrayBuffer): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([data]));
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be decoded."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Image could not be encoded."));
      },
      "image/jpeg",
      quality / 100
    );
  });
}

function applyImageTone(data: Uint8ClampedArray, settings: BrowserOptimizerSettings) {
  const contrastFactor = settings.contrast_boost ? settings.contrast_factor : 1;
  for (let index = 0; index < data.length; index += 4) {
    let value = settings.grayscale
      ? 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
      : (data[index] + data[index + 1] + data[index + 2]) / 3;
    value = (value - 128) * contrastFactor + 128;
    value = Math.max(0, Math.min(255, value));
    if (settings.eink_quantize) {
      value = quantizeEink(value);
    }
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
}

function quantizeEink(value: number) {
  if (value < 64) return 0;
  if (value < 128) return 85;
  if (value < 192) return 170;
  return 255;
}

function processXhtml(
  text: string,
  path: string,
  imageRenameMap: Map<string, string>,
  cssFiles: Set<string>,
  settings: BrowserOptimizerSettings
) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xhtml+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return settings.text_cleanup ? cleanTextContent(text) : text;
  }

  for (const element of Array.from(doc.querySelectorAll("[src], [href], image"))) {
    rewriteReference(element, "src", path, imageRenameMap);
    rewriteReference(element, "href", path, imageRenameMap);
    rewriteReference(element, "xlink:href", path, imageRenameMap);
  }

  if (settings.remove_css) {
    for (const link of Array.from(doc.querySelectorAll("link"))) {
      const href = link.getAttribute("href") || "";
      const rel = (link.getAttribute("rel") || "").toLowerCase();
      if (rel.includes("stylesheet") || cssFiles.has(resolvePath(path, href))) {
        link.remove();
      }
    }
  }

  const serialized = new XMLSerializer().serializeToString(doc);
  return settings.text_cleanup ? cleanTextContent(serialized) : serialized;
}

function rewriteReference(element: Element, attr: string, basePath: string, imageRenameMap: Map<string, string>) {
  const value = element.getAttribute(attr);
  if (!value) return;
  const [href, suffix = ""] = value.split(/([?#].*)/, 2);
  const resolved = resolvePath(basePath, decodeURIComponent(href));
  const renamed = imageRenameMap.get(resolved);
  if (!renamed) return;
  element.setAttribute(attr, relativePath(basePath, renamed) + suffix);
}

function processOpf(opfText: string, opfPath: string, imageRenameMap: Map<string, string>, settings: BrowserOptimizerSettings) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opfText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return processOpfRegex(opfText, imageRenameMap, settings);
  }

  for (const item of Array.from(doc.getElementsByTagName("item"))) {
    const href = item.getAttribute("href") || "";
    const resolved = resolvePath(opfPath, href);
    const mediaType = item.getAttribute("media-type") || "";
    const renamed = imageRenameMap.get(resolved);
    if (renamed) {
      item.setAttribute("href", relativePath(opfPath, renamed));
      item.setAttribute("media-type", "image/jpeg");
    }
    if (settings.remove_fonts && (fontExtensionPattern.test(href) || mediaType.startsWith("font/") || mediaType.includes("opentype"))) {
      item.remove();
    }
    if (settings.remove_css && (cssExtensionPattern.test(href) || mediaType === "text/css")) {
      item.remove();
    }
  }

  return new XMLSerializer().serializeToString(doc);
}

function processOpfRegex(opfText: string, imageRenameMap: Map<string, string>, settings: BrowserOptimizerSettings) {
  let next = opfText;
  for (const [from, to] of imageRenameMap) {
    next = next.split(escapeXml(relativeBasename(from))).join(escapeXml(relativeBasename(to)));
  }
  if (settings.remove_fonts) {
    next = next.replace(/<[^>]*item\b[^>]*(?:media-type=["'][^"']*(?:font|opentype)[^"']*["']|href=["'][^"']+\.(?:ttf|otf|woff2?|eot)["'])[^>]*\/?>/gi, "");
  }
  if (settings.remove_css) {
    next = next.replace(/<[^>]*item\b[^>]*(?:media-type=["']text\/css["']|href=["'][^"']+\.css["'])[^>]*\/?>/gi, "");
  }
  return next;
}

function buildCrossInkLocationManifest(opfText: string, opfPath: string, xhtmlFiles: Record<string, string>) {
  const spine = parseSpineHrefs(opfText, opfPath);
  if (spine.length === 0) return null;
  let nextLocation = 1;
  let nextReferencePage = 1;
  const sections = spine.map((href) => {
    const text = extractVisibleText(xhtmlFiles[href] || "");
    const words = countWords(text);
    const locationCount = Math.ceil(words / wordsPerLocation);
    const referencePageCount = Math.max(1, Math.ceil(words / wordsPerReferencePage));
    const section = {
      href,
      words,
      startLocation: locationCount > 0 ? nextLocation : 0,
      endLocation: locationCount > 0 ? nextLocation + locationCount - 1 : 0,
      startReferencePage: nextReferencePage,
      endReferencePage: nextReferencePage + referencePageCount - 1
    };
    nextLocation += locationCount;
    nextReferencePage += referencePageCount;
    return section;
  });

  return {
    format: "crossink-locations",
    version: 1,
    generator: "inky-browser-optimizer",
    wordsPerLocation,
    wordsPerReferencePage,
    totalLocations: Math.max(0, nextLocation - 1),
    totalReferencePages: Math.max(0, nextReferencePage - 1),
    sections
  };
}

function parseSpineHrefs(opfText: string, opfPath: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opfText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return [];
  const manifest = new Map<string, string>();
  for (const item of Array.from(doc.getElementsByTagName("item"))) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, resolvePath(opfPath, href));
  }
  return Array.from(doc.getElementsByTagName("itemref"))
    .map((itemref) => manifest.get(itemref.getAttribute("idref") || ""))
    .filter((href): href is string => Boolean(href));
}

function extractVisibleText(xhtml: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtml, "text/html");
  doc.querySelectorAll("script, style, nav").forEach((node) => node.remove());
  return doc.body?.textContent || "";
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildOptimizerManifest(device: BrowserOptimizeDevice, settings: BrowserOptimizerSettings) {
  return {
    format: "crossink-optimizer",
    version: 1,
    generator: "inky-browser-optimizer",
    target: {
      device,
      width: device === "x4" ? 800 : 792,
      height: device === "x4" ? 480 : 528
    },
    features: {
      htmlNormalized: settings.text_cleanup,
      cssFlattened: false,
      cssRemoved: settings.remove_css,
      fontsRemoved: settings.remove_fonts,
      xLocations: true,
      prebuiltPxc: false
    }
  };
}

function cleanTextContent(text: string) {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\u2026/g, "...")
    .replace(/[ \t]+\n/g, "\n");
}

function extractMetadata(opfText: string): Metadata {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opfText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return { title: "", author: "" };
  return {
    title: textFromFirst(doc, "title"),
    author: textFromFirst(doc, "creator")
  };
}

function textFromFirst(doc: Document, localName: string) {
  const element = Array.from(doc.getElementsByTagName("*")).find((node) => node.localName.toLowerCase() === localName);
  return element?.textContent?.trim() || "";
}

function formatOutputFilename(inputFilename: string, metadata: Metadata, settings: BrowserOptimizerSettings) {
  const values: Record<BrowserOptimizerSettings["filename_render_first"], string> = {
    "Book Title": metadata.title || inputFilename.replace(/\.epub$/i, ""),
    Author: metadata.author
  };
  const parts = [values[settings.filename_render_first], values[settings.filename_render_second]].filter(Boolean);
  return `${sanitizeFilename(parts.join(" - ") || inputFilename.replace(/\.epub$/i, "book"))}.epub`;
}

function sanitizeFilename(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "book";
}

function resolvePath(basePath: string, href: string) {
  if (!href) return basePath;
  const baseParts = basePath.split("/");
  baseParts.pop();
  for (const segment of href.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") baseParts.pop();
    else baseParts.push(segment);
  }
  return baseParts.join("/");
}

function relativePath(fromFile: string, toFile: string) {
  const from = fromFile.split("/");
  from.pop();
  const to = toFile.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].join("/");
}

function relativeBasename(path: string) {
  return path.split("/").pop() || path;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
