"""Create a small wall switch mesh for each room that has a ceiling light."""
import math

import bmesh
import bpy

from . import config
from .placement import choose_switch_spot


def switch_material():
    mat = bpy.data.materials.get("Web switch")
    if mat:
        return mat
    mat = bpy.data.materials.new("Web switch")
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.92, 0.92, 0.9, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.4
    bsdf.inputs["Emission Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 0.3
    return mat


def create_switch(room_id, spot, collection, material):
    name = f"Switch_{room_id}"
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    collection.objects.link(obj)
    ux, uz = spot["u"]
    px, pz = spot["pos"]
    obj.scale = config.SWITCH_SIZE
    obj.rotation_euler = (0.0, 0.0, math.atan2(-uz, ux))  # local X along the wall
    obj.location = (px, -pz, config.SWITCH_HEIGHT)
    bpy.context.view_layer.update()  # make obj.dimensions reflect the new scale
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
