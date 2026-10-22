import unittest

import bpy
import numpy as np

from pipeline import config, proc_materials, scene_select
from tests import fixture_scene


class ProceduralAlbedoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        cls.baked = proc_materials.bake_procedural_albedo(meshes, config.QUALITY["test"])

    def test_reports_baked_objects(self):
        self.assertEqual(self.baked, ["Floor - Alpha"])

    def test_material_is_rewired_to_an_image(self):
        floor = bpy.data.objects["Floor - Alpha"]
        mat = floor.material_slots[0].material
        self.assertEqual(mat.name, "Tile proc [Floor - Alpha]")
        self.assertFalse(proc_materials.is_procedural(mat))
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        link = bsdf.inputs["Base Color"].links[0]
        self.assertEqual(link.from_node.type, "TEX_IMAGE")
        img = link.from_node.image
        self.assertIsNotNone(img.packed_file)
        self.assertIn("UVMap", floor.data.uv_layers)

    def test_baked_image_has_the_pattern(self):
        img = bpy.data.objects["Floor - Alpha"].material_slots[0].material.node_tree.nodes["Image Texture"].image
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        rgb = px.reshape(-1, 4)[:, :3]
        island = rgb[rgb.sum(axis=1) > 0.02]
        self.assertGreater(len(island), 100)
        self.assertGreater(island.std(), 0.01)
        lum = island.mean(axis=1)
        self.assertGreater(np.percentile(lum, 95) - np.percentile(lum, 5), 0.05)

    def test_other_materials_untouched_and_no_bake_nodes_left(self):
        plaster = bpy.data.materials["Plaster"]
        self.assertFalse(any(n.type == "TEX_IMAGE" for n in plaster.node_tree.nodes))
        for mat in bpy.data.materials:
            if mat.node_tree:
                self.assertNotIn(proc_materials.BAKE_NODE, mat.node_tree.nodes)


class MixedSlotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        scene = bpy.context.scene
        structure = bpy.data.collections["Structure"]
        obj = fixture_scene.box_object("Mixed wall", [(0.5, 2.5, 0, 1.0, 2.9, 1.0)],
                                       bpy.data.materials["Plaster"], structure)
        obj.data.materials.append(bpy.data.materials["Tile proc"])
        polys = obj.data.polygons
        for p in list(polys)[len(polys) // 2:]:
            p.material_index = 1
        meshes, _ = scene_select.prepare_scene(scene, bpy.context.view_layer)
        cls.baked = proc_materials.bake_procedural_albedo(meshes, config.QUALITY["test"])

    def test_mixed_object_is_baked_and_slots_split(self):
        self.assertIn("Mixed wall", self.baked)
        wall = bpy.data.objects["Mixed wall"]
        plaster = wall.material_slots[0].material
        self.assertEqual(plaster.name, "Plaster")
        self.assertFalse(any(n.type == "TEX_IMAGE" for n in plaster.node_tree.nodes))
        tile = wall.material_slots[1].material
        self.assertEqual(tile.name, "Tile proc [Mixed wall]")
        self.assertTrue(any(n.type == "TEX_IMAGE" and n.image for n in tile.node_tree.nodes))
        floor_mat = bpy.data.objects["Floor - Alpha"].material_slots[0].material
        self.assertIsNot(floor_mat, tile)


class RewireErrorTests(unittest.TestCase):
    def test_no_principled_raises_runtime_error(self):
        mat = bpy.data.materials.new("No bsdf")
        mat.use_nodes = True
        for n in list(mat.node_tree.nodes):
            mat.node_tree.nodes.remove(n)
        with self.assertRaises(RuntimeError):
            proc_materials._rewire_to_image(mat, bpy.data.images.new("x", 4, 4))


if __name__ == "__main__":
    unittest.main()
