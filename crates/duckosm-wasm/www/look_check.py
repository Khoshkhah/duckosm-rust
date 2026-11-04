"""The first zoom of the road classes in map/look.json (made by crates/duckosm-wasm/make_look.mjs): a minor class does not show before the classes of its kind.

    python crates/duckosm-wasm/www/look_check.py

A stairway (`steps`) showed from the lowest zoom of the tiles, before the footways (zoom 15). No browser and no network.
"""
import json
import pathlib

look = json.loads((pathlib.Path(__file__).parent / "map/look.json").read_text())
c = look["roads"]["classes"]
missing = [k for k, v in c.items() if v.get("minzoom") is None and k != "ferry"]
assert not missing, ("a class has no first zoom: it shows from the lowest zoom of the tiles", missing)
assert c["steps"]["minzoom"] >= c["footway"]["minzoom"] and c["corridor"]["minzoom"] >= c["footway"]["minzoom"], "steps and corridors do not show before footways"
assert c["bridleway"]["minzoom"] >= c["track"]["minzoom"] and c["platform"]["minzoom"] >= c["footway"]["minzoom"] - 1
print("look_check.py: passed (", {k: v["minzoom"] for k, v in c.items() if k in ("footway", "path", "steps", "corridor", "bridleway", "platform", "construction")}, ")")
