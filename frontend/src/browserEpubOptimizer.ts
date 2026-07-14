import JSZip from "jszip";

export type BrowserOptimizerSettings = {
  use_original_filename: boolean;
  filename_render_first: string;
  filename_render_second: string;
  quality: number;
  grayscale: boolean;
  contrast_boost: boolean;
  contrast_factor: number;
  eink_quantize: boolean;
  characters_per_reference_page: number;
  split_long_sections: boolean;
  section_split_word_threshold: number;
  section_split_byte_threshold: number;
  section_split_hard_byte_limit: number;
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

type CssFileEntry = {
  data: ArrayBuffer;
  text: string;
  changed: boolean;
};

type UsedSelectors = {
  classes: Set<string>;
  ids: Set<string>;
  elements: Set<string>;
};

const imageExtensionPattern = /\.(png|gif|webp|bmp|jpe?g|svg)$/i;
const xhtmlExtensionPattern = /\.(xhtml|html|htm)$/i;
const cssExtensionPattern = /\.css$/i;
const fontExtensionPattern = /\.(ttf|otf|woff2?|eot)$/i;
const crossInkLocationManifestPath = "META-INF/x-locations.json";
const crossInkOptimizerManifestPath = "META-INF/crossink/optimizer-v1.json";
const wordsPerLocation = 64;
const defaultCharactersPerReferencePage = 1500;
const splitSuffixPattern = /__ci_section_\d{3}(?=\.[^.]+$)/i;

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
  const cssFiles: Record<string, CssFileEntry> = {};
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
      const data = await entry.async("arraybuffer");
      cssFiles[path] = {
        data,
        text: new TextDecoder().decode(data),
        changed: false
      };
      continue;
    }
    if (settings.remove_fonts && fontExtensionPattern.test(path)) continue;

    if (imageExtensionPattern.test(path)) {
      try {
        const result = await processImage(await entry.async("arraybuffer"), device, settings, imageMimeType(path));
        const outputPath = imageRenameMap.get(path) || path;
        out.file(outputPath, result.blob, {
          compression: "DEFLATE",
          compressionOptions: { level: 8 },
          createFolders: false
        });
      } catch {
        imageRenameMap.delete(path);
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
      const processed = processXhtml(text, path, imageRenameMap, settings);
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
  let updatedOpf = processOpf(opfText, opfPath, imageRenameMap, settings);
  const splitResult = splitLongXhtmlSections(xhtmlFiles, settings);
  for (const [path, text] of Object.entries(splitResult.xhtmlFiles)) {
    xhtmlFiles[path] = text;
    out.file(path, text, {
      compression: "DEFLATE",
      compressionOptions: { level: 8 },
      createFolders: false
    });
  }
  updatedOpf = addSplitSectionsToOpf(updatedOpf, opfPath, splitResult.splitSections);
  let remainingCssFiles = cssFiles;
  let cssWasTreeShaken = false;
  if (settings.remove_css) {
    const cssResult = treeShakeCssFiles(cssFiles, xhtmlFiles, updatedOpf, opfPath);
    remainingCssFiles = cssResult.cssFiles;
    updatedOpf = cssResult.opfText;
    cssWasTreeShaken = cssResult.rulesRemoved > 0 || cssResult.filesRemoved > 0;
    for (const [path, text] of Object.entries(cssResult.xhtmlFiles)) {
      xhtmlFiles[path] = text;
      out.file(path, text, {
        compression: "DEFLATE",
        compressionOptions: { level: 8 },
        createFolders: false
      });
    }
  }
  for (const [path, css] of Object.entries(remainingCssFiles)) {
    out.file(path, css.changed ? css.text : css.data, {
      compression: "DEFLATE",
      compressionOptions: { level: 8 },
      createFolders: false
    });
  }
  out.file(opfPath, updatedOpf, {
    compression: "DEFLATE",
    compressionOptions: { level: 8 },
    createFolders: false
  });

  progress?.(84, "Writing CrossInk metadata");
  const locations = buildCrossInkLocationManifest(updatedOpf, opfPath, xhtmlFiles, settings.characters_per_reference_page);
  if (locations) {
    out.file(crossInkLocationManifestPath, JSON.stringify(locations), {
      compression: "DEFLATE",
      compressionOptions: { level: 8 },
      createFolders: false
    });
  }
  out.file(crossInkOptimizerManifestPath, JSON.stringify(buildOptimizerManifest(device, settings, cssWasTreeShaken)), {
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

async function processImage(
  data: ArrayBuffer,
  device: BrowserOptimizeDevice,
  settings: BrowserOptimizerSettings,
  mimeType = ""
): Promise<ImageProcessResult> {
  const dimensions = device === "x4" ? { width: 800, height: 480 } : { width: 792, height: 528 };
  const image = await loadImage(data, mimeType);
  const scale = Math.min(1, dimensions.width / image.naturalWidth, dimensions.height / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", {
    willReadFrequently: settings.grayscale || settings.contrast_boost
  });
  if (!context) throw new Error("Canvas is not available.");
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(image.src);

  if (settings.grayscale || settings.contrast_boost) {
    const imageData = context.getImageData(0, 0, width, height);
    applyImageTone(imageData.data, settings);
    context.putImageData(imageData, 0, 0);
  }

  const blob = await canvasToBlob(canvas, settings.quality);
  return { blob, width, height };
}

function loadImage(data: ArrayBuffer, mimeType = ""): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([data], mimeType ? { type: mimeType } : undefined));
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be decoded."));
    };
    image.src = url;
  });
}

function imageMimeType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "image/jpeg";
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
  const useEinkQuantize = settings.grayscale && settings.eink_quantize;
  for (let index = 0; index < data.length; index += 4) {
    if (!settings.grayscale) {
      data[index] = clampTone((data[index] - 128) * contrastFactor + 128);
      data[index + 1] = clampTone((data[index + 1] - 128) * contrastFactor + 128);
      data[index + 2] = clampTone((data[index + 2] - 128) * contrastFactor + 128);
      continue;
    }

    let value = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    value = clampTone((value - 128) * contrastFactor + 128);
    if (useEinkQuantize) {
      value = quantizeEink(value);
    }
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
}

function clampTone(value: number) {
  return Math.max(0, Math.min(255, value));
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

function processOpf(
  opfText: string,
  opfPath: string,
  imageRenameMap: Map<string, string>,
  settings: BrowserOptimizerSettings
) {
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
    if (
      settings.remove_fonts &&
      (fontExtensionPattern.test(href) || mediaType.startsWith("font/") || mediaType.includes("opentype"))
    ) {
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
    next = next.replace(
      /<[^>]*item\b[^>]*(?:media-type=["'][^"']*(?:font|opentype)[^"']*["']|href=["'][^"']+\.(?:ttf|otf|woff2?|eot)["'])[^>]*\/?>/gi,
      ""
    );
  }
  return next;
}

type SplitSections = Record<string, string[]>;

function sectionSplitPath(path: string, partIndex: number) {
  if (partIndex === 0) return path;
  const dot = path.lastIndexOf(".");
  const suffix = `__ci_section_${String(partIndex + 1).padStart(3, "0")}`;
  return dot > 0 ? `${path.slice(0, dot)}${suffix}${path.slice(dot)}` : `${path}${suffix}.xhtml`;
}

function splitBaseHref(href: string) {
  return href.replace(splitSuffixPattern, "");
}

function isSafeSplitElement(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return true;
  const name = (node as Element).localName.toLowerCase();
  return ["p", "div", "section", "article", "aside", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr"].includes(name);
}

function isHeadingNode(node: Node) {
  return node.nodeType === Node.ELEMENT_NODE && /^h[1-6]$/i.test((node as Element).localName);
}

function keepsSplitCluster(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const element = node as Element;
  const name = element.localName.toLowerCase();
  return ["table", "figure", "svg"].includes(name) || Boolean(element.querySelector("table,figure,svg"));
}

function splitLongXhtmlSections(
  xhtmlFiles: Record<string, string>,
  settings: BrowserOptimizerSettings
): { xhtmlFiles: Record<string, string>; splitSections: SplitSections } {
  if (!settings.split_long_sections) return { xhtmlFiles: {}, splitSections: {} };
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const out: Record<string, string> = {};
  const splitSections: SplitSections = {};
  const wordThreshold = Math.max(1, Math.round(settings.section_split_word_threshold || 2000));
  const byteThreshold = Math.max(4096, Math.round(settings.section_split_byte_threshold || 65536));
  const hardByteLimit = Math.max(byteThreshold, Math.round(settings.section_split_hard_byte_limit || 98304));

  for (const [path, text] of Object.entries(xhtmlFiles)) {
    const visibleText = extractVisibleText(text);
    if (countWords(visibleText) <= wordThreshold && new TextEncoder().encode(text).length <= byteThreshold) continue;
    const doc = parser.parseFromString(text, "application/xhtml+xml");
    if (doc.getElementsByTagName("parsererror").length > 0 || !doc.body || doc.body.childNodes.length < 2) continue;

    const chunks: Node[][] = [];
    let current: Node[] = [];
    let currentWords = 0;
    let currentBytes = 0;
    const flush = () => {
      if (!current.length) return;
      chunks.push(current);
      current = [];
      currentWords = 0;
      currentBytes = 0;
    };

    for (const child of Array.from(doc.body.childNodes)) {
      const childText = child.textContent || "";
      const childWords = countWords(childText);
      const childBytes = new TextEncoder().encode(serializer.serializeToString(child)).length;
      const wouldExceed = current.length > 0 && (currentWords + childWords > wordThreshold || currentBytes + childBytes > byteThreshold);
      const canBreakBefore = current.length > 0 && isSafeSplitElement(child) && !keepsSplitCluster(child) && !isHeadingNode(current[current.length - 1]);
      if (wouldExceed && canBreakBefore) flush();

      current.push(child);
      currentWords += childWords;
      currentBytes += childBytes;

      const canBreakAfter = current.length > 1 && isSafeSplitElement(child) && !keepsSplitCluster(child) && !isHeadingNode(child);
      if (currentBytes >= hardByteLimit && canBreakAfter) flush();
    }
    flush();
    if (chunks.length < 2) continue;

    splitSections[path] = [];
    chunks.forEach((chunk, partIndex) => {
      const partPath = sectionSplitPath(path, partIndex);
      const partDoc = doc.cloneNode(true) as Document;
      while (partDoc.body.firstChild) partDoc.body.removeChild(partDoc.body.firstChild);
      for (const node of chunk) partDoc.body.appendChild(partDoc.importNode(node, true));
      out[partPath] = serializer.serializeToString(partDoc);
      splitSections[path].push(partPath);
    });
  }
  return { xhtmlFiles: out, splitSections };
}

function addSplitSectionsToOpf(opfText: string, opfPath: string, splitSections: SplitSections) {
  if (Object.keys(splitSections).length === 0) return opfText;
  const parser = new DOMParser();
  const doc = parser.parseFromString(opfText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return opfText;
  const manifest = Array.from(doc.getElementsByTagName("manifest"))[0];
  const spine = Array.from(doc.getElementsByTagName("spine"))[0];
  if (!manifest || !spine) return opfText;

  const byPath = new Map<string, { id: string; item: Element }>();
  for (const item of Array.from(doc.getElementsByTagName("item"))) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) byPath.set(resolvePath(opfPath, href), { id, item });
  }
  const usedIds = new Set(Array.from(doc.getElementsByTagName("item")).map((item) => item.getAttribute("id") || ""));
  for (const [originalPath, parts] of Object.entries(splitSections)) {
    const original = byPath.get(originalPath);
    if (!original || parts.length < 2) continue;
    const newIds: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      let id = `${original.id}-ci-${i + 1}`;
      while (usedIds.has(id)) id += "x";
      usedIds.add(id);
      const item = doc.createElement("item");
      item.setAttribute("id", id);
      item.setAttribute("href", relativePath(opfPath, parts[i]));
      item.setAttribute("media-type", "application/xhtml+xml");
      manifest.appendChild(item);
      newIds.push(id);
    }
    const itemref = Array.from(doc.getElementsByTagName("itemref")).find((ref) => ref.getAttribute("idref") === original.id);
    if (!itemref) continue;
    let insertAfter = itemref;
    for (const id of newIds) {
      const ref = doc.createElement("itemref");
      ref.setAttribute("idref", id);
      if (insertAfter.nextSibling) spine.insertBefore(ref, insertAfter.nextSibling);
      else spine.appendChild(ref);
      insertAfter = ref;
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

function treeShakeCssFiles(
  cssFiles: Record<string, CssFileEntry>,
  xhtmlFiles: Record<string, string>,
  opfText: string,
  opfPath: string
) {
  const used = collectUsedSelectors(xhtmlFiles);
  const linkedCss = collectReachableCssPaths(cssFiles, xhtmlFiles);
  const remainingCssFiles: Record<string, CssFileEntry> = {};
  const removedCssPaths = new Set<string>();
  const changedXhtmlFiles: Record<string, string> = {};
  let rulesRemoved = 0;
  let filesRemoved = 0;

  for (const [path, css] of Object.entries(cssFiles)) {
    if (!linkedCss.has(path)) {
      removedCssPaths.add(path);
      filesRemoved += 1;
      continue;
    }

    const cleaned = removeUnusedCssRules(css.text, used);
    rulesRemoved += cleaned.removedRules;
    if (!cleaned.text.trim()) {
      removedCssPaths.add(path);
      filesRemoved += 1;
      continue;
    }

    remainingCssFiles[path] = {
      ...css,
      text: cleaned.text,
      changed: css.changed || cleaned.removedRules > 0
    };
  }

  if (removedCssPaths.size === 0) {
    return {
      cssFiles: remainingCssFiles,
      xhtmlFiles: changedXhtmlFiles,
      opfText,
      rulesRemoved,
      filesRemoved
    };
  }

  for (const [path, text] of Object.entries(xhtmlFiles)) {
    const updated = removeStylesheetLinks(text, path, removedCssPaths);
    if (updated !== text) changedXhtmlFiles[path] = updated;
  }

  return {
    cssFiles: remainingCssFiles,
    xhtmlFiles: changedXhtmlFiles,
    opfText: removeCssItemsFromOpf(opfText, opfPath, removedCssPaths),
    rulesRemoved,
    filesRemoved
  };
}

function collectUsedSelectors(xhtmlFiles: Record<string, string>): UsedSelectors {
  const used: UsedSelectors = {
    classes: new Set<string>(),
    ids: new Set<string>(),
    elements: new Set<string>()
  };
  const parser = new DOMParser();

  for (const text of Object.values(xhtmlFiles)) {
    const doc = parser.parseFromString(text, "text/html");
    for (const element of Array.from(doc.querySelectorAll("*"))) {
      used.elements.add(element.tagName.toLowerCase());
      for (const className of Array.from(element.classList)) used.classes.add(className);
      const id = element.getAttribute("id");
      if (id) used.ids.add(id);
    }
  }

  return used;
}

function collectReachableCssPaths(cssFiles: Record<string, CssFileEntry>, xhtmlFiles: Record<string, string>) {
  const cssPaths = new Set(Object.keys(cssFiles));
  const reachable = new Set<string>();
  const parser = new DOMParser();

  for (const [xhtmlPath, text] of Object.entries(xhtmlFiles)) {
    const doc = parser.parseFromString(text, "text/html");
    for (const link of Array.from(doc.querySelectorAll("link"))) {
      if (!isStylesheetLink(link)) continue;
      const href = link.getAttribute("href") || "";
      const cssPath = resolvePath(xhtmlPath, safeDecodeURIComponent(stripUrlSuffix(href)));
      if (cssPaths.has(cssPath)) reachable.add(cssPath);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const cssPath of Array.from(reachable)) {
      for (const importedPath of collectCssImports(cssFiles[cssPath]?.text || "", cssPath, cssPaths)) {
        if (!reachable.has(importedPath)) {
          reachable.add(importedPath);
          changed = true;
        }
      }
    }
  }

  return reachable;
}

function collectCssImports(cssText: string, cssPath: string, cssPaths: Set<string>) {
  const imports = new Set<string>();
  const importPattern = /@import\s+(?:url\(\s*)?["']?([^'")\s;]+)/gi;
  for (const match of cssText.matchAll(importPattern)) {
    const imported = resolvePath(cssPath, safeDecodeURIComponent(stripUrlSuffix(match[1] || "")));
    if (cssPaths.has(imported)) imports.add(imported);
  }
  return imports;
}

function removeUnusedCssRules(cssText: string, used: UsedSelectors) {
  const source = stripCssComments(cssText);
  let output = "";
  let removedRules = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const open = source.indexOf("{", cursor);
    if (open === -1) {
      output += source.slice(cursor);
      break;
    }

    const close = findMatchingBrace(source, open);
    if (close === -1) {
      output += source.slice(cursor);
      break;
    }

    const selectorStart = findRuleStart(source, cursor, open);
    const selector = source.slice(selectorStart, open).trim();
    const fullRule = source.slice(selectorStart, close + 1);
    output += source.slice(cursor, selectorStart);

    if (!selector || selector.startsWith("@") || selectorMatchesUsed(selector, used)) {
      output += fullRule;
    } else {
      removedRules += 1;
    }

    cursor = close + 1;
  }

  return { text: output.trim(), removedRules };
}

function stripCssComments(cssText: string) {
  return cssText.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findRuleStart(cssText: string, cursor: number, openBrace: number) {
  let index = openBrace - 1;
  while (index >= cursor && cssText[index] !== "}") index -= 1;
  return index + 1;
}

function findMatchingBrace(cssText: string, openBrace: number) {
  let depth = 0;
  for (let index = openBrace; index < cssText.length; index += 1) {
    const char = cssText[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function selectorMatchesUsed(selectorText: string, used: UsedSelectors) {
  for (const selector of splitSelectorList(selectorText)) {
    const trimmed = selector.trim();
    if (!trimmed || ["*", "html", "body"].includes(trimmed)) return true;

    const classes = Array.from(trimmed.matchAll(/\.([a-zA-Z_][\w-]*)/g), (match) => match[1]);
    const ids = Array.from(trimmed.matchAll(/#([a-zA-Z_][\w-]*)/g), (match) => match[1]);
    if (classes.length > 0 || ids.length > 0) {
      if (classes.every((className) => used.classes.has(className)) && ids.every((id) => used.ids.has(id))) {
        return true;
      }
      continue;
    }

    if (trimmed.includes(":") || trimmed.includes("[")) return true;

    const elements = Array.from(trimmed.matchAll(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g), (match) => match[1].toLowerCase());
    if (elements.length === 0 || elements.some((element) => used.elements.has(element))) return true;
  }

  return false;
}

function splitSelectorList(selectorText: string) {
  const selectors: string[] = [];
  let current = "";
  let bracketDepth = 0;
  let parenDepth = 0;
  for (const char of selectorText) {
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (char === "," && bracketDepth === 0 && parenDepth === 0) {
      selectors.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  selectors.push(current);
  return selectors;
}

function removeStylesheetLinks(xhtmlText: string, xhtmlPath: string, removedCssPaths: Set<string>) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtmlText, "application/xhtml+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return xhtmlText;

  let removed = false;
  for (const link of Array.from(doc.querySelectorAll("link"))) {
    if (!isStylesheetLink(link)) continue;
    const href = link.getAttribute("href") || "";
    const cssPath = resolvePath(xhtmlPath, safeDecodeURIComponent(stripUrlSuffix(href)));
    if (removedCssPaths.has(cssPath)) {
      link.remove();
      removed = true;
    }
  }

  return removed ? new XMLSerializer().serializeToString(doc) : xhtmlText;
}

function removeCssItemsFromOpf(opfText: string, opfPath: string, removedCssPaths: Set<string>) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opfText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return opfText;

  let removed = false;
  for (const item of Array.from(doc.getElementsByTagName("item"))) {
    const href = item.getAttribute("href") || "";
    const mediaType = item.getAttribute("media-type") || "";
    if (
      (mediaType === "text/css" || cssExtensionPattern.test(href)) &&
      removedCssPaths.has(resolvePath(opfPath, href))
    ) {
      item.remove();
      removed = true;
    }
  }

  return removed ? new XMLSerializer().serializeToString(doc) : opfText;
}

function isStylesheetLink(link: Element) {
  const rel = (link.getAttribute("rel") || "").toLowerCase().split(/\s+/);
  const type = (link.getAttribute("type") || "").toLowerCase();
  return rel.includes("stylesheet") || type === "text/css";
}

function stripUrlSuffix(value: string) {
  return value.split(/[#?]/, 1)[0];
}

function firstElementByLocalName(root: ParentNode, localName: string) {
  return (
    Array.from(root.querySelectorAll("*")).find((element) => element.localName.toLowerCase() === localName) || null
  );
}

function buildCrossInkLocationManifest(
  opfText: string,
  opfPath: string,
  xhtmlFiles: Record<string, string>,
  configuredCharactersPerReferencePage = defaultCharactersPerReferencePage
) {
  const charactersPerReferencePage = normalizeCharactersPerReferencePage(configuredCharactersPerReferencePage);
  const spine = parseSpineHrefs(opfText, opfPath);
  if (spine.length === 0) return null;
  let nextLocation = 1;
  let totalWords = 0;
  let totalCharacters = 0;
  const splitBases = new Set(spine.map(splitBaseHref).filter((base, index) => base !== spine[index]));
  const groupByBase = new Map(Array.from(splitBases).sort().map((base, index) => [base, index]));
  const chapterGroups = new Map<number, Record<string, string | number>>();
  const entries = spine.map((href, index) => {
    const text = extractVisibleText(xhtmlFiles[href] || "");
    const words = countWords(text);
    const characters = countReferenceCharacters(text);
    const locationCount = Math.ceil(words / wordsPerLocation);
    const startReferencePage = Math.floor(totalCharacters / charactersPerReferencePage) + 1;
    const referencePageCount = Math.max(1, Math.ceil(characters / charactersPerReferencePage));
    const section: Record<string, string | number> = {
      index,
      href,
      wordStart: totalWords,
      wordCount: words,
      characterStart: totalCharacters,
      characterCount: characters,
      startLocation: locationCount > 0 ? nextLocation : 0,
      endLocation: locationCount > 0 ? nextLocation + locationCount - 1 : 0,
      startReferencePage: characters > 0 ? startReferencePage : 0,
      endReferencePage: characters > 0 ? startReferencePage + referencePageCount - 1 : 0
    };
    const baseHref = splitBaseHref(href);
    const chapterGroup = groupByBase.get(baseHref);
    if (chapterGroup != null) {
      section.chapterGroup = chapterGroup;
      const group = chapterGroups.get(chapterGroup) || {
        index: chapterGroup,
        title: relativeBasename(baseHref).replace(/\.[^.]+$/, ""),
        firstSpineIndex: index,
        lastSpineIndex: index,
        startLocation: section.startLocation,
        endLocation: section.endLocation,
        wordStart: totalWords,
        wordCount: 0,
        characterStart: totalCharacters,
        characterCount: 0,
        referencePageStart: section.startReferencePage,
        referencePageEnd: section.endReferencePage
      };
      group.firstSpineIndex = Math.min(Number(group.firstSpineIndex), index);
      group.lastSpineIndex = Math.max(Number(group.lastSpineIndex), index);
      if (Number(section.startLocation) > 0 && (!Number(group.startLocation) || Number(section.startLocation) < Number(group.startLocation))) {
        group.startLocation = section.startLocation;
      }
      group.endLocation = Math.max(Number(group.endLocation), Number(section.endLocation));
      group.wordCount = Number(group.wordCount) + words;
      group.characterCount = Number(group.characterCount) + characters;
      if (Number(section.startReferencePage) > 0 && (!Number(group.referencePageStart) || Number(section.startReferencePage) < Number(group.referencePageStart))) {
        group.referencePageStart = section.startReferencePage;
      }
      group.referencePageEnd = Math.max(Number(group.referencePageEnd), Number(section.endReferencePage));
      chapterGroups.set(chapterGroup, group);
    }
    nextLocation += locationCount;
    totalWords += words;
    totalCharacters += characters;
    return section;
  });

  const manifest: Record<string, unknown> = {
    format: "x-locations",
    version: 1,
    generator: "inky-browser-optimizer",
    referencePageUnit: "character",
    wordsPerLocation,
    charactersPerReferencePage,
    totalWords,
    totalCharacters,
    totalLocations: Math.max(0, nextLocation - 1),
    totalReferencePages: Math.ceil(totalCharacters / charactersPerReferencePage),
    spine: entries
  };
  if (chapterGroups.size > 0) {
    manifest.chapterGroups = Array.from(chapterGroups.values()).sort((a, b) => Number(a.index) - Number(b.index));
  }
  return manifest;
}

function normalizeCharactersPerReferencePage(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(10000, Math.round(value))) : defaultCharactersPerReferencePage;
}

function countReferenceCharacters(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return Array.from(normalized).length;
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

function buildOptimizerManifest(
  device: BrowserOptimizeDevice,
  settings: BrowserOptimizerSettings,
  cssWasTreeShaken: boolean
) {
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
      cssRemoved: cssWasTreeShaken,
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
  if (settings.use_original_filename) return sanitizeFilename(inputFilename);
  const fallbackTitle = metadata.title || inputFilename.replace(/\.epub$/i, "");
  const parts = [
    resolveFilenameRenderValue(settings.filename_render_first, { title: fallbackTitle, author: metadata.author }),
    resolveFilenameRenderValue(settings.filename_render_second, { title: fallbackTitle, author: metadata.author })
  ].filter(Boolean);
  return `${sanitizeFilename(parts.join(" - ") || inputFilename.replace(/\.epub$/i, "book"))}.epub`;
}

function resolveFilenameRenderValue(template: string, metadata: Metadata) {
  return template
    .trim()
    .replaceAll("Book Title", metadata.title || "")
    .replaceAll("Author", metadata.author || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFilename(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "book"
  );
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
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
