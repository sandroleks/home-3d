"""Bake procedural base colours to per-object image textures that glTF can carry, with a normal map where the
material has relief (a Bump or Normal Map into the BSDF). A material many objects share (config.SHARED_TILES) gets one
seamless tile instead, box-projected at its real size; a small object's patch, a flat colour."""
import math

import bpy
import numpy as np

from . import bpyutil, config, geom, raster, tiles

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


def has_relief(mat):
    """Whether the material's surface has modelled relief: something drives its BSDF's Normal."""
    if not (mat and mat.node_tree):
        return False
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    return bool(bsdf and bsdf.inputs["Normal"].is_linked)


def _rewire_to_image(mat, img, normal=None, colour=None):
    """The material becomes a plain Principled BSDF: base colour from img (or the flat colour), normal from the normal
    map image if any; roughness and metallic kept."""
    nt = mat.node_tree
    old = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if old is None:
        raise RuntimeError(f"{mat.name}: no Principled BSDF to take roughness/metallic from")
    keep = {k: old.inputs[k].default_value for k in ("Roughness", "Metallic")}
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    if img is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.name = "Image Texture"
        tex.image = img
        nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    if normal is not None:
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.name = "Normal Texture"
        ntex.image = normal
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.space = "TANGENT"
        nmap.uv_map = "UVMap"
        nt.links.new(uv.outputs["UV"], ntex.inputs["Vector"])
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    for k, v in keep.items():
        bsdf.inputs[k].default_value = v


def _image_from(rgb, name, colour):
    """A packed bpy image from (h, w, 3) floats in 0..1, rows bottom to top; colour: sRGB data (base colour) or not."""
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    if colour:  # a byte image's pixels are its stored values: sRGB-encoded for a colour image
        rgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(np.clip(rgb, 0, None), 1 / 2.4) - 0.055)
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((h, w, 1))], -1).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def _bake_target(obj, slots, img):
    """Point each slot's bake node at img (other slots at the dummy), creating the nodes. Returns nothing."""
    for i, slot in enumerate(obj.material_slots):
        if slot.material is None or slot.material.node_tree is None:
            continue
        nodes = slot.material.node_tree.nodes
        node = nodes.get(BAKE_NODE) or nodes.new("ShaderNodeTexImage")
        node.name = BAKE_NODE
        node.image = img if i in slots else _dummy_image()
        nodes.active = node


def _remove_bake_nodes(obj):
    for slot in obj.material_slots:
        if slot.material is None or slot.material.node_tree is None:
            continue
        nodes = slot.material.node_tree.nodes
        if BAKE_NODE in nodes:
            nodes.remove(nodes[BAKE_NODE])


_MEANS = {}


def material_mean(mat):
    """The procedural material's average base colour (linear), baked once on a unit plane."""
    if mat.name in _MEANS:
        return _MEANS[mat.name]
    me = bpy.data.meshes.new("WEB_MEAN_PLANE")
    me.from_pydata([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    uv.data.foreach_set("uv", [0, 0, 1, 0, 1, 1, 0, 1])
    obj = bpy.data.objects.new("WEB_MEAN_PLANE", me)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    img = bpy.data.images.new("web_mean", 64, 64, alpha=False, float_buffer=True)  # linear, as the BSDF takes it
    try:
        _bake_target(obj, {0}, img)
        bpyutil.select_only([obj], obj)
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=0, use_clear=True, uv_layer="UVMap",
                            target="IMAGE_TEXTURES")
        px = np.empty(64 * 64 * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        mean = tuple(float(v) for v in px.reshape(-1, 4)[:, :3].mean(0))
    finally:
        _remove_bake_nodes(obj)
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(me)
        bpy.data.images.remove(img)
    _MEANS[mat.name] = mean
    return mean


def _shared_tile(name, spec, quality):
    """The tile's base colour and normal map images for material `name`, coloured like it."""
    mat = bpy.data.materials[name]
    px = min(spec["px"], quality.albedo_max)
    if spec["kind"] != "wood":
        raise RuntimeError(f"SHARED_TILES[{name!r}]: no tile of kind {spec['kind']!r}")
    height = tiles.wood_height(px)  # rows taken bottom to top, as bpy stores them
    rgb = tiles.colourise(height, material_mean(mat), spec["contrast"])
    normal = tiles.normal_from_height(height, spec["relief"])
    slug = geom.slugify(name)
    return _image_from(rgb, f"tile_{slug}", True), _image_from(normal, f"tile_{slug}_normal", False)


def _box_project(obj, mat_index, tile_m):
    """UVMap on the faces with that material: tiles.box_uvs in the object's own axes, at its real size."""
    me = obj.data
    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    loops = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loops)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    data = np.empty(len(me.loops) * 2)
    uv.data.foreach_get("uv", data)
    data = data.reshape(-1, 2)
    scale = np.abs(np.array(obj.matrix_world.to_scale()))
    for p in me.polygons:
        if p.material_index != mat_index:
            continue
        idx = np.arange(p.loop_start, p.loop_start + p.loop_total)
        data[idx] = np.nan  # filled below, all faces at once so the shift is shared
    sel = np.isnan(data[:, 0])
    if not sel.any():
        return
    normals = np.repeat(np.array([p.normal for p in me.polygons]), [p.loop_total for p in me.polygons], axis=0)
    data[sel] = tiles.box_uvs(co[loops[sel]], normals[sel], scale, tile_m)
    uv.data.foreach_set("uv", data.ravel())


def apply_shared_tiles(meshes, quality):
    """Materials in config.SHARED_TILES: one tile each instead of a bake per object. Returns the materials done."""
    done = []
    for name, spec in config.SHARED_TILES.items():
        mat = bpy.data.materials.get(name)
        if mat is None or not is_procedural(mat):
            continue
        users = [(o, i) for o in meshes for i, s in enumerate(o.material_slots) if s.material == mat]
        if not users:
            continue
        img, normal = _shared_tile(name, spec, quality)
        for obj, i in users:
            _box_project(obj, i, spec["tile_m"])
        _rewire_to_image(mat, img, normal)
        done.append(name)
        print(f"[albedo] {name}: one {img.size[0]}px tile for {len(users)} objects", flush=True)
    return done


def _bake_object(obj, quality, flat):
    """flat: {material name: its flat copy} for small patches of each material, filled as needed."""
    me = obj.data
    proc_slots = [i for i, s in enumerate(obj.material_slots) if is_procedural(s.material)]
    mask = np.isin(bpyutil.polygon_ints(me, "material_index"), proc_slots)
    area = float(bpyutil.polygon_scalars(me, "area")[mask].sum())
    size = raster.texture_size_for_area(area, quality.albedo_texels_per_m, 64, quality.albedo_max)
    relief = any(has_relief(obj.material_slots[i].material) for i in proc_slots)
    if area <= config.FLAT_ALBEDO_MAX_AREA and not relief:
        # A few square centimetres: the pattern can't be seen, a texture of its own costs a material and a draw call.
        for i in proc_slots:
            src = obj.material_slots[i].material
            if src.name not in flat:
                flat[src.name] = src.copy()
                flat[src.name].name = f"{src.name} (flat)"
                _rewire_to_image(flat[src.name], None, colour=material_mean(src))
            obj.material_slots[i].material = flat[src.name]
        return "flat"

    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    me.uv_layers.active = uv
    bpyutil.select_only([obj], obj)
    try:
        bpy.ops.object.mode_set(mode="EDIT")
        bpyutil.select_faces_in_edit(obj, mask)
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), margin_method="FRACTION",
                                 island_margin=4 / size, scale_to_bounds=False)
    finally:
        if obj.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")

    img = bpy.data.images.new(f"albedo_{geom.slugify(obj.name)}", size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    normal = None
    copies = {}
    for i in proc_slots:
        slot = obj.material_slots[i]
        copies[i] = slot.material.copy()
        copies[i].name = f"{slot.material.name} [{obj.name}]"
        slot.material = copies[i]
    try:
        _bake_target(obj, set(proc_slots), img)
        bpyutil.select_only([obj], obj)
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=4, margin_type="EXTEND",
                            use_clear=True, uv_layer="UVMap", target="IMAGE_TEXTURES")
        if relief:
            nsize = min(size, config.NORMAL_MAP_MAX_PX)
            normal = bpy.data.images.new(f"normal_{geom.slugify(obj.name)}", nsize, nsize, alpha=False)
            normal.colorspace_settings.name = "Non-Color"
            _bake_target(obj, set(proc_slots), normal)
            bpy.context.scene.render.bake.normal_space = "TANGENT"
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=4, margin_type="EXTEND",
                                use_clear=True, uv_layer="UVMap", target="IMAGE_TEXTURES")
    finally:
        _remove_bake_nodes(obj)
    img.pack()
    if normal is not None:
        normal.pack()
    for mat in copies.values():
        _rewire_to_image(mat, img, normal if has_relief(mat) else None)
    return "normal" if normal is not None else "baked"


def bake_procedural_albedo(meshes, quality):
    bpyutil.set_cycles(bpy.context.scene, 4)
    apply_shared_tiles(meshes, quality)
    baked = []
    flat = {}
    counts = {}
    for obj in sorted(meshes, key=lambda o: o.name):
        if any(is_procedural(s.material) for s in obj.material_slots):
            how = _bake_object(obj, quality, flat)
            counts[how] = counts.get(how, 0) + 1
            baked.append(obj.name)
            print(f"[albedo] {obj.name}: {how}", flush=True)
    print(f"[albedo] {counts.get('baked', 0)} baked, {counts.get('normal', 0)} with normal maps, "
          f"{counts.get('flat', 0)} flat", flush=True)
    return baked
