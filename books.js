export const classics = [
  { id: "garden", title: "The Secret Garden", cover: "The Secret Garden", author: "Frances Hodgson Burnett", motif: "❧", source: 113, description: "A locked garden changes life at a Yorkshire manor." },
  { id: "alice", title: "Alice’s Adventures in Wonderland", cover: "Wonderland", author: "Lewis Carroll", motif: "♠", source: 11, description: "Follow Alice down the rabbit hole into a world that makes its own rules." },
  { id: "holmes", title: "The Adventures of Sherlock Holmes", cover: "Sherlock Holmes", author: "Arthur Conan Doyle", motif: "◇", source: 1661, description: "Twelve cases from the files of Sherlock Holmes and Dr. Watson." }
];

const bookLimit = 24 * 1024 * 1024;
const decode = new TextDecoder();
const fail = message => { throw new Error(message); };

function paragraphs(text) {
  return text.split(/\n[\t ]*\n+/).map(block => block.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function partition(items, title, max = 80) {
  const sections = [];
  for (let index = 0; index < items.length; index += max) {
    sections.push({ title: index ? `${title} (continued)` : title, paragraphs: items.slice(index, index + max) });
  }
  return sections;
}

export function parseText(text, type = "") {
  let clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const start = /^\s*\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*[^\n]*$/im.exec(clean);
  if (start) clean = clean.slice(start.index + start[0].length);
  const end = /^\s*(?:\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK|End of (?:the )?Project Gutenberg(?:['’]s | EBook))/im.exec(clean);
  if (end) clean = clean.slice(0, end.index);
  if (!clean.trim()) return [];
  const heading = type === "holmes"
    ? /^[\t ]*((?:ADVENTURE[\t ]+)?[IVXLCDM]+\.[\t ]+[A-Z][A-Z'’ .-]{5,})[\t ]*$/gm
    : /^[\t ]*((?:CHAPTER|PART|BOOK)\s+(?:[IVXLCDM]+|\d+)(?:[.:\s].*)?)[\t ]*$/gim;
  const matches = [...clean.matchAll(heading)].map(match => ({ match, title: match[1].trim() }));
  // Gutenberg tables of contents repeat the real headings before the first chapter.
  const headingKey = title => title.match(/^(?:(?:CHAPTER|PART|BOOK|ADVENTURE)\s+)?[\w]+/i)?.[0].toLowerCase();
  const firstKey = matches.length && headingKey(matches[0].title);
  const repeat = firstKey && matches.findIndex(({ title }, index) => index > 0 && headingKey(title) === firstKey);
  const markers = repeat > 0 ? matches.slice(repeat) : matches;
  if (!markers.length) return partition(paragraphs(clean), "Reading");
  return markers.flatMap(({ match, title }, index) => {
    const content = paragraphs(clean.slice(match.index + match[0].length, markers[index + 1]?.match.index));
    if (type === "garden" && content[0]?.length < 95 && content[0] === content[0].toUpperCase()) {
      title += ` · ${content.shift()}`;
    }
    return content.length ? [{ title, paragraphs: content }] : [];
  });
}

function readZip(buffer) {
  const view = new DataView(buffer);
  const u16 = index => view.getUint16(index, true);
  const u32 = index => view.getUint32(index, true);
  let end = buffer.byteLength - 22;
  while (end >= Math.max(0, buffer.byteLength - 65557)) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === buffer.byteLength) break;
    end--;
  }
  if (end < Math.max(0, buffer.byteLength - 65557)) fail("This file is not a readable EPUB archive.");
  const count = u16(end + 10);
  let cursor = u32(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) fail("The EPUB archive is damaged.");
    const length = u16(cursor + 28);
    if (cursor + 46 + length > end) fail("The EPUB archive is damaged.");
    const name = decode.decode(new Uint8Array(buffer, cursor + 46, length));
    entries.set(name, { flags: u16(cursor + 8), method: u16(cursor + 10), compressed: u32(cursor + 20), size: u32(cursor + 24), offset: u32(cursor + 42) });
    cursor += 46 + length + u16(cursor + 30) + u16(cursor + 32);
  }
  return async name => {
    const entry = entries.get(name);
    if (!entry) fail("An EPUB document is missing.");
    const { flags, method, compressed, size, offset } = entry;
    if (flags & 1) fail("This EPUB is encrypted. Choose a DRM-free copy.");
    if (size > bookLimit || offset + 30 > end || u32(offset) !== 0x04034b50) fail("An EPUB document could not be opened.");
    const firstByte = offset + 30 + u16(offset + 26) + u16(offset + 28);
    if (firstByte + compressed > end) fail("The EPUB archive is damaged.");
    const bytes = new Uint8Array(buffer, firstByte, compressed);
    if (method === 0 && compressed === size) return decode.decode(bytes);
    if (method !== 8) fail("This EPUB uses an unsupported compression format.");
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const output = new Uint8Array(size);
    let index = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (index + value.length > size) fail("The EPUB archive has an invalid file size.");
        output.set(value, index);
        index += value.length;
      }
    } finally {
      await reader.cancel();
    }
    if (index !== size) fail("The EPUB archive is incomplete.");
    return decode.decode(output);
  };
}

function xml(text) {
  const document = new DOMParser().parseFromString(text.replace(/&nbsp;/g, "\u00a0"), "application/xml");
  if (document.getElementsByTagName("parsererror").length) fail("The EPUB contains a document this reader cannot parse.");
  return document;
}

function elements(document, name) {
  return Array.from(document.getElementsByTagNameNS("*", name));
}

function archivePath(relative, base = "") {
  const url = new URL(relative, `https://epub.invalid/${base}`);
  if (url.origin !== "https://epub.invalid") fail("The EPUB references an external document.");
  return decodeURIComponent(url.pathname.slice(1));
}

function epubText(document) {
  const body = elements(document, "body")[0];
  if (!body) return { title: "", items: [] };
  const heading = /^h[1-6]$/;
  const blocks = new Set(["p", "div", "section", "li", "blockquote", "br", "pre", "dt", "dd", "hr", "td", "tr", "figcaption"]);
  const ignored = new Set(["script", "style", "svg", "noscript", "nav"]);
  let title = "";
  let current = "";
  const items = [];
  const flush = () => {
    const text = current.replace(/\s+/g, " ").trim();
    if (text) items.push(text);
    current = "";
  };
  const visit = node => {
    if (node.nodeType === 3 || node.nodeType === 4) { current += node.nodeValue; return; }
    if (node.nodeType !== 1 || ignored.has(node.localName)) return;
    if (heading.test(node.localName)) {
      flush();
      const label = node.textContent.replace(/\s+/g, " ").trim();
      if (!title && items.length === 0) title = label;
      else if (label) items.push(label);
      return;
    }
    const block = blocks.has(node.localName);
    if (block) flush();
    node.childNodes.forEach(visit);
    if (block) flush();
  };
  visit(body);
  flush();
  return { title, items };
}

export async function parseEpub(buffer) {
  const read = readZip(buffer);
  const container = xml(await read("META-INF/container.xml"));
  const packagePath = elements(container, "rootfile")[0]?.getAttribute("full-path");
  if (!packagePath) fail("The EPUB has no book manifest.");
  const manifest = xml(await read(archivePath(packagePath)));
  const meta = name => elements(manifest, name)[0]?.textContent.trim() || "";
  const files = new Map(elements(manifest, "item").map(item => [item.getAttribute("id"), item]));
  const sections = [];
  let total = 0;
  for (const ref of elements(manifest, "itemref")) {
    const item = files.get(ref.getAttribute("idref"));
    const href = item?.getAttribute("href");
    if (!href || item.getAttribute("media-type") !== "application/xhtml+xml") continue;
    const source = await read(archivePath(href, packagePath));
    total += source.length;
    if (total > bookLimit) fail("The expanded EPUB text is too large for this reader.");
    const result = epubText(xml(source));
    if (result?.items.length) sections.push({ title: result.title || `Section ${sections.length + 1}`, paragraphs: result.items });
  }
  return { title: meta("title"), author: meta("creator"), language: meta("language"), sections };
}

export async function importBook(file) {
  if (!file.size || file.size > bookLimit) fail("Choose a book smaller than 24 MB.");
  const extension = file.name.split(".").at(-1).toLowerCase();
  if (!["txt", "epub"].includes(extension)) fail("Choose a DRM-free EPUB or a UTF-8 TXT file.");
  let parsed;
  if (extension === "epub") parsed = await parseEpub(await file.arrayBuffer());
  else {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    parsed = { sections: parseText(text), author: /^Author:[\t ]*(.+)$/im.exec(text)?.[1]?.trim(), title: /^Title:[\t ]*(.+)$/im.exec(text)?.[1]?.trim() };
  }
  if (!parsed.sections.length) fail("This book has no readable text.");
  return {
    id: `local-${crypto.randomUUID()}`,
    title: parsed.title || file.name.replace(/\.[^.]+$/, ""),
    author: parsed.author || "",
    language: parsed.language || "en",
    sections: parsed.sections,
    imported: Date.now()
  };
}

let database;
function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("reading-room", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("books", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

export async function localBooks() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("books").objectStore("books").getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.imported - a.imported));
    request.onerror = () => reject(request.error);
  });
}

export async function saveBook(book) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("books", "readwrite");
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore("books").put(book);
  });
}
