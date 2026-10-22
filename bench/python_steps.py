"""Run duckOSM with the same config as `duckosm build --config`, and time each step inside the process.

    python bench/python_steps.py config.yaml [--no-lane-profile]

It prints one line per step: `STEP <name> <seconds>`. The steps are wrapped methods of DuckOSM, so the
code that runs is the code of `duckosm build`. With `--no-lane-profile` the lane profile step does nothing.
duckOSM cannot switch that step off, and it is not part of the network step (it is a Python loop over
every edge and takes more time than all the other steps together).
"""
import sys
import time

from duckosm.config import Config
from duckosm.importer import DuckOSM

STEPS = ["_connect", "_load_pbf", "_build_global_junctions", "_filter_roads", "_build_edges", "_simplify_graph",
         "_split_private", "_component_filter", "_create_indexes", "_lane_profile", "_cleanup", "_generate_metadata",
         "_checkpoint"]


def wrap(name):
    orig = getattr(DuckOSM, name)

    def timed(self, *a, **k):
        t = time.perf_counter()
        try:
            return orig(self, *a, **k)
        finally:
            print(f"STEP {name} {time.perf_counter() - t:.4f}", flush=True)

    setattr(DuckOSM, name, timed)


if "--no-lane-profile" in sys.argv:
    DuckOSM._lane_profile = lambda self: None
for s in STEPS:
    if hasattr(DuckOSM, s):
        wrap(s)
t0 = time.perf_counter()
DuckOSM(Config.from_yaml(sys.argv[1])).run()
print(f"STEP total_run {time.perf_counter() - t0:.4f}")
