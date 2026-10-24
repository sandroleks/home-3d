import unittest

import numpy as np

from pipeline import layers, packs


class PackTests(unittest.TestCase):
    def setUp(self):
        y, x = np.mgrid[0:16, 0:16].astype(np.float64)
        self.mask = np.ones((16, 16), bool)
        self.mask[:2] = False
        self.warm = np.stack([x / 4, x / 6, x / 12], axis=-1)
        self.cool = np.stack([y / 20, y / 16, y / 8], axis=-1)

    def test_round_trip_and_meta(self):
        rgba, metas = packs.pack([self.warm, self.cool], self.mask)
        self.assertEqual(rgba.shape, (16, 16, 4))
        self.assertTrue(np.all(rgba[~self.mask] == 0))
        self.assertTrue(np.all(rgba[self.mask][:, 3] == 1))  # opaque, or WebP drops the colour
        np.testing.assert_allclose(rgba * 255, np.round(rgba * 255), atol=1e-4)
        lum = packs.unpack(rgba, metas)
        for got, want in zip(lum, (packs.luminance(self.warm), packs.luminance(self.cool))):
            peak = want[self.mask].max()
            self.assertLess(np.abs(got - want)[self.mask].max(), 0.02 * peak)
        (rng, tint), _ = metas
        self.assertAlmostEqual(rng, packs.luminance(self.warm)[self.mask].max(), delta=0.01 * rng)
        self.assertAlmostEqual(float(packs.luminance(np.array(tint))), 1.0, places=3)
        self.assertGreater(tint[0], tint[2])  # warm light keeps its colour

    def test_dark_layers(self):
        self.assertIsNone(packs.layer_meta(np.zeros((4, 4, 3)), np.ones((4, 4), bool)))
        with self.assertRaises(ValueError):
            packs.pack([np.zeros((4, 4, 3))], np.ones((4, 4), bool))
        with self.assertRaises(ValueError):
            packs.pack([self.warm] * 4, self.mask)

    def test_in_packs(self):
        self.assertEqual(packs.in_packs(list(range(7))), [[0, 1, 2], [3, 4, 5], [6]])
        self.assertEqual(packs.in_packs([]), [])


class LayerPlanTests(unittest.TestCase):
    GROUPS = [
        {"id": "sala", "room": "sala", "kind": "switch"},
        {"id": "sala/floor-lamp", "room": "sala", "kind": "lamp"},
        {"id": "cozinha", "room": "cozinha", "kind": "switch"},
        {"id": "cozinha/pendants", "room": "cozinha", "kind": "lamp"},
        {"id": "hall", "room": "hall", "kind": "switch"},
    ]
    CHUNKS = [{"key": "sala", "room": "sala"}, {"key": "cozinha", "room": "cozinha"},
              {"key": "hall", "room": "hall"}, {"key": "varanda", "room": "varanda"},
              {"key": "exterior", "room": None}]
    DOORS = [{"key": "door-1", "rooms": ["hall", "sala"], "opening": 1},
             {"key": "door-4a", "rooms": ["sala", "varanda"], "opening": 4},
             {"key": "door-4b", "rooms": ["sala", "varanda"], "opening": 4}]

    def plan(self):
        return layers.plan(self.GROUPS, self.CHUNKS, self.DOORS, ["cozinha"], {"sala": ["cozinha"], "cozinha": ["sala"]})

    def test_chunks(self):
        p = self.plan()
        self.assertEqual(p["sala"]["light"], "sala")
        self.assertEqual(p["sala"]["packed"], [
            {"group": "sala/floor-lamp"}, {"group": "cozinha"}, {"group": "cozinha/pendants"},
            {"spill": {"opening": 1, "from": "hall"}},
        ])
        self.assertEqual(p["hall"]["packed"], [{"spill": {"opening": 1, "from": "sala"}}])
        # an unlit room gets light only through its doors; a double door counts once
        self.assertEqual(p["varanda"], {"light": None, "packed": [{"spill": {"opening": 4, "from": "sala"}}]})
        self.assertEqual(p["exterior"], {"light": None, "packed": []})

    def test_doors_and_movables(self):
        p = self.plan()
        self.assertEqual(p["door-1"]["packed"], [{"group": "hall"}, {"group": "sala"}, {"group": "sala/floor-lamp"}])
        self.assertEqual(p["door-4b"]["packed"], [{"group": "sala"}, {"group": "sala/floor-lamp"}])
        self.assertEqual(p["movables-cozinha"]["packed"], [{"group": "cozinha"}, {"group": "cozinha/pendants"},
                                                           {"group": "sala"}])

    def test_keys(self):
        self.assertEqual(layers.layer_key({"group": "sala"}), "sala")
        self.assertEqual(layers.layer_key({"spill": {"opening": 4, "from": "sala"}}), "spill-4-sala")
        self.assertEqual(len(layers.spills(self.DOORS)), 4)


if __name__ == "__main__":
    unittest.main()
