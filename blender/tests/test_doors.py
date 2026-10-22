import math
import unittest

import bpy

from pipeline import collision, doors, openings, rooms, scene_select
from tests import fixture_scene


class DoorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        ops, _ = openings.parse_openings(meshes)
        grid = collision.build_collision(meshes, index, ops)
        leaves = [o for o in meshes if o.name.startswith("Door leaf")]
        cls.specs = doors.prepare_doors(leaves, grid, {})

    def test_spec(self):
        self.assertEqual(len(self.specs), 1)
        d = self.specs[0]
        self.assertEqual((d["node"], d["key"]), ("Door_1", "door-1"))
        self.assertAlmostEqual(d["hinge"][0], 3.1, places=3)
        self.assertAlmostEqual(d["hinge"][1], -1.78, places=3)
        self.assertAlmostEqual(d["dir"][0], 0.0, places=3)
        self.assertAlmostEqual(d["dir"][1], 1.0, places=3)
        self.assertAlmostEqual(d["width"], 0.76, places=3)
        # The shelf blocks the swing into Beta, so it opens into Alpha (negative angle).
        self.assertAlmostEqual(d["openAngle"], -math.pi / 2, places=4)

    def test_origin_is_at_the_hinge(self):
        obj = bpy.data.objects["Door_1"]
        self.assertAlmostEqual(obj.location.x, 3.1, places=3)
        self.assertAlmostEqual(obj.location.y, 1.78, places=3)
        self.assertAlmostEqual(obj.location.z, 0.0, places=3)
        far = max((v.co.x ** 2 + v.co.y ** 2) ** 0.5 for v in obj.data.vertices)
        self.assertAlmostEqual(far, 0.76, delta=0.03)

    def test_override(self):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        ops, _ = openings.parse_openings(meshes)
        grid = collision.build_collision(meshes, index, ops)
        leaves = [o for o in meshes if o.name.startswith("Door leaf")]
        spec = doors.prepare_doors(leaves, grid, {"Door leaf 1": {"hinge": "b"}})[0]
        self.assertAlmostEqual(spec["hinge"][1], -1.02, places=3)


if __name__ == "__main__":
    unittest.main()
