import unittest

import bpy
import numpy as np

from pipeline import collision, openings, rooms, scene_select
from tests import fixture_scene


class GridAssemblyTests(unittest.TestCase):
    def test_inflates_raw_by_radius(self):
        bounds, cell = (0.0, 0.0, 1.0, 1.0), 0.1
        w, h, pts = collision.cell_centres(bounds, cell)
        walkable = np.ones(len(pts), bool)
        solid = np.zeros(len(pts), bool)
        solid[np.isclose(pts[:, 0], 0.55)] = True
        grid = collision.assemble_grid(bounds, cell, 0.1, walkable, solid, np.zeros(len(pts), bool))
        self.assertEqual(grid.raw[0].nonzero()[0].tolist(), [5])
        self.assertEqual(grid.blocked[0].nonzero()[0].tolist(), [4, 5, 6])
        self.assertTrue(grid.is_blocked(0.45, 0.5))
        self.assertFalse(grid.is_blocked(0.45, 0.5, raw=True))
        self.assertTrue(grid.is_blocked(-1.0, 0.5))  # outside the grid

    def test_json_round_trips_runs(self):
        bounds, cell = (0.0, 0.0, 0.3, 0.2), 0.1
        w, h, pts = collision.cell_centres(bounds, cell)
        solid = np.array([False, True, False, False, False, True])
        grid = collision.assemble_grid(bounds, cell, 0.0, np.ones(6, bool), solid, np.zeros(6, bool))
        j = grid.to_json(0.0)
        self.assertEqual((j["width"], j["height"]), (3, 2))
        self.assertEqual(j["runs"], [1, 1, 3, 1])


class FixtureCollisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        cls.ops, cls.infilled = openings.parse_openings(meshes)
        cls.grid = collision.build_collision(meshes, index, cls.ops)

    def test_parses_the_door_opening(self):
        self.assertEqual(len(self.ops), 1)
        op = self.ops[0]
        self.assertEqual((op.num, op.glazed, op.rooms), (1, False, ("Alpha", "Beta")))
        self.assertAlmostEqual(op.center[0], 3.1, places=3)
        self.assertAlmostEqual(op.center[1], -1.4, places=3)
        self.assertAlmostEqual(op.width, 0.8, places=3)
        self.assertAlmostEqual(op.thickness, 0.2, places=3)
        self.assertEqual(self.infilled, set())

    def test_occupancy(self):
        g = self.grid
        self.assertFalse(g.is_blocked(0.5, -2.5))   # open floor in Alpha
        self.assertTrue(g.is_blocked(1.5, -1.5))    # table
        self.assertTrue(g.is_blocked(3.1, -0.5))    # middle wall
        self.assertFalse(g.is_blocked(3.1, -1.4))   # doorway (door leaf is dynamic)
        self.assertTrue(g.is_blocked(3.65, -0.9))   # shelf
        self.assertTrue(g.is_blocked(-1.0, -1.0))   # outside
        self.assertTrue(g.is_blocked(0.1, -1.5))    # within radius of the west wall
        self.assertFalse(g.is_blocked(0.1, -1.5, raw=True))


if __name__ == "__main__":
    unittest.main()
