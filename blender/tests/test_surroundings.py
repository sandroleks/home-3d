import os
import tempfile
import unittest

import bpy

from pipeline import checks, config, surroundings
from tests import fixture_scene


def _add_neighbourhood(scene):
    top = bpy.data.collections.new("Exterior - neighbourhood")
    sub = bpy.data.collections.new("Exterior - neighbourhood trees")
    scene.collection.children.link(top)
    top.children.link(sub)
    for name, coll in (("Exterior grass", top), ("Exterior pine", sub)):
        me = bpy.data.meshes.new(name)
        me.from_pydata([(0, 0, 0), (100, 0, 0), (100, 100, 0)], [], [(0, 1, 2)])
        coll.objects.link(bpy.data.objects.new(name, me))
    hidden = bpy.data.objects.new("Exterior hidden", bpy.data.meshes.new("Exterior hidden"))
    hidden.hide_render = True
    top.objects.link(hidden)


class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        _add_neighbourhood(bpy.context.scene)
        cls.out = tempfile.mkdtemp()
        cls.names = surroundings.export_surroundings(
            bpy.context.scene, bpy.context.view_layer, config.QUALITY["test"], cls.out)
        cls.path = os.path.join(cls.out, surroundings.FILE)

    def test_exports_render_visible_neighbourhood_with_normals_and_no_shade(self):
        self.assertEqual(self.names, ["Exterior grass", "Exterior pine"])
        self.assertEqual(checks.check_surroundings(self.out), [])
        gltf = checks.read_glb_json(self.path)
        self.assertEqual(len(gltf["meshes"]), 2)
        for mesh in gltf["meshes"]:
            for p in mesh["primitives"]:
                self.assertIn("NORMAL", p["attributes"])
                self.assertNotIn("COLOR_0", p["attributes"])

    def test_leaves_the_scene_as_it_was(self):
        self.assertNotIn("WEB_SURROUNDINGS", bpy.data.collections)
        grass = bpy.data.objects["Exterior grass"]
        self.assertEqual(len(grass.data.color_attributes), 0)
        self.assertFalse(any(o.name.startswith("Exterior grass.") for o in bpy.data.objects))

    def test_removes_a_stale_file_when_there_is_nothing_to_export(self):
        out = tempfile.mkdtemp()
        stale = os.path.join(out, surroundings.FILE)
        open(stale, "wb").close()
        fixture_scene.build()
        self.assertEqual(surroundings.export_surroundings(
            bpy.context.scene, bpy.context.view_layer, config.QUALITY["test"], out), [])
        self.assertFalse(os.path.exists(stale))


if __name__ == "__main__":
    unittest.main()
