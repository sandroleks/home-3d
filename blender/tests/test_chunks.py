import unittest

import bpy

from pipeline import chunks, rooms, scene_select
from tests import fixture_scene


class ChunkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        static = [o for o in meshes if not o.name.startswith("Door leaf")]
        cls.result = chunks.build_chunks(static, index)

    def test_chunk_list(self):
        self.assertEqual(self.result, [
            {"node": "Room_alpha", "room": "alpha", "key": "alpha"},
            {"node": "Room_beta", "room": "beta", "key": "beta"},
            {"node": "Room_exterior", "room": None, "key": "exterior"},
        ])

    def test_sources_are_consumed_and_door_kept(self):
        for name in ("Walls", "Floor - Alpha", "Table", "Ceiling"):
            self.assertNotIn(name, bpy.data.objects)
        self.assertIn("Door leaf 1", bpy.data.objects)

    def test_faces_land_on_the_correct_side(self):
        # The single big ceiling face is diced, so each room only gets its own part of it.
        alpha = bpy.data.objects["Room_alpha"].data
        beta = bpy.data.objects["Room_beta"].data
        self.assertLessEqual(max(v.co.x for v in alpha.vertices), 3.2 + 1e-4)
        self.assertGreaterEqual(min(v.co.x for v in beta.vertices), 3.0 - 1e-4)
        names = {m.name for m in alpha.materials}
        self.assertIn("Tile proc", {n.split(" [")[0] for n in names})

    def test_outer_wall_faces_are_exterior(self):
        ext = bpy.data.objects["Room_exterior"].data
        self.assertAlmostEqual(min(v.co.x for v in ext.vertices), -0.2, places=3)


if __name__ == "__main__":
    unittest.main()
