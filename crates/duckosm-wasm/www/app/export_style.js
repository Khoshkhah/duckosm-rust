// The style of the exported files (docs/dashboard.md, "Step 9: Export"): the colors and widths of the page's map (roadstyle's look, `map/look.json`) written for other tools.
// - `qgisStyles`: a QGIS style (QML) for each layer of the GeoPackage, put in its table `layer_styles` (QGIS draws the layer with it at once).
// - `mapSvg`: a picture of the area as SVG, drawn from the tables.
// - `keplerMap`: a kepler.gl map file (data and style in one JSON) of the roads.
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

/** The QML of the roads: one category for each class of `highway`; each symbol has a casing line and a fill line, and the passes put every casing under every fill (the sandwich of the map). */
export function roadsQml(palette) {
  const classes = Object.keys(palette), n = classes.length;
  const links = ["motorway", "trunk", "primary", "secondary", "tertiary"].filter((c) => classes.includes(c));
  const cats = classes.map((c, i) => `    <category render="true" symbol="${i}" value="${c}" label="${c}"/>\n`).join("") + links.map((c) => `    <category render="true" symbol="${classes.indexOf(c)}" value="${c}_link" label="${c}_link"/>\n`).join("") + `    <category render="true" symbol="${n}" value="" label="other"/>\n`;
  const sym = (name, p, rank) => `    <symbol type="line" name="${name}" alpha="${p.opacity ?? 1}" clip_to_extent="1" force_rhr="0">\n${lineLayer(p.casing, p.casing_width, rank, p.dash)}${lineLayer(p.fill, p.width, n + 1 + rank, p.dash)}    </symbol>\n`;
  const symbols = classes.map((c, i) => sym(i, palette[c], i)).join("") + sym(n, palette.residential ?? Object.values(palette)[0] ?? { fill: "#ffffff", casing: "#cfcdca", width: 2, casing_width: 3.5 }, 0);
  return doc(`  <renderer-v2 type="categorizedSymbol" attr="highway" symbollevels="1" forceraster="0" enableorderby="0" referencescale="-1">\n  <categories>\n${cats}  </categories>\n  <symbols>\n${symbols}  </symbols>\n  </renderer-v2>\n`);
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

/** The QML of each layer of the GeoPackage that has a style: {table: QML}. `layerNames`: the tables of the file. */
export function qgisStyles(look, layerNames) {
  const out = { roads: roadsQml(paletteOf(look)), nodes: nodesQml() };
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

// ---- a kepler.gl map file: the roads and their style in one JSON (drop it on kepler.gl)

/** The kepler.gl map file for the roads. `rows`: GeoJSON features of the roads (properties and geometry). Two layers of the same data: the casing below, the fill above, both colored by `highway`. */
export function keplerMap({ features, palette, name = "roads" }) {
  const classes = [...new Set(features.map((f) => f.properties.highway))].filter(Boolean).sort();     // an ordinal scale takes its domain in this order
  const colorOf = (c, key) => (palette[classOf(c)] ?? palette.residential ?? { fill: "#ffffff", casing: "#cfcdca" })[key];
  const props = Object.keys(features[0]?.properties ?? {});
  const kind = (k) => { const v = features.find((f) => f.properties[k] != null)?.properties[k]; return typeof v === "number" ? (Number.isInteger(v) ? "integer" : "real") : typeof v === "boolean" ? "boolean" : "string"; };
  const fields = [{ name: "_geojson", format: "", type: "geojson", analyzerType: "GEOMETRY" }, ...props.map((k) => ({ name: k, format: "", type: kind(k), analyzerType: { integer: "INT", real: "FLOAT", boolean: "BOOLEAN", string: "STRING" }[kind(k)] }))];
  const rows = features.map((f) => [f, ...props.map((k) => f.properties[k] ?? null)]);
  const layer = (id, label, key, thickness) => ({
    id, type: "geojson",
    config: { dataId: name, label, color: [31, 186, 214], highlightColor: [252, 242, 26, 255], columns: { geojson: "_geojson" }, isVisible: true,
      visConfig: { opacity: 1, strokeOpacity: 1, thickness, strokeColor: null, colorRange: { name: "duckOSM", type: "custom", category: "Custom", colors: classes.map((c) => colorOf(c, key)) },
        strokeColorRange: { name: "duckOSM", type: "custom", category: "Custom", colors: classes.map((c) => colorOf(c, key)) }, radius: 10, sizeRange: [0, 10], radiusRange: [0, 50], heightRange: [0, 500], elevationScale: 5, enableElevationZoomFactor: true, stroked: true, filled: false, enable3d: false, wireframe: false },
      hidden: false, textLabel: [{ field: null, color: [255, 255, 255], size: 18, offset: [0, 0], anchor: "start", alignment: "center" }] },
    visualChannels: { colorField: null, colorScale: "quantile", strokeColorField: { name: "highway", type: "string" }, strokeColorScale: "ordinal", sizeField: null, sizeScale: "linear", heightField: null, heightScale: "linear", radiusField: null, radiusScale: "linear" },
  });
  let w = 180, s = 90, e = -180, nn = -90;
  for (const f of features) { const c = f.geometry.type === "LineString" ? f.geometry.coordinates : f.geometry.coordinates.flat(); for (const [x, y] of c) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); nn = Math.max(nn, y); } }
  const zoom = Math.max(1, Math.min(18, Math.log2(360 / Math.max(e - w, 1e-6)) - 0.5));
  return {
    datasets: [{ version: "v1", data: { id: name, label: name, color: [31, 186, 214], allData: rows, fields } }],
    config: { version: "v1", config: {
      visState: { filters: [], layers: [layer("duckosm-casing", "road casing", "casing", 3), layer("duckosm-fill", "road fill", "fill", 1.6)], interactionConfig: { tooltip: { fieldsToShow: { [name]: [{ name: "highway", format: null }, { name: "name", format: null }, { name: "edge_id", format: null }] }, compareMode: false, compareType: "absolute", enabled: true }, brush: { size: 0.5, enabled: false }, geocoder: { enabled: false }, coordinate: { enabled: false } }, layerBlending: "normal", overlayBlending: "normal", splitMaps: [], animationConfig: { currentTime: null, speed: 1 } },
      mapState: { bearing: 0, dragRotate: false, latitude: (s + nn) / 2, longitude: (w + e) / 2, pitch: 0, zoom, isSplit: false },
      mapStyle: { styleType: "light", topLayerGroups: {}, visibleLayerGroups: { label: true, road: true, border: false, building: true, water: true, land: true, "3d building": false }, threeDBuildingColor: [224, 224, 224], mapStyles: {} } } },
    info: { app: "kepler.gl", created_at: new Date().toUTCString(), title: "duckOSM-rust roads" },
  };
}
