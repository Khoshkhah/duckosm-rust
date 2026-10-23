// The region files kept in the browser (docs/relay.md): a Geofabrik extract comes through the relay one time and stays in the storage
// of the site (OPFS, the Origin Private File System), so the next area in the same region needs no download. The build reads the kept
// file as it reads a file that the user selects.

// The address of the relay (relay/worker.js) after its deploy; empty: no relay, the user downloads the file. ?relay=<address> in the
// address of the page gives another one (?relay=relay: the relay of serve.py).
const RELAY = "";
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

// get an extract ({id, name, pbf}) through the relay into the storage; onProgress(bytes, total); signal: an AbortController's
export async function download(x, onProgress, signal) {
  const r = await fetch(`${relay}?url=${encodeURIComponent(x.pbf)}`, { signal });
  if (!r.ok) throw new Error(`the relay answered ${r.status}: ${(await r.text()).trim()}`);
  const total = Number(r.headers.get("Content-Length")) || 0;
  const dir = await folder();
  await dir.removeEntry(key(x.id) + ".json").catch(() => {});      // the old file is not complete from now on
  const out = await (await dir.getFileHandle(key(x.id) + ".osm.pbf", { create: true })).createWritable();
  let got = 0;
  try {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await out.write(value);
      got += value.length;
      onProgress(got, total);
    }
    await out.close();
  } catch (e) {
    await out.abort().catch(() => {});
    throw e;
  }
  if (total && got !== total) throw new Error(`the download stopped after ${got} of ${total} bytes`);
  const meta = { id: x.id, name: x.name, pbf: x.pbf, size: got, modified: r.headers.get("Last-Modified") };
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
