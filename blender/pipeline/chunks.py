"""Merge all static geometry, then split it into one chunk per room (+ exterior)."""
import bmesh
import numpy as np

from . import bpyutil, config


def dice_large_faces(obj, cell, max_area):
    """Cut a mesh on a vertical-plane grid so no face spans more than one room. Returns True if cut."""
    me = obj.data
    if len(me.polygons) == 0 or bpyutil.polygon_scalars(me, "area").max() <= max_area:
        return False
    co = bpyutil.world_coords(obj)
    bm = bmesh.new()
    bm.from_mesh(me)
    for axis in (0, 1):
        normal = (1.0, 0.0, 0.0) if axis == 0 else (0.0, 1.0, 0.0)
        for v in np.arange(co[:, axis].min() + cell, co[:, axis].max(), cell):
            point = [0.0, 0.0, 0.0]
            point[axis] = float(v)
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                                   plane_co=point, plane_no=normal)
    bm.to_mesh(me)
    bm.free()
    return True


def build_chunks(static_objs, floor_index):
    for obj in static_objs:
        dice_large_faces(obj, config.DICE_CELL, config.DICE_MAX_FACE_AREA)
    joined = bpyutil.join(list(static_objs), "ALL_STATIC")
    me = joined.data
    centre = bpyutil.polygon_vectors(me, "center")
    normal = bpyutil.polygon_vectors(me, "normal")
    probe = centre[:, :2] + normal[:, :2] * 0.05
    idx = floor_index.locate_many(np.stack([probe[:, 0], -probe[:, 1]], axis=1), config.ROOM_ASSIGN_MAX_DIST)
    keys = list(floor_index.ids) + ["exterior"]
    idx[idx < 0] = len(floor_index.ids)
    parts = bpyutil.split_by_face_values(joined, idx, lambda v: f"Room_{keys[v]}")
    return [
        {"node": obj.name, "room": keys[v] if v < len(floor_index.ids) else None, "key": keys[v]}
        for v, obj in sorted(parts.items())
    ]
