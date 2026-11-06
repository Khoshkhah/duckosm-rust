# When the page does not work

## Limits

| Topic | Limit |
|---|---|
| Roads on the map | 200,000 on a computer, 40,000 on a small device. Add `?maxroads=N` to the address to change it. |
| Area from hexagons | 500 cells and 5,000 km². |
| Memory | Estonia (a 121 MB region file) uses about 710 MiB. A small device can fail on a large area. |
| Overpass | A busy server can refuse a large area. Use a region file. |

## Problems

| Problem | What to do |
|---|---|
| A large area fails. | Choose a smaller area. Or use [duckOSM](cli.md) on a computer with more memory. |
| The page loads twice at the first visit. | Wait. The second load turns on threads ([Hosting](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/proposals/hosting.md)). |
| A red bar says "the browser may have an old file". | Press Ctrl+Shift+R one time. |
| Street View or Google 3D shows nothing. | Press the gear in the bar of tools. Save your Google key or your Mapillary token. |
| **Your areas** is empty. | Saved areas stay in one browser at one address. If you clear the site data, the areas go. |
| A tile file shows only thin lines in QGIS. | Use the **Web map** package or the **MapLibre style** ([Step 10](manual/export.md)). |

## Keys for a test on your computer

Put the keys in `crates/duckosm-wasm/www/local_keys.json`, as `{"google": "...", "mapillary": "..."}`. Git ignores this file. Only a page on `localhost` reads it.
