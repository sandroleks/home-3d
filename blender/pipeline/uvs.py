"""Second UV map for baked lighting."""
import math

import bpy

from . import bpyutil, raster


def add_lightmap_uvs(obj, texels_per_m, lo, hi):
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
                             island_margin=8 / size, area_weight=1.0, correct_aspect=True,
                             scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    return size
