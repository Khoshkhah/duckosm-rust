// The OSM fixes of the page (docs/app.md, card 7) as data. The page keeps one `doc` (the parsed duckOSM fixes file: `overrides`,
// `turn_restrictions`, `new_ways`) and writes the YAML from it. It never edits the YAML text. `yaml` is js-yaml (the page loads it
// as a global). The build reads the text with duckosm-build's parser (config.rs), which rejects unknown keys.

export function parse(yaml, text) {
  const doc = text?.trim() ? yaml.load(text) : {};
  if (doc == null) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) throw new Error("the file must be a map of keys");
  return doc;
}

// "" when the doc has no rule, so that the build runs with no fixes file
export function dump(yaml, doc) {
  const keep = Object.fromEntries(Object.entries(doc).filter(([, v]) => !(Array.isArray(v) && !v.length)));
  return Object.keys(keep).length ? yaml.dump(keep, { lineWidth: -1, noRefs: true }) : "";
}

export const counts = (doc) => ({ overrides: (doc.overrides ?? []).length, turns: (doc.turn_restrictions ?? []).length });

export const findRule = (doc, id) => (doc.overrides ?? []).find((r) => r.osm_id === id) ?? null;

// the form owns every key except keep_nodes, which the YAML tab can set: it stays
export function upsertRule(doc, rule) {
  const list = (doc.overrides ??= []), i = list.findIndex((r) => r.osm_id === rule.osm_id);
  if (i < 0) list.push(rule);
  else list[i] = { ...("keep_nodes" in list[i] ? { keep_nodes: list[i].keep_nodes } : {}), ...rule };
}

export function deleteRule(doc, id) {
  doc.overrides = (doc.overrides ?? []).filter((r) => r.osm_id !== id);
}

const same = (t, from, via, to) => t.from_way === from && t.via_node === via && t.to_way === to;

export const findTurn = (doc, from, via, to) => (doc.turn_restrictions ?? []).find((t) => same(t, from, via, to)) ?? null;

export function upsertTurn(doc, turn) {
  const list = (doc.turn_restrictions ??= []), i = list.findIndex((t) => same(t, turn.from_way, turn.via_node, turn.to_way));
  if (i < 0) list.push(turn);
  else list[i] = { ...list[i], ...turn };
}

export function deleteTurn(doc, from, via, to) {
  doc.turn_restrictions = (doc.turn_restrictions ?? []).filter((t) => !same(t, from, via, to));
}

// "a=b, c=d" <-> {a: "b", c: "d"} (the rule's tags; the build wants the values as text)
export function tagsFromText(text) {
  const tags = {};
  for (const part of text.split(",")) {
    const eq = part.indexOf("=");
    const k = part.slice(0, eq).trim(), v = part.slice(eq + 1).trim();
    if (eq > 0 && k && v) tags[k] = v;
  }
  return tags;
}
export const tagsToText = (tags) => Object.entries(tags ?? {}).map(([k, v]) => `${k}=${v}`).join(", ");
