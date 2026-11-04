// The Design panel (docs/dashboard.md, card 9): the style of the map and the profile of the tiles. It is built like the Fix OSM data panel
// (index.html, #design-panel): a header, five tabs and a bar. This file owns the design (app/design.js) and draws the tabs; the page gives it
// the look (map/look.json), the way to draw the map again with a new look, and the places to keep the design.
//
//   initDesignPanel({ $, esc, look, redraw, onProfile, onBoundary, onGround, onVisible, onRoads, has, preview, onSave }) -> { open, close, isOpen, tab, get, text, set, patchProfile, profile, boundary, setVisible, refresh, load, setCount, flush, state }
//
// A change of the style draws the map again after 0.5 s of quiet (`redraw(lookObject, isDefault, draw)`: it gives the look to the map and, with `draw`, draws). A change of the profile calls `onProfile(profile)`, a change of the boundary calls `onBoundary(boundary)`, of the ground `onGround(ground)`, and of the layers `onVisible(visible)` (the page paints them at once: no new draw of the roads). `has(key)` tells whether the build has a layer (false: "not in this build"); `preview` = {get(), set(v)} is the base map under the map (checkerboard, blank, openfreemap, satellite, other);
// the Export card reads the profile through `profile()`.
import * as D from "./design.js";
import * as UT from "./user_themes.js";

const TABS = ["theme", "roads", "text", "layers", "tiles"];
const NAMES = { theme: "Theme", roads: "Roads", text: "Text", layers: "Layers", tiles: "Tiles" };
const LABEL = { motorway: "Motorway", trunk: "Trunk", primary: "Primary", secondary: "Secondary", tertiary: "Tertiary", unclassified: "Unclassified", residential: "Residential",
  living_street: "Living street", service: "Service", pedestrian: "Pedestrian", cycleway: "Cycleway", footway: "Footway", path: "Path", track: "Track" };
const COLUMN_NOTE = { source: "start node", target: "end node" };
const pretty = (c) => COLUMN_NOTE[c] ? `${c} (${COLUMN_NOTE[c]})` : c;

const setPath = (o, path, v) => {
  const keys = path.split(".");
  const last = keys.pop();
  for (const k of keys) o = o[k];
  o[last] = v;
};

export async function initDesignPanel({ $, esc, look, redraw, onProfile = () => {}, onBoundary = () => {}, onGround = () => {}, onVisible = () => {}, onRoads = () => {}, has = () => true, preview = { get: () => "other", set: () => {} }, onSave = () => {} }) {
  const base = D.defaultsOf(look);
  let themeFilter = "all", themeQuery = "";                                                 // the filter and the search above the theme list
  let mine = UT.readAll(), origin = null, ask = null, armed = null, renaming = null, nameDraft = "", keepDraft = false, mineMsg = "";       // the themes that the person saved (app/user_themes.js)
  let design = structuredClone(base), tab = "theme", lastKey = null, timer = null, busy = false, again = false, note = "", counts = { text: "", bad: false };
  const styleKey = (d) => {                                          // the profile, the boundary, the ground, the layers and the opacity are not in the look: they draw no new map
    const k = structuredClone({ ...d, name: 0, theme: 0, profile: 0, boundary: 0, ground: 0, visible: 0 });
    delete k.roads.opacity; delete k.labels.halo_opacity; delete k.arrows.opacity;
    return JSON.stringify(k);
  };
  const announce = () => { onProfile(design.profile); onBoundary(design.boundary); onGround(design.ground); onVisible(design.visible); onRoads(design); };
  const profile = () => design.profile;

  // ---- the controls ----
  const color = (label, p, v) => `<label class="drow2"><span>${label}</span><input type="color" data-p="${p}" value="${v}"></label>`;
  const shown = (v, unit) => (unit === "%" ? `${Math.round(v * 100)}%` : `${+(+v).toFixed(2)}${unit}`);          // the unit "%" shows a fraction (0 to 1) as a percent
  const range = (label, p, v, min, max, step, unit = "") => `<label class="drow2 rng"><span>${label}</span><input type="range" data-unit="${unit}" data-p="${p}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${shown(v, unit)}</output></label>`;
  const number = (label, p, v, min, max, step = 1, extra = "") => `<label class="drow2"><span>${label}</span><input type="number" data-p="${p}" min="${min}" max="${max}" step="${step}" value="${v}" ${extra}></label>`;
  const check = (label, p, v, note2 = "", extra = "") => `<label class="optrow"><input type="checkbox" data-p="${p}" ${v ? "checked" : ""} ${extra}><span class="t"><b>${label}</b>${note2 ? `<small>${note2}</small>` : ""}</span></label>`;
  const sec = (title, body, why = "") => `<section class="fsec"><h3>${title}</h3>${why ? `<p class="why">${why}</p>` : ""}${body}</section>`;

  // ---- the tabs ----
  // four cells: the ground, a road fill, its casing, the water; a transparent ground or a layer that is off shows as a checkerboard
  const swatches = (d) => [[d.base.background, d.ground.transparent && d.ground.opacity < 0.5], [d.roads.fill.primary], [d.roads.casing.primary], [d.base.water, d.visible.water === false]]
    .map(([c, none]) => `<i${none ? ' class="none"' : ` style="background:${c}"`}></i>`).join("");
  const themeCard = (t) => { const d = t.make(base); return `<button type="button" class="theme" role="radio" data-look="${t.id}" aria-checked="${design.theme === t.id}"><span class="sw5">${swatches(d)}</span><b>${t.name}</b><small>${esc(t.note)}</small></button>`; };
  const mineCard = (t) => {
    const on = design.theme === `mine:${t.id}`;
    if (renaming === t.id) return `<div class="theme mine" data-mine="${t.id}"><span class="sw5">${swatches(D.normalize(t.design, base))}</span><input type="text" id="mine-rename" maxlength="${UT.MAX_NAME}" value="${esc(t.name)}" aria-label="New name"><span class="acts"><button type="button" class="btn sm" data-mine-do="rename-ok">Save</button><button type="button" class="btn sm" data-mine-do="rename-no">Cancel</button></span></div>`;
    return `<div class="theme mine" data-mine="${t.id}" aria-current="${on}"><span class="sw5">${swatches(D.normalize(t.design, base))}</span><b>${esc(t.name)} <span class="yours">yours</span></b>
      <span class="acts"><button type="button" class="btn sm" data-mine-do="apply">Apply</button><button type="button" class="btn sm" data-mine-do="rename">Rename</button><button type="button" class="btn sm${armed === t.id ? " danger" : ""}" data-mine-do="delete">${armed === t.id ? "Delete?" : "Delete"}</button></span></div>`;
  };
  const paneMine = () => {
    const from = origin && UT.find(mine, origin.name), custom = design.theme === "custom";
    return sec("Your themes",
      (custom ? `<p class="small">The design is <b>custom</b>${origin ? ` (it began as "${esc(origin.name)}")` : ""}. ${from ? `<button type="button" class="btn sm" data-mine-do="update">Update "${esc(from.name)}"</button>` : ""}</p>` : "")
      + `<label class="drow2"><span>Name</span><input type="text" id="mine-name" maxlength="${UT.MAX_NAME}" value="${esc(nameDraft)}" placeholder="A name for this design" aria-label="Name of the theme"></label>
        <label class="optrow"><input type="checkbox" id="mine-keep" ${keepDraft ? "checked" : ""}><span class="t"><b>Keep the tile profile in the theme</b><small>Off: the theme keeps the tile profile that the page has, as the ready themes do.</small></span></label>
        <div class="row"><button type="button" class="btn" id="mine-save">Save as a theme</button></div>`
      + (ask ? `<p class="small" role="alert">A theme named "${esc(ask.name)}" exists. Replace it? <button type="button" class="btn sm" data-mine-do="replace">Replace</button> <button type="button" class="btn sm" data-mine-do="keep-old">Cancel</button></p>` : "")
      + `<p class="small" id="mine-msg" role="status">${esc(mineMsg)}</p>`
      + (mine.length ? `<div class="themes" id="mine-list">${mineShown().map(mineCard).join("")}</div>` : '<p class="why">No saved theme yet. Pick a theme, change it, and save it here with a name.</p>')
      + `<div class="row"><button type="button" class="btn" id="mine-download" ${mine.length ? "" : "disabled"}>Download all my themes</button><button type="button" class="btn" id="mine-load">Load themes from a file</button></div><input id="mine-file" type="file" accept=".json,application/json" hidden>`,
      "Your themes are for all areas. A saved area keeps the design that it used. They stay in this browser: download them to use them on another computer.");
  };
  const panePreview = () => {
    const v = preview.get();
    return sec("Preview on", `<label class="drow2"><span>Base map</span><select id="design-preview" aria-label="Preview on">${[["checkerboard", "Checkerboard"], ["blank", "Blank"], ["openfreemap", "OpenFreeMap"], ["satellite", "Satellite"]].map(([k, n]) => `<option value="${k}" ${v === k ? "selected" : ""}>${n}</option>`).join("")}${v === "other" ? '<option value="other" selected disabled>Other (base-map box)</option>' : ""}</select></label>`,
      "This changes only the map under the roads. It is the base map of the base-map box: one choice in two places. A transparent ground shows the checkerboard on the Blank map.");
  };
  const shownThemes = () => D.THEMES.filter((t) => D.themeMatches(t, themeFilter, themeQuery));
  const readyList = () => {
    const list = shownThemes();
    if (!list.length) return `<p class="why">No ready theme has these words in this filter.</p>`;
    return D.THEME_KINDS.map(([k, n, why]) => {
      const of = list.filter((t) => D.themeKind(t) === k);
      return of.length ? `<div class="kind" data-kind="${k}"><b>${n}</b><small>${why}</small></div>${of.map(themeCard).join("")}` : "";
    }).join("");
  };
  const paneTheme = () => sec("Ready themes", `<input type="search" id="theme-search" placeholder="Search themes: google, dark, print…" value="${esc(themeQuery)}" aria-label="Search themes">
      <div class="chips" role="group" aria-label="Filter themes">${D.THEME_FILTERS.map(([k, n]) => `<button type="button" class="chip" data-tf="${k}" aria-pressed="${themeFilter === k}">${n}</button>`).join("")}</div>
      <p class="small muted" id="theme-count" role="status"></p>
      <div class="themes" id="ready-list" role="radiogroup" aria-label="Ready themes">${readyList()}</div>`, "Pick a theme with one click, then change any value in the other tabs. A theme keeps your tile profile.")
    + panePreview() + paneMine()
    + sec("Your design", `<label class="drow2"><span>Name</span><input type="text" data-p="name" value="${esc(design.name)}" maxlength="60" aria-label="Name of the design"></label>
      <div class="row"><button type="button" class="btn" id="design-download">Download</button><button type="button" class="btn" id="design-load">Load a file</button><button type="button" class="btn" id="design-reset">Reset</button></div>
      <input id="design-file" type="file" accept=".json,application/json" hidden>
      <p class="why" id="design-where">The page keeps the design in this browser, with the saved area. Download saves it as one .json file.</p>`);
  const paneRoads = () => sec("Colors", `<div class="rhead"><span></span><span>Fill</span><span>Casing</span></div>${D.CLASSES.map((c) => `<div class="drow2 cls"><span>${LABEL[c]}</span><input type="color" data-p="roads.fill.${c}" value="${design.roads.fill[c]}" aria-label="${LABEL[c]} fill"><input type="color" data-p="roads.casing.${c}" value="${design.roads.casing[c]}" aria-label="${LABEL[c]} casing"></div>`).join("")}`,
      "The casing is the outline of a road. A link road has the colors of its class.")
    + sec("Opacity", range("Fill opacity", "roads.opacity.fill", design.roads.opacity.fill, 0, 1, 0.05, "%") + range("Casing opacity", "roads.opacity.casing", design.roads.opacity.casing, 0, 1, 0.05, "%")
      + check("Casing as an outline", "roads.opacity.outline", design.roads.opacity.outline, "The casing is drawn only outside the fill, not under it. Use it when the fill is not opaque: the map under the road then shows through the fill."),
      "100 percent is the opacity of the style. A lower value lets the map under the roads show through.")
    + sec("Width", D.GROUPS.map(([g, n]) => range(n, `roads.width.${g}`, design.roads.width[g], 0.5, 2.5, 0.05, " ×")).join(""), "A factor for the whole width curve of a group. 1 is the width of the theme.")
    + sec("Dark mode", `<p class="why">The map in the dark theme changes each light color to a dark one. These ranges set how light the dark colors are (0 is black, 1 is white).</p>`
      + [["roads", "Road fill"], ["casing", "Casing"], ["areas", "Areas"], ["labels", "Text"]].map(([k, n]) => `<div class="drow2 two"><span>${n}</span><input type="number" data-p="dark.${k}.0" min="0" max="1" step="0.02" value="${design.dark[k][0]}" aria-label="${n}, darkest"><input type="number" data-p="dark.${k}.1" min="0" max="1" step="0.02" value="${design.dark[k][1]}" aria-label="${n}, lightest"></div>`).join("")
      + color("Dark ground", "dark.background", design.dark.background));
  const paneText = () => sec("Street names", color("Color", "labels.color", design.labels.color) + color("Halo color", "labels.halo_color", design.labels.halo_color)
      + range("Halo width", "labels.halo_width", design.labels.halo_width, 0, 4, 0.25, " px") + range("Halo opacity", "labels.halo_opacity", design.labels.halo_opacity, 0, 1, 0.05, "%") + range("Size", "labels.size", design.labels.size, 0.6, 1.8, 0.05, " ×")
      + number("From zoom", "labels.minzoom", design.labels.minzoom, 8, 20), "Smaller roads show their names two zooms later.")
    + sec("One-way arrows", color("Color", "arrows.color", design.arrows.color) + range("Size", "arrows.size", design.arrows.size, 0.5, 3, 0.1, " ×") + range("Opacity", "arrows.opacity", design.arrows.opacity, 0, 1, 0.05, "%") + number("From zoom", "arrows.minzoom", design.arrows.minzoom, 8, 20),
      "The switch for the arrows is in the Layers box of the map bar.");
  const paneVisible = () => {
    const v = design.visible, row = (k, n) => {
      const off = has(k) === false;
      return `<label class="col"><input type="checkbox" data-p="visible.${k}" ${v[k] ? "checked" : ""} ${off ? "disabled" : ""}>${n}${off ? ' <small class="muted">(not in this build)</small>' : ""}</label>`;
    };
    return sec("Show these layers", D.VISIBLE_GROUPS.map(([g, rows]) => `<p class="fix-group">${g}</p><div class="cols">${rows.map(([k, n]) => row(k, n)).join("")}</div>`).join("")
      + `<p class="fix-group">Area</p><div class="cols"><label class="col"><input type="checkbox" data-p="boundary.show" ${design.boundary.show ? "checked" : ""}>Area boundary</label></div>`,
      "A switch is the same as the switch in the Layers box of the map bar: both show one state. A layer that the build does not have cannot show.");
  };
  const paneGround = () => sec("Ground", check("Transparent ground", "ground.transparent", design.ground.transparent, "The ground of the map has no color, so a base map shows under the roads. Use it with the theme Roads overlay.")
      + range("Opacity of the ground", "ground.opacity", design.ground.opacity, 0, 1, 0.05).replace("<input", `<input ${design.ground.transparent ? "" : "disabled"}`),
      "0 is fully transparent. The opacity counts only while the ground is transparent.");
  const paneBoundary = () => {
    const b = design.boundary, off = b.show ? "" : "disabled";
    return sec("Area boundary", (b.show ? "" : '<p class="small muted">The boundary is hidden. Turn it on in Show these layers.</p>')
      + color("Line color", "boundary.color", b.color).replace("<input", `<input ${off}`) + range("Line width", "boundary.width", b.width, 0.5, 6, 0.5, " px").replace("<input", `<input ${off}`)
      + `<label class="drow2"><span>Line style</span><select data-p="boundary.dash" ${off}>${Object.keys(D.BOUNDARY_DASH).map((k) => `<option value="${k}" ${b.dash === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>`
      + color("Fill color", "boundary.fill", b.fill).replace("<input", `<input ${off}`) + range("Fill opacity", "boundary.fillOpacity", b.fillOpacity, 0, 1, 0.02).replace("<input", `<input ${off}`)
      + check("Fill over the roads", "boundary.fillOnRoads", b.fillOnRoads, "The fill covers the roads and changes their colors. It is off by default: the page hides the fill when the roads show.", off),
      "A fill opacity of 0 gives no fill.");
  };
  const paneLayers = () => paneVisible() + paneBoundary() + paneGround() + sec("Colors of the layers", color("Background", "base.background", design.base.background) + color("Water", "base.water", design.base.water) + color("Green areas", "base.green", design.base.green)
      + color("Built-up land", "base.land", design.base.land) + color("Sand and beach", "base.sand", design.base.sand), "Colors of the base-map layers. They show when step 4 built the base-map layers.")
    + sec("Buildings and lines", color("Buildings", "base.buildings", design.base.buildings) + color("Building outline", "base.buildingLine", design.base.buildingLine)
      + color("Railways", "base.railways", design.base.railways) + color("Waterways", "base.waterways", design.base.waterways))
    + sec("3D buildings", range("Meters for each floor", "base.m_per_level", design.base.m_per_level, 2, 6, 0.1, " m") + number("Highest building (m)", "base.max_height", design.base.max_height, 10, 500, 10)
      + range("Opacity", "base.height_opacity", design.base.height_opacity, 0.2, 1, 0.05), "The height of a building is its floors times this value, up to the highest building.");
  const paneTiles = () => {
    const p = design.profile;
    return sec("Ready profiles", `<div class="themes" role="radiogroup" aria-label="Ready profiles">${Object.entries(D.PROFILES).map(([id, x]) =>
        `<button type="button" class="theme" role="radio" data-profile="${id}" aria-checked="${p.preset === id}"><b>${x.name}</b><small>${esc(x.note)}</small></button>`).join("")}</div>`,
      "The Export card and the map use this profile.")
    + sec("Zoom", `<div class="drow2 two"><span>From zoom to zoom</span><input type="number" data-p="profile.minzoom" min="0" max="18" value="${p.minzoom}" aria-label="The lowest zoom"><input type="number" data-p="profile.maxzoom" min="0" max="18" value="${p.maxzoom}" aria-label="The highest zoom" ${p.auto ? "disabled" : ""}></div>`
      + check("The highest zoom that fits the limit", "profile.auto", p.auto, "The page counts the tiles of the area and picks the highest zoom under the limit.")
      + `<p class="small" id="design-count" role="status">${esc(counts.text)}</p>`)
    + sec("Layers in the files", check("Roads", "profile.layers.roads", p.layers.roads, "Roadstyle's road layers: the same roads as the map.")
      + check("Base map", "profile.layers.base", p.layers.base, "Water, land use, buildings, railways. They need the base-map layers of step 4.")
      + check("Layer edges", "profile.layers.edges", p.layers.edges, "Every road of every network, with the columns below."))
    + sec("Columns of the layer edges", `<div class="cols">${D.EDGE_COLUMNS.map((c) => `<label class="col"><input type="checkbox" data-col="${c}" ${p.columns.includes(c) ? "checked" : ""} ${c === "edge_id" || !p.layers.edges ? "disabled" : ""}>${pretty(c)}</label>`).join("")}</div>
      <p class="small"><button type="button" class="link" data-cols="all">All</button> · <button type="button" class="link" data-cols="few">Only edge_id</button> The networks are always in the layer, one flag for each.</p>`)
    + sec("Road class start zoom", `<div class="cols two">${Object.keys(D.CLASS_FROM).map((c) => `<label class="col"><span>${LABEL[c]}</span><input type="number" data-p="profile.classFrom.${c}" min="0" max="18" value="${p.classFrom[c]}" ${p.layers.edges ? "" : "disabled"} aria-label="${LABEL[c]} starts at zoom"></label>`).join("")}</div>`,
      `A road class is in the layer edges from its zoom. Other classes start at zoom ${D.OTHER_FROM}.`)
    + sec("Tiles", `<label class="drow2"><span>Format of the map</span><select data-p="profile.format"><option value="mlt" ${p.format === "mlt" ? "selected" : ""}>MLT (smaller)</option><option value="mvt" ${p.format === "mvt" ? "selected" : ""}>MVT</option></select></label>
      <label class="drow2"><span>Extent (layer edges)</span><select data-p="profile.extent">${[1024, 2048, 4096, 8192].map((e) => `<option ${p.extent === e ? "selected" : ""}>${e}</option>`).join("")}</select></label>`
      + number("Buffer (units, layer edges)", "profile.buffer", p.buffer, 0, 256, 8) + number("Tile limit", "profile.maxTiles", p.maxTiles, 1000, 200000, 1000),
      "The files hold MVT tiles. The MLT format is smaller on the page. Extent and buffer are in tile units and are for the layer edges: the tiles of the map have 4096 units. More tiles take more time and memory.");
  };
  const PANES = { theme: paneTheme, roads: paneRoads, text: paneText, layers: paneLayers, tiles: paneTiles };

  // ---- draw ----
  function paint() {
    $("design-pane").innerHTML = PANES[tab]();
    for (const t of TABS) $(`design-tab-${t}`).setAttribute("aria-selected", String(t === tab));
    if (tab === "theme") paintThemeList();
    $("design-pane").setAttribute("aria-labelledby", `design-tab-${tab}`);
    $("design-pane").dataset.tab = tab;
    paintBar();
  }
  /** The list of ready themes again (a filter or a search changed): the search field keeps its focus. */
  function paintThemeList() {
    const list = $("ready-list");
    if (!list) return;
    const n = shownThemes().length, yours = themeFilter === "yours";
    list.innerHTML = yours ? '<p class="why">Your themes are below.</p>' : readyList();
    $("theme-count").textContent = yours ? `${mineShown().length} of ${mine.length} of your themes` : `${n} of ${D.THEMES.length} ready themes`;
    for (const b of $("design-pane").querySelectorAll("[data-tf]")) b.setAttribute("aria-pressed", String(b.dataset.tf === themeFilter));
    const m = $("mine-list");
    if (m) m.innerHTML = mineShown().map(mineCard).join("");
  }
  const mineShown = () => (themeFilter === "all" || themeFilter === "yours" ? mine.filter((t) => String(themeQuery).toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.name.toLowerCase().includes(w))) : []);          // your themes show in All and Yours
  function paintBar() {
    $("design-name").textContent = design.name;
    $("design-changes").textContent = D.changes({ ...design, profile: 0 }, { ...base, profile: 0 }).length ? "Style: changed" : "Style: default";
    $("design-state").textContent = note;
    const clear = D.groundAlpha(design) < 0.5 && ["checkerboard", "blank"].includes(preview.get());
    $("design-notice").textContent = clear ? "The ground is transparent: pick a base map in the base-map box to see it through." : "";
  }
  function tabTo(name) {
    tab = TABS.includes(name) ? name : "theme";
    const keep = $("design-pane").parentElement.scrollTop;
    paint();
    $("design-pane").parentElement.scrollTop = name === tab ? keep : 0;
  }

  // ---- apply: the style draws the map again, the profile goes to the page ----
  function save() {
    const text = D.toFile(design);
    try { localStorage.setItem("duckosm.design", text); } catch (_) { /* a private window has no storage: the design stays on the page */ }
    onSave(text);
  }
  async function run() {
    const key = styleKey(design);
    if (key === lastKey) return;
    if (busy) { again = true; return; }
    busy = true;
    note = "Drawing the map…"; paintBar();
    try {
      lastKey = key;
      note = (await redraw(D.applyToLook(look, design), key === styleKey(base), true)) ?? "The map shows this design.";
    } catch (e) {
      lastKey = null; note = "The map could not draw this design: " + e.message;
    } finally {
      busy = false; paintBar();
      if (again) { again = false; schedule(0); }
    }
  }
  function schedule(ms = 500) { clearTimeout(timer); timer = setTimeout(run, ms); }
  const changed = () => {
    design = D.normalize(design, base);
    save(); schedule(); announce(); paintBar();
  };

  // ---- events ----
  $("design-pane").addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.col) {
      const cols = new Set(design.profile.columns);
      el.checked ? cols.add(el.dataset.col) : cols.delete(el.dataset.col);
      design.profile.columns = D.EDGE_COLUMNS.filter((c) => cols.has(c)); design.profile.preset = "custom";
      return changed();
    }
    const p = el.dataset.p;
    if (!p) return;
    const v = el.type === "checkbox" ? el.checked : el.type === "range" || el.type === "number" ? (el.value === "" ? NaN : +el.value) : el.value;
    if (Number.isNaN(v)) return;
    setPath(design, p, el.tagName === "SELECT" && p === "profile.extent" ? +v : v);
    if (el.type === "range") el.parentElement.querySelector("output").textContent = shown(v, el.dataset.unit);
    if (p.startsWith("profile.")) { design.profile.preset = "custom"; if (el.type === "checkbox" || el.tagName === "SELECT") return (changed(), paint()); }
    else if (p === "boundary.show" || p === "ground.transparent") { design.theme = "custom"; return (changed(), paint()); }
    else if (p !== "name") design.theme = "custom";
    changed();
  });
  $("design-pane").addEventListener("click", (e) => {
    const t = e.target.closest("[data-look]");
    if (t) {
      const keep = design.profile;
      design = D.THEMES.find((x) => x.id === t.dataset.look).make(base, design);          // a road palette keeps the base map of the design that is on now (D.THEME_KINDS)
      design.profile = keep; origin = null; changed(); return paint();
    }
    const pr = e.target.closest("[data-profile]");
    if (pr) { design.profile = D.normalizeProfile(D.PROFILES[pr.dataset.profile].make()); changed(); return paint(); }
    const cols = e.target.closest("[data-cols]");
    if (cols) { design.profile.columns = cols.dataset.cols === "all" ? [...D.EDGE_COLUMNS] : ["edge_id"]; design.profile.preset = "custom"; changed(); return paint(); }
    const tf = e.target.closest("[data-tf]");
    if (tf) { themeFilter = tf.dataset.tf; return paintThemeList(); }
    const mb = e.target.closest("[data-mine-do]");
    if (mb) return mineAction(mb.dataset.mineDo, mb.closest("[data-mine]")?.dataset.mine);
    if (e.target.id === "mine-save") return mineSave();
    if (e.target.id === "mine-download") return download("duckosm-themes.json", UT.toFile(mine));
    if (e.target.id === "mine-load") return $("mine-file").click();
    if (e.target.id === "design-reset") { const keep = design.profile; design = structuredClone(base); design.profile = keep; changed(); return paint(); }
    if (e.target.id === "design-download") {
      const a = Object.assign(document.createElement("a"), { download: `${design.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "design"}.design.json`, href: URL.createObjectURL(new Blob([D.toFile(design)], { type: "application/json" })) });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href)); return;
    }
    if (e.target.id === "design-load") return $("design-file").click();
  });
  function download(name, text) {
    const a = Object.assign(document.createElement("a"), { download: name, href: URL.createObjectURL(new Blob([text], { type: "application/json" })) });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href));
  }
  // ---- your themes: save, apply, rename, delete (a second click), update, and the file of all of them ----
  const keepMine = () => { if (!UT.writeAll(mine)) mineMsg = "The browser cannot keep the themes. They stay on this page until you close it."; };
  const say = (t) => { mineMsg = t; paint(); };
  function mineSave(replace = false) {
    mineMsg = "";
    const name = $("mine-name").value;
    const err = UT.nameError(name);
    if (err) return say(err);
    if (UT.find(mine, name) && !replace) { ask = { name: name.trim() }; return say(""); }
    mine = UT.put(mine, name, design, keepDraft);
    const t = UT.find(mine, name);
    design.theme = `mine:${t.id}`; design.name = t.name; origin = { id: t.id, name: t.name }; ask = null; nameDraft = "";
    keepMine(); save(); paintBar();
    say(mineMsg || `Saved "${t.name}".`);
  }
  function mineAction(what, id) {
    mineMsg = "";                                           // `keepMine` can set a message: a message that is left is from an earlier action
    const t = mine.find((x) => x.id === id);
    if (what === "replace") return mineSave(true);
    if (what === "keep-old") { ask = null; return say(""); }
    if (what === "update" && origin) {
      const old = UT.find(mine, origin.name);
      if (!old) return say("");
      mine = UT.put(mine, old.name, design, old.keepProfile);
      design.theme = `mine:${old.id}`; design.name = old.name; keepMine(); save(); paintBar();
      return say(mineMsg || `Updated "${old.name}".`);
    }
    if (!t) return;
    if (what === "apply") {
      const keep = design.profile;
      design = D.normalize(t.design, base);
      design.profile = t.keepProfile && t.design.profile ? D.normalizeProfile(t.design.profile) : keep;
      design.theme = `mine:${t.id}`; design.name = t.name; origin = { id: t.id, name: t.name }; mineMsg = "";
      changed(); return paint();
    }
    if (what === "rename") { renaming = id; return say(""); }
    if (what === "rename-no") { renaming = null; return say(""); }
    if (what === "rename-ok") {
      try { mine = UT.rename(mine, id, $("mine-rename").value); } catch (err) { return say(err.message); }
      renaming = null; if (origin?.id === id) origin.name = UT.find(mine, $("mine-rename").value).name; keepMine(); return say(mineMsg || "Renamed.");
    }
    if (what === "delete") {
      if (armed !== id) { armed = id; setTimeout(() => { if (armed === id) { armed = null; if (isOpen() && tab === "theme") paint(); } }, 4000); return paint(); }
      armed = null; mine = UT.remove(mine, id); keepMine();
      if (origin?.id === id) origin = null;
      if (design.theme === `mine:${id}`) { design.theme = "custom"; save(); paintBar(); }
      return say(mineMsg || `Deleted "${t.name}".`);
    }
  }
  $("design-pane").addEventListener("input", (e) => {
    if (e.target.id === "theme-search") { themeQuery = e.target.value; paintThemeList(); }
    if (e.target.id === "mine-name") nameDraft = e.target.value;
    if (e.target.id === "mine-keep") keepDraft = e.target.checked;
  });
  $("design-pane").addEventListener("change", (e) => { if (e.target.id === "design-preview") { preview.set(e.target.value); paintBar(); } });
  $("design-pane").addEventListener("change", async (e) => {
    if (e.target.id === "mine-file" && e.target.files[0]) {
      try {
        const r = UT.merge(mine, UT.fromFile(await e.target.files[0].text()));
        mineMsg = "";
        mine = r.list; keepMine(); mineMsg = mineMsg || `Loaded ${r.added + r.replaced} theme${r.added + r.replaced === 1 ? "" : "s"} (${r.replaced} replaced).`;
      } catch (err) { mineMsg = "The file was not loaded: " + err.message + "."; }
      e.target.value = ""; return paint();
    }
    if (e.target.id !== "design-file" || !e.target.files[0]) return;
    try { set(D.fromFile(await e.target.files[0].text(), base)); $("design-where").textContent = `Loaded "${design.name}".`; }
    catch (err) { $("design-where").textContent = "The file was not loaded: " + err.message + "."; }
    e.target.value = "";
  });
  $("design-pane").addEventListener("change", (e) => { if (e.target.dataset.p === "name") { design.name = e.target.value; changed(); paintBar(); } });
  for (const t of TABS) $(`design-tab-${t}`).onclick = () => tabTo(t);

  function set(d) { design = D.normalize(d, base); save(); schedule(0); announce(); paint(); }
  /** A change of the profile from outside the panel (the Export card, the tile format select). */
  function patchProfile(part) {
    design.profile = D.normalizeProfile({ ...design.profile, preset: "custom", ...part });
    save(); onProfile(design.profile); if (isOpen()) paint(); else paintBar();
  }
  /** A stored design (the text of a file). A bad text keeps the design that is now. `draw: false` only gives the look to the page (the next draw has it). */
  async function load(text, { draw = true } = {}) {
    try { design = D.fromFile(text, base); } catch (_) { return false; }
    announce();
    if (draw) schedule(0);
    else { lastKey = styleKey(design); await redraw(D.applyToLook(look, design), lastKey === styleKey(base), false); }
    paint(); paintBar();
    return true;
  }
  /** The page tells the panel that something outside changed (the base map): the Preview control and the notice follow it. */
  function refresh() {
    const sel = $("design-preview");
    if (sel) sel.value = preview.get();
    paintBar();
  }
  /** A layer switched somewhere else (roadstyle's Layers box, the arrows switch): the design follows, and the page does nothing more. */
  function setVisible(key, on) {
    if (!(key in design.visible) || design.visible[key] === !!on) return;
    design.visible[key] = !!on; design.theme = "custom";
    save(); paintBar(); if (isOpen() && tab === "layers") { const el = $("design-pane").querySelector(`[data-p="visible.${key}"]`); if (el) el.checked = !!on; }
  }
  const isOpen = () => document.body.classList.contains("editing-design");
  function open() { document.body.classList.add("editing-design"); paint(); }
  function close() { document.body.classList.remove("editing-design"); }
  return {
    open, close, isOpen, tab: tabTo, get: () => design, text: () => D.toFile(design), set, load, patchProfile, profile, boundary: () => design.boundary, setVisible, refresh, base: () => base,
    flush: async () => { clearTimeout(timer); await run(); while (busy) await new Promise((r) => setTimeout(r, 50)); },
    setCount: (text, bad) => { counts = { text, bad }; const el = $("design-count"); if (el) { el.textContent = text; el.classList.toggle("bad", !!bad); } },
    state: () => note,
  };
}
