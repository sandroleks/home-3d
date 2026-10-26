"""Other layouts of the flat (config.VARIANTS): the same model with a few collections swapped, set up before export."""
import bmesh
import bpy
from mathutils import Vector

from . import config, geom


def _layer_collection(lc, name):
    if lc.collection.name == name:
        return lc
    for ch in lc.children:
        found = _layer_collection(ch, name)
        if found:
            return found
    return None


def _set_rendered(view_layer, name, on):
    col = bpy.data.collections.get(name)
    lc = _layer_collection(view_layer.layer_collection, name)
    if col is None or lc is None:
        raise RuntimeError(f"variant: no collection {name!r} in the view layer")
    col.hide_render = not on
    if on:  # hidden in the viewport, its objects would be left out of the evaluated meshes
        col.hide_viewport = False
        lc.exclude = False
        lc.hide_viewport = False


def _trim_floor(floor_name, cutter_name):
    floor, cutter = bpy.data.objects[floor_name], bpy.data.objects[cutter_name]
    corners = [cutter.matrix_world @ Vector(c) for c in cutter.bound_box]
    lo = (min(c.x for c in corners), min(c.y for c in corners))
    hi = (max(c.x for c in corners), max(c.y for c in corners))
    floor.data = floor.data.copy()  # another object may share the mesh
    bm = bmesh.new()
    bm.from_mesh(floor.data)
    bm.faces.ensure_lookup_table()
    m = floor.matrix_world
    faces = [[(p.x, p.y) for p in (m @ v.co for v in f.verts)] for f in bm.faces]
    drop = [bm.faces[i] for i in geom.faces_within(faces, lo, hi)]
    if not drop:
        raise RuntimeError(f"variant: no faces of {floor_name!r} lie within {cutter_name!r}")
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.to_mesh(floor.data)
    bm.free()
    print(f"[variant] {floor_name}: dropped {len(drop)} faces under {cutter_name}", flush=True)


def apply_variant(name, view_layer):
    v = config.VARIANTS[name]
    for col in v["show"]:
        _set_rendered(view_layer, col, True)
    for col in v["hide"]:
        _set_rendered(view_layer, col, False)
    for obj_name, mod_name in v["remove_modifiers"]:
        obj = bpy.data.objects[obj_name]
        obj.modifiers.remove(obj.modifiers[mod_name])
    for floor_name, cutter_name in v["trim_floors"]:
        _trim_floor(floor_name, cutter_name)
    view_layer.update()
    print(f"[variant] {name}: showing {', '.join(v['show'])}; hiding {', '.join(v['hide'])}", flush=True)
