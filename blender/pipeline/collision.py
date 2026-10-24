"""2D occupancy grid on the three.js ground plane: where can a 0.2 m-radius visitor stand?"""
import math
import re
from dataclasses import dataclass

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from . import bpyutil, config, geom, lamps, raster


@dataclass
class Grid:
    x0: float
    z0: float
    cell: float
    width: int
    height: int
    blocked: np.ndarray  # (height, width), inflated by the player radius
    raw: np.ndarray      # (height, width), geometry only

    def is_blocked(self, x, z, raw=False):
        i = int(math.floor((x - self.x0) / self.cell))
        j = int(math.floor((z - self.z0) / self.cell))
        if not (0 <= i < self.width and 0 <= j < self.height):
            return True
        return bool((self.raw if raw else self.blocked)[j, i])

    def to_json(self, radius):
        return {
            "x0": round(self.x0, 4), "z0": round(self.z0, 4), "cell": self.cell,
            "width": self.width, "height": self.height, "radius": radius,
            "runs": raster.rle_encode(self.blocked),
        }


def cell_centres(bounds, cell):
    x0, z0, x1, z1 = bounds
    w = int(math.ceil(round((x1 - x0) / cell, 6)))
    h = int(math.ceil(round((z1 - z0) / cell, 6)))
    xs = x0 + (np.arange(w) + 0.5) * cell
    zs = z0 + (np.arange(h) + 0.5) * cell
    gx, gz = np.meshgrid(xs, zs)
    return w, h, np.stack([gx.ravel(), gz.ravel()], axis=1)


def assemble_grid(bounds, cell, radius, walkable, solid, near):
    w, h, _ = cell_centres(bounds, cell)
    raw = (~walkable | solid).reshape(h, w)
    blocked = raster.dilate(raw, int(math.ceil(round(radius / cell, 6)))) | near.reshape(h, w)
    return Grid(bounds[0], bounds[1], cell, w, h, blocked, raw)


def in_opening(pts, op, slack=0.05):
    d = pts - np.asarray(op.center)
    along = np.abs(d @ np.asarray(op.u))
    across = np.abs(d @ np.asarray(op.n))
    return (along <= op.width / 2) & (across <= op.thickness / 2 + slack)


def collision_meshes(meshes):
    passable = re.compile(config.PASSABLE_NAME_PATTERN)
    out = []
    for o in meshes:
        if o.name.startswith(("Floor - ", "Door leaf")) or passable.match(o.name) or lamps.glow_only(o):
            continue
        if bpyutil.world_coords(o)[:, 2].max() < config.LOW_OBJECT_MAX_Z:
            continue
        out.append(o)
    return out


def build_bvh(objs):
    verts, polys, off = [], [], 0
    for o in objs:
        co = bpyutil.world_coords(o)
        verts.extend(map(tuple, co))
        polys.extend([off + v for v in p.vertices] for p in o.data.polygons)
        off += len(co)
    return BVHTree.FromPolygons(verts, polys)


def build_collision(meshes, floor_index, openings, radius=config.PLAYER_RADIUS, cell=config.GRID_CELL):
    x0, z0, x1, z1 = floor_index.bounds()
    bounds = (x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5)
    _, _, pts = cell_centres(bounds, cell)
    walkable = floor_index.locate_many(pts) >= 0
    for op in openings:
        walkable |= in_opening(pts, op)
    bvh = build_bvh(collision_meshes(meshes))
    solid = np.zeros(len(pts), bool)
    near = np.zeros(len(pts), bool)
    down = Vector((0.0, 0.0, -1.0))
    reach = config.COLLISION_RAY_TOP - config.LOW_OBJECT_MAX_Z
    for k in np.flatnonzero(walkable):
        bx, by = geom.from_three_xz(*pts[k])
        if bvh.ray_cast(Vector((bx, by, config.COLLISION_RAY_TOP)), down, reach)[0] is not None:
            solid[k] = True
            continue
        for hgt in config.COLLISION_SAMPLE_HEIGHTS:
            if bvh.find_nearest(Vector((bx, by, hgt)), radius)[0] is not None:
                near[k] = True
                break
    return assemble_grid(bounds, cell, radius, walkable, solid, near)
