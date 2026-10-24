"""Choose what goes on the web, and bake every kept mesh into world space."""
import math

import bpy
import numpy as np
from mathutils import Matrix

from . import config


def visible_collections(view_layer):
    out = {view_layer.layer_collection.collection}

    def walk(lc):
        for ch in lc.children:
            if ch.exclude or ch.collection.hide_render:
                continue
            out.add(ch.collection)
            walk(ch)

    walk(view_layer.layer_collection)
    return out


def is_render_visible(obj, visible):
    return (not obj.hide_render) and any(c in visible for c in obj.users_collection)


def _forced(obj):
    return any(c.name.startswith(config.FORCE_INCLUDE_COLLECTION_PREFIXES) for c in obj.users_collection)


def surrounding_collections():
    roots = [c for c in bpy.data.collections if c.name.startswith(config.SURROUNDINGS_COLLECTION_PREFIXES)]
    return set(roots) | {ch for c in roots for ch in c.children_recursive}


def _placeholder_material():
    mat = bpy.data.materials.get("Web default")
    if mat is None:
        mat = bpy.data.materials.new("Web default")
        if mat.node_tree is None:
            mat.use_nodes = True
    return mat


def leave_edit_modes(view_layer):
    """A .blend saved in Edit Mode reloads that way, and Blender then silently ignores obj.data = ..."""
    for o in [o for o in view_layer.objects if o.mode != "OBJECT"]:
        if o.mode != "OBJECT":  # one mode_set call can leave several objects' Edit Mode at once
            view_layer.objects.active = o
            bpy.ops.object.mode_set(mode="OBJECT")


def realize(objs):
    """Apply modifiers and world transforms into each object's own mesh; clear parents."""
    dg = bpy.context.evaluated_depsgraph_get()
    matrices = {o.name: o.matrix_world.copy() for o in objs}
    slots = {o.name: [s.material for s in o.material_slots] for o in objs}
    meshes = {}
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(matrices[o.name])
        if matrices[o.name].determinant() < 0:
            me.flip_normals()
        meshes[o.name] = me
    for o in objs:
        o.modifiers.clear()
        o.parent = None
        o.data = meshes[o.name]
        if o.data != meshes[o.name]:
            raise RuntimeError(f"could not replace the mesh of {o.name!r} (mode {o.mode})")
        o.matrix_world = Matrix.Identity(4)
        mats = slots[o.name] or [None]
        faces = np.empty(len(o.data.polygons), dtype=np.int32)
        o.data.polygons.foreach_get("material_index", faces)
        o.data.materials.clear()  # Blender 5 drops every face's material index with the materials
        for m in mats:
            o.data.materials.append(m or _placeholder_material())
        o.data.polygons.foreach_set("material_index", np.minimum(faces, len(mats) - 1))
        for s in o.material_slots:
            s.link = "DATA"


def _move_to(objs, name):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
        o.hide_viewport = False
        o.hide_set(False)
    return col


def _action_end_frame(action):
    """Last keyframe of a Blender 5 layered action (layers > strips > channelbags > fcurves)."""
    last = None
    for layer in getattr(action, "layers", ()):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", ()):
                for fc in bag.fcurves:
                    for kp in fc.keyframe_points:
                        f = kp.co[0]
                        last = f if last is None else max(last, f)
    return last


def finished_frame(scene):
    """The frame at which every animation (build-up included) has finished."""
    frame = scene.frame_end
    for action in bpy.data.actions:
        end = _action_end_frame(action)
        if end is not None:
            frame = max(frame, int(math.ceil(end)))
    return frame


def _strip_animation(objs):
    for o in objs:
        if o.animation_data is not None:
            o.animation_data_clear()


def prepare_scene(scene, view_layer):
    """Returns (kept meshes, names of lights that are on in the current render)."""
    scene.frame_set(finished_frame(scene))  # bake the finished apartment, not a build-up mid-way
    visible = visible_collections(view_layer)
    lights = [o for o in scene.objects if o.type == "LIGHT"]
    day_lights = sorted(o.name for o in lights if is_render_visible(o, visible))
    outside = surrounding_collections()  # exported on their own, see surroundings.py
    keep = [
        o for o in scene.objects
        if o.type == "MESH" and o.name not in config.DROP_OBJECT_NAMES
        and not any(c in outside for c in o.users_collection)
        and (is_render_visible(o, visible) or _forced(o))
    ]
    keep_set = set(keep)
    leave_edit_modes(view_layer)
    realize(keep)  # before deleting: a dropped mesh may be the parent of a kept one
    for o in [o for o in scene.objects if o.type == "MESH" and o not in keep_set]:
        bpy.data.objects.remove(o, do_unlink=True)
    _strip_animation(keep)  # a joined chunk would inherit the action and export it as its rest scale
    _strip_animation(lights)
    _move_to(keep, "WEB")
    for o in keep:
        o.hide_render = False  # a joined chunk inherits the active object's flags
    _move_to(lights, "WEB_LIGHTS")
    for o in lights:
        o.hide_render = o.name not in day_lights
    view_layer.update()
    return keep, day_lights
