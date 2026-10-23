// The relay of duckOSM in the browser (docs/relay.md): a Cloudflare Worker that passes a Geofabrik extract through and adds the CORS
// header, so the page can download the region file itself. Geofabrik sends no CORS header, so a page cannot read its files directly.
//
// GET or HEAD /?url=https://download.geofabrik.de/<region>-latest.osm.pbf
//
// It is not an open proxy: it accepts only Geofabrik's .osm.pbf files, and only from the pages in ALLOWED_ORIGINS (wrangler.toml) and
// from http://localhost or 127.0.0.1 (a development server). The body is streamed, not kept: the Worker uses no CPU time for it.

const GEOFABRIK = /^https:\/\/download\.geofabrik\.de\/[a-z0-9/_-]+-latest\.osm\.pbf$/;
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const PASS = ["Content-Type", "Content-Length", "Last-Modified", "ETag"];

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(origin) && !LOCAL.test(origin)) return new Response("This page may not use the relay.\n", { status: 403 });
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Expose-Headers": PASS.join(", "),
      // the page is cross-origin isolated (COEP require-corp, for the WebAssembly threads)
      "Cross-Origin-Resource-Policy": "cross-origin",
      Vary: "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, HEAD" } });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Only GET and HEAD.\n", { status: 405, headers: cors });
    const url = new URL(req.url).searchParams.get("url") || "";
    if (!GEOFABRIK.test(url)) return new Response("Only the .osm.pbf files of download.geofabrik.de.\n", { status: 400, headers: cors });
    const r = await fetch(url, { method: req.method, headers: { "User-Agent": "duckosm-relay (+https://github.com/Khoshkhah/duckOSM)" } });
    const headers = new Headers(cors);
    for (const k of PASS) if (r.headers.has(k)) headers.set(k, r.headers.get(k));
    return new Response(r.body, { status: r.status, headers });
  },
};
