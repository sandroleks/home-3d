import json
import os
import struct
import tempfile
import unittest

from pipeline import checks, manifest

STATE = {
    "rooms": [{"id": "alpha", "name": "Alpha", "floor": [0, 0, 1, 0, 1, 1], "light": "L"}],
    "switches": {"alpha": "Switch_alpha"},
    "groups": [{"id": "alpha", "room": "alpha", "kind": "switch", "name": "light", "lights": ["L"], "power": 1.0}],
    "chunks": [{"node": "Room_alpha", "room": "alpha", "key": "alpha", "size": 64}],
    "doors": [{"node": "Door_1", "key": "door-1", "hinge": [0, 0], "dir": [0, 1], "width": 0.76, "openAngle": -1.5,
               "opening": 1}],
    "movables": [{"node": "Move_drawer", "room": "alpha", "kind": "slide", "dir": [0, 0, 1], "distance": 0.3}],
    "spawn": {"x": 0.0, "z": 0.0, "yaw": 0.0},
    "viewpoints": [],
    "windows": [{"room": "alpha", "center": [0.5, 1.5, 0.0], "normal": [0.0, 0.0, 1.0], "width": 1.0, "height": 1.2}],
    "sky_irradiance": 0.6467,
}
BAKED = {"rgbm": {"alpha_day": 4.0, "alpha_light": 2.0, "door-1_day": 2.5, "movables-alpha_day": 1.0},
         "packs": {"door-1": [{"file": "lightmaps/door-1_pack0.webp",
                               "layers": [{"group": "alpha", "range": 1.0, "tint": [1, 1, 1]}]}]}}


def good_gltf():
    prim = {"attributes": {"POSITION": 0, "TEXCOORD_0": 1, "TEXCOORD_1": 2}}
    return {
        "nodes": [{"name": "Room_alpha", "mesh": 0}, {"name": "Door_1", "mesh": 1}, {"name": "Switch_alpha", "mesh": 2},
                  {"name": "Move_drawer", "mesh": 3}],
        "meshes": [{"primitives": [dict(prim)]} for _ in range(4)],
    }


def write_set(gltf, state=STATE):
    out = tempfile.mkdtemp()
    m = manifest.build_manifest(state, BAKED, 1.6)
    body = json.dumps(gltf).encode()
    body += b" " * (-len(body) % 4)
    with open(os.path.join(out, "apartment.glb"), "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 20 + len(body)))
        f.write(struct.pack("<I4s", len(body), b"JSON") + body)
    os.makedirs(os.path.join(out, "lightmaps"))
    refs = [c[k] for c in m["chunks"] for k in ("day", "light")] + [d["lightmap"] for d in m["doors"] + m["movables"]] + [
        p for x in m["chunks"] + m["doors"] + m["movables"] for p in x["packs"]]
    for ref in refs:
        if ref:
            open(os.path.join(out, ref["file"]), "wb").close()
    for name in ("collision.json", "manifest.json"):
        open(os.path.join(out, name), "wb").close()
    return out, m


BUDGET = 10 * 1024 * 1024


class SanitizedNameTests(unittest.TestCase):
    def test_sanitized(self):
        self.assertEqual(checks.sanitized_node_name("Room_sala.001"), "Room_sala001")
        self.assertEqual(checks.sanitized_node_name("Room sala"), "Room_sala")
        for n in ("Room_quarto-01", "Door_10", "Switch_wc-01"):
            self.assertEqual(checks.sanitized_node_name(n), n)


class CheckOutputsTests(unittest.TestCase):
    def test_clean(self):
        out, m = write_set(good_gltf())
        self.assertEqual(checks.check_outputs(out, m, BUDGET, 1), [])

    def test_missing_texcoord_1(self):
        g = good_gltf()
        del g["meshes"][0]["primitives"][0]["attributes"]["TEXCOORD_1"]
        out, m = write_set(g)
        errors = checks.check_outputs(out, m, BUDGET, 1)
        self.assertTrue(any("lacks TEXCOORD_1" in e and "Room_alpha" in e for e in errors), errors)

    def test_missing_pack_file(self):
        out, m = write_set(good_gltf())
        os.remove(os.path.join(out, "lightmaps", "door-1_pack0.webp"))
        self.assertIn("missing file lightmaps/door-1_pack0.webp", checks.check_outputs(out, m, BUDGET, 1))

    def test_movable_needs_lightmap_uvs(self):
        g = good_gltf()
        del g["meshes"][3]["primitives"][0]["attributes"]["TEXCOORD_1"]
        out, m = write_set(g)
        errors = checks.check_outputs(out, m, BUDGET, 1)
        self.assertTrue(any("lacks TEXCOORD_1" in e and "Move_drawer" in e for e in errors), errors)

    def test_door_count_mismatch(self):
        out, m = write_set(good_gltf())
        self.assertIn("expected 2 doors, found 1", checks.check_outputs(out, m, BUDGET, 2))

    def test_missing_switch_node(self):
        g = good_gltf()
        g["nodes"] = g["nodes"][:2]
        out, m = write_set(g)
        self.assertIn("glb has no switch node Switch_alpha", checks.check_outputs(out, m, BUDGET, 1))

    def test_budget_overrun(self):
        out, m = write_set(good_gltf())
        errors = checks.check_outputs(out, m, 1, 1)
        self.assertTrue(any("first-view download" in e for e in errors), errors)

    def test_scaled_or_rotated_node(self):
        for key, value in (("scale", [0.001, 0.001, 0.001]), ("rotation", [0, 0.7071, 0, 0.7071])):
            g = good_gltf()
            g["nodes"][0][key] = value
            out, m = write_set(g)
            self.assertIn("glb node Room_alpha has a non-identity scale/rotation",
                          checks.check_outputs(out, m, BUDGET, 1), key)
        g = good_gltf()
        g["nodes"][1]["scale"] = [1, 1, 1]
        g["nodes"][1]["rotation"] = [0, 0, 0, 1]
        out, m = write_set(g)
        self.assertEqual(checks.check_outputs(out, m, BUDGET, 1), [])

    def test_unsafe_node_name(self):
        state = dict(STATE, chunks=[dict(STATE["chunks"][0], node="Room_alpha.001")])
        g = good_gltf()
        g["nodes"][0]["name"] = "Room_alpha.001"
        out, m = write_set(g, state)
        self.assertIn("node name 'Room_alpha.001' changes to 'Room_alpha001' in three.js",
                      checks.check_outputs(out, m, BUDGET, 1))


if __name__ == "__main__":
    unittest.main()
