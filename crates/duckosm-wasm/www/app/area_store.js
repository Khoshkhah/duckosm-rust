// DuckOSM Saved Areas Store (OPFS - Origin Private File System)
// Keeps built areas, Parquet tables, boundaries, and OSM fixes in the browser's persistent storage
// so users don't have to rebuild after closing or refreshing the browser.

// The saved files are valid only for the page that wrote them: a new deploy (new roadstyle, new tables) must not
// restore the drawing cache of an old one. The page sets it from its own script URL (see index.html).
export const STORE_VERSION = 1;
const PAGE_VERSION = new URL(import.meta.url).search;   // "?v=<sha>" on the deployed page, "" on a local server

export const isSupported = typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;

const getAreasDir = async () => {
  if (!isSupported) return null;
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("areas", { create: true });
};

// The slug of an area is made once, with sanitizeSlug(name); the functions below take it as it is.
const keyOf = (slug) => {
  if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error("not a slug: " + slug);
  return slug;
};

export const sanitizeSlug = (name) => {
  const text = String(name || "area");
  let h = 0;
  for (const c of text) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return (text.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "area") + "-" + h.toString(36);
};

// Request persistent storage so the browser won't evict data under disk pressure
export async function requestPersistence() {
  if (navigator.storage?.persist) {
    try {
      return await navigator.storage.persist();
    } catch (_) {
      return false;
    }
  }
  return false;
}

// The design of the area (docs/dashboard.md, card 10): one JSON file in the area's folder. A new build keeps it.
const DESIGN_FILE = "design.json";
// Save the text of the design file in the folder of a saved area. An area that is not saved has no folder: the design stays in the page (false).
export async function saveDesign(slug, text) {
  const areasDir = await getAreasDir();
  if (!areasDir) return false;
  let dir;
  try { dir = await areasDir.getDirectoryHandle(keyOf(slug)); } catch (_) { return false; }
  const w = await (await dir.getFileHandle(DESIGN_FILE, { create: true })).createWritable();
  await w.write(new TextEncoder().encode(text));
  await w.close();
  return true;
}
// The text of the design file of a saved area, or null
export async function loadDesign(slug) {
  const areasDir = await getAreasDir();
  if (!areasDir) return null;
  try { return await (await (await areasDir.getDirectoryHandle(keyOf(slug))).getFileHandle(DESIGN_FILE)).getFile().then((f) => f.text()); } catch (_) { return null; }
}

// Save a built area and all its Parquet files into OPFS
// `cut`: the bytes of cut.osm.pbf (the area as cut from the region file), kept as a file of the area so that its download is there after a restore
export async function saveArea(slug, meta, tablesData, vizData = null, cut = null) {
  const areasDir = await getAreasDir();
  if (!areasDir) return false;

  const key = keyOf(slug);
  const dir = await areasDir.getDirectoryHandle(key, { create: true });

  // A save replaces the area: remove all files of an earlier build first (other modes, raw_* files, the old
  // drawing cache), so a restore never mixes two builds. meta.json goes last, so a half-written save has no meta.
  for await (const [existingName, existingHandle] of dir.entries()) {
    if (existingHandle.kind === "file" && existingName !== DESIGN_FILE) await dir.removeEntry(existingName).catch(() => {});      // the design belongs to the area, not to a build
  }

  let totalBytes = 0;
  const savedTableDescriptors = [];

  // If tablesData is an Array of table objects (e.g. duck.tables)
  if (Array.isArray(tablesData)) {
    for (const t of tablesData) {
      if (!t.name || !t.bytes) continue;
      const fileHandle = await dir.getFileHandle(t.name, { create: true });
      const writer = await fileHandle.createWritable();
      const bytes = t.bytes instanceof Uint8Array ? t.bytes : new Uint8Array(t.bytes);
      await writer.write(bytes);
      await writer.close();
      totalBytes += bytes.byteLength;
      savedTableDescriptors.push({
        mode: t.mode,
        table: t.table,
        name: t.name,
        rows: t.rows
      });
    }
  }

  // Save visualization cache artifacts if provided
  let hasViz = false;
  if (vizData && vizData.roads) {
    try {
      const roadsHandle = await dir.getFileHandle("viz_roads.parquet", { create: true });
      const roadsWriter = await roadsHandle.createWritable();
      const roadsBytes = vizData.roads instanceof Uint8Array ? vizData.roads : new Uint8Array(vizData.roads);
      await roadsWriter.write(roadsBytes);
      await roadsWriter.close();
      totalBytes += roadsBytes.byteLength;
      hasViz = true;

      if (vizData.features) {
        const featHandle = await dir.getFileHandle("viz_features.parquet", { create: true });
        const featWriter = await featHandle.createWritable();
        const featBytes = vizData.features instanceof Uint8Array ? vizData.features : new Uint8Array(vizData.features);
        await featWriter.write(featBytes);
        await featWriter.close();
        totalBytes += featBytes.byteLength;
      }
    } catch (e) {
      console.warn("Could not write visualization cache:", e);
    }
  }

  let hasCut = false;
  if (cut && cut.byteLength) {
    try {
      const cutHandle = await dir.getFileHandle("cut.osm.pbf", { create: true });
      const cutWriter = await cutHandle.createWritable();
      await cutWriter.write(cut instanceof Uint8Array ? cut : new Uint8Array(cut));
      await cutWriter.close();
      totalBytes += cut.byteLength;
      hasCut = true;
    } catch (e) {
      console.warn("Could not write cut.osm.pbf:", e);
      await dir.removeEntry("cut.osm.pbf").catch(() => {});
    }
  }

  const metaData = {
    ...meta,
    storeVersion: STORE_VERSION,
    pageVersion: PAGE_VERSION,
    slug: key,
    builtAt: meta.builtAt || Date.now(),
    sizeBytes: totalBytes,
    tables: savedTableDescriptors,
    hasViz,
    hasCut,
    vizMode: vizData?.mode || meta.vizMode || "all",
    levels: vizData?.levels || meta.levels || "tags"
  };

  const metaHandle = await dir.getFileHandle("meta.json", { create: true });
  const metaWriter = await metaHandle.createWritable();
  await metaWriter.write(new TextEncoder().encode(JSON.stringify(metaData, null, 2)));
  await metaWriter.close();

  return true;
}

// Save or update only the visualization cache (viz_roads.parquet, viz_features.parquet) for an existing area
export async function saveVizCache(slug, vizData) {
  const areasDir = await getAreasDir();
  if (!areasDir || !vizData?.roads) return false;
  const key = keyOf(slug);
  try {
    const dir = await areasDir.getDirectoryHandle(key);
    const roadsHandle = await dir.getFileHandle("viz_roads.parquet", { create: true });
    const roadsWriter = await roadsHandle.createWritable();
    const roadsBytes = vizData.roads instanceof Uint8Array ? vizData.roads : new Uint8Array(vizData.roads);
    await roadsWriter.write(roadsBytes);
    await roadsWriter.close();

    if (vizData.features) {
      const featHandle = await dir.getFileHandle("viz_features.parquet", { create: true });
      const featWriter = await featHandle.createWritable();
      const featBytes = vizData.features instanceof Uint8Array ? vizData.features : new Uint8Array(vizData.features);
      await featWriter.write(featBytes);
      await featWriter.close();
    }

    // Update meta.json with hasViz flag safely
    try {
      const metaHandle = await dir.getFileHandle("meta.json");
      const text = await (await metaHandle.getFile()).text();
      if (text.trim()) {
        const meta = JSON.parse(text);
        meta.hasViz = true;
        meta.vizMode = vizData.mode || meta.vizMode || "all";
        if (vizData.levels) meta.levels = vizData.levels;
        const metaWriter = await metaHandle.createWritable();
        await metaWriter.write(new TextEncoder().encode(JSON.stringify(meta, null, 2)));
        await metaWriter.close();
      }
    } catch (_) {}

    return true;
  } catch (e) {
    return false;
  }
}

// Load a saved area from OPFS into memory
export async function loadArea(slug) {
  const areasDir = await getAreasDir();
  if (!areasDir) return null;

  const key = keyOf(slug);
  let dir;
  try {
    dir = await areasDir.getDirectoryHandle(key);
  } catch (_) {
    return null;
  }

  // Read metadata safely with robust fallback
  let meta = null;
  try {
    const metaHandle = await dir.getFileHandle("meta.json");
    const metaFile = await metaHandle.getFile();
    const text = await metaFile.text();
    meta = text.trim() ? JSON.parse(text) : null;
  } catch (e) {
    console.warn(`Could not read meta.json for area ${slug}:`, e);
  }
  meta ||= { name: slug, slug: key };

  // Read the files of the area: the tables that meta.json lists and the drawing cache. A folder from another store
  // version, or with no list, is not an area of this page.
  if (meta.storeVersion !== STORE_VERSION || !Array.isArray(meta.tables)) return null;
  const listed = new Set(meta.tables.map((t) => t.name));
  const files = {};
  const tables = [];
  const viz = {};
  for await (const [name, handle] of dir.entries()) {
    if (name.endsWith(".parquet") && handle.kind === "file" && (listed.has(name) || name.startsWith("viz_"))) {
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      files[name] = bytes;

      if (bytes.byteLength === 0) continue;

      // Extract visualization cache files separately
      if (name === "viz_roads.parquet") {
        viz.roads = bytes;
        continue;
      }
      if (name === "viz_features.parquet") {
        viz.features = bytes;
        continue;
      }
      if (name.startsWith("viz_")) continue;

      tables.push({ ...meta.tables.find((t) => t.name === name), bytes });
    }
  }

  if (viz.roads && meta.pageVersion === PAGE_VERSION) {
    viz.mode = meta.vizMode || "all";
    viz.levels = meta.levels || "tags";
  }

  return { meta, tables, files, viz: viz.roads ? viz : null };
}

// The cut file of a saved area as a File (it stays on the disk: the page reads it only when it is downloaded), or null
export async function loadCutFile(slug) {
  const areasDir = await getAreasDir();
  if (!areasDir) return null;
  try {
    const dir = await areasDir.getDirectoryHandle(keyOf(slug));
    return await (await dir.getFileHandle("cut.osm.pbf")).getFile();
  } catch (_) {
    return null;
  }
}

// List all saved areas in OPFS
export async function listSavedAreas() {
  const areasDir = await getAreasDir();
  if (!areasDir) return [];

  const list = [];
  for await (const [slug, handle] of areasDir.entries()) {
    if (handle.kind === "directory") {
      try {
        const metaHandle = await handle.getFileHandle("meta.json");
        const metaFile = await metaHandle.getFile();
        const meta = JSON.parse(await metaFile.text());
        list.push(meta);
      } catch (_) {
        // Incomplete or corrupt folder, ignore
      }
    }
  }

  return list.sort((a, b) => (b.builtAt || 0) - (a.builtAt || 0));
}

// Delete a saved area from OPFS
export async function deleteArea(slug) {
  const areasDir = await getAreasDir();
  if (!areasDir) return false;

  const key = keyOf(slug);
  try {
    await areasDir.removeEntry(key, { recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

