"""One-off: details for the walkthrough, on top of the modelled flat.

- Lamps get real colour temperatures (brightness kept), bulbs inside shades and pendants, LED strips where the strip
  lights are, and glowing ceiling diffusers.
- Freestanding lamps and their fixtures are tagged with a lamp group (`web_lamp`), the screens with `web_screen`.
- Drawers and cupboard doors become movables (`web_move` and friends, see README) with drawer boxes, and the carcasses
  behind them are hollowed by boolean cutters (collection `Movable cutters`), with shelves and contents inside.
- Each glazed door is rebuilt as two French door leaves (`Door leaf Na`, `Door leaf Nb`, glass tagged `web_leaf`).
- Sockets on free walls near the floor, and above the kitchen worktop.

Run once in the Blender session that has the .blend open, then save; or headless:
    blender -b Untitled.blend --python blender/tools/model_details.py -- --save
Refuses to run twice.
"""
import math
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

MARK = "model_details"
VERSION = 1
Z = Vector((0.0, 0.0, 1.0))

scene = bpy.context.scene
if scene.get(MARK) is not None:
    raise RuntimeError(f"already applied (version {scene[MARK]})")


# ---------------------------------------------------------------------------------------------------- helpers

def material(name, rgb=(0.8, 0.8, 0.8), roughness=0.5, metallic=0.0, emission=None, strength=0.0):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    mat.diffuse_color = (*rgb, 1.0)
    return mat


def existing(name, **fallback):
    """A material of the model's own, or a stand-in if it was renamed."""
    return bpy.data.materials.get(name) or material(name, **fallback)


def world_coords(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.array([obj.matrix_world @ v.co for v in me.vertices]) if len(me.vertices) else np.zeros((0, 3))
    ev.to_mesh_clear()
    return co


def bbox(obj):
    co = world_coords(obj)
    return co.min(0), co.max(0)


def collection(name, parent=None, hidden=False):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or scene.collection).children.link(col)
    col.hide_render = hidden
    col.hide_viewport = hidden
    return col


class Builder:
    """World-space mesh made of boxes, cylinders and spheres, one material slot per material used."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = []

    def _slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _assign(self, verts, mat):
        idx = self._slot(mat)
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = idx

    def box(self, lo, hi, mat):
        lo, hi = Vector(lo), Vector(hi)
        lo, hi = Vector([min(lo[i], hi[i]) for i in range(3)]), Vector([max(lo[i], hi[i]) for i in range(3)])
        size = hi - lo
        if min(size) <= 0:
            return
        m = Matrix.Translation((lo + hi) / 2) @ Matrix.Diagonal((*size, 1.0))
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m, calc_uvs=True)["verts"]
        self._assign(verts, mat)

    def cylinder(self, centre, radius, depth, axis, mat, segments=14, radius2=None):
        """centre of the cylinder; axis 'x', 'y' or 'z' (or a vector)."""
        a = Vector({"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[axis]) if isinstance(axis, str) else Vector(axis)
        rot = Z.rotation_difference(a.normalized()).to_matrix().to_4x4()
        m = Matrix.Translation(Vector(centre)) @ rot
        verts = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius,
                                      radius2=radius if radius2 is None else radius2, depth=depth, matrix=m,
                                      calc_uvs=True)["verts"]
        self._assign(verts, mat)

    def sphere(self, centre, radius, mat, scale=(1, 1, 1)):
        m = Matrix.Translation(Vector(centre)) @ Matrix.Diagonal((*scale, 1.0))
        verts = bmesh.ops.create_uvsphere(self.bm, u_segments=14, v_segments=8, radius=radius, matrix=m,
                                          calc_uvs=True)["verts"]
        self._assign(verts, mat)

    def absorb(self, obj):
        """Add an existing object's evaluated mesh (modifiers applied, world space), then delete the object."""
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(obj.matrix_world)
        if obj.matrix_world.determinant() < 0:  # mirrored objects: keep the faces pointing out
            me.flip_normals()
        remap = [self._slot(s.material or existing("Web default")) for s in obj.material_slots] or [
            self._slot(existing("Web default"))]
        before = set(self.bm.faces)
        self.bm.from_mesh(me)  # appends
        for f in self.bm.faces:
            if f not in before:
                f.material_index = remap[min(f.material_index, len(remap) - 1)]
        bpy.data.meshes.remove(me)
        bpy.data.objects.remove(obj, do_unlink=True)

    def build(self, name, col, origin=None):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        while len(me.uv_layers) > 1:  # the pipeline wants UVMap alone (it adds the lightmap UVs itself)
            me.uv_layers.remove(me.uv_layers[-1])
        obj = bpy.data.objects.new(name, me)
        col.objects.link(obj)
        if origin is not None:
            me.transform(Matrix.Translation(-Vector(origin)))
            obj.location = origin
        return obj


class Frame:
    """An axis-aligned cavity: a along `u`, b inward from the face (against the outward normal `n`), c up."""

    def __init__(self, origin, u, n, size):
        self.o, self.u, self.n = Vector(origin), Vector(u), Vector(n)
        self.w, self.d, self.h = size

    def p(self, a, b, c):
        return self.o + self.u * a - self.n * b + Z * c

    def box(self, bld, a0, a1, b0, b1, c0, c1, mat):
        p0, p1 = self.p(a0, b0, c0), self.p(a1, b1, c1)
        bld.box([min(p0[i], p1[i]) for i in range(3)], [max(p0[i], p1[i]) for i in range(3)], mat)

    def cyl(self, bld, a, b, c, r, h, mat, axis="up", **kw):
        """Vertical (axis 'up', c is the bottom), or lying along u ('u') or the depth ('d'), centred on (a, b, c)."""
        if axis == "up":
            bld.cylinder(self.p(a, b, c + h / 2), r, h, "z", mat, **kw)
        else:
            bld.cylinder(self.p(a, b, c), r, h, self.u if axis == "u" else self.n, mat, **kw)

    def sub(self, a0, b0, c0, w, d, h):
        return Frame(self.p(a0, b0, c0), self.u, self.n, (w, d, h))


def front_frame(front_lo, front_hi, carcass_lo, carcass_hi):
    """(u, n, face) for a front on a carcass: n is the outward axis, the one the front is thin along."""
    size = front_hi - front_lo
    k = int(np.argmin(size[:2]))
    n = Vector((0.0, 0.0, 0.0))
    centre = (front_lo[k] + front_hi[k]) / 2
    outward = 1.0 if centre > (carcass_lo[k] + carcass_hi[k]) / 2 else -1.0
    n[k] = outward
    u = Vector((0.0, 0.0, 0.0))
    u[1 - k] = 1.0
    face = carcass_hi[k] if outward > 0 else carcass_lo[k]
    return u, n, face, k


# ---------------------------------------------------------------------------------------------------- materials

M = {
    "interior": material("Cabinet interior", (0.86, 0.85, 0.82), 0.6),
    "birch": material("Drawer box birch", (0.80, 0.68, 0.52), 0.55),
    "fridge": material("Fridge interior", (0.93, 0.94, 0.95), 0.3),
    "shelf glass": material("Fridge shelf glass", (0.9, 0.95, 0.95), 0.05),
    "bulb": material("Bulb warm", (1.0, 1.0, 1.0), 0.3, emission=(1.0, 0.78, 0.55), strength=25.0),
    "socket": material("Socket white", (0.93, 0.93, 0.9), 0.35),
    "socket insert": material("Socket insert", (0.55, 0.55, 0.54), 0.45),
    "leather": material("Shoe leather", (0.24, 0.14, 0.09), 0.45),
    "sneaker": material("Sneaker white", (0.92, 0.92, 0.9), 0.6),
    "sole": material("Shoe sole", (0.08, 0.08, 0.08), 0.8),
    "rack": material("Wire rack", (0.75, 0.76, 0.77), 0.3, metallic=0.9),
    "dark": material("Pipe grey", (0.35, 0.36, 0.37), 0.5),
    "carton": material("Carton white", (0.94, 0.94, 0.92), 0.6),
    "carton blue": material("Carton blue", (0.16, 0.33, 0.62), 0.5),
    "label": material("Label kraft", (0.62, 0.48, 0.32), 0.7),
    "glass": existing("Glassware", rgb=(0.9, 0.95, 0.95), roughness=0.05),
    "jar": existing("Jar glass", rgb=(0.9, 0.95, 0.95), roughness=0.05),
    "steel": existing("Stainless", rgb=(0.7, 0.7, 0.7), metallic=1.0, roughness=0.25),
    "black": existing("Black steel", rgb=(0.05, 0.05, 0.05), metallic=0.6, roughness=0.4),
    "oak": existing("Oak", rgb=(0.6, 0.42, 0.26)),
    "white": existing("Stoneware white", rgb=(0.92, 0.91, 0.88)),
    "blue": existing("Stoneware blue", rgb=(0.3, 0.42, 0.55)),
    "led": existing("LED", rgb=(1, 1, 1), emission=(1.0, 0.76, 0.5), strength=4.0),
}
FABRICS = [existing(n, rgb=c) for n, c in (
    ("Fabric sage", (0.45, 0.52, 0.42)), ("Fabric terracotta", (0.62, 0.32, 0.22)), ("Fabric oat", (0.78, 0.72, 0.6)),
    ("Fabric charcoal", (0.15, 0.15, 0.16)), ("Closet coat 0", (0.2, 0.22, 0.3)), ("Closet coat 1", (0.5, 0.38, 0.28)),
    ("Closet coat 2", (0.3, 0.3, 0.28)), ("Duvet oat", (0.85, 0.8, 0.7)))]
BOTTLES = [existing(n, rgb=(0.3, 0.45, 0.3), roughness=0.1) for n in ("Bottle 0", "Bottle 1")]
BOOKS = [existing(f"Cookbook {i}", rgb=(0.5, 0.3, 0.2)) for i in range(5)]
BINS = [existing(f"Bin {i}", rgb=(0.4, 0.5, 0.6)) for i in range(3)]
TOOLS = [existing(n, rgb=c) for n, c in (("Tool red", (0.7, 0.1, 0.08)), ("Tool yellow", (0.85, 0.65, 0.1)))]
FILAMENTS = [existing(f"Filament {i}", rgb=(0.5, 0.5, 0.5)) for i in range(6)]
STORAGE = existing("Storage box", rgb=(0.7, 0.64, 0.55))

details = collection("Details")
cutters_root = collection("Movable cutters", hidden=True)
rng = random.Random(7)
report = []


# ---------------------------------------------------------------------------------------------------- lamps

TEMPERATURES = [  # (name prefix, kelvin); the first match wins
    ("Ceiling light", 3000), ("Bedside light", 2700), ("Floor lamp light", 2700), ("Sala floor lamp light", 2700),
    ("Dining pendant light", 2700), ("Island pendant light", 2700), ("Hall wall light lamp", 2700),
    ("Bar shelf LED", 3000), ("Shelf light", 3000), ("Coffee station niche light", 3000),
    ("West under-cabinet light", 3500), ("Bench task light", 4000), ("Desk lamp light", 3500),
    ("TV 85in backlight", 6500), ("TV backlight", 6500), ("WC01 vanity", 3500), ("WC02 vanity", 3500),
    ("WC01 ceiling", 3000), ("WC02 ceiling", 3000), ("Closet light", 3000), ("Lavandaria ceiling", 3000),
]


def luminance(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


for o in scene.objects:
    if o.type != "LIGHT" or o.data.type == "SUN" or o.name.startswith(("Portal ", "Fill")):
        continue
    k = next((t for p, t in TEMPERATURES if o.name.startswith(p)), None)
    if k is None:
        print(f"[lamps] {o.name}: no colour temperature, left as it is")
        continue
    before = luminance(o.data.color)
    o.data.color = (1.0, 1.0, 1.0)
    o.data.use_temperature = True
    o.data.temperature = k
    o.data.energy *= before / max(luminance(o.data.temperature_color), 1e-3)  # same brightness, warmer colour
    report.append(f"{o.name}: {k} K, {o.data.energy:.1f} W")

# Lamp groups: a light and its fixtures switch together, apart from the room's wall switch.
LAMP_GROUPS = {
    "pendant": (["Dining pendant light"], ["Dining pendant shade", "Dining pendant cord"]),
    "floor-lamp": (["Sala floor lamp light", "Floor lamp light"],
                   ["Sala floor lamp shade", "Sala floor lamp pole", "Sala floor lamp base",
                    "Floor lamp shade", "Floor lamp pole", "Floor lamp base"]),
    "bar-shelves": (["Bar shelf LED 0", "Bar shelf LED 1"], ["Bar shelf 0", "Bar shelf 1"]),
    "tv": (["TV 85in backlight"], []),
    "pendants": (["Island pendant light 0", "Island pendant light 1"],
                 ["Island pendant 0", "Island pendant 1", "Island pendant cord 0", "Island pendant cord 1"]),
    "bedside-left": (["Bedside light 0"], ["Bedside lamp shade 0", "Bedside lamp base 0"]),
    "bedside-right": (["Bedside light 1"], ["Bedside lamp shade 1", "Bedside lamp base 1"]),
    "screen-bar": (["Desk lamp light"], ["Screen bar", "Screen bar clamp"]),
    "workbench": (["Bench task light"], ["LED strip"]),
    "wall-lights": (["Hall wall light lamp 0", "Hall wall light lamp 1"], ["Hall wall light 0", "Hall wall light 1"]),
}
for group, (lights, fixtures) in LAMP_GROUPS.items():
    for n in lights + fixtures:
        o = scene.objects.get(n)
        if o is None:
            print(f"[lamps] WARNING: {n} not found for group {group}")
            continue
        o["web_lamp"] = group

for n, kind in (("TV 85in screen", "tv"), ("Monitor screen", "monitor"), ("Laptop display", "laptop")):
    scene.objects[n]["web_screen"] = kind

# Bulbs where a point lamp sits inside a shade; they don't block the lamp's own light.
for light_name, radius in (("Bedside light 0", 0.028), ("Bedside light 1", 0.028), ("Dining pendant light", 0.045),
                           ("Sala floor lamp light", 0.035), ("Floor lamp light", 0.035),
                           ("Island pendant light 0", 0.035), ("Island pendant light 1", 0.035)):
    light = scene.objects[light_name]
    b = Builder()
    p = light.location
    b.sphere(p, radius, M["bulb"], scale=(1, 1, 1.25))
    b.cylinder((p.x, p.y, p.z + radius * 1.45), radius * 0.45, radius * 0.7, "z", M["steel"])
    bulb = b.build(f"Bulb {light_name}", details)
    bulb.visible_shadow = False
    if "web_lamp" in light:
        bulb["web_lamp"] = light["web_lamp"]

# LED strips behind the strip lights (each light shines down its local -Z; the strip sits just behind it).
for light_name in ("West under-cabinet light", "Shelf light", "Bar shelf LED 0", "Bar shelf LED 1",
                   "Coffee station niche light"):
    light = scene.objects[light_name]
    rot = light.matrix_world.to_3x3()
    sx, sy = light.data.size, light.data.size_y
    long_axis, length = (rot @ Vector((1, 0, 0)), sx) if sx >= sy else (rot @ Vector((0, 1, 0)), sy)
    side = long_axis.cross(rot @ Vector((0, 0, 1))).normalized()
    back = rot @ Vector((0, 0, 1))
    c = light.matrix_world.translation + back * 0.004
    half = long_axis * length / 2 + side * 0.008 + back * 0.002
    corners = [c - half, c + half]
    b = Builder()
    b.box([min(p[i] for p in corners) for i in range(3)], [max(p[i] for p in corners) for i in range(3)], M["led"])
    strip = b.build(f"LED strip {light_name}", details)
    strip.visible_shadow = False
    if "web_lamp" in light:
        strip["web_lamp"] = light["web_lamp"]

diffuser = bpy.data.materials.get("Opal diffuser")
if diffuser is not None:
    bsdf = next(n for n in diffuser.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.86, 0.72, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 3.0


# ---------------------------------------------------------------------------------------------------- contents

def fill_cutlery(f, bld):
    w, d = f.w, f.d
    f.box(bld, 0.01, w - 0.01, 0.01, d - 0.02, 0, 0.008, M["oak"])  # insert
    cols = 5
    for i in range(1, cols):
        a = 0.01 + (w - 0.02) * i / cols
        f.box(bld, a - 0.004, a + 0.004, 0.01, d - 0.02, 0, 0.045, M["oak"])
    for i in range(cols):
        a0 = 0.01 + (w - 0.02) * i / cols
        cw = (w - 0.02) / cols
        for k in range(rng.randint(4, 7)):
            a = a0 + cw * (0.25 + 0.5 * k / 6)
            f.box(bld, a - 0.006, a + 0.006, 0.04, 0.04 + 0.17, 0.008 + k * 0.003, 0.012 + k * 0.003, M["steel"])
            f.box(bld, a - 0.012, a + 0.012, 0.03, 0.08, 0.008 + k * 0.003, 0.014 + k * 0.003, M["steel"])


def fill_utensils(f, bld):
    for k in range(6):
        a = 0.05 + (f.w - 0.1) * k / 5
        mat = M["oak"] if k % 2 else M["black"]
        f.box(bld, a - 0.01, a + 0.01, 0.04, 0.32, 0.0, 0.015, mat)
        f.box(bld, a - 0.03, a + 0.03, 0.32, 0.4, 0.0, 0.01, mat)


def fill_pots(f, bld, n=2):
    r = min(f.w / (2 * n) - 0.01, f.d / 2 - 0.02, 0.12)
    for k in range(n):
        a = f.w * (k + 0.5) / n
        h = min(f.h - 0.03, 0.09 + 0.04 * k)
        f.cyl(bld, a, f.d / 2, 0.0, r, h, M["steel"])
        f.cyl(bld, a, f.d / 2, h, r * 1.02, 0.008, M["glass"])
        f.cyl(bld, a, f.d / 2, h + 0.008, 0.015, 0.02, M["black"])


def fill_containers(f, bld):
    for i in range(3):
        for j in range(2):
            a0 = 0.02 + i * (f.w - 0.04) / 3
            b0 = 0.03 + j * (f.d - 0.06) / 2
            hh = min(f.h - 0.02, 0.06 + 0.03 * ((i + j) % 2))
            f.box(bld, a0 + 0.005, a0 + (f.w - 0.04) / 3 - 0.005, b0 + 0.005, b0 + (f.d - 0.06) / 2 - 0.005, 0, hh,
                  M["glass"])
            f.box(bld, a0 + 0.003, a0 + (f.w - 0.04) / 3 - 0.003, b0 + 0.003, b0 + (f.d - 0.06) / 2 - 0.003, hh,
                  hh + 0.012, M["blue"] if (i + j) % 2 else M["white"])


def fill_towels(f, bld):
    for i in range(3):
        a0 = 0.02 + i * (f.w - 0.04) / 3
        for k in range(rng.randint(2, 4)):
            f.box(bld, a0 + 0.01, a0 + (f.w - 0.04) / 3 - 0.01, 0.05, f.d - 0.08, k * 0.02, k * 0.02 + 0.018,
                  FABRICS[(i * 3 + k) % 4])


def fill_plates(f, bld):
    r = min(f.w / 4 - 0.01, f.d / 2 - 0.03, 0.13)
    for k, a in enumerate((f.w * 0.27, f.w * 0.73)):
        for j in range(5 if k == 0 else 3):
            f.cyl(bld, a, f.d / 2, j * 0.018, r if k == 0 else r * 0.75, 0.014 if k == 0 else 0.04,
                  M["white"] if k == 0 else M["blue"], segments=20)


def fill_spices(f, bld):
    for i in range(int((f.w - 0.04) / 0.06)):
        for j in range(int((f.d - 0.06) / 0.07)):
            a, b = 0.05 + i * 0.06, 0.05 + j * 0.07
            f.cyl(bld, a, b, 0, 0.022, 0.09, M["jar"], segments=10)
            f.cyl(bld, a, b, 0.09, 0.023, 0.018, M["black"] if (i + j) % 2 else M["oak"], segments=10)


def fill_bottles(f, bld, n=None, tall=0.26):
    n = n or max(2, int(f.w / 0.09))
    for i in range(n):
        a = f.w * (i + 0.5) / n
        h = min(tall + rng.uniform(-0.04, 0.03), f.h - 0.05)
        f.cyl(bld, a, f.d / 2 + rng.uniform(-0.03, 0.03), 0, 0.032, h * 0.7, BOTTLES[i % 2], segments=12)
        f.cyl(bld, a, f.d / 2, h * 0.7, 0.032, h * 0.08, BOTTLES[i % 2], radius2=0.013, segments=12)
        f.cyl(bld, a, f.d / 2, h * 0.78, 0.012, h * 0.17, BOTTLES[i % 2], segments=10)
        f.cyl(bld, a, f.d / 2, h * 0.95, 0.013, h * 0.05, M["black"], segments=10)


def fill_glasses(f, bld, rows=2):
    for j in range(rows):
        for i in range(int((f.w - 0.04) / 0.085)):
            f.cyl(bld, 0.05 + i * 0.085, 0.06 + j * 0.11, 0, 0.034, 0.11 + 0.03 * (j % 2), M["glass"], segments=12)


def fill_mugs(f, bld):
    for i in range(int((f.w - 0.04) / 0.1)):
        f.cyl(bld, 0.06 + i * 0.1, 0.08, 0, 0.04, 0.09, M["blue"] if i % 2 else M["white"], segments=12)
    for i in range(2):
        f.box(bld, 0.03 + i * 0.12, 0.13 + i * 0.12, f.d - 0.12, f.d - 0.03, 0, 0.18, M["label"])


def fill_shelves(f, bld, levels, mat=None, fill=None):
    """Shelves at fractions of the height; fill(frame) stocks each level (including the floor)."""
    mat = mat or M["interior"]
    floors = [0.0] + list(levels)
    for z in levels:
        f.box(bld, 0, f.w, 0.005, f.d - 0.005, f.h * z - 0.009, f.h * z + 0.009, mat)
    if fill:
        tops = list(levels) + [1.0]
        for z0, z1 in zip(floors, tops):
            c0 = f.h * z0 + (0.009 if z0 else 0.0)
            fill(f.sub(0.01, 0.0, c0, f.w - 0.02, f.d - 0.01, f.h * (z1 - z0) - 0.02), bld)


def fill_under_sink(f, bld):
    f.box(bld, f.w * 0.2, f.w * 0.8, 0.04, f.d - 0.08, f.h - 0.19, f.h, M["steel"])  # bowl
    f.cyl(bld, f.w * 0.5, f.d * 0.45, f.h - 0.32, 0.022, 0.13, M["dark"])
    f.cyl(bld, f.w * 0.5, f.d * 0.45, f.h - 0.34, 0.03, 0.03, M["dark"], axis="d")
    f.cyl(bld, f.w * 0.5, f.d * 0.7, f.h - 0.34, 0.02, f.d * 0.5, M["dark"], axis="d")
    f.cyl(bld, f.w * 0.27, f.d * 0.55, 0, 0.12, 0.32, M["black"], segments=18)  # bin
    for i in range(3):
        a = f.w * 0.62 + i * 0.07
        f.box(bld, a - 0.025, a + 0.025, 0.05, 0.11, 0, 0.2 + 0.03 * i, BINS[i % 3])
        f.box(bld, a - 0.01, a + 0.01, 0.07, 0.09, 0.2 + 0.03 * i, 0.24 + 0.03 * i, M["white"])


def fill_dishwasher(f, bld):
    for level, c in (("lower", 0.08), ("upper", f.h * 0.55)):
        f.box(bld, 0.01, f.w - 0.01, 0.02, f.d - 0.03, c, c + 0.006, M["rack"])
        for i in range(9):
            a = 0.03 + (f.w - 0.06) * i / 8
            f.box(bld, a - 0.002, a + 0.002, 0.02, f.d - 0.03, c, c + 0.07, M["rack"])
        if level == "lower":
            for i in range(7):
                f.cyl(bld, 0.08 + i * 0.065, f.d * 0.5, c + 0.13, 0.11, 0.012, M["white"], axis="u", segments=20)
        else:
            for i in range(5):
                f.cyl(bld, 0.07 + i * 0.1, f.d * 0.4, c + 0.006, 0.035, 0.1, M["glass"], segments=12)


def fill_fridge(f, bld):
    fill_shelves(f, bld, (0.25, 0.5, 0.75), M["shelf glass"], fill=lambda s, b: fridge_level(s, b))


def fridge_level(f, bld):
    k = rng.randint(0, 2)
    if k == 0:
        for i in range(3):
            f.box(bld, 0.03 + i * 0.09, 0.1 + i * 0.09, 0.05, 0.12, 0, min(0.2, f.h - 0.02),
                  M["carton"] if i % 2 else M["carton blue"])
    elif k == 1:
        for i in range(4):
            f.cyl(bld, 0.06 + i * 0.09, 0.12, 0, 0.035, min(0.12, f.h - 0.02), M["jar"], segments=12)
    else:
        f.box(bld, 0.05, 0.3, 0.05, 0.2, 0, 0.04, M["carton"])
        for i in range(3):  # eggs
            f.cyl(bld, 0.09 + i * 0.07, 0.12, 0.04, 0.022, 0.03, M["white"], segments=10)
    f.box(bld, f.w - 0.2, f.w - 0.03, f.d - 0.25, f.d - 0.03, 0, min(0.1, f.h - 0.02), existing("Fruit 0", rgb=(0.8, 0.3, 0.1)))


def fill_freezer(f, bld):
    fill_shelves(f, bld, (0.5,), M["fridge"])
    for z in (0.0, 0.5):
        f.box(bld, 0.02, f.w - 0.02, 0.03, f.d - 0.04, f.h * z + 0.01, f.h * z + f.h * 0.42, M["glass"])


def fill_pantry(f, bld):
    def level(s, b):
        for i in range(int((s.w - 0.02) / 0.075)):
            for j in range(3):
                kind = (i + j) % 3
                if kind == 0:
                    s.cyl(b, 0.045 + i * 0.075, 0.06 + j * 0.15, 0, 0.032, min(0.16, s.h - 0.02), M["jar"], segments=12)
                elif kind == 1:
                    s.box(b, 0.015 + i * 0.075, 0.07 + i * 0.075, 0.02 + j * 0.15, 0.1 + j * 0.15, 0,
                          min(0.22, s.h - 0.02), BOOKS[(i + j) % 5])
                else:
                    s.cyl(b, 0.045 + i * 0.075, 0.06 + j * 0.15, 0, 0.034, min(0.11, s.h - 0.02), M["steel"], segments=12)
    fill_shelves(f, bld, (0.2, 0.4, 0.6, 0.8), M["rack"], fill=level)


def fill_oils(f, bld):
    fill_shelves(f, bld, (0.5,), M["rack"], fill=lambda s, b: fill_bottles(s, b, n=2, tall=0.28))


def fill_coffee_low(f, bld):
    fill_shelves(f, bld, (0.5,), M["interior"], fill=fill_mugs)


def fill_glasses_cabinet(f, bld):
    fill_shelves(f, bld, (0.33, 0.66), M["interior"], fill=lambda s, b: fill_glasses(s, b, rows=2))


def fill_cleaning(f, bld):
    f.cyl(bld, f.w * 0.3, f.d * 0.5, 0, 0.12, 0.26, BINS[0], segments=18)
    for i in range(3):
        a = f.w * 0.6 + i * 0.07
        f.box(bld, a - 0.025, a + 0.025, 0.06, 0.14, 0, 0.24, BINS[(i + 1) % 3])
    fill_shelves(f, bld, (0.55,), M["interior"], fill=None)
    for i in range(4):
        f.box(bld, 0.04 + i * 0.12, 0.13 + i * 0.12, 0.05, 0.25, f.h * 0.55 + 0.01, f.h * 0.55 + 0.05,
              FABRICS[i % 4])


def fill_shoes(f, bld):
    for i in range(int((f.w - 0.04) / 0.19)):
        a0 = 0.03 + i * 0.19
        upper = M["leather"] if i % 2 else M["sneaker"]
        for s in (0.0, 0.085):
            f.box(bld, a0 + s, a0 + s + 0.075, 0.02, 0.27, 0, 0.02, M["sole"])
            f.box(bld, a0 + s + 0.005, a0 + s + 0.07, 0.03, 0.26, 0.02, 0.07, upper)
            f.box(bld, a0 + s + 0.008, a0 + s + 0.067, 0.15, 0.26, 0.07, 0.11, upper)


def fill_bar(f, bld):
    fill_shelves(f, bld, (0.5,), M["interior"],
                 fill=lambda s, b: (fill_bottles(s, b, tall=0.3) if s.o.z < f.o.z + 0.1 else fill_glasses(s, b, rows=2)))


def fill_nightstand(f, bld):
    f.box(bld, 0.03, 0.17, 0.03, 0.24, 0, 0.025, BOOKS[1])
    f.box(bld, 0.04, 0.16, 0.05, 0.22, 0.025, 0.04, BOOKS[3])
    f.box(bld, 0.2, 0.3, 0.05, 0.11, 0, 0.03, M["black"])  # glasses case
    f.cyl(bld, 0.24, 0.22, 0, 0.03, 0.012, M["white"], segments=12)  # charger
    f.box(bld, 0.21, 0.28, 0.26, f.d - 0.05, 0, 0.004, M["white"])  # cable


def fill_wardrobe(f, bld):
    f.box(bld, 0, f.w, 0.0, f.d, f.h - 0.36, f.h - 0.342, M["interior"])  # hat shelf
    f.cyl(bld, f.w / 2, f.d / 2, f.h - 0.42, 0.012, f.w - 0.02, M["steel"], axis="u")
    a = 0.06
    while a < f.w - 0.06:
        t = rng.uniform(0.03, 0.07)
        length = rng.uniform(0.65, 1.05)
        f.box(bld, a, a + t, f.d / 2 - 0.22, f.d / 2 + 0.22, f.h - 0.44 - length, f.h - 0.44, rng.choice(FABRICS))
        f.cyl(bld, a + t / 2, f.d / 2, f.h - 0.43, 0.004, 0.4, M["black"], axis="d", segments=6)
        a += t + rng.uniform(0.01, 0.04)
    for i in range(int(f.w / 0.4)):  # boxes and folded stacks on the shelf
        a0 = 0.03 + i * 0.4
        if i % 2:
            f.box(bld, a0, a0 + 0.34, 0.04, f.d - 0.04, f.h - 0.342, f.h - 0.12, STORAGE)
        else:
            for k in range(4):
                f.box(bld, a0, a0 + 0.3, 0.06, 0.36, f.h - 0.342 + k * 0.04, f.h - 0.342 + k * 0.04 + 0.038,
                      FABRICS[(i + k) % len(FABRICS)])
    for i in range(int(f.w / 0.36)):  # shoe boxes on the floor
        f.box(bld, 0.03 + i * 0.36, 0.33 + i * 0.36, 0.05, 0.25, 0, 0.12, STORAGE)


def fill_workshop(f, bld):
    def level(s, b):
        for i in range(int(s.w / 0.32)):
            s.box(b, 0.01 + i * 0.32, 0.3 + i * 0.32, 0.03, min(s.d - 0.02, 0.4), 0, min(0.22, s.h - 0.03),
                  BINS[i % 3])
    fill_shelves(f, bld, (0.22, 0.44, 0.66, 0.85), M["interior"], fill=level)


def fill_tools(f, bld):
    for i in range(5):
        a = 0.05 + i * (f.w - 0.1) / 4
        f.cyl(bld, a, f.d * 0.35, 0.015, 0.013, 0.1, TOOLS[i % 2], axis="d", segments=10)
        f.cyl(bld, a, f.d * 0.35 + 0.11, 0.015, 0.003, 0.12, M["steel"], axis="d", segments=6)
    f.box(bld, 0.05, f.w - 0.05, f.d * 0.62, f.d - 0.04, 0, min(0.05, f.h - 0.02), M["black"])


def fill_spools(f, bld):
    for i in range(int((f.w - 0.02) / 0.21)):
        f.cyl(bld, 0.11 + i * 0.21, f.d / 2, 0, 0.1, min(0.07, f.h - 0.02), FILAMENTS[i % 6], segments=20)


def fill_parts(f, bld):
    for i in range(3):
        for j in range(2):
            f.box(bld, 0.02 + i * (f.w - 0.04) / 3, (i + 1) * (f.w - 0.04) / 3, 0.03 + j * 0.2, 0.2 + j * 0.2, 0,
                  min(0.06, f.h - 0.02), M["glass"])
            f.box(bld, 0.04 + i * (f.w - 0.04) / 3, (i + 1) * (f.w - 0.04) / 3 - 0.02, 0.05 + j * 0.2,
                  0.18 + j * 0.2, 0, 0.02, TOOLS[(i + j) % 2])


FILLS = {
    "cutlery": fill_cutlery, "utensils": fill_utensils, "pots": fill_pots, "pans": lambda f, b: fill_pots(f, b, 3),
    "containers": fill_containers, "towels": fill_towels, "plates": fill_plates, "spices": fill_spices,
    "under-sink": fill_under_sink, "dishwasher": fill_dishwasher, "fridge": fill_fridge, "freezer": fill_freezer,
    "pantry": fill_pantry, "oils": fill_oils, "coffee-low": fill_coffee_low, "glasses": fill_glasses_cabinet,
    "cleaning": fill_cleaning, "shoes": fill_shoes, "bar": fill_bar, "nightstand": fill_nightstand,
    "wardrobe": fill_wardrobe, "workshop": fill_workshop, "tools": fill_tools, "spools": fill_spools,
    "parts": fill_parts,
}


# ---------------------------------------------------------------------------------------------------- movables

WEST = "West base cabinets"
# (front, pulls, carcass, kind, contents, cavity key: fronts sharing one share one hollow and its contents)
MOVABLES = [
    ("Front S1 pull-out", ["Pull Front S1 pull-out"], WEST, "pullout", "oils", None),
    ("Front S2 hob drawers 0", ["Pull Front S2 hob drawers 0"], WEST, "drawer", "pots", None),
    ("Front S2 hob drawers 1", ["Pull Front S2 hob drawers 1"], WEST, "drawer", "pans", None),
    ("Front S3 prep drawers 0", ["Pull Front S3 prep drawers 0"], WEST, "drawer", "cutlery", None),
    ("Front S3 prep drawers 1", ["Pull Front S3 prep drawers 1"], WEST, "drawer", "utensils", None),
    ("Front S3 prep drawers 2", ["Pull Front S3 prep drawers 2"], WEST, "drawer", "towels", None),
    ("Front S4 sink doors L", ["Pull Front S4 sink doors L"], WEST, "door", "under-sink", "sink"),
    ("Front S4 sink doors R", ["Pull Front S4 sink doors R"], WEST, "door", None, "sink"),
    ("Front Dishwasher panel", ["Pull Front Dishwasher panel"], WEST, "flap", "dishwasher", None),
    ("Island front 00", ["Island pull 00"], "Island base", "drawer", "cutlery", None),
    ("Island front 01", ["Island pull 01"], "Island base", "drawer", "containers", None),
    ("Island front 02", ["Island pull 02"], "Island base", "drawer", "towels", None),
    ("Island front 10", ["Island pull 10"], "Island base", "drawer", "plates", None),
    ("Island front 11", ["Island pull 11"], "Island base", "drawer", "pans", None),
    ("Island front 30", ["Island pull 30"], "Island base", "drawer", "spices", None),
    ("Island front 31", ["Island pull 31"], "Island base", "drawer", "containers", None),
    ("Front pantry pull-out", ["Pull Front pantry pull-out"], "Pantry column", "pullout", "pantry", None),
    ("Fridge door upper", ["Fridge handle upper"], "Fridge body", "door", "fridge", None),
    ("Fridge door lower", ["Fridge handle lower"], "Fridge body", "door", "freezer", None),
    ("Coffee station lower door 0", ["Coffee station pull low 0"], "Coffee station carcass", "door", "coffee-low", "low"),
    ("Coffee station lower door 1", ["Coffee station pull low 1"], "Coffee station carcass", "door", None, "low"),
    ("Coffee station upper door 0", ["Coffee station pull up 0"], "Coffee station carcass", "door", "glasses", "up"),
    ("Coffee station upper door 1", ["Coffee station pull up 1"], "Coffee station carcass", "door", None, "up"),
    ("Utility base door", [], "Utility base", "door", "cleaning", None),
    ("Entrada shoe flap", [], "Entrada shoe cabinet", "flap", "shoes", None),
    ("Bar cabinet door 0", ["Bar cabinet pull 0"], "Bar cabinet bar block", "door", "bar", "bar"),
    ("Bar cabinet door 1", ["Bar cabinet pull 1"], "Bar cabinet bar block", "door", None, "bar"),
    ("Nightstand drawer 0", [], "Nightstand 0", "drawer", "nightstand", None),
    ("Nightstand drawer 1", [], "Nightstand 1", "drawer", "nightstand", None),
    ("Wardrobe Q01 door 0", ["Wardrobe Q01 pull 0", "Wardrobe Q01 pull 0 post 0", "Wardrobe Q01 pull 0 post 1"],
     "Wardrobe Quarto 01", "door", "wardrobe", "q01"),
    ("Wardrobe Q01 door 1", ["Wardrobe Q01 pull 1", "Wardrobe Q01 pull 1 post 0", "Wardrobe Q01 pull 1 post 1"],
     "Wardrobe Quarto 01", "door", None, "q01"),
    ("Wardrobe Q01 door 2", ["Wardrobe Q01 pull 2", "Wardrobe Q01 pull 2 post 0", "Wardrobe Q01 pull 2 post 1"],
     "Wardrobe Quarto 01", "door", None, "q01"),
    ("Wardrobe Q02 door 0", ["Wardrobe Q02 pull 0", "Wardrobe Q02 pull 0 post 0", "Wardrobe Q02 pull 0 post 1"],
     "Wardrobe Quarto 02", "door", "wardrobe", "q02"),
    ("Wardrobe Q02 door 1", ["Wardrobe Q02 pull 1", "Wardrobe Q02 pull 1 post 0", "Wardrobe Q02 pull 1 post 1"],
     "Wardrobe Quarto 02", "door", None, "q02"),
    ("Wardrobe door 0", ["Wardrobe handle 0"], "Workshop wardrobe carcass", "door", "workshop", "ws0"),
    ("Wardrobe door 2", ["Wardrobe handle 2"], "Workshop wardrobe carcass", "door", "workshop", "ws2"),
]
ANGLES = {"door": math.radians(100), "flap": math.radians(80)}
WALL = 0.016  # carcass panel left around each hollow


def cavity_cut(carcass, lo, hi, interior_mat):
    """A hidden box the carcass's boolean modifier takes away. The hollow's faces keep the cutter's material index,
    which points at the interior material in the carcass's own slots."""
    col = collection(f"Cutters - {carcass.name}", cutters_root, hidden=True)
    if interior_mat.name not in [s.material.name for s in carcass.material_slots if s.material]:
        carcass.data.materials.append(interior_mat)
    b = Builder()
    b.mats = [s.material for s in carcass.material_slots]
    b.box(lo, hi, interior_mat)
    cutter = b.build(f"Cutter {carcass.name} {len(col.objects)}", col)
    cutter.hide_render = True
    cutter.display_type = "WIRE"
    if not any(m.type == "BOOLEAN" and m.name == "Movable cavities" for m in carcass.modifiers):
        mod = carcass.modifiers.new("Movable cavities", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.operand_type = "COLLECTION"
        mod.collection = col
        mod.solver = "EXACT"
        if hasattr(mod, "material_mode"):
            mod.material_mode = "INDEX"
    return cutter


HINGE_SIDE = {"Front S4 sink doors R": -1}  # centred pull: which end the pull is toward (+1: +u), so the hinge is at the other


def pull_side(name, pulls, k, lo, hi):
    """+1 when the pull sits toward the front's +u end, -1 toward -u, 0 centred or none."""
    if name in HINGE_SIDE:
        return HINGE_SIDE[name]
    if not pulls:
        return 0
    c = np.mean([np.mean(bbox(p), axis=0) for p in pulls], axis=0)
    du = (c - (lo + hi) / 2)[1 - k] / max((hi - lo)[1 - k], 1e-6)
    return 0 if abs(du) < 0.15 else (1 if du > 0 else -1)


def make_movable(spec, cavity):
    front_name, pull_names, carcass_name, kind, _, _ = spec
    front = scene.objects[front_name]
    pulls = [scene.objects[n] for n in pull_names]
    lo, hi = bbox(front)
    u, n, face, k = cavity["frame"]
    side = pull_side(front_name, pulls, k, lo, hi)
    col = front.users_collection[0]
    b = Builder()
    for p in pulls:
        b.absorb(p)
    b.absorb(front)
    fr = cavity["box"]  # the hollow, as a Frame
    if kind in ("drawer", "pullout"):
        # The drawer's own box in the front's span of the hollow.
        a0 = lo[1 - k] - fr.o[1 - k]  # u always points along +x or +y
        w = abs(hi[1 - k] - lo[1 - k])
        a0, w = max(a0, 0.0) + 0.008, min(w, fr.w) - 0.016
        c0 = max(lo[2] - fr.o.z, 0.0) + 0.01
        hgt = min(hi[2] - fr.o.z, fr.h) - c0 - (0.03 if kind == "drawer" else 0.01)
        depth = fr.d - 0.03
        box = fr.sub(a0, 0.0, c0, w, depth, hgt)
        t = 0.012
        if kind == "drawer":
            box.box(b, 0, w, 0.01, depth, 0, t, M["birch"])
            box.box(b, 0, t, 0.01, depth, 0, hgt, M["birch"])
            box.box(b, w - t, w, 0.01, depth, 0, hgt, M["birch"])
            box.box(b, 0, w, depth - t, depth, 0, hgt, M["birch"])
            box.box(b, 0, w, 0.01, 0.01 + t, 0, hgt * 0.8, M["birch"])
            inner = box.sub(t, 0.01 + t, t, w - 2 * t, depth - 0.01 - 2 * t, hgt - t)
        else:
            box.box(b, 0, w, 0.01, depth, 0, t, M["rack"])
            box.box(b, 0, w, depth - 0.01, depth, 0, hgt, M["rack"])
            inner = box.sub(0.004, 0.01, t, w - 0.008, depth - 0.02, hgt - t)
        if spec[4]:
            FILLS[spec[4]](inner, b)
        obj = b.build(front_name, col)
        obj["web_move"] = "slide"
        obj["web_dir"] = [float(v) for v in n]
        obj["web_dist"] = round(float(depth) * (0.85 if kind == "drawer" else 0.9), 3)
    else:
        back = face  # the front's inner face rests on the carcass face
        if kind == "door":
            hinge_u = lo[1 - k] if side >= 0 else hi[1 - k]  # hinge on the end away from the pull
            pivot = Vector((0.0, 0.0, (lo[2] + hi[2]) / 2))
            pivot[1 - k] = hinge_u
            pivot[k] = back
            axis = Vector(Z)
            free = Vector((0.0, 0.0, 0.0))
            free[1 - k] = 1.0 if side >= 0 else -1.0
        else:  # flap: hinged along its bottom edge
            pivot = Vector((0.0, 0.0, lo[2]))
            pivot[1 - k] = (lo[1 - k] + hi[1 - k]) / 2
            pivot[k] = back
            axis = Vector(u)
            free = Vector(Z)
        angle = ANGLES[kind] * (1 if axis.cross(free).dot(n) > 0 else -1)
        if front_name.startswith("Fridge"):
            angle *= 1.1
        obj = b.build(front_name, col, origin=pivot)
        obj["web_move"] = "hinge"
        obj["web_pivot"] = [float(v) for v in pivot]
        obj["web_axis"] = [float(v) for v in axis]
        obj["web_angle"] = round(float(angle), 5)
    report.append(f"movable {front_name}: {obj['web_move']}")
    return obj


def plan_cavities():
    """One hollow per cavity key (or per front), cut from its carcass, with contents for hinged fronts."""
    groups = {}
    for spec in MOVABLES:
        key = (spec[2], spec[5] or spec[0])
        groups.setdefault(key, []).append(spec)
    cavities = {}
    for (carcass_name, _), specs in groups.items():
        carcass = scene.objects[carcass_name]
        clo, chi = bbox(carcass)
        los, his = zip(*(bbox(scene.objects[s[0]]) for s in specs))
        lo, hi = np.min(los, axis=0), np.max(his, axis=0)
        u, n, face, k = front_frame(lo, hi, clo, chi)
        j = 1 - k
        back = chi[k] if n[k] < 0 else clo[k]
        interior = M["fridge"] if carcass_name == "Fridge body" else (
            M["steel"] if "Dishwasher" in specs[0][0] else M["interior"])
        u0, u1 = max(lo[j], clo[j]) + WALL, min(hi[j], chi[j]) - WALL
        z0, z1 = max(lo[2], clo[2]) + WALL * 0.75, min(hi[2], chi[2]) - WALL
        inner_back = back + (WALL if n[k] > 0 else -WALL)
        outer = face + 0.03 * n[k]
        c_lo = [0.0, 0.0, z0]
        c_hi = [0.0, 0.0, z1]
        c_lo[j], c_hi[j] = u0, u1
        c_lo[k], c_hi[k] = min(inner_back, outer), max(inner_back, outer)
        cavity_cut(carcass, c_lo, c_hi, interior)
        origin = Vector((0.0, 0.0, z0))
        origin[j] = u0
        origin[k] = face
        frame = Frame(origin, u, n, (u1 - u0, abs(face - inner_back), z1 - z0))
        cav = {"frame": (u, n, face, k), "box": frame}
        hinged = [s for s in specs if s[3] in ("door", "flap")]
        filler = next((s[4] for s in specs if s[4]), None)
        if hinged and filler:
            bld = Builder()
            FILLS[filler](frame.sub(0.005, 0.01, 0.0, frame.w - 0.01, frame.d - 0.02, frame.h), bld)
            if bld.mats:
                bld.build(f"{carcass_name} contents", carcass.users_collection[0])
        for s in specs:
            cavities[s[0]] = cav
    return cavities


def bench_fronts():
    """The workbench's drawer block is one solid with three pulls inside it: give it three real fronts."""
    block = scene.objects["Bench drawers"]
    lo, hi = bbox(block)
    mat = block.material_slots[0].material
    edges = [lo[2], 0.405, 0.61, hi[2]]
    specs = []
    for i, contents in enumerate(("tools", "parts", "spools")):
        b = Builder()
        b.box((lo[0] - 0.018, lo[1] + 0.002, edges[i] + 0.0015), (lo[0], hi[1] - 0.002, edges[i + 1] - 0.0015), mat)
        name = f"Bench drawer front {i}"
        b.build(name, block.users_collection[0])
        pull = scene.objects[f"Drawer pull {i}"]
        pull.location.x += (lo[0] - 0.018) - bbox(pull)[1][0]  # out of the block, onto the new front
        specs.append((name, [pull.name], block.name, "drawer", contents, None))
    return specs


def nightstand_fronts():
    """The nightstand fronts are flat planes: make them 18 mm panels with a knob."""
    for i in range(2):
        old = scene.objects[f"Nightstand drawer {i}"]
        lo, hi = bbox(old)
        col = old.users_collection[0]
        mat = old.material_slots[0].material
        bpy.data.objects.remove(old, do_unlink=True)
        b = Builder()
        b.box((lo[0] - 0.004, lo[1], lo[2]), (lo[0] + 0.014, hi[1], hi[2]), mat)
        b.build(f"Nightstand drawer {i}", col)
        k = Builder()
        k.cylinder((lo[0] + 0.024, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2), 0.012, 0.02, "x", M["black"])
        k.build(f"Nightstand knob {i}", col)


def utility_pull():
    """The utility cupboard and the shoe flap have no pull: add one, away from where they hinge."""
    door = scene.objects["Utility base door"]
    lo, hi = bbox(door)
    b = Builder()
    b.box((hi[0], hi[1] - 0.05, 0.6), (hi[0] + 0.02, hi[1] - 0.038, 0.85), M["black"])
    b.build("Utility base pull", door.users_collection[0])
    flap = scene.objects["Entrada shoe flap"]
    lo, hi = bbox(flap)
    b = Builder()
    cx = (lo[0] + hi[0]) / 2
    b.box((cx - 0.1, lo[1] - 0.02, hi[2] - 0.05), (cx + 0.1, lo[1], hi[2] - 0.038), M["black"])
    b.build("Entrada shoe flap pull", flap.users_collection[0])


nightstand_fronts()
for i in range(2):
    spec_i = next(j for j, s in enumerate(MOVABLES) if s[0] == f"Nightstand drawer {i}")
    MOVABLES[spec_i] = (MOVABLES[spec_i][0], [f"Nightstand knob {i}"], *MOVABLES[spec_i][2:])
utility_pull()
MOVABLES = [(s[0], ["Utility base pull"], *s[2:]) if s[0] == "Utility base door" else
            (s[0], ["Entrada shoe flap pull"], *s[2:]) if s[0] == "Entrada shoe flap" else s for s in MOVABLES]
MOVABLES += bench_fronts()
bpy.context.view_layer.update()
cavities = plan_cavities()
for spec in MOVABLES:
    make_movable(spec, cavities[spec[0]])


def hollow_coffee_niche():
    """The coffee station's niche (worktop, top shelf, tiled back) sat inside its solid carcass."""
    carcass = scene.objects["Coffee station carcass"]
    lo, hi = bbox(carcass)
    worktop = bbox(scene.objects["Coffee station niche worktop"])
    shelf = bbox(scene.objects["Coffee station niche top shelf"])
    back = bbox(scene.objects["Coffee station niche back"])
    cavity_cut(carcass, (lo[0] + WALL, lo[1] - 0.03, worktop[1][2] - 0.002),
               (hi[0] - WALL, back[0][1] + 0.001, shelf[0][2] + 0.002), M["interior"])


hollow_coffee_niche()


# ---------------------------------------------------------------------------------------------------- French doors

def french_doors(num, rooms):
    prefix = f"Glazed Door {num} ({rooms})"
    jambs = [scene.objects[f"{prefix} jamb"], scene.objects[f"{prefix} jamb.001"]]
    (j0lo, j0hi), (j1lo, j1hi) = bbox(jambs[0]), bbox(jambs[1])
    if j0lo[0] > j1lo[0]:
        (j0lo, j0hi), (j1lo, j1hi) = (j1lo, j1hi), (j0lo, j0hi)
    u0, u1 = j0hi[0], j1lo[0]
    yc = (j0lo[1] + j0hi[1]) / 2
    top = j0hi[2]
    for part in ("glass", "mullion", "rail", "rail.001"):
        o = scene.objects.get(f"{prefix} {part}")
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)
    col = jambs[0].users_collection[0]
    frame_mat = existing("Window frame aluminium", rgb=(0.85, 0.85, 0.85), metallic=0.8, roughness=0.3)
    glass_mat = existing("Glass", rgb=(0.9, 0.95, 0.95), roughness=0.05)
    um = (u0 + u1) / 2
    gap = 0.003
    for side, (a, bnd) in (("a", (u0 + gap, um - gap / 2)), ("b", (um + gap / 2, u1 - gap))):
        x0, x1 = a, bnd
        b = Builder()
        d0, d1 = yc - 0.025, yc + 0.025
        b.box((x0, d0, 0.005), (x0 + 0.055, d1, top - 0.004), frame_mat)
        b.box((x1 - 0.045, d0, 0.005), (x1, d1, top - 0.004), frame_mat)
        b.box((x0, d0, 0.005), (x1, d1, 0.095), frame_mat)
        b.box((x0, d0, top - 0.06), (x1, d1, top - 0.004), frame_mat)
        meet = x1 if side == "a" else x0
        inward = -1 if side == "a" else 1  # from the meeting stile toward the hinge
        if side == "a":
            for face, s in ((d0, -1), (d1, 1)):
                b.box((meet - 0.035, face + s * 0.0, 0.97), (meet - 0.012, face + s * 0.012, 1.07), M["black"])
                lever = sorted([meet - 0.024, meet - 0.024 + inward * 0.13])
                y = sorted([face + s * 0.012, face + s * 0.03])
                b.box((lever[0], y[0], 1.005), (lever[1], y[1], 1.025), M["black"])
        leaf = b.build(f"Door leaf {num}{side}", col)
        g = Builder()
        g.box((x0 + 0.05, yc - 0.003, 0.09), (x1 - 0.04, yc + 0.003, top - 0.055), glass_mat)
        glass = g.build(f"{prefix} glass" if side == "a" else f"{prefix} glass.001", col)
        glass["web_leaf"] = leaf.name
        report.append(f"French door leaf {leaf.name}: x {x0:.3f}..{x1:.3f}")


french_doors(4, "Exterior / Quarto 02")
french_doors(24, "Cozinha / Lavandaria")
french_doors(26, "Lavandaria / Marquise")


# ---------------------------------------------------------------------------------------------------- sockets

def socket(name, centre, normal, col):
    n = Vector(normal).normalized()
    t = Vector((-n.y, n.x, 0.0))
    b = Builder()
    half = t * 0.04 + Z * 0.04
    c = Vector(centre)
    p = [c - half, c + half + n * 0.009]
    b.box([min(q[i] for q in p) for i in range(3)], [max(q[i] for q in p) for i in range(3)], M["socket"])
    b.cylinder(c + n * 0.0095, 0.022, 0.002, n, M["socket insert"], segments=20)
    for s in (-1, 1):
        b.cylinder(c + n * 0.0106 + t * s * 0.0095, 0.0035, 0.0008, n, M["sole"], segments=8)
    b.build(name, col)


def place_sockets():
    dg = bpy.context.evaluated_depsgraph_get()
    lintels = [bbox(o) for o in scene.objects if o.type == "MESH" and o.name.endswith(" lintel")]
    count = 0
    for floor in [o for o in scene.objects if o.type == "MESH" and o.name.startswith("Floor - ")]:
        room = floor.name[len("Floor - "):]
        if room in ("Varanda", "Marquise", "Closet"):
            continue
        lo, hi = bbox(floor)
        found = []
        for axis, sign in ((0, -1), (0, 1), (1, -1), (1, 1)):
            other = 1 - axis
            for t in np.arange(lo[other] + 0.35, hi[other] - 0.35, 0.1):
                start = Vector((0.0, 0.0, 0.3))
                start[other] = t
                start[axis] = (lo[axis] if sign < 0 else hi[axis]) - sign * 0.3
                ray = Vector((0.0, 0.0, 0.0))
                ray[axis] = sign
                hit, loc, nrm, _, obj, _ = scene.ray_cast(dg, start, ray, distance=0.7)
                if not hit or abs(nrm.z) > 0.1 or obj is None:
                    continue
                if not (obj.name == "Walls" or obj.name.startswith(("Sala wainscot", "TV wall", "Marquise brick"))):
                    continue
                if any(l[0][0] - 0.35 < loc.x < l[1][0] + 0.35 and l[0][1] - 0.35 < loc.y < l[1][1] + 0.35
                       for l in lintels):
                    continue
                found.append((loc.copy(), nrm.copy()))
        picked = []
        for loc, nrm in found:  # two per room, spread out
            if not picked:
                picked.append((loc, nrm))
            elif len(picked) < 2 and min((loc - p).length for p, _ in picked) > 1.5:
                picked.append((loc, nrm))
        if len(picked) < 2 and found:
            far = max(found, key=lambda f: (f[0] - picked[0][0]).length)
            if (far[0] - picked[0][0]).length > 0.8:
                picked.append(far)
        for i, (loc, nrm) in enumerate(picked):
            socket(f"Socket {room} {i}", loc + nrm * 0.0005, nrm, details)
            count += 1
    for i, y in enumerate((-5.4, -4.05, -3.0)):  # above the kitchen worktop, on the splashback
        hit, loc, nrm, _, obj, _ = scene.ray_cast(dg, Vector((-2.9, y, 1.05)), Vector((-1, 0, 0)), distance=0.6)
        if hit:
            socket(f"Socket Cozinha worktop {i}", loc + nrm * 0.0005, nrm, details)
            count += 1
    report.append(f"{count} sockets")


place_sockets()

scene[MARK] = VERSION
print("\n".join(f"[details] {r}" for r in report))
if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
