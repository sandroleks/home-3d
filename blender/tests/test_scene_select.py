import unittest

import bpy

from pipeline import rooms, scene_select
from tests import fixture_scene


class DroppedCollectionTests(unittest.TestCase):
    def test_render_visible_neighbourhood_is_left_out(self):
        fixture_scene.build()
        scene = bpy.context.scene
        top = bpy.data.collections.new("Exterior - neighbourhood")
        sub = bpy.data.collections.new("Exterior - neighbourhood trees")
        scene.collection.children.link(top)
        top.children.link(sub)
        for name, coll in (("Exterior grass", top), ("Exterior pine", sub)):
            me = bpy.data.meshes.new(name)
            me.from_pydata([(0, 0, 0), (100, 0, 0), (100, 100, 0)], [], [(0, 1, 2)])
            coll.objects.link(bpy.data.objects.new(name, me))
        names = {o.name for o in scene_select.prepare_scene(scene, bpy.context.view_layer)[0]}
        self.assertNotIn("Exterior grass", names)
        self.assertNotIn("Exterior pine", names)
        self.assertIn("Walls", names)


class SceneSelectTests(unittest.TestCase):
    def setUp(self):
        fixture_scene.build()
        self.meshes, self.day_lights = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        self.names = {o.name for o in self.meshes}

    def test_animation_is_finished_before_baking(self):
        self.assertEqual(bpy.context.scene.frame_current, 10)
        walls = bpy.data.objects["Walls"]
        xs = [v.co.x for v in walls.data.vertices]
        self.assertAlmostEqual(min(xs), -0.2, places=3)
        self.assertAlmostEqual(max(xs), 6.2, places=3)

    def test_no_animation_left_on_kept_meshes_or_lights(self):
        for o in list(self.meshes) + [o for o in bpy.data.objects if o.type == "LIGHT"]:
            ad = o.animation_data
            self.assertTrue(ad is None or ad.action is None, o.name)

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


class EditModeTests(unittest.TestCase):
    def test_object_saved_in_edit_mode_is_still_realized(self):
        fixture_scene.build()
        vl = bpy.context.view_layer
        table = bpy.data.objects["Table"]
        vl.objects.active = table
        bpy.ops.object.mode_set(mode="EDIT")
        self.assertEqual(table.mode, "EDIT")
        scene_select.prepare_scene(bpy.context.scene, vl)
        self.assertEqual(table.mode, "OBJECT")
        self.assertTrue(table.matrix_world.is_identity)
        xs = [v.co.x for v in table.data.vertices]
        self.assertAlmostEqual((min(xs) + max(xs)) / 2, 1.5, places=3)


if __name__ == "__main__":
    unittest.main()
