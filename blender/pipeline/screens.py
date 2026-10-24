"""Screens (`web_screen = "tv" | "monitor" | "laptop"`): their own nodes with planar UVs, u to the viewer's right and
v up, so the viewer can show a picture on them. The light a screen casts is baked: an area light over the screen
(SCREEN_LIGHT_WATTS, a white picture) in the screen's lamp group, which the viewer scales and tints by the picture."""
import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import bpyutil, config, geom

PROBE = 0.5  # m in front of the screen: this point is in the screen's room


def find(meshes):
    return [o for o in meshes if o.get(config.SCREEN_PROP)]


def prepare_screens(objs, floor_index):
    """Specs in three.js space ("group" is filled in once the light groups are known), with the Blender centre and
    normal under "blender" for add_lights."""
    specs = []
    for o in sorted(objs, key=lambda o: o.name):
        kind = str(o[config.SCREEN_PROP])
        co = bpyutil.world_coords(o)
        c = (co.min(0) + co.max(0)) / 2
        w, v = np.linalg.eigh(np.cov((co - c).T))
        n = v[:, int(np.argmin(w))]  # the thin axis
        room = floor_index.locate(*geom.to_three_xz(*(c[:2] + n[:2] * PROBE)))
        back = floor_index.locate(*geom.to_three_xz(*(c[:2] - n[:2] * PROBE)))
        if room is None and back is not None:
            n, room = -n, back
        if room is None:
            raise RuntimeError(f"{o.name}: no room in front of the screen")
        forward = -n
        right = np.cross(forward, (0.0, 0.0, 1.0))
        right /= np.linalg.norm(right)
        up = np.cross(right, forward)
        pu, pv = (co - c) @ right, (co - c) @ up
        width, height = float(pu.max() - pu.min()), float(pv.max() - pv.min())
        me = o.data
        if len(me.uv_layers) == 0:
            me.uv_layers.new(name="UVMap")
        uv = me.uv_layers[0].data
        loops = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get("vertex_index", loops)
        p = co[loops] - c
        uvs = np.stack([(p @ right) / width + 0.5, (p @ up) / height + 0.5], axis=1)
        uv.foreach_set("uv", uvs.ravel())
        name = f"Screen_{room}-{geom.slugify(kind)}"
        o.name = name
        specs.append({
            "node": name, "room": room, "kind": kind, "group": None,
            "center": [round(x, 4) + 0.0 for x in geom.to_three(tuple(c))],
            "normal": [round(x, 4) + 0.0 for x in geom.to_three(tuple(n))],
            "width": round(width, 4), "height": round(height, 4),
            "blender": {"center": [float(x) for x in c], "normal": [float(x) for x in n], "up": [float(x) for x in up]},
        })
    return specs


def add_lights(specs, collection):
    """An area light just in front of each screen that lights its room, in lamp group `<kind>`. Returns their names."""
    names = []
    for s in specs:
        watts = config.SCREEN_LIGHT_WATTS.get(s["kind"], 0)
        if watts <= 0:
            continue
        data = bpy.data.lights.new(f"Screen light {s['node']}", "AREA")
        data.shape = "RECTANGLE"
        data.size, data.size_y = s["width"], s["height"]
        data.energy = watts
        data.use_temperature = True
        data.temperature = 6500
        obj = bpy.data.objects.new(data.name, data)
        n, up = Vector(s["blender"]["normal"]), Vector(s["blender"]["up"])
        # An area light shines down its local -Z; its local Y runs up the screen.
        obj.matrix_world = Matrix.Translation(Vector(s["blender"]["center"]) + n * 0.01) @ bpyutil.basis(
            up.cross(-n), up, -n).to_4x4()
        obj[config.LAMP_PROP] = s["kind"]
        collection.objects.link(obj)
        names.append(obj.name)
    bpy.context.view_layer.update()
    return names


def set_groups(specs, group_ids):
    for s in specs:
        group = f"{s['room']}/{geom.slugify(s['kind'])}"
        s["group"] = group if group in group_ids else None
