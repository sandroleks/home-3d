"""The neighbourhood seen through the windows, exported apart from the apartment as surroundings.glb.

It is kilometre-scale, so it skips chunking, collision and lightmaps. Each object goes out as it is, with its
normals: the viewer lights it live with the same sun and sky as the apartment (see web/src/surroundings.ts).
"""

import os

import bpy

from . import export, proc_materials, scene_select

FILE = "surroundings.glb"


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
        os.makedirs(out_dir, exist_ok=True)
        export.export_glb(copies, path, export_vertex_color="NONE")
    finally:
        for c in copies:
            me = c.data
            bpy.data.objects.remove(c, do_unlink=True)
            if me.users == 0:
                bpy.data.meshes.remove(me)
        bpy.data.collections.remove(col)
    print(f"[surroundings] {len(sources)} objects -> {FILE}", flush=True)
    return sorted(o.name for o in sources)
