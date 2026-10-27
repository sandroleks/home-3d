import math
import unittest

import bmesh
import bpy
from mathutils import Matrix

from pipeline import seats


def box(name, lo, hi, prop=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    centre = [(a + b) / 2 for a, b in zip(lo, hi)]
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(centre) @ Matrix.Diagonal((*[b - a for a, b in zip(lo, hi)], 1)))
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if prop:
        obj["web_seat"] = prop
    return obj


class PureTests(unittest.TestCase):
    def test_pose_from_property_or_name(self):
        patterns = ((r"^Dining chair \d+$", "sit"), (r"^Mattress$", "lie"))
        self.assertEqual(seats.seat_pose("Dining chair 3", None, patterns), "sit")
        self.assertEqual(seats.seat_pose("Mattress", None, patterns), "lie")
        self.assertEqual(seats.seat_pose("Mattress", "sit", patterns), "sit")
        self.assertIsNone(seats.seat_pose("Dining table", None, patterns))

    def test_spots_across_the_seat(self):
        # 1.2 m along y, facing +x: two spots 0.6 m apart, in the seat's middle
        out = seats.spots((0, 0, 0), (0.8, 1.2, 0.47), 0.47, (1.0, 0.0), 0.55)
        self.assertEqual([(round(x, 3), round(y, 3)) for x, y, _ in out], [(0.4, 0.3), (0.4, 0.9)])
        self.assertEqual(len(seats.spots((0, 0, 0), (0.4, 0.4, 0.5), 0.5, (1.0, 0.0), 0.55)), 1)

    def test_yaw_matches_the_viewer(self):
        # The viewer's forward is (-sin yaw, -cos yaw) in three.js x, z; Blender +y is three.js -z
        for facing in seats.AXES:
            yaw = seats.yaw_of(facing)
            self.assertAlmostEqual(-math.sin(yaw), facing[0])
            self.assertAlmostEqual(-math.cos(yaw), -facing[1])

    def test_nearest_within(self):
        hits = {(1.0, 0.0): 0.3, (-1.0, 0.0): 0.2, (0.0, 1.0): None}
        self.assertEqual(seats.nearest_within(hits, {d: 0.5 for d in hits}), (-1.0, 0.0))
        self.assertIsNone(seats.nearest_within(hits, {d: 0.1 for d in hits}))


class SceneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        # A chair with its back to -y, facing +y
        box("Chair seat", (0, 0, 0.42), (0.45, 0.45, 0.46), "sit")
        box("Chair back", (0, -0.03, 0.46), (0.45, 0.0, 0.95))
        # A stool at a counter on its -x side
        box("Stool", (3, 0, 0.6), (3.36, 0.36, 0.68), "sit")
        box("Counter", (2.0, -0.5, 0.86), (2.95, 1.0, 0.9))
        # A double bed along x, pillows at +x
        box("Mattress", (6, 0, 0.3), (8, 1.8, 0.52), "lie")
        box("Pillow", (7.6, 0.1, 0.52), (7.9, 1.7, 0.7))
        cls.found = {s["name"]: s for s in seats.find_seats(bpy.context.scene, bpy.context.view_layer)}

    def test_finds_only_seats(self):
        self.assertEqual(sorted(self.found), ["Chair seat", "Mattress", "Stool"])

    def test_chair_faces_away_from_its_back(self):
        s = self.found["Chair seat"]
        self.assertEqual(len(s["spots"]), 1)
        self.assertAlmostEqual(s["spots"][0]["yaw"], seats.yaw_of((0.0, 1.0)), places=3)
        self.assertAlmostEqual(s["spots"][0]["at"][1], 0.46, places=3)  # three.js y: the seat's top

    def test_stool_faces_the_counter(self):
        self.assertAlmostEqual(self.found["Stool"]["spots"][0]["yaw"], seats.yaw_of((-1.0, 0.0)), places=3)

    def test_bed_sleeps_two_heads_on_the_pillows(self):
        s = self.found["Mattress"]
        self.assertEqual(s["pose"], "lie")
        self.assertEqual(len(s["spots"]), 2)
        self.assertAlmostEqual(s["spots"][0]["yaw"], seats.yaw_of((-1.0, 0.0)), places=3)  # feet toward -x


if __name__ == "__main__":
    unittest.main()
