// The two headers for WebAssembly threads on GitHub Pages (docs/development.md, "WebAssembly"). GitHub Pages cannot
// send Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy, so this service worker adds them to each
// answer of the site, as serve.py does on this computer. The pattern is coi-serviceworker (github.com/gzuidhof).
//
// The same file runs in two places. In the page, it registers itself as the service worker and loads the page
// again when the worker is active: the first load has one thread (pkg), the second load is cross-origin isolated
// and has threads (pkg-threads). In the service worker, it adds the headers. A page that already has the headers
// (serve.py) does nothing here.
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("fetch", (e) => {
    const r = e.request;
    if (r.cache === "only-if-cached" && r.mode !== "same-origin") return;
    e.respondWith(fetch(r).then((res) => {
      if (res.status === 0) return res;   // an opaque answer: it cannot change
      const h = new Headers(res.headers);
      h.set("Cross-Origin-Embedder-Policy", "require-corp");
      h.set("Cross-Origin-Opener-Policy", "same-origin");
      h.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }));
  });
} else if (!window.crossOriginIsolated && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
    // the worker is from an earlier visit, but it does not control this load (for example after a hard reload)
    if (reg.active && !navigator.serviceWorker.controller) location.reload();
    reg.addEventListener("updatefound", () => reg.installing.addEventListener("statechange", (e) => {
      if (e.target.state === "activated") location.reload();
    }));
  }).catch(() => { /* no service worker (http on another host than localhost): the page keeps one thread */ });
}
