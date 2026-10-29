import unittest

import numpy as np

from pipeline import tiles


class TileTests(unittest.TestCase):
    def test_noise_wraps_at_the_edges(self):
        n = tiles.periodic_noise(64, 0.05, 0.05, 1)
        inner = np.abs(np.diff(n, axis=1)).mean()
        seam = np.abs(n[:, 0] - n[:, -1]).mean()
        self.assertLess(seam, inner * 1.5)

    def test_wood_grain_runs_along_v(self):
        h = tiles.wood_height(128)
        along = np.abs(np.diff(h, axis=0)).mean()
        across = np.abs(np.diff(h, axis=1)).mean()
        self.assertLess(along, across)
        self.assertAlmostEqual(h.min(), 0.0)
        self.assertAlmostEqual(h.max(), 1.0)

    def test_colour_keeps_the_materials_mean(self):
        rgb = tiles.colourise(tiles.wood_height(64), (0.5, 0.37, 0.22), 0.35)
        np.testing.assert_allclose(rgb.reshape(-1, 3).mean(0), [0.5, 0.37, 0.22], atol=0.01)

    def test_flat_height_makes_a_flat_normal(self):
        n = tiles.normal_from_height(np.zeros((8, 8)), 5)
        np.testing.assert_allclose(n, np.broadcast_to([0.5, 0.5, 1.0], n.shape))

    def test_box_uvs_run_v_along_a_boards_length_at_real_size(self):
        # a 2 m board along local x, 0.1 m wide in y, its top face (normal +z)
        co = np.array([[0, 0, 0], [2, 0, 0], [2, 0.1, 0], [0, 0.1, 0]], float)
        nrm = np.tile([0, 0, 1.0], (4, 1))
        uv = tiles.box_uvs(co, nrm, (1, 1, 1), 0.5)
        self.assertAlmostEqual(uv[:, 1].max() - uv[:, 1].min(), 4.0)  # 2 m over 0.5 m tiles, along v
        self.assertAlmostEqual(uv[:, 0].max() - uv[:, 0].min(), 0.2)

    def test_box_uvs_follow_the_objects_scale(self):
        co = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], float)
        uv = tiles.box_uvs(co, np.tile([0, 0, 1.0], (4, 1)), (3, 1, 1), 1.0)
        self.assertAlmostEqual(uv[:, 1].max() - uv[:, 1].min(), 3.0)


if __name__ == "__main__":
    unittest.main()
