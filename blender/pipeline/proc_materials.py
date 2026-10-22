"""Bake procedural base colours to per-object image textures that glTF can carry."""
import math

import bpy
import numpy as np

from . import bpyutil, geom, raster

PROCEDURAL_NODE_TYPES = {
    "TEX_NOISE", "TEX_VORONOI", "TEX_WAVE", "TEX_BRICK", "TEX_CHECKER",
    "TEX_MAGIC", "TEX_GRADIENT", "TEX_WHITE_NOISE", "TEX_MUSGRAVE",
}
BAKE_NODE = "WEB_ALBEDO_TARGET"


def is_procedural(mat):
    return bool(mat and mat.node_tree and any(n.type in PROCEDURAL_NODE_TYPES for n in mat.node_tree.nodes))


def _dummy_image():
    img = bpy.data.images.get("web_bake_dummy")
    return img or bpy.data.images.new("web_bake_dummy", 8, 8)


def _rewire_to_image(mat, img):
    nt = mat.node_tree
    old = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    keep = {k: old.inputs[k].default_value for k in ("Roughness", "Metallic")}
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.name = "Image Texture"
    tex.image = img
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    for k, v in keep.items():
        bsdf.inputs[k].default_value = v


def _bake_object(obj, quality):
    me = obj.data
    proc_slots = [i for i, s in enumerate(obj.material_slots) if is_procedural(s.material)]
    mask = np.isin(bpyutil.polygon_ints(me, "material_index"), proc_slots)
    area = float(bpyutil.polygon_scalars(me, "area")[mask].sum())
    size = raster.texture_size_for_area(area, quality.albedo_texels_per_m, 64, quality.albedo_max)

    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    me.uv_layers.active = uv
    bpyutil.select_only([obj], obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpyutil.select_faces_in_edit(obj, mask)
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), margin_method="FRACTION",
                             island_margin=4 / size, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    img = bpy.data.images.new(f"albedo_{geom.slugify(obj.name)}", size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    copies = {}
    for i, slot in enumerate(obj.material_slots):
        if i in proc_slots:
            copies[i] = slot.material.copy()
            copies[i].name = f"{slot.material.name} [{obj.name}]"
            slot.material = copies[i]
        node = slot.material.node_tree.nodes.new("ShaderNodeTexImage")
        node.name = BAKE_NODE
        node.image = img if i in proc_slots else _dummy_image()
        slot.material.node_tree.nodes.active = node

    bpyutil.select_only([obj], obj)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=4, margin_type="EXTEND",
                        use_clear=True, uv_layer="UVMap", target="IMAGE_TEXTURES")

    for slot in obj.material_slots:
        nodes = slot.material.node_tree.nodes
        if BAKE_NODE in nodes:
            nodes.remove(nodes[BAKE_NODE])
    img.pack()
    for mat in copies.values():
        _rewire_to_image(mat, img)


def bake_procedural_albedo(meshes, quality):
    bpyutil.set_cycles(bpy.context.scene, 4)
    baked = []
    for obj in sorted(meshes, key=lambda o: o.name):
        if any(is_procedural(s.material) for s in obj.material_slots):
            _bake_object(obj, quality)
            baked.append(obj.name)
            print(f"[albedo] {obj.name}", flush=True)
    return baked
