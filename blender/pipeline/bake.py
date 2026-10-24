"""Bake the sky-only daylight layer, each room's switch layer (both RGBM WebP) and the packed lamp layers: lamp groups,
open-plan neighbours and light spilling through open doors (see layers.py and packs.py)."""
import math
import os
import shutil
import tempfile

import bpy
import numpy as np

from . import bpyutil, config, lamps, movables, packs, raster
from . import layers as layers_mod

BAKE_NODE = "WEB_LIGHTMAP_TARGET"


def _emission_sockets():
    """(material name, strength socket, original strength) for everything that glows."""
    out = []
    for mat in bpy.data.materials:
        if mat.node_tree is None:
            continue
        for n in mat.node_tree.nodes:
            socket = None
            if n.type == "BSDF_PRINCIPLED":
                socket = n.inputs["Emission Strength"]
            elif n.type == "EMISSION":
                socket = n.inputs["Strength"]
            if socket is not None and socket.default_value > 0:
                out.append((mat.name, socket, socket.default_value))
    return out


def sky_irradiance(scene):
    """Irradiance the day layer's flat sky gives an upward face, in the scene's light units (pi x radiance)."""
    bg = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
    r, g, b = config.SKY_BAKE_COLOR
    return math.pi * bg.inputs["Strength"].default_value * (0.2126 * r + 0.7152 * g + 0.0722 * b)


class Lighting:
    """Switch the scene between the sky-only daylight bake and the lights of one or more groups."""

    def __init__(self, scene, group_lights, group_emitters):
        """group_lights: {group id: [names of the group's lights]};
        group_emitters: {group id: [names of the glowing materials it turns on]}."""
        self.group_lights = {k: set(v) for k, v in group_lights.items()}
        self.group_emitters = {k: set(v) for k, v in group_emitters.items()}
        self.lights = [o for o in scene.objects if o.type == "LIGHT"]
        self.saved_hide = {o.name: o.hide_render for o in self.lights}
        world = scene.world
        self.tree = world.node_tree if world is not None else None
        nodes = self.tree.nodes if self.tree is not None else []
        self.background = next((n for n in nodes if n.type == "BACKGROUND"), None)
        if self.background is None:
            raise RuntimeError("scene world has no Background node")
        self.color = self.background.inputs["Color"]
        self.saved_color = tuple(self.color.default_value)
        self.saved_sources = [l.from_socket for l in self.tree.links if l.to_socket == self.color]
        self.saved_strength = self.background.inputs["Strength"].default_value
        self.emitters = _emission_sockets()

    def _sky(self, on):
        for link in [l for l in self.tree.links if l.to_socket == self.color]:
            self.tree.links.remove(link)
        self.color.default_value = (*config.SKY_BAKE_COLOR, 1.0)
        self.background.inputs["Strength"].default_value = self.saved_strength if on else 0.0

    def _glow(self, names):
        for name, socket, value in self.emitters:
            socket.default_value = value if name in names else 0.0

    def day(self):
        for o in self.lights:
            o.hide_render = self.saved_hide[o.name] or not lamps.is_day_fill(o)
        self._sky(True)
        self._glow(set())

    def groups(self, group_ids):
        keep = set().union(*(self.group_lights[g] for g in group_ids))
        for o in self.lights:
            o.hide_render = o.name not in keep
        self._sky(False)
        self._glow(set().union(*(self.group_emitters.get(g, set()) for g in group_ids)))

    def group(self, group_id):
        self.groups([group_id])

    def restore(self):
        for o in self.lights:
            o.hide_render = self.saved_hide[o.name]
        self.background.inputs["Strength"].default_value = self.saved_strength
        self.color.default_value = self.saved_color
        for src in self.saved_sources:
            self.tree.links.new(src, self.color)
        self._glow({name for name, _, _ in self.emitters})


def _target_node(mat):
    node = mat.node_tree.nodes.get(BAKE_NODE)
    if node is None:
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.name = BAKE_NODE
    return node


def bake_lighting(obj, size, name):
    """Bake the diffuse light on obj into a new size x size float image (lightmap UVs)."""
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    for slot in obj.material_slots:
        if slot.material is None:
            continue
        node = _target_node(slot.material)
        node.image = img
        slot.material.node_tree.nodes.active = node
    bpyutil.select_only([obj], obj)
    try:
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=4,
                            margin_type="EXTEND", use_clear=True, uv_layer="UVLightmap",
                            target="IMAGE_TEXTURES")
    except BaseException:
        remove_bake_nodes()
        bpy.data.images.remove(img)
        raise
    return img


def denoise(img):
    """Run OpenImageDenoise over a float bake in place (Cycles never denoises bakes); alpha is kept.

    The compositor is the only way to reach OIDN from Python, so a throwaway scene composites the
    image through a Denoise node and renders it to a temporary EXR.
    """
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    scene = bpy.data.scenes.new("web_denoise")
    tree = bpy.data.node_groups.new("web_denoise", "CompositorNodeTree")
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "denoised.exr")
    result = None
    try:
        scene.render.engine = "BLENDER_WORKBENCH"  # the scene is empty; only the compositor does work
        scene.render.resolution_x, scene.render.resolution_y = w, h
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_depth = "32"
        scene.render.filepath = path
        if hasattr(scene.render, "compositor_denoise_final_quality"):
            scene.render.compositor_denoise_final_quality = "HIGH"
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        src = tree.nodes.new("CompositorNodeImage")
        src.image = img
        node = tree.nodes.new("CompositorNodeDenoise")
        out = tree.nodes.new("NodeGroupOutput")
        tree.links.new(src.outputs["Image"], node.inputs["Image"])
        tree.links.new(node.outputs["Image"], out.inputs[0])
        scene.compositing_node_group = tree
        scene.render.use_compositing = True
        with bpy.context.temp_override(scene=scene):
            bpy.ops.render.render(write_still=True, scene=scene.name)
        result = bpy.data.images.load(path)
        result.colorspace_settings.name = "Non-Color"
        den = np.empty(w * h * 4, dtype=np.float32)
        result.pixels.foreach_get(den)
        px[..., :3] = den.reshape(h, w, 4)[..., :3]
        img.pixels.foreach_set(px.ravel())
    finally:
        if result is not None:
            bpy.data.images.remove(result)
        bpy.data.scenes.remove(scene)
        bpy.data.node_groups.remove(tree)
        shutil.rmtree(tmp, ignore_errors=True)
    return img


def pixels(img):
    """(h, w, 4) float32 array of an image's pixels, bottom row first."""
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def bake_array(obj, size, name):
    """Bake, denoise and read back: (h, w, 4) float32, alpha marking the texels the UVs cover."""
    img = denoise(bake_lighting(obj, size, name))
    px = pixels(img)
    bpy.data.images.remove(img)
    return px


def save_rgba(rgba, path, name):
    h, w = rgba.shape[:2]
    out = bpy.data.images.new(name, w, h, alpha=True, float_buffer=False)
    out.colorspace_settings.name = "Non-Color"
    out.alpha_mode = "STRAIGHT"
    out.pixels.foreach_set(np.ascontiguousarray(rgba, dtype=np.float32).ravel())
    out.file_format = "WEBP"
    out.save(filepath=path, quality=100)  # quality 100 = lossless WebP
    bpy.data.images.remove(out)


def encode_and_save(px, path, blur_sigma):
    """RGBM-encode a baked (h, w, 4) array to a lossless WebP; returns its range."""
    mask = px[..., 3] > 0.5
    rgb = raster.masked_blur(px[..., :3], mask, blur_sigma)
    rgba, rng = raster.rgbm_encode(rgb, mask)
    save_rgba(rgba, path, os.path.basename(path))
    return rng


def remove_bake_nodes():
    for mat in bpy.data.materials:
        if mat.node_tree and BAKE_NODE in mat.node_tree.nodes:
            mat.node_tree.nodes.remove(mat.node_tree.nodes[BAKE_NODE])


class Surfaces:
    """Everything that gets lightmaps: room chunks, door leaves and each room's set of movables (one atlas)."""

    def __init__(self, state, quality):
        self.state, self.quality = state, quality
        self.movable_objs = {m["node"]: bpy.data.objects[m["node"]] for m in state["movables"]}
        self.sets = {}
        for m in state["movables"]:
            self.sets.setdefault(f"movables-{m['room']}", []).append(m)

    def keys(self):
        return [c["key"] for c in self.state["chunks"]] + [d["key"] for d in self.state["doors"]] + list(self.sets)

    def size(self, key, packed):
        for c in self.state["chunks"]:
            if c["key"] == key:
                return max(32, int(c["size"] * self.quality.pack_scale)) if packed else c["size"]
        if key in self.sets:
            return self.state["movable_atlas"][key]["size"]
        return self.state["door_lightmap_size"]

    def bake(self, key, size, name):
        if key not in self.sets:
            node = next(x["node"] for x in self.state["chunks"] + self.state["doors"] if x["key"] == key)
            return bake_array(bpy.data.objects[node], size, name)
        atlas = self.state["movable_atlas"][key]
        out = np.zeros((size, size, 4), dtype=np.float32)
        specs = self.sets[key]
        for k, group in enumerate(atlas["passes"]):
            members = [specs[i] for i in group]
            temp = movables.posed_copy([self.movable_objs[m["node"]] for m in members], members, f"WEB_PASS_{key}")
            try:
                px = bake_array(temp, size, f"{name}_pass{k}")
            finally:
                movables.remove(temp)
            for i in group:
                x0, y0, x1, y1 = movables.tile_rect(i, atlas["cols"], atlas["tile"])
                out[y0:y1, x0:x1] = px[y0:y1, x0:x1]
        return out


def bake_all(scene, state, quality, out_dir):
    """Bake every layer the plan (state["layers"]) asks for. Returns {"rgbm": {name: range}, "packs": {surface key:
    [{file, layers: [{...layer, range, tint}]}]}}."""
    device = bpyutil.set_cycles(scene, quality.bake_samples)
    print(f"[bake] Cycles on {device}, {quality.bake_samples} samples", flush=True)
    os.makedirs(os.path.join(out_dir, "lightmaps"), exist_ok=True)
    plan = state["layers"]
    groups = {g["id"]: g for g in state["groups"]}
    lighting = Lighting(scene, {g: v["lights"] for g, v in groups.items()}, state["group_emitters"])
    surfaces = Surfaces(state, quality)
    hidden = {n: o.hide_render for n, o in surfaces.movable_objs.items()}
    for o in surfaces.movable_objs.values():  # the hollow carcasses bake lit and unshaded; movables bake on their own
        o.hide_render = True
    leaves = {d["node"]: d for d in state["doors"]}
    rgbm, layers = {}, {}
    tmp = tempfile.mkdtemp()

    def rgbm_layer(key, layer):
        size = surfaces.size(key, packed=False)
        px = surfaces.bake(key, size, f"lm_{key}_{layer}")
        path = os.path.join(out_dir, "lightmaps", f"{key}_{layer}.webp")
        rgbm[f"{key}_{layer}"] = encode_and_save(px, path, quality.blur_sigma_px)
        print(f"[bake] {key}_{layer} {size}px range {rgbm[f'{key}_{layer}']}", flush=True)

    def packed_layer(key, layer):
        name = f"{key}_{len(layers.setdefault(key, []))}"
        px = surfaces.bake(key, surfaces.size(key, packed=True), f"lm_{name}")
        path = os.path.join(tmp, f"{name}.npy")
        np.save(path, px.astype(np.float16))
        layers[key].append((layer, path))
        print(f"[bake] {key} packed {layer} {px.shape[0]}px", flush=True)

    try:
        lighting.day()
        for key in surfaces.keys():
            rgbm_layer(key, "day")
        for gid in groups:
            lighting.group(gid)
            for key in surfaces.keys():
                if plan.get(key, {}).get("light") == gid:
                    rgbm_layer(key, "light")
                for layer in plan.get(key, {}).get("packed", []):
                    if layer.get("group") == gid:
                        packed_layer(key, layer)
        for spill in [s for s in {layers_mod.spill_key(l["spill"]): l["spill"] for p in plan.values()
                                  for l in p["packed"] if "spill" in l}.values()]:
            lighting.groups([g for g, v in groups.items() if v["room"] == spill["from"]])
            opened = [bpy.data.objects[n] for n, d in leaves.items() if d["opening"] == spill["opening"]]
            for o in opened:
                o.rotation_euler.z = leaves[o.name]["openAngle"]  # three.js Y is Blender Z
            bpy.context.view_layer.update()
            try:
                for key in surfaces.keys():
                    for layer in plan.get(key, {}).get("packed", []):
                        if layer.get("spill") == spill:
                            packed_layer(key, layer)
            finally:
                for o in opened:
                    o.rotation_euler.z = 0.0
                bpy.context.view_layer.update()
    finally:
        lighting.restore()
        remove_bake_nodes()
        for n, o in surfaces.movable_objs.items():
            o.hide_render = hidden[n]
    packed = {key: write_packs(key, entries, out_dir, quality.blur_sigma_px) for key, entries in layers.items()}
    shutil.rmtree(tmp, ignore_errors=True)
    return {"rgbm": rgbm, "packs": packed}


def write_packs(key, entries, out_dir, blur_sigma):
    """Blur, drop dark layers, pack three to a texture. entries: [(layer, path to its baked .npy)]."""
    kept = []
    mask = None
    for layer, path in entries:
        px = np.load(path).astype(np.float32)
        mask = px[..., 3] > 0.5 if mask is None else mask
        rgb = raster.masked_blur(px[..., :3], mask, blur_sigma)
        if packs.layer_meta(rgb, mask) is None:
            print(f"[bake] {key}: {layers_mod.layer_key(layer)} adds no light here; dropped", flush=True)
            continue
        kept.append((layer, rgb))
    out = []
    for k, four in enumerate(packs.in_packs(kept)):
        rgba, metas = packs.pack([rgb for _, rgb in four], mask)
        file = f"lightmaps/{key}_pack{k}.webp"
        save_rgba(rgba, os.path.join(out_dir, file), f"{key}_pack{k}")
        out.append({"file": file, "layers": [{**layer, "range": rng, "tint": tint}
                                             for (layer, _), (rng, tint) in zip(four, metas)]})
    return out
