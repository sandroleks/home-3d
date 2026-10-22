import json
import os
import unittest

import numpy as np

from pipeline import raster

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "..", "shared", "fixtures", "rle.json")


class TextureSizeTests(unittest.TestCase):
    def test_powers_of_two_within_bounds(self):
        self.assertEqual(raster.texture_size_for_area(1.0, 256, 64, 2048), 256)
        self.assertEqual(raster.texture_size_for_area(150.0, 100, 512, 2048), 2048)
        self.assertEqual(raster.texture_size_for_area(0.0, 100, 512, 2048), 512)
        self.assertEqual(raster.texture_size_for_area(10000.0, 100, 512, 2048), 2048)


class RgbmTests(unittest.TestCase):
    def test_round_trip_error_relative_to_pixel_peak(self):
        # RGBM shares one multiplier per pixel, so every channel's error scales with the
        # pixel's brightest channel, not with the channel itself.
        rng = np.random.default_rng(3)
        rgb = rng.uniform(0.05, 6.0, (32, 32, 3))
        rgba, r = raster.rgbm_encode(rgb)
        self.assertGreaterEqual(r, 6.0)
        back = raster.rgbm_decode(rgba, r)
        peak = np.maximum(rgb.max(axis=-1, keepdims=True), 0.05 * r)
        self.assertLess((np.abs(back - rgb) / peak).max(), 0.01)

    def test_masked_pixels_are_zero_and_range_ignores_them(self):
        rgb = np.full((4, 4, 3), 2.0)
        rgb[0, 0] = 500.0
        mask = np.ones((4, 4), bool)
        mask[0, 0] = False
        rgba, r = raster.rgbm_encode(rgb, mask)
        self.assertEqual(r, 2.0)
        self.assertTrue(np.all(rgba[0, 0] == 0))

    def test_range_is_at_least_one(self):
        _, r = raster.rgbm_encode(np.full((2, 2, 3), 0.1))
        self.assertEqual(r, 1.0)


class BlurTests(unittest.TestCase):
    def test_constant_stays_constant(self):
        rgb = np.full((16, 16, 3), 0.7)
        out = raster.masked_blur(rgb, np.ones((16, 16), bool), 1.0)
        np.testing.assert_allclose(out, 0.7, atol=1e-5)

    def test_masked_out_values_do_not_leak(self):
        rgb = np.full((16, 16, 3), 1.0)
        mask = np.ones((16, 16), bool)
        mask[:, 8:] = False
        rgb[:, 8:] = 100.0
        out = raster.masked_blur(rgb, mask, 1.5)
        np.testing.assert_allclose(out[:, :8], 1.0, atol=1e-5)


class DilateTests(unittest.TestCase):
    def test_disk(self):
        m = np.zeros((9, 9), bool)
        m[4, 4] = True
        self.assertEqual(int(raster.dilate(m, 2).sum()), 13)


class RleTests(unittest.TestCase):
    def test_shared_cases(self):
        with open(FIXTURE) as f:
            cases = json.load(f)["cases"]
        for case in cases:
            self.assertEqual(raster.rle_encode(case["data"]), case["runs"])
            self.assertEqual(raster.rle_decode(case["runs"], len(case["data"])).astype(int).tolist(), case["data"])

    def test_two_dimensional_is_row_major(self):
        grid = np.array([[0, 1], [1, 1]], bool)
        self.assertEqual(raster.rle_encode(grid), [1, 3])


if __name__ == "__main__":
    unittest.main()
