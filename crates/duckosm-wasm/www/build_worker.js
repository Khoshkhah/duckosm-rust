// The build of duckosm-rust in a Web Worker, so the page stays responsive during a long build.
// In: {pbf: ArrayBuffer} (a file cut to the area), {region: File, boundary: GeoJSON text, raw: true or false} (a
// region file, cut while it is read, piece by piece; raw: also duckOSM's raw.* files, docs/features.md) or {json:
// ArrayBuffer, boundary} (OSM JSON from the Overpass API), with {modes: "driving,walking", fixes: text or null}.
// Out: {step}, then {files: {name: Uint8Array}, summary, seconds: {load, build}, memoryMiB, threads, featuresSql, log}
// (the buffers are transferred, not copied; featuresSql: the SQL of the base-map layers, with raw; log: [{step, ms,
// mib}], the time of each step and the WebAssembly memory after it), or {error}. After {error}, the page makes a new
// worker.
// A cross-origin isolated page (the COOP and COEP headers, www/serve.py) gets the module with threads
// (pkg-threads, rayon on Web Workers); another page gets the module with one thread (pkg).

let wasm = null, pkg = null, threads = 1;

onmessage = async ({ data }) => {
  try {
    const t0 = performance.now();
    if (!wasm) {
      postMessage({ step: "loading the WebAssembly module" });
      const isolated = self.crossOriginIsolated;
      pkg = await import(isolated ? "./pkg-threads/duckosm_wasm.js?v=check" : "./pkg/duckosm_wasm.js?v=check");
      wasm = await pkg.default();
      if (isolated) {
        // more than 8 threads gave no more speed on Tartu from the Estonia file, only more memory
        threads = data.threads || Math.min(navigator.hardwareConcurrency || 4, 8);
        await pkg.initThreadPool(threads);
      }
    }
    const { build, build_area, build_osm_json, features_sql } = pkg;
    const t1 = performance.now();
    const mib = () => Math.round(wasm.memory.buffer.byteLength / 2 ** 20 * 10) / 10, loadMib = mib();
    postMessage({ step: "building the networks" });
    const fixes = data.fixes || undefined;
    const levels = data.levels || undefined;   // "tags" (the default) or "solve"
    pkg.set_timezone_entry(data.tz);           // the entry of the page's time zone table, or undefined: no time zone
    const res = data.region
      ? build_area(data.region, data.boundary, data.modes, fixes, !!data.raw, levels)
      : data.json
        ? build_osm_json(new Uint8Array(data.json), data.boundary || undefined, data.modes, fixes, levels)
        : build(new Uint8Array(data.pbf), data.modes, fixes, data.boundary || undefined, levels);
    const t2 = performance.now();
    const log = [{ step: "load the WebAssembly module", ms: t1 - t0, mib: loadMib }, ...JSON.parse(res.log)];
    // one buffer for each file: duckdb-wasm registers a file as one buffer
    const files = {};
    for (const name of Object.keys(res.files)) {
      const parts = res.files[name];
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      files[name] = out;
    }
    log.push({ step: "join the parts of the files", ms: performance.now() - t2, mib: mib() });
    postMessage(
      {
        files,
        summary: res.summary,
        seconds: { load: (t1 - t0) / 1000, build: (t2 - t1) / 1000 },
        // WebAssembly memory only grows, so its size is the peak of all builds of this worker
        memoryMiB: Math.round(wasm.memory.buffer.byteLength / 2 ** 20),
        threads,
        featuresSql: data.raw && data.region ? features_sql() : undefined,
        log,
      },
      Object.values(files).map((f) => f.buffer),
    );
  } catch (e) {
    // after a panic, the module's panic hook has kept the message (e is only "RuntimeError: unreachable")
    postMessage({ error: self.duckosmPanic || String((e && e.message) || e) });
  }
};
