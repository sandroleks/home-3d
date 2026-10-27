"""Where visitors can sit and lie: seats.json, the spots on each sofa, chair, stool, bench and bed.

A seat is a render-visible mesh tagged `web_seat = "sit" | "lie"`, or named as in config.SEATS. Its spots are found
from the model, so they follow the furniture when it moves:

- the seat's height: rays down onto the seat itself;
- which way it faces: away from its back (something rising behind the seat), else toward a table or counter in front
  of it (a stool), else away from the nearest wall (a bench); a bed's head is the end with the pillows or headboard;
- how many spots: one per config.SEAT_SPACING m across it.

No bake: `make export-seats` writes only this file.
"""
import math
import os
import re

import bpy
from mathutils import Vector

from . import bpyutil, config, export, geom, scene_select

FILE = "seats.json"
# Horizontal axes in Blender's ground plane: the directions a seat can face.
AXES = ((1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0))
BACK_HEIGHT = {"sit": 0.3, "lie": 0.12}  # m above the seat: a back reaches this high, a sofa's arms don't; pillows
BACK_REACH = 0.15  # m beyond the seat's edge
TABLE_REACH = 0.25  # m beyond a stool's edge, where a table or counter top is looked for
TABLE_RISE = (0.12, 0.55)  # a table top this far above the seat
WALL_REACH = 1.2


def seat_pose(name, prop, patterns=None):
    """"sit", "lie", or None: the custom property wins, else the first pattern the name matches."""
    if prop in ("sit", "lie"):
        return prop
    for pattern, pose in patterns if patterns is not None else config.SEATS:
        if re.match(pattern, name):
            return pose
    return None


def half_extent(lo, hi, d):
    """Half the box's size along a ground axis."""
    return abs(d[0]) * (hi[0] - lo[0]) / 2 + abs(d[1]) * (hi[1] - lo[1]) / 2


def nearest_within(hits, limits):
    """The axis with the nearest hit within its limit, or None. `hits`: axis -> distance or None."""
    best = None
    for d, dist in hits.items():
        if dist is not None and dist <= limits[d] and (best is None or dist < hits[best]):
            best = d
    return best


def long_axes(lo, hi):
    """The two directions along the box's longer side."""
    return AXES[:2] if hi[0] - lo[0] >= hi[1] - lo[1] else AXES[2:]


def yaw_of(facing):
    """The viewer's yaw for a Blender ground direction: its forward is (-sin yaw, -cos yaw) in three.js x, z."""
    x, z = geom.to_three_xz(*facing)
    return math.atan2(-x, -z)


def spots(lo, hi, z, facing, spacing):
    """Spots spread across the seat (perpendicular to `facing`), one per `spacing` m, in Blender coordinates."""
    side = (-facing[1], facing[0])
    width = 2 * half_extent(lo, hi, side)
    n = max(1, int(width // spacing))
    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    out = []
    for i in range(n):
        t = ((i + 0.5) / n - 0.5) * width
        out.append((cx + side[0] * t, cy + side[1] * t, z))
    return out


def spec(name, pose, lo, hi, z, facing):
    """A seat in three.js space: its box (for clicking) and its spots."""
    a, b = geom.to_three(lo), geom.to_three(hi)
    box_lo = [min(a[i], b[i]) for i in range(3)]
    box_hi = [max(a[i], b[i]) for i in range(3)]
    r = lambda v: round(float(v), 4) + 0.0  # noqa: E731
    yaw = r(yaw_of(facing))
    return {
        "name": name, "pose": pose, "min": [r(v) for v in box_lo], "max": [r(v) for v in box_hi],
        "spots": [{"at": [r(v) for v in geom.to_three(p)], "yaw": yaw} for p in spots(lo, hi, z, facing, config.SEAT_SPACING[pose])],
    }


def _cast(scene, depsgraph, visible, origin, direction, distance, only=None):
    """The first render-visible hit (or the first on `only`): (distance, location, object), or None."""
    o, d = Vector(origin), Vector(direction).normalized()
    travelled = 0.0
    while travelled < distance:
        hit, loc, _n, _i, obj, _m = scene.ray_cast(depsgraph, o, d, distance=distance - travelled)
        if not hit:
            return None
        step = (loc - o).length
        travelled += step
        src = obj.original if obj else None
        if src is not None and (src is only if only is not None else scene_select.is_render_visible(src, visible)):
            return travelled, tuple(loc), src
        o = loc + d * 1e-4
        travelled += 1e-4
    return None


def _seat_height(scene, depsgraph, obj, lo, hi):
    """The seat's surface: the median of rays down onto the object near its middle (a chair's back rises above it)."""
    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    dx, dy = (hi[0] - lo[0]) * 0.2, (hi[1] - lo[1]) * 0.2
    zs = []
    for x, y in ((cx, cy), (cx - dx, cy), (cx + dx, cy), (cx, cy - dy), (cx, cy + dy)):
        h = _cast(scene, depsgraph, None, (x, y, hi[2] + 0.05), (0, 0, -1), hi[2] - lo[2] + 0.1, only=obj)
        if h:
            zs.append(h[1][2])
    zs.sort()
    return zs[len(zs) // 2] if zs else hi[2]


def _facing(scene, depsgraph, visible, pose, lo, hi, z):
    c = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
    axes = long_axes(lo, hi) if pose == "lie" else AXES
    rise = z + BACK_HEIGHT[pose]

    hits = {}
    for d in axes:
        h = _cast(scene, depsgraph, visible, (c[0], c[1], rise), (d[0], d[1], 0), WALL_REACH)
        hits[d] = h[0] if h else None
    back = nearest_within(hits, {d: half_extent(lo, hi, d) + BACK_REACH for d in axes})
    if back:
        return (-back[0], -back[1]), "back"
    if pose == "sit":
        for d in AXES:  # a stool: toward the table or counter it's pulled up to
            r = half_extent(lo, hi, d) + TABLE_REACH
            top = z + TABLE_RISE[1] + 0.05
            h = _cast(scene, depsgraph, visible, (c[0] + d[0] * r, c[1] + d[1] * r, top), (0, 0, -1), top - z)
            if h and TABLE_RISE[0] <= h[1][2] - z <= TABLE_RISE[1]:
                return d, f"table ({h[2].name})"
    wall = nearest_within(hits, {d: WALL_REACH for d in axes})
    if wall:
        return (-wall[0], -wall[1]), "wall"
    return axes[0], "default"


def find_seats(scene, view_layer):
    """The seats of the model as it will be exported (variant applied), in three.js space."""
    scene.frame_set(scene_select.finished_frame(scene))
    view_layer.update()
    visible = scene_select.visible_collections(view_layer)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in sorted(scene.objects, key=lambda o: o.name):
        if o.type != "MESH" or not scene_select.is_render_visible(o, visible):
            continue
        pose = seat_pose(o.name, o.get(config.SEAT_PROP))
        if pose is None:
            continue
        co = bpyutil.world_coords(o)
        lo, hi = tuple(co.min(0)), tuple(co.max(0))
        z = _seat_height(scene, depsgraph, o, lo, hi)
        facing, why = _facing(scene, depsgraph, visible, pose, lo, hi, z)
        s = spec(o.name, pose, lo, hi, z, facing)
        print(f"[seats] {o.name}: {pose}, {len(s['spots'])} spot(s) at {z:.2f} m, facing {facing} ({why})", flush=True)
        out.append(s)
    return out


def export_seats(scene, view_layer, out_dir):
    seats = find_seats(scene, view_layer)
    export.write_json(os.path.join(out_dir, FILE), {"version": 1, "seats": seats})
    return seats
