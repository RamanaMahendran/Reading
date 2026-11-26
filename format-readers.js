import { elements, extractBlocks, parseText, partition, readZip, xml } from "./books.js?v=4";

const pdfAssets = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/";
const textLimit = 24 * 1024 * 1024;
const imageTypes = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
const fileExtension = name => name.split(".").at(-1).toLowerCase();
const textValue = (doc, name) => elements(doc, name)[0]?.textContent.trim() || "";
const clean = text => text.replace(/\s+/g, " ").trim();

export async function openPdf(file) {
  let engine;
  try { engine = await import(pdfAssets + "legacy/build/pdf.min.mjs"); }
  catch { throw new Error("The PDF reader could not load. Open the file while online and try again."); }
  engine.GlobalWorkerOptions.workerSrc = pdfAssets + "legacy/build/pdf.worker.min.mjs";
  const task = engine.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: pdfAssets + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: pdfAssets + "standard_fonts/",
    wasmUrl: pdfAssets + "wasm/",
    isEvalSupported: false,
    enableXfa: false
  });
  try {
    const document = await task.promise;
    return { document, engine, close: () => task.destroy() };
  } catch (error) {
    await task.destroy().catch(() => {});
    if (error.name === "PasswordException") throw new Error("This PDF needs a password. Import an unlocked copy.");
    throw new Error("This PDF could not be opened. Check that the file is readable and try again.");
  }
}

function pdfParagraphs(items) {
  const paragraphs = [];
  let lines = [];
  let current = "";
  let previous;
  const endParagraph = () => {
    if (current.trim()) lines.push(current.trim());
    if (lines.length) paragraphs.push(lines.join(" "));
    lines = [];
    current = "";
  };
  for (const item of items) {
    if (!("str" in item)) continue;
    const y = item.transform?.[5];
    const height = Math.max(1, item.height || previous?.height || 10);
    if (previous && Number.isFinite(y) && Math.abs(y - previous.y) > Math.max(height, previous.height) * 1.8) {
      endParagraph();
    } else if (current && previous && Math.abs(y - previous.y) > height * 0.6) {
      lines.push(current.trim());
      current = "";
    }
    current += item.str;
    if (item.hasEOL && current.trim()) {
      lines.push(current.trim());
      current = "";
    }
    if (item.str.trim()) previous = { y, height };
  }
  endParagraph();
  return paragraphs;
}

async function readPdf(file) {
  const pdf = await openPdf(file);
  try {
    const { document, engine } = pdf;
    if (document.numPages > 2500) throw new Error("Choose a PDF of 2,500 pages or fewer.");
    const metadata = await document.getMetadata().catch(() => ({}));
    const permissions = await document.getPermissions().catch(() => null);
    const allowed = !permissions || permissions.includes(engine.PermissionFlag.COPY);
    const sections = [];
    let textSize = 0;
    for (let number = 1; number <= document.numPages; number++) {
      let paragraphs = [];
      if (allowed && textSize < textLimit) {
        let page;
        try {
          page = await document.getPage(number);
          paragraphs = pdfParagraphs((await page.getTextContent()).items);
          textSize += paragraphs.reduce((sum, text) => sum + text.length, 0);
          if (textSize > textLimit) paragraphs = [];
        } catch {
          // A page may still render even when its text layer cannot be read.
        } finally { page?.cleanup(); }
      }
      sections.push({ title: "Page " + number, page: number, paragraphs });
    }
    return { title: metadata.info?.Title, author: metadata.info?.Author, sections, visual: "pdf" };
  } finally { await pdf.close(); }
}

export function comicMime(name) {
  const extension = fileExtension(name);
  return Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : "";
}

async function readComic(file) {
  const zip = readZip(await file.arrayBuffer());
  const names = zip.names.filter(name => comicMime(name) && !/(^|\/)(__MACOSX|[._][^/]*)\//.test(name) && !name.split("/").at(-1).startsWith("."));
  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (names.length > 2000) throw new Error("Choose a CBZ with 2,000 images or fewer.");
  if (names.length) await zip.bytesFor(names[0]);
  return { visual: "cbz", sections: names.map((image, i) => ({ title: "Page " + (i + 1), image, paragraphs: [] })) };
}

async function readWord(file) {
  const zip = readZip(await file.arrayBuffer());
  const body = xml(await zip.text("word/document.xml"));
  const properties = zip.names.includes("docProps/core.xml") ? xml(await zip.text("docProps/core.xml")) : null;
  const lines = elements(body, "p").map(p => clean([...p.getElementsByTagNameNS("*", "*")].map(node => {
    if (node.localName === "t") return node.textContent;
    if (["tab", "br", "cr"].includes(node.localName)) return " ";
    return "";
  }).join("")));
  return {
    title: properties ? textValue(properties, "title") : "",
    author: properties ? textValue(properties, "creator") : "",
    sections: partition(lines.filter(Boolean), "Document")
  };
}

async function readOpenDocument(file) {
  const zip = readZip(await file.arrayBuffer());
  const document = xml(await zip.text("content.xml"));
  const meta = zip.names.includes("meta.xml") ? xml(await zip.text("meta.xml")) : null;
  const body = elements(document, "text")[0];
  const lines = body ? [...body.getElementsByTagNameNS("*", "*")]
    .filter(node => ["p", "h"].includes(node.localName)).map(node => clean(node.textContent)).filter(Boolean) : [];
  return { title: meta ? textValue(meta, "title") : "", author: meta ? textValue(meta, "initial-creator") : "", sections: partition(lines, "Document") };
}

function readFictionBook(text) {
  const doc = xml(text);
  const metadata = elements(doc, "title-info")[0];
  const sections = elements(doc, "body").flatMap((body, i) => {
    const chapters = [...body.children].filter(node => node.localName === "section");
    return (chapters.length ? chapters : [body]).flatMap((chapter, index) => {
      const title = chapter.children[0]?.localName === "title" ? clean(chapter.children[0].textContent) : "";
      const items = [...chapter.getElementsByTagNameNS("*", "*")].filter(node =>
        ["p", "v", "subtitle"].includes(node.localName) && node.parentElement?.localName !== "title"
      ).map(node => clean(node.textContent)).filter(Boolean);
      return partition(items, title || "Section " + (i + index + 1));
    });
  });
  const author = metadata && elements(metadata, "author")[0];
  return {
    title: metadata ? textValue(metadata, "book-title") : "",
    author: author ? ["first-name", "middle-name", "last-name"].map(name => textValue(author, name)).filter(Boolean).join(" ") : "",
    language: metadata ? textValue(metadata, "lang") : "",
    sections
  };
}

function readHtml(text) {
  // Only extract text from an inert template. Never insert imported markup into the page.
  const template = document.createElement("template");
  template.innerHTML = text;
  const title = clean(template.content.querySelector("title")?.textContent || "");
  template.content.querySelectorAll("title").forEach(node => node.remove());
  const data = extractBlocks(template.content);
  return { title, sections: partition(data.items, data.title || "Document") };
}

function markdownText(text) {
  return text
    .replace(/!?\[([^\]]+)\]\([^)\n]+\)/g, "$1")
    .replace(/(\*\*|__|~~)(\S.*?)\1/g, "$2")
    .replace(/(^|\s)([*_])(\S.*?)\2(?=$|[\s.,!?])/g, "$1$3")
    .replace(/(^|\n)[ \t]*\x60{3,}[^\r\n]*/g, "$1");
}

function readMarkdown(text) {
  const sections = [];
  let title = "";
  let heading = "Document";
  let body = [];
  let inCode = false;
  const flush = () => {
    const content = markdownText(body.join("\n")).split(/\n\s*\n/g).map(clean).filter(Boolean);
    sections.push(...partition(content, heading));
    body = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s{0,3}\x60{3,}/.test(line)) inCode = !inCode;
    const header = !inCode && /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!header) { body.push(line); continue; }
    flush();
    heading = markdownText(header[1]);
    title ||= heading;
  }
  flush();
  return { title, sections };
}

function readRtf(text) {
  if (!text.startsWith("{\\rtf")) throw new Error("This is not a readable RTF document.");
  const decoder = new TextDecoder("windows-1252");
  const ignored = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "filetbl", "datastore", "fldinst"]);
  const groups = [];
  let state = { skip: false, unicodeFallback: 1 };
  let fallback = 0;
  let binary = 0;
  const out = [];
  const emit = value => {
    if (state.skip) return;
    const skipped = Math.min(value.length, fallback);
    fallback -= skipped;
    if (value.length > skipped) out.push(value.slice(skipped));
  };
  const tokens = /\{|\}|\\(?:'([0-9a-f]{2})|([a-z]+)(-?\d+)? ?|([^a-z]))|[^\r\n{}\\]+/gi;
  for (const token of text.matchAll(tokens)) {
    if (token.index < binary) continue;
    const [raw, hex, word, param, symbol] = token;
    if (raw === "{") { groups.push(state); state = { ...state }; }
    else if (raw === "}") { state = groups.pop() || state; fallback = 0; }
    else if (hex) emit(decoder.decode(Uint8Array.of(parseInt(hex, 16))));
    else if (symbol === "*") state.skip = true;
    else if (symbol) {
      if ("{}\\".includes(symbol)) emit(symbol);
      else if (symbol === "~") emit(" ");
    } else if (word) {
      if (word === "bin") binary = token.index + raw.length + Number(param);
      if (ignored.has(word)) state.skip = true;
      if (state.skip) continue;
      if (word === "uc") state.unicodeFallback = Math.max(0, Number(param));
      if (word === "u") {
        out.push(String.fromCharCode(Number(param) & 0xffff));
        fallback = state.unicodeFallback;
      }
      if (word === "par" || word === "line") out.push(word === "par" ? "\n\n" : "\n");
      if (word === "tab") out.push(" ");
    } else emit(raw);
  }
  return { sections: parseText(out.join("")) };
}

async function readMobi(file) {
  const { MOBI, isMOBI } = await import("./vendor/mobi.js");
  if (!await isMOBI(file)) throw new Error("This file is not a supported MOBI or Kindle AZW/AZW3 book.");
  const book = await new MOBI({}).open(file);
  const sections = [];
  let textSize = 0;
  for (const section of book.sections) {
    const doc = await section.createDocument();
    const data = extractBlocks(doc.body);
    textSize += data.items.reduce((sum, text) => sum + text.length, 0);
    if (textSize > textLimit) throw new Error("The expanded Kindle text is too large.");
    sections.push(...partition(data.items, data.title || "Section " + (sections.length + 1)));
  }
  const { title, author, language } = book.metadata || {};
  return { title, author: Array.isArray(author) ? author.join(", ") : author, language, sections };
}

export async function readFormat(file, extension) {
  switch (extension) {
    case "pdf": return readPdf(file);
    case "cbz": return readComic(file);
    case "docx": return readWord(file);
    case "odt": return readOpenDocument(file);
    case "fb2": return readFictionBook(await file.text());
    case "html": case "htm": case "xhtml": return readHtml(await file.text());
    case "md": case "markdown": return readMarkdown(await file.text());
    case "rtf": return readRtf(new TextDecoder("windows-1252").decode(await file.arrayBuffer()));
    case "mobi": case "azw": case "azw3": return readMobi(file);
    default: throw new Error("This format is not supported. Choose one of the formats listed under Add a book.");
  }
}
