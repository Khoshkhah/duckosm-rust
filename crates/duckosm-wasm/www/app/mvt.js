// A small reader and writer of Mapbox Vector Tiles (the protobuf of the MVT 2.1 spec), for the tile export (app/export.js): the page adds the attributes of a road to the
// features of a tile. The geometry of a feature stays as its bytes (it is not decoded), so a tile that is read and written again has the same shapes.
//
// Tile: repeated Layer (field 3). Layer: name (1), Feature (2), key (3), Value (4), extent (5), version (15).
// Feature: id (1), tags (2, packed: key and value indexes in pairs), type (3), geometry (4, packed).
// Value: string (1), float (2), double (3), int (4), uint (5), sint (6), bool (7).

class Reader {
  constructor(b) { this.b = b; this.i = 0; }
  more() { return this.i < this.b.length; }
  varint() { let v = 0, sh = 0; for (;;) { const c = this.b[this.i++]; v += (c & 127) * 2 ** sh; if (c < 128) return v; sh += 7; } }
  tag() { const t = this.varint(); return [t >> 3, t & 7]; }
  bytes() { const n = this.varint(), s = this.b.subarray(this.i, this.i + n); this.i += n; return s; }
  skip(w) { if (w === 0) this.varint(); else if (w === 1) this.i += 8; else if (w === 2) this.i += this.varint(); else if (w === 5) this.i += 4; else throw new Error(`bad wire type ${w}`); }
}

class Writer {
  constructor() { this.a = []; }
  varint(v) { while (v >= 128) { this.a.push((v % 128) | 128); v = Math.floor(v / 128); } this.a.push(v); }
  tag(f, w) { this.varint(f * 8 + w); }
  bytes(f, b) { this.tag(f, 2); this.varint(b.length); for (let i = 0; i < b.length; i++) this.a.push(b[i]); }
  uint(f, v) { this.tag(f, 0); this.varint(v); }
  done() { return Uint8Array.from(this.a); }
}

const utf8 = new TextEncoder(), text = new TextDecoder();

function readValue(b) {
  const r = new Reader(b);
  while (r.more()) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) return text.decode(r.bytes());
    if (f === 2 && w === 5) { const v = new DataView(r.b.buffer, r.b.byteOffset + r.i, 4).getFloat32(0, true); r.i += 4; return v; }
    if (f === 3 && w === 1) { const v = new DataView(r.b.buffer, r.b.byteOffset + r.i, 8).getFloat64(0, true); r.i += 8; return v; }
    if ((f === 4 || f === 5) && w === 0) return r.varint();
    if (f === 6 && w === 0) { const v = r.varint(); return v % 2 ? -(v + 1) / 2 : v / 2; }
    if (f === 7 && w === 0) return r.varint() !== 0;
    r.skip(w);
  }
  return null;
}

function writeValue(v) {
  const w = new Writer();
  if (typeof v === "string") w.bytes(1, utf8.encode(v));
  else if (typeof v === "boolean") w.uint(7, v ? 1 : 0);
  else if (Number.isInteger(v) && v >= 0) w.uint(5, v);
  else if (Number.isInteger(v)) { w.tag(6, 0); w.varint(v < 0 ? -2 * v - 1 : 2 * v); }
  else { w.tag(3, 1); const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v, true); for (let i = 0; i < 8; i++) w.a.push(d.getUint8(i)); }
  return w.done();
}

/** The layers of an MVT tile: [{name, extent, version, keys, values, features: [{id, tags: [key index, value index, ...], type, geometry (bytes)}]}]. */
export function decodeTile(bytes) {
  const layers = [], r = new Reader(bytes);
  while (r.more()) {
    const [f, w] = r.tag();
    if (f !== 3 || w !== 2) { r.skip(w); continue; }
    const L = new Reader(r.bytes()), layer = { name: "", extent: 4096, version: 2, keys: [], values: [], features: [] };
    while (L.more()) {
      const [lf, lw] = L.tag();
      if (lf === 1) layer.name = text.decode(L.bytes());
      else if (lf === 3) layer.keys.push(text.decode(L.bytes()));
      else if (lf === 4) layer.values.push(readValue(L.bytes()));
      else if (lf === 5) layer.extent = L.varint();
      else if (lf === 15) layer.version = L.varint();
      else if (lf === 2) {
        const F = new Reader(L.bytes()), feat = { id: undefined, tags: [], type: 0, geometry: new Uint8Array(0) };
        while (F.more()) {
          const [ff, fw] = F.tag();
          if (ff === 1 && fw === 0) feat.id = F.varint();
          else if (ff === 2 && fw === 2) { const P = new Reader(F.bytes()); while (P.more()) feat.tags.push(P.varint()); }
          else if (ff === 3 && fw === 0) feat.type = F.varint();
          else if (ff === 4 && fw === 2) feat.geometry = F.bytes();
          else F.skip(fw);
        }
        layer.features.push(feat);
      } else L.skip(lw);
    }
    layers.push(layer);
  }
  return layers;
}

/** An MVT tile from layers as `decodeTile` gives them. */
export function encodeTile(layers) {
  const t = new Writer();
  for (const layer of layers) {
    const L = new Writer();
    L.bytes(1, utf8.encode(layer.name));
    for (const feat of layer.features) {
      const F = new Writer();
      if (feat.id !== undefined) F.uint(1, feat.id);
      if (feat.tags.length) { const P = new Writer(); for (const x of feat.tags) P.varint(x); F.bytes(2, P.done()); }
      F.uint(3, feat.type);
      F.bytes(4, feat.geometry);
      L.bytes(2, F.done());
    }
    for (const k of layer.keys) L.bytes(3, utf8.encode(k));
    for (const v of layer.values) L.bytes(4, writeValue(v));
    L.uint(5, layer.extent);
    L.uint(15, layer.version);
    t.bytes(3, L.done());
  }
  return t.done();
}

/** A feature's properties as an object. */
export const propsOf = (layer, feat) => Object.fromEntries(Array.from({ length: feat.tags.length / 2 }, (_, i) => [layer.keys[feat.tags[2 * i]], layer.values[feat.tags[2 * i + 1]]]));

/** Add properties to a feature (an object of key to value): a key or a value that the layer has is used again. `index`: the layer's maps, made by `indexOf`. */
export function addProps(layer, feat, props, index) {
  const have = new Set();
  for (let i = 0; i < feat.tags.length; i += 2) have.add(layer.keys[feat.tags[i]]);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || have.has(k)) continue;
    let ki = index.keys.get(k);
    if (ki === undefined) { ki = layer.keys.length; layer.keys.push(k); index.keys.set(k, ki); }
    const vk = typeof v + ":" + v;
    let vi = index.values.get(vk);
    if (vi === undefined) { vi = layer.values.length; layer.values.push(v); index.values.set(vk, vi); }
    feat.tags.push(ki, vi);
  }
}

/** The maps from a key and from a value to its index in the layer. */
export const indexOf = (layer) => ({ keys: new Map(layer.keys.map((k, i) => [k, i])), values: new Map(layer.values.map((v, i) => [typeof v + ":" + v, i])) });
