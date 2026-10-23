"""Bake the sky-only daylight layer and each room's light layer, then save them as RGBM WebP."""
import math
import os
import shutil
import tempfile

import bpy
import numpy as np

from . import bpyutil, config, lamps, raster

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
    """Switch the scene between the sky-only daylight bake and one room's lights."""

    def __init__(self, scene, room_lights, room_emitters):
        """room_lights: {room id: [names of the lights the room's switch turns on]};
        room_emitters: {room id: [names of the glowing materials it turns on]}."""
        self.room_lights = {k: set(v) for k, v in room_lights.items()}
        self.room_emitters = {k: set(v) for k, v in room_emitters.items()}
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

    def room(self, room_id):
        keep = self.room_lights[room_id]
        for o in self.lights:
            o.hide_render = o.name not in keep
        self._sky(False)
        self._glow(self.room_emitters.get(room_id, set()))

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


def encode_and_save(img, path, blur_sigma):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    mask = px[..., 3] > 0.5
    rgb = raster.masked_blur(px[..., :3], mask, blur_sigma)
    rgba, rng = raster.rgbm_encode(rgb, mask)
    out = bpy.data.images.new(img.name + "_rgbm", w, h, alpha=True, float_buffer=False)
    out.colorspace_settings.name = "Non-Color"
    out.alpha_mode = "STRAIGHT"
    out.pixels.foreach_set(rgba.ravel())
    out.file_format = "WEBP"
    out.save(filepath=path, quality=100)  # quality 100 = lossless WebP
    bpy.data.images.remove(out)
    bpy.data.images.remove(img)
    return rng


def remove_bake_nodes():
    for mat in bpy.data.materials:
        if mat.node_tree and BAKE_NODE in mat.node_tree.nodes:
            mat.node_tree.nodes.remove(mat.node_tree.nodes[BAKE_NODE])


def bake_all(scene, state, quality, out_dir):
    device = bpyutil.set_cycles(scene, quality.bake_samples)
    print(f"[bake] Cycles on {device}, {quality.bake_samples} samples", flush=True)
    os.makedirs(os.path.join(out_dir, "lightmaps"), exist_ok=True)
    room_lights = state["room_lights"]
    lighting = Lighting(scene, room_lights, state["room_emitters"])
    ranges = {}

    def run(node, key, layer, size):
        img = denoise(bake_lighting(bpy.data.objects[node], size, f"lm_{key}_{layer}"))
        path = os.path.join(out_dir, "lightmaps", f"{key}_{layer}.webp")
        ranges[f"{key}_{layer}"] = encode_and_save(img, path, quality.blur_sigma_px)
        print(f"[bake] {key}_{layer} {size}px range {ranges[f'{key}_{layer}']}", flush=True)

    try:
        lighting.day()
        for c in state["chunks"]:
            run(c["node"], c["key"], "day", c["size"])
        for d in state["doors"]:
            run(d["node"], d["key"], "day", state["door_lightmap_size"])
        for c in state["chunks"]:
            if c["room"] in room_lights:
                lighting.room(c["room"])
                run(c["node"], c["key"], "light", c["size"])
    finally:
        lighting.restore()
        remove_bake_nodes()
    return ranges
