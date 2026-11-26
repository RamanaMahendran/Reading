const base = self.registration.scope;
const namespace = "reading-room:" + base + ":";
const cacheName = namespace + "4";
const pdfAssets = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/";
const pages = [
  "./", "./index.html", "./styles.css?v=4", "./app.js?v=4", "./books.js?v=4",
  "./dictionary.js", "./reading-tools.js", "./dictionary.json.gz",
  "./format-readers.js", "./original-pages.js", "./vendor/mobi.js",
  "./books/garden.txt", "./books/alice.txt", "./books/holmes.txt",
  "./fonts/carlito-latin-400-normal.woff2", "./fonts/carlito-latin-700-normal.woff2"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const assets = pages.map(path => new Request(new URL(path, base), { cache: "reload" }));
    await cache.addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(namespace) && name !== cacheName).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || (!request.url.startsWith(base) && !request.url.startsWith(pdfAssets))) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    if (request.url.startsWith(pdfAssets)) {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone()).catch(() => {});
      return response;
    }
    if (request.mode === "navigate") {
      try {
        const response = await fetch(request);
        if (response.ok) return response;
      } catch {
        // Read the cached home page when navigation is offline.
      }
      return (await cache.match(base)) || Response.error();
    }
    return (await cache.match(request)) || fetch(request);
  })());
});
