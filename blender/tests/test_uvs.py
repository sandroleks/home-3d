import unittest

import bpy
import numpy as np

from pipeline import chunks, rooms, scene_select, uvs
from tests import fixture_scene


class UvTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        static = [o for o in meshes if not o.name.startswith("Door leaf")]
        chunks.build_chunks(static, index)
        cls.obj = bpy.data.objects["Room_alpha"]
        cls.size = uvs.add_lightmap_uvs(cls.obj, 8, 32, 64)
        cls.door_size = uvs.add_lightmap_uvs(bpy.data.objects["Door leaf 1"], 0, 32, 32)

    def test_layers(self):
        layers = self.obj.data.uv_layers
        self.assertEqual([l.name for l in layers], ["UVMap", "UVLightmap"])
        self.assertTrue(layers["UVMap"].active_render)

    def test_lightmap_uvs_are_laid_out(self):
        lm = self.obj.data.uv_layers["UVLightmap"]
        uv = np.empty(len(lm.data) * 2)
        lm.data.foreach_get("uv", uv)
        self.assertGreaterEqual(uv.min(), -1e-4)
        self.assertLessEqual(uv.max(), 1 + 1e-4)
        self.assertGreater(uv.std(), 0.05)

    def test_sizes(self):
        self.assertIn(self.size, (32, 64))
        self.assertEqual(self.door_size, 32)


if __name__ == "__main__":
    unittest.main()
