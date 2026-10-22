// The build of duckosm-rust in a Web Worker, so the page stays responsive during a long build.
// In: {pbf: ArrayBuffer, modes: "driving,walking", fixes: text or null}.
// Out: {step}, then {files: {name: Uint8Array}, summary, seconds: {load, build}, memoryMiB} (the buffers are
// transferred, not copied), or {error}.
import init, { build } from "./pkg/duckosm_wasm.js";

let wasm = null;

onmessage = async ({ data }) => {
  try {
    const t0 = performance.now();
    if (!wasm) {
      postMessage({ step: "loading the WebAssembly module" });
      wasm = await init();
    }
    const t1 = performance.now();
    postMessage({ step: "building the networks" });
    const res = build(new Uint8Array(data.pbf), data.modes, data.fixes || undefined);
    const t2 = performance.now();
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
    postMessage(
      {
        files,
        summary: res.summary,
        seconds: { load: (t1 - t0) / 1000, build: (t2 - t1) / 1000 },
        // WebAssembly memory only grows, so its size is the peak of all builds of this worker
        memoryMiB: Math.round(wasm.memory.buffer.byteLength / 2 ** 20),
      },
      Object.values(files).map((f) => f.buffer),
    );
  } catch (e) {
    postMessage({ error: String((e && e.message) || e) });
  }
};
