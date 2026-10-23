# To do: suggested work

Work that is suggested but not started. Each item says why, and where its notes are.

## The time zone in the browser

The page finds the time zone of an area with a table of the Geofabrik regions (`www/timezones.json`, 447 KB with
gzip; [tables.md](tables.md)). Kaveh chose it on 2026-10-23. Two other ways, for later:

- **A small time zone service of our own on Cloudflare** (`…/tz?lat=…&lon=…`, beside the relay). The page sends
  the middle point of the area and gets the zone name. The page downloads nothing, and the name is exact (the
  world map of `tzf-rs`, 2.7 MB with gzip, fits in a Worker of the free plan, which allows 3 MB). The cost: the
  build needs the network for this request.
- **The JavaScript package `@photostructure/tz-lookup`** (73 KB, CC0). Small and with no service, but by its own
  README about 30 % of random points get another zone name than the exact library, and about 5 % another clock.
  Good only if the name may differ from duckOSM's.

## The page and its map

- **A "Style" choice in step 5**: roadstyle's and mapstyle's 64 looks (mode, colors, paths) for the roads and the
  base map, as in the GeoLibre plugin.
- **Faster maps for a large area**: done in part (2026-10-23). The roads go to MapLibre as vector tiles that Rust
  makes when the map asks for them: Tartu 15.7 s to 7.4 s, and the page's memory 803 to 104 MiB
  ([browser.md](browser.md)). Since roadstyle-rs `900b43e` the sources `roads` and `simple` are typed pieces
  (Tartu: the module's memory 1,387 to 878 MiB). Still to do: the limit of 100,000 roads stays. Making the tiles' features without the trees
  would lift it. The work is in geolibre-roadstyle (`wasm/`).
- **The sea (`features.ocean`)**: not in the page for now (Kaveh, 2026-10-23). duckdb-wasm cannot read Overture's
  sea files in parts (27 GB in total). Two ways for later: read only the needed part of Overture's files in the page
  (about 20 MB the first time, the same sea as duckOSM), or make the sea from the coastline ways of the region file
  (no download, but no sea for Monaco, whose file has no coastline) ([features.md](features.md)).

## The tables

- **Group 2** ([tables.md](tables.md)) is done: `driving.lane_profile` ([lane_profile.md](lane_profile.md)) and the
  bus routes ([bus.md](bus.md)).

## Publishing

- The public page repository (`Khoshkhah/duckosm-web`, GitHub Pages) and the push of `browser-b4` to `main`,
  after Kaveh's test of the page. The relay allows `https://khoshkhah.github.io` ([relay.md](relay.md)).
