# When the page does not work

## Limits

| Topic | Fact |
|---|---|
| Size of the map | The map draws 200,000 roads on a computer and 40,000 on a small device. Add `?maxroads=N` to the address to change the limit. |
| Area from hexagons | At most 500 cells and 5,000 km². |
| Memory | The page needs memory for the area. Estonia (a 121 MB region file) uses about 710 MiB. A small device can fail on a large area. Choose a smaller area. |
| Saved areas | They stay in this browser only. If you clear the site data, they go. |
| Data from Overpass | A busy server can refuse a large area. Use a region file for a large area. |

## Problems

- **A large area fails.** Choose a smaller area, or use [duckOSM](cli.md) on a computer with more memory.
- **The page loads twice at the first visit.** The page needs headers that make the browser use threads. The host cannot send them, so a small script in the page adds them and loads the page again. In a test with a fast link, the second load starts after about half a second. A hard reload (Shift + reload) skips the script, and the page then builds with one thread. [Hosting](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/proposals/hosting.md) has the reason.
- **A red bar says "the browser may have an old file".** Press Ctrl+Shift+R one time.
- **Street View or Google 3D shows nothing.** These tools need a key. Press the gear in the bar of tools. Save your Google key or your Mapillary token there. The deployed page has its own Google key.
- **Your areas is empty.** The browser keeps saved areas for one address only. If you clear the site data, or open the page at another address, the areas go.
- **A tile file shows only thin lines in QGIS.** Tiles have no style. Use the **Web map** package or the **MapLibre style**. [Step 10](manual/export.md) has the details.

## Keys for a test on your computer

Put the keys in `crates/duckosm-wasm/www/local_keys.json`, as `{"google": "...", "mapillary": "..."}`. Git ignores this file. Only a page on `localhost` reads it. [Development](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/development.md) has the details.
