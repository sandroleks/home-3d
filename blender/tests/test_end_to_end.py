import json
import os
import tempfile
import unittest

import bpy

from pipeline import checks, run
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

    def test_glb_nodes_have_identity_transforms(self):
        gltf = checks.read_glb_json(os.path.join(self.out, "apartment.glb"))
        for n in gltf["nodes"]:
            if n["name"].startswith(("Room_", "Door_")):
                for v, ident in ((n.get("scale"), [1, 1, 1]), (n.get("rotation"), [0, 0, 0, 1])):
                    if v is not None:
                        self.assertTrue(all(abs(a - b) < 1e-4 for a, b in zip(v, ident)), n)

    def test_glb_has_lightmap_uvs(self):
        gltf = checks.read_glb_json(os.path.join(self.out, "apartment.glb"))
        names = {n["name"] for n in gltf["nodes"]}
        self.assertTrue({"Room_alpha", "Door_1", "Switch_alpha"} <= names)
        for name in ("Room_alpha", "Room_beta", "Room_exterior", "Door_1"):
            node = next(n for n in gltf["nodes"] if n["name"] == name)
            prims = gltf["meshes"][node["mesh"]]["primitives"]
            self.assertTrue(prims, name)
            for p in prims:
                self.assertIn("TEXCOORD_1", p["attributes"], name)


if __name__ == "__main__":
    unittest.main()
