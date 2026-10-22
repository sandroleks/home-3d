"""Door openings, read from the 'Door N (A / B) lintel' objects."""
import re
from dataclasses import dataclass

import numpy as np

from . import bpyutil, geom

OPENING_RE = re.compile(r"^(?P<glazed>Glazed )?Door (?P<num>\d+) \((?P<a>[^/]+?) / (?P<b>[^)]+?)\) lintel$")
INFILL_RE = re.compile(r"^Door (?P<num>\d+) infill$")


@dataclass(frozen=True)
class Opening:
    num: int
    glazed: bool
    rooms: tuple
    center: tuple
    u: tuple
    n: tuple
    width: float
    thickness: float


def opening_from_points(num, glazed, room_names, points_xz):
    center, u, n, width, thickness = geom.principal_frame(points_xz)
    return Opening(num, glazed, tuple(room_names), center, u, n, width, thickness)


def parse_openings(meshes):
    ops, infilled = [], set()
    for o in meshes:
        m = OPENING_RE.match(o.name)
        if m:
            co = bpyutil.world_coords(o)
            pts = np.stack([co[:, 0], -co[:, 1]], axis=1)
            ops.append(opening_from_points(int(m["num"]), bool(m["glazed"]), (m["a"], m["b"]), pts))
        mi = INFILL_RE.match(o.name)
        if mi:
            infilled.add(int(mi["num"]))
    ops.sort(key=lambda op: op.num)
    return ops, infilled
