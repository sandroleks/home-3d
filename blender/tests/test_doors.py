import math
import unittest

import bpy

from pipeline import collision, doors, geom, openings, rooms, scene_select
from pipeline.openings import Opening
from tests import fixture_scene


def _prepare(extra=None, overrides=None):
    fixture_scene.build()
    if extra:
        extra()
    meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
    index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
    ops, infilled = openings.parse_openings(meshes)
    grid = collision.build_collision(meshes, index, ops)
    leaves = [o for o in meshes if o.name.startswith("Door leaf")]
    return doors.prepare_doors(leaves, grid, overrides or {}, ops, infilled)


class RotYAngleTests(unittest.TestCase):
    def test_angle_round_trips_through_rot_y(self):
        for d in ((0.0, 1.0), (1.0, 0.0), (0.6, -0.8)):
            for phi in (math.pi / 2, -math.pi / 2, 0.3, -2.5):
                t = geom.rot_y(d, phi)
                self.assertAlmostEqual(geom.rot_y_angle(d, t), phi, places=6)

    def test_fixture_case(self):
        # Closed toward +z, modelled open toward -x: rot_y((0, 1), -pi/2) == (-1, 0).
        self.assertAlmostEqual(geom.rot_y_angle((0.0, 1.0), (-1.0, 0.0)), -math.pi / 2, places=6)

    def test_door_from_opening(self):
        op = Opening(7, False, ("A", "B"), (0.0, 0.0), (1.0, 0.0), (0.0, 1.0), 0.8, 0.1)
        # Leaf hinged at the +x jamb, modelled open toward +z.
        m = geom.door_from_opening((0.42, 0.05), (0.42, 0.8), [op], 0.25)
        self.assertIs(m["opening"], op)
        self.assertEqual(m["hinge"], (0.42, 0.05))
        self.assertEqual(m["dir"], (-1.0, -0.0))
        self.assertAlmostEqual(m["width"], 0.75)
        self.assertAlmostEqual(m["open"][0], 0.0)
        self.assertAlmostEqual(m["open"][1], 1.0)
        self.assertAlmostEqual(m["angle"], math.pi / 2, places=6)  # rot_y((-1, 0), pi/2) == (0, 1)
        self.assertEqual(geom.door_from_opening((3.0, 3.0), (3.0, 3.75), [op], 0.25), None)


class DoorPoseTests(unittest.TestCase):
    OP = Opening(7, False, ("A", "B"), (0.0, 0.0), (1.0, 0.0), (0.0, 1.0), 0.8, 0.1)

    def test_modelled_open_is_rotated_closed(self):
        m = geom.door_from_opening((0.42, 0.05), (0.42, 0.8), [self.OP], 0.25)
        p = geom.door_pose(m, (0.42, 0.05), (0.42, 0.8), lambda x, z: False)
        self.assertFalse(p["closed"])
        self.assertAlmostEqual(p["angle"], math.pi / 2, places=6)
        self.assertAlmostEqual(p["to_closed"], math.pi / 2, places=6)

    def test_modelled_closed_keeps_hinge_and_swings_away_from_blocked_side(self):
        a, b = (-0.38, 0.0), (0.38, 0.0)
        m = geom.door_from_opening(a, b, [self.OP], 0.25)
        self.assertLess(abs(m["angle"]), 1e-6)
        p = geom.door_pose(m, a, b, lambda x, z: z > 0.05)
        self.assertTrue(p["closed"])
        self.assertEqual(p["to_closed"], 0.0)
        self.assertEqual(tuple(p["hinge"]), tuple(m["hinge"]))
        self.assertAlmostEqual(abs(p["angle"]), math.pi / 2, places=6)
        self.assertLess(geom.rot_y(p["dir"], p["angle"])[1], -0.99)  # swings into z < 0

    def test_implausible_angles_raise(self):
        for free in ((0.42 - 0.53, 0.05 + 0.53), (0.42 + 0.65, 0.05 + 0.375)):  # 45° and 150°
            m = geom.door_from_opening((0.42, 0.05), free, [self.OP], 0.25)
            with self.assertRaisesRegex(RuntimeError, "leaf X: modelled"):
                geom.door_pose(m, (0.42, 0.05), free, lambda x, z: False, "leaf X")


class DoorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.specs = _prepare()

    def test_spec(self):
        self.assertEqual(len(self.specs), 1)
        d = self.specs[0]
        self.assertEqual((d["node"], d["key"]), ("Door_1", "door-1"))
        self.assertAlmostEqual(d["hinge"][0], 3.1, places=3)
        self.assertAlmostEqual(d["hinge"][1], -1.78, places=3)
        # Closed: from the hinge jamb toward the other jamb at Blender y 1.02 (three.js z -1.02).
        self.assertAlmostEqual(d["dir"][0], 0.0, places=3)
        self.assertAlmostEqual(d["dir"][1], 1.0, places=3)
        self.assertAlmostEqual(d["width"], 0.76, places=3)
        # Opening sends dir to the modelled open direction, Blender -x = three.js (-1, 0).
        self.assertAlmostEqual(d["openAngle"], -math.pi / 2, places=4)
        ox, oz = geom.rot_y(d["dir"], d["openAngle"])
        self.assertAlmostEqual(ox, -1.0, places=4)
        self.assertAlmostEqual(oz, 0.0, places=4)

    def test_leaf_is_closed_about_its_hinge_origin(self):
        obj = bpy.data.objects["Door_1"]
        self.assertAlmostEqual(obj.location.x, 3.1, places=3)
        self.assertAlmostEqual(obj.location.y, 1.78, places=3)
        self.assertAlmostEqual(obj.location.z, 0.0, places=3)
        xs = [v.co.x for v in obj.data.vertices]
        ys = [v.co.y for v in obj.data.vertices]
        # Along the opening: Blender -y from the hinge (toward y 1.02), 4 cm thick across it.
        self.assertAlmostEqual(min(ys), -0.76, places=3)
        self.assertAlmostEqual(max(ys), 0.0, places=3)
        self.assertAlmostEqual(min(xs), -0.02, places=3)
        self.assertAlmostEqual(max(xs), 0.02, places=3)

    def test_leaf_on_infilled_opening_is_removed(self):
        self.assertNotIn("Door leaf 2", bpy.data.objects)
        self.assertNotIn("Door_2", bpy.data.objects)
        self.assertNotIn("door-2", [d["key"] for d in self.specs])


def _add_leaf(name, box):
    def add():
        fixture_scene.box_object(name, [box], bpy.data.materials["Wood"], bpy.data.collections["Doors.001"])
    return add


class ClosedLeafTests(unittest.TestCase):
    def test_leaf_modelled_closed_in_its_doorway(self):
        def closed_leaf_1():
            bpy.data.objects.remove(bpy.data.objects["Door leaf 1"], do_unlink=True)
            _add_leaf("Door leaf 1", (3.08, 1.02, 0, 3.12, 1.78, 2.0))()

        d = _prepare(closed_leaf_1)[0]
        self.assertAlmostEqual(abs(d["openAngle"]), math.pi / 2, places=4)
        self.assertAlmostEqual(d["hinge"][0], 3.1, places=3)
        self.assertIn(round(d["hinge"][1], 2), (-1.78, -1.02))
        # Not rotated: still along Blender y from the hinge, 4 cm thick in x.
        obj = bpy.data.objects["Door_1"]
        xs = [v.co.x for v in obj.data.vertices]
        ys = [abs(v.co.y) for v in obj.data.vertices]
        self.assertAlmostEqual(min(xs), -0.02, places=3)
        self.assertAlmostEqual(max(xs), 0.02, places=3)
        self.assertAlmostEqual(max(ys), 0.76, places=3)

    def test_two_leaves_at_one_opening_fail(self):
        with self.assertRaisesRegex(RuntimeError, "Door leaf 1.*Door leaf 3.*opening 1"):
            _prepare(_add_leaf("Door leaf 3", (3.08, 1.02, 0, 3.12, 1.78, 2.0)))


class FallbackTests(unittest.TestCase):
    def test_leaf_far_from_openings_uses_swing_heuristic_and_override(self):
        add_leaf = _add_leaf("Door leaf 3", (0.3, 0.3, 0, 1.06, 0.34, 2.0))
        spec = next(d for d in _prepare(add_leaf, {"Door leaf 3": {"hinge": "b"}}) if d["key"] == "door-3")
        # Ends (0.3, -0.32) = "a" and (1.06, -0.32) = "b"; not rotated, only re-origined.
        self.assertAlmostEqual(spec["hinge"][0], 1.06, places=3)
        self.assertAlmostEqual(spec["hinge"][1], -0.32, places=3)
        self.assertAlmostEqual(spec["dir"][0], -1.0, places=3)
        self.assertAlmostEqual(abs(spec["openAngle"]), math.pi / 2, places=4)
        obj = bpy.data.objects["Door_3"]
        xs = [v.co.x for v in obj.data.vertices]
        self.assertAlmostEqual(min(xs), -0.76, places=3)
        self.assertAlmostEqual(max(xs), 0.0, places=3)


if __name__ == "__main__":
    unittest.main()
