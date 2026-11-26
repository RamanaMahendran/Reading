import { readZip } from "./books.js?v=4";
import { comicMime, openPdf } from "./format-readers.js";

export class OriginalPages {
  constructor(output, status) {
    this.output = output;
    this.status = status;
    this.version = 0;
  }

  clear() {
    this.version++;
    this.task?.cancel();
    this.task = null;
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = null;
    this.output.replaceChildren();
    this.status.textContent = "";
  }

  close() {
    this.clear();
    void this.session?.then(reader => reader.close?.()).catch(() => {});
    this.session = null;
  }

  async show(book, section) {
    this.clear();
    const version = this.version;
    this.status.textContent = "Loading original page…";
    this.session ??= book.visual === "pdf"
      ? openPdf(book.original)
      : book.original.arrayBuffer().then(readZip);
    try {
      const source = await this.session;
      if (version !== this.version) return;
      const page = book.visual === "pdf"
        ? await this.renderPdf(source, section, version)
        : await this.renderComic(source, section, version);
      if (page && version === this.version) {
        this.output.replaceChildren(page);
        this.status.textContent = "";
      }
    } catch (error) {
      if (version === this.version) {
        this.status.textContent = error.message || "This page could not be displayed.";
        void this.session?.then(reader => reader.close?.()).catch(() => {});
        this.session = null;
      }
    }
  }

  async renderPdf(source, section, version) {
    const page = await source.document.getPage(section.page);
    if (version !== this.version) return null;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", section.title);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2.25, 1800 / Math.max(natural.width, natural.height)) });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    this.task = page.render({ canvas, viewport, annotationMode: source.engine.AnnotationMode.DISABLE });
    try { await this.task.promise; }
    finally {
      if (version === this.version) this.task = null;
      page.cleanup();
    }
    return canvas;
  }

  async renderComic(zip, section, version) {
    const bytes = await zip.bytesFor(section.image);
    if (version !== this.version) return null;
    const img = new Image();
    img.alt = section.title;
    this.imageUrl = URL.createObjectURL(new Blob([bytes], { type: comicMime(section.image) }));
    img.src = this.imageUrl;
    try { await img.decode(); }
    catch { throw new Error("This image could not be displayed."); }
    return img;
  }
}
