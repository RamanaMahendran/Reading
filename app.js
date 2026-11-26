import { classics, importBook, localBooks, parseText, saveBook } from "./books.js?v=4";
import { lookupOffline } from "./dictionary.js";
import { findPassages, readingPercent } from "./reading-tools.js";
import { OriginalPages } from "./original-pages.js";

const $ = id => document.getElementById(id);
const originalPages = new OriginalPages($("original-page"), $("original-page-status"));
const element = (tag, text = "", className = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};
const key = "reading-room-v1";
function readState() {
  try { return JSON.parse(localStorage.getItem(key)) || {}; }
  catch { return {}; }
}
const saved = { locations: {}, words: {}, bookmarks: {}, ...readState() };
const settings = saved.settings = { theme: "paper", size: "12", speed: "1", voice: "", ...saved.settings };
if (!["12", "17", "25", "30"].includes(settings.size)) settings.size = "12";
function persist() {
  try { localStorage.setItem(key, JSON.stringify(saved)); return true; }
  catch { $("announcement").textContent = "This browser could not save your changes."; return false; }
}
const imported = new Map();
const loaded = new Map();
const embeddedBooks = $("embedded-books");
const importsReady = localBooks().then(books => books.forEach(book => imported.set(book.id, book))).catch(() => {});
let openBook;
let originalMode = false;
let bookHasText = false;
let chapter = 0;
let routeVersion = 0;
let scrollFrame = 0;
let restoring = false;
let selectedWord;
let bookmarkPosition;
let lookupSequence = 0;
const wordPattern = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const speech = window.speechSynthesis;
let speechVersion = 0;
let audio = null;
let speaking = false;
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

function cover(book) {
  const tile = element("div", "", "cover");
  tile.dataset.book = book.id;
  tile.setAttribute("aria-hidden", "true");
  tile.append(element("span", book.motif || "❧", "cover-motif"), element("strong", book.cover || book.title.slice(0, 40)), element("small", book.author || "My library"));
  return tile;
}

function bookUrl(book) { return `#read/${book.id}`; }
function progressLabel(percent) { return `${percent}% through`; }
function shelfLink(book) {
  const link = element("a", "", "book");
  link.href = bookUrl(book);
  const info = element("div");
  info.append(element("h3", book.title));
  if (book.author) info.append(element("p", book.author));
  const position = saved.locations[book.id];
  const label = position ? (position.percent > 0 ? progressLabel(position.percent) : "Continue reading") : "Open book";
  info.append(element("small", label));
  link.append(cover(book), info);
  return link;
}

function renderLibrary() {
  const previous = classics.find(book => book.id === saved.last) || imported.get(saved.last);
  const book = previous || classics[0];
  const copy = element("div");
  copy.append(
    element("p", previous ? "Continue reading" : "Featured book", "eyebrow"),
    element("h2", book.title),
    element("p", previous ? book.author : book.description, "summary")
  );
  const percent = saved.locations[book.id]?.percent;
  if (percent > 0) copy.append(element("p", progressLabel(percent), "hero-progress"));
  const actions = element("div", "", "hero-actions");
  const read = element("a", previous ? "Resume reading" : "Start reading", "button button-primary");
  read.href = bookUrl(book);
  actions.append(read);
  copy.append(actions);
  $("hero").replaceChildren(copy, cover(book));
  $("classics").replaceChildren(...classics.map(shelfLink));
  $("my-books").hidden = imported.size === 0;
  $("imports").replaceChildren(...Array.from(imported.values(), shelfLink));
}

function renderWords() {
  const list = $("word-list");
  list.replaceChildren();
  const entries = Object.values(saved.words).sort((a, b) => a.word.localeCompare(b.word));
  if (!entries.length) list.append(element("p", "Words you save from the reader will appear here."));
  for (const entry of entries) {
    const card = element("article", "", "word-entry");
    card.append(element("h2", entry.word), element("p", entry.definitions[0].text));
    if (entry.context) card.append(element("p", entry.context, "context"));
    const remove = element("button", "Remove", "button button-outline");
    remove.setAttribute("aria-label", `Remove ${entry.word}`);
    remove.addEventListener("click", () => {
      delete saved.words[entry.word];
      persist();
      renderWords();
    });
    card.append(remove);
    list.append(card);
  }
}

async function getBook(id) {
  if (loaded.has(id)) return loaded.get(id);
  const classic = classics.find(item => item.id === id);
  if (!classic) { await importsReady; return imported.get(id); }
  let source;
  if (embeddedBooks) source = JSON.parse(embeddedBooks.textContent)[classic.id];
  else {
    const response = await fetch(`./books/${classic.id}.txt`);
    if (!response.ok) throw new Error("The book could not load. Check your connection and reopen it.");
    source = await response.text();
  }
  const sections = parseText(source, classic.id);
  if (!sections.length) throw new Error("The book has no readable text.");
  const book = { ...classic, sections, language: "en" };
  loaded.set(id, book);
  return book;
}

function currentLocation() {
  if (!$("fixed-page").hidden) return { chapter, index: 0, offset: 0 };
  const topLine = Math.min(105, innerHeight / 5);
  const paragraphs = $("pages").children;
  let index = Array.prototype.findIndex.call(paragraphs, node => node.getBoundingClientRect().bottom > topLine);
  if (index < 0) index = Math.max(0, paragraphs.length - 1);
  const rect = paragraphs[index]?.getBoundingClientRect();
  return { chapter, index, offset: rect ? Math.max(0, topLine - rect.top) : 0 };
}

function remember(position = currentLocation()) {
  if (!openBook || restoring) return;
  const paragraph = $("pages").children[position.index];
  const height = paragraph?.getBoundingClientRect().height;
  const fraction = height > 0 ? Math.max(0, Math.min(1, position.offset / height)) : 0;
  storePosition(position, fraction);
}

function storePosition(position, fraction = 0) {
  const percent = openBook.visual
    ? Math.round((position.chapter + 1) * 100 / openBook.sections.length)
    : readingPercent(openBook, position, fraction);
  saved.locations[openBook.id] = { ...position, percent };
  saved.last = openBook.id;
  $("reading-progress").value = percent;
  $("reading-percent").textContent = progressLabel(percent);
  persist();
}

function updatePageMode() {
  const section = openBook.sections[chapter];
  const hasText = section.paragraphs.length > 0;
  const showOriginal = Boolean(openBook.visual && (originalMode || !hasText));
  $("fixed-page").hidden = !showOriginal;
  $("pages").hidden = showOriginal;
  $("reader-tip").hidden = showOriginal;
  $("toggle-original").hidden = !openBook.visual || !hasText;
  $("toggle-original").textContent = showOriginal ? "Reading text" : "Original page";
  $("fixed-page-note").hidden = hasText;
  $("fixed-page-note").textContent = "This page has no selectable text.";
  if (showOriginal) void originalPages.show(openBook, section);
  else originalPages.clear();
}

function chapterChange(index, position = null) {
  chapter = index;
  const section = openBook.sections[chapter];
  window.CSS?.highlights?.delete("reading-search");
  $("chapter-count").textContent = `${openBook.visual ? "Page" : "Section"} ${chapter + 1} of ${openBook.sections.length}`;
  $("chapter-title").textContent = section.title;
  $("chapter-title").hidden = Boolean(openBook.visual);
  $("pages").replaceChildren(...section.paragraphs.map(text => element("p", text)));
  for (const bookmark of saved.bookmarks[openBook.id] || []) {
    if (bookmark.chapter === chapter) $("pages").children[bookmark.index]?.setAttribute("data-bookmarked", "");
  }
  $("prev-chapter").disabled = chapter === 0;
  $("next-chapter").disabled = chapter === openBook.sections.length - 1;
  $("prev-chapter").textContent = openBook.visual ? "Previous page" : "Previous chapter";
  $("next-chapter").textContent = openBook.visual ? "Next page" : "Next chapter";
  updatePageMode();
  const selected = position && $("pages").children[position.index];
  restoring = true;
  if (!$("pages").hidden && selected && (position.index || position.offset)) {
    const top = scrollY + selected.getBoundingClientRect().top;
    window.scrollTo(0, top + Math.min(position.offset || 0, selected.offsetHeight - 1) - Math.min(105, innerHeight / 5));
  } else window.scrollTo(0, 0);
  requestAnimationFrame(() => { restoring = false; });
}

async function route() {
  const version = ++routeVersion;
  if (openBook && !$("reader").hidden && !audio) remember();
  clearAudio();
  originalPages.close();
  openBook = null;
  originalMode = false;
  bookHasText = false;
  const [view, id] = location.hash.slice(1).split("/");
  const inReader = view === "read" && Boolean(id);
  $("reader").hidden = !inReader;
  $("library").hidden = inReader || view === "words";
  $("words").hidden = view !== "words";
  $("library-link").setAttribute("aria-current", $("library").hidden ? "false" : "page");
  $("words-link").setAttribute("aria-current", view === "words" ? "page" : "false");
  if (!inReader) {
    document.title = "Reading Room";
    window.scrollTo(0, 0);
    if (view === "words") renderWords();
    else {
      renderLibrary();
      await importsReady;
      if (routeVersion === version) renderLibrary();
    }
    return;
  }
  $("reader-content").hidden = true;
  setReaderNavigation(false);
  $("reader-status").textContent = "Opening book…";
  try {
    const book = await getBook(id);
    if (routeVersion !== version) return;
    if (!book) throw new Error("This book is not in the library on this device.");
    openBook = book;
    bookHasText = book.sections.some(section => section.paragraphs.length > 0);
    $("player").hidden = !bookHasText;
    $("book-title").textContent = book.title;
    $("book-author").textContent = book.author;
    document.title = `${book.title} | Reading Room`;
    $("reader-status").textContent = "";
    $("reader-content").hidden = false;
    setReaderNavigation(true);
    const position = saved.locations[id];
    const index = Math.min(book.sections.length - 1, Math.max(0, position?.chapter || 0));
    chapterChange(index, position);
    if (position && Number.isFinite(position.percent)) {
      $("reading-progress").value = position.percent;
      $("reading-percent").textContent = progressLabel(position.percent);
      saved.last = id;
      persist();
    } else storePosition({ chapter: index, index: position?.index || 0, offset: position?.offset || 0 });
    paintPlayer();
  } catch (error) {
    if (routeVersion === version) $("reader-status").textContent = error.message || "Could not open this book.";
  }
}

function setReaderNavigation(enabled) {
  for (const id of ["open-contents", "open-bookmarks"]) $(id).disabled = !enabled;
  $("open-find").disabled = !enabled || !bookHasText;
}

function navigateChapter(index, position = null) {
  if (!openBook?.sections[index]) return;
  clearAudio();
  chapterChange(index, position);
  storePosition({ chapter: index, index: position?.index || 0, offset: position?.offset || 0 });
}

function showPassage(hit) {
  $("find-dialog").close();
  originalMode = false;
  navigateChapter(hit.chapter, { index: hit.index, offset: 0 });
  const paragraph = $("pages").children[hit.index];
  paragraph.setAttribute("data-search-match", "");
  const range = document.createRange();
  range.setStart(paragraph.firstChild, hit.start);
  range.setEnd(paragraph.firstChild, hit.end);
  if (window.CSS?.highlights && window.Highlight) CSS.highlights.set("reading-search", new Highlight(range));
  requestAnimationFrame(() => window.scrollTo(0, scrollY + range.getBoundingClientRect().top - innerHeight / 3));
}

function searchCurrentBook(event) {
  event.preventDefault();
  if (!openBook) return;
  const { results, more } = findPassages(openBook, $("find-query").value);
  $("find-status").textContent = results.length
    ? (more ? `First ${results.length} matching passages. Refine your search for more specific results.` : `${results.length} matching ${results.length === 1 ? "passage" : "passages"}`)
    : "No matching passages.";
  $("find-results").replaceChildren(...results.map(hit => {
    const row = element("li");
    const jump = element("button", "", "passage");
    const snippet = element("span");
    snippet.append(document.createTextNode(hit.before), element("mark", hit.match), document.createTextNode(hit.after));
    jump.append(element("strong", hit.title), snippet);
    jump.addEventListener("click", () => showPassage(hit));
    row.append(jump);
    return row;
  }));
}

function bookmarksFor(book) { return saved.bookmarks[book.id] || []; }
function samePlace(a, b) { return a.chapter === b.chapter && a.index === b.index; }

function renderBookmarks() {
  const book = openBook;
  const entries = bookmarksFor(book);
  $("bookmarks-list").replaceChildren(...entries.map((bookmark, index) => {
    const section = book.sections[bookmark.chapter];
    const text = section?.paragraphs[bookmark.index];
    const row = element("li", "", "bookmark-row");
    const jump = element("button", "", "passage");
    const excerpt = text?.slice(0, 115) || (section && book.visual ? "" : "This passage is unavailable.");
    jump.append(element("strong", section?.title || "Saved spot"));
    if (excerpt) jump.append(element("span", excerpt));
    if (bookmark.note) jump.append(element("span", bookmark.note, "bookmark-note"));
    jump.disabled = !section || (!text && !book.visual);
    jump.addEventListener("click", () => {
      $("bookmarks-dialog").close();
      navigateChapter(bookmark.chapter, bookmark);
    });
    const remove = element("button", "Remove", "button button-outline");
    remove.setAttribute("aria-label", `Remove bookmark ${index + 1}`);
    remove.addEventListener("click", () => {
      saved.bookmarks[book.id] = entries.filter(entry => entry !== bookmark);
      if (bookmark.chapter === chapter) $("pages").children[bookmark.index]?.removeAttribute("data-bookmarked");
      persist();
      renderBookmarks();
    });
    row.append(jump, remove);
    return row;
  }));
  const existing = entries.find(entry => samePlace(entry, bookmarkPosition));
  $("bookmark-status").textContent = entries.length ? "" : "No bookmarks yet.";
  $("bookmark-note").value = existing?.note || "";
  $("save-bookmark").textContent = existing ? "Update bookmark" : "Bookmark this spot";
}

function saveCurrentBookmark(event) {
  event.preventDefault();
  const entries = bookmarksFor(openBook);
  const bookmark = { ...bookmarkPosition, note: $("bookmark-note").value.trim() };
  saved.bookmarks[openBook.id] = [bookmark, ...entries.filter(entry => !samePlace(entry, bookmark))];
  if (bookmark.chapter === chapter) $("pages").children[bookmark.index]?.setAttribute("data-bookmarked", "");
  if (persist()) {
    renderBookmarks();
    $("bookmark-status").textContent = "Bookmark saved.";
  } else $("bookmark-status").textContent = "This browser couldn’t save the bookmark.";
}

function setupOfflineReading() {
  if (embeddedBooks || !window.isSecureContext || !navigator.serviceWorker || !("caches" in window)) return;
  const button = $("enable-offline");
  const status = $("offline-status");
  $("offline-options").hidden = false;
  const cacheKey = "reading-room:" + new URL("./", location.href).href + ":4";
  async function showReady() {
    if (!navigator.serviceWorker.controller || !await caches.has(cacheKey)) return false;
    const cache = await caches.open(cacheKey);
    if (!await cache.match(new URL("./dictionary.json.gz", location.href))) return false;
    button.hidden = true;
    status.textContent = "Ready to read offline on this device.";
    return true;
  }
  void showReady().catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => void showReady().catch(() => {}));
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Saving the app, classics, and dictionary…";
    let timeout;
    try {
      await navigator.serviceWorker.register("./sw.js");
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => { timeout = setTimeout(reject, 45000); })
      ]);
      if (!await showReady()) status.textContent = "Finishing offline setup…";
    } catch {
      status.textContent = "Couldn’t save for offline reading. Try again while online.";
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
    }
  });
}

function applySettings() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty("--reader-size", `${settings.size}px`);
  $("theme").value = settings.theme;
  $("text-size").value = settings.size;
  $("speed").value = settings.speed;
}

function refreshVoices() {
  const select = $("voice");
  select.replaceChildren(new Option("Device default", ""));
  for (const voice of speech?.getVoices() || []) {
    select.add(new Option(`${voice.name} · ${voice.lang}`, voice.voiceURI));
  }
  select.value = settings.voice;
  if (select.selectedIndex < 0) select.selectedIndex = 0;
}

function highlight(index) {
  $("pages").querySelector("[data-speaking]")?.removeAttribute("data-speaking");
  if (index != null) $("pages").children[index]?.setAttribute("data-speaking", "");
}

function paintPlayer(status) {
  $("play").disabled = !speech;
  $("play").textContent = speaking ? "Pause" : audio ? "Resume" : "Listen";
  $("stop").disabled = !audio;
  $("audio-status").textContent = status || (!speech ? "Audio unavailable in this browser" : speaking ? "Reading aloud" : audio ? "Paused" : "Read aloud");
}

function clearAudio(status) {
  speechVersion++;
  speech?.cancel();
  audio = null;
  speaking = false;
  highlight(null);
  paintPlayer(status);
}

function speechChunk(text, start) {
  const limit = 180;
  if (text.length - start <= limit) return text.slice(start);
  const front = text.slice(start, start + limit);
  const sentence = [...front.matchAll(/[.!?;:]\s+/g)].at(-1);
  const cut = sentence && sentence.index >= 35 ? sentence.index + sentence[0].length : front.lastIndexOf(" ");
  return front.slice(0, cut > 0 ? cut : limit);
}

function speakNext(version) {
  if (!openBook || version !== speechVersion || !speaking) return;
  const items = openBook.sections[chapter].paragraphs;
  if (audio.index >= items.length) {
    const next = openBook.sections.findIndex((section, index) => index > chapter && section.paragraphs.length);
    if (next < 0) {
      if (!items.length) { clearAudio("No selectable text remains."); return; }
      storePosition({ chapter, index: items.length - 1, offset: 0 }, 1);
      clearAudio("Finished listening");
      return;
    }
    chapterChange(next);
    audio.index = 0;
    audio.offset = 0;
  }
  const text = openBook.sections[chapter].paragraphs[audio.index];
  const chunk = speechChunk(text, audio.offset);
  const utterance = new SpeechSynthesisUtterance(chunk.trim());
  utterance.lang = openBook.language;
  utterance.rate = Number(settings.speed);
  const voice = speech.getVoices().find(item => item.voiceURI === settings.voice);
  if (voice) utterance.voice = voice;
  // Retain the active utterance while the browser is reading it.
  audio.utterance = utterance;
  highlight(audio.index);
  const paragraph = $("pages").children[audio.index];
  if (paragraph && !document.querySelector("dialog[open]") && paragraph.getBoundingClientRect().top > innerHeight * 0.75) {
    paragraph.scrollIntoView({ block: "start" });
  }
  storePosition({ chapter, index: audio.index, offset: 0 }, audio.offset / text.length);
  utterance.onend = () => {
    if (version !== speechVersion) return;
    audio.offset += chunk.length;
    if (!text.slice(audio.offset).trim()) { audio.offset = 0; audio.index++; }
    speakNext(version);
  };
  utterance.onerror = () => {
    if (version !== speechVersion) return;
    speaking = false;
    paintPlayer("Audio paused. Tap Resume to retry.");
  };
  speech.speak(utterance);
}

function toggleAudio() {
  if (!openBook || !speech || !bookHasText) return;
  if (speaking) {
    speechVersion++;
    speaking = false;
    speech.cancel();
    paintPlayer();
    return;
  }
  if (originalMode) {
    originalMode = false;
    updatePageMode();
  }
  audio ||= { index: currentLocation().index, offset: 0 };
  speaking = true;
  paintPlayer();
  speakNext(++speechVersion);
}

function setSpeechSetting(name, value) {
  settings[name] = value;
  persist();
  if (!speaking) return;
  const version = ++speechVersion;
  speech.cancel();
  speakNext(version);
}

function wordAtPoint(event) {
  const paragraph = event.target.closest("p");
  if (!paragraph || window.getSelection()?.toString().trim()) return;
  let node, offset;
  if (document.caretPositionFromPoint) {
    const point = document.caretPositionFromPoint(event.clientX, event.clientY);
    node = point?.offsetNode;
    offset = point?.offset;
  } else {
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    node = range?.startContainer;
    offset = range?.startOffset;
  }
  if (node?.nodeType !== Node.TEXT_NODE || node.parentElement !== paragraph) return;
  const text = node.nodeValue;
  const word = [...text.matchAll(wordPattern)].find(match => offset >= match.index && offset <= match.index + match[0].length);
  if (!word) return;
  // A caret can snap to the nearest word when the user taps the right margin.
  const range = document.createRange();
  range.setStart(node, word.index);
  range.setEnd(node, word.index + word[0].length);
  if (![...range.getClientRects()].some(rect => event.clientX >= rect.left - 2 && event.clientX <= rect.right + 2 && event.clientY >= rect.top && event.clientY <= rect.bottom)) return;
  const start = Math.max(0, word.index - 85);
  const end = Math.min(text.length, word.index + word[0].length + 85);
  return { word: word[0], context: `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}` };
}

function openLookup(result) {
  const dialog = $("definition-dialog");
  if (!dialog.open) dialog.showModal();
  $("lookup-input").value = result?.word || "";
  $("definition-content").replaceChildren();
  $("definition-context").hidden = true;
  $("save-word").hidden = true;
  if (result) lookup(result.word, result.context);
  else $("lookup-input").focus();
}

async function lookup(raw, context = "") {
  const sequence = ++lookupSequence;
  const word = raw.toLowerCase().trim().replaceAll("’", "'").replace(/\s+/g, " ");
  const display = $("definition-content");
  $("save-word").hidden = true;
  selectedWord = null;
  $("definition-context").textContent = context;
  $("definition-context").hidden = !context;
  if (!/^[a-z]+(?:[' -][a-z]+)*$/.test(word)) {
    display.textContent = "Enter an English word or phrase.";
    return;
  }
  display.replaceChildren(element("p", `Looking up “${word}”…`));
  try {
    const result = await lookupOffline(word);
    if (sequence !== lookupSequence) return;
    if (!result) { display.textContent = `“${word}” isn’t in the offline dictionary. Try another spelling or the base form.`; return; }
    display.replaceChildren(element("h3", result.headword || word));
    const list = element("ol");
    for (const definition of result.definitions) {
      const line = element("li");
      if (definition.part) line.append(element("em", `${definition.part} · `));
      line.append(document.createTextNode(definition.text));
      list.append(line);
    }
    display.append(list);
    selectedWord = { ...result, context };
    $("save-word").hidden = false;
    $("save-word").disabled = Object.hasOwn(saved.words, word);
    $("save-word").textContent = $("save-word").disabled ? "Saved" : "Save word";
  } catch {
    if (sequence === lookupSequence) display.textContent = "The built-in dictionary couldn’t open. Try reopening Reading Room in an up-to-date browser.";
  }
}

document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
$("open-import").addEventListener("click", () => $("import-dialog").showModal());
$("book-file").addEventListener("change", async event => {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  input.disabled = true;
  $("import-status").textContent = "Opening your book…";
  try {
    const book = await importBook(file);
    await saveBook(book);
    imported.set(book.id, book);
    $("import-dialog").close();
    location.hash = bookUrl(book);
    $("import-status").textContent = "";
  } catch (error) {
    $("import-status").textContent = error.message || "This browser could not import the book.";
  } finally {
    input.value = "";
    input.disabled = false;
  }
});
$("open-contents").addEventListener("click", () => {
  $("contents-list").replaceChildren(...openBook.sections.map((section, index) => {
    const row = element("li");
    const button = element("button", section.title, "button button-outline");
    if (index === chapter) button.setAttribute("aria-current", "location");
    button.addEventListener("click", () => { $("contents-dialog").close(); navigateChapter(index); });
    row.append(button);
    return row;
  }));
  $("contents-dialog").showModal();
});
$("open-find").addEventListener("click", () => {
  $("find-query").value = "";
  $("find-results").replaceChildren();
  $("find-status").textContent = "";
  $("find-dialog").showModal();
  $("find-query").focus();
});
$("find-form").addEventListener("submit", searchCurrentBook);
$("open-bookmarks").addEventListener("click", () => {
  bookmarkPosition = currentLocation();
  renderBookmarks();
  $("bookmarks-dialog").showModal();
});
$("bookmark-form").addEventListener("submit", saveCurrentBookmark);
$("open-settings").addEventListener("click", () => { refreshVoices(); $("settings-dialog").showModal(); });
$("toggle-original").addEventListener("click", () => {
  clearAudio();
  originalMode = !originalMode;
  updatePageMode();
});
$("text-size").addEventListener("change", event => { settings.size = event.target.value; applySettings(); persist(); });
$("theme").addEventListener("change", event => { settings.theme = event.target.value; applySettings(); persist(); });
$("speed").addEventListener("change", event => setSpeechSetting("speed", event.target.value));
$("voice").addEventListener("change", event => setSpeechSetting("voice", event.target.value));
speech?.addEventListener("voiceschanged", refreshVoices);
$("play").addEventListener("click", toggleAudio);
$("stop").addEventListener("click", () => clearAudio());
$("prev-chapter").addEventListener("click", () => navigateChapter(chapter - 1));
$("next-chapter").addEventListener("click", () => navigateChapter(chapter + 1));
$("open-lookup").addEventListener("click", () => openLookup());
$("pages").addEventListener("click", event => { const hit = wordAtPoint(event); if (hit) openLookup(hit); });
$("lookup-form").addEventListener("submit", event => { event.preventDefault(); lookup($("lookup-input").value); });
$("definition-dialog").addEventListener("close", () => { lookupSequence++; });
$("save-word").addEventListener("click", () => {
  if (!selectedWord) return;
  Object.defineProperty(saved.words, selectedWord.word, { value: selectedWord, enumerable: true, configurable: true, writable: true });
  if (persist()) {
    $("save-word").textContent = "Saved";
    $("save-word").disabled = true;
  }
});
window.addEventListener("hashchange", route);
window.addEventListener("scroll", () => {
  if (!openBook || restoring || speaking || audio || scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    if (!speaking && !audio) remember();
  });
}, { passive: true });
window.addEventListener("pagehide", () => { if (!speaking && !audio) remember(); });
applySettings();
route();
setupOfflineReading();
