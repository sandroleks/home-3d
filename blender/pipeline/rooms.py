"""Rooms come from the 'Floor - <room>' meshes."""
import numpy as np

from . import geom

PREFIX = "Floor - "


def floor_triangles(obj):
    """Upward-facing triangles of a realized floor mesh, flat [x0, z0, ...] in three.js space."""
    me = obj.data
    me.calc_loop_triangles()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
    me.loop_triangles.foreach_get("vertices", tri)
    normals = np.empty(len(me.loop_triangles) * 3)
    me.loop_triangles.foreach_get("normal", normals)
    up = normals.reshape(-1, 3)[:, 2] > 0.5
    pts = co[tri.reshape(-1, 3)][up][:, :, :2]
    three = np.stack([pts[..., 0], -pts[..., 1]], axis=-1)
    return [round(float(v), 4) for v in three.reshape(-1)]


def collect_rooms(meshes, scene):
    floors = sorted((o for o in meshes if o.name.startswith(PREFIX)), key=lambda o: o.name)
    light_names = {o.name for o in scene.objects if o.type == "LIGHT"}
    room_list = []
    for f in floors:
        name = f.name[len(PREFIX):]
        light = f"Ceiling light {name}"
        room_list.append({
            "id": geom.slugify(name),
            "name": name,
            "floor": floor_triangles(f),
            "light": light if light in light_names else None,
        })
    index = geom.FloorIndex({r["id"]: r["floor"] for r in room_list})
    return index, room_list
