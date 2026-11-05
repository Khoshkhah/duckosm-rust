// The style of the exported files (docs/dashboard.md, "Step 10: Export", docs/proposals/export-look.md): the look of the page's map written for other tools.
// The roads take their look from roadstyle's `exportLook` (`rsLook`: MapLibre layers with no source, a casing and a fill layer for each drawing
// position, that read the raw columns highway, oneway, bridge, tunnel, casing_level and fill_level). This file has no copy of a color or a width.
// - `qgisStyles`: a QGIS style (QML) for each layer of the GeoPackage, put in its table `layer_styles` (QGIS draws the layer with it at once).
//   The roads: the expressions of `rsLook` in the QGIS expression language (`qgisExpr`), read for each feature at the zoom of the QGIS map.
// - `lookFeatures` and `keplerMap`: the roads with the look at one zoom, each direction of a two-way road moved to its side (kepler.gl cannot
//   offset a line); a kepler.gl map file (data and style in one JSON).
// - `mapSvg`: a picture of the area as SVG, drawn from the tables.
// Everything here is text: nothing reads the page or the tables.

// the order of the road classes, from the one that is drawn first (the bottom) to the one that is drawn last (the top)
export const CLASS_ORDER = ["steps", "path", "footway", "pedestrian", "bridleway", "cycleway", "track", "corridor", "platform", "service", "living_street", "residential", "unclassified", "tertiary", "secondary", "primary", "trunk", "motorway"];
const LAND_COLORS = { park: "#cfe9c4", forest: "#c5e0b8", wood: "#c5e0b8", grass: "#dcebd0", meadow: "#dcebd0", scrub: "#d6e5c6", residential: "#ece8e2", industrial: "#e8e3df", water: "#a0c0f0" };
export const COLORS = { background: "#efede8", water: "#a0bdf8", building: "#d9d4cf", buildingLine: "#c7c1bb", land: "#e8e4dc", rail: "#8a8f98", name: "#444444", arrow: "#555555" };

/** The class of a `highway` value for the palette: a link road has the look of its class (`primary_link` is `primary`); a value with no entry (`road`, `busway`) has the look of a residential road. */
export const classOf = (h) => (CLASS_ORDER.includes(h) ? h : CLASS_ORDER.includes(String(h).replace(/_link$/, "")) ? String(h).replace(/_link$/, "") : "residential");

/** The look of each road class: {class: {fill, casing, width, casing_width, dash}} (the widths are pixels of the page's map). */
export function paletteOf(look) {
  const all = look?.settings?.palettes ?? {}, p = all[look?.palette] ?? Object.values(all)[0] ?? {};
  const out = {};
  for (const c of CLASS_ORDER) if (p[c]) out[c] = p[c];
  return out;
}

const rgba = (hex, a = 1) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? ""); const n = m ? parseInt(m[1], 16) : 0x808080; return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 255)}`; };
const MM = 0.22;                                                  // millimeters in QGIS for one pixel of the page's map
const opt = (name, value) => `<Option name="${name}" type="QString" value="${String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"/>`;
const doc = (inner, categories = "Symbology") => `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>\n<qgis version="3.28.0-Firenze" styleCategories="${categories}">\n${inner}</qgis>\n`;

const lineLayer = (color, widthPx, pass, dash) => `      <layer class="SimpleLine" pass="${pass}" enabled="1" locked="0">
        <Option type="Map">
          ${opt("capstyle", "round")}${opt("joinstyle", "round")}${opt("line_color", rgba(color))}${opt("line_style", dash ? "dash" : "solid")}${opt("line_width", (widthPx * MM).toFixed(3))}${opt("line_width_unit", "MM")}${opt("use_custom_dash", "0")}
        </Option>
      </layer>
`;

// ---- the roads in QGIS: the expressions of rsLook in the QGIS expression language

const PX_MM = 25.4 / 96;                         // one CSS pixel of the page's map in millimeters
// The page's zoom (MapLibre, 512 px tiles) from the scale of the QGIS map at 96 dpi. A CRS that is not Web Mercator has a ground scale: times
// cos(latitude). The round: the scale of zoom 13 gives 12.99999, and a class with the first zoom 13 must show at 13.
const QGIS_ZOOM = "round(log(2, 295829355.45 * if(@map_crs IN ('EPSG:3857', 'EPSG:900913'), 1, cos(radians(y(transform(@map_extent_center, @map_crs, 'EPSG:4326'))))) / @map_scale), 3)";
const qlit = (v) => (typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : v == null ? "NULL" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : Array.isArray(v) ? `array(${v.map(qlit).join(", ")})` : String(v));
const columnOf = (x) => (x?.[0] === "get" ? x[1] : x?.[0] === "coalesce" && x[1]?.[0] === "get" ? x[1][1] : null);

/** The labels of every `match` on a column, by column. A feature's index in them (@k_<column>) is computed once in each expression, and a match of plain values is an array_get. */
function matchKeys(rsLook) {
  const keys = {};
  const walk = (e) => {
    if (!Array.isArray(e)) return;
    if (e[0] === "match" && columnOf(e[1])) { const ks = (keys[columnOf(e[1])] ??= []); for (let i = 2; i + 1 < e.length; i += 2) for (const k of [].concat(e[i])) if (!ks.includes(k)) ks.push(k); }
    e.forEach(walk);
  };
  walk(rsLook.layers.map((l) => [l.filter, l.paint, l.layout]));
  return keys;
}

/** A MapLibre expression of rsLook as a QGIS expression: the zoom is @z, a match on a column of `keys` reads @k_<column>. An operator that is not known stops the export. */
export function qgisExpr(e, keys = {}) {
  if (!Array.isArray(e)) return qlit(e);
  const [op, ...a] = e, q = (x) => qgisExpr(x, keys);
  switch (op) {
    case "zoom": return "@z";
    case "get": return `"${a[0]}"`;
    case "literal": return qlit(a[0]);
    case "coalesce": return `coalesce(${a.map(q).join(", ")})`;
    case "to-string": return `coalesce(to_string(${q(a[0])}), '')`;
    case "downcase": return `lower(${q(a[0])})`;
    case "!": return `(NOT ${q(a[0])})`;
    case "all": return `(${a.map(q).join(" AND ")})`;
    case "any": return `(${a.map(q).join(" OR ")})`;
    case "==": case "!=": case ">=": case "<=": case ">": case "<": return `(${q(a[0])} ${op === "==" ? "=" : op === "!=" ? "<>" : op} ${q(a[1])})`;
    case "*": case "+": case "-": case "/": return `(${a.map(q).join(` ${op} `)})`;
    case "in": return `array_contains(${q(a[1])}, ${q(a[0])})`;
    case "case": { let s = "CASE"; for (let i = 0; i + 1 < a.length; i += 2) s += ` WHEN ${q(a[i])} THEN ${q(a[i + 1])}`; return `${s} ELSE ${q(a[a.length - 1])} END`; }
    case "match": {
      const c = columnOf(a[0]), val = new Map();
      for (let i = 1; i + 1 < a.length; i += 2) for (const k of [].concat(a[i])) val.set(k, a[i + 1]);
      const all = keys[c] && [...keys[c].map((k) => (val.has(k) ? val.get(k) : a[a.length - 1])), a[a.length - 1]];
      if (all && all.every((v) => !Array.isArray(v) || v[0] === "literal")) {
        const vs = all.map((v) => q(v));
        return new Set(vs).size === 1 ? vs[0] : `array_get(array(${vs.join(",")}), @k_${c})`;
      }
      const x = q(a[0]); let s = "CASE";
      for (const [k, v] of val) s += ` WHEN ${x} = ${qlit(k)} THEN ${q(v)}`;
      return `${s} ELSE ${q(a[a.length - 1])} END`;
    }
    case "interpolate": {
      if (a[0]?.[0] !== "linear" || a[1]?.[0] !== "zoom") throw new Error(`the QGIS style has no form for ${JSON.stringify(a.slice(0, 2))}`);
      const st = []; for (let i = 2; i + 1 < a.length; i += 2) st.push([a[i], q(a[i + 1])]);
      let s = `CASE WHEN @z <= ${st[0][0]} THEN ${st[0][1]}`;
      for (let i = 1; i < st.length; i++) { const [z0, v0] = st[i - 1], [z1, v1] = st[i]; s += ` WHEN @z <= ${z1} THEN with_variable('t', (@z - ${z0}) / ${z1 - z0}, ${v0} * (1 - @t) + ${v1} * @t)`; }
      return `${s} ELSE ${st[st.length - 1][1]} END`;
    }
    default: throw new Error(`the QGIS style has no form for the MapLibre operator "${op}"`);
  }
}

const xmlText = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const optOf = (name, value, type = "QString") => `<Option name="${name}" type="${type}" value="${xmlText(value)}"/>`;
const dataDefined = (props) => `<data_defined_properties><Option type="Map">${optOf("name", "")}<Option name="properties" type="Map">${Object.entries(props).map(([k, ex]) =>
  `<Option name="${k}" type="Map">${optOf("active", "true", "bool")}${optOf("expression", ex)}${optOf("type", 3, "int")}</Option>`).join("")}</Option>${optOf("type", "collection")}</Option></data_defined_properties>`;

/**
 * The QML of the roads from rsLook: a rule for each layer of rsLook (the casing or the fill of one drawing position), drawn in the order of
 * rsLook (symbol levels), and in one rule by rsLook's sort key. Each line has its color, width, offset and dash from the expressions of rsLook,
 * read for each feature at the page's zoom of the QGIS map; the widths are the page's pixels as millimeters. The layer must have the columns of rsLook.
 */
export function roadsQml(rsLook) {
  const keys = matchKeys(rsLook), Q = (e) => qgisExpr(e, keys);
  // the zoom and each feature's index in the labels, once in each expression
  const wrap = (s) => Object.entries(keys).reduceRight((acc, [c, ks]) => `with_variable('k_${c}', CASE ${ks.map((k, i) => `WHEN "${c}" = ${qlit(k)} THEN ${i}`).join(" ")} ELSE ${ks.length} END, ${acc})`, `with_variable('z', ${QGIS_ZOOM}, ${s})`);
  const symbol = (i, l) => {
    const p = l.paint, w = `(${Q(p["line-width"])}) * ${PX_MM}`;
    const props = { outlineColor: wrap(Q(p["line-color"])), outlineWidth: wrap(w) };
    if (p["line-offset"] != null) props.offset = wrap(`-(${Q(p["line-offset"])}) * ${PX_MM}`);      // MapLibre: + is to the right of the line; QGIS: + is to the left
    const dash = p["line-dasharray"];        // in widths of the line; [1, 0] is no dash
    if (dash) props.customDash = wrap(`with_variable('d', ${Q(dash)}, if(array_get(@d, 1) = 0, '1000;0', concat(array_get(@d, 0) * ${w}, ';', array_get(@d, 1) * ${w})))`);
    const cap = { butt: "flat", round: "round", square: "square" }[l.layout?.["line-cap"]] ?? "round";
    return `    <symbol type="line" name="${i}" alpha="${p["line-opacity"] ?? 1}" clip_to_extent="1" force_rhr="0"><layer class="SimpleLine" enabled="1" locked="0" pass="${i}"><Option type="Map">` +
      optOf("capstyle", cap) + optOf("joinstyle", l.layout?.["line-join"] ?? "round") + optOf("line_color", "128,128,128,255") + optOf("line_style", "solid") + optOf("line_width", "0.5") +
      optOf("line_width_unit", "MM") + optOf("offset", "0") + optOf("offset_unit", "MM") + optOf("use_custom_dash", dash ? "1" : "0") + optOf("customdash", "1000;0") + optOf("customdash_unit", "MM") +
      `</Option>${dataDefined(props)}</layer></symbol>\n`;
  };
  const L = rsLook.layers, sort = L[0]?.layout?.["line-sort-key"];
  const rules = L.map((l, i) => `    <rule key="${l.id}" label="${l.id}" symbol="${i}" filter="${xmlText(wrap(Q(l.filter)))}"/>\n`).join("");
  return doc(`  <renderer-v2 type="RuleRenderer" symbollevels="1" enableorderby="${sort ? 1 : 0}" forceraster="0" referencescale="-1">
  <rules key="root">
${rules}  </rules>
  <symbols>
${L.map((l, i) => symbol(i, l)).join("")}  </symbols>
${sort ? `  <orderby><orderByClause asc="1" nullsFirst="1">${xmlText(wrap(Q(sort)))}</orderByClause></orderby>\n` : ""}  </renderer-v2>
`);
}

const fillQml = (color, outline) => doc(`  <renderer-v2 type="singleSymbol" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
  <symbols>
    <symbol type="fill" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
      <layer class="SimpleFill" pass="0" enabled="1" locked="0">
        <Option type="Map">${opt("color", rgba(color))}${opt("style", "solid")}${opt("outline_color", rgba(outline ?? color))}${opt("outline_style", outline ? "solid" : "no")}${opt("outline_width", "0.1")}${opt("outline_width_unit", "MM")}</Option>
      </layer>
    </symbol>
  </symbols>
  </renderer-v2>
`);

const landQml = () => {
  const kinds = Object.keys(LAND_COLORS), sym = (name, color) => `    <symbol type="fill" name="${name}" alpha="1" clip_to_extent="1" force_rhr="0">
      <layer class="SimpleFill" pass="0" enabled="1" locked="0">
        <Option type="Map">${opt("color", rgba(color))}${opt("style", "solid")}${opt("outline_style", "no")}${opt("outline_color", rgba(color))}${opt("outline_width", "0")}${opt("outline_width_unit", "MM")}</Option>
      </layer>
    </symbol>
`;
  return doc(`  <renderer-v2 type="categorizedSymbol" attr="kind" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
  <categories>\n${kinds.map((k, i) => `    <category render="true" symbol="${i}" value="${k}" label="${k}"/>\n`).join("")}    <category render="true" symbol="${kinds.length}" value="" label="other"/>\n  </categories>
  <symbols>\n${kinds.map((k, i) => sym(i, LAND_COLORS[k])).join("")}${sym(kinds.length, COLORS.land)}  </symbols>
  </renderer-v2>
`);
};

const waterLineQml = () => doc(`  <renderer-v2 type="singleSymbol" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
  <symbols>
    <symbol type="line" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
${lineLayer(COLORS.water, 2, 0, false)}    </symbol>
  </symbols>
  </renderer-v2>
`);

const railQml = () => doc(`  <renderer-v2 type="singleSymbol" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
  <symbols>
    <symbol type="line" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
${lineLayer(COLORS.rail, 1.2, 0, true)}    </symbol>
  </symbols>
  </renderer-v2>
`);

// street names: no symbol, a label of the field `name`
const namesQml = () => doc(`  <renderer-v2 type="nullSymbol"/>
  <labeling type="simple">
    <settings calloutType="simple">
      <text-style fieldName="name" fontSize="8" fontSizeUnit="Point" fontFamily="Sans Serif" textColor="${rgba(COLORS.name)}" textOpacity="1" isExpression="0" namedStyle="Regular">
        <text-buffer bufferDraw="1" bufferSize="0.8" bufferSizeUnits="MM" bufferColor="255,255,255,255" bufferOpacity="1"/>
      </text-style>
      <placement placement="1" dist="0" distUnits="MM" priority="5"/>
    </settings>
  </labeling>
`, "Symbology|Labeling");

// one-way arrows: a small arrow whose angle is the field `bearing` (a data defined property)
const arrowsQml = () => doc(`  <renderer-v2 type="singleSymbol" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
  <symbols>
    <symbol type="marker" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
      <layer class="SimpleMarker" pass="0" enabled="1" locked="0">
        <Option type="Map">${opt("name", "arrowhead")}${opt("color", rgba(COLORS.arrow))}${opt("size", "2")}${opt("size_unit", "MM")}${opt("outline_style", "no")}${opt("angle", "0")}</Option>
        <data_defined_properties>
          <Option type="Map">
            <Option name="name" type="QString" value=""/>
            <Option name="properties" type="Map"><Option name="angle" type="Map"><Option name="active" type="bool" value="true"/><Option name="field" type="QString" value="bearing"/><Option name="type" type="int" value="2"/></Option></Option>
            <Option name="type" type="QString" value="collection"/>
          </Option>
        </data_defined_properties>
      </layer>
    </symbol>
  </symbols>
  </renderer-v2>
`);

const nodesQml = () => doc(`  <renderer-v2 type="singleSymbol" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
  <symbols>
    <symbol type="marker" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
      <layer class="SimpleMarker" pass="0" enabled="1" locked="0">
        <Option type="Map">${opt("name", "circle")}${opt("color", rgba("#ffffff"))}${opt("size", "1.2")}${opt("size_unit", "MM")}${opt("outline_color", rgba("#555555"))}${opt("outline_width", "0.2")}${opt("outline_width_unit", "MM")}</Option>
      </layer>
    </symbol>
  </symbols>
  </renderer-v2>
`);

/** The QML of each layer of the GeoPackage that has a style: {table: QML}. `rsLook`: roadstyle's exportLook for the drawing positions of the roads; `layerNames`: the tables of the file. */
export function qgisStyles(rsLook, layerNames) {
  const out = { roads: roadsQml(rsLook), nodes: nodesQml() };
  for (const n of layerNames) {
    if (n === "names") out[n] = namesQml();
    else if (n === "arrows") out[n] = arrowsQml();
    else if (n === "features_water_polygons" || n === "features_water" || n === "features_ocean") out[n] = fillQml(COLORS.water);
    else if (n === "features_buildings") out[n] = fillQml(COLORS.building, COLORS.buildingLine);
    else if (n === "features_land") out[n] = landQml();
    else if (n === "features_railways") out[n] = railQml();
    else if (n === "features_water_lines") out[n] = waterLineQml();
    else if (n === "features_paved") out[n] = fillQml("#dedbd5");
    else if (n === "features_place_labels") out[n] = namesQml();
  }
  return out;
}

/**
 * The light colors of the land-use kinds from the live style: the layer `rs-ov0-fill` has a `match` on `kind`, each color is a plain color or a `case` on the theme (the last value is the light one).
 * Gives {kind: color, "": the color of the other kinds}, or {} when the style has no such layer.
 */
export function landColorsFrom(live) {
  const expr = live?.layers?.find((l) => l.id === "rs-ov0-fill")?.paint?.["fill-color"];
  if (!Array.isArray(expr) || expr[0] !== "match") return {};
  const light = (v) => (Array.isArray(v) ? light(v[v.length - 1]) : v);
  const out = {};
  for (let i = 2; i + 1 < expr.length; i += 2) for (const k of [].concat(expr[i])) out[k] = light(expr[i + 1]);
  out[""] = light(expr[expr.length - 1]);
  return out;
}

// ---- a picture of the area as SVG, drawn from the tables
const mercator = (lon, lat) => { const r = (lat * Math.PI) / 180; return [(lon + 180) / 360, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2]; };      // x and y of the Web Mercator square (0 to 1)

/**
 * The SVG of the area: land, water, paved areas and buildings, then every road class as a casing and a fill (the casings of all classes under the fills, the low classes under the high ones).
 * `data`: {bbox: [west, south, east, north], roads: [{highway, geometry (GeoJSON LineString)}], polygons: {land, water, paved, buildings: [GeoJSON geometry]}, palette, width (px)}.
 * The widths of the palette are pixels of the page's map: they scale with the zoom that the picture has.
 */
export function mapSvg({ bbox, roads, polygons = {}, palette, width = 2400, transparent = false, background = COLORS.background, landColors = {} }) {
  const [w, s, e, n] = bbox, [x0, y0] = mercator(w, n), [x1, y1] = mercator(e, s), spanX = x1 - x0, height = Math.max(1, Math.round((width * (y1 - y0)) / spanX));
  const scale = width / spanX, px = ([lon, lat]) => { const [x, y] = mercator(lon, lat); return `${((x - x0) * scale).toFixed(1)},${((y - y0) * scale).toFixed(1)}`; };
  const zoom = Math.log2(width / (256 * spanX)), k = Math.min(3, Math.max(0.12, 2 ** ((zoom - 16) * 0.8)));
  const ring = (r) => `M${r.map(px).join("L")}Z`;
  const poly = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []).map((p) => p.map(ring).join("")).join("");
  const landGroups = () => { const by = {}; for (const l of polygons.land ?? []) (by[l.kind] ??= []).push(l.geometry); return Object.entries(by).map(([k, list]) => group(`land-${k || "other"}`, landColors[k] ?? LAND_COLORS[k] ?? landColors[""] ?? COLORS.land, list)).join(""); };
  const group = (id, fill, list, stroke) => (list?.length ? `<g id="${id}" fill="${fill}" fill-rule="evenodd"${stroke ? ` stroke="${stroke}" stroke-width="0.6"` : ""}><path d="${list.map(poly).join("")}"/></g>\n` : "");
  const line = (g) => (g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []).map((c) => `M${c.map(px).join("L")}`).join("");
  const byClass = {};
  for (const r of roads) (byClass[classOf(r.highway)] ??= []).push(line(r.geometry));
  const order = CLASS_ORDER.filter((c) => byClass[c]);
  const strokes = (key, wkey) => order.map((c) => { const p = palette[c] ?? palette.residential ?? { fill: "#ffffff", casing: "#cfcdca", width: 2, casing_width: 3.5 };
    return `<path d="${byClass[c].join("")}" fill="none" stroke="${p[key]}" stroke-width="${(p[wkey] * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${p.dash ? ` stroke-dasharray="${(p[wkey] * k * 2).toFixed(1)} ${(p[wkey] * k).toFixed(1)}"` : ""}/>`; }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${transparent ? "" : `<rect width="${width}" height="${height}" fill="${background}"/>`}\n` +
    landGroups() + group("water", COLORS.water, polygons.water) + group("paved", "#dedbd5", polygons.paved) + group("buildings", COLORS.building, polygons.buildings, COLORS.buildingLine) +
    `<g id="road-casings">\n${strokes("casing", "casing_width")}\n</g>\n<g id="road-fills">\n${strokes("fill", "width")}\n</g>\n</svg>\n`;
}

// ---- the roads with the look at one zoom, for kepler.gl and GeoJSON: kepler.gl cannot offset a line, and its widths are meters from zoom 14

/** The value of a MapLibre expression of rsLook for the properties `p` at the zoom `z`. */
export function evalExpr(e, p, z) {
  if (!Array.isArray(e)) return e;
  const [op, ...a] = e, v = (x) => evalExpr(x, p, z);
  switch (op) {
    case "zoom": return z;
    case "get": return p[a[0]] ?? null;
    case "literal": return a[0];
    case "coalesce": { for (const x of a) { const r = v(x); if (r != null) return r; } return null; }
    case "to-string": { const r = v(a[0]); return r == null ? "" : String(r); }
    case "downcase": return String(v(a[0])).toLowerCase();
    case "!": return !v(a[0]);
    case "all": return a.every((x) => v(x));
    case "any": return a.some((x) => v(x));
    case "==": return v(a[0]) === v(a[1]);
    case "!=": return v(a[0]) !== v(a[1]);
    case ">=": return v(a[0]) >= v(a[1]);
    case "<=": return v(a[0]) <= v(a[1]);
    case ">": return v(a[0]) > v(a[1]);
    case "<": return v(a[0]) < v(a[1]);
    case "*": return a.reduce((s, x) => s * v(x), 1);
    case "+": return a.reduce((s, x) => s + v(x), 0);
    case "in": return v(a[1]).includes(v(a[0]));
    case "case": { for (let i = 0; i + 1 < a.length; i += 2) if (v(a[i])) return v(a[i + 1]); return v(a[a.length - 1]); }
    case "match": { const x = v(a[0]); for (let i = 1; i + 1 < a.length; i += 2) if ([].concat(a[i]).includes(x)) return v(a[i + 1]); return v(a[a.length - 1]); }
    case "interpolate": {
      const st = []; for (let i = 2; i + 1 < a.length; i += 2) st.push([a[i], a[i + 1]]);
      if (z <= st[0][0]) return v(st[0][1]);
      for (let i = 1; i < st.length; i++) if (z <= st[i][0]) { const t = (z - st[i - 1][0]) / (st[i][0] - st[i - 1][0]); return v(st[i - 1][1]) * (1 - t) + v(st[i][1]) * t; }
      return v(st[st.length - 1][1]);
    }
    default: throw new Error(`the export has no value for the MapLibre operator "${op}"`);
  }
}

/** A line ([[lon, lat]...]) moved `d` meters to its right (a negative d: to its left), with mitred joins (a mitre is at most 4 times d). */
export function offsetLine(coords, d) {
  if (!d || coords.length < 2) return coords;
  const kx = 111320 * Math.cos((coords[0][1] * Math.PI) / 180), ky = 110540;          // meters of a degree, near the line
  const P = coords.map(([x, y]) => [x * kx, y * ky]), right = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  return P.map((pt, i) => {
    const n0 = i > 0 ? right(P[i - 1], pt) : null, n1 = i < P.length - 1 ? right(pt, P[i + 1]) : null;
    let [mx, my] = n0 && n1 ? [n0[0] + n1[0], n0[1] + n1[1]] : n0 ?? n1;
    const l = Math.hypot(mx, my) || 1; mx /= l; my /= l;
    const k = Math.min(1 / Math.max(n0 && n1 ? mx * n0[0] + my * n0[1] : 1, 1e-6), 4);
    return [(pt[0] + mx * d * k) / kx, (pt[1] + my * d * k) / ky];
  });
}

/** The zoom of the meters: the zoom where the look has the full split of the two directions (roads.split: offset_zoom + ramp_zooms of the look). */
export const lookZoom = (look) => (look?.roads?.split?.offset_zoom ?? 15) + (look?.roads?.split?.ramp_zooms ?? 2);
const hex = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);

/**
 * The roads with the look of rsLook at the zoom `zoom`: for each row (its properties and `coords`), the line moved to its side, and the columns
 * fill_color, fill_width_m, casing_color, casing_width_m (0: no casing) and offset_m (the page's pixels as meters on the ground at this zoom).
 * Gives [{level, sort, properties, coords}], in the order of drawing (the drawing position, then the sort key of rsLook).
 */
export function lookFeatures(rsLook, rows, zoom) {
  const byId = Object.fromEntries(rsLook.layers.map((l) => [l.id, l]));
  return rows.map(({ coords, ...p }) => {
    const props = { ...p, fill_level: p.fill_level ?? 0, casing_level: p.casing_level ?? p.fill_level ?? 0 };
    const fill = byId[`fill-${props.fill_level}`], casing = byId[`casing-${props.casing_level}`];
    if (!fill) throw new Error(`the look has no drawing position ${props.fill_level}`);
    const mpp = (40075016.686 * Math.cos((coords[0][1] * Math.PI) / 180)) / (512 * 2 ** zoom), off = evalExpr(fill.paint["line-offset"] ?? 0, props, zoom);
    const withCasing = casing && evalExpr(casing.filter, props, 22);          // the casing filter at a zoom where every class shows: the classes with no casing
    const m = (px) => +(px * mpp).toFixed(2);
    return { level: props.fill_level, sort: evalExpr(fill.layout?.["line-sort-key"] ?? 0, props, zoom), coords: offsetLine(coords, off * mpp),
      properties: { ...p, fill_color: hex(evalExpr(fill.paint["line-color"], props, zoom)), fill_width_m: m(evalExpr(fill.paint["line-width"], props, zoom)),
        casing_color: withCasing ? hex(evalExpr(casing.paint["line-color"], props, zoom)) : null, casing_width_m: withCasing ? m(evalExpr(casing.paint["line-width"], props, zoom)) : 0, offset_m: m(off) } };
  }).sort((a, b) => a.level - b.level || a.sort - b.sort);
}

/**
 * The kepler.gl map file of `features` (lookFeatures): one dataset for each drawing position, each with a casing layer under a fill layer. The
 * layers take the color and the width from the columns: an ordinal scale whose colors are the sorted values of the column, a linear size scale whose
 * range is its domain, and the thickness 0.125 (kepler.gl draws thickness × 8 × the width in meters from zoom 14).
 */
export function keplerMap(features, name = "roads") {
  const props = Object.keys(features[0]?.properties ?? {});
  const kind = (k) => { const v = features.find((f) => f.properties[k] != null)?.properties[k]; return typeof v === "number" ? (Number.isInteger(v) ? "integer" : "real") : typeof v === "boolean" ? "boolean" : "string"; };
  const fields = [{ name: "_geojson", format: "", type: "geojson", analyzerType: "GEOMETRY" }, ...props.map((k) => ({ name: k, format: "", type: kind(k), analyzerType: { integer: "INT", real: "FLOAT", boolean: "BOOLEAN", string: "STRING" }[kind(k)] }))];
  const levels = [...new Set(features.map((f) => f.level))].sort((a, b) => a - b), datasets = [], layers = [];
  for (const lv of levels) {
    const list = features.filter((f) => f.level === lv), id = `${name}_${lv < 0 ? "m" : ""}${Math.abs(lv)}`;
    datasets.push({ version: "v1", data: { id, label: `${name}, drawing position ${lv}`, color: [128, 128, 128], allData: list.map((f) => [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: f.coords } }, ...props.map((k) => f.properties[k] ?? null)]), fields } });
    for (const part of ["casing", "fill"]) {
      const colors = [...new Set(list.map((f) => f.properties[`${part}_color`]).filter(Boolean))].sort(), ws = list.map((f) => f.properties[`${part}_width_m`]);
      const range = { name: `duckOSM ${part}`, type: "custom", category: "Custom", colors };
      layers.push({ id: `${id}_${part}`, type: "geojson",
        config: { dataId: id, label: `${part}, position ${lv}`, color: [128, 128, 128], columns: { geojson: "_geojson" }, isVisible: colors.length > 0, hidden: false,
          visConfig: { opacity: 1, strokeOpacity: 1, thickness: 0.125, strokeColor: null, colorRange: range, strokeColorRange: range, radius: 10, sizeRange: [Math.min(...ws), Math.max(...ws) + 0.001], radiusRange: [0, 50],
            heightRange: [0, 500], elevationScale: 5, stroked: true, filled: false, enable3d: false, wireframe: false },
          textLabel: [{ field: null, color: [255, 255, 255], size: 18, offset: [0, 0], anchor: "start", alignment: "center" }] },
        visualChannels: { colorField: null, colorScale: "quantile", strokeColorField: { name: `${part}_color`, type: "string" }, strokeColorScale: "ordinal", sizeField: { name: `${part}_width_m`, type: "real" }, sizeScale: "linear", heightField: null, heightScale: "linear", radiusField: null, radiusScale: "linear" } });
    }
  }
  let w = 180, s = 90, e = -180, n = -90;
  for (const f of features) for (const [x, y] of f.coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const tooltip = ["name", "highway", "direction", "edge_id"].filter((k) => props.includes(k)).map((k) => ({ name: k, format: null }));
  return {
    datasets,
    config: { version: "v1", config: {
      // kepler.gl draws the first layer of the list on top
      visState: { filters: [], layers: layers.reverse(), interactionConfig: { tooltip: { fieldsToShow: Object.fromEntries(datasets.map((d) => [d.data.id, tooltip])), compareMode: false, compareType: "absolute", enabled: true }, brush: { size: 0.5, enabled: false }, geocoder: { enabled: false }, coordinate: { enabled: false } }, layerBlending: "normal", overlayBlending: "normal", splitMaps: [], animationConfig: { currentTime: null, speed: 1 } },
      mapState: { bearing: 0, dragRotate: false, latitude: (s + n) / 2, longitude: (w + e) / 2, pitch: 0, zoom: Math.max(1, Math.min(18, Math.log2(360 / Math.max(e - w, 1e-6)) - 0.5)), isSplit: false },
      mapStyle: { styleType: "positron" } } },
    info: { app: "kepler.gl", created_at: new Date().toUTCString(), title: "duckOSM-rust roads" },
  };
}
