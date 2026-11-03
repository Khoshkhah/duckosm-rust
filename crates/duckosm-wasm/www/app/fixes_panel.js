// The fixes panel of the page (card 7, docs/app.md and docs/osm-editing.md). The rules are data (app/fixes.js: `doc`); this file holds the panel:
// one tag editor for roads, buildings and nodes (preset fields from presets.json, and the other tags), the turn rules, the list of changes with undo,
// and the map layers (an edited object is amber, the selected one is blue). The page gives the panel what it owns (ctx) and calls load(), text(), open().
import * as F from "./fixes.js";

const AMBER = "#f59e0b", BLUE = "#2563eb";
const TURN_TYPES = { no_left_turn: "No left turn", no_right_turn: "No right turn", no_straight_on: "No straight on", no_u_turn: "No U-turn", no_entry: "No entry", no_exit: "No exit",
  only_left_turn: "Only left turn", only_right_turn: "Only right turn", only_straight_on: "Only straight on", only_u_turn: "Only U-turn" };
const KIND_OF = { road: "way", building: "way", node: "node" };      // what a click on the map picks, and the OSM type of it (a building can be a relation)
const KIND_NAME = { road: "Road", building: "Building", node: "Node", relation: "Relation" };

export async function initFixesPanel(ctx) {
  const { $, duck, map, status, esc, yaml } = ctx;
  const presets = await fetch("app/presets.json").then((r) => r.json());
  let doc = {}, hist = [], future = [];
  let sel = null, data = null, draft = {}, touched = new Set(), kind = "road", token = 0;
  const kinds = new Map();                     // "way123" -> "road" | "building": what an edited way is (the list of changes)
  const names = new Map();

  // ---- the data
  const snap = () => structuredClone(doc);
  function commit(change) { hist.push(snap()); if (hist.length > 100) hist.shift(); future = []; change(); sync(); }
  const rows = async (sql) => (await duck.query(sql)).toArray().map((r) => r.toJSON());
  const whole = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
  const built = (mode, table) => duck.tables.some((t) => t.mode === mode && t.table === table);
  const modes = () => ["driving", "walking", "cycling"].filter((m) => built(m, "edges"));
  const hasTable = (schema, table) => built(schema, table);
  const tagMap = (r) => { const k = r?.k ? String(r.k).split("\x01") : [], v = r?.v ? String(r.v).split("\x01") : []; return Object.fromEntries(k.map((key, i) => [key, v[i] ?? ""])); };
  const TAGS = "array_to_string(map_keys(tags), chr(1)) AS k, array_to_string(map_values(tags), chr(1)) AS v";
  const safe = async (sql) => { try { return await rows(sql); } catch (e) { console.warn("fixes panel: a query failed:", e.message.split("\n")[0], "|", sql.slice(0, 90)); return []; } };

  // the data of one object: its tags (all of them when the build has raw.*), and what the networks have of it
  async function loadData(type, id, k) {
    const out = { type, id, kind: k, tags: {}, mode: {}, facts: [], found: false, lonlat: null };
    if (type === "node") {
      const r = (await safe(`SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat, ${TAGS} FROM features.traffic WHERE osm_id = ${id}`))[0];
      if (r) { out.found = true; out.tags = tagMap(r); out.lonlat = [r.lon, r.lat]; out.facts.push(`Node ${id}, at ${r.lon.toFixed(5)}, ${r.lat.toFixed(5)}`); }
      return out;
    }
    if (k === "building") {
      const r = (await safe(`SELECT osm_type, ${TAGS} FROM features.buildings WHERE osm_id = ${id} LIMIT 1`))[0];
      if (r) { out.found = true; out.tags = tagMap(r); out.type = r.osm_type === "relation" ? "relation" : "way"; out.facts.push(`Building ${out.type} ${id}`); }
      return out;
    }
    let raw = null;
    for (const m of modes()) { raw = (await safe(`SELECT ${TAGS} FROM ${m}.ways WHERE osm_id = ${id}`))[0]; if (raw) break; }      // <mode>.ways has all the tags of the ways that the mode kept
    if (raw) { out.found = true; out.tags = tagMap(raw); }
    for (const m of modes()) {
      const walk = m === "walking" ? ", any_value(walk_type) AS wt" : "";
      const e = (await safe(`SELECT any_value(name) AS name, any_value(highway) AS highway, any_value(lanes)::INTEGER AS lanes, bool_or(oneway) AS oneway, any_value(layer) AS layer,
        round(sum(length_m))::INTEGER AS m, count(*)::INTEGER AS n${walk} FROM ${m}.edges WHERE osm_id = ${id}`))[0];
      if (!e || !e.n) continue;
      out.found = true;
      if (!raw && !Object.keys(out.tags).length) out.tags = Object.fromEntries(Object.entries({ name: e.name, highway: e.highway, lanes: e.lanes, layer: e.layer }).filter(([, v]) => v != null).map(([k2, v]) => [k2, String(v)]));
      if (out.mode.oneway == null) Object.assign(out.mode, { oneway: String(!!e.oneway), lanes: e.lanes != null ? String(e.lanes) : "", layer: e.layer != null ? String(e.layer) : "" });
      out.facts.push(`${m}: ${e.n} edge${e.n === 1 ? "" : "s"}, ${e.m} m${e.wt ? `, walk type ${e.wt}` : ""}`);
    }
    return out;
  }

  // ---- the panel: what is selected
  const presetsOf = () => presets[sel?.kind ?? kind] ?? [];
  const isRuleKey = (f) => !!f.rule;
  function initialDraft() {
    const rule = F.ruleOf(doc, sel.type, sel.id), d = {};
    for (const f of presetsOf()) {
      if (isRuleKey(f)) d[f.key] = rule.mode[f.key] != null ? String(rule.mode[f.key]) : data.mode[f.key] ?? data.tags[f.key.replace(/_/g, ":")] ?? "";
      else d[f.key] = f.key in rule.set ? String(rule.set[f.key]) : rule.delete.includes(f.key) ? "" : data.tags[f.key] ?? "";
    }
    for (const k of new Set([...Object.keys(data.tags), ...Object.keys(rule.set)])) if (!(k in d)) d[k] = k in rule.set ? String(rule.set[k]) : rule.delete.includes(k) ? "" : data.tags[k];
    for (const k of rule.delete) if (!(k in d)) d[k] = "";
    d.exclude_modes = rule.mode.exclude_modes ?? [];
    d.remove = !!rule.mode.remove;
    d.note = rule.note ?? "";
    return d;
  }

  const editedKey = (rule, f) => (isRuleKey(f) ? f.key in rule.mode : f.key in rule.set || rule.delete.includes(f.key));

  function control(f, value) {
    const id = `fixf-${f.key.replace(/[^a-z0-9]/gi, "_")}`;
    let el;
    if (f.type === "choice") {
      const opts = [["", "(not set)"], ...f.options];
      if (value !== "" && !opts.some((o) => o[0] === value)) opts.push([value, value]);
      el = `<select id="${id}" data-key="${esc(f.key)}">${opts.map((o) => `<option value="${esc(o[0])}"${o[0] === value ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`;
    } else if (f.type === "color") {
      const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#999999";
      el = `<div class="colorrow"><input id="${id}" type="text" data-key="${esc(f.key)}" value="${esc(value)}" placeholder="#rrggbb or a name"><input type="color" data-for="${id}" value="${hex}" aria-label="${esc(f.label)}, pick a color"></div>`;
    } else {
      el = `<input id="${id}" type="text" data-key="${esc(f.key)}" value="${esc(value)}"${f.type === "int" ? ' inputmode="numeric"' : ""}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}>`;
    }
    return el;
  }

  function renderForm() {
    const box = $("fix-form");
    if (!sel || !data) { box.innerHTML = ""; $("fix-actions").hidden = true; return; }
    const rule = F.ruleOf(doc, sel.type, sel.id), fields = presetsOf();
    box.innerHTML = `<div class="grid2 fixgrid">${fields.map((f) => `<label for="fixf-${f.key.replace(/[^a-z0-9]/gi, "_")}" class="small${editedKey(rule, f) ? " edited" : ""}">${esc(f.label)}${editedKey(rule, f) ? ` <button type="button" class="link" data-revert="${esc(f.key)}" title="Take this change back">↺</button>` : ""}</label>${control(f, draft[f.key] ?? "")}`).join("")}</div>`;
    if (sel.kind === "road") {
      box.insertAdjacentHTML("beforeend", `<div class="checks" role="group" aria-label="Exclude from" style="margin-top:8px"><span class="small">Not in</span>${["driving", "walking", "cycling"].map((m) => `<label><input type="checkbox" name="fix-ex" value="${m}"${draft.exclude_modes.includes(m) ? " checked" : ""}>${m[0].toUpperCase() + m.slice(1)}</label>`).join("")}<label><input type="checkbox" id="fix-remove"${draft.remove ? " checked" : ""}>Remove the road</label></div>`);
    }
    const preset = new Set(fields.map((f) => f.key));
    const other = Object.keys(draft).filter((k) => !preset.has(k) && !["exclude_modes", "remove", "note"].includes(k));
    box.insertAdjacentHTML("beforeend", `<p class="small" style="margin:12px 0 4px"><b>Other tags</b></p><div class="other">${other.map((k) => `<div class="otherrow${k in rule.set || rule.delete.includes(k) ? " edited" : ""}"><span class="k" title="${esc(k)}">${esc(k)}</span><input type="text" data-key="${esc(k)}" value="${esc(draft[k])}" aria-label="${esc(k)}"><button type="button" class="btn sm" data-clear="${esc(k)}" title="Delete this tag" aria-label="Delete ${esc(k)}">×</button></div>`).join("") || '<span class="small muted">None.</span>'}
      <div class="otherrow add"><input type="text" id="fix-addkey" placeholder="key" aria-label="New tag, key"><input type="text" id="fix-addval" placeholder="value" aria-label="New tag, value"><button type="button" class="btn sm" id="fix-add">Add</button></div></div>
      <div class="grid2 fixgrid" style="margin-top:8px"><label for="fix-note" class="small">Note</label><input type="text" id="fix-note" value="${esc(draft.note)}" placeholder="Why"></div>`);
    $("fix-actions").hidden = false;
    $("fix-del").disabled = F.isEmptyRule(rule);
  }

  function renderObject() {
    const box = $("fix-obj");
    if (!sel) { box.innerHTML = '<p class="why" style="margin:0">Click a road, a building or a node on the map, or type an OSM ID.</p>'; renderForm(); return; }
    if (!data) { box.innerHTML = '<p class="why" style="margin:0">Loading…</p>'; return; }
    const name = data.tags.name ? ` “${esc(data.tags.name)}”` : "";
    const head = `${KIND_NAME[sel.kind === "building" && sel.type === "relation" ? "relation" : sel.kind]} ${sel.type} ${sel.id}${name}`;
    const tagCount = Object.keys(data.tags).length;
    box.innerHTML = `<div class="objhead">${head}</div>${data.found ? "" : '<p class="why">Not found in this area. A rule for this ID still works if the ID is right.</p>'}${data.facts.map((f) => `<div class="small muted">${esc(f)}</div>`).join("")}
      <details class="alltags"><summary>All tags in the data (${tagCount})</summary><table>${Object.entries(data.tags).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">No tags (build with the layers on to see them all).</td></tr>'}</table></details>`;
  }

  async function select(k, type, id, { zoom = false, tab = true } = {}) {
    if (!whole(id)) return;
    kind = k;
    chips();
    const my = ++token;
    sel = { kind: k, type: type ?? KIND_OF[k], id }; data = null; draft = {}; touched = new Set();
    $("fix-id").value = id;
    renderObject();
    if (tab) setTab("edit");
    const d = await loadData(sel.type, id, k);
    if (my !== token) return;
    sel.type = d.type; data = d; draft = initialDraft();
    renderObject(); renderForm();
    await drawSelected(zoom);
  }

  function chips() { for (const b of $("fix-kind").querySelectorAll("[data-kind]")) b.classList.toggle("on", b.dataset.kind === kind); }

  // ---- edits in the form
  function onInput(e) {
    const el = e.target;
    if (el.name === "fix-ex") { draft.exclude_modes = [...document.querySelectorAll("input[name=fix-ex]:checked")].map((c) => c.value); touched.add("exclude_modes"); return; }
    if (el.id === "fix-remove") { draft.remove = el.checked; touched.add("remove"); return; }
    if (el.id === "fix-note") { draft.note = el.value; touched.add("note"); return; }
    if (el.dataset.for) { const t = $(el.dataset.for); t.value = el.value; draft[t.dataset.key] = el.value; touched.add(t.dataset.key); document.querySelector(`label[for="${t.id}"]`)?.classList.add("edited"); return; }
    const k = el.dataset?.key;
    if (!k) return;
    draft[k] = el.value; touched.add(k);
    el.closest(".otherrow")?.classList.add("edited");
    if (el.id) document.querySelector(`label[for="${el.id}"]`)?.classList.add("edited");
  }

  function save() {
    if (!sel) return status("Pick an object first.");
    const rule = structuredClone(F.ruleOf(doc, sel.type, sel.id)), fields = presetsOf(), ruleFields = new Map(fields.filter(isRuleKey).map((f) => [f.key, f]));
    const dataMode = data.mode ?? {};
    for (const k of touched) {
      if (k === "note") { rule.note = (draft.note ?? "").trim(); continue; }
      if (k === "exclude_modes") { draft.exclude_modes.length ? (rule.mode.exclude_modes = draft.exclude_modes) : delete rule.mode.exclude_modes; continue; }
      if (k === "remove") { draft.remove ? (rule.mode.remove = true) : delete rule.mode.remove; continue; }
      const v = String(draft[k] ?? "").trim();
      if (ruleFields.has(k)) {
        const f = ruleFields.get(k);
        if (f.type === "int" && v !== "" && !/^-?\d+$/.test(v)) return status(`${f.label} is a whole number.`);
        const conv = v === "" ? null : f.key === "oneway" ? v === "true" : f.type === "int" ? Number(v) : v;
        if (conv === null) delete rule.mode[k];
        else if (String(conv) === (dataMode[k] ?? "") && !(k in rule.mode)) continue;            // the same as the data: no change
        else rule.mode[k] = conv;
        continue;
      }
      const f = fields.find((x) => x.key === k);
      if (f?.type === "int" && v !== "" && !/^-?\d+$/.test(v)) return status(`${f.label} is a whole number.`);
      if (v === "") {
        delete rule.set[k];
        if (k in data.tags && !rule.delete.includes(k)) rule.delete.push(k);
      } else if (v === data.tags[k] && !(k in rule.set)) { /* the same as the data: no change */ }
      else { rule.set[k] = v; rule.delete = rule.delete.filter((x) => x !== k); }
    }
    commit(() => F.writeRule(doc, sel.type, sel.id, rule));
    status(F.isEmptyRule(rule) ? "No change to save." : `Saved the rule for ${sel.type} ${sel.id}.`);
    touched = new Set();
    draft = initialDraft(); renderForm(); drawSelected(false);
  }

  function revertKey(k) {
    const rule = structuredClone(F.ruleOf(doc, sel.type, sel.id));
    delete rule.mode[k]; delete rule.set[k]; rule.delete = rule.delete.filter((x) => x !== k);
    commit(() => F.writeRule(doc, sel.type, sel.id, rule));
    touched.delete(k); draft = initialDraft(); renderForm();
    status("Taken back. The data has the original value after the next build.");
  }

  // ---- the tabs
  const TABS = ["edit", "turns", "changes"];
  function setTab(name) {
    for (const t of TABS) { $(`fix-tab-${t}`).setAttribute("aria-selected", String(t === name)); $(`fix-${t}`).hidden = t !== name; }
    if (name === "changes") renderChanges();
  }

  // ---- the list of changes
  async function classify() {
    const ids = F.objects(doc).filter((o) => o.type === "way").map((o) => o.id).filter((id) => !kinds.has("way" + id));
    if (!ids.length) return;
    for (const id of ids) kinds.set("way" + id, "road");
    for (const r of await safe(`SELECT osm_id AS id FROM features.buildings WHERE osm_id IN (${ids.join(",")})`)) kinds.set("way" + r.id, "building");
    for (const m of modes()) for (const r of await safe(`SELECT osm_id AS id, any_value(name) AS n FROM ${m}.edges WHERE osm_id IN (${ids.join(",")}) GROUP BY osm_id`)) if (r.n) names.set("way" + r.id, r.n);
  }

  async function renderChanges() {
    await classify();
    const objs = F.objects(doc), turns = doc.turn_restrictions ?? [];
    const item = (attrs, label, text, extra = "") => `<div class="chg" ${attrs} tabindex="0" role="button"><div class="chgtop"><b>${label}</b><button type="button" class="btn sm" data-x aria-label="Delete this change">×</button></div><div class="small">${esc(text)}</div>${extra}</div>`;
    $("fix-list").innerHTML = (objs.length || turns.length) ? [
      ...objs.map((o) => {
        const k = o.type === "way" ? kinds.get("way" + o.id) ?? "road" : o.type, nm = names.get(o.type + o.id);
        return item(`data-type="${o.type}" data-id="${o.id}" data-kind="${k}"`, `${KIND_NAME[k] ?? k} ${o.id}${nm ? ` · ${esc(nm)}` : ""}`, F.describe(doc, o.type, o.id) || "(no change in it)");
      }),
      ...turns.map((t) => item(`data-turn="${t.from_way}|${t.via_node}|${t.to_way}"`, `Turn · ${esc(TURN_TYPES[t.restriction] ?? t.restriction)}`, `way ${t.from_way}, at junction ${t.via_node}, to way ${t.to_way}`)),
    ].join("") : '<p class="why" style="margin:0">No changes yet. Pick an object on the map and change it.</p>';
    $("fix-undo").disabled = !hist.length; $("fix-redo").disabled = !future.length;
    $("fix-clear").disabled = !(objs.length || turns.length);
  }

  $("fix-list").addEventListener("click", (e) => {
    const c = e.target.closest(".chg");
    if (!c) return;
    if (e.target.closest("[data-x]")) {
      if (c.dataset.turn) { const [a, b, d] = c.dataset.turn.split("|").map(Number); commit(() => F.deleteTurn(doc, a, b, d)); }
      else commit(() => F.deleteObjectRule(doc, c.dataset.type, Number(c.dataset.id)));
      if (sel && !c.dataset.turn && sel.type === c.dataset.type && sel.id === Number(c.dataset.id) && data) { draft = initialDraft(); renderForm(); }
      return;
    }
    if (c.dataset.turn) { const [a, b] = c.dataset.turn.split("|").map(Number); setTab("turns"); $("fix-from").value = a; findTurns(a, b); return; }
    select(c.dataset.kind, c.dataset.type, Number(c.dataset.id), { zoom: true });
  });
  $("fix-undo").onclick = () => { if (hist.length) { future.push(snap()); doc = hist.pop(); sync(); if (sel && data) { draft = initialDraft(); renderForm(); } } };
  $("fix-redo").onclick = () => { if (future.length) { hist.push(snap()); doc = future.pop(); sync(); if (sel && data) { draft = initialDraft(); renderForm(); } } };
  $("fix-clear").onclick = () => { commit(() => { doc = {}; }); if (sel && data) { draft = initialDraft(); renderForm(); } };
  $("fix-download").onclick = () => {
    const a = Object.assign(document.createElement("a"), { download: "osm_fixes.yaml", href: URL.createObjectURL(new Blob([text() ?? ""], { type: "text/yaml" })) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href));
  };

  // ---- the turns: the junctions at the end of a road, and a rule for each road that leaves one
  const turnSelect = (cur) => `<select aria-label="Turn rule"><option value="">Allowed</option>${Object.entries(TURN_TYPES).map(([k, v]) => `<option value="${k}"${cur === k ? " selected" : ""}>${v}</option>`).join("")}</select>`;
  async function findTurns(from, via = null) {
    $("fix-from").value = from;
    const nodes = (await safe(`SELECT DISTINCT target AS n FROM driving.edges WHERE osm_id = ${from} ORDER BY n`)).map((r) => String(r.n));
    $("fix-via-row").hidden = !nodes.length;
    $("fix-via").innerHTML = nodes.map((n) => `<option value="${n}">Junction ${n}</option>`).join("");
    if (via != null && nodes.includes(String(via))) $("fix-via").value = String(via);
    $("fix-out").innerHTML = nodes.length ? "" : `<p class="why">Way ${from} is not in the driving network.</p>`;
    if (nodes.length) await outgoing();
    drawSelected(false, { turn: nodes.length ? { via: $("fix-via").value } : null });
  }
  async function outgoing() {
    const from = whole($("fix-from").value), via = Number($("fix-via").value);
    if (!from || !Number.isSafeInteger(via)) return;
    const roads = await safe(`SELECT osm_id, any_value(name) AS name, any_value(highway) AS highway FROM driving.edges WHERE source = ${via} AND osm_id != ${from} GROUP BY osm_id ORDER BY osm_id LIMIT 30`);
    $("fix-out").innerHTML = roads.length ? roads.map((r) => `<div class="turn" data-to="${r.osm_id}"><span class="small">To <b>${esc(r.name || "no name")}</b> (${esc(r.highway)}, way ${r.osm_id})</span>${turnSelect(F.findTurn(doc, from, via, Number(r.osm_id))?.restriction)}</div>`).join("") : '<p class="why">No road leaves this junction.</p>';
    for (const row of $("fix-out").querySelectorAll(".turn")) row.querySelector("select").onchange = (e) => {
      const to = Number(row.dataset.to);
      commit(() => (e.target.value ? F.upsertTurn(doc, { from_way: from, via_node: via, to_way: to, restriction: e.target.value }) : F.deleteTurn(doc, from, via, to)));
      $("fix-turn-note").textContent = e.target.value ? `Saved: ${TURN_TYPES[e.target.value]}, way ${from} to way ${to} at junction ${via}. It is in the list of changes.` : `Taken back: the turn from way ${from} to way ${to}.`;
    };
  }
  $("fix-turn-find").onclick = () => { const id = whole($("fix-from").value); id ? findTurns(id) : status("Type a way ID (a whole number)."); };
  $("fix-via").onchange = () => { outgoing(); drawSelected(false, { turn: { via: $("fix-via").value } }); };

  // ---- the map: edited objects are amber, the selected object is blue
  const EMPTY = { type: "FeatureCollection", features: [] };
  function ensureLayers() {
    for (const [src, color, w, fa] of [["fix-edits", AMBER, 5, 0.28], ["fix-sel", BLUE, 7, 0.2]]) {
      if (map.getSource(src)) continue;
      map.addSource(src, { type: "geojson", data: EMPTY });
      map.addLayer({ id: `${src}-fill`, type: "fill", source: src, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": fa } });
      map.addLayer({ id: `${src}-glow`, type: "line", source: src, filter: ["!=", ["geometry-type"], "Point"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": w * 2 + 8, "line-opacity": 0.3, "line-blur": 2 } });
      map.addLayer({ id: `${src}-line`, type: "line", source: src, filter: ["!=", ["geometry-type"], "Point"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": w, "line-opacity": 0.95 } });
      map.addLayer({ id: `${src}-pt`, type: "circle", source: src, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": w + 3, "circle-color": color, "circle-opacity": 0.35, "circle-stroke-color": color, "circle-stroke-width": 3 } });
    }
  }

  // the lines, polygons and points of some objects: [{type, id, kind}] -> Feature[]
  async function shapes(list) {
    const out = [], ways = list.filter((o) => o.type === "way" || o.type === "relation");
    const ids = (t) => list.filter((o) => o.type === t).map((o) => o.id).filter((n) => Number.isSafeInteger(n) && n > 0);
    const geo = (r) => { try { return { type: "Feature", properties: { id: r.id }, geometry: JSON.parse(r.g) }; } catch { return null; } };
    const wayIds = ids("way"), relIds = ids("relation");
    if (wayIds.length) {
      for (const m of modes()) for (const r of await safe(`SELECT osm_id AS id, ST_AsGeoJSON(geometry) AS g FROM ${m}.edges WHERE osm_id IN (${wayIds.join(",")})`)) out.push(geo(r));
      for (const r of await safe(`SELECT osm_id AS id, ST_AsGeoJSON(geom) AS g FROM features.buildings WHERE osm_type = 'way' AND osm_id IN (${wayIds.join(",")})`)) out.push(geo(r));
    }
    if (relIds.length) for (const r of await safe(`SELECT osm_id AS id, ST_AsGeoJSON(geom) AS g FROM features.buildings WHERE osm_type = 'relation' AND osm_id IN (${relIds.join(",")})`)) out.push(geo(r));
    const nodeIds = ids("node");
    if (nodeIds.length) for (const r of await safe(`SELECT osm_id AS id, ST_AsGeoJSON(geom) AS g FROM features.traffic WHERE osm_id IN (${nodeIds.join(",")})`)) out.push(geo(r));
    return out.filter(Boolean);
  }

  const drawnCount = { edits: 0, sel: 0 };      // what the panel put in the map's sources (the tests read it)
  let mapToken = 0;
  async function drawEdits() {
    const my = ++mapToken;
    if (!map.isStyleLoaded?.() && !map.getSource("fix-edits")) await new Promise((ok) => map.once("idle", ok));
    ensureLayers();
    const list = F.objects(doc), feats = await shapes(list);
    const via = [...new Set((doc.turn_restrictions ?? []).map((t) => t.via_node))].filter((n) => Number.isSafeInteger(n));
    if (via.length) for (const r of await safe(`SELECT node_id AS id, ST_AsGeoJSON(geom) AS g FROM driving.nodes WHERE node_id IN (${via.join(",")})`)) { try { feats.push({ type: "Feature", properties: { turn: 1 }, geometry: JSON.parse(r.g) }); } catch { /* no geometry */ } }
    if (my === mapToken) { map.getSource("fix-edits")?.setData({ type: "FeatureCollection", features: feats }); drawnCount.edits = feats.length; }
  }

  let selToken = 0;
  async function drawSelected(zoom, { turn = null } = {}) {
    const my = ++selToken;
    ensureLayers();
    let feats = [];
    if (turn) {
      feats = (await safe(`SELECT ST_AsGeoJSON(geom) AS g FROM driving.nodes WHERE node_id = ${Number(turn.via)}`)).map((r) => { try { return { type: "Feature", properties: {}, geometry: JSON.parse(r.g) }; } catch { return null; } }).filter(Boolean);
    } else if (sel) feats = await shapes([{ type: sel.type, id: sel.id }]);
    if (my !== selToken) return;
    map.getSource("fix-sel")?.setData({ type: "FeatureCollection", features: feats }); drawnCount.sel = feats.length;
    if (zoom && feats.length) {
      const b = new maplibregl.LngLatBounds();
      const add = (c) => (typeof c[0] === "number" ? b.extend(c) : c.forEach(add));
      for (const f of feats) add(f.geometry.coordinates);
      map.fitBounds(b, { padding: { top: 80, bottom: 80, left: innerWidth > 700 ? 440 : 40, right: 90 }, maxZoom: 19, duration: 600 });
    }
  }

  // ---- what a click on the map picks
  const open = () => document.body.classList.contains("editing-fixes");
  function pickKind(k) { kind = k; chips(); }
  $("fix-kind").addEventListener("click", (e) => { const b = e.target.closest("[data-kind]"); if (b) pickKind(b.dataset.kind); });
  const px = (e, n) => { const a = map.unproject([e.point.x - n, e.point.y]), c = map.unproject([e.point.x + n, e.point.y]); return Math.abs(c.lng - a.lng) / 2; };
  async function onMapClick(e) {
    if (!open() || kind === "road") return;
    const { lng, lat } = e.lngLat;
    if (kind === "building") {
      const d = px(e, 6);
      const r = (await safe(`SELECT osm_id, osm_type FROM features.buildings WHERE ST_Intersects(geom, ST_Buffer(ST_Point(${lng}, ${lat}), ${d})) ORDER BY ST_Distance(geom, ST_Point(${lng}, ${lat})) LIMIT 1`))[0];
      if (r) select("building", r.osm_type === "relation" ? "relation" : "way", Number(r.osm_id));
      else status("No building here.");
    } else {
      const d = px(e, 14);
      const r = (await safe(`SELECT osm_id FROM features.traffic WHERE ST_X(geom) BETWEEN ${lng - d} AND ${lng + d} AND ST_Y(geom) BETWEEN ${lat - d} AND ${lat + d}
        ORDER BY (ST_X(geom) - ${lng}) ^ 2 + (ST_Y(geom) - ${lat}) ^ 2 LIMIT 1`))[0];
      if (r) select("node", "node", Number(r.osm_id));
      else status("No traffic signal or crossing here (only these nodes can be picked).");
    }
    setTimeout(() => { window.rsDeselect?.(); document.querySelectorAll(".maplibregl-popup:not(.rs-tip)").forEach((p) => p.remove()); });
  }
  map.on("click", onMapClick);
  document.addEventListener("rs:select", (e) => {                       // a road: the dashboard's click on the roads (roadstyle), with no popup
    if (!open()) return;
    setTimeout(() => document.querySelectorAll(".maplibregl-popup:not(.rs-tip)").forEach((p) => p.remove()));
    const turns = !$("fix-turns").hidden;
    if (!turns && kind !== "road") return;                               // a building or a node is picked by its own click
    const id = Number(ctx.roadIdOfRow(e.detail?.id));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    if (turns) { $("fix-from").value = id; findTurns(id); }
    else select("road", "way", id);
  });

  // ---- wiring
  $("fix-form").addEventListener("input", onInput);
  $("fix-form").addEventListener("change", onInput);
  $("fix-form").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.revert) return revertKey(t.dataset.revert);
    if (t.dataset.clear) { draft[t.dataset.clear] = ""; touched.add(t.dataset.clear); t.closest(".otherrow").querySelector("input").value = ""; t.closest(".otherrow").classList.add("edited"); return; }
    if (t.id === "fix-add") {
      const k = $("fix-addkey").value.trim(), v = $("fix-addval").value.trim();
      if (!k || !v) return status("Type a key and a value.");
      draft[k] = v; touched.add(k); renderForm();
    }
  });
  $("fix-save").onclick = save;
  $("fix-revert").onclick = () => { touched = new Set(); draft = initialDraft(); renderForm(); };
  $("fix-del").onclick = () => {
    if (!sel) return;
    commit(() => F.deleteObjectRule(doc, sel.type, sel.id));
    draft = initialDraft(); renderForm();
    status(`Deleted the rule for ${sel.type} ${sel.id}. The data has the original values after the next build.`);
  };
  $("fix-load").onclick = () => { const id = whole($("fix-id").value); id ? select(kind, KIND_OF[kind], id, { zoom: true }) : status("Type an OSM ID (a whole number)."); };
  $("fix-id").onkeydown = (e) => { if (e.key === "Enter") $("fix-load").click(); };
  for (const t of TABS) $(`fix-tab-${t}`).onclick = () => setTab(t);

  // ---- the numbers on the page
  function sync() {
    const { overrides, turns, tagEdits } = F.counts(doc), n = F.objects(doc).length + turns;
    $("fix-n").textContent = n ? String(n) : "";
    $("fix-apply-n").textContent = n ? ` (${n} change${n === 1 ? "" : "s"})` : "";
    const s = (x) => (x === 1 ? "" : "s");
    ctx.onChange(n ? `${n} change${s(n)}: ${F.objects(doc).length} object${s(F.objects(doc).length)}, ${turns} turn rule${s(turns)}.` : "No fixes.", n);
    if (!$("fix-changes").hidden) renderChanges();
    drawEdits();
  }

  // ---- what the page uses
  function text() { return F.dump(yaml, doc) || null; }
  function load(txt) {
    try { doc = F.parse(yaml, txt); hist = []; future = []; sync(); if (sel && data) { draft = initialDraft(); renderForm(); } }
    catch (e) { status("The fixes file is not valid: " + e.message.split("\n")[0], 8000); }
  }
  function openPanel() { document.body.classList.add("editing-fixes"); ensureLayers(); renderObject(); renderForm(); drawEdits(); if (!$("fix-changes").hidden) renderChanges(); }
  async function openFrom() { await duck.loadSpatial(); openPanel(); }
  function close() { document.body.classList.remove("editing-fixes"); }
  const rebuilt = () => { kinds.clear(); names.clear(); sel = null; data = null; draft = {}; renderObject(); drawSelected(false); drawEdits(); };

  renderObject(); chips(); sync();
  return { text, load, open: openFrom, close, isOpen: open, rebuilt, select, drawn: () => ({ ...drawnCount }), count: () => F.objects(doc).length + (doc.turn_restrictions ?? []).length };
}
