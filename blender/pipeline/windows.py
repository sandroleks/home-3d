"""Exterior glass panes: the viewer works out from them how much sunlight enters each room."""
import re

import numpy as np

from . import bpyutil, geom

GLASS_RE = re.compile(r"^(?:Glazed Door|Window) \d+ \((?P<a>[^/]+?) / (?P<b>[^)]+?)\) glass$")
EXTERIOR = "Exterior"
PROBE = 0.4  # m from the pane: on the room's side this point lies on the room's floor


def exterior_windows(meshes, floor_index):
    """[{room, center, normal, width, height}] in three.js space, the normal pointing outdoors."""
    out = []
    for o in sorted(meshes, key=lambda o: o.name):
        m = GLASS_RE.match(o.name)
        if not m:
            if EXTERIOR in o.name and "glass" in o.name.lower():
                print(f"[windows] WARNING: '{o.name}' looks like exterior glass but doesn't match the naming pattern; no sunlight enters through it")
            continue
        if EXTERIOR not in (m["a"], m["b"]):
            continue
        room = geom.slugify(m["b"] if m["a"] == EXTERIOR else m["a"])
        co = bpyutil.world_coords(o)
        (cx, cz), _, (nx, nz), width, _ = geom.principal_frame(np.stack([co[:, 0], -co[:, 1]], axis=1))
        if floor_index.locate(cx + nx * PROBE, cz + nz * PROBE) == room:
            nx, nz = -nx, -nz
        elif floor_index.locate(cx - nx * PROBE, cz - nz * PROBE) != room:
            print(f"[windows] WARNING: neither side of '{o.name}' lands in room '{room}'; its outdoor direction is unverified")
        y0, y1 = float(co[:, 2].min()), float(co[:, 2].max())
        out.append({
            "room": room,
            "center": [round(cx, 4), round((y0 + y1) / 2, 4), round(cz, 4)],
            "normal": [round(nx, 4) + 0.0, 0.0, round(nz, 4) + 0.0],  # + 0.0 turns -0.0 into 0.0
            "width": round(width, 4),
            "height": round(y1 - y0, 4),
        })
    return out
