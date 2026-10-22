"""Move each door leaf's origin to its hinge and decide which way it swings."""
import math
import re

import numpy as np
from mathutils import Matrix, Vector

from . import bpyutil, geom

NUM_RE = re.compile(r"(\d+)")


def _number(name):
    m = NUM_RE.search(name)
    return int(m.group(1)) if m else 0


def prepare_doors(door_objs, grid, overrides):
    specs = []
    for obj in sorted(door_objs, key=lambda o: _number(o.name)):
        n = _number(obj.name)
        co = bpyutil.world_coords(obj)
        pts = np.stack([co[:, 0], -co[:, 1]], axis=1)
        center, u, _, width, _ = geom.principal_frame(pts)
        ends = sorted(
            [(center[0] - u[0] * width / 2, center[1] - u[1] * width / 2),
             (center[0] + u[0] * width / 2, center[1] + u[1] * width / 2)],
            key=lambda p: (round(p[0], 3), round(p[1], 3)),
        )
        choice = geom.choose_door_swing(
            ends[0], ends[1], lambda x, z: grid.is_blocked(x, z, raw=True), overrides.get(obj.name)
        )
        hx, hz = choice["hinge"]
        bx, by = geom.from_three_xz(hx, hz)
        hinge = Vector((bx, by, float(co[:, 2].min())))
        obj.data.transform(Matrix.Translation(-hinge))
        obj.location = hinge
        obj.name = f"Door_{n}"
        specs.append({
            "node": obj.name,
            "key": f"door-{n}",
            "hinge": [round(hx, 4), round(hz, 4)],
            "dir": [round(choice["dir"][0], 5), round(choice["dir"][1], 5)],
            "width": round(choice["width"], 4),
            "openAngle": round(choice["sign"] * math.pi / 2, 5),
        })
        print(f"[doors] {obj.name}: hinge {specs[-1]['hinge']} sign {choice['sign']}", flush=True)
    return specs
