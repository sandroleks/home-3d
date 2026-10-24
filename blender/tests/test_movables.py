import math
import unittest

import bpy
import numpy as np
from mathutils import Vector

from pipeline import bpyutil, lamps, movables, rooms, scene_select, screens, uvs
from tests import fixture_scene


class PureTests(unittest.TestCase):
    def test_passes_keep_members_apart(self):
        centres = [(0, 0, 0), (0.3, 0, 0), (2, 0, 0), (0.3, 0, 0.4), (2.2, 0, 0)]
        groups = movables.passes(centres, 0.8)
        self.assertEqual(groups, [[0, 2], [1, 4], [3]])
        for g in groups:
            for i in g:
                for j in g:
                    if i != j:
                        self.assertGreaterEqual(math.dist(centres[i], centres[j]), 0.8)

    def test_atlas(self):
        self.assertEqual([movables.atlas_columns(n) for n in (1, 2, 4, 5, 26)], [1, 2, 2, 3, 6])
        self.assertEqual(movables.tile_rect(4, 3, 64), (64, 64, 128, 128))


class PrepareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        cls.index, room_list = rooms.collect_rooms(meshes, bpy.context.scene)
        objs = movables.find(meshes)
        cls.names = sorted(o.name for o in objs)
        cls.specs = {s["source"]: s for s in movables.prepare_movables(objs, cls.index)}
        groups, _ = lamps.collect_groups(bpy.context.scene, room_list, cls.index, [])
        cls.screens = screens.prepare_screens(screens.find(meshes), cls.index, {"beta", "beta/tv"})

    def test_found_and_renamed(self):
        self.assertEqual(self.names, ["Cabinet door", "Cabinet drawer"])
        self.assertIn("Move_cabinet-drawer", bpy.data.objects)
        self.assertEqual(self.specs["Cabinet drawer"]["node"], "Move_cabinet-drawer")

    def test_slide(self):
        s = self.specs["Cabinet drawer"]
        self.assertEqual((s["kind"], s["room"]), ("slide", "beta"))
        self.assertEqual(s["dir"], [0.0, 0.0, 1.0])  # Blender -Y is three.js +Z
        self.assertAlmostEqual(s["distance"], 0.35)
        o = bpy.data.objects["Move_cabinet-drawer"]
        m = movables.open_matrix(o, s)
        self.assertAlmostEqual(m.translation.y, -0.35, places=5)

    def test_hinge_origin_at_pivot(self):
        s = self.specs["Cabinet door"]
        o = bpy.data.objects["Move_cabinet-door"]
        self.assertEqual(s["kind"], "hinge")
        self.assertEqual(tuple(round(v, 4) for v in o.location), (4.42, 2.55, 0.2))
        self.assertEqual(s["pivot"], [4.42, 0.2, -2.55])
        self.assertEqual(s["axis"], [0.0, 1.0, 0.0])
        self.assertAlmostEqual(s["angle"], -1.7)
        co = bpyutil.world_coords(o)
        self.assertAlmostEqual(float(co[:, 0].min()), 4.42, places=4)  # the mesh didn't move
        # Open, the free edge (+X) swings out of the cabinet (-Y).
        m = movables.open_matrix(o, s)
        free = m @ (Vector((0.56, 0.0, 0.0)))
        self.assertLess(free.y, 2.55 - 0.4)

    def test_tile_uvs(self):
        o = bpy.data.objects["Move_cabinet-door"]
        uvs.add_lightmap_uvs(o, 0, 16, 16)
        self.assertGreater(uvs.uv_area(o.data, "UVLightmap"), 0.1)
        movables.place_in_tile(o, 3, 2, 16)
        co = np.empty(len(o.data.uv_layers["UVLightmap"].data) * 2)
        o.data.uv_layers["UVLightmap"].data.foreach_get("uv", co)
        co = co.reshape(-1, 2)
        pad = movables.TILE_PAD / 16 / 2
        self.assertGreaterEqual(co.min(), 0.5 + pad - 1e-6)
        self.assertLessEqual(co.max(), 1.0 - pad + 1e-6)

    def test_screen(self):
        (s,) = self.screens
        self.assertEqual((s["node"], s["room"], s["kind"], s["group"]), ("Screen_beta-tv", "beta", "tv", "beta/tv"))
        self.assertEqual(s["normal"], [0.0, 0.0, -1.0])  # faces into Beta (Blender +Y)
        self.assertAlmostEqual(s["width"], 0.8, places=3)
        self.assertAlmostEqual(s["height"], 0.45, places=3)
        o = bpy.data.objects["Screen_beta-tv"]
        uv = np.empty(len(o.data.uv_layers[0].data) * 2)
        o.data.uv_layers[0].data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        self.assertAlmostEqual(uv.min(), 0.0, places=4)
        self.assertAlmostEqual(uv.max(), 1.0, places=4)
        # Looking at the screen (south), the viewer's right is west: the west edge has u = 1.
        loops = [o.data.loops[i].vertex_index for i in range(len(o.data.loops))]
        west = [k for k, v in enumerate(loops) if o.data.vertices[v].co.x < 4.5]
        self.assertTrue(all(abs(uv[k, 0] - 1.0) < 1e-4 for k in west))


if __name__ == "__main__":
    unittest.main()
