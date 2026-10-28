"""Small things on surfaces (`web_prop = "<what the viewer calls it>"`): visitors pick them up, put them down and throw
them. Each becomes its own node (Prop_<slug>) with its origin at the middle of its base, so the viewer can stand it on
any surface. Props are never baked (they move; the viewer lights them live) and never block the way (they're small).
`web_tips` (bool) overrides the guess from its shape of whether it falls over when knocked."""
import bpy
from mathutils import Matrix, Vector

from . import bpyutil, config, geom


def find(meshes):
    """The meshes tagged web_prop."""
    return [o for o in meshes if o.get(config.PROP_PROP)]


def prepare_props(objs, floor_index):
    """Re-origin each prop at the middle of its base, rename it Prop_<slug>, hide it from the bake, and return its
    spec: the node, what it's called, its room (or None), its three.js box size and whether it tips over."""
    specs = []
    for o in sorted(objs, key=lambda o: o.name):
        co = bpyutil.world_coords(o)
        lo, hi = co.min(0), co.max(0)
        base = Vector(geom.base_centre(lo, hi))
        k = int(floor_index.locate_many([geom.to_three_xz(base.x, base.y)], config.LAMP_ROOM_MAX_DIST)[0])
        size = geom.box_size_three(lo, hi)
        spec = {"source": o.name, "node": f"Prop_{geom.slugify(o.name)}", "name": str(o[config.PROP_PROP]),
                "room": floor_index.ids[k] if k >= 0 else None, "size": size,
                "tips": bool(o[config.TIPS_PROP]) if config.TIPS_PROP in o else geom.tips(size)}
        if any(s["node"] == spec["node"] for s in specs):
            raise RuntimeError(f"{o.name}: another prop's node is also {spec['node']}; rename one")
        o.data.transform(Matrix.Translation(-base))  # the mesh is in world space (scene_select realizes it)
        o.location = base
        o.name = spec["node"]
        o.hide_render = True
        specs.append(spec)
    bpy.context.view_layer.update()  # matrix_world follows the new origins
    return specs
