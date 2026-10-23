import unittest

from pipeline import config, manifest

STATE = {
    "rooms": [
        {"id": "alpha", "name": "Alpha", "floor": [0, 0, 1, 0, 1, 1], "light": "Ceiling light Alpha"},
        {"id": "porch", "name": "Porch", "floor": [2, 0, 3, 0, 3, 1], "light": None},
    ],
    "switches": {"alpha": "Switch_alpha"},
    "chunks": [
        {"node": "Room_alpha", "room": "alpha", "key": "alpha", "size": 64},
        {"node": "Room_porch", "room": "porch", "key": "porch", "size": 64},
        {"node": "Room_exterior", "room": None, "key": "exterior", "size": 64},
    ],
    "doors": [{"node": "Door_1", "key": "door-1", "hinge": [3.1, -1.78], "dir": [0, 1], "width": 0.76, "openAngle": -1.5708}],
    "spawn": {"x": 1.0, "z": -0.8, "yaw": -1.5708},
    "viewpoints": [],
    "windows": [{"room": "alpha", "center": [0.5, 1.5, 0.0], "normal": [0.0, 0.0, 1.0], "width": 1.0, "height": 1.2}],
    "sky_irradiance": 0.6467,
}
RANGES = {"alpha_day": 4.0, "alpha_light": 2.0, "porch_day": 3.0, "exterior_day": 8.0, "door-1_day": 2.5}


class ManifestTests(unittest.TestCase):
    def test_build(self):
        m = manifest.build_manifest(STATE, RANGES, 1.6)
        self.assertEqual(m["version"], 2)
        self.assertEqual(m["rooms"][0], {"id": "alpha", "name": "Alpha", "floor": [0, 0, 1, 0, 1, 1],
                                         "switch": "Switch_alpha", "area": 0.5})
        self.assertEqual(m["site"], config.SITE)
        self.assertEqual(m["sky"], {"irradiance": 0.6467, "wattsToScene": config.WATTS_TO_SCENE})
        self.assertEqual(m["windows"], STATE["windows"])
        self.assertEqual(m["rooms"][1]["switch"], None)
        self.assertEqual(m["chunks"][0]["light"], {"file": "lightmaps/alpha_light.webp", "range": 2.0})
        self.assertIsNone(m["chunks"][1]["light"])
        self.assertEqual(m["doors"][0]["lightmap"], {"file": "lightmaps/door-1_day.webp", "range": 2.5})
        self.assertNotIn("key", m["doors"][0])
        self.assertEqual(manifest.validate_manifest(m), [])

    def test_validate_reports_missing_pieces(self):
        m = manifest.build_manifest(STATE, {k: v for k, v in RANGES.items() if k != "alpha_light"}, 1.6)
        errors = manifest.validate_manifest(m)
        self.assertIn("chunks[0] (Room_alpha): room has a switch but no light lightmap", errors)
        m2 = manifest.build_manifest(STATE, {k: v for k, v in RANGES.items() if k != "porch_day"}, 1.6)
        self.assertIn("chunks[1] (Room_porch): missing day lightmap", manifest.validate_manifest(m2))

    def test_validate_reports_lit_room_without_switch_and_room_without_chunk(self):
        state = dict(STATE, switches={})
        self.assertIn("room alpha: has a light layer but no switch",
                      manifest.validate_manifest(manifest.build_manifest(state, RANGES, 1.6)))
        state = dict(STATE, chunks=[c for c in STATE["chunks"] if c["room"] != "porch"])
        self.assertIn("room porch: no chunk",
                      manifest.validate_manifest(manifest.build_manifest(state, RANGES, 1.6)))

    def test_validate_reports_window_problems(self):
        self.assertIn("no exterior windows: name the glass 'Window N (Exterior / Room) glass'",
                      manifest.validate_manifest(manifest.build_manifest(dict(STATE, windows=[]), RANGES, 1.6)))
        bad = [dict(STATE["windows"][0], room="attic")]
        self.assertIn("windows[0]: unknown room attic",
                      manifest.validate_manifest(manifest.build_manifest(dict(STATE, windows=bad), RANGES, 1.6)))


if __name__ == "__main__":
    unittest.main()
