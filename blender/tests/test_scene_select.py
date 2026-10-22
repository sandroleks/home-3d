import unittest

import bpy

from pipeline import rooms, scene_select
from tests import fixture_scene


class SceneSelectTests(unittest.TestCase):
    def setUp(self):
        fixture_scene.build()
        self.meshes, self.day_lights = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        self.names = {o.name for o in self.meshes}

    def test_keeps_render_visible_meshes_and_ceiling(self):
        for name in ("Walls", "Floor - Alpha", "Floor - Beta", "Ceiling", "Door leaf 1", "Table",
                     "Door 1 (Alpha / Beta) lintel", "Lamp", "Shelf"):
            self.assertIn(name, self.names)

    def test_kept_meshes_are_render_visible(self):
        self.assertIn("Ceiling", self.names)
        for o in self.meshes:
            self.assertFalse(o.hide_render, o.name)

    def test_child_of_dropped_parent_keeps_world_position(self):
        self.assertIn("Sofa cushion", self.names)
        c = bpy.data.objects["Sofa cushion"]
        self.assertIsNone(c.parent)
        self.assertTrue(c.matrix_world.is_identity)
        for axis, expected in enumerate((2.0, 2.4, 0.85)):
            vals = [v.co[axis] for v in c.data.vertices]
            self.assertAlmostEqual((min(vals) + max(vals)) / 2, expected, places=3)

    def test_deletes_hidden_variants(self):
        self.assertNotIn("Hidden sofa", self.names)
        self.assertNotIn("Hidden sofa", bpy.data.objects)

    def test_realizes_transforms_and_modifiers(self):
        table = bpy.data.objects["Table"]
        self.assertIsNone(table.parent)
        self.assertEqual(len(table.modifiers), 0)
        self.assertTrue(table.matrix_world.is_identity)
        xs = [v.co.x for v in table.data.vertices]
        ys = [v.co.y for v in table.data.vertices]
        self.assertAlmostEqual((min(xs) + max(xs)) / 2, 1.5, places=3)
        self.assertAlmostEqual((min(ys) + max(ys)) / 2, 1.5, places=3)
        self.assertGreater(len(table.data.polygons), 6)  # bevel applied

    def test_collections_and_lights(self):
        web = bpy.data.collections["WEB"]
        for o in self.meshes:
            self.assertEqual([c.name for c in o.users_collection], ["WEB"])
        self.assertEqual(self.day_lights, ["Sun"])
        lights = bpy.data.collections["WEB_LIGHTS"]
        self.assertEqual({o.name for o in lights.objects}, {"Sun", "Ceiling light Alpha", "Ceiling light Beta"})
        self.assertFalse(bpy.data.objects["Sun"].hide_render)
        self.assertTrue(bpy.data.objects["Ceiling light Alpha"].hide_render)
        self.assertIs(web, bpy.data.collections["WEB"])

    def test_collect_rooms(self):
        index, room_list = rooms.collect_rooms(self.meshes, bpy.context.scene)
        self.assertEqual([r["id"] for r in room_list], ["alpha", "beta"])
        self.assertEqual([r["light"] for r in room_list], ["Ceiling light Alpha", "Ceiling light Beta"])
        self.assertEqual(index.locate(1.0, -1.0), "alpha")  # Blender (1, 1)
        self.assertEqual(index.locate(4.0, -2.0), "beta")
        self.assertIsNone(index.locate(3.1, -0.5))  # inside the middle wall


if __name__ == "__main__":
    unittest.main()
