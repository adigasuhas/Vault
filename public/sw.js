/* VAULT service worker — deliberately conservative.
 *
 * Caches immutable static assets only (Next build output, icons, fonts) for
 * faster repeat loads and installability. Navigations and every /api request go
 * straight to the network with NO offline fallback and NO caching — showing
 * stale account balances or letting a mutation "succeed" offline would be worse
 * than an error. */

const CACHE = "vault-static-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(["/icon-192.png", "/icon-512.png", "/manifest.webmanifest"]).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isImmutable = url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname);
  if (!isImmutable) return; // navigations + /api: let the browser hit the network

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
    )
  );
});
