// The region files kept in the browser (docs/relay.md): a Geofabrik extract comes through the relay one time and stays in the storage
// of the site (OPFS, the Origin Private File System), so the next area in the same region needs no download. The build reads the kept
// file as it reads a file that the user selects.

// The address of the relay (relay/worker.js) after its deploy; empty: no relay, the user downloads the file. ?relay=<address> in the
// address of the page gives another one (?relay=relay: the relay of serve.py).
const RELAY = "https://duckosm-relay.khoshkhah.workers.dev";
export const relay = new URLSearchParams(location.search).get("relay") ?? RELAY;

const folder = () => navigator.storage.getDirectory().then((d) => d.getDirectoryHandle("regions", { create: true }));
const key = (id) => id.replace(/[^a-z0-9_-]/g, "_");     // a Geofabrik id can have a "/" (us/california)

// the kept files: [{id, name, pbf, size, modified, file}]; a file without its .json (a download that stopped) does not count
export async function kept() {
  const dir = await folder(), out = [];
  for await (const [n, h] of dir.entries()) {
    if (!n.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(await (await h.getFile()).text());
      const file = await (await dir.getFileHandle(key(meta.id) + ".osm.pbf")).getFile();
      if (file.size === meta.size) out.push({ ...meta, file });
    } catch (e) { /* not complete */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// get an extract ({id, name, pbf}) through the relay into the storage; onProgress(bytes, total); signal: an AbortController's.
// The relay gives Range (206) and the dated file (Content-Location): the file comes in PARTS parts at the same time, each into its
// place in the stored file (one request is slow on some paths of the relay). Without that, one stream, as before.
const PARTS = 8, TRIES = 4, MIN_PART = 4 << 20;
export async function download(x, onProgress, signal) {
  const ctl = new AbortController();     // the page's signal, and the stop of all parts when one part fails
  signal?.addEventListener("abort", () => ctl.abort());
  const get = (url, init) => fetch(`${relay}?url=${encodeURIComponent(url)}`, { signal: ctl.signal, ...init });
  const bad = async (r) => new Error(`the relay answered ${r.status}: ${(await r.text()).trim()}`);
  const head = await get(x.pbf, { method: "HEAD" });
  if (!head.ok) throw await bad(head);
  const total = Number(head.headers.get("Content-Length")) || 0;
  const url = head.headers.get("Content-Location");           // the dated file: all parts are of one version
  const etag = head.headers.get("ETag");
  const parts = head.headers.get("Accept-Ranges") === "bytes" && url ? Math.min(PARTS, Math.floor(total / MIN_PART)) : 0;
  const dir = await folder();
  await dir.removeEntry(key(x.id) + ".json").catch(() => {});      // the old file is not complete from now on
  const out = await (await dir.getFileHandle(key(x.id) + ".osm.pbf", { create: true })).createWritable();
  let got = 0;
  const part = async (i) => {
    const size = Math.ceil(total / parts), end = Math.min(total, (i + 1) * size) - 1;
    let pos = i * size;
    for (let t = 1; pos <= end; t++) {
      try {
        const r = await get(url, { headers: { Range: `bytes=${pos}-${end}` } });
        if (r.status !== 206) throw await bad(r);
        if (etag && r.headers.get("ETag") !== etag) throw new Error("the file changed during the download");
        const reader = r.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await out.write({ type: "write", position: pos, data: value });
          pos += value.length;
          got += value.length;
          onProgress(got, total);
        }
        if (pos <= end) throw new Error("a part ended early");
      } catch (e) {
        if (ctl.signal.aborted || t >= TRIES) throw e;
        await new Promise((ok) => setTimeout(ok, 500 * t));       // the next try starts at pos: the bytes written stay
      }
    }
  };
  try {
    if (parts) await Promise.all(Array.from({ length: parts }, (_, i) => part(i).catch((e) => { ctl.abort(); throw e; })));
    else {
      const r = await get(x.pbf);
      if (!r.ok) throw await bad(r);
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await out.write(value);
        got += value.length;
        onProgress(got, total);
      }
    }
    await out.close();
  } catch (e) {
    await out.abort().catch(() => {});
    throw e;
  }
  if (total && got !== total) throw new Error(`the download stopped after ${got} of ${total} bytes`);
  const meta = { id: x.id, name: x.name, pbf: x.pbf, size: got, modified: head.headers.get("Last-Modified") };
  const w = await (await dir.getFileHandle(key(x.id) + ".json", { create: true })).createWritable();
  await w.write(JSON.stringify(meta));
  await w.close();
  navigator.storage.persist?.();   // ask the browser not to delete the kept files when the disk is full
  return { ...meta, file: await (await dir.getFileHandle(key(x.id) + ".osm.pbf")).getFile() };
}

export async function remove(id) {
  const dir = await folder();
  for (const ext of [".json", ".osm.pbf"]) await dir.removeEntry(key(id) + ext).catch(() => {});
}
