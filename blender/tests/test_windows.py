import unittest

import bpy
import numpy as np

from pipeline import rooms, scene_select, windows
from tests import fixture_scene


class WindowTests(unittest.TestCase):
    def test_exterior_glass_becomes_a_window_facing_outdoors(self):
        fixture_scene.build()
        scene = bpy.context.scene
        meshes, _ = scene_select.prepare_scene(scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, scene)
        ws = windows.exterior_windows(meshes, index)
        self.assertEqual(len(ws), 1)
        w = ws[0]
        self.assertEqual(w["room"], "alpha")
        np.testing.assert_allclose(w["center"], [1.5, 1.5, 0.1], atol=1e-3)
        np.testing.assert_allclose(w["normal"], [0.0, 0.0, 1.0], atol=1e-3)  # Blender -Y is three.js +Z
        self.assertAlmostEqual(w["width"], 1.0, places=3)
        self.assertAlmostEqual(w["height"], 1.0, places=3)


if __name__ == "__main__":
    unittest.main()
