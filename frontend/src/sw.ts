/// <reference lib="webworker" />
import {
  precache,
  cleanupOutdatedCaches,
  matchPrecache,
  getCacheKeyForURL,
} from "workbox-precaching";
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };
precache(self.__WB_MANIFEST);
cleanupOutdatedCaches();
const CACHE = "folio-data-v1",
  ASSETS = "folio-reader-assets-v1",
  MAX_CACHE = 200 * 1024 * 1024;
let writes = Promise.resolve();
async function store(req: Request, res: Response) {
  const copy = res.clone();
  writes = writes
    .then(async () => {
      const cache = await caches.open(CACHE);
      await cache.put(req, copy);
      const keys = await cache.keys();
      let total = 0;
      for (let i = keys.length - 1; i >= 0; i--) {
        const response = await cache.match(keys[i]);
        total += Number(response?.headers.get("content-length") || 0);
        if (total > MAX_CACHE) await cache.delete(keys[i]);
      }
    })
    .catch(() => {});
  await writes;
}
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data === "FLUSH")
    event.waitUntil(writes.then(() => event.ports[0]?.postMessage("done")));
});
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== "GET") return;
  if (req.mode !== "navigate" && getCacheKeyForURL(req.url)) {
    event.respondWith(matchPrecache(req).then((r) => r || fetch(req)));
    return;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/pdf/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) event.waitUntil(cache.put(req, res.clone()));
        return res;
      })(),
    );
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(
        async () => (await matchPrecache("/index.html")) || Response.error(),
      ),
    );
    return;
  }
  const metadata =
    /^\/api\/kbs$|^\/api\/kbs\/[^/]+\/entries$|^\/api\/entries\/[^/]+\/comments$/.test(
      url.pathname,
    );
  const content =
    /^\/api\/entries\/[^/]+\/content$/.test(url.pathname) &&
    url.searchParams.has("v") &&
    !req.headers.has("range");
  if (!metadata && !content) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (content) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      try {
        const res = await fetch(req);
        if (res.ok) {
          event.waitUntil(store(req, res));
        }
        return res;
      } catch {
        const hit = await cache.match(req);
        return (
          hit ||
          new Response(
            JSON.stringify({ error: "内容尚未缓存，联网后即可读取" }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          )
        );
      }
    })(),
  );
});
