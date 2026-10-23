# The relay: region files without a manual download

Status: deployed on 2026-10-23 at <https://duckosm-relay.khoshkhah.workers.dev> (Kaveh's Cloudflare account, the
`workers.dev` subdomain `khoshkhah`), and the default relay of the page (`RELAY` in `www/app/regions.js`). The
results of the checks are at the end.

## Why

The page builds an area from a region file (a Geofabrik extract) that covers it. Geofabrik and the other extract
servers send no CORS header, so the browser does not let a page read their files. Before the relay, the user had
to download the file and then select it in the page (Kaveh, 2026-10-22: "there is no better way that handle it
inside?").

The relay is a small Cloudflare Worker. It gets the file from Geofabrik and gives it to the page with the CORS
header. The page keeps the file in the storage of the site, so the user downloads each region one time only.

```
page (index.html)  --GET ?url=<Geofabrik file>-->  relay (Cloudflare Worker)  --GET-->  download.geofabrik.de
       |                                                    |                                   |
       | <------------- the file, streamed, with CORS ------+ <-------------- the file ---------+
       v
browser storage (OPFS): regions/<id>.osm.pbf and <id>.json  -->  the build (cut to the area)
```

The result does not change: the same Geofabrik file and the same cut in Rust, so the tables are still equal to
duckOSM's.

## The parts

| File | What it is |
|---|---|
| `crates/duckosm-wasm/relay/worker.js` | The Worker (about 40 lines, no dependencies). |
| `crates/duckosm-wasm/relay/wrangler.toml` | Its settings: the name `duckosm-relay` and `ALLOWED_ORIGINS`. |
| `crates/duckosm-wasm/relay/check.mjs` | A check in Node 24, without Cloudflare: `node crates/duckosm-wasm/relay/check.mjs`. |
| `crates/duckosm-wasm/www/serve.py` | The same relay on this computer, at `/relay?url=...`, for local work and the browser tests. |
| `crates/duckosm-wasm/www/app/regions.js` | The page side: the download through the relay, the kept files (OPFS), and their delete. The constant `RELAY` is the address of the relay. |

## The rules of the relay

The relay is not an open proxy:

- It accepts only the `.osm.pbf` files of `download.geofabrik.de`: the URL must match
  `https://download.geofabrik.de/<path>-latest.osm.pbf`. All 554 extracts of `www/geofabrik.json` match.
- It accepts only requests from the pages in `ALLOWED_ORIGINS`, and from `http://localhost` and
  `http://127.0.0.1` (a development server). A request without an `Origin` header (for example `curl` without
  `-H Origin`) gets 403.
- It accepts only `GET`, `HEAD` and the CORS preflight (`OPTIONS`).
- It streams the file and keeps nothing. It uses almost no CPU time, so the free plan is enough.
- It sends `Cross-Origin-Resource-Policy: cross-origin`, because the page is cross-origin isolated (the headers
  for the WebAssembly threads).
- It identifies itself to Geofabrik with the `User-Agent` `duckosm-relay (+https://github.com/Khoshkhah/duckOSM)`.
  It sends no personal data.
- Geofabrik answers `<region>-latest.osm.pbf` with a redirect (307) to the file of the day, for example
  `monaco-261020.osm.pbf`. The relay follows it (the default of `fetch` in a Worker), on the same host.

## The page

Step 3 of the app (the data), the tab **Region file**:

- Each suggested extract has a button **Get**. The page downloads the extract through the relay, shows the
  progress (MB and %), and keeps the file. **Cancel** stops the download.
- A kept extract shows "kept" with its size and its date (the `Last-Modified` date of Geofabrik). When an area is
  in a kept extract, the page selects that file at once, and **Build** turns on.
- A kept extract has the button **Use** (or "In use") in place of **Get**. The list "Kept in this browser" shows
  all kept files, with a button to delete each one. Geofabrik makes a new version each day: to get it, delete the
  kept file and click **Get** again.
- The user can still select a file from the disk, as before.
- Without a relay (`RELAY` is empty and the address has no `?relay=`), the page shows only the download links,
  as before.

The browser decides how much the site can keep. Chrome gives a site up to about 60 % of the free disk space. The
page asks the browser to keep the files (`navigator.storage.persist()`); without that, the browser can delete
them when the disk is full. The user can also delete them with the browser's "delete site data".

## Deploy the relay

One time, on a computer with Node:

1. Make a free Cloudflare account at <https://dash.cloudflare.com/sign-up>.
2. In `crates/duckosm-wasm/relay/wrangler.toml`, write the address of the published page in `ALLOWED_ORIGINS`
   (only the scheme and the host, for example `https://khoshkhah.github.io`). Separate more addresses with
   commas.
3. Log in and deploy:

   ```bash
   cd crates/duckosm-wasm/relay
   npx wrangler login
   npx wrangler deploy
   ```

   Wrangler shows the address of the relay, for example `https://duckosm-relay.<your-subdomain>.workers.dev`.
4. Check it (the answer must be `200`, with `access-control-allow-origin`):

   ```bash
   curl -sI -H "Origin: https://khoshkhah.github.io" "https://duckosm-relay.<your-subdomain>.workers.dev/?url=https://download.geofabrik.de/europe/monaco-latest.osm.pbf"
   ```

5. Write the address in `RELAY` in `crates/duckosm-wasm/www/app/regions.js`, and commit it.

To change the allowed pages later, change `ALLOWED_ORIGINS` and run `npx wrangler deploy` again.

## Limits and costs

- The Cloudflare free plan has 100,000 requests each day. One download is one request, so this is enough.
- The bytes go through Cloudflare. A large region (British Columbia is about 300 MB, Germany about 4 GB) takes
  the same time as a direct download. Before a public launch, read Cloudflare's current terms about large
  downloads through Workers.
- Geofabrik serves the files free. The kept files make sure that the page does not download the same region
  again for each area. Do not use the relay for automatic or repeated downloads.
- A region file bigger than the free space of the browser cannot be kept. The page then shows the error of the
  browser, and the user can download the file and select it as before.

## Local work and checks

- `node crates/duckosm-wasm/relay/check.mjs`: the rules (403, 400, 405, the preflight) and the Monaco extract
  through the relay, compared with its `Content-Length`.
- `python3 crates/duckosm-wasm/www/serve.py 8000`, then <http://localhost:8000/?relay=relay>: the page with the
  relay of `serve.py`.
- `e2e.py --relay`: the browser test gets the Monaco extract through the relay of `serve.py`, keeps it, and
  builds Monaco from it.

## Results (2026-10-22)

- `check.mjs`: all rules as above; the Monaco extract came through whole (693,466 bytes, Geofabrik's version of
  2026-10-20).
- `e2e.py relay ... --boundary tests/data/monaco.geojson`: the page got the Monaco extract through the relay of
  `serve.py`, kept it, selected it, and built it. The 20 tables are equal, on every row, to the native build of
  the same file (`duckosm-rust <file> --boundary ...`, 2,762 driving edges).
- In headless Chromium: before **Get**, Build is off and step 4 says "Click Get at an extract in step 3, or select
  a region file". After **Get**, Build is on. After a reload, the page selects the kept file at once. After
  **Delete**, the file is gone and Build is off.
- Not tested: the deploy on Cloudflare (it needs the account), a large region, and Firefox and Safari (their
  storage limits are different).

## The deploy (2026-10-23)

- The account had no `workers.dev` subdomain. Kaveh chose `khoshkhah` (it matches `khoshkhah.github.io`). Wrangler
  has no command for it, so it was set with Cloudflare's API (`PUT /accounts/<id>/workers/subdomain`) and the
  Wrangler login. The new name answered after about 80 s.
- `npx wrangler deploy` in `crates/duckosm-wasm/relay`: the Worker `duckosm-relay`, 1.7 KiB.
- Checks with `curl`: from `https://khoshkhah.github.io`, the Monaco extract (693,466 bytes) with
  `access-control-allow-origin` and `cross-origin-resource-policy`; from another page 403; a URL that is not
  Geofabrik 400.
- The page on `localhost` with the deployed relay (no `?relay=`): Get, the kept file after a reload, Delete.

