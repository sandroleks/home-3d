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
        self.assertGreater(px.reshape(-1, 4)[:, :3].std(), 0.01)

    def test_other_materials_untouched_and_no_bake_nodes_left(self):
        plaster = bpy.data.materials["Plaster"]
        self.assertFalse(any(n.type == "TEX_IMAGE" for n in plaster.node_tree.nodes))
        for mat in bpy.data.materials:
            if mat.node_tree:
                self.assertNotIn(proc_materials.BAKE_NODE, mat.node_tree.nodes)


if __name__ == "__main__":
    unittest.main()
