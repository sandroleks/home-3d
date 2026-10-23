"""The neighbourhood seen through the windows, exported apart from the apartment as surroundings.glb.

It is kilometre-scale, so it skips chunking, collision and lightmaps. Each object goes out as it is,
with the day's sun and sky worked out per corner into a colour attribute. Like the lightmaps' light
pass, that is outgoing radiance over albedo; the viewer multiplies it by the material colour, unlit.
glTF stores vertex colours as 0..1, so the shade goes out times SHADE_STORE_SCALE (the viewer's
CONFIG.surroundingsShadeScale undoes it).
"""
import os

import bpy
import numpy as np

from . import config, export, proc_materials, scene_select

FILE = "surroundings.glb"
SHADE = "Shade"
SHADE_STORE_SCALE = 0.5


def shade(normals, suns, sky):
    """Light pass for unit normals (Z up): Lambert for each (direction to the sun, strength), plus a
    sky that lights an upward face with `sky` irradiance, a wall with half, a downward face not at all."""
    n = np.asarray(normals, dtype=np.float64).reshape(-1, 3)
    e = sky * (1.0 + n[:, 2]) / 2.0
    for direction, strength in suns:
        e = e + strength * np.clip(n @ np.asarray(direction, dtype=np.float64), 0.0, None)
    return e / np.pi


def day_suns(scene, visible):
    """(unit direction to the sun, strength) of every render-visible sun lamp."""
    return [
        (tuple(o.matrix_world.to_3x3().normalized().col[2]), o.data.energy)
        for o in scene.objects
        if o.type == "LIGHT" and o.data.type == "SUN" and scene_select.is_render_visible(o, visible)
    ]


def _add_shade(obj, suns):
    me = obj.data
    n = np.empty(len(me.loops) * 3, dtype=np.float64)
    me.corner_normals.foreach_get("vector", n)
    s = shade(n, suns, config.SURROUNDINGS_SKY_IRRADIANCE)
    rgba = np.ones((len(s), 4), dtype=np.float32)
    rgba[:, :3] = np.minimum(s * SHADE_STORE_SCALE, 1.0)[:, None]
    attr = me.color_attributes.new(SHADE, "FLOAT_COLOR", "CORNER")
    attr.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = attr


def export_surroundings(scene, view_layer, quality, out_dir):
    """Write surroundings.glb from the render-visible meshes of the surroundings collections, or
    remove a stale one when there are none. Works on copies; returns the source object names."""
    path = os.path.join(out_dir, FILE)
    scene.frame_set(scene_select.finished_frame(scene))
    visible = scene_select.visible_collections(view_layer)
    cols = scene_select.surrounding_collections()
    sources = [
        o for o in scene.objects
        if o.type == "MESH" and any(c in cols for c in o.users_collection)
        and scene_select.is_render_visible(o, visible)
    ]
    if not sources:
        if os.path.exists(path):
            os.remove(path)
        return []

    scene_select.leave_edit_modes(view_layer)
    col = bpy.data.collections.new("WEB_SURROUNDINGS")
    scene.collection.children.link(col)
    copies = []
    for o in sources:
        c = o.copy()  # shares the mesh until realize() swaps in a world-space one
        col.objects.link(c)
        copies.append(c)
    try:
        scene_select.realize(copies)
        proc_materials.bake_procedural_albedo(copies, quality)
        suns = day_suns(scene, visible)
        for c in copies:
            _add_shade(c, suns)
        os.makedirs(out_dir, exist_ok=True)
        export.export_glb(copies, path, export_vertex_color="ACTIVE")
    finally:
        for c in copies:
            me = c.data
            bpy.data.objects.remove(c, do_unlink=True)
            if me.users == 0:
                bpy.data.meshes.remove(me)
        bpy.data.collections.remove(col)
    print(f"[surroundings] {len(sources)} objects -> {FILE}", flush=True)
    return sorted(o.name for o in sources)
