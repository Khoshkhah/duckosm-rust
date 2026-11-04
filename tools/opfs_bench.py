"""Measure the browser's own disk storage (OPFS) in headless Chromium: the speed of big blocks and the cost of each call.

    python3 tools/opfs_bench.py            # writes and reads 512 MB, then deletes the file

It prints MB/s for 1 MB blocks (write, read), the reads per second of 16 bytes and 4 KB (in order and at random), and a copy in
memory as the base. The numbers are for this browser and this computer (docs/proposals/disk-store.md, "The speed of the disk").
"""
import http.server
import json
import threading

from playwright.sync_api import sync_playwright

PAGE = b"<!doctype html><meta charset=utf-8><title>opfs</title>"
WORKER = r"""
self.onmessage = async () => {
  const MB = 1 << 20, TOTAL = 512, out = {};
  const root = await navigator.storage.getDirectory();
  const h = await (await root.getFileHandle("bench.bin", { create: true })).createSyncAccessHandle();
  h.truncate(0);
  const chunk = new Uint8Array(MB);
  for (let i = 0; i < MB; i++) chunk[i] = i * 31;
  const rate = (n, t0) => n / ((performance.now() - t0) / 1000);
  let t = performance.now();
  for (let i = 0; i < TOTAL; i++) h.write(chunk, { at: i * MB });
  h.flush();
  out.write_1MB_blocks_MBps = rate(TOTAL, t);
  const buf = new Uint8Array(MB);
  t = performance.now();
  for (let i = 0; i < TOTAL; i++) h.read(buf, { at: i * MB });
  out.read_1MB_blocks_MBps = rate(TOTAL, t);
  const n = 20000, small = new Uint8Array(16), k4 = new Uint8Array(4096);
  let x = 12345;
  const next = (size) => { x = (x * 1103515245 + 12345) >>> 0; return x % (TOTAL * MB - size); };
  t = performance.now();
  for (let i = 0; i < n; i++) h.read(small, { at: next(16) });
  out.random_16B_reads_per_s = rate(n, t);
  t = performance.now();
  for (let i = 0; i < n; i++) h.read(k4, { at: next(4096) });
  out.random_4KB_reads_per_s = rate(n, t);
  t = performance.now();
  for (let i = 0; i < n; i++) h.read(small, { at: i * 16 });
  out.sequential_16B_reads_per_s = rate(n, t);
  const a = new Uint8Array(256 * MB), b = new Uint8Array(256 * MB);
  t = performance.now();
  b.set(a);
  out.memory_copy_MBps = rate(256, t);
  h.close();
  await root.removeEntry("bench.bin");
  postMessage(out);
};
"""
RUN = "(code) => new Promise((ok, no) => { const w = new Worker(URL.createObjectURL(new Blob([code]))); w.onmessage = (e) => ok(e.data); w.onerror = (e) => no(e.message); w.postMessage(0); })"


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)   # 127.0.0.1 is a secure context, which OPFS needs
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(f"http://127.0.0.1:{srv.server_address[1]}/")
        print(json.dumps({k: round(v) for k, v in page.evaluate(RUN, WORKER).items()}, indent=2))
        browser.close()
