import math
import unittest

from pipeline import geom


class CoordinateTests(unittest.TestCase):
    def test_to_three_maps_blender_z_up_to_y_up(self):
        self.assertEqual(geom.to_three((1.0, 2.0, 3.0)), (1.0, 3.0, -2.0))

    def test_ground_plane_round_trip(self):
        self.assertEqual(geom.from_three_xz(*geom.to_three_xz(4.0, -5.0)), (4.0, -5.0))

    def test_slugify(self):
        self.assertEqual(geom.slugify("Quarto 01"), "quarto-01")
        self.assertEqual(geom.slugify("WC 02"), "wc-02")

    def test_rot_y_matches_blender_z_rotation(self):
        # Blender (1, 0) rotated +90° about Z is (0, 1); in three.js xz that is (0, -1).
        x, z = geom.rot_y((1.0, 0.0), math.pi / 2)
        self.assertAlmostEqual(x, 0.0)
        self.assertAlmostEqual(z, -1.0)


class FloorIndexTests(unittest.TestCase):
    def setUp(self):
        square = lambda x0, z0, x1, z1: [x0, z0, x1, z0, x1, z1, x0, z0, x1, z1, x0, z1]
        self.index = geom.FloorIndex({"a": square(0, 0, 1, 1), "b": square(2, 0, 3, 1)})

    def test_locate(self):
        self.assertEqual(self.index.locate(0.5, 0.5), "a")
        self.assertEqual(self.index.locate(2.5, 0.2), "b")
        self.assertIsNone(self.index.locate(1.5, 0.5))

    def test_locate_many(self):
        self.assertEqual(self.index.locate_many([(0.5, 0.5), (2.5, 0.5), (9, 9)]).tolist(), [0, 1, -1])

    def test_nearest_floor_within_max_dist(self):
        pts = [(1.1, 0.5), (1.5, 0.5), (1.85, 0.5)]
        self.assertEqual(self.index.locate_many(pts).tolist(), [-1, -1, -1])
        self.assertEqual(self.index.locate_many(pts, max_dist=0.2).tolist(), [0, -1, 1])

    def test_degenerate_triangles_are_ignored(self):
        index = geom.FloorIndex({"flat": [0, 0, 1, 1, 2, 2]})
        self.assertIsNone(index.locate(5.0, -3.0))

    def test_bounds(self):
        self.assertEqual(self.index.bounds(), (0.0, 0.0, 3.0, 1.0))

    def test_door_rooms_probes_both_sides(self):
        # a leaf along z at x = 1.5 between room a (x < 1) and b (x > 2), probing 0.7 m out
        self.assertEqual(geom.door_rooms((1.5, 0.1), (0, 1), 0.8, self.index.locate, probe=0.7), ["a", "b"])
        self.assertEqual(geom.door_rooms((0.5, 0.1), (0, 1), 0.8, self.index.locate, probe=0.2), ["a"])
        self.assertEqual(geom.door_rooms((5, 5), (1, 0), 0.8, self.index.locate), [])


class OpenNeighbourTests(unittest.TestCase):
    square = staticmethod(lambda x0, z0, x1, z1: [x0, z0, x1, z0, x1, z1, x0, z0, x1, z1, x0, z1])

    def test_floors_that_meet_are_neighbours_both_ways(self):
        rooms = {"kitchen": self.square(0, 0, 2, 3), "living": self.square(2, 0, 6, 3), "bed": self.square(0, 3.2, 2, 6)}
        index = geom.FloorIndex(rooms)
        # kitchen and living share 3 m; the bedroom sits behind a 0.2 m wall
        self.assertEqual(geom.open_neighbours(rooms, index.locate_many), {"kitchen": ["living"], "living": ["kitchen"]})

    def test_a_short_touch_is_not_open_plan(self):
        rooms = {"a": self.square(0, 0, 1, 1), "b": self.square(1, 0.8, 2, 2)}  # corners overlap along 0.2 m
        index = geom.FloorIndex(rooms)
        self.assertEqual(geom.open_neighbours(rooms, index.locate_many), {})
        self.assertEqual(geom.open_neighbours(rooms, index.locate_many, min_shared=0.1), {"a": ["b"], "b": ["a"]})


class FacesWithinTests(unittest.TestCase):
    def test_keeps_faces_that_reach_out_of_the_box(self):
        # The kitchen floor: a big face up to the opening, and the strip across it that a closed wall would cover
        room = [(-3.26, -5.59), (-1.075, -5.59), (-1.075, -1.16)]
        strip = [(-1.075, -1.3), (-0.99, -1.3), (-0.99, -5.4), (-1.075, -5.4)]
        self.assertEqual(geom.faces_within([room, strip], (-1.24, -5.40), (-0.84, -1.30)), [1])

    def test_tolerance(self):
        self.assertEqual(geom.faces_within([[(0.0, 0.0), (1.005, 1.0)]], (0, 0), (1, 1)), [0])
        self.assertEqual(geom.faces_within([[(0.0, 0.0), (1.05, 1.0)]], (0, 0), (1, 1)), [])


class PrincipalFrameTests(unittest.TestCase):
    def test_rotated_rectangle(self):
        a = math.radians(30)
        u = (math.cos(a), math.sin(a))
        n = (-u[1], u[0])
        pts = [(2 + su * 0.385 * u[0] + sn * 0.06 * n[0], 1 + su * 0.385 * u[1] + sn * 0.06 * n[1])
               for su in (-1, 1) for sn in (-1, 1)]
        c, uu, nn, wu, wn = geom.principal_frame(pts)
        self.assertAlmostEqual(c[0], 2.0)
        self.assertAlmostEqual(c[1], 1.0)
        self.assertAlmostEqual(wu, 0.77)
        self.assertAlmostEqual(wn, 0.12)
        self.assertAlmostEqual(abs(uu[0] * u[0] + uu[1] * u[1]), 1.0)
        self.assertGreater(uu[0], 0)

    def test_vertical_axis_points_plus_z(self):
        pts = [(0, 0), (0.1, 0), (0, 2), (0.1, 2)]
        _, u, n, wu, wn = geom.principal_frame(pts)
        self.assertAlmostEqual(u[0], 0.0)
        self.assertAlmostEqual(u[1], 1.0)
        self.assertAlmostEqual(n[0], -1.0)


def corner_room(x, z):
    """Wall along x with a doorway at x 0..0.8, a side wall at x≈-0.1 on +z, a wardrobe on -z."""
    if -0.05 <= z <= 0.05 and not (0.0 <= x <= 0.8):
        return True
    if -0.15 <= x <= -0.05 and 0.0 <= z <= 3.0:
        return True
    if 0.0 <= x <= 1.0 and -1.0 <= z <= -0.1:
        return True
    return False


class DoorSwingTests(unittest.TestCase):
    def test_swings_away_from_furniture_and_rests_against_side_wall(self):
        c = geom.choose_door_swing((0.0, 0.0), (0.8, 0.0), corner_room)
        self.assertEqual(c["hinge_end"], "a")
        self.assertEqual(c["sign"], -1)
        self.assertAlmostEqual(c["width"], 0.8)
        self.assertEqual(c["dir"], (1.0, 0.0))

    def test_override_forces_hinge(self):
        c = geom.choose_door_swing((0.0, 0.0), (0.8, 0.0), corner_room, {"hinge": "b"})
        self.assertEqual(c["hinge"], (0.8, 0.0))
        self.assertEqual(c["sign"], 1)

    def test_impossible_override_raises(self):
        with self.assertRaises(ValueError):
            geom.choose_door_swing((0.0, 0.0), (0.8, 0.0), corner_room, {"hinge": "c"})


class SlidePoseTests(unittest.TestCase):
    def test_closed_leaf_and_its_slide(self):
        p = geom.slide_pose((1.58, -7.27), (2.197, -7.27), (-2.0, -0.0), 0.621)
        self.assertEqual(p["hinge"], (1.58, -7.27))
        self.assertEqual(p["dir"], (1.0, 0.0))
        self.assertAlmostEqual(p["width"], 0.617)
        self.assertEqual(p["slide"], {"dir": [-1.0, 0.0], "distance": 0.621})


class CameraTests(unittest.TestCase):
    def test_yaw_pitch(self):
        self.assertEqual(geom.yaw_pitch_from_forward((0.0, 0.0, -1.0)), (0.0, 0.0))
        yaw, pitch = geom.yaw_pitch_from_forward((-1.0, 0.0, 0.0))
        self.assertAlmostEqual(yaw, math.pi / 2)
        yaw, pitch = geom.yaw_pitch_from_forward((0.0, 1.0, 0.0))
        self.assertAlmostEqual(pitch, math.pi / 2)


if __name__ == "__main__":
    unittest.main()
