"""A tiny two-room apartment that follows the real file's naming conventions.

Blender coordinates (Z up). Alpha: x 0..3, y 0..3. Beta: x 3.2..6, y 0..3.
A 0.2 m wall at x 3.0..3.2 has an opening at y 1.0..1.8 with a door leaf.
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


def _camera(name, location, rotation, collection):
    obj = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    obj.location = location
    obj.rotation_euler = rotation
    collection.objects.link(obj)
    return obj


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("World")
    if scene.world.node_tree is None:
        scene.world.use_nodes = True
    next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND").inputs["Strength"].default_value = 1.0

    plaster = _mat_flat("Plaster", (0.8, 0.8, 0.78), 0.9)
    wood = _mat_flat("Wood", (0.4, 0.25, 0.15), 0.6)
    tile = _mat_procedural("Tile proc")
    glow = _mat_emissive("Lamp glow")

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
        (3.0, 1.8, 0, 3.2, 3.0, 2.6),
    ], plaster, structure)
    box_object("Door 1 (Alpha / Beta) lintel", [(3.0, 1.0, 2.05, 3.2, 1.8, 2.6)], plaster, structure)
    box_object("Ceiling", [(-0.2, -0.2, 2.6, 6.2, 3.2, 2.7)], plaster, ceiling)
    box_object("Door leaf 1", [(3.08, 1.02, 0, 3.12, 1.78, 2.0)], wood, doors)
    box_object("Shelf", [(3.4, 0.5, 0, 3.9, 1.3, 1.2)], wood, furniture)
    box_object("Lamp", [(5.5, 2.5, 0, 5.8, 2.8, 0.5)], glow, furniture)
    box_object("Hidden sofa", [(1.0, 2.0, 0, 2.5, 2.8, 0.8)], wood, variant)

    rig = bpy.data.objects.new("Table rig", None)
    furniture.objects.link(rig)
    rig.location = (0.5, 0.5, 0)
    table = box_object("Table", [(-0.3, -0.3, 0, 0.3, 0.3, 0.8)], wood, furniture)
    table.parent = rig
    table.location = (1.0, 1.0, 0)
    table.modifiers.new("Bevel", "BEVEL").width = 0.01

    _light("Sun", "SUN", (0, 0, 10), 3.0, lights)
    _light("Ceiling light Alpha", "AREA", (1.5, 1.5, 2.55), 100.0, interior, size=0.5)
    _light("Ceiling light Beta", "AREA", (4.6, 1.5, 2.55), 100.0, interior, size=0.5)
    bpy.context.view_layer.layer_collection.children["Interior lights"].exclude = True

    _camera("Cam_Entrada", (1.0, 0.8, 1.6), (math.pi / 2, 0, -math.pi / 2), cams)
    _camera("Cam_Sala", (4.5, 1.5, 1.6), (math.pi / 2, 0, math.pi / 2), cams)
    scene.camera = scene.objects["Cam_Entrada"]
    bpy.context.view_layer.update()
