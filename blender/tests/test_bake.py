import math
import os
import tempfile
import unittest

import bpy
import numpy as np

from pipeline import bake, bpyutil, chunks, config, layers, movables, rooms, run, scene_select, uvs
from tests import fixture_scene


def _load_decoded(path, rng):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    return px[:, :3] * px[:, 3:4] * rng


def _bsdf(mat_name):
    return next(n for n in bpy.data.materials[mat_name].node_tree.nodes if n.type == "BSDF_PRINCIPLED")


GROUPS = {"alpha": ["Ceiling light Alpha"], "alpha/desk-lamp": ["Desk lamp light"], "beta": ["Ceiling light Beta"]}


class LightingStateTests(unittest.TestCase):
    def setUp(self):
        fixture_scene.build()
        self.scene = bpy.context.scene
        scene_select.prepare_scene(self.scene, bpy.context.view_layer)
        self.lighting = bake.Lighting(self.scene, GROUPS, {"beta": ["Lamp glow"]})
        self.bg = next(n for n in self.scene.world.node_tree.nodes if n.type == "BACKGROUND")
        self.glow = _bsdf("Lamp glow")

    def hidden(self, name):
        return bpy.data.objects[name].hide_render

    def test_day_is_sky_only(self):
        self.lighting.day()
        for name in ("Sun", "Desk lamp light", "Ceiling light Alpha", "Ceiling light Beta"):
            self.assertTrue(self.hidden(name), name)
        self.assertFalse(self.hidden("Portal Alpha window"))
        self.assertFalse(self.bg.inputs["Color"].is_linked)
        for got, want in zip(self.bg.inputs["Color"].default_value[:3], config.SKY_BAKE_COLOR):
            self.assertAlmostEqual(got, want, places=5)
        self.assertEqual(self.bg.inputs["Strength"].default_value, 1.0)
        self.assertEqual(self.glow.inputs["Emission Strength"].default_value, 0.0)

    def test_a_group_lights_its_lamps_and_glows_only(self):
        self.lighting.group("alpha")
        self.assertFalse(self.hidden("Ceiling light Alpha"))
        self.assertTrue(self.hidden("Desk lamp light"))  # a lamp group of its own
        self.assertTrue(self.hidden("Portal Alpha window"))
        self.assertTrue(self.hidden("Sun"))
        self.assertEqual(self.bg.inputs["Strength"].default_value, 0.0)
        self.assertEqual(self.glow.inputs["Emission Strength"].default_value, 0.0)
        self.lighting.group("alpha/desk-lamp")
        self.assertTrue(self.hidden("Ceiling light Alpha"))
        self.assertFalse(self.hidden("Desk lamp light"))
        self.lighting.group("beta")
        self.assertTrue(self.hidden("Desk lamp light"))
        self.assertEqual(self.glow.inputs["Emission Strength"].default_value, 2.0)

    def test_several_groups_at_once(self):
        self.lighting.groups(["alpha", "alpha/desk-lamp"])
        self.assertFalse(self.hidden("Ceiling light Alpha"))
        self.assertFalse(self.hidden("Desk lamp light"))
        self.assertTrue(self.hidden("Ceiling light Beta"))

    def test_restore(self):
        self.lighting.day()
        self.lighting.restore()
        self.assertTrue(self.bg.inputs["Color"].is_linked)
        self.assertEqual(self.bg.inputs["Strength"].default_value, 1.0)
        self.assertEqual(self.glow.inputs["Emission Strength"].default_value, 2.0)
        self.assertFalse(self.hidden("Sun"))
        self.assertFalse(self.hidden("Desk lamp light"))
        self.assertTrue(self.hidden("Ceiling light Alpha"))

    def test_sky_irradiance(self):
        r, g, b = config.SKY_BAKE_COLOR
        self.assertAlmostEqual(bake.sky_irradiance(self.scene), math.pi * (0.2126 * r + 0.7152 * g + 0.0722 * b), places=6)


class BakeAllTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        scene = bpy.context.scene
        cls.out, build = tempfile.mkdtemp(), tempfile.mkdtemp()
        q = config.QUALITY["test"]
        cls.state = run.prepare(scene, q, cls.out, build)["state"]
        cls.baked = bake.bake_all(scene, cls.state, q, cls.out)

    def lightmap(self, name):
        return os.path.join(self.out, "lightmaps", f"{name}.webp")

    def test_rgbm_layers(self):
        expected = {"alpha_day", "beta_day", "exterior_day", "door-1_day", "movables-beta_day", "alpha_light", "beta_light"}
        self.assertEqual(set(self.baked["rgbm"]), expected)
        for key in expected:
            self.assertTrue(os.path.exists(self.lightmap(key)), key)
            self.assertGreaterEqual(self.baked["rgbm"][key], 1.0)

    def test_packed_layers(self):
        def keys(surface):
            return [layers.layer_key(l) for p in self.baked["packs"].get(surface, []) for l in p["layers"]]

        self.assertEqual(keys("alpha"), ["alpha/desk-lamp", "spill-1-beta"])
        self.assertEqual(keys("beta"), ["beta/tv", "spill-1-alpha"])  # the TV's light is baked like a lamp's
        self.assertEqual(keys("door-1"), ["alpha", "alpha/desk-lamp", "beta", "beta/tv"])
        self.assertEqual(keys("movables-beta"), ["beta", "beta/tv"])
        for surface, ps in self.baked["packs"].items():
            for p in ps:
                self.assertTrue(os.path.exists(os.path.join(self.out, p["file"])), p["file"])
                for l in p["layers"]:
                    self.assertGreater(l["range"], 0)
                    self.assertEqual(len(l["tint"]), 3)

    def test_room_light_bake_has_light(self):
        lit = _load_decoded(self.lightmap("alpha_light"), self.baked["rgbm"]["alpha_light"])
        self.assertGreater(lit.max(), 0.01)

    def test_day_layers_have_light(self):
        for key in ("alpha", "beta", "exterior", "door-1", "movables-beta"):
            name = f"{key}_day"
            day = _load_decoded(self.lightmap(name), self.baked["rgbm"][name])
            self.assertGreater(day.max(), 0.01, name)

    def test_every_movable_tile_is_baked(self):
        atlas = self.state["movable_atlas"]["movables-beta"]
        img = bpy.data.images.load(self.lightmap("movables-beta_day"))
        px = bake.pixels(img)
        for i in range(len([m for m in self.state["movables"] if m["room"] == "beta"])):
            x0, y0, x1, y1 = movables.tile_rect(i, atlas["cols"], atlas["tile"])
            self.assertGreater((px[y0:y1, x0:x1, 3] > 0).sum(), 0, i)

    def test_light_layer_differs_from_day(self):
        day = _load_decoded(self.lightmap("alpha_day"), self.baked["rgbm"]["alpha_day"])
        lit = _load_decoded(self.lightmap("alpha_light"), self.baked["rgbm"]["alpha_light"])
        self.assertGreater(np.abs(day - lit).max(), 0.01)

    def test_cleanup(self):
        self.assertTrue(bpy.data.objects["Ceiling light Alpha"].hide_render)
        self.assertTrue(bpy.data.objects["Ceiling light Beta"].hide_render)
        glow = next(n for n in bpy.data.materials["Lamp glow @beta"].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        self.assertEqual(glow.inputs["Emission Strength"].default_value, 2.0)
        bg = next(n for n in bpy.context.scene.world.node_tree.nodes if n.type == "BACKGROUND")
        self.assertEqual(bg.inputs["Strength"].default_value, 1.0)
        for mat in bpy.data.materials:
            if mat.node_tree:
                self.assertNotIn(bake.BAKE_NODE, mat.node_tree.nodes)
        self.assertFalse(bpy.data.objects["Sun"].hide_render)
        for m in self.state["movables"]:
            self.assertFalse(bpy.data.objects[m["node"]].hide_render)
        self.assertEqual(bpy.data.objects["Door_1"].rotation_euler.z, 0.0)
        self.assertFalse([o.name for o in bpy.data.objects if o.name.startswith("WEB_PASS")])


class DenoiseTests(unittest.TestCase):
    def test_removes_noise_keeps_level_alpha_and_cleans_up(self):
        w, h = 96, 64
        y, x = np.mgrid[0:h, 0:w].astype(np.float32)
        clean = np.stack([0.5 + 2.0 * x / w, 0.5 + y / h, np.full_like(x, 1.5)], axis=-1)
        rng = np.random.default_rng(0)
        noisy = clean * (1 + 0.4 * rng.standard_normal(clean.shape).astype(np.float32))
        alpha = np.zeros((h, w, 1), np.float32)
        alpha[8:56, 8:88] = 1.0
        img = bpy.data.images.new("noisy", w, h, alpha=True, float_buffer=True)
        img.colorspace_settings.name = "Non-Color"
        img.pixels.foreach_set(np.concatenate([noisy, alpha], axis=-1).ravel())
        scenes, groups = len(bpy.data.scenes), len(bpy.data.node_groups)

        bake.denoise(img)
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)
        bpy.data.images.remove(img)

        inner = (slice(16, 48), slice(16, 80))
        err_noisy = np.sqrt(((noisy - clean)[inner] ** 2).mean())
        err_denoised = np.sqrt(((px[..., :3] - clean)[inner] ** 2).mean())
        self.assertLess(err_denoised, 0.5 * err_noisy)
        self.assertAlmostEqual(float(px[..., :3][inner].mean()), float(clean[inner].mean()), delta=0.1)
        np.testing.assert_array_equal(px[..., 3], alpha[..., 0])
        self.assertEqual((len(bpy.data.scenes), len(bpy.data.node_groups)), (scenes, groups))


class RoomIsolationTests(unittest.TestCase):
    def test_room_state_without_ceiling_light_is_black(self):
        fixture_scene.build()
        scene = bpy.context.scene
        meshes, day = scene_select.prepare_scene(scene, bpy.context.view_layer)
        index, room_list = rooms.collect_rooms(meshes, scene)
        chunk_list = chunks.build_chunks([o for o in meshes if not o.name.startswith("Door leaf")], index)
        q = config.QUALITY["test"]
        for c in chunk_list:
            c["size"] = uvs.add_lightmap_uvs(bpy.data.objects[c["node"]], q.lightmap_texels_per_m, q.lightmap_min, q.lightmap_max)
        chunk = next(c for c in chunk_list if c["room"] == "alpha")
        bpyutil.set_cycles(scene, q.bake_samples)
        lighting = bake.Lighting(scene, {"alpha": ["Ceiling light Alpha"], "beta": ["Ceiling light Beta"]}, {})
        lamp = bpy.data.objects["Ceiling light Alpha"]
        saved = lamp.data.energy
        try:
            lighting.group("alpha")
            lamp.data.energy = 0.0
            img = bake.bake_lighting(bpy.data.objects[chunk["node"]], chunk["size"], "iso")
            px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            rgb = px.reshape(-1, 4)[:, :3]
            bpy.data.images.remove(img)
            self.assertLess(rgb.max(), 1e-3)
        finally:
            lamp.data.energy = saved
            lighting.restore()
            bake.remove_bake_nodes()


if __name__ == "__main__":
    unittest.main()
