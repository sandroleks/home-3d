"""Small bpy helpers used across stages."""
import os

import bmesh
import bpy
import numpy as np


def basis(x, y, z):
    """The 3x3 matrix whose columns are x, y and z."""
    from mathutils import Matrix
    return Matrix((x, y, z)).transposed()


def select_only(objs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def world_coords(obj):
    me = obj.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    m = np.array(obj.matrix_world, dtype=np.float64)
    return co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]


def polygon_vectors(me, attr):
    a = np.empty(len(me.polygons) * 3, dtype=np.float64)
    me.polygons.foreach_get(attr, a)
    return a.reshape(-1, 3)


def polygon_scalars(me, attr):
    a = np.empty(len(me.polygons), dtype=np.float64)
    me.polygons.foreach_get(attr, a)
    return a


def polygon_ints(me, attr):
    a = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get(attr, a)
    return a


def set_cycles(scene, samples):
    """Switch to Cycles on the best available GPU (WEB_BAKE_DEVICE=CPU forces the CPU). Returns the device type."""
    try:
        scene.render.engine = "CYCLES"
    except TypeError as e:
        raise RuntimeError(f"Cycles is not available: {e}") from e
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    prefs = bpy.context.preferences.addons["cycles"].preferences
    kinds = () if os.environ.get("WEB_BAKE_DEVICE", "").upper() == "CPU" else ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI")
    for kind in kinds:
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        (getattr(prefs, "refresh_devices", None) or prefs.get_devices)()
        if any(d.type == kind for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = "GPU"
            return kind
    scene.cycles.device = "CPU"
    return "CPU"


def select_faces_in_edit(obj, mask):
    """In edit mode: select exactly the faces whose index is True in mask."""
    bpy.ops.mesh.select_all(action="DESELECT")
    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        if mask[f.index]:
            f.select_set(True)
    bmesh.update_edit_mesh(obj.data)


def join(objs, name):
    select_only(objs, objs[0])
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


def split_by_face_values(obj, values, name_for):
    """Separate obj into one object per distinct per-face value. Returns {value: object}."""
    attr = obj.data.attributes.new("split_key", "INT", "FACE")
    attr.data.foreach_set("value", np.asarray(values, dtype=np.int32))
    keys = sorted(set(int(v) for v in values))
    result = {}
    for v in keys[:-1]:
        select_only([obj], obj)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bm = bmesh.from_edit_mesh(obj.data)
        layer = bm.faces.layers.int["split_key"]
        for f in bm.faces:
            if f[layer] == v:
                f.select_set(True)
        bmesh.update_edit_mesh(obj.data)
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        new = next(o for o in bpy.context.selected_objects if o != obj)
        new.name = name_for(v)
        result[v] = new
    obj.name = name_for(keys[-1])
    result[keys[-1]] = obj
    return result
