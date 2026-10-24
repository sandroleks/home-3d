"""Drawers and cupboard doors: meshes with a `web_move` custom property.

    web_move = "slide": web_dir (Blender world unit vector), web_dist (m)
    web_move = "hinge": web_pivot (world point), web_axis (world unit vector), web_angle (radians, right-handed)
    web_move = "spin": web_pivot, web_axis, web_rpm (turns a minute while on: the turntable's platter)

Each becomes its own node (Move_<name>), hinged ones with their origin at the pivot. All of a room's movables share a
lightmap atlas, one square tile each, baked in their open pose so their insides are lit.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import bpyutil, config, geom

TILE_PAD = 3  # px kept clear around each tile's UVs, so bake margins don't run into the next tile


def find(meshes):
    """Door leaves that slide are doors (doors.py), not movables."""
    return [o for o in meshes if o.get(config.MOVE_PROP) and not o.name.startswith("Door leaf")]


def _v(values):
    return [round(float(v), 5) + 0.0 for v in values]


def prepare_movables(objs, floor_index):
    """Re-origin hinged movables at their pivot, rename them Move_<slug>, and return their specs: three.js values for
    the viewer, Blender ones (under "blender") for the bake."""
    specs = []
    for o in sorted(objs, key=lambda o: o.name):
        kind = o[config.MOVE_PROP]
        co = bpyutil.world_coords(o)
        c = (co.min(0) + co.max(0)) / 2
        k = int(floor_index.locate_many([geom.to_three_xz(c[0], c[1])], config.LAMP_ROOM_MAX_DIST)[0])
        spec = {"source": o.name, "node": f"Move_{geom.slugify(o.name)}", "room": floor_index.ids[k] if k >= 0 else None,
                "kind": kind, "centre": _v(c)}
        if kind == "slide":
            d = Vector(o["web_dir"]).normalized()
            spec.update(dir=_v(geom.to_three(tuple(d))), distance=round(float(o["web_dist"]), 4),
                        blender={"dir": _v(d), "dist": float(o["web_dist"])})
        elif kind in ("hinge", "spin"):
            pivot, axis = Vector(o["web_pivot"]), Vector(o["web_axis"]).normalized()
            o.data.transform(Matrix.Translation(-pivot))
            o.location = pivot
            spec.update(pivot=_v(geom.to_three(tuple(pivot))), axis=_v(geom.to_three(tuple(axis))))
            if kind == "hinge":
                spec.update(angle=round(float(o["web_angle"]), 5),
                            blender={"pivot": _v(pivot), "axis": _v(axis), "angle": float(o["web_angle"])})
            else:  # baked as it stands: a spinning platter looks the same at any angle
                spec.update(rpm=round(float(o["web_rpm"]), 3), blender={"pivot": _v(pivot), "axis": _v(axis), "angle": 0.0})
        else:
            raise RuntimeError(f"{o.name}: {config.MOVE_PROP} is {kind!r}, expected 'slide', 'hinge' or 'spin'")
        o.name = spec["node"]
        specs.append(spec)
    bpy.context.view_layer.update()  # matrix_world follows the new origins
    return specs


def open_matrix(obj, spec):
    """The object's world matrix in the open pose."""
    b = spec["blender"]
    if spec["kind"] == "slide":
        return Matrix.Translation(Vector(b["dir"]) * b["dist"]) @ obj.matrix_world
    return obj.matrix_world @ Matrix.Rotation(b["angle"], 4, Vector(b["axis"]))  # the origin is the pivot


def passes(centres, min_dist):
    """Greedy groups of indices whose centres are all at least min_dist apart (pure)."""
    out = []
    for i, c in enumerate(centres):
        for group in out:
            if all(math.dist(c, centres[j]) >= min_dist for j in group):
                group.append(i)
                break
        else:
            out.append([i])
    return out


def atlas_columns(n):
    return max(1, math.ceil(math.sqrt(n)))


def tile_rect(index, cols, tile):
    """(x0, y0, x1, y1) in pixels, y from the bottom like Blender image pixels."""
    col, row = index % cols, index // cols
    return col * tile, row * tile, (col + 1) * tile, (row + 1) * tile


def place_in_tile(obj, index, cols, tile):
    """Move the object's lightmap UVs (already packed into 0..1) into its tile of the atlas."""
    pad = TILE_PAD / tile
    col, row = index % cols, index // cols
    uv = obj.data.uv_layers["UVLightmap"].data
    co = np.empty(len(uv) * 2, dtype=np.float64)
    uv.foreach_get("uv", co)
    co = co.reshape(-1, 2) * (1 - 2 * pad) + pad
    co[:, 0] = (col + co[:, 0]) / cols
    co[:, 1] = (row + co[:, 1]) / cols
    uv.foreach_set("uv", co.ravel())


def posed_copy(objs, specs, name):
    """One temporary mesh object: copies of the movables, each in its open pose, joined (lightmap UVs come along)."""
    copies = []
    for o, s in zip(objs, specs):
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.scene.collection.objects.link(c)
        c.matrix_world = open_matrix(o, s)
        c.hide_render = False
        copies.append(c)
    bpy.context.view_layer.update()
    joined = bpyutil.join(copies, name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return joined


def remove(obj):
    me = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if me.users == 0:
        bpy.data.meshes.remove(me)
