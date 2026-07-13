// P14 — minimal service worker for PWA installability (and the Android TWA
// prerequisite). It claims control and has a fetch handler (an installability
// criterion) but deliberately does NOT cache — a no-op pass-through avoids
// serving stale content. Offline caching can be layered on later.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Pass-through: no respondWith(), so the browser performs its normal network fetch.
});
