const base = self.registration.scope;
const namespace = "reading-room:" + base + ":";
const cacheName = namespace + "3";
const pages = [
  "./", "./index.html", "./styles.css?v=3", "./app.js?v=3", "./books.js",
  "./dictionary.js", "./reading-tools.js", "./dictionary.json.gz",
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
  if (request.method !== "GET" || !request.url.startsWith(base)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
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
