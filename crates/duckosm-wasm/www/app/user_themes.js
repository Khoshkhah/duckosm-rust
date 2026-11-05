// The themes that a person saves in the Design panel (docs/dashboard.md, "Your themes"). A saved theme is a whole design with a name. The list is kept in this
// browser, in localStorage (`duckosm.themes`): it is small (a design is about 4 KB), it is read at once, and the working design (`duckosm.design`) is there too.
// The themes are for all areas. A saved area keeps the design that it used (design.json), not the list.
// This file has no page code, so Node can run it (design_units.mjs); a function takes the storage as an argument.
//
// A theme: {id, name, keepProfile, design}. `design` is a design (app/design.js) with no `profile` unless `keepProfile` is on: the ready themes keep the tile
// profile of the page, and a saved theme does the same by default.

export const KEY = "duckosm.themes";
export const FILE_FORMAT = "duckosm-themes";
export const FILE_VERSION = 1;
export const MAX_NAME = 40;
export const MAX_THEMES = 100;

/** The id of a name: lower case letters, digits and `-`. */
export const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "theme";
/** The text of the problem of a name, or "" when the name is good. */
export function nameError(name) {
  const n = String(name ?? "").trim();
  return !n ? "Give the theme a name." : n.length > MAX_NAME ? `The name has at most ${MAX_NAME} characters.` : "";
}
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
export const find = (list, name) => list.find((t) => same(t.name, name));

const clone = (x) => JSON.parse(JSON.stringify(x));
/** The themes in the storage. A bad value gives an empty list. */
export function readAll(storage = globalThis.localStorage) {
  try {
    const o = JSON.parse(storage.getItem(KEY));
    return Array.isArray(o) ? o.filter(valid) : [];
  } catch (_) { return []; }
}
/** Keep the list. False when the browser cannot keep it (a private window, a full storage). */
export function writeAll(list, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(list)); return true; } catch (_) { return false; }
}
const valid = (t) => t && typeof t.id === "string" && typeof t.name === "string" && !nameError(t.name) && t.design && typeof t.design === "object";

/**
 * The list with a theme added, or replaced when a theme has the same name (the id stays). `design` is the whole design: the profile goes into the theme only
 * with `keepProfile`. The list is not changed: the result is a new list.
 */
export function put(list, name, design, keepProfile = false) {
  const err = nameError(name);
  if (err) throw new Error(err);
  const d = clone(design);
  if (!keepProfile) delete d.profile;
  const old = find(list, name);
  const n = name.trim();
  d.name = n;
  if (!old && list.length >= MAX_THEMES) throw new Error(`The page keeps at most ${MAX_THEMES} themes.`);
  const theme = { id: old?.id ?? unique(list, slug(n)), name: n, keepProfile: !!keepProfile, design: d };
  return old ? list.map((t) => (t === old ? theme : t)) : [...list, theme];
}
function unique(list, id) {
  let k = id, i = 2;
  while (list.some((t) => t.id === k)) k = `${id.slice(0, 20)}-${i++}`;
  return k;
}
/** The list with one theme under another name. A name that another theme has is an error. */
export function rename(list, id, name) {
  const err = nameError(name);
  if (err) throw new Error(err);
  const other = find(list, name);
  if (other && other.id !== id) throw new Error(`A theme named "${other.name}" exists.`);
  return list.map((t) => (t.id === id ? { ...t, name: name.trim(), design: { ...t.design, name: name.trim() } } : t));
}
export const remove = (list, id) => list.filter((t) => t.id !== id);

/** The text of a themes file: all the themes in one JSON list. */
export const toFile = (list) => JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, themes: list }, null, 2);
/** The themes of a file (a list). An error is thrown with the reason, in words for the person. */
export function fromFile(text) {
  let o;
  try { o = JSON.parse(text); } catch (_) { throw new Error("the file is not JSON"); }
  if (o?.format !== FILE_FORMAT) throw new Error("the file is not a duckOSM themes file");
  if (!(o.version <= FILE_VERSION)) throw new Error(`the file has version ${o.version}; this page reads version ${FILE_VERSION} and lower`);
  if (!Array.isArray(o.themes)) throw new Error("the file has no list of themes");
  const good = o.themes.filter(valid);
  if (!good.length && o.themes.length) throw new Error("no theme in the file is complete");
  return good;
}
/** The list with the themes of a file added. A theme with a name that exists replaces it. Gives {list, added, replaced}. */
export function merge(list, incoming) {
  let out = list, added = 0, replaced = 0;
  for (const t of incoming) {
    const had = !!find(out, t.name);
    out = put(out, t.name, t.design, t.keepProfile);
    had ? replaced++ : added++;
  }
  return { list: out, added, replaced };
}
