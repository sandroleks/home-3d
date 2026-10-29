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


def _relief(mat):
    """Give a procedural material a bump from its brick pattern, as the model's tiles have."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    brick = next(n for n in nt.nodes if n.type == "TEX_BRICK")
    bump = nt.nodes.new("ShaderNodeBump")
    nt.links.new(brick.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


class NewPathTests(unittest.TestCase):
    """A small patch goes flat, relief gets a normal map, a shared material gets one tile."""

    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        scene = bpy.context.scene
        furniture = bpy.data.collections["Furniture"]
        tile = bpy.data.materials["Tile proc"]
        fixture_scene.box_object("Knob", [(0.6, 0.6, 0.5, 0.68, 0.68, 0.58)], tile, furniture)
        bumpy = _relief(tile.copy())
        bumpy.name = "Bumpy proc"
        fixture_scene.box_object("Bumpy wall", [(0.2, 2.6, 0, 1.2, 2.7, 1.2)], bumpy, furniture)
        oak = tile.copy()
        oak.name = "Oak"
        fixture_scene.box_object("Board A", [(0.2, 0.2, 0.4, 2.2, 0.3, 0.42)], oak, furniture)
        fixture_scene.box_object("Board B", [(0.2, 0.5, 0.4, 0.3, 1.7, 0.42)], oak, furniture)
        meshes, _ = scene_select.prepare_scene(scene, bpy.context.view_layer)
        cls.baked = proc_materials.bake_procedural_albedo(meshes, config.QUALITY["test"])

    def test_a_small_patch_takes_the_materials_mean_colour(self):
        mat = bpy.data.objects["Knob"].material_slots[0].material
        self.assertEqual(mat.name, "Tile proc (flat)")
        self.assertFalse(any(n.type == "TEX_IMAGE" for n in mat.node_tree.nodes))
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        self.assertGreater(sum(bsdf.inputs["Base Color"].default_value[:3]), 0.05)

    def test_relief_becomes_a_normal_map(self):
        mat = bpy.data.objects["Bumpy wall"].material_slots[0].material
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        link = bsdf.inputs["Normal"].links[0]
        self.assertEqual(link.from_node.type, "NORMAL_MAP")
        img = mat.node_tree.nodes["Normal Texture"].image
        self.assertEqual(img.colorspace_settings.name, "Non-Color")
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        blue = px.reshape(-1, 4)[:, 2]
        self.assertGreater(np.median(blue), 0.7)  # mostly facing out, as a tangent-space map does

    def test_a_shared_material_gets_one_tile_at_real_size(self):
        a = bpy.data.objects["Board A"].material_slots[0].material
        b = bpy.data.objects["Board B"].material_slots[0].material
        self.assertIs(a, b)
        self.assertEqual(a.name, "Oak")
        self.assertEqual(a.node_tree.nodes["Image Texture"].image.name, "tile_oak")
        self.assertIn("Normal Texture", a.node_tree.nodes)
        uv = bpy.data.objects["Board A"].data.uv_layers["UVMap"]
        data = np.empty(len(uv.data) * 2)
        uv.data.foreach_get("uv", data)
        v = data.reshape(-1, 2)[:, 1]
        tile = config.SHARED_TILES["Oak"]["tile_m"]
        self.assertAlmostEqual(v.max() - v.min(), 2.0 / tile, places=3)  # along the 2 m board
        self.assertNotIn("Board A", [n for n in self.baked if n.startswith("Board")])


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
