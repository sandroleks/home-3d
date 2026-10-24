"""Create a small wall switch mesh for each room that has a ceiling light."""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import config
from .placement import choose_switch_spot


def _material(name, rgb, emission):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.4
    bsdf.inputs["Emission Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Emission Strength"].default_value = emission  # a faint glow, so the switch is findable in the dark
    return mat


def switch_material():
    return _material("Web switch", (0.92, 0.92, 0.9), 0.3)


def rocker_material():
    return _material("Web switch rocker", (0.97, 0.97, 0.95), 0.4)


def _box(bm, size, offset):
    m = Matrix.Translation(offset) @ Matrix.Diagonal((*size, 1.0))
    return bmesh.ops.create_cube(bm, size=1.0, matrix=m)["verts"]


def create_switch(room_id, spot, collection, material):
    """A plate with a rocker on both faces (the wall line runs through its middle, either face may be the room's)."""
    name = f"Switch_{room_id}"
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    w, t, h = config.SWITCH_SIZE
    _box(bm, (w, t, h), Vector())
    rocker = []
    for s in (-1, 1):
        rocker += _box(bm, (w * 0.42, 0.006, h * 0.62), Vector((0.0, s * (t / 2 + 0.003), 0.0)))
    for f in {f for v in rocker for f in v.link_faces}:
        f.material_index = 1
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    me.materials.append(rocker_material())
    obj = bpy.data.objects.new(name, me)
    collection.objects.link(obj)
    ux, uz = spot["u"]
    px, pz = spot["pos"]
    obj.rotation_euler = (0.0, 0.0, math.atan2(-uz, ux))  # local X along the wall
    obj.location = (px, -pz, config.SWITCH_HEIGHT)
    bpy.context.view_layer.update()
    return obj


def place_switches(room_list, openings, infilled, floor_index, grid, collection, overrides):
    material = switch_material()
    result = {}
    for room in room_list:
        if not room["light"]:
            continue
        spot = choose_switch_spot(
            room["id"], room["name"], openings, infilled, floor_index.locate,
            lambda x, z: grid.is_blocked(x, z, raw=True), overrides.get(room["id"]),
            config.SWITCH_OFFSET_FROM_OPENING,
        )
        if spot is None:
            print(f"[switches] WARNING no spot for {room['name']}; add it to SWITCH_OVERRIDES", flush=True)
            continue
        result[room["id"]] = create_switch(room["id"], spot, collection, material).name
    return result
