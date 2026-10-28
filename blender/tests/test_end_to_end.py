import json
import os
import tempfile
import unittest

import bpy
import numpy as np

from pipeline import bpyutil, checks, manifest, raster, run
from tests import fixture_scene


class EndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        root = tempfile.mkdtemp()
        cls.out = os.path.join(root, "assets")
        cls.build = os.path.join(root, "build")
        cls.errors = run.run_all("test", cls.out, cls.build, expected_doors=1)

    def test_no_check_errors(self):
        self.assertEqual(self.errors, [])

    def test_outputs(self):
        for name in ("apartment.glb", "manifest.json", "collision.json"):
            self.assertTrue(os.path.exists(os.path.join(self.out, name)), name)
        self.assertTrue(os.path.exists(os.path.join(self.build, "web-export.blend")))
        self.assertTrue(os.path.exists(os.path.join(self.build, "debug_map.png")))

    def test_manifest_content(self):
        with open(os.path.join(self.out, "manifest.json")) as f:
            m = json.load(f)
        self.assertEqual([r["id"] for r in m["rooms"]], ["alpha", "beta"])
        self.assertEqual({c["node"] for c in m["chunks"]}, {"Room_alpha", "Room_beta", "Room_exterior"})
        self.assertAlmostEqual(m["spawn"]["yaw"], -1.5708, places=3)  # Cam_Entrada looks +X
        self.assertEqual([v["name"] for v in m["viewpoints"]], ["Cam_Sala"])
        self.assertEqual(m["version"], 3)
        self.assertEqual([g["id"] for g in m["groups"]], ["alpha", "alpha/desk-lamp", "beta", "beta/tv"])
        self.assertEqual(m["screens"][0]["group"], "beta/tv")
        self.assertNotIn("blender", m["screens"][0])
        self.assertEqual(m["groups"][1]["target"], "Lamp_alpha-desk-lamp")
        self.assertEqual(sorted(mv["node"] for mv in m["movables"]), ["Move_cabinet-door", "Move_cabinet-drawer"])
        self.assertEqual([s["node"] for s in m["screens"]], ["Screen_beta-tv"])
        self.assertEqual(m["glows"], [{"node": "Glow_desk-lamp-bulb", "group": "alpha/desk-lamp"}])
        alpha = next(c for c in m["chunks"] if c["room"] == "alpha")
        self.assertEqual([l.get("group") for p in alpha["packs"] for l in p["layers"]][:1], ["alpha/desk-lamp"])

    def test_glb_nodes_have_identity_transforms(self):
        gltf = checks.read_glb_json(os.path.join(self.out, "apartment.glb"))
        for n in gltf["nodes"]:
            if n["name"].startswith(("Room_", "Door_", "Move_")):
                for v, ident in ((n.get("scale"), [1, 1, 1]), (n.get("rotation"), [0, 0, 0, 1])):
                    if v is not None:
                        self.assertTrue(all(abs(a - b) < 1e-4 for a, b in zip(v, ident)), n)

    def test_glb_has_lightmap_uvs(self):
        gltf = checks.read_glb_json(os.path.join(self.out, "apartment.glb"))
        names = {n["name"] for n in gltf["nodes"]}
        self.assertTrue({"Room_alpha", "Door_1", "Switch_alpha", "Screen_beta-tv", "Glow_desk-lamp-bulb",
                         "Lamp_alpha-desk-lamp"} <= names)
        for name in ("Room_alpha", "Room_beta", "Room_exterior", "Door_1", "Move_cabinet-drawer", "Move_cabinet-door"):
            node = next(n for n in gltf["nodes"] if n["name"] == name)
            prims = gltf["meshes"][node["mesh"]]["primitives"]
            self.assertTrue(prims, name)
            for p in prims:
                self.assertIn("TEXCOORD_1", p["attributes"], name)

    def test_props(self):
        with open(os.path.join(self.out, "manifest.json")) as f:
            m = json.load(f)
        self.assertEqual(manifest.validate_manifest(m), [])
        self.assertEqual([(p["node"], p["name"], p["room"], p["tips"]) for p in m["props"]],
                         [("Prop_test-bottle", "bottle", "alpha", False), ("Prop_test-mug", "mug", "alpha", False)])
        gltf = checks.read_glb_json(os.path.join(self.out, "apartment.glb"))
        names = {n["name"] for n in gltf["nodes"]}
        self.assertTrue({"Prop_test-mug", "Prop_test-bottle"} <= names)
        # Its own node, so in no chunk: no room has a vertex where the mug stands, above the floor's top.
        for c in [n for n in names if n.startswith("Room_")]:
            co = bpyutil.world_coords(bpy.data.objects[c])
            inside = ((co[:, 0] > 0.65) & (co[:, 0] < 0.75) & (co[:, 1] > 1.45) & (co[:, 1] < 1.55)
                      & (co[:, 2] > 0.03) & (co[:, 2] < 0.12))
            self.assertFalse(inside.any(), c)

    def test_props_never_block_the_way(self):
        with open(os.path.join(self.out, "collision.json")) as f:
            g = json.load(f)
        blocked = raster.rle_decode(g["runs"], g["width"] * g["height"]).reshape(g["height"], g["width"])
        for x, z in ((0.7, -1.5), (0.7, -2.0)):  # under the mug and the bottle (three.js x, z)
            i, j = int(np.floor((x - g["x0"]) / g["cell"])), int(np.floor((z - g["z0"]) / g["cell"]))
            self.assertFalse(blocked[j, i], (x, z))


if __name__ == "__main__":
    unittest.main()
