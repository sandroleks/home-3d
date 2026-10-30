import copy
import unittest

from pipeline import config, manifest

STATE = {
    "rooms": [
        {"id": "alpha", "name": "Alpha", "floor": [0, 0, 1, 0, 1, 1], "light": "Ceiling light Alpha"},
        {"id": "porch", "name": "Porch", "floor": [2, 0, 3, 0, 3, 1], "light": None},
    ],
    "switches": {"alpha": "Switch_alpha"},
    "groups": [
        {"id": "alpha", "room": "alpha", "kind": "switch", "name": "light", "lights": ["Ceiling light Alpha"], "power": 50.0},
        {"id": "alpha/desk-lamp", "room": "alpha", "kind": "lamp", "name": "desk-lamp", "lights": ["Desk"], "power": 10.0},
    ],
    "chunks": [
        {"node": "Room_alpha", "room": "alpha", "key": "alpha", "size": 64},
        {"node": "Room_porch", "room": "porch", "key": "porch", "size": 64, "neighbours": ["alpha"]},
        {"node": "Room_exterior", "room": None, "key": "exterior", "size": 64},
    ],
    "doors": [{"node": "Door_1", "key": "door-1", "hinge": [3.1, -1.78], "dir": [0, 1], "width": 0.76, "openAngle": -1.5708,
               "opening": 1, "rooms": ["alpha", "porch"]}],
    "movables": [
        {"node": "Move_drawer", "room": "alpha", "kind": "slide", "dir": [0, 0, 1], "distance": 0.35, "source": "Drawer"},
        {"node": "Move_door", "room": "alpha", "kind": "hinge", "pivot": [1, 0.2, -2], "axis": [0, 1, 0], "angle": -1.7,
         "source": "Door"},
    ],
    "screens": [{"node": "Screen_alpha-tv", "room": "alpha", "kind": "tv", "group": None, "center": [1, 1, -1],
                 "normal": [0, 0, 1], "width": 0.8, "height": 0.45}],
    "glows": [{"node": "Glow_bulb", "group": "alpha/desk-lamp"}],
    "props": [{"source": "Mug", "node": "Prop_mug", "name": "mug", "room": "alpha", "size": [0.08, 0.09, 0.08],
               "tips": False}],
    "instruments": [{"name": "Piano", "kind": "piano", "room": "alpha", "min": [0.1, 0.0, -0.9], "max": [0.9, 1.0, -0.5],
                     "at": [0.5, 0.5, -0.7]}],
    "spawn": {"x": 1.0, "z": -0.8, "yaw": -1.5708},
    "viewpoints": [],
    "windows": [{"room": "alpha", "center": [0.5, 1.5, 0.0], "normal": [0.0, 0.0, 1.0], "width": 1.0, "height": 1.2}],
    "sky_irradiance": 0.6467,
}
PACK = {"file": "lightmaps/porch_pack0.webp", "layers": [
    {"group": "alpha", "range": 1.5, "tint": [1.1, 0.95, 0.8]},
    {"spill": {"opening": 1, "from": "alpha"}, "range": 0.4, "tint": [1.0, 1.0, 1.0]},
]}
BAKED = {
    "rgbm": {"alpha_day": 4.0, "alpha_light": 2.0, "porch_day": 3.0, "exterior_day": 8.0, "door-1_day": 2.5,
             "movables-alpha_day": 1.5},
    "packs": {"porch": [PACK], "movables-alpha": [{"file": "lightmaps/movables-alpha_pack0.webp", "layers": [
        {"group": "alpha", "range": 2.0, "tint": [1, 1, 1]}]}]},
}


def build(state=STATE, baked=BAKED):
    return manifest.build_manifest(state, baked, 1.6, {"alpha/desk-lamp": "Lamp_alpha-desk-lamp"})


class ManifestTests(unittest.TestCase):
    def test_build(self):
        m = build()
        self.assertEqual(m["version"], 3)
        self.assertEqual(m["rooms"][0], {"id": "alpha", "name": "Alpha", "floor": [0, 0, 1, 0, 1, 1],
                                         "switch": "Switch_alpha", "area": 0.5})
        self.assertEqual(m["site"], config.SITE)
        self.assertEqual(m["sky"], {"irradiance": 0.6467, "wattsToScene": config.WATTS_TO_SCENE})
        self.assertEqual(m["windows"], STATE["windows"])
        self.assertEqual(m["rooms"][1]["switch"], None)
        self.assertEqual(m["groups"], [
            {"id": "alpha", "room": "alpha", "kind": "switch", "name": "light", "power": 50.0, "target": "Switch_alpha"},
            {"id": "alpha/desk-lamp", "room": "alpha", "kind": "lamp", "name": "desk-lamp", "power": 10.0,
             "target": "Lamp_alpha-desk-lamp"},
        ])
        self.assertEqual(m["chunks"][0]["light"], {"file": "lightmaps/alpha_light.webp", "range": 2.0})
        self.assertIsNone(m["chunks"][1]["light"])
        self.assertEqual(m["chunks"][1]["packs"], [PACK])
        self.assertEqual(m["chunks"][0]["packs"], [])
        self.assertEqual(m["doors"][0]["lightmap"], {"file": "lightmaps/door-1_day.webp", "range": 2.5})
        self.assertEqual(m["doors"][0]["opening"], 1)
        self.assertNotIn("key", m["doors"][0])
        self.assertEqual(m["movables"][0], {"node": "Move_drawer", "room": "alpha", "kind": "slide", "dir": [0, 0, 1],
                                            "distance": 0.35, "lightmap": {"file": "lightmaps/movables-alpha_day.webp",
                                                                           "range": 1.5},
                                            "packs": BAKED["packs"]["movables-alpha"]})
        self.assertEqual(set(m["movables"][1]) - {"lightmap", "packs"}, {"node", "room", "kind", "pivot", "axis", "angle"})
        self.assertEqual(m["screens"], STATE["screens"])
        self.assertEqual(m["glows"], STATE["glows"])
        self.assertEqual(m["props"], [{"node": "Prop_mug", "name": "mug", "room": "alpha", "size": [0.08, 0.09, 0.08],
                                       "tips": False}])
        self.assertEqual(manifest.validate_manifest(m), [])

    def test_sliding_door_and_turntable(self):
        state = copy.deepcopy(STATE)
        state["doors"][0]["slide"] = {"dir": [-1.0, 0.0], "distance": 0.62}
        state["doors"][0]["openAngle"] = 0.0
        state["movables"].append({"node": "Move_turntable-platter", "room": "alpha", "kind": "spin", "pivot": [1, 1, -2],
                                  "axis": [0, -1, 0], "rpm": 33.333, "source": "Turntable platter"})
        m = build(state)
        self.assertEqual(m["doors"][0]["slide"], {"dir": [-1.0, 0.0], "distance": 0.62})
        self.assertNotIn("slide", build()["doors"][0])
        self.assertEqual({k: v for k, v in m["movables"][2].items() if k not in ("lightmap", "packs")},
                         {"node": "Move_turntable-platter", "room": "alpha", "kind": "spin", "pivot": [1, 1, -2],
                          "axis": [0, -1, 0], "rpm": 33.333})
        self.assertEqual(manifest.validate_manifest(m), [])

    def test_validate_reports_missing_pieces(self):
        baked = copy.deepcopy(BAKED)
        del baked["rgbm"]["alpha_light"]
        self.assertIn("chunks[0] (Room_alpha): room has a switch but no light lightmap", manifest.validate_manifest(build(baked=baked)))
        baked = copy.deepcopy(BAKED)
        del baked["rgbm"]["porch_day"]
        self.assertIn("chunks[1] (Room_porch): missing day lightmap", manifest.validate_manifest(build(baked=baked)))
        baked = copy.deepcopy(BAKED)
        del baked["rgbm"]["movables-alpha_day"]
        self.assertIn("movables[0] (Move_drawer): missing lightmap", manifest.validate_manifest(build(baked=baked)))

    def test_validate_reports_bad_packs(self):
        baked = copy.deepcopy(BAKED)
        baked["packs"]["porch"][0]["layers"][0]["group"] = "attic"
        errors = manifest.validate_manifest(build(baked=baked))
        self.assertIn("chunks[1] (Room_porch): lightmaps/porch_pack0.webp names unknown group attic", errors)
        baked = copy.deepcopy(BAKED)
        baked["packs"]["porch"] = [PACK] * (config.MAX_PACKS + 1)
        self.assertIn(f"chunks[1] (Room_porch): {config.MAX_PACKS + 1} lamp packs, the viewer binds {config.MAX_PACKS}",
                      manifest.validate_manifest(build(baked=baked)))
        baked = copy.deepcopy(BAKED)
        baked["packs"]["porch"][0]["layers"][1]["spill"]["opening"] = 9
        self.assertTrue(any("spill layer from nowhere" in e for e in manifest.validate_manifest(build(baked=baked))))

    def test_validate_reports_unknown_groups(self):
        state = dict(STATE, glows=[{"node": "Glow_x", "group": "nope"}],
                     screens=[dict(STATE["screens"][0], group="alpha/tv")])
        errors = manifest.validate_manifest(build(state))
        self.assertIn("glows[0] (Glow_x): unknown group nope", errors)
        self.assertIn("screens[0] (Screen_alpha-tv): unknown group alpha/tv", errors)

    def test_props(self):
        self.assertEqual(build(dict(STATE, props=[]))["props"], [])
        outside = dict(STATE["props"][0], node="Prop_pot", room=None)  # on a sill, past every floor
        self.assertEqual(manifest.validate_manifest(build(dict(STATE, props=STATE["props"] + [outside]))), [])
        bad = [dict(STATE["props"][0], room="attic"), dict(STATE["props"][0], size=[0.1, 0.0, 0.1]),
               dict(STATE["props"][0], size=[0.1, 0.1]), dict(STATE["props"][0], name="")]
        errors = manifest.validate_manifest(build(dict(STATE, props=bad)))
        self.assertIn("props[0] (Prop_mug): unknown room attic", errors)
        self.assertIn("props[1] (Prop_mug): size must be three positive numbers", errors)
        self.assertIn("props[2] (Prop_mug): size must be three positive numbers", errors)
        self.assertIn("props[3] (Prop_mug): no name", errors)

    def test_instruments(self):
        self.assertEqual(build()["instruments"], STATE["instruments"])
        self.assertEqual(build({k: v for k, v in STATE.items() if k != "instruments"})["instruments"], [])
        self.assertEqual(manifest.validate_manifest(build()), [])
        ok = STATE["instruments"][0]
        bad = [dict(ok, room="attic"), dict(ok, name="Harp", kind="harp"), dict(ok, name="Flat", max=[0.9, 0.0, -0.5])]
        errors = manifest.validate_manifest(build(dict(STATE, instruments=bad)))
        self.assertIn("instruments[0] (Piano): unknown room attic", errors)
        self.assertIn("instruments[1] (Harp): unknown kind harp", errors)
        self.assertIn("instruments[2] (Flat): an empty box", errors)
        self.assertIn("two instruments share a name", manifest.validate_manifest(build(dict(STATE, instruments=[ok, ok]))))
        loose = dict(ok, name="Ukulele", kind="ukulele", prop="Prop_mug")
        self.assertEqual(manifest.validate_manifest(build(dict(STATE, instruments=[ok, loose]))), [])
        errors = manifest.validate_manifest(build(dict(STATE, instruments=[dict(loose, prop="Prop_harp")])))
        self.assertIn("instruments[0] (Ukulele): unknown prop Prop_harp", errors)

    def test_validate_reports_lit_room_without_switch_and_room_without_chunk(self):
        state = dict(STATE, switches={})
        self.assertIn("room alpha: has a light layer but no switch", manifest.validate_manifest(build(state)))
        state = dict(STATE, chunks=[c for c in STATE["chunks"] if c["room"] != "porch"])
        self.assertIn("room porch: no chunk", manifest.validate_manifest(build(state)))

    def test_validate_reports_window_problems(self):
        self.assertIn("no exterior windows: name the glass 'Window N (Exterior / Room) glass'",
                      manifest.validate_manifest(build(dict(STATE, windows=[]))))
        bad = [dict(STATE["windows"][0], room="attic")]
        self.assertIn("windows[0]: unknown room attic", manifest.validate_manifest(build(dict(STATE, windows=bad))))


if __name__ == "__main__":
    unittest.main()
