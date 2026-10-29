import unittest

import numpy as np

from pipeline import geom, probes


def sky_faces(n, f):
    """Faces showing f(direction) at each pixel, as a renderer would."""
    return [np.apply_along_axis(f, -1, probes.face_directions(n, fw, up)) for fw, up in probes.FACES]


class FaceTests(unittest.TestCase):
    def test_a_face_looks_along_its_forward_with_up_at_the_top(self):
        d = probes.face_directions(8, (0, 0, -1), (0, 1, 0))
        np.testing.assert_allclose(d[4, 4] / np.linalg.norm(d[4, 4]), [0, 0, -1], atol=0.2)
        self.assertGreater(d[0, 4][1], 0.5)  # top row looks up
        self.assertGreater(d[4, 7][0], 0.5)  # right column looks right (+x, looking along -z)

    def test_round_trip_three_blender(self):
        self.assertEqual(geom.to_three(geom.from_three((1.0, 2.0, 3.0))), (1.0, 2.0, 3.0))


class EquirectTests(unittest.TestCase):
    def test_rows_run_from_straight_down_to_straight_up_in_threes_convention(self):
        d = probes.equirect_directions(16, 8)
        self.assertLess(d[0, 0, 1], -0.9)
        self.assertGreater(d[-1, 0, 1], 0.9)
        # u = atan2(z, x) / 2pi + 0.5: at the horizon the middle column looks along +x, a quarter on along +z
        self.assertGreater(probes.equirect_directions(64, 3)[1, 32, 0], 0.99)
        self.assertGreater(probes.equirect_directions(64, 3)[1, 48, 2], 0.99)

    def test_resampling_keeps_each_direction(self):
        faces = sky_faces(32, lambda v: np.array([v[0], v[1], v[2]]))
        eq = probes.cube_to_equirect(faces, 64, 32)
        want = probes.equirect_directions(64, 32)
        err = np.linalg.norm(eq / np.linalg.norm(eq, axis=-1, keepdims=True) - want, axis=-1)
        self.assertLess(np.percentile(err, 99), 0.05)

    def test_a_bright_window_lands_where_it_is(self):
        faces = sky_faces(32, lambda v: np.array([10.0, 10.0, 10.0]) if v[2] < -0.95 else np.array([0.1, 0.1, 0.1]))
        eq = probes.cube_to_equirect(faces, 64, 32)
        d = probes.equirect_directions(64, 32)
        bright = eq[..., 0] > 5
        self.assertTrue(bright.any())
        self.assertTrue((d[bright][:, 2] < -0.9).all())

    def test_mean_is_by_solid_angle(self):
        eq = np.zeros((32, 64, 3))
        eq[16:] = 1.0  # the upper half
        np.testing.assert_allclose(probes.mean_radiance(eq), [0.5, 0.5, 0.5], atol=0.01)


class RoomProbeTests(unittest.TestCase):
    def test_middle_of_the_floor_at_eye_height(self):
        floor = [0, 0, 4, 0, 4, 2, 0, 0, 4, 2, 0, 2]
        at = probes.room_probe(floor, ((0, 0, 0), (4, 2.6, 2)), eye=1.5)
        self.assertEqual(at, [2.0, 1.5, 1.0])

    def test_stays_under_a_low_ceiling(self):
        at = probes.room_probe([0, 0, 1, 0, 0, 1], ((0, 0, 0), (1, 1.2, 1)), eye=1.5)
        self.assertLessEqual(at[1], 1.1)


if __name__ == "__main__":
    unittest.main()
