import unittest

import bpy

from pipeline import lamps, rooms, scene_select
from tests import fixture_scene


class LampTests(unittest.TestCase):
    def setUp(self):
        fixture_scene.build()
        scene = bpy.context.scene
        self.meshes, self.on = scene_select.prepare_scene(scene, bpy.context.view_layer)
        self.index, self.rooms = rooms.collect_rooms(self.meshes, scene)
        self.ceilings = {r["light"] for r in self.rooms if r["light"]}

    def test_lamps_go_to_their_room(self):
        found, lost = lamps.room_lamps(bpy.context.scene, self.index, self.on, self.ceilings)
        self.assertEqual(found, {"alpha": ["Desk lamp light"]})
        self.assertEqual(lost, [])

    def test_lamp_outside_every_room_is_reported(self):
        bpy.data.objects["Desk lamp light"].location = (20.0, 20.0, 1.0)
        bpy.context.view_layer.update()
        found, lost = lamps.room_lamps(bpy.context.scene, self.index, self.on, self.ceilings)
        self.assertEqual(found, {})
        self.assertEqual(lost, ["Desk lamp light"])

    def test_day_fill_lights(self):
        self.assertTrue(lamps.is_day_fill(bpy.data.objects["Portal Alpha window"]))
        self.assertFalse(lamps.is_day_fill(bpy.data.objects["Desk lamp light"]))

    def test_glowing_materials_get_a_copy_per_room(self):
        found, lost = lamps.split_emitters(self.meshes, self.index)
        self.assertEqual(found, {"alpha": ["Lamp glow @alpha"], "beta": ["Lamp glow @beta"]})
        self.assertEqual(lost, [])
        self.assertEqual(bpy.data.objects["Alpha wall lamp"].material_slots[0].material.name, "Lamp glow @alpha")
        self.assertEqual(bpy.data.objects["Lamp"].material_slots[0].material.name, "Lamp glow @beta")


if __name__ == "__main__":
    unittest.main()
