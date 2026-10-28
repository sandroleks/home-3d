import unittest

import bpy
import numpy as np

from pipeline import bpyutil, geom, props, rooms, scene_select
from tests import fixture_scene


class PrepareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        objs = props.find(meshes)
        cls.names = sorted(o.name for o in objs)
        cls.before = {o.name: bpyutil.world_coords(o) for o in objs}
        cls.specs = {s["source"]: s for s in props.prepare_props(objs, index)}

    def test_found_and_renamed(self):
        self.assertEqual(self.names, ["Test bottle", "Test mug"])
        self.assertEqual(self.specs["Test mug"]["node"], "Prop_test-mug")
        self.assertEqual(self.specs["Test bottle"]["node"], "Prop_test-bottle")
        for name in ("Prop_test-mug", "Prop_test-bottle"):
            self.assertIn(name, bpy.data.objects)
        self.assertNotIn("Test mug", bpy.data.objects)

    def test_origin_at_the_middle_of_the_base(self):
        for node, (x, y) in (("Prop_test-mug", (0.7, 1.5)), ("Prop_test-bottle", (0.7, 2.0))):
            loc = bpy.data.objects[node].location
            self.assertAlmostEqual(loc.x, x, places=4, msg=node)
            self.assertAlmostEqual(loc.y, y, places=4, msg=node)
            self.assertAlmostEqual(loc.z, 0.02, places=4, msg=node)  # standing on the floor's top

    def test_geometry_stays_put_in_the_world(self):
        for source, spec in self.specs.items():
            after = bpyutil.world_coords(bpy.data.objects[spec["node"]])
            np.testing.assert_allclose(after, self.before[source], atol=1e-5, err_msg=source)
            local = np.array([v.co for v in bpy.data.objects[spec["node"]].data.vertices])
            self.assertAlmostEqual(float(local[:, 2].min()), 0.0, places=5)  # the base is at the origin

    def test_never_baked(self):
        for spec in self.specs.values():
            self.assertTrue(bpy.data.objects[spec["node"]].hide_render, spec["node"])

    def test_spec(self):
        mug, bottle = self.specs["Test mug"], self.specs["Test bottle"]
        self.assertEqual(set(mug), {"source", "node", "name", "room", "size", "tips"})
        self.assertEqual((mug["name"], mug["room"]), ("mug", "alpha"))
        self.assertEqual((bottle["name"], bottle["room"]), ("bottle", "alpha"))
        np.testing.assert_allclose(mug["size"], [0.08, 0.09, 0.08], atol=1e-4)
        np.testing.assert_allclose(bottle["size"], [0.07, 0.3, 0.07], atol=1e-4)
        self.assertIs(mug["tips"], False)  # too short
        self.assertTrue(geom.tips(bottle["size"]))  # its shape would tip...
        self.assertIs(bottle["tips"], False)  # ...but web_tips says it doesn't


if __name__ == "__main__":
    unittest.main()
