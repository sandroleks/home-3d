"""Second UV map for baked lighting."""
import math

import bpy
import numpy as np

from . import bpyutil, raster


def uv_area(me, layer):
    """Total area of the faces in a UV layer (1 covers the whole texture)."""
    uv = np.empty(len(me.uv_layers[layer].data) * 2, dtype=np.float64)
    me.uv_layers[layer].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    starts = np.empty(len(me.polygons), dtype=np.int64)
    counts = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_start", starts)
    me.polygons.foreach_get("loop_total", counts)
    nxt = np.arange(len(uv)) + 1
    nxt[starts + counts - 1] = starts  # each polygon's last loop wraps to its first
    cross = uv[:, 0] * uv[nxt, 1] - uv[nxt, 0] * uv[:, 1]
    per_poly = np.add.reduceat(cross, starts) if len(starts) else np.zeros(0)
    return float(np.abs(per_poly).sum() / 2)


def add_lightmap_uvs(obj, texels_per_m, lo, hi, margin_px=2):
    me = obj.data
    if len(me.uv_layers) == 0:
        me.uv_layers.new(name="UVMap")
    if me.uv_layers[0].name != "UVMap":
        raise RuntimeError(f"{obj.name}: first UV map is {me.uv_layers[0].name!r}, expected 'UVMap'")
    if "UVLightmap" in me.uv_layers:
        me.uv_layers.remove(me.uv_layers["UVLightmap"])
    lm = me.uv_layers.new(name="UVLightmap")
    me.uv_layers.active = lm
    me.uv_layers["UVMap"].active_render = True
    area = float(bpyutil.polygon_scalars(me, "area").sum())
    size = raster.texture_size_for_area(area, texels_per_m, lo, hi)
    bpyutil.select_only([obj], obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), margin_method="FRACTION",
                             island_margin=margin_px / size, area_weight=1.0, correct_aspect=True,
                             scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    if uv_area(me, "UVLightmap") < 1e-4:
        raise RuntimeError(f"{obj.name}: its lightmap UVs collapsed ({len(me.polygons)} faces in {size} px); "
                           "the island margins leave no room")
    return size
