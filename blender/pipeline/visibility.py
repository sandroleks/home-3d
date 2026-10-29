"""Which rooms can be seen from which: rays from a grid of eye points in each room, through glass and open door
leaves, to the first room surface they meet. For each room, every other room it sees and the door leaves (indices
into the manifest's doors) in the way: the viewer draws a room only when, for one of those sets, all its doors are
open. A room missing from the table sees everything.

The numpy half (fibonacci_directions, floor_points, minimal_sets) needs no Blender."""
import math
import re

import numpy as np

from . import config

GLASS = re.compile(r"glass|acrylic", re.I)


def fibonacci_directions(n):
    """n unit vectors spread evenly over the sphere."""
    i = np.arange(n) + 0.5
    z = 1 - 2 * i / n
    r = np.sqrt(1 - z * z)
    phi = i * math.pi * (3 - math.sqrt(5))
    return np.stack([r * np.cos(phi), r * np.sin(phi), z], -1)


def _cross2(a, b):
    return a[..., 0] * b[..., 1] - a[..., 1] * b[..., 0]


def floor_points(floor, spacing):
    """Points on a grid `spacing` m apart over a room's floor (flat [x0, z0, x1, z1, x2, z2, ...] triangles, three.js
    xz), and each triangle's middle, so a narrow room still gets some."""
    t = np.asarray(floor, dtype=np.float64).reshape(-1, 3, 2)
    out = [tri.mean(0) for tri in t]
    lo, hi = t.reshape(-1, 2).min(0), t.reshape(-1, 2).max(0)
    xs = np.arange(lo[0] + spacing / 2, hi[0], spacing)
    zs = np.arange(lo[1] + spacing / 2, hi[1], spacing)
    for x in xs:
        for z in zs:
            p = np.array([x, z])
            for a, b, c in t:
                d1 = _cross2(b - a, p - a)
                d2 = _cross2(c - b, p - b)
                d3 = _cross2(a - c, p - c)
                if (d1 >= 0 and d2 >= 0 and d3 >= 0) or (d1 <= 0 and d2 <= 0 and d3 <= 0):
                    out.append(p)
                    break
    return np.array(out)


def minimal_sets(sets):
    """The door sets that aren't a superset of another (any open set suffices), sorted."""
    uniq = sorted({tuple(sorted(s)) for s in sets}, key=lambda s: (len(s), s))
    keep = []
    for s in uniq:
        if not any(set(k) <= set(s) for k in keep):
            keep.append(s)
    return [list(s) for s in keep]


# ---- Blender ----

def _gather(state):
    """One BVH over the rooms' surfaces and the door leaves, with what each polygon is."""
    import bpy
    from mathutils.bvhtree import BVHTree

    verts, polys, owner = [], [], []
    sources = [(c["node"], ("room", c["room"])) for c in state["chunks"] if c["room"] is not None]
    sources += [(c["node"], ("outside", None)) for c in state["chunks"] if c["room"] is None]
    sources += [(d["node"], ("door", i)) for i, d in enumerate(state["doors"])]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for name, tag in sources:
        obj = bpy.data.objects[name].evaluated_get(depsgraph)
        me = obj.to_mesh()
        mw = obj.matrix_world
        base = len(verts)
        verts.extend(mw @ v.co for v in me.vertices)
        mats = [s.material.name if s.material else "" for s in obj.material_slots]
        for p in me.polygons:
            polys.append([base + i for i in p.vertices])
            glass = p.material_index < len(mats) and bool(GLASS.search(mats[p.material_index]))
            owner.append(("glass", None) if glass else tag)
        obj.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys, epsilon=0.0), owner


def compute(state, spacing=config.VISIBILITY_SPACING, heights=config.VISIBILITY_HEIGHTS, rays=config.VISIBILITY_RAYS):
    """{room: {other room: [[door index, ...], ...]}} for every room with a floor."""
    from mathutils import Vector

    bvh, owner = _gather(state)
    dirs = [Vector(d) for d in fibonacci_directions(rays)]
    out = {}
    for room in state["rooms"]:
        seen = {}
        pts = floor_points(room["floor"], spacing)
        for x, z in pts:
            for h in heights:
                origin = Vector((x, -z, h))  # three.js xz -> Blender xy
                for d in dirs:
                    o, doors = origin, set()
                    for _ in range(8):
                        hit = bvh.ray_cast(o, d, 60.0)
                        if hit[0] is None:
                            break
                        kind, what = owner[hit[2]]
                        if kind == "glass":
                            o = hit[0] + d * 1e-3
                            continue
                        if kind == "door":
                            doors.add(what)
                            o = hit[0] + d * 1e-3
                            continue
                        if kind == "room" and what != room["id"]:
                            seen.setdefault(what, []).append(frozenset(doors))
                        break
        out[room["id"]] = {r: minimal_sets(s) for r, s in sorted(seen.items())}
        print(f"[visibility] {room['id']}: {len(pts)} points, sees {', '.join(out[room['id']]) or 'nothing else'}", flush=True)
    return out
