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

    def groups(self):
        return lamps.collect_groups(bpy.context.scene, self.rooms, self.index, self.on)

    def test_switch_and_lamp_groups(self):
        groups, lost = self.groups()
        self.assertEqual(lost, [])
        self.assertEqual([(g["id"], g["kind"], g["lights"]) for g in groups], [
            ("alpha", "switch", ["Ceiling light Alpha"]),
            ("alpha/desk-lamp", "lamp", ["Desk lamp light"]),
            ("beta", "switch", ["Ceiling light Beta"]),
        ])
        self.assertEqual(groups[1]["room"], "alpha")
        self.assertEqual(groups[1]["name"], "desk-lamp")
        self.assertEqual(groups[1]["power"], 10.0)

    def test_untagged_lamp_joins_the_wall_switch(self):
        del bpy.data.objects["Desk lamp light"]["web_lamp"]
        groups, _ = self.groups()
        self.assertEqual([g["id"] for g in groups], ["alpha", "beta"])
        self.assertEqual(groups[0]["lights"], ["Ceiling light Alpha", "Desk lamp light"])

    def test_lamp_outside_every_room_is_reported(self):
        bpy.data.objects["Desk lamp light"].location = (20.0, 20.0, 1.0)
        bpy.context.view_layer.update()
        groups, lost = self.groups()
        self.assertEqual([g["id"] for g in groups], ["alpha", "beta"])
        self.assertEqual(lost, ["Desk lamp light (in no room)"])

    def test_day_fill_lights(self):
        self.assertTrue(lamps.is_day_fill(bpy.data.objects["Portal Alpha window"]))
        self.assertFalse(lamps.is_day_fill(bpy.data.objects["Desk lamp light"]))

    def test_glowing_materials_get_a_copy_per_group(self):
        gids = {g["id"] for g in self.groups()[0]}
        found, lost = lamps.split_emitters(self.meshes, self.index, gids)
        self.assertEqual({k: sorted(v) for k, v in found.items()},
                         {"alpha/desk-lamp": ["Bulb glow @alpha/desk-lamp", "Lamp glow @alpha/desk-lamp"],
                          "beta": ["Lamp glow @beta"]})
        self.assertEqual(lost, [])
        self.assertEqual(bpy.data.objects["Alpha wall lamp"].material_slots[0].material.name, "Lamp glow @alpha/desk-lamp")
        self.assertEqual(bpy.data.objects["Lamp"].material_slots[0].material.name, "Lamp glow @beta")
        self.assertEqual(bpy.data.objects["TV screen"].material_slots[0].material.name, "Screen")  # screens never glow

    def test_glow_only_meshes(self):
        self.assertTrue(lamps.glow_only(bpy.data.objects["Desk lamp bulb"]))
        self.assertFalse(lamps.glow_only(bpy.data.objects["Lamp"]))  # casts shadows
        self.assertFalse(lamps.glow_only(bpy.data.objects["Table"]))

    def test_fixture_boxes(self):
        gids = {g["id"] for g in self.groups()[0]}
        boxes = lamps.fixture_boxes(self.meshes, self.index, gids)
        self.assertEqual(list(boxes), ["alpha/desk-lamp"])
        lo, hi = boxes["alpha/desk-lamp"]  # the wall lamp and the bulb, 3 cm larger
        for got, want in zip(lo + hi, (0.44, 0.77, 0.92, 2.53, 2.56, 1.98)):
            self.assertAlmostEqual(got, want, places=3)


if __name__ == "__main__":
    unittest.main()
