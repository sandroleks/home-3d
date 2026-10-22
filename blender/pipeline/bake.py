"""Bake daylight and per-room ceiling-light layers, then save them as RGBM WebP."""
import os

import bpy
import numpy as np

from . import bpyutil, raster

BAKE_NODE = "WEB_LIGHTMAP_TARGET"


def _emission_sockets():
    sockets = []
    for mat in bpy.data.materials:
        if mat.node_tree is None:
            continue
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                sockets.append(n.inputs["Emission Strength"])
            elif n.type == "EMISSION":
                sockets.append(n.inputs["Strength"])
    return [(s, s.default_value) for s in sockets if s.default_value > 0]


class Lighting:
    """Switch the scene between the daylight bake setup and one room's ceiling light."""

    def __init__(self, scene, day_lights, room_lights):
        self.day_lights = set(day_lights)
        self.room_lights = dict(room_lights)
        self.lights = [o for o in scene.objects if o.type == "LIGHT"]
        self.saved_hide = {o.name: o.hide_render for o in self.lights}
        self.background = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
        self.saved_strength = self.background.inputs["Strength"].default_value
        self.emitters = _emission_sockets()

    def day(self):
        ceiling = set(self.room_lights.values())
        for o in self.lights:
            o.hide_render = not (o.name in self.day_lights and o.name not in ceiling)
        self.background.inputs["Strength"].default_value = self.saved_strength
        for socket, value in self.emitters:
            socket.default_value = value

    def room(self, room_id):
        keep = self.room_lights[room_id]
        for o in self.lights:
            o.hide_render = o.name != keep
        self.background.inputs["Strength"].default_value = 0.0
        for socket, _ in self.emitters:
            socket.default_value = 0.0

    def restore(self):
        for o in self.lights:
            o.hide_render = self.saved_hide[o.name]
        self.background.inputs["Strength"].default_value = self.saved_strength
        for socket, value in self.emitters:
            socket.default_value = value


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
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=4,
                        margin_type="EXTEND", use_clear=True, uv_layer="UVLightmap",
                        target="IMAGE_TEXTURES")
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
    room_lights = {r["id"]: r["light"] for r in state["rooms"] if r["light"]}
    lighting = Lighting(scene, state["day_lights"], room_lights)
    ranges = {}

    def run(node, key, layer, size):
        img = bake_lighting(bpy.data.objects[node], size, f"lm_{key}_{layer}")
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
