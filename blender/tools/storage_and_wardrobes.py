"""One-off: a storage wall in the Sala and better bedroom wardrobes (October 2026).

- Sala, north wall (behind the dining table): the sideboard and its empty frame give way to a built-in storage wall,
  35 cm deep and floor to ceiling. Two tall warm-white cupboards with handleless doors at either end, a low run of four
  drawers between them with a small cupboard above, and an open oak niche in the middle with two shelves of books and
  ceramics, lit by an LED strip that switches on its own (lamp group `niche`).
- Quarto 01 and Quarto 02 wardrobes: fluted oak fronts with their grain running up (the doors had lost it when their
  pulls were joined in, which left them speckled), long black bar pulls, and an oak filler up to the ceiling.

Reuses the helpers of model_details.py. Run headless on a copy, after home_fixes.py:
    blender -b Untitled.blend --python blender/tools/storage_and_wardrobes.py -- --save
Refuses to run twice.
"""
import ast
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

MARK = "storage_and_wardrobes"
VERSION = 1

scene = bpy.context.scene
if scene.get(MARK) is not None:
    raise RuntimeError(f"already applied (version {scene[MARK]})")
scene.frame_set(scene.frame_end)


def _load_model_details():
    """The helper functions, classes and tables of model_details.py, without its one-off steps."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model_details.py")
    tree = ast.parse(open(path).read())
    tables = {"Z", "M", "FABRICS", "BOTTLES", "BOOKS", "BINS", "TOOLS", "FILAMENTS", "STORAGE", "details",
              "cutters_root", "rng", "report", "FILLS", "ANGLES", "WALL", "HINGE_SIDE"}
    body = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef))
            or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in tables for t in n.targets))]
    ns = {"__name__": "model_details_helpers", "scene": scene}
    exec(compile(ast.Module(body=body, type_ignores=[]), path, "exec"), ns)
    return ns


md = _load_model_details()
Builder, M, bbox, existing = md["Builder"], md["M"], md["bbox"], md["existing"]
report = md["report"]
M.update({
    "cabinet": existing("Cabinet warm white", rgb=(0.9, 0.88, 0.84)),
    "plinth": existing("Plinth", rgb=(0.2, 0.2, 0.2)),
    "ceramic": existing("Ceramic", rgb=(0.85, 0.82, 0.76)),
    "leaf": existing("Leaf", rgb=(0.2, 0.4, 0.2)),
    "pot": existing("Terracotta pot", rgb=(0.6, 0.3, 0.2)),
    "books": [existing(f"Book {i}", rgb=(0.5, 0.4, 0.3)) for i in range(7)],
})
GRAIN_UP, GRAIN_ALONG_X = (0.0, 0.0, -0.98), (-0.98, 0.0, 0.0)
CEILING = 2.628


def build(b, name, col, grain=None, origin=None):
    obj = b.build(name, col, origin)
    if grain:
        obj["grain_stretch"] = grain
    return obj


def remove(names):
    for n in names:
        o = bpy.data.objects.get(n)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)


# ---------------------------------------------------------------------------------------------------- Sala storage

sala = bpy.data.objects["Dining table"].users_collection[0]
remove(["Sideboard", "Sideboard vase", "Sideboard books", "Sideboard art"] + [f"Sideboard leg {i}" for i in range(4)])

WALL_Y = bbox(bpy.data.objects["Floor - Sala"])[1][1]  # the north wall's face
DEPTH, T = 0.35, 0.018
FRONT_Y = WALL_Y - DEPTH  # the carcasses' front face; fronts stand T in front of it
X0, X1 = 0.12, 3.07  # from just past the Sala's light switch by the Entrada door, to the slatted east wall
NX0, NX1 = 0.9, X1 - 0.9  # the middle section
PLINTH, LOW_TOP, BRIDGE = 0.08, 0.75, 2.2
GAP = 0.003


def carcass(name, x0, x1, z0, z1):
    b = Builder()
    b.box((x0, FRONT_Y, z0), (x1, WALL_Y, z1), M["cabinet"])
    return build(b, name, sala)


def front(name, x0, x1, z0, z1):
    b = Builder()
    b.box((x0 + GAP / 2, FRONT_Y - T, z0 + GAP / 2), (x1 - GAP / 2, FRONT_Y, z1 - GAP / 2), M["cabinet"])
    return build(b, name, sala)


carcass("Sala storage tall left", X0, NX0, PLINTH, CEILING)
carcass("Sala storage tall right", NX1, X1, PLINTH, CEILING)
carcass("Sala storage low", NX0, NX1, PLINTH, LOW_TOP)
carcass("Sala storage bridge", NX0, NX1, BRIDGE, CEILING)
b = Builder()
b.box((X0 + 0.01, FRONT_Y + 0.05, 0.0), (X1 - 0.01, WALL_Y, PLINTH), M["plinth"])
build(b, "Sala storage plinth", sala)

specs = []
HINGE = md["HINGE_SIDE"]  # handleless fronts: +1 hinges at the low-x end, -1 at the high-x end
for side, (x0, x1, fill) in (("left", (X0, NX0, "glasses")), ("right", (NX1, X1, "workshop"))):
    xm = (x0 + x1) / 2
    for k, (a, c) in enumerate(((x0, xm), (xm, x1))):
        name = f"Sala storage {side} door {k}"
        front(name, a, c, PLINTH, CEILING)
        HINGE[name] = 1 if k == 0 else -1
        specs.append((name, [], f"Sala storage tall {side}", "door", fill if k == 0 else None, side))
xm = (NX0 + NX1) / 2
for col_i, (a, c) in enumerate(((NX0, xm), (xm, NX1))):
    for row, (z0, z1, fill) in enumerate(((0.45, LOW_TOP, "cutlery" if col_i == 0 else "containers"),
                                          (PLINTH, 0.45, "towels" if col_i == 0 else "plates"))):
        name = f"Sala storage drawer {col_i}{row}"
        front(name, a, c, z0, z1)
        specs.append((name, [], "Sala storage low", "drawer", fill, None))
for k, (a, c) in enumerate(((NX0, xm), (xm, NX1))):
    name = f"Sala storage bridge door {k}"
    front(name, a, c, BRIDGE, CEILING)
    HINGE[name] = 1 if k == 0 else -1
    specs.append((name, [], "Sala storage bridge", "door", "coffee-low" if k == 0 else None, "bridge"))

bpy.context.view_layer.update()
md["MOVABLES"] = specs
cavities = md["plan_cavities"]()
for spec in specs:
    md["make_movable"](spec, cavities[spec[0]])

# The niche: an oak lining, two oak shelves, and things on them.
b = Builder()
b.box((NX0, WALL_Y - 0.012, LOW_TOP), (NX1, WALL_Y, BRIDGE), M["oak"])  # back
build(b, "Sala storage niche back", sala, GRAIN_ALONG_X)
b = Builder()
b.box((NX0, FRONT_Y - T, LOW_TOP), (NX1, WALL_Y, LOW_TOP + 0.025), M["oak"])  # the low run's top, oak like the niche
for z in (1.22, 1.7):
    b.box((NX0 + 0.002, FRONT_Y + 0.02, z - 0.015), (NX1 - 0.002, WALL_Y - 0.012, z + 0.015), M["oak"])
build(b, "Sala storage niche shelves", sala, GRAIN_ALONG_X)

y_mid = (FRONT_Y + WALL_Y) / 2
b = Builder()
x = NX0 + 0.08  # top of the low run: a row of books leaning on a vase, a bowl
for i in range(7):
    w = 0.025 + 0.008 * (i % 3)
    b.box((x, y_mid - 0.08, LOW_TOP + 0.025), (x + w, y_mid + 0.08, LOW_TOP + 0.025 + 0.22 + 0.03 * (i % 2)),
          M["books"][i % 7])
    x += w + 0.002
b.cylinder((NX0 + 0.55, y_mid, LOW_TOP + 0.025 + 0.13), 0.06, 0.26, "z", M["ceramic"], segments=20, radius2=0.035)
b.cylinder((NX1 - 0.25, y_mid, LOW_TOP + 0.025 + 0.03), 0.13, 0.06, "z", M["white"], segments=24, radius2=0.1)
z = 1.235  # first shelf: stacked plates and two stoneware jugs
for j in range(6):
    b.cylinder((NX0 + 0.25, y_mid, z + 0.006 + j * 0.016), 0.12, 0.012, "z", M["white"], segments=24)
for k, xx in enumerate((NX0 + 0.7, NX0 + 0.85)):
    b.cylinder((xx, y_mid, z + 0.1), 0.05 - 0.01 * k, 0.2 - 0.05 * k, "z", M["blue"] if k else M["ceramic"], segments=16)
b.box((NX1 - 0.4, y_mid - 0.1, z), (NX1 - 0.12, y_mid + 0.1, z + 0.04), M["books"][3])
b.box((NX1 - 0.38, y_mid - 0.09, z + 0.04), (NX1 - 0.15, y_mid + 0.09, z + 0.07), M["books"][5])
z = 1.715  # second shelf: books upright, a small plant
x = NX1 - 0.12
for i in range(9):
    w = 0.03 + 0.01 * (i % 3)
    b.box((x - w, y_mid - 0.09, z), (x, y_mid + 0.09, z + 0.24 + 0.02 * (i % 3)), M["books"][(i + 2) % 7])
    x -= w + 0.002
b.cylinder((NX0 + 0.25, y_mid, z + 0.06), 0.07, 0.12, "z", M["pot"], segments=16, radius2=0.055)
for k in range(5):
    a = 2 * math.pi * k / 5
    b.sphere((NX0 + 0.25 + 0.05 * math.cos(a), y_mid + 0.05 * math.sin(a), z + 0.17 + 0.03 * (k % 2)), 0.06, M["leaf"],
             scale=(1, 1, 0.7))
build(b, "Sala storage niche things", sala)

# An LED strip under the bridge, behind its front edge, and the light it gives.
b = Builder()
b.box((NX0 + 0.03, FRONT_Y + 0.02, BRIDGE - 0.004), (NX1 - 0.03, FRONT_Y + 0.036, BRIDGE - 0.0005), M["led"])
strip = build(b, "Sala storage niche LED", sala)
strip.visible_shadow = False
strip["web_lamp"] = "niche"
data = bpy.data.lights.new("Sala storage niche light", "AREA")
data.shape, data.size, data.size_y, data.energy, data.color = "RECTANGLE", NX1 - NX0 - 0.1, 0.03, 22.0, (1.0, 0.8, 0.6)
light = bpy.data.objects.new("Sala storage niche light", data)
sala.objects.link(light)
light.location = ((NX0 + NX1) / 2, FRONT_Y + 0.03, BRIDGE - 0.012)
light["web_lamp"] = "niche"
report.append(f"Sala storage wall x {X0}..{X1}, front at y {FRONT_Y - T:.3f}")


# ---------------------------------------------------------------------------------------------------- wardrobes

FLUTE_W, FLUTE_GAP, FLUTE_D = 0.018, 0.006, 0.006


def rework_door(door):
    """Fluted oak front, grain up, and a long bar pull at the edge away from the hinge (the door keeps its pivot)."""
    mw, inv = door.matrix_world.copy(), door.matrix_world.inverted()
    door.data = door.data.copy()
    slots = [s.material.name if s.material else "" for s in door.material_slots]
    bm = bmesh.new()
    bm.from_mesh(door.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if slots[f.material_index] == "Black steel"], context="FACES")
    bm.to_mesh(door.data)
    bm.free()
    lo, hi = bbox(door)
    face_y = hi[1]  # these wardrobes face +y
    pivot_x = door["web_pivot"][0]
    free_x = hi[0] if abs(pivot_x - lo[0]) < abs(pivot_x - hi[0]) else lo[0]
    b = Builder()
    n = int((hi[0] - lo[0] - 0.02) // (FLUTE_W + FLUTE_GAP))
    x0 = (lo[0] + hi[0]) / 2 - (n * (FLUTE_W + FLUTE_GAP) - FLUTE_GAP) / 2
    for i in range(n):
        a = x0 + i * (FLUTE_W + FLUTE_GAP)
        b.box((a, face_y, lo[2] + 0.015), (a + FLUTE_W, face_y + FLUTE_D, hi[2] - 0.015), M["oak"])
    px = free_x - 0.04 if free_x > pivot_x else free_x + 0.04
    py = face_y + FLUTE_D + 0.032
    b.cylinder((px, py, 1.2), 0.008, 1.0, "z", M["black"], segments=12)
    for z in (0.75, 1.65):
        b.cylinder((px, (face_y + FLUTE_D + py) / 2, z), 0.006, py - face_y - FLUTE_D, "y", M["black"], segments=10)
    extra = b.build(f"{door.name} flutes", door.users_collection[0])
    extra.data.transform(inv)  # into the door's own space, then join it in
    extra.matrix_world = mw
    bpy.ops.object.select_all(action="DESELECT")
    extra.select_set(True)
    door.select_set(True)
    bpy.context.view_layer.objects.active = door
    bpy.ops.object.join()
    door["grain_stretch"] = GRAIN_UP


for carcass_name, doors in (("Wardrobe Quarto 01", [f"Wardrobe Q01 door {i}" for i in range(3)]),
                            ("Wardrobe Quarto 02", [f"Wardrobe Q02 door {i}" for i in range(2)])):
    for d in doors:
        rework_door(bpy.data.objects[d])
    clo, chi = bbox(bpy.data.objects[carcass_name])
    dlo = min(bbox(bpy.data.objects[d])[0][0] for d in doors)
    dhi = max(bbox(bpy.data.objects[d])[1][0] for d in doors)
    front_y = max(bbox(bpy.data.objects[d])[1][1] for d in doors) - FLUTE_D - 0.002
    b = Builder()
    b.box((min(clo[0], dlo), clo[1], chi[2]), (max(chi[0], dhi), front_y, CEILING), M["oak"])
    build(b, f"{carcass_name} ceiling filler", bpy.data.objects[carcass_name].users_collection[0], GRAIN_ALONG_X)
    report.append(f"{carcass_name}: {len(doors)} fluted doors, filler to the ceiling")

scene[MARK] = VERSION
print("\n".join(f"[storage] {r}" for r in report))
if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
