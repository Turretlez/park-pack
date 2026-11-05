// Park Pack offline shell. Bump VERSION whenever app files change.
const VERSION = "parkpack-v12";
const SHELL = ["./", "index.html", "manifest.webmanifest", "firebase-config.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // Network first so updates show up right away; cached copy when offline.
  // no-cache revalidates with the server (a cheap 304) instead of trusting the CDN's 10-minute browser cache.
  e.respondWith(fetch(req.url, {cache:"no-cache", credentials:"same-origin"}).then(res => {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(req, copy));
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
});

// Friend alerts: tapping one opens (or focuses) Park Pack.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window", includeUncontrolled:true}).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
