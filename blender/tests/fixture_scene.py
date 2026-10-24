"""A tiny two-room apartment that follows the real file's naming conventions.

Blender coordinates (Z up). Alpha: x 0..3, y 0..3. Beta: x 3.2..6, y 0..3.
A 0.2 m wall at x 3.0..3.2 has an opening at y 1.0..1.8 whose door leaf is modelled open into
Alpha (hinge at (3.1, 1.78)), and an infilled opening at y 2.2..2.8 with a leftover leaf open in Beta.
Alpha has an exterior window in its south wall (y -0.2..0), a desk lamp, a window fill light and a
glowing wall lamp; Beta's 'Lamp' glows with the same material. The desk lamp is a lamp group of its own
('desk-lamp', with the wall lamp and a bulb that casts no shadow). Beta has a cabinet against its north wall
with a drawer (slides -Y) above a cupboard door (hinged at its west edge), and a TV screen on its south wall.
"""
import math

import bmesh
import bpy
from mathutils import Vector


def _principled(mat):
    if mat.node_tree is None:
        mat.use_nodes = True
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def _mat_flat(name, rgb, roughness=0.8):
    mat = bpy.data.materials.new(name)
    bsdf = _principled(mat)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def _mat_procedural(name):
    mat = _mat_flat(name, (0.5, 0.5, 0.5))
    nt = mat.node_tree
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.inputs["Scale"].default_value = 2.0
    nt.links.new(geo.outputs["Position"], brick.inputs["Vector"])
    nt.links.new(brick.outputs["Color"], _principled(mat).inputs["Base Color"])
    return mat


def _mat_emissive(name):
    mat = _mat_flat(name, (1.0, 0.9, 0.7))
    bsdf = _principled(mat)
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.9, 0.7, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 2.0
    return mat


def _collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def box_object(name, boxes, material, collection):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for x0, y0, z0, x1, y1, z1 in boxes:
        verts = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        bmesh.ops.scale(bm, vec=Vector((x1 - x0, y1 - y0, z1 - z0)), verts=verts)
        bmesh.ops.translate(bm, vec=Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), verts=verts)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    collection.objects.link(obj)
    return obj


def _light(name, kind, location, energy, collection, size=None):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    if size is not None:
        data.size = size
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    collection.objects.link(obj)
    return obj


def _props(obj, **values):
    for k, v in values.items():
        obj[k] = v


def _camera(name, location, rotation, collection):
    obj = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    obj.location = location
    obj.rotation_euler = rotation
    collection.objects.link(obj)
    return obj


def _build_up(obj, last_frame):
    """Scale 0.001 -> 1 like the real file's build-up animation."""
    for frame, v in ((1, 0.001), (last_frame, 1.0)):
        obj.scale = (v, v, v)
        obj.keyframe_insert("scale", frame=frame)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("World")
    if scene.world.node_tree is None:
        scene.world.use_nodes = True
    next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND").inputs["Strength"].default_value = 1.0
    tree = scene.world.node_tree
    sky = tree.nodes.new("ShaderNodeTexSky")  # like the real file: a sky texture drives the world colour
    tree.links.new(sky.outputs["Color"], next(n for n in tree.nodes if n.type == "BACKGROUND").inputs["Color"])

    plaster = _mat_flat("Plaster", (0.8, 0.8, 0.78), 0.9)
    wood = _mat_flat("Wood", (0.4, 0.25, 0.15), 0.6)
    tile = _mat_procedural("Tile proc")
    glow = _mat_emissive("Lamp glow")
    glass = _mat_flat("Window glass", (0.9, 0.95, 1.0), 0.05)

    structure = _collection("Structure")
    floors = _collection("Floors")
    furniture = _collection("Furniture")
    doors = _collection("Doors.001")
    ceiling = _collection("Ceiling")
    ceiling.hide_render = True
    variant = _collection("Variant")
    variant.hide_render = True
    lights = _collection("Lights")
    interior = _collection("Interior lights")
    cams = _collection("Cameras")

    box_object("Floor - Alpha", [(0, 0, 0, 3.0, 3.0, 0.02)], tile, floors)
    box_object("Floor - Beta", [(3.2, 0, 0, 6.0, 3.0, 0.02)], wood, floors)
    box_object("Walls", [
        (-0.2, -0.2, 0, 6.2, 0, 2.6),
        (-0.2, 3.0, 0, 6.2, 3.2, 2.6),
        (-0.2, 0, 0, 0, 3.0, 2.6),
        (6.0, 0, 0, 6.2, 3.0, 2.6),
        (3.0, 0, 0, 3.2, 1.0, 2.6),
        (3.0, 1.8, 0, 3.2, 2.2, 2.6),
        (3.0, 2.8, 0, 3.2, 3.0, 2.6),
    ], plaster, structure)
    box_object("Door 1 (Alpha / Beta) lintel", [(3.0, 1.0, 2.05, 3.2, 1.8, 2.6)], plaster, structure)
    box_object("Door 2 (Alpha / Beta) lintel", [(3.0, 2.2, 2.05, 3.2, 2.8, 2.6)], plaster, structure)
    box_object("Door 2 infill", [(3.0, 2.2, 0, 3.2, 2.8, 2.05)], plaster, structure)
    box_object("Ceiling", [(-0.2, -0.2, 2.6, 6.2, 3.2, 2.7)], plaster, ceiling).hide_render = True
    box_object("Door leaf 1", [(2.34, 1.76, 0, 3.10, 1.80, 2.0)], wood, doors)  # open 90° into Alpha
    box_object("Door leaf 2", [(3.12, 2.20, 0, 3.68, 2.24, 2.0)], wood, doors)  # open, infilled doorway
    box_object("Shelf", [(3.4, 0.5, 0, 3.9, 1.3, 1.2)], wood, furniture)
    box_object("Lamp", [(5.5, 2.5, 0, 5.8, 2.8, 0.5)], glow, furniture)
    box_object("Alpha wall lamp", [(2.2, 0.8, 1.75, 2.5, 1.1, 1.95)], glow, furniture)["web_lamp"] = "desk-lamp"
    bulb = box_object("Desk lamp bulb", [(0.47, 2.47, 0.95, 0.53, 2.53, 1.01)], _mat_emissive("Bulb glow"), furniture)
    bulb.visible_shadow = False
    bulb["web_lamp"] = "desk-lamp"
    box_object("Cabinet", [(4.4, 2.55, 0, 5.0, 3.0, 0.8)], wood, furniture)
    drawer = box_object("Cabinet drawer", [(4.42, 2.53, 0.45, 4.98, 2.55, 0.78), (4.44, 2.55, 0.46, 4.96, 2.95, 0.75)],
                        wood, furniture)
    _props(drawer, web_move="slide", web_dir=[0.0, -1.0, 0.0], web_dist=0.35)
    door = box_object("Cabinet door", [(4.42, 2.53, 0.02, 4.98, 2.55, 0.43)], wood, furniture)
    _props(door, web_move="hinge", web_pivot=[4.42, 2.55, 0.2], web_axis=[0.0, 0.0, 1.0], web_angle=-1.7)
    tv = box_object("TV screen", [(4.4, 0.0, 1.0, 5.2, 0.005, 1.45)], _mat_emissive("Screen"), furniture)
    tv["web_screen"] = "tv"
    box_object("Window 3 (Exterior / Alpha) glass", [(1.0, -0.11, 1.0, 2.0, -0.09, 2.0)], glass, structure)
    sofa = box_object("Hidden sofa", [(1.0, 2.0, 0, 2.5, 2.8, 0.8)], wood, variant)
    sofa.location = (0.5, 0, 0)
    # Kept child of a dropped parent: world centre is (0.5 + 1.5, 2.4, 0.85) = (2.0, 2.4, 0.85).
    cushion = box_object("Sofa cushion", [(-0.1, -0.1, -0.1, 0.1, 0.1, 0.1)], wood, furniture)
    cushion.parent = sofa
    cushion.location = (1.5, 2.4, 0.85)

    rig = bpy.data.objects.new("Table rig", None)
    furniture.objects.link(rig)
    rig.location = (0.5, 0.5, 0)
    table = box_object("Table", [(-0.3, -0.3, 0, 0.3, 0.3, 0.8)], wood, furniture)
    table.parent = rig
    table.location = (1.0, 1.0, 0)
    table.modifiers.new("Bevel", "BEVEL").width = 0.01

    _light("Sun", "SUN", (0, 0, 10), 3.0, lights)
    _light("Desk lamp light", "POINT", (0.5, 2.5, 0.98), 10.0, lights)["web_lamp"] = "desk-lamp"
    _light("Portal Alpha window", "AREA", (1.5, 0.05, 1.5), 5.0, lights, size=1.0)
    _light("Ceiling light Alpha", "AREA", (1.5, 1.5, 2.55), 100.0, interior, size=0.5)
    _light("Ceiling light Beta", "AREA", (4.6, 1.5, 2.55), 100.0, interior, size=0.5)
    bpy.context.view_layer.layer_collection.children["Interior lights"].exclude = True

    _camera("Cam_Entrada", (1.0, 0.8, 1.6), (math.pi / 2, 0, -math.pi / 2), cams)
    _camera("Cam_Sala", (4.5, 1.5, 1.6), (math.pi / 2, 0, math.pi / 2), cams)
    scene.camera = scene.objects["Cam_Entrada"]
    _build_up(scene.objects["Walls"], 10)
    _build_up(scene.objects["Door leaf 1"], 10)
    scene.frame_start = 1
    scene.frame_end = 10
    scene.frame_set(1)
    bpy.context.view_layer.update()
