# Proposal: where to host the browser page

Status: proposal for Kaveh, 2026-11-04. Nothing is changed. The page stays on GitHub Pages until you decide.

## Recommendation

Move the page to **Cloudflare**, to a static site that sends the headers from a `_headers` file. Keep GitHub Pages running until the new site is checked. Do it after the move of the engine into duckOSM. The move is not urgent: the page works today.

Reasons, in order of weight:

1. The page needs the headers `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Cloudflare sends them from a text file. GitHub Pages cannot send them.
2. A preview address for each pull request. You test the page on a phone, and today you can test only after a merge.
3. Cache control that you set. GitHub Pages fixes `max-age=600`, and `version_refs.py` exists only because of that.
4. You have a Cloudflare account already: the relay ([relay.md](../relay.md)) runs there. One account holds the page and the relay.

## What the page needs from a host

| Need | Why |
|---|---|
| The two isolation headers | The threaded WebAssembly build (`pkg-threads`) needs `SharedArrayBuffer`. A browser gives it only to a cross-origin isolated page. |
| Files of 16 MB and more | The largest file is the roadstyle module: 15.9 MB, 3.7 MB with gzip. |
| Compression of `.wasm` | The three modules are 6.4 MB on the wire with gzip. |
| Cache control | A deploy must not give a browser a new `index.html` with an old `app/duck.js`. |
| A deploy from GitHub Actions | The workflow builds with nightly Rust and puts a secret key into the page ([pages.yml](../../.github/workflows/pages.yml)). |
| Free, or nearly | The page has no server work. The data stays in the browser. |

## What GitHub Pages does today

Measured on 2026-11-04 with `curl` and with headless Chromium, on <https://khoshkhah.github.io/duckosm-rust/>:

| Item | Result |
|---|---|
| `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy` | Not sent. |
| `Cache-Control` | `max-age=600` on every file. |
| Compression | gzip only. A request with `Accept-Encoding: br` gets gzip. |
| `.wasm` files | `content-type: application/wasm`, gzip: 1.40 MB (threads), 1.32 MB (one thread), 3.67 MB (roadstyle). |
| Isolation | Works through `coi-serviceworker.js`. A fresh browser context loaded the page, the service worker became active, the page loaded again, and `crossOriginIsolated` was `true` and `SharedArrayBuffer` existed. Two navigations in 0.5 s on a fast link. |

So the page runs with threads on GitHub Pages. The service worker has three costs:

- The first visit loads the page twice.
- A hard reload (Shift + reload) skips the service worker, and the page then builds with one thread.
- A browser that blocks service workers (some private windows) gives one thread too. The page still works.

The cache costs more: `version_refs.py` and its tests exist to work around `max-age=600`.

## The choices

| | GitHub Pages (today) | Cloudflare (Pages, or Workers with static assets) | Netlify | A small server (VPS with Caddy) |
|---|---|---|---|---|
| Custom headers, COOP and COEP | No. The service worker adds them in the browser. | Yes: a `_headers` file in the site folder. | Yes: a `_headers` file or `netlify.toml`. | Yes: a line in the config file. |
| Threads in the page | Yes, after the second load. | Yes, from the first load. | Yes, from the first load. | Yes, from the first load. |
| Files of 16 MB | Yes (the site limit is 1 GB). | Yes. The limit is 25 MiB for one file. | Yes. | Yes. |
| Compression | gzip. | Brotli and gzip, set by Cloudflare (check on a test deploy). | Brotli and gzip. | gzip and zstd. Brotli needs a module. |
| Cache control | Fixed: `max-age=600`. | You set it for each path in `_headers`. | You set it for each path. | You set it. |
| Preview for each pull request | No. | Yes (Pages previews; the workflow can publish a branch address). | Yes (deploy previews). | No, unless you build it. |
| Custom domain | Yes, free. | Yes, free. | Yes, free. | Yes, with your DNS. |
| Cost | Free. The soft limit is 100 GB of traffic each month. | Free plan for a static site, with no limit on static traffic. | Free plan with 300 credits each month. Traffic and deploys use credits, and a site can pause at the limit. | About 4 to 6 EUR each month, and your time. |
| Deploy from GitHub Actions | Yes (`deploy-pages`). | Yes (`cloudflare/wrangler-action` with an API token). | Yes (the Netlify CLI with a token). | Yes (`rsync` over ssh). |
| Work to maintain | None. | Low. | Low. | High: updates, backups, one server for all users. |
| Effort to move | | Half a day. | Half a day. | One to two days. |

Sources of the limits: [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits), [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/index.md). Netlify's free plan is now credit-based, and the pricing pages do not agree on the rates: read the dashboard before you choose it.

### Why not Netlify

Netlify does the same job as Cloudflare. The free plan can pause a site that uses all its credits. A map page that loads 6 MB of WebAssembly for each visitor uses traffic fast. The relay is already on Cloudflare, so Netlify adds an account for no gain.

### Why not a small server

It gives full control, and it is the only choice that can also serve the region files. It costs updates and backups, and you repair it when it fails. The page has no server work, and the relay needs none.

### Pages or Workers on Cloudflare

Cloudflare points new projects to Workers with static assets, and Pages still works. Both read a `_headers` file. I did not confirm in this search that Workers static assets handle `_headers` the same way. Do a test deploy of the real site first and look at the headers with `curl -I`. Choose the one that sends them.

## What the move changes

| Item | Change |
|---|---|
| `.github/workflows/pages.yml` | A new deploy step with `wrangler-action`. Two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The build steps stay. |
| `crates/duckosm-wasm/www/_headers` (new) | The two isolation headers on every path. `Cache-Control: no-cache` on `index.html`, and `public, max-age=31536000, immutable` on the versioned files. |
| `coi-serviceworker.js` | Stays at first. With the real headers it does nothing ("a page that already has the headers does nothing", [serve.py](../../crates/duckosm-wasm/www/serve.py)). Remove it after a month without problems. |
| `version_refs.py` | Stays. With `immutable` cache headers, the `?v=` on each file is what makes a deploy safe. |
| The relay | Add the new address to `ALLOWED_ORIGINS` in `crates/duckosm-wasm/relay/wrangler.toml`, and run `npx wrangler deploy`. |
| The Google Maps key | Add the new address to the allowed referrers of the key in the Google console. The key is limited to `https://khoshkhah.github.io/*` today. |
| Saved areas | **They do not move.** The browser keeps them in the storage of one address (OPFS). At the new address, **Your areas** is empty. Download the `.zip` of the areas that you need before the move. |
| Links | `README.md`, `docs/manual.md`, `docs/todo.md`, `docs/relay.md`, roadstyle docs, and duckOSM docs that name `khoshkhah.github.io/duckosm-rust`. |

## Steps

1. Make a Cloudflare Pages project (or a Worker with static assets) for the repository. Do not connect a custom domain yet.
2. Deploy the site from a branch. Check with `curl -I` that the two headers are on `index.html`, the `.wasm` files and the workers.
3. Open the page on a computer and on a phone. Build Monaco. In the console, check `crossOriginIsolated` and that the build uses threads. Run the tests of the page with `--www` on the deployed folder.
4. Change the relay, the Google key, the workflow and the links.
5. Make the Cloudflare site the main one. Let GitHub Pages stay for a month. Then replace its `index.html` with a page that links to the new address.

## Open questions for Kaveh

1. Do you want a custom domain (for example for the project name, see [name.md](name.md))? A new name is the best moment to change the address, and you change it only one time.
2. Is it acceptable that **Your areas** starts empty at the new address?
3. Do you want pull-request previews on every pull request, or only on request?
