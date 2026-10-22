import os
import tempfile
import unittest

import bpy
import numpy as np

from pipeline import bake, chunks, config, rooms, scene_select, uvs
from tests import fixture_scene


def _load_decoded(path, rng):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    return px[:, :3] * px[:, 3:4] * rng


class LightingStateTests(unittest.TestCase):
    def test_room_state_and_restore(self):
        fixture_scene.build()
        scene = bpy.context.scene
        _, day = scene_select.prepare_scene(scene, bpy.context.view_layer)
        lighting = bake.Lighting(scene, day, {"alpha": "Ceiling light Alpha", "beta": "Ceiling light Beta"})
        glow = next(n for n in bpy.data.materials["Lamp glow"].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bg = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
        lighting.room("alpha")
        self.assertTrue(bpy.data.objects["Sun"].hide_render)
        self.assertFalse(bpy.data.objects["Ceiling light Alpha"].hide_render)
        self.assertTrue(bpy.data.objects["Ceiling light Beta"].hide_render)
        self.assertEqual(bg.inputs["Strength"].default_value, 0.0)
        self.assertEqual(glow.inputs["Emission Strength"].default_value, 0.0)
        lighting.day()
        self.assertFalse(bpy.data.objects["Sun"].hide_render)
        self.assertTrue(bpy.data.objects["Ceiling light Alpha"].hide_render)
        self.assertEqual(glow.inputs["Emission Strength"].default_value, 2.0)
        lighting.restore()
        self.assertEqual(bg.inputs["Strength"].default_value, 1.0)


class BakeAllTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        scene = bpy.context.scene
        meshes, day = scene_select.prepare_scene(scene, bpy.context.view_layer)
        index, room_list = rooms.collect_rooms(meshes, scene)
        leaf = bpy.data.objects["Door leaf 1"]
        static = [o for o in meshes if o != leaf]
        chunk_list = chunks.build_chunks(static, index)
        q = config.QUALITY["test"]
        for c in chunk_list:
            c["size"] = uvs.add_lightmap_uvs(bpy.data.objects[c["node"]], q.lightmap_texels_per_m, q.lightmap_min, q.lightmap_max)
        uvs.add_lightmap_uvs(leaf, 0, q.door_lightmap, q.door_lightmap)
        state = {"rooms": room_list, "chunks": chunk_list, "day_lights": day,
                 "doors": [{"node": leaf.name, "key": "door-1"}], "door_lightmap_size": q.door_lightmap}
        cls.out = tempfile.mkdtemp()
        cls.ranges = bake.bake_all(scene, state, q, cls.out)

    def test_files_and_ranges(self):
        expected = {"alpha_day", "beta_day", "exterior_day", "door-1_day", "alpha_light", "beta_light"}
        self.assertEqual(set(self.ranges), expected)
        for key in expected:
            self.assertTrue(os.path.exists(os.path.join(self.out, "lightmaps", f"{key}.webp")), key)
            self.assertGreaterEqual(self.ranges[key], 1.0)

    def test_room_light_bake_has_light(self):
        lit = _load_decoded(os.path.join(self.out, "lightmaps", "alpha_light.webp"), self.ranges["alpha_light"])
        self.assertGreater(lit.max(), 0.01)

    def test_cleanup(self):
        for mat in bpy.data.materials:
            if mat.node_tree:
                self.assertNotIn(bake.BAKE_NODE, mat.node_tree.nodes)
        self.assertFalse(bpy.data.objects["Sun"].hide_render)


if __name__ == "__main__":
    unittest.main()
