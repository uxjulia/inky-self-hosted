import JSZip from "jszip";

export type BrowserOptimizerSettings = {
  filename_render_first: "Book Title" | "Author";
  filename_render_second: "Book Title" | "Author";
  quality: number;
  grayscale: boolean;
  contrast_boost: boolean;
  contrast_factor: number;
  eink_quantize: boolean;
  words_per_reference_page: number;
  split_long_sections: boolean;
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
const crossInkLocationManifestPath = "META-INF/x-locations.json";
const crossInkOptimizerManifestPath = "META-INF/crossink/optimizer-v1.json";
const wordsPerLocation = 64;
const defaultWordsPerReferencePage = 275;
const sectionSplitWordThreshold = 6000;
const orphanIntroWordLimit = 50;
const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const mediaTags = new Set(["audio", "canvas", "embed", "iframe", "image", "img", "object", "picture", "svg", "video"]);

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
  let updatedOpf = processOpf(opfText, opfPath, imageRenameMap, settings);
  if (settings.split_long_sections) {
    progress?.(78, "Splitting long EPUB sections");
    const splitResult = splitLongSpineSections(updatedOpf, opfPath, xhtmlFiles, sectionSplitWordThreshold);
    updatedOpf = splitResult.opfText;
    for (const [path, text] of Object.entries(splitResult.xhtmlFiles)) {
      xhtmlFiles[path] = text;
      out.file(path, text, {
        compression: "DEFLATE",
        compressionOptions: { level: 8 },
        createFolders: false
      });
    }
  }
  out.file(opfPath, updatedOpf, {
    compression: "DEFLATE",
    compressionOptions: { level: 8 },
    createFolders: false
  });

  progress?.(84, "Writing CrossInk metadata");
  const locations = buildCrossInkLocationManifest(updatedOpf, opfPath, xhtmlFiles, settings.words_per_reference_page);
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

async function processImage(
  data: ArrayBuffer,
  device: BrowserOptimizeDevice,
  settings: BrowserOptimizerSettings
): Promise<ImageProcessResult> {
  const dimensions = device === "x4" ? { width: 800, height: 480 } : { width: 792, height: 528 };
  const image = await loadImage(data);
  const scale = Math.min(1, dimensions.width / image.naturalWidth, dimensions.height / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", {
    willReadFrequently: settings.grayscale || settings.contrast_boost || settings.eink_quantize
  });
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
    next = next.replace(
      /<[^>]*item\b[^>]*(?:media-type=["'][^"']*(?:font|opentype)[^"']*["']|href=["'][^"']+\.(?:ttf|otf|woff2?|eot)["'])[^>]*\/?>/gi,
      ""
    );
  }
  if (settings.remove_css) {
    next = next.replace(/<[^>]*item\b[^>]*(?:media-type=["']text\/css["']|href=["'][^"']+\.css["'])[^>]*\/?>/gi, "");
  }
  return next;
}

type SplitPart = {
  path: string;
  text: string;
  anchors: Set<string>;
};

function splitLongSpineSections(
  opfText: string,
  opfPath: string,
  xhtmlFiles: Record<string, string>,
  wordThreshold: number
) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opfText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || wordThreshold <= 0) {
    return { opfText, xhtmlFiles };
  }

  const manifest = firstElementByLocalName(doc, "manifest");
  const spine = firstElementByLocalName(doc, "spine");
  if (!manifest || !spine) return { opfText, xhtmlFiles };

  const idToItem = new Map<string, Element>();
  const existingIds = new Set<string>();
  for (const item of childElements(manifest)) {
    const id = item.getAttribute("id") || "";
    if (id) {
      idToItem.set(id, item);
      existingIds.add(id);
    }
  }

  const relocationMap = new Map<string, string>();
  const nextXhtmlFiles = { ...xhtmlFiles };
  const originalItemrefs = childElements(spine);

  for (const itemref of originalItemrefs) {
    const idref = itemref.getAttribute("idref") || "";
    const item = idToItem.get(idref);
    if (!item) continue;
    const mediaType = (item.getAttribute("media-type") || "").toLowerCase();
    if (mediaType && mediaType !== "application/xhtml+xml" && mediaType !== "text/html") continue;

    const href = item.getAttribute("href") || "";
    const sectionPath = resolvePath(opfPath, safeDecodeURIComponent(href));
    const sectionText = nextXhtmlFiles[sectionPath];
    if (!sectionText) continue;

    const parts = splitXhtmlSection(sectionText, sectionPath, wordThreshold);
    if (parts.length <= 1) continue;

    for (const part of parts) {
      nextXhtmlFiles[part.path] = part.text;
      for (const anchor of part.anchors) {
        relocationMap.set(`${sectionPath}#${anchor}`, part.path);
      }
    }

    let previousRef = itemref;
    for (const [index, part] of parts.slice(1).entries()) {
      const newId = uniqueId(`${idref}-ci-section-${index + 2}`, existingIds);
      const newItem = createElementLike(doc, item);
      for (const attr of Array.from(item.attributes)) {
        if (attr.name !== "id" && attr.name !== "href") newItem.setAttribute(attr.name, attr.value);
      }
      newItem.setAttribute("id", newId);
      newItem.setAttribute("href", relativePath(opfPath, part.path));
      newItem.setAttribute("media-type", item.getAttribute("media-type") || "application/xhtml+xml");
      manifest.appendChild(newItem);

      const newItemref = createElementLike(doc, itemref);
      for (const attr of Array.from(itemref.attributes)) {
        if (attr.name !== "idref") newItemref.setAttribute(attr.name, attr.value);
      }
      newItemref.setAttribute("idref", newId);
      spine.insertBefore(newItemref, previousRef.nextSibling);
      previousRef = newItemref;
    }
  }

  if (relocationMap.size === 0) {
    return { opfText, xhtmlFiles };
  }

  for (const [path, text] of Object.entries(nextXhtmlFiles)) {
    nextXhtmlFiles[path] = rewriteRelocatedAnchorRefs(text, path, relocationMap);
  }

  return {
    opfText: rewriteRelocatedAnchorRefs(new XMLSerializer().serializeToString(doc), opfPath, relocationMap),
    xhtmlFiles: nextXhtmlFiles
  };
}

function splitXhtmlSection(text: string, path: string, wordThreshold: number): SplitPart[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xhtml+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return [{ path, text, anchors: new Set() }];

  const body = firstElementByLocalName(doc, "body");
  if (!body || nodeWordCount(body) <= wordThreshold) return [{ path, text, anchors: new Set() }];

  let splitChain = body.children.length <= 1 ? findSplitChain(body, wordThreshold) : [];
  if (body.children.length > 1) {
    splitChain = findIntroSplitChain(body, wordThreshold);
  }
  const splitTarget = splitChain.length > 0 ? splitChain[splitChain.length - 1] : body;
  const nodes = childElements(splitTarget);
  if (nodes.length <= 1) return [{ path, text, anchors: new Set() }];

  const chunks: Element[][] = [];
  let current: Element[] = [];
  let currentWords = 0;
  for (const node of nodes) {
    const words = nodeWordCount(node);
    if (current.length > 0 && currentWords + words > wordThreshold) {
      chunks.push(current);
      current = [];
      currentWords = 0;
    }
    current.push(node);
    currentWords += words;
  }
  if (current.length > 0) chunks.push(current);
  const mergedChunks = mergeOrphanIntroChunks(chunks, wordThreshold);
  if (mergedChunks.length <= 1) return [{ path, text, anchors: new Set() }];

  return mergedChunks.map((chunk, index) => {
    const partPath = index === 0 ? path : sectionPartPath(path, index + 1);
    return {
      path: partPath,
      text: buildSplitPart(doc, body, splitChain, chunk, index === 0),
      anchors: anchorsInNodes(chunk)
    };
  });
}

function buildSplitPart(
  originalDoc: Document,
  originalBody: Element,
  splitChain: Element[],
  chunk: Element[],
  includePrecedingSiblings: boolean
) {
  const root = originalDoc.documentElement;
  const nextDoc = document.implementation.createDocument(root.namespaceURI, root.tagName);
  const nextRoot = nextDoc.documentElement;
  copyAttributes(root, nextRoot);

  const head = firstElementByLocalName(originalDoc, "head");
  if (head) nextRoot.appendChild(nextDoc.importNode(head, true));

  const nextBody = createElementLike(nextDoc, originalBody);
  copyAttributes(originalBody, nextBody);
  if (includePrecedingSiblings)
    nextBody.textContent =
      originalBody.childNodes[0]?.nodeType === Node.TEXT_NODE ? originalBody.childNodes[0].textContent : "";
  nextRoot.appendChild(nextBody);

  let container = nextBody;
  for (const wrapper of splitChain) {
    if (includePrecedingSiblings) {
      for (const sibling of Array.from(wrapper.parentElement?.children || [])) {
        if (sibling === wrapper) break;
        container.appendChild(nextDoc.importNode(sibling, true));
      }
    }
    const nextWrapper = createElementLike(nextDoc, wrapper);
    copyAttributes(wrapper, nextWrapper);
    container.appendChild(nextWrapper);
    container = nextWrapper;
  }

  for (const node of chunk) {
    container.appendChild(nextDoc.importNode(node, true));
  }

  return new XMLSerializer().serializeToString(nextDoc);
}

function findSplitChain(body: Element, wordThreshold: number) {
  let best: Element | null = null;
  let bestChildCount = 0;
  for (const node of Array.from(body.querySelectorAll("*"))) {
    if (node.children.length <= bestChildCount || nodeWordCount(node) <= wordThreshold) continue;
    best = node;
    bestChildCount = node.children.length;
  }
  if (!best) return [];

  const chain: Element[] = [];
  let node: Element | null = best;
  while (node && node !== body) {
    chain.unshift(node);
    node = node.parentElement;
  }
  return chain;
}

function findIntroSplitChain(body: Element, wordThreshold: number) {
  const nodes = childElements(body);
  for (const [index, node] of nodes.entries()) {
    if (nodeWordCount(node) <= wordThreshold || node.children.length <= 1) continue;
    const preceding = nodes.slice(0, index);
    const following = nodes.slice(index + 1);
    if (preceding.length === 0 || !isOrphanIntroChunk(preceding, wordThreshold)) continue;
    if (following.length > 0 && !allDecorative(following)) continue;
    return findSplitChainWithin(body, node, wordThreshold);
  }
  return [];
}

function findSplitChainWithin(body: Element, start: Element, wordThreshold: number) {
  let best: Element | null = null;
  let bestChildCount = 0;
  for (const node of [start, ...Array.from(start.querySelectorAll("*"))]) {
    if (node.children.length <= bestChildCount || nodeWordCount(node) <= wordThreshold) continue;
    best = node;
    bestChildCount = node.children.length;
  }
  if (!best) return [];

  const chain: Element[] = [];
  let node: Element | null = best;
  while (node && node !== body) {
    chain.unshift(node);
    node = node.parentElement;
  }
  return chain;
}

function mergeOrphanIntroChunks(chunks: Element[][], wordThreshold: number) {
  if (chunks.length <= 1) return chunks;

  const merged: Element[][] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (index < chunks.length - 1 && isOrphanIntroChunk(chunk, wordThreshold)) {
      chunks[index + 1] = [...chunk, ...chunks[index + 1]];
    } else if (index === chunks.length - 1 && merged.length > 0 && isOrphanIntroChunk(chunk, wordThreshold)) {
      merged[merged.length - 1].push(...chunk);
    } else {
      merged.push(chunk);
    }
  }
  return merged;
}

function isOrphanIntroChunk(nodes: Element[], wordThreshold: number) {
  const words = nodes.reduce((total, node) => total + nodeWordCount(node), 0);
  if (words > introWordLimit(wordThreshold)) return false;
  return words === 0 || nodes.some((node) => containsHeadingOrMedia(node));
}

function introWordLimit(wordThreshold: number) {
  return Math.max(1, Math.min(orphanIntroWordLimit, Math.floor(wordThreshold / 20)));
}

function containsHeadingOrMedia(node: Element) {
  return [node, ...Array.from(node.querySelectorAll("*"))].some((element) => {
    const tag = element.localName.toLowerCase();
    return headingTags.has(tag) || mediaTags.has(tag);
  });
}

function allDecorative(nodes: Element[]) {
  return nodes.every((node) => nodeWordCount(node) === 0 && !containsHeadingOrMedia(node));
}

function rewriteRelocatedAnchorRefs(text: string, sourcePath: string, relocationMap: Map<string, string>) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    text,
    sourcePath.toLowerCase().endsWith(".opf") ? "application/xml" : "application/xhtml+xml"
  );
  if (doc.getElementsByTagName("parsererror").length > 0) return text;
  let updated = false;

  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      if (!["href", "src", "xlink:href"].includes(attr.name) || !attr.value.includes("#")) continue;
      const relocated = relocatedAnchorRef(attr.value, sourcePath, relocationMap);
      if (relocated !== attr.value) {
        element.setAttribute(attr.name, relocated);
        updated = true;
      }
    }
  }

  return updated ? new XMLSerializer().serializeToString(doc) : text;
}

function relocatedAnchorRef(value: string, sourcePath: string, relocationMap: Map<string, string>) {
  const [base, anchor] = value.split("#", 2);
  if (!anchor || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(base)) return value;
  const targetPath = base ? resolvePath(sourcePath, safeDecodeURIComponent(base)) : sourcePath;
  const relocatedPath = relocationMap.get(`${targetPath}#${safeDecodeURIComponent(anchor)}`);
  if (!relocatedPath || relocatedPath === targetPath) return value;
  return `${relativePath(sourcePath, relocatedPath)}#${anchor}`;
}

function childElements(element: Element) {
  return Array.from(element.children);
}

function firstElementByLocalName(root: ParentNode, localName: string) {
  return (
    Array.from(root.querySelectorAll("*")).find((element) => element.localName.toLowerCase() === localName) || null
  );
}

function nodeWordCount(node: Element) {
  if (["script", "style"].includes(node.localName.toLowerCase())) return 0;
  return countWords(node.textContent || "");
}

function anchorsInNodes(nodes: Element[]) {
  const anchors = new Set<string>();
  for (const node of nodes) {
    for (const element of [node, ...Array.from(node.querySelectorAll("*"))]) {
      for (const attr of ["id", "name"]) {
        const value = element.getAttribute(attr);
        if (value) anchors.add(value);
      }
    }
  }
  return anchors;
}

function copyAttributes(from: Element, to: Element) {
  for (const attr of Array.from(from.attributes)) {
    to.setAttribute(attr.name, attr.value);
  }
}

function createElementLike(doc: Document, element: Element) {
  return element.namespaceURI
    ? doc.createElementNS(element.namespaceURI, element.tagName)
    : doc.createElement(element.tagName);
}

function sectionPartPath(path: string, index: number) {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? `${path.slice(0, slash + 1)}` : "";
  const basename = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = basename.lastIndexOf(".");
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const ext = dot > 0 ? basename.slice(dot) : "";
  return `${dir}${stem}__ci_section_${index}${ext}`;
}

function uniqueId(base: string, existingIds: Set<string>) {
  const safeBase = base.replace(/[^A-Za-z0-9_.-]/g, "-") || "ci-section";
  if (!existingIds.has(safeBase)) {
    existingIds.add(safeBase);
    return safeBase;
  }
  let index = 2;
  while (existingIds.has(`${safeBase}-${index}`)) index += 1;
  const value = `${safeBase}-${index}`;
  existingIds.add(value);
  return value;
}

function buildCrossInkLocationManifest(
  opfText: string,
  opfPath: string,
  xhtmlFiles: Record<string, string>,
  configuredWordsPerReferencePage = defaultWordsPerReferencePage
) {
  const wordsPerReferencePage = normalizeWordsPerReferencePage(configuredWordsPerReferencePage);
  const spine = parseSpineHrefs(opfText, opfPath);
  if (spine.length === 0) return null;
  let nextLocation = 1;
  let totalWords = 0;
  const chapterGroups = buildChapterGroups(spine, xhtmlFiles, wordsPerReferencePage);
  const entries = spine.map((href, index) => {
    const text = extractVisibleText(xhtmlFiles[href] || "");
    const words = countWords(text);
    const locationCount = Math.ceil(words / wordsPerLocation);
    const startReferencePage = Math.floor(totalWords / wordsPerReferencePage) + 1;
    const referencePageCount = Math.max(1, Math.ceil(words / wordsPerReferencePage));
    const section = {
      index,
      href,
      wordStart: totalWords,
      wordCount: words,
      startLocation: locationCount > 0 ? nextLocation : 0,
      endLocation: locationCount > 0 ? nextLocation + locationCount - 1 : 0,
      startReferencePage: words > 0 ? startReferencePage : 0,
      endReferencePage: words > 0 ? startReferencePage + referencePageCount - 1 : 0,
      chapterGroup: chapterGroups.groupByHref.get(href) ?? index
    };
    nextLocation += locationCount;
    totalWords += words;
    return section;
  });

  return {
    format: "x-locations",
    version: 1,
    generator: "inky-browser-optimizer",
    wordsPerLocation,
    wordsPerReferencePage,
    totalWords,
    totalLocations: Math.max(0, nextLocation - 1),
    totalReferencePages: Math.ceil(totalWords / wordsPerReferencePage),
    spine: entries,
    chapterGroups: chapterGroups.groups
  };
}

function buildChapterGroups(
  spine: string[],
  xhtmlFiles: Record<string, string>,
  wordsPerReferencePage = defaultWordsPerReferencePage
) {
  const byChapterHref = new Map<
    string,
    { href: string; startSpineIndex: number; endSpineIndex: number; wordStart: number; wordCount: number }
  >();
  const groupByHref = new Map<string, number>();
  let totalWords = 0;

  spine.forEach((href, spineIndex) => {
    const chapterHref = originalChapterHref(href);
    const words = countWords(extractVisibleText(xhtmlFiles[href] || ""));
    const group = byChapterHref.get(chapterHref) || {
      href: chapterHref,
      startSpineIndex: spineIndex,
      endSpineIndex: spineIndex,
      wordStart: totalWords,
      wordCount: 0
    };
    group.endSpineIndex = spineIndex;
    group.wordCount += words;
    byChapterHref.set(chapterHref, group);
    totalWords += words;
  });

  const groups = Array.from(byChapterHref.values()).map((group, index) => {
    for (let spineIndex = group.startSpineIndex; spineIndex <= group.endSpineIndex; spineIndex += 1) {
      groupByHref.set(spine[spineIndex], index);
    }
    return {
      index,
      href: group.href,
      startSpineIndex: group.startSpineIndex,
      endSpineIndex: group.endSpineIndex,
      wordStart: group.wordStart,
      wordCount: group.wordCount,
      startReferencePage: group.wordCount > 0 ? Math.floor(group.wordStart / wordsPerReferencePage) + 1 : 0,
      endReferencePage: group.wordCount > 0 ? Math.ceil((group.wordStart + group.wordCount) / wordsPerReferencePage) : 0
    };
  });

  return { groups, groupByHref };
}

function normalizeWordsPerReferencePage(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(10000, Math.round(value))) : defaultWordsPerReferencePage;
}

function originalChapterHref(href: string) {
  return href.replace(/__ci_section_\d+(?=\.[^/.]+$)/, "");
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
