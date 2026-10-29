import unittest

import numpy as np

from pipeline import visibility


class VisibilityTests(unittest.TestCase):
    def test_directions_cover_the_sphere(self):
        d = visibility.fibonacci_directions(200)
        np.testing.assert_allclose(np.linalg.norm(d, axis=1), 1, atol=1e-9)
        self.assertLess(np.abs(d.mean(0)).max(), 0.02)

    def test_grid_points_lie_on_the_floor(self):
        floor = [0, 0, 2, 0, 2, 1, 0, 0, 2, 1, 0, 1]
        pts = visibility.floor_points(floor, 0.5)
        self.assertGreaterEqual(len(pts), 8)
        self.assertTrue(((pts >= 0) & (pts <= [2, 1])).all())

    def test_a_narrow_room_still_gets_points(self):
        self.assertGreaterEqual(len(visibility.floor_points([0, 0, 0.3, 0, 0, 0.3], 0.6)), 1)

    def test_keeps_only_the_door_sets_nothing_smaller_already_opens(self):
        sets = [frozenset({2, 3}), frozenset({3}), frozenset({3}), frozenset({1, 4}), frozenset({1, 4, 5})]
        self.assertEqual(visibility.minimal_sets(sets), [[3], [1, 4]])
        self.assertEqual(visibility.minimal_sets([frozenset(), frozenset({1})]), [[]])


if __name__ == "__main__":
    unittest.main()
