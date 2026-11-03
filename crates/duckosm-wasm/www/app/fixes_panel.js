// The fixes panel of the page (card 7, docs/app.md and docs/osm-editing.md). The rules are data (app/fixes.js: `doc`); this file holds the panel:
// six tabs: Road, Building and Node (one tag editor for the three, with its own selected object and draft in each tab; the fields are in the sections of
// presets.json), Turn (the turn rules), New road (draw a road) and Changes (the list, undo, and the one Build button). Each tab has an "Add to changes" button:
// nothing is in the rules before it. The map layers: an edited object is amber, the selected one is blue. The page gives the panel what it owns (ctx) and
// calls load(), text(), open(), restore().
import * as F from "./fixes.js";

const AMBER = "#f59e0b", BLUE = "#2563eb";
const TURN_TYPES = { no_left_turn: "No left turn", no_right_turn: "No right turn", no_straight_on: "No straight on", no_u_turn: "No U-turn", no_entry: "No entry", no_exit: "No exit",
  only_left_turn: "Only left turn", only_right_turn: "Only right turn", only_straight_on: "Only straight on", only_u_turn: "Only U-turn" };
const KIND_OF = { road: "way", building: "way", node: "node" };      // what a click on the map picks, and the OSM type of it (a building can be a relation)
const KIND_NAME = { road: "Road", building: "Building", node: "Node", relation: "Relation" };
const EDIT = ["road", "building", "node"], TABS = [...EDIT, "turns", "new", "changes"];
const TAB_NAME = { road: "Road", building: "Building", node: "Node", turns: "Turn", new: "New road", changes: "Changes" };
const PANE = { road: "fix-edit", building: "fix-edit", node: "fix-edit", turns: "fix-turns", new: "fix-new", changes: "fix-changes" };
const HINTS = {
  road: ["Change the tags of a road: lanes, speed, sidewalk, surface and more.", "Click a road on the map, or type its OSM way ID."],
  building: ["Change the tags of a building: floors, height, roof and facade. Give each wall a type.", "Click a building on the map, or type its OSM ID."],
  node: ["A node is one point of OSM. Here it is a traffic signal or a crossing. A change shows in the layer table features.traffic, not in the road edges.", "Click a dot on the map, or type the OSM node ID. Zoom in to see the dots (zoom 14 or more)."],
};
const TURN_OUT = "#16a34a";                  // the roads that leave the junction of the Turn tab
const NODE_COLORS = { signal: "#e11d48", crossing: "#0d9488", other: "#6b7280" };
const FACE_COLORS = { front: "#16a34a", back: "#dc2626", side: "#6b7280", party: "#7c3aed" };
const FACE_NAMES = { front: "Front", back: "Back", side: "Side", party: "Party wall" };

// the height and the color of a building from its tags, for the 3D preview of the edited buildings (the same reading as main.building_info in app/duck.js)
const NAMED = { white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", brown: "#a52a2a", grey: "#808080", gray: "#808080",
  silver: "#c0c0c0", beige: "#f5f5dc", pink: "#ffc0cb", purple: "#800080", cyan: "#00ffff", tan: "#d2b48c", maroon: "#800000", olive: "#808000", navy: "#000080", teal: "#008080",
  lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkgray: "#a9a9a9", darkgrey: "#a9a9a9", ivory: "#fffff0", khaki: "#f0e68c", salmon: "#fa8072", gold: "#ffd700", cream: "#fffdd0" };
export function cssColor(c) {
  c = String(c ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return "#" + [...c.slice(1)].map((x) => x + x).join("");
  return NAMED[c] ?? null;
}
export function heightOf(tags) {
  const h = String(tags.height ?? "").trim(), m = /^(\d+(?:\.\d+)?)\s*(m|meter|meters|ft|feet|')?$/i.exec(h);
  if (m) return Number(m[1]) * (/^(ft|feet|')$/i.test(m[2] ?? "") ? 0.3048 : 1);
  const lv = /^\s*(\d+)/.exec(tags["building:levels"] ?? "");
  return lv ? Number(lv[1]) * 3.2 : 6;                         // 3.2 m for a floor; 6 m when the data has neither
}

export async function initFixesPanel(ctx) {
  const { $, duck, map, status, esc, yaml } = ctx;
  const presets = await fetch("app/presets.json").then((r) => r.json());
  let doc = {}, hist = [], future = [];
  let sel = null, data = null, draft = {}, touched = new Set(), kind = "road", token = 0;   // the state of the tab `kind` (Road, Building or Node)
  let current = "road";                        // the tab that shows
  const stash = {};                            // the state of the other two edit tabs: { sel, data, draft, touched, walls }
  let walls = [];                              // the walls of the selected building (main.building_faces), with their lines
  let wallSel = null;                          // the selected wall of that building: "from_node|to_node"
  const kinds = new Map();                     // "way123" -> "road" | "building": what an edited way is (the list of changes)
  const names = new Map();

  // ---- the data
  const snap = () => structuredClone(doc);
  function commit(change) { hist.push(snap()); if (hist.length > 100) hist.shift(); future = []; change(); persist(); sync(); }
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
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
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

  // the number of fields that are not added to the changes yet, for each edit tab (the tab of the state in the variables, and the others in the stash)
  const dirty = (k) => (k === kind ? touched.size : stash[k]?.touched?.size ?? 0);
  function paintBar() {
    if (!sel || !data) return paintDots();
    const rule = F.ruleOf(doc, sel.type, sel.id), inChanges = !F.isEmptyRule(rule);
    $("fix-save").textContent = inChanges ? "Update change" : "Add to changes";
    $("fix-save").disabled = $("fix-revert").disabled = touched.size === 0;
    $("fix-del").disabled = !inChanges;
    $("fix-state").textContent = touched.size ? `${plural(touched.size, "field")} not added yet.` : inChanges ? "This object is in the changes." : "No change yet. Edit a field.";
    paintDots();
  }

  function renderForm() {
    const box = $("fix-form");
    if (!sel || !data) { box.innerHTML = ""; $("fix-actions").hidden = true; return paintDots(); }
    const rule = F.ruleOf(doc, sel.type, sel.id), fields = presetsOf();
    const row = (f) => `<label for="fixf-${f.key.replace(/[^a-z0-9]/gi, "_")}" class="small${editedKey(rule, f) ? " edited" : ""}"${editedKey(rule, f) && f.key in rule.was ? ` title="Was: ${esc(rule.was[f.key] ?? "none")}"` : ""}>${esc(f.label)}${editedKey(rule, f) ? ` <button type="button" class="link" data-revert="${esc(f.key)}" title="Take this change back">↺</button>` : ""}</label>${control(f, draft[f.key] ?? "")}`;
    const section = (title, inner) => `<section class="fsec"><h3>${title}</h3>${inner}</section>`;
    let html = [...new Set(fields.map((f) => f.group ?? "Fields"))].map((g) => section(esc(g), `<div class="grid2 fixgrid">${fields.filter((f) => (f.group ?? "Fields") === g).map(row).join("")}</div>`)).join("");
    if (sel.kind === "road") {
      html += section("Modes", `<div class="checks" role="group" aria-label="Exclude from"><span class="small">Not in</span>${["driving", "walking", "cycling"].map((m) => `<label><input type="checkbox" name="fix-ex" value="${m}"${draft.exclude_modes.includes(m) ? " checked" : ""}>${m[0].toUpperCase() + m.slice(1)}</label>`).join("")}<label><input type="checkbox" id="fix-remove"${draft.remove ? " checked" : ""}>Remove the road</label></div>`);
    }
    if (sel.kind === "building" && walls.length) {
      html += section(`Walls <span class="muted">(${walls.length})</span>`, `<div class="wallbar"><button type="button" class="btn sm" data-wall-nav="-1">‹ Previous</button><button type="button" class="btn sm" data-wall-nav="1">Next ›</button><button type="button" class="btn sm" data-wall-nav="0" id="fix-wall-off">Unselect</button></div>
        <p class="small" id="fix-wallpos" style="margin:6px 0"></p>
        <p class="small" style="margin:0 0 6px">${Object.entries(FACE_COLORS).map(([t, c]) => `<span class="legend" style="margin-left:0;margin-right:8px"><i style="background:${c}"></i>${FACE_NAMES[t]}</span>`).join("")}</p>
        <div class="walls">${walls.map((w) => { const t = wallType(w), ruled = !!F.findFace(doc, sel.id, w.from_node, w.to_node);
          return `<div class="wallrow${ruled ? " edited" : ""}${wallKey(w) === wallSel ? " sel" : ""}" tabindex="0" data-key="${wallKey(w)}" data-a="${w.from_node}" data-b="${w.to_node}" data-computed="${w.computed_type}"><span class="k">#${w.face_index + 1}</span><span class="small">${Number(w.length_m).toFixed(1)} m${w.street_name ? ` · ${esc(w.street_name)}` : ""}</span>
          <select data-wall aria-label="Type of wall ${w.face_index + 1}">${Object.entries(FACE_NAMES).map(([k, v]) => `<option value="${k}"${k === t ? " selected" : ""}>${v}${k === w.computed_type ? " (computed)" : ""}</option>`).join("")}</select></div>`; }).join("")}</div>
        <p class="why" style="margin:6px 0 0">Click a wall in the list or on the map to select it. A wall type goes to the changes when you pick it.</p>`);
    } else if (sel.kind === "building" && !hasFaces() && sel.type === "way") {
      html += section("Walls", '<p class="why" style="margin:0">Build with the layers on to see the walls of a building and to give them a type.</p>');
    }
    const preset = new Set(fields.map((f) => f.key));
    const other = Object.keys(draft).filter((k) => !preset.has(k) && !["exclude_modes", "remove", "note"].includes(k));
    html += section("Other tags", `<div class="other">${other.map((k) => `<div class="otherrow${k in rule.set || rule.delete.includes(k) ? " edited" : ""}"><span class="k" title="${esc(k)}">${esc(k)}</span><input type="text" data-key="${esc(k)}" value="${esc(draft[k])}" aria-label="${esc(k)}"><button type="button" class="btn sm" data-clear="${esc(k)}" title="Delete this tag" aria-label="Delete ${esc(k)}">×</button></div>`).join("") || '<span class="small muted">None.</span>'}
      <div class="otherrow add"><input type="text" id="fix-addkey" placeholder="key" aria-label="New tag, key"><input type="text" id="fix-addval" placeholder="value" aria-label="New tag, value"><button type="button" class="btn sm" id="fix-add">Add</button></div></div>
      <div class="grid2 fixgrid" style="margin-top:8px"><label for="fix-note" class="small">Note</label><input type="text" id="fix-note" value="${esc(draft.note)}" placeholder="Why"></div>`);
    box.innerHTML = html;
    $("fix-actions").hidden = false;
    paintBar(); paintWalls();
  }

  // take the picked object out of the tab: the form, the draft and the blue on the map go (a field that is not added is dropped)
  function unselect() {
    if (!sel) return;
    const dropped = touched.size;
    ++token; sel = null; data = null; draft = {}; touched = new Set(); walls = []; wallSel = null;
    $("fix-id").value = "";
    renderObject(); drawSelected(false); drawFaces(); clearMapSelection();
    status(dropped ? `Unselected. ${plural(dropped, "field")} that you did not add ${dropped === 1 ? "was" : "were"} dropped.` : "Unselected.");
  }

  function renderObject() {
    const box = $("fix-obj");
    $("fix-unselect").hidden = !sel;
    if (!sel) { box.innerHTML = `<p class="why" style="margin:0">Nothing is picked in this tab.</p>`; renderForm(); return; }
    if (!data) { box.innerHTML = '<p class="why" style="margin:0">Loading…</p>'; return; }
    const name = data.tags.name ? ` “${esc(data.tags.name)}”` : "";
    const head = `${KIND_NAME[sel.kind === "building" && sel.type === "relation" ? "relation" : sel.kind]} ${sel.type} ${sel.id}${name}`;
    const tagCount = Object.keys(data.tags).length;
    box.innerHTML = `<div class="objhead">${head}</div>${data.found ? "" : '<p class="why">Not found in this area. A rule for this ID still works if the ID is right.</p>'}${data.facts.map((f) => `<div class="small muted">${esc(f)}</div>`).join("")}
      <details class="alltags"><summary>All tags in the data (${tagCount})</summary><table>${Object.entries(data.tags).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">No tags (build with the layers on to see them all).</td></tr>'}</table></details>`;
  }

  async function select(k, type, id, { zoom = false, go = true } = {}) {
    if (!whole(id)) return;
    if (go) setTab(k);                                // saves the state of the tab that shows, and shows the tab of the object
    kind = k;
    const my = ++token;
    sel = { kind: k, type: type ?? KIND_OF[k], id }; data = null; draft = {}; touched = new Set(); wallSel = null;
    $("fix-id").value = id;
    renderObject();
    const d = await loadData(sel.type, id, k);
    if (my !== token) return;
    sel.type = d.type; data = d; draft = initialDraft();
    walls = k === "building" && d.type === "way" ? await loadWalls(id) : [];
    if (my !== token) return;
    renderObject(); renderForm(); drawFaces();
    await drawSelected(zoom);
  }

  // the walls of a building: main.building_faces has them after a build with the layers (docs/osm-editing.md, M4)
  const hasFaces = () => built("main", "building_faces");
  async function loadWalls(id) {
    if (!hasFaces()) return [];
    return (await safe(`SELECT from_node, to_node, face_index, face_type, computed_type, edited, length_m, street_name, ST_AsGeoJSON(geometry) AS g FROM main.building_faces WHERE building_id = ${id} ORDER BY face_index`))
      .map((r) => ({ ...r, from_node: Number(r.from_node), to_node: Number(r.to_node), face_index: Number(r.face_index) }));
  }
  const wallKey = (w) => `${w.from_node}|${w.to_node}`;
  const wallLine = (w) => (w._line ??= JSON.parse(w.g).coordinates);
  // the selected wall: its row has a mark, the bar tells which wall it is, and the map outlines it (the layer fix-faces-sel)
  function paintWalls() {
    for (const row of $("fix-form").querySelectorAll(".wallrow")) row.classList.toggle("sel", row.dataset.key === wallSel);
    const pos = $("fix-wallpos"), i = walls.findIndex((w) => wallKey(w) === wallSel);
    if (pos) {
      const w = walls[i];
      pos.textContent = w ? `Wall ${i + 1} of ${walls.length} · ${Number(w.length_m).toFixed(1)} m${w.street_name ? ` · faces ${w.street_name}` : ""} · ${FACE_NAMES[wallType(w)]}` : "No wall is selected.";
    }
    if ($("fix-wall-off")) $("fix-wall-off").disabled = i < 0;
  }
  function selectWall(key, { zoom = false } = {}) {
    wallSel = key; paintWalls(); drawFaces();
    $("fix-form").querySelector(".wallrow.sel")?.scrollIntoView({ block: "nearest" });
    const w = walls.find((x) => wallKey(x) === key);
    if (zoom && w) zoomTo(wallLine(w), 20);
  }
  function stepWall(dir) {
    if (!walls.length) return;
    if (dir === 0) { wallSel = null; paintWalls(); drawFaces(); return; }
    const i = walls.findIndex((w) => wallKey(w) === wallSel);
    selectWall(wallKey(walls[i < 0 ? (dir > 0 ? 0 : walls.length - 1) : (i + dir + walls.length) % walls.length]), { zoom: true });
  }
  const wallType = (w) => F.findFace(doc, sel.id, w.from_node, w.to_node)?.type ?? w.face_type;


  // ---- edits in the form
  function onInput(e) {
    const el = e.target;
    if (el.dataset?.wall !== undefined) {                                        // the type of a wall: a rule at once (a Save button is for tags)
      const row = el.closest(".wallrow"), a = Number(row.dataset.a), b = Number(row.dataset.b);
      commit(() => F.setFace(doc, sel.id, a, b, el.value, row.dataset.computed));
      row.classList.toggle("edited", !!F.findFace(doc, sel.id, a, b));
      drawFaces();
      return;
    }
    if (el.name === "fix-ex") { draft.exclude_modes = [...document.querySelectorAll("input[name=fix-ex]:checked")].map((c) => c.value); touched.add("exclude_modes"); return paintBar(); }
    if (el.id === "fix-remove") { draft.remove = el.checked; touched.add("remove"); return paintBar(); }
    if (el.id === "fix-note") { draft.note = el.value; touched.add("note"); return paintBar(); }
    if (el.dataset.for) { const t = $(el.dataset.for); t.value = el.value; draft[t.dataset.key] = el.value; touched.add(t.dataset.key); document.querySelector(`label[for="${t.id}"]`)?.classList.add("edited"); return paintBar(); }
    const k = el.dataset?.key;
    if (!k) return;
    draft[k] = el.value; touched.add(k);
    el.closest(".otherrow")?.classList.add("edited");
    if (el.id) document.querySelector(`label[for="${el.id}"]`)?.classList.add("edited");
    paintBar();
  }

  function save() {
    if (!sel || !data) return status("Pick an object first.");
    const rule = structuredClone(F.ruleOf(doc, sel.type, sel.id)), fields = presetsOf(), ruleFields = new Map(fields.filter(isRuleKey).map((f) => [f.key, f]));
    const dataMode = data.mode ?? {};
    for (const k of touched) {
      if (k === "note") { rule.note = (draft.note ?? "").trim(); continue; }
      if (k === "exclude_modes") { draft.exclude_modes.length ? (rule.mode.exclude_modes = draft.exclude_modes) : delete rule.mode.exclude_modes; continue; }
      if (k === "remove") { draft.remove ? (rule.mode.remove = true) : delete rule.mode.remove; continue; }
      const v = String(draft[k] ?? "").trim();
      // what the data had before the first change of this key: kept in the rule (`was`), to show "was to now"
      if (!(k in rule.was) && !(k in rule.mode) && !(k in rule.set) && !rule.delete.includes(k)) {
        const before = ruleFields.has(k) ? dataMode[k] : data.tags[k];
        rule.was[k] = before === undefined || before === "" ? null : before;
      }
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
    status(F.isEmptyRule(rule) ? "No change to add." : `Added to the changes: ${sel.type} ${sel.id}.`);
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

  // ---- the tabs: Road, Building and Node share one editor, and each has its own object, form and draft (the stash holds the two that do not show)
  function switchKind(k) {
    stash[kind] = { sel, data, draft, touched, walls, wallSel };
    const st = stash[k] ?? { sel: null, data: null, draft: {}, touched: new Set(), walls: [], wallSel: null };
    kind = k; ({ sel, data, draft, touched, walls, wallSel = null } = st); ++token;
    $("fix-id").value = sel?.id ?? "";
    if (sel && !data) select(k, sel.type, sel.id, { go: false });       // an object that waited for its data (a build came between)
  }
  // nothing stays selected on the map from the tab that was left: roadstyle's road selection (the glow and the popup) and the hover marks go
  function clearMapSelection() {
    window.rsDeselect?.();
    document.querySelectorAll(".maplibregl-popup:not(.rs-tip)").forEach((p) => p.remove());
    leaveNode();
    if (map.getLayer("fix-turn-hl")) map.setFilter("fix-turn-hl", ["==", ["get", "id"], -1]);
  }
  function setTab(name, { zoom = false } = {}) {
    if (name !== current) clearMapSelection();
    if (EDIT.includes(name) && name !== kind) switchKind(name);
    current = name;
    for (const t of TABS) $(`fix-tab-${t}`).setAttribute("aria-selected", String(t === name));
    for (const id of new Set(Object.values(PANE))) $(id).hidden = id !== PANE[name];
    if (EDIT.includes(name)) {
      $("fix-intro").textContent = HINTS[name][0]; $("fix-pickhint").textContent = HINTS[name][1]; $("fix-walls-row").hidden = name !== "building"; $("fix-nodes-legend").hidden = name !== "node";
      renderObject(); renderForm();
    }
    if (name === "changes") renderChanges();
    if (name === "turns" && !$("fix-turnsec").hidden) outgoing();
    if (draw) map.getCanvas().style.cursor = name === "new" ? "crosshair" : "";
    paintDots();
    if (open()) { drawSelected(zoom, { turn: name === "turns" && !$("fix-turnsec").hidden ? { via: $("fix-via").value } : null }); drawFaces(); drawNodes(); drawTurnRoads(); }
  }
  // an amber dot on the tab that has edits that are not in the changes yet
  function paintDots() {
    const on = (t, v) => { $(`fix-tab-${t}`).querySelector(".dot").hidden = !v; };
    for (const k of EDIT) on(k, dirty(k) > 0);
    on("turns", turnDiffs().length > 0);
    on("new", !!draw && draw.pts.length > 0);
  }
  function pendingList() {
    const out = [];
    for (const k of EDIT) if (dirty(k)) out.push({ tab: k, text: `${TAB_NAME[k]} tab: ${plural(dirty(k), "field")} not added.` });
    const t = turnDiffs().length;
    if (t) out.push({ tab: "turns", text: `Turn tab: ${plural(t, "rule")} not added.` });
    if (draw?.pts.length) out.push({ tab: "new", text: `New road tab: a road with ${plural(draw.pts.length, "point")} is not added.` });
    return out;
  }
  const total = () => { const { turns, faces, newWays } = F.counts(doc); return F.objects(doc).length + turns + faces + newWays; };
  // the one Build button: it waits while a tab has edits that are not in the changes
  function renderPending() {
    const list = pendingList(), n = total();
    $("fix-pending").hidden = !list.length;
    $("fix-pending").innerHTML = list.length ? `<b>Not added to the changes yet</b>${list.map((x) => `<div class="small">${esc(x.text)} <button type="button" class="link" data-go="${x.tab}">Open ${esc(TAB_NAME[x.tab])} →</button></div>`).join("")}` : "";
    $("fix-apply").disabled = !n || list.length > 0;
    $("fix-apply-why").textContent = !n ? "There are no changes to build." : list.length ? "Add the edits above to the changes, or reset them, first." : "";
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
    const objs = F.objects(doc), turns = doc.turn_restrictions ?? [], faces = F.faceEdits(doc), roads = F.newWays(doc);
    const item = (attrs, label, inner) => `<div class="chg" ${attrs} tabindex="0" role="button"><div class="chgtop"><b>${label}</b><button type="button" class="btn sm" data-x aria-label="Delete this change">×</button></div>${inner}</div>`;
    const bits = (list) => list.length ? `<ul class="bits">${list.map(({ k, was, now }) => `<li><span class="k">${esc(k)}</span><span>${was === null ? "" : `<span class="was">${was === "" ? "none" : esc(was)}</span> → `}${now === null ? "(deleted)" : esc(now)}</span></li>`).join("")}</ul>` : '<div class="small">(no change in it)</div>';
    const note = (t) => `<div class="small">${esc(t)}</div>`;
    const group = (title, items) => (items.length ? `<div class="fix-group">${title} (${items.length})</div>${items.join("")}` : "");
    const by = { road: [], building: [], node: [], relation: [] };
    for (const o of objs) {
      const k = o.type === "way" ? kinds.get("way" + o.id) ?? "road" : o.type, nm = names.get(o.type + o.id);
      by[k]?.push(item(`data-type="${o.type}" data-id="${o.id}" data-kind="${k === "relation" ? "building" : k}"`, `${KIND_NAME[k] ?? k} ${o.id}${nm ? ` · ${esc(nm)}` : ""}`, bits(F.describeBits(doc, o.type, o.id))));
    }
    const newRoads = roads.map((w) => item(`data-newway="${w.id}"`, `New road · ${w.id}`, note(`${w.tags?.highway ?? "road"}${w.tags?.name ? ` “${w.tags.name}”` : ""}, ${w.nodes.length} points${w.nodes.some(Number.isInteger) ? ", joins a junction" : ""}`)));
    const walls = faces.map((f) => item(`data-face="${f.building}|${f.from_node}|${f.to_node}"`, `Wall · building ${f.building}`, note(`${FACE_NAMES[f.type] ?? f.type}, between nodes ${f.from_node} and ${f.to_node}`)));
    const turnItems = turns.map((t) => item(`data-turn="${t.from_way}|${t.via_node}|${t.to_way}"`, `Turn · ${esc(TURN_TYPES[t.restriction] ?? t.restriction)}`, note(`way ${t.from_way}, at junction ${t.via_node}, to way ${t.to_way}`)));
    const html = [group("Roads", by.road), group("Buildings", by.building), group("Walls", walls), group("Nodes", by.node), group("Other objects", by.relation), group("Turn rules", turnItems), group("New roads", newRoads)].join("");
    $("fix-list").innerHTML = html || '<p class="why" style="margin:0">No changes yet. Pick an object on the map, change a field and press <b>Add to changes</b>.</p>';
    $("fix-undo").disabled = !hist.length; $("fix-redo").disabled = !future.length;
    $("fix-clear").disabled = !total();
    renderPending();
  }

  $("fix-list").addEventListener("click", async (e) => {
    const c = e.target.closest(".chg");
    if (!c) return;
    if (e.target.closest("[data-x]")) {
      if (c.dataset.newway) { commit(() => F.deleteNewWay(doc, Number(c.dataset.newway))); return; }
      if (c.dataset.face) { const [bd, a, b] = c.dataset.face.split("|").map(Number); commit(() => F.setFace(doc, bd, a, b, "side", "side")); if (sel?.id === bd) { renderForm(); drawFaces(); } return; }
      if (c.dataset.turn) { const [a, b, d] = c.dataset.turn.split("|").map(Number); commit(() => F.deleteTurn(doc, a, b, d)); }
      else commit(() => F.deleteObjectRule(doc, c.dataset.type, Number(c.dataset.id)));
      if (sel && !c.dataset.turn && sel.type === c.dataset.type && sel.id === Number(c.dataset.id) && data) { draft = initialDraft(); renderForm(); }
      return;
    }
    if (c.dataset.newway) { setTab("new"); startEdit(Number(c.dataset.newway)); drawSelected(true); return; }
    if (c.dataset.face) { select("building", "way", Number(c.dataset.face.split("|")[0]), { zoom: true }); return; }
    if (c.dataset.turn) { const [a, b] = c.dataset.turn.split("|").map(Number); setTab("turns"); $("fix-from").value = a; findTurns(a, b, { zoom: true }); return; }
    select(c.dataset.kind, c.dataset.type, Number(c.dataset.id), { zoom: true });
  });
  $("fix-undo").onclick = () => { if (hist.length) { future.push(snap()); doc = hist.pop(); persist(); sync(); if (sel && data) { draft = initialDraft(); renderForm(); } } };
  $("fix-redo").onclick = () => { if (future.length) { hist.push(snap()); doc = future.pop(); persist(); sync(); if (sel && data) { draft = initialDraft(); renderForm(); } } };
  $("fix-clear").onclick = () => { commit(() => { doc = {}; }); if (sel && data) { draft = initialDraft(); renderForm(); } };
  $("fix-download").onclick = () => {
    const a = Object.assign(document.createElement("a"), { download: "osm_fixes.yaml", href: URL.createObjectURL(new Blob([text() ?? ""], { type: "text/yaml" })) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href));
  };

  // ---- the turns: the junctions at the end of a road, and a rule for each road that leaves one
  const turnSelect = (cur) => `<select aria-label="Turn rule"><option value="">Allowed</option>${Object.entries(TURN_TYPES).map(([k, v]) => `<option value="${k}"${cur === k ? " selected" : ""}>${v}</option>`).join("")}</select>`;
  async function findTurns(from, via = null, { zoom = false } = {}) {
    $("fix-from").value = from;
    const nodes = (await safe(`SELECT DISTINCT target AS n FROM driving.edges WHERE osm_id = ${from} ORDER BY n`)).map((r) => String(r.n));
    $("fix-via-row").hidden = $("fix-turnsec").hidden = $("fix-turn-bar").hidden = !nodes.length;
    $("fix-turn-clear").hidden = false; $("fix-turn-legend").hidden = !nodes.length;
    $("fix-via").innerHTML = nodes.map((n) => `<option value="${n}">Junction ${n}</option>`).join("");
    if (via != null && nodes.includes(String(via))) $("fix-via").value = String(via);
    $("fix-out").innerHTML = nodes.length ? "" : `<p class="why">Way ${from} is not in the driving network.</p>`;
    if (nodes.length) await outgoing();
    drawSelected(zoom, { turn: nodes.length ? { via: $("fix-via").value } : null });
    if (!nodes.length) { turnOut = []; drawTurnRoads(); }
  }
  async function outgoing() {
    const from = whole($("fix-from").value), via = Number($("fix-via").value);
    if (!from || !Number.isSafeInteger(via)) return;
    const roads = await safe(`SELECT osm_id, any_value(name) AS name, any_value(highway) AS highway FROM driving.edges WHERE source = ${via} AND osm_id != ${from} GROUP BY osm_id ORDER BY osm_id LIMIT 30`);
    turnOut = roads.map((r) => Number(r.osm_id)); drawTurnRoads();
    $("fix-out").innerHTML = roads.length ? roads.map((r) => `<div class="turn" data-to="${r.osm_id}"><span class="small">To <b>${esc(r.name || "no name")}</b> (${esc(r.highway)}, way ${r.osm_id})</span>${turnSelect(F.findTurn(doc, from, via, Number(r.osm_id))?.restriction)}</div>`).join("") : '<p class="why">No road leaves this junction.</p>';
    for (const row of $("fix-out").querySelectorAll(".turn")) row.querySelector("select").onchange = paintTurnBar;
    paintTurnBar();
  }
  // the rules that the person chose in the list and did not add yet
  function turnDiffs() {
    const from = whole($("fix-from").value), via = Number($("fix-via").value), out = [];
    if (!from || !Number.isSafeInteger(via)) return out;
    for (const row of $("fix-out").querySelectorAll(".turn")) {
      const to = Number(row.dataset.to), want = row.querySelector("select").value, have = F.findTurn(doc, from, via, to)?.restriction ?? "";
      if (want !== have) out.push({ from, via, to, want });
    }
    return out;
  }
  function paintTurnBar() {
    const n = turnDiffs().length;
    $("fix-turn-add").disabled = !n;
    $("fix-turn-note").textContent = n ? `${plural(n, "rule")} not added yet.` : "";
    paintDots();
  }
  $("fix-turn-add").onclick = () => {
    const d = turnDiffs();
    if (!d.length) return;
    commit(() => { for (const x of d) x.want ? F.upsertTurn(doc, { from_way: x.from, via_node: x.via, to_way: x.to, restriction: x.want }) : F.deleteTurn(doc, x.from, x.via, x.to); });
    status(`Added to the changes: ${plural(d.length, "turn rule")}.`);
  };
  function clearTurns() {
    $("fix-from").value = ""; $("fix-via").innerHTML = ""; $("fix-out").innerHTML = "";
    $("fix-via-row").hidden = $("fix-turnsec").hidden = $("fix-turn-bar").hidden = $("fix-turn-clear").hidden = $("fix-turn-legend").hidden = true;
    turnOut = []; drawTurnRoads(); paintTurnBar(); drawSelected(false);
  }
  $("fix-turn-clear").onclick = clearTurns;
  $("fix-turn-find").onclick = () => { const id = whole($("fix-from").value); id ? findTurns(id, null, { zoom: true }) : status("Type a way ID (a whole number)."); };
  $("fix-via").onchange = () => { outgoing(); drawSelected(false, { turn: { via: $("fix-via").value } }); };

  // ---- the map: edited objects are amber, the selected object is blue
  const EMPTY = { type: "FeatureCollection", features: [] };
  function ensureLayers() {
    if (!map.getSource("fix-nodes")) {                // the nodes of the Node tab (the lowest of the panel's layers)
      map.addSource("fix-nodes", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "fix-nodes-pt", type: "circle", source: "fix-nodes", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 4, 19, 8],
        "circle-color": ["match", ["get", "k"], "signal", NODE_COLORS.signal, "crossing", NODE_COLORS.crossing, NODE_COLORS.other], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "fix-nodes-hover", type: "circle", source: "fix-nodes", filter: ["==", ["get", "id"], -1], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 9, 19, 14],
        "circle-color": "rgba(255, 255, 255, 0.55)", "circle-stroke-color": "#111827", "circle-stroke-width": 2.5 } });
      map.on("mousemove", "fix-nodes-pt", hoverNode);
      map.on("mouseleave", "fix-nodes-pt", leaveNode);
    }
    if (!map.getSource("fix-turn")) {                 // the roads that leave the junction of the Turn tab; the one under the pointer in the list has a dark outline
      map.addSource("fix-turn", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "fix-turn-hl", type: "line", source: "fix-turn", filter: ["==", ["get", "id"], -1], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#111827", "line-width": 12, "line-opacity": 0.85 } });
      map.addLayer({ id: "fix-turn-line", type: "line", source: "fix-turn", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": TURN_OUT, "line-width": 6, "line-opacity": 0.95 } });
    }
    for (const [src, color, w, fa] of [["fix-edits", AMBER, 5, 0.28], ["fix-sel", BLUE, 7, 0.2]]) {
      if (map.getSource(src)) continue;
      map.addSource(src, { type: "geojson", data: EMPTY });
      map.addLayer({ id: `${src}-fill`, type: "fill", source: src, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": color, "fill-opacity": fa } });
      map.addLayer({ id: `${src}-glow`, type: "line", source: src, filter: ["!=", ["geometry-type"], "Point"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": w * 2 + 8, "line-opacity": 0.3, "line-blur": 2 } });
      map.addLayer({ id: `${src}-line`, type: "line", source: src, filter: ["!=", ["geometry-type"], "Point"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": w, "line-opacity": 0.95 } });
      map.addLayer({ id: `${src}-pt`, type: "circle", source: src, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": src === "fix-sel" ? ["case", ["==", ["get", "j"], 1], 17, w + 3] : w + 3, "circle-color": color, "circle-opacity": 0.35, "circle-stroke-color": color, "circle-stroke-width": src === "fix-sel" ? ["case", ["==", ["get", "j"], 1], 5, 3] : 3 } });
    }
    if (!map.getSource("fix-draw")) {                 // the new road that is being drawn
      map.addSource("fix-draw", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "fix-draw-line", type: "line", source: "fix-draw", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": BLUE, "line-width": 4, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "fix-draw-pt", type: "circle", source: "fix-draw", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": ["case", ["==", ["get", "snap"], 1], 8, 6], "circle-color": ["case", ["==", ["get", "snap"], 1], "#16a34a", "#ffffff"], "circle-stroke-color": BLUE, "circle-stroke-width": 3 } });
    }
    if (!map.getSource("fix-faces")) {                // the walls of buildings, one color for each type; a wall with a rule has an amber glow
      map.addSource("fix-faces", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "fix-faces-edit", type: "line", source: "fix-faces", filter: ["==", ["get", "e"], 1], paint: { "line-color": AMBER, "line-width": 10, "line-opacity": 0.55 } });
      map.addLayer({ id: "fix-faces-sel", type: "line", source: "fix-faces", filter: ["==", ["get", "s"], 1], layout: { "line-cap": "round" }, paint: { "line-color": "#111827", "line-width": 14, "line-opacity": 0.9 } });
      map.addLayer({ id: "fix-faces-line", type: "line", source: "fix-faces", layout: { "line-cap": "round" },
        paint: { "line-color": ["match", ["get", "t"], "front", FACE_COLORS.front, "back", FACE_COLORS.back, "party", FACE_COLORS.party, FACE_COLORS.side], "line-width": 4.5 } });
    }
    if (!map.getSource("fix-3d")) {                  // the edited buildings, as extrusions with their height and facade color (tilt the map to see them)
      map.addSource("fix-3d", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "fix-3d", type: "fill-extrusion", source: "fix-3d", paint: { "fill-extrusion-height": ["get", "h"], "fill-extrusion-color": ["get", "c"], "fill-extrusion-opacity": 0.85 } }, "fix-edits-fill");
    }
  }

  // the lines, polygons and points of some objects: [{type, id, kind}] -> Feature[]
  async function shapes(list) {
    const out = [], ways = list.filter((o) => o.type === "way" || o.type === "relation");
    const ids = (t) => list.filter((o) => o.type === t).map((o) => o.id).filter((n) => Number.isSafeInteger(n) && n > 0);
    const geo = (r) => { try { return { type: "Feature", properties: { id: Number(r.id) }, geometry: JSON.parse(r.g) }; } catch { return null; } };   // a BigInt in a property stops the map's source: nothing is drawn
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

  const drawnCount = { edits: 0, sel: 0, heights: [], faces: 0, draw: 0, nodes: 0, turn: 0 };      // what the panel put in the map's sources (the tests read it)
  // the edited buildings with their height and color: the tags of the data with the rule on top, so a change shows before the next build
  async function extrusions() {
    await classify();
    const ids = F.objects(doc).filter((o) => o.type === "way" && kinds.get("way" + o.id) === "building").map((o) => o.id);
    if (!ids.length) return [];
    const out = [];
    for (const r of await safe(`SELECT osm_id AS id, ST_AsGeoJSON(geom) AS g, ${TAGS} FROM features.buildings WHERE osm_type = 'way' AND osm_id IN (${ids.join(",")})`)) {
      const rule = F.ruleOf(doc, "way", Number(r.id)), tags = { ...tagMap(r), ...rule.set };
      for (const k of rule.delete) delete tags[k];
      try { out.push({ type: "Feature", properties: { h: Math.round(heightOf(tags) * 10) / 10, c: cssColor(tags["building:colour"]) ?? cssColor(tags["roof:colour"]) ?? AMBER }, geometry: JSON.parse(r.g) }); } catch { /* no geometry */ }
    }
    return out;
  }

  // the walls on the map: those of the selected building (with the types of the rules on top), and with the check box all walls in view (the types of the data)
  // the line of a new road: the nodes that are OSM ids come from the nodes tables (a junction that the road joins), the others are [lon, lat]
  async function newWayLine(w) {
    const ids = w.nodes.filter(Number.isInteger), at = new Map();
    if (ids.length) for (const m of modes()) for (const r of await safe(`SELECT node_id AS id, ST_X(geom) AS x, ST_Y(geom) AS y FROM ${m}.nodes WHERE node_id IN (${ids.join(",")})`)) at.set(Number(r.id), [r.x, r.y]);
    return w.nodes.map((n) => (Array.isArray(n) ? n : at.get(n))).filter(Boolean);
  }
  function zoomTo(coords, maxZoom = 18) {
    if (!coords.length) return;
    const b = new maplibregl.LngLatBounds();
    coords.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: { top: 80, bottom: 80, left: innerWidth > 700 ? 440 : 40, right: 90 }, maxZoom, duration: 600 });
  }

  // hover on a node dot: a ring around it, the pointer cursor and a tooltip (roadstyle's tooltip look, `rs-tip`) with its kind, its OSM id and its name
  let nodeTip = null, hoverNodeId = null;
  function hoverNode(e) {
    const f = e.features?.[0];
    if (!f || !open() || current !== "node") return;
    map.getCanvas().style.cursor = "pointer";
    const { id, k, kind, name } = f.properties;
    if (hoverNodeId !== id) { hoverNodeId = id; map.setFilter("fix-nodes-hover", ["==", ["get", "id"], id]); }
    nodeTip ??= new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "rs-tip fix-tip", offset: 12, maxWidth: "240px" });
    nodeTip.setLngLat(f.geometry.coordinates).setHTML(`<b>${esc(k === "signal" ? "Traffic signal" : k === "crossing" ? "Crossing" : kind || "Node")}</b><br>node ${id}${name ? `<br>${esc(name)}` : ""}<br><span class="muted">Click to pick it</span>`).addTo(map);
  }
  function leaveNode() {
    hoverNodeId = null;
    if (map.getLayer("fix-nodes-hover")) map.setFilter("fix-nodes-hover", ["==", ["get", "id"], -1]);
    map.getCanvas().style.cursor = "";
    nodeTip?.remove();
  }
  // the nodes that a click in the Node tab can pick (the traffic signals and the crossings of features.traffic) in view, as dots with a color for each kind
  let nodeToken = 0;
  async function drawNodes() {
    const my = ++nodeToken;
    let feats = [], info = "";
    if (open() && current === "node") {
      ensureLayers();
      if (map.getZoom() < 14) info = "Zoom in to see the dots (zoom 14 or more).";
      else {
        const b = map.getBounds();
        feats = (await safe(`SELECT osm_id AS id, kind, name, CASE WHEN kind LIKE '%signal%' THEN 'signal' WHEN kind LIKE '%crossing%' THEN 'crossing' ELSE 'other' END AS k, ST_X(geom) AS x, ST_Y(geom) AS y
          FROM features.traffic WHERE ST_X(geom) BETWEEN ${b.getWest()} AND ${b.getEast()} AND ST_Y(geom) BETWEEN ${b.getSouth()} AND ${b.getNorth()} LIMIT 5000`))
          .map((r) => ({ type: "Feature", properties: { id: Number(r.id), k: r.k, kind: r.kind ?? "", name: r.name ?? "" }, geometry: { type: "Point", coordinates: [r.x, r.y] } }));
        const n = (k) => feats.filter((f) => f.properties.k === k).length;
        info = `In view: ${plural(n("signal"), "traffic signal")}, ${plural(n("crossing"), "crossing")}${n("other") ? `, ${n("other")} other` : ""}.`;
      }
    }
    if (my !== nodeToken) return;
    if (!feats.length) leaveNode();
    map.getSource("fix-nodes")?.setData({ type: "FeatureCollection", features: feats });
    $("fix-nodes-info").textContent = info;
    drawnCount.nodes = feats.length;
  }

  let faceToken = 0;
  async function drawFaces() {
    const my = ++faceToken;
    if (!open()) { map.getSource("fix-faces")?.setData({ type: "FeatureCollection", features: [] }); drawnCount.faces = 0; return; }       // closed: no walls on the map
    ensureLayers();
    let feats = [];
    const asFeature = (g, t, e, s = 0) => { try { return { type: "Feature", properties: { t, e: e ? 1 : 0, s: s ? 1 : 0 }, geometry: JSON.parse(g) }; } catch { return null; } };
    if (hasFaces()) {
      if (current === "building" && $("fix-walls-all").checked && map.getZoom() >= 16) {
        const b = map.getBounds();
        feats = (await safe(`SELECT face_type AS t, edited AS e, building_id AS b, from_node AS f, to_node AS n, ST_AsGeoJSON(geometry) AS g FROM main.building_faces WHERE ST_Intersects(geometry, ST_MakeEnvelope(${b.getWest()}, ${b.getSouth()}, ${b.getEast()}, ${b.getNorth()})) LIMIT 30000`))
          .map((r) => asFeature(r.g, r.t, r.e, sel?.kind === "building" && Number(r.b) === sel.id && `${Number(r.f)}|${Number(r.n)}` === wallSel));
      } else if (current === "building" && sel?.kind === "building" && walls.length) {
        feats = walls.map((w) => asFeature(w.g, wallType(w), !!F.findFace(doc, sel.id, w.from_node, w.to_node) || w.edited, wallKey(w) === wallSel));
      }
    }
    if (my !== faceToken) return;
    feats = feats.filter(Boolean);
    map.getSource("fix-faces")?.setData({ type: "FeatureCollection", features: feats });
    drawnCount.faces = feats.length;
  }
  $("fix-walls-all").onchange = drawFaces;
  map.on("moveend", () => { if (open() && current === "building" && $("fix-walls-all").checked) drawFaces(); if (open() && current === "node") drawNodes(); });

  let mapToken = 0;
  async function drawEdits() {
    if (!open() && !total()) return;                    // no layers before the panel opens or a change exists: they would go under the page's own layers
    const my = ++mapToken;
    if (!map.isStyleLoaded?.() && !map.getSource("fix-edits")) await new Promise((ok) => map.once("idle", ok));
    ensureLayers();
    const list = F.objects(doc), feats = await shapes(list);
    for (const w of F.newWays(doc)) { const line = await newWayLine(w); if (line.length > 1) feats.push({ type: "Feature", properties: { id: w.id, road: 1 }, geometry: { type: "LineString", coordinates: line } }); }
    const via = [...new Set((doc.turn_restrictions ?? []).map((t) => t.via_node))].filter((n) => Number.isSafeInteger(n));
    if (via.length) for (const r of await safe(`SELECT node_id AS id, ST_AsGeoJSON(geom) AS g FROM driving.nodes WHERE node_id IN (${via.join(",")})`)) { try { feats.push({ type: "Feature", properties: { turn: 1 }, geometry: JSON.parse(r.g) }); } catch { /* no geometry */ } }
    const solids = await extrusions();
    if (my === mapToken) {
      map.getSource("fix-edits")?.setData({ type: "FeatureCollection", features: feats }); drawnCount.edits = feats.length;
      map.getSource("fix-3d")?.setData({ type: "FeatureCollection", features: solids }); drawnCount.heights = solids.map((f) => f.properties.h);
    }
  }

  // the roads that leave the junction (the Turn tab), in green; a hover on a row of the list outlines its road
  let turnOut = [], turnToken = 0;
  async function drawTurnRoads() {
    const my = ++turnToken;
    let feats = [];
    if (open() && current === "turns" && turnOut.length) {
      ensureLayers();
      feats = (await safe(`SELECT osm_id AS id, ST_AsGeoJSON(geometry) AS g FROM driving.edges WHERE osm_id IN (${turnOut.join(",")})`))
        .map((r) => { try { return { type: "Feature", properties: { id: Number(r.id) }, geometry: JSON.parse(r.g) }; } catch { return null; } }).filter(Boolean);
    }
    if (my !== turnToken) return;
    map.getSource("fix-turn")?.setData({ type: "FeatureCollection", features: feats });
    drawnCount.turn = feats.length;
  }
  $("fix-out").addEventListener("mouseover", (e) => { const r = e.target.closest(".turn"); if (r && map.getLayer("fix-turn-hl")) map.setFilter("fix-turn-hl", ["==", ["get", "id"], Number(r.dataset.to)]); });
  $("fix-out").addEventListener("mouseout", (e) => { if (!e.relatedTarget?.closest?.(".turn") && map.getLayer("fix-turn-hl")) map.setFilter("fix-turn-hl", ["==", ["get", "id"], -1]); });

  let selToken = 0;
  async function drawSelected(zoom, { turn = null } = {}) {
    const my = ++selToken;
    ensureLayers();
    let feats = [];
    if (!open()) {                                    // the panel is closed: nothing is selected on the map
      map.getSource("fix-sel")?.setData({ type: "FeatureCollection", features: [] }); drawnCount.sel = 0;
      return;
    }
    if (turn) {
      const from = whole($("fix-from").value), feat = (g, props) => { try { return { type: "Feature", properties: props, geometry: JSON.parse(g) }; } catch { return null; } };
      const road = from ? await safe(`SELECT ST_AsGeoJSON(geometry) AS g FROM driving.edges WHERE osm_id = ${from}`) : [];
      const junction = await safe(`SELECT ST_AsGeoJSON(geom) AS g FROM driving.nodes WHERE node_id = ${Number(turn.via)}`);
      feats = [...road.map((r) => feat(r.g, {})), ...junction.map((r) => feat(r.g, { j: 1 }))].filter(Boolean);
    } else if (sel && EDIT.includes(current)) feats = await shapes([{ type: sel.type, id: sel.id }]);
    else if (current === "new" && editNew != null) {
      const w = F.newWays(doc).find((x) => x.id === editNew), line = w ? await newWayLine(w) : [];
      if (line.length > 1) feats = [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } }];
    }
    if (my !== selToken) return;
    map.getSource("fix-sel")?.setData({ type: "FeatureCollection", features: feats }); drawnCount.sel = feats.length;
    if (zoom && feats.length) {
      const b = new maplibregl.LngLatBounds();
      const add = (c) => (typeof c[0] === "number" ? b.extend(c) : c.forEach(add));
      for (const f of feats) add(f.geometry.coordinates);
      map.fitBounds(b, { padding: { top: 80, bottom: 80, left: innerWidth > 700 ? 440 : 40, right: 90 }, maxZoom: 19, duration: 600 });
    }
  }

  // ---- a new road: click points on the map (a click near a junction joins it), set the kind, finish; the rule is in `new_ways`
  let draw = null, newDraft = {}, editNew = null;          // editNew: the id of a new road of the changes that is open for edit (its points stay)
  const newFields = presets.new_road ?? [];
  function renderNewForm() {
    $("fix-newform").innerHTML = `<div class="grid2 fixgrid">${newFields.map((f) => `<label for="fixn-${f.key}" class="small">${esc(f.label)}</label>${control({ ...f }, newDraft[f.key] ?? "").replace(`id="fixf-${f.key.replace(/[^a-z0-9]/gi, "_")}"`, `id="fixn-${f.key}"`)}`).join("")}</div>`;
  }
  const drawn = () => { paintDots(); $("fix-draw-n").textContent = draw ? `${draw.pts.length} point${draw.pts.length === 1 ? "" : "s"}${draw.pts.some((p) => p.id != null) ? ", joins a junction" : ""}` : ""; };
  async function drawPreview() {
    ensureLayers();
    const pts = draw?.pts ?? [], feats = pts.map((p) => ({ type: "Feature", properties: { snap: p.id != null ? 1 : 0 }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } }));
    if (pts.length > 1) feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lng, p.lat]) } });
    map.getSource("fix-draw")?.setData({ type: "FeatureCollection", features: feats });
    drawnCount.draw = pts.length;
  }
  function startDraw() {
    draw = { pts: [] }; newDraft = { highway: "residential" };
    $("fix-drawbox").hidden = false; $("fix-draw").hidden = true;
    renderNewForm(); paintNewMode(); drawn(); drawPreview();
    map.getCanvas().style.cursor = current === "new" ? "crosshair" : "";
  }
  function stopDraw() {
    draw = null; editNew = null; $("fix-drawbox").hidden = true; $("fix-draw").hidden = false;
    paintNewMode(); map.getCanvas().style.cursor = ""; drawn(); drawPreview(); drawSelected(false);
  }
  // the New road tab has two modes: draw (points and form) and edit (the form of a road that is in the changes)
  function paintNewMode() {
    const edit = editNew != null;
    $("fix-draw-undo").hidden = edit;
    $("fix-new-del").hidden = !edit;
    $("fix-draw-done").textContent = edit ? "Update change" : "Add to changes";
    $("fix-draw-help").innerHTML = edit ? "The points of this road stay. To change them, remove the road and draw it again." : "Click the points of the road on the map. <b>Enter</b> finishes, <b>Esc</b> cancels.";
  }
  function startEdit(id) {
    const w = F.newWays(doc).find((x) => x.id === id);
    if (!w) return;
    if (draw) stopDraw();
    editNew = id; newDraft = { ...w.tags };
    $("fix-drawbox").hidden = false; $("fix-draw").hidden = true;
    renderNewForm(); paintNewMode();
    $("fix-draw-n").textContent = `${plural(w.nodes.length, "point")}${w.nodes.some(Number.isInteger) ? ", joins a junction" : ""}`;
  }
  $("fix-new-del").onclick = () => { const id = editNew; commit(() => F.deleteNewWay(doc, id)); stopDraw(); status(`Removed from the changes: new road ${id}.`); };
  async function addPoint(e) {
    const { lng, lat } = e.lngLat, d = px(e, 14);
    let best = null;
    for (const m of modes()) for (const r of await safe(`SELECT node_id AS id, ST_X(geom) AS x, ST_Y(geom) AS y FROM ${m}.nodes WHERE node_id IN (SELECT node_id FROM ${m}.way_nodes) AND ST_X(geom) BETWEEN ${lng - d} AND ${lng + d} AND ST_Y(geom) BETWEEN ${lat - d} AND ${lat + d}`)) {   // only OSM nodes: the nodes table also has synthetic ones
      const dist = (r.x - lng) ** 2 + (r.y - lat) ** 2;
      if (!best || dist < best.dist) best = { id: Number(r.id), lng: r.x, lat: r.y, dist };
    }
    draw?.pts.push(best ? { id: best.id, lng: best.lng, lat: best.lat } : { id: null, lng, lat });
    drawn(); drawPreview();
  }
  function finishDraw() {
    if (editNew == null && (!draw || draw.pts.length < 2)) return status("Click at least two points on the map.");
    const w = editNew != null ? F.newWays(doc).find((x) => x.id === editNew) : null, tags = {};
    for (const f of newFields) {
      const v = (document.getElementById(`fixn-${f.key}`)?.value ?? "").trim();
      if (f.type === "int" && v !== "" && !/^\d+$/.test(v)) return status(`${f.label} is a whole number.`);
      if (v) tags[f.key] = v;
    }
    if (!tags.highway) return status("Pick the kind of road.");
    if (w) {                                                          // the tags that the form has no field for stay as they are
      const keep = Object.fromEntries(Object.entries(w.tags ?? {}).filter(([k]) => !newFields.some((f) => f.key === k)));
      commit(() => F.updateNewWayTags(doc, w.id, { ...keep, ...tags }));
      stopDraw();
      return status(`Updated the change: new road ${w.id}.`);
    }
    const nodes = draw.pts.map((q) => q.id ?? [Math.round(q.lng * 1e7) / 1e7, Math.round(q.lat * 1e7) / 1e7]);
    let id;
    commit(() => { id = F.addNewWay(doc, { nodes, tags }); });
    stopDraw();
    status(`Added to the changes: new road ${id}. Build again to have it in the tables.`);
  }
  $("fix-draw").onclick = startDraw;
  $("fix-draw-done").onclick = finishDraw;
  $("fix-draw-undo").onclick = () => { draw?.pts.pop(); drawn(); drawPreview(); };
  $("fix-draw-cancel").onclick = stopDraw;
  document.addEventListener("keydown", (e) => { if (!draw || !open() || current !== "new") return; if (e.key === "Escape") stopDraw(); else if (e.key === "Enter" && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) finishDraw(); });

  // ---- what a click on the map picks
  const open = () => document.body.classList.contains("editing-fixes");
  const px = (e, n) => { const a = map.unproject([e.point.x - n, e.point.y]), c = map.unproject([e.point.x + n, e.point.y]); return Math.abs(c.lng - a.lng) / 2; };
  // the distance in pixels from a point to a line of the map
  function pixelsToLine(pt, coords) {
    const q = coords.map((c) => map.project(c));
    let best = Infinity;
    for (let i = 1; i < q.length; i++) {
      const ax = q[i - 1].x, ay = q[i - 1].y, dx = q[i].x - ax, dy = q[i].y - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((pt.x - ax) * dx + (pt.y - ay) * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(pt.x - (ax + t * dx), pt.y - (ay + t * dy)));
    }
    return best;
  }
  // a click within 10 px of a wall: a wall of the picked building, or (with "Show the walls of all buildings") of another building, which gets picked too
  async function wallAt(e) {
    let best = null;
    for (const w of walls) { const d = pixelsToLine(e.point, wallLine(w)); if (d <= 10 && (!best || d < best.d)) best = { d, key: wallKey(w) }; }
    if (best) { selectWall(best.key); return true; }
    if (!hasFaces() || !$("fix-walls-all").checked || map.getZoom() < 16) return false;
    const { lng, lat } = e.lngLat, dd = px(e, 10);
    const r = (await safe(`SELECT building_id AS b, from_node AS f, to_node AS n FROM main.building_faces WHERE ST_Distance(geometry, ST_Point(${lng}, ${lat})) < ${dd} ORDER BY ST_Distance(geometry, ST_Point(${lng}, ${lat})) LIMIT 1`))[0];
    if (!r) return false;
    const key = `${Number(r.f)}|${Number(r.n)}`;
    if (!(sel?.kind === "building" && sel.id === Number(r.b))) await select("building", "way", Number(r.b));
    selectWall(key);
    return true;
  }
  async function onMapClick(e) {
    if (open() && draw && current === "new") return addPoint(e);
    if (!open() || (current !== "building" && current !== "node")) return;        // a road is picked by the dashboard's click (rs:select), a turn too
    const { lng, lat } = e.lngLat;
    if (current === "building") {
      if (await wallAt(e)) return;
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
    if (draw && current === "new") { setTimeout(() => window.rsDeselect?.()); return; }              // a click while drawing adds a point (onMapClick)
    const turns = current === "turns";
    if (!turns && current !== "road") return;                            // a building or a node is picked by its own click
    const id = Number(ctx.roadIdOfRow(e.detail?.id));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    if (turns) { $("fix-from").value = id; findTurns(id); }
    else select("road", "way", id);
  });

  // ---- wiring
  $("fix-form").addEventListener("keydown", (e) => { const row = e.target.closest?.(".wallrow"); if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selectWall(row.dataset.key, { zoom: true }); } });
  $("fix-form").addEventListener("input", onInput);
  $("fix-form").addEventListener("change", onInput);
  $("fix-form").addEventListener("click", (e) => {
    const nav = e.target.closest("[data-wall-nav]");
    if (nav) return stepWall(Number(nav.dataset.wallNav));
    const row = e.target.closest(".wallrow");
    if (row && !e.target.closest("select")) return selectWall(row.dataset.key, { zoom: true });
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.revert) return revertKey(t.dataset.revert);
    if (t.dataset.clear) { draft[t.dataset.clear] = ""; touched.add(t.dataset.clear); t.closest(".otherrow").querySelector("input").value = ""; t.closest(".otherrow").classList.add("edited"); return paintBar(); }
    if (t.id === "fix-add") {
      const k = $("fix-addkey").value.trim(), v = $("fix-addval").value.trim();
      if (!k || !v) return status("Type a key and a value.");
      draft[k] = v; touched.add(k); renderForm();
    }
  });
  $("fix-save").onclick = save;
  $("fix-unselect").onclick = unselect;
  $("fix-revert").onclick = () => { touched = new Set(); draft = initialDraft(); renderForm(); };
  for (const b of document.querySelectorAll("#fix-panel [data-review]")) b.onclick = () => setTab("changes");
  $("fix-pending").addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) setTab(b.dataset.go, { zoom: true }); });
  $("fix-del").onclick = () => {
    if (!sel) return;
    commit(() => F.deleteObjectRule(doc, sel.type, sel.id));
    draft = initialDraft(); renderForm();
    status(`Removed from the changes: ${sel.type} ${sel.id}. The data has the original values after the next build.`);
  };
  $("fix-load").onclick = () => { const id = whole($("fix-id").value); id ? select(kind, KIND_OF[kind], id, { zoom: true }) : status("Type an OSM ID (a whole number)."); };
  $("fix-walls-row").onchange = drawFaces;
  $("fix-id").onkeydown = (e) => { if (e.key === "Enter") $("fix-load").click(); };
  for (const t of TABS) $(`fix-tab-${t}`).onclick = () => setTab(t, { zoom: true });          // the tab shows its object on the map

  // ---- the numbers on the page
  function sync() {
    const { turns, faces, newWays } = F.counts(doc), n = F.objects(doc).length + turns + faces + newWays;
    $("fix-n").textContent = n ? String(n) : "";
    $("fix-apply-n").textContent = n ? ` (${plural(n, "change")})` : "";
    paintBar();
    if (current === "turns" && !$("fix-turnsec").hidden) outgoing();
    const s = (x) => (x === 1 ? "" : "s");
    ctx.onChange(n ? `${n} change${s(n)}: ${F.objects(doc).length} object${s(F.objects(doc).length)}, ${turns} turn rule${s(turns)}, ${faces} wall${s(faces)}, ${newWays} new road${s(newWays)}.` : "No fixes.", n);
    if (!$("fix-changes").hidden) renderChanges();
    drawEdits();
    drawFaces();
  }

  // ---- what the page uses
  function text() { return F.dump(yaml, doc) || null; }
  // the changes of an area stay in this browser (one text for each area name), so a reload of the page does not lose them
  const storeKey = () => "duckosm.fixes:" + (ctx.areaKey?.() || "area");
  function persist() { try { const t = text(); t ? localStorage.setItem(storeKey(), t) : localStorage.removeItem(storeKey()); } catch { /* no storage */ } }
  function restore() {
    if (total()) return 0;
    try { const t = localStorage.getItem(storeKey()); if (!t) return 0; doc = F.parse(yaml, t); hist = []; future = []; sync(); return total(); } catch { return 0; }
  }
  function load(txt) {
    try { doc = F.parse(yaml, txt); hist = []; future = []; persist(); sync(); if (sel && data) { draft = initialDraft(); renderForm(); } }
    catch (e) { status("The fixes file is not valid: " + e.message.split("\n")[0], 8000); }
  }
  function openPanel() {
    clearMapSelection();                             // what was selected before (roadstyle's road selection and its popup) is not selected in this panel
    document.body.classList.add("editing-fixes"); ensureLayers();
    const back = restore();
    if (back) status(`${plural(back, "change")} from your last visit ${back === 1 ? "is" : "are"} back.`, 6000);
    setTab(current); drawEdits();
  }
  async function openFrom() { await duck.loadSpatial(); openPanel(); }
  // after a build: the data is new, so each tab loads its object again (the changes and the picked objects stay)
  const rebuilt = () => {
    kinds.clear(); names.clear(); walls = []; wallSel = null;
    for (const k of EDIT) if (k !== kind && stash[k]?.sel) stash[k] = { sel: stash[k].sel, data: null, draft: {}, touched: new Set(), walls: [], wallSel: null };
    if (sel) select(kind, sel.type, sel.id, { go: false }); else { renderObject(); drawSelected(false); }
    drawEdits(); drawFaces(); drawNodes();
  };
  // leaving the panel unselects everything on the map: the blue objects, roadstyle's road selection, the node dots, the turn roads and the walls (the amber changes stay)
  function close() {
    if (draw) stopDraw();
    document.body.classList.remove("editing-fixes");
    clearMapSelection(); drawSelected(false); drawFaces(); drawNodes(); drawTurnRoads();
  }

  setTab("road"); sync();
  return { text, load, restore, open: openFrom, close, isOpen: open, rebuilt, select, tab: setTab, drawn: () => ({ ...drawnCount }), count: () => F.objects(doc).length + (doc.turn_restrictions ?? []).length + F.faceEdits(doc).length + F.newWays(doc).length };
}
