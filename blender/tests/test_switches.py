import unittest

import bpy

from pipeline import collision, openings, rooms, scene_select, switches
from tests import fixture_scene


class SwitchObjectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, room_list = rooms.collect_rooms(meshes, bpy.context.scene)
        ops, infilled = openings.parse_openings(meshes)
        grid = collision.build_collision(meshes, index, ops)
        cls.result = switches.place_switches(room_list, ops, infilled, index, grid,
                                             bpy.data.collections["WEB"], {})

    def test_one_switch_per_lit_room(self):
        self.assertEqual(self.result, {"alpha": "Switch_alpha", "beta": "Switch_beta"})

    def test_switch_transform_and_material(self):
        sw = bpy.data.objects["Switch_alpha"]
        self.assertAlmostEqual(sw.location.x, 2.994, places=3)
        self.assertAlmostEqual(sw.location.y, 0.85, places=3)
        self.assertAlmostEqual(sw.location.z, 1.1, places=3)
        self.assertAlmostEqual(sw.dimensions.x, 0.086, places=3)
        self.assertAlmostEqual(sw.dimensions.y, 0.024, places=3)  # the plate and a rocker on each face
        self.assertEqual([s.material.name for s in sw.material_slots], ["Web switch", "Web switch rocker"])
        mat = sw.material_slots[0].material
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        self.assertGreater(bsdf.inputs["Emission Strength"].default_value, 0)
        self.assertIn(sw.name, bpy.data.collections["WEB"].objects)


if __name__ == "__main__":
    unittest.main()
