"""One-off: fixes and finishes after walking through the flat (October 2026).

- Closed kitchen (`Kitchen - closed`, the kitchen as it is now): the bare east run and wall cabinets get fronts, pulls,
  drawers and cupboards that open, with contents; an LED strip under the east wall cabinets; things on the worktops; and
  a door in the doorway to the Entrada (`Door leaf 20`), which the open plan fills in.
- The lamps and LED strips of the open kitchen's island, shelves and coffee station move into `Kitchen - open`, so
  they no longer float in the closed kitchen.
- Hall and Entrada: the terracotta paint and the sand band go; the walls are plain like the rest. The console shelf
  moves to the west wall, out of the way of the Entrada door, which opens against the east wall.
- WC 02 (as it is): the toilet moves along the wall away from the vanity, the vanity top runs wider, and the octagonal
  mirror becomes a wide LED mirror. WC 01: the framed mirror gets an LED band.
- Sala: a rounded oak dining table with curved-back chairs and a few things on it, and a twisted LED pendant over it.

Reuses the helpers of model_details.py (Builder, the movables and their hollows, the fills). Run headless on a copy:
    blender -b Untitled.blend --python blender/tools/home_fixes.py -- --save
Refuses to run twice.
"""
import ast
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

MARK = "home_fixes"
VERSION = 1

scene = bpy.context.scene
if scene.get(MARK) is not None:
    raise RuntimeError(f"already applied (version {scene[MARK]})")
scene.frame_set(scene.frame_end)  # the export uses the finished flat


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
Builder, Frame, M, bbox, material, existing = md["Builder"], md["Frame"], md["M"], md["bbox"], md["material"], md["existing"]
Z = Vector((0.0, 0.0, 1.0))
report = md["report"]

M.update({
    "cabinet": existing("Cabinet warm white", rgb=(0.9, 0.88, 0.84)),
    "plaster": existing("Wall plaster", rgb=(0.9, 0.88, 0.84)),
    "mirror": existing("Mirror", rgb=(0.9, 0.9, 0.9), metallic=1.0, roughness=0.02),
    "leather": material("Chair leather cognac", (0.36, 0.19, 0.1), 0.45),
    "linen": existing("Curtain linen", rgb=(0.85, 0.8, 0.7)),
    "fruit": [existing(f"Fruit {i}", rgb=(0.8, 0.3, 0.1)) for i in range(3)],
    "books": [existing(f"Book {i}", rgb=(0.5, 0.4, 0.3)) for i in range(7)],
})


def col(name):
    return bpy.data.collections[name]


def move_to(obj, collection):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collection.objects.link(obj)


def own_mesh(obj):
    if obj.data.users > 1:
        obj.data = obj.data.copy()


def transform_world(obj, m):
    """Apply a world-space transform to the mesh itself, so the build-up animation can't undo it."""
    own_mesh(obj)
    mw = obj.matrix_world
    obj.data.transform(mw.inverted() @ m @ mw)


def translate(names, d):
    for n in names:
        transform_world(bpy.data.objects[n], Matrix.Translation(Vector(d)))


def stretch_x(name, lo0, hi0, lo1, hi1):
    """Map world x lo0..hi0 to lo1..hi1 (a box made wider or narrower)."""
    s = (hi1 - lo1) / (hi0 - lo0)
    m = Matrix.Translation((lo1, 0, 0)) @ Matrix.Diagonal((s, 1, 1, 1)) @ Matrix.Translation((-lo0, 0, 0))
    transform_world(bpy.data.objects[name], m)


def remove(names):
    for n in names:
        o = bpy.data.objects.get(n)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)


def copy_object(src_name, new_name, collection, world=Matrix()):
    """A standalone copy (own mesh, no animation, no parent) placed at `world` @ the source's final pose."""
    src = bpy.data.objects[src_name]
    mw = src.matrix_world.copy()
    obj = src.copy()
    obj.data = src.data.copy()
    obj.animation_data_clear()
    obj.parent = None
    obj.name = new_name
    collection.objects.link(obj)
    obj.matrix_world = world @ mw
    return obj


def glow_only(obj, lamp=None):
    obj.visible_shadow = False
    if lamp:
        obj["web_lamp"] = lamp


def area_light(name, collection, location, rotation, size, size_y, energy, color=(1.0, 0.8, 0.6), lamp=None):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = "RECTANGLE"
    data.size, data.size_y = size, size_y
    data.energy = energy
    data.color = color
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    if lamp:
        obj["web_lamp"] = lamp
    return obj


# ---------------------------------------------------------------------------------------------------- closed kitchen

closed = col("Kitchen - closed")
kopen = col("Kitchen - open")

# The open kitchen's own lamps and strips sat in Details, so the closed layout kept them, floating in mid-air.
for n in ("LED strip Coffee station niche light", "LED strip Shelf light", "Bulb Island pendant light 0",
          "Bulb Island pendant light 1"):
    move_to(bpy.data.objects[n], kopen)

GAP = 0.003
FRONT_T = 0.018


def front(name, axis_x, outward, u0, u1, z0, z1, collection):
    """A front panel on a carcass face at x = axis_x, facing `outward` (+1: +x), spanning y u0..u1 and z0..z1."""
    x0, x1 = sorted((axis_x, axis_x + outward * FRONT_T))
    b = Builder()
    b.box((x0, u0 + GAP / 2, z0 + GAP / 2), (x1, u1 - GAP / 2, z1 - GAP / 2), M["cabinet"])
    return b.build(name, collection)


def pull(name, axis_x, outward, y0, y1, z0, z1, collection):
    """A black bar pull standing 20 mm off the front."""
    x0, x1 = sorted((axis_x + outward * FRONT_T, axis_x + outward * (FRONT_T + 0.02)))
    b = Builder()
    b.box((x0, y0, z0), (x1, y1, z1), M["black"])
    return b.build(name, collection)


specs = []

# East base run: carcass x -1.68..-1.1 (face at -1.68, facing -x), y -4.9..-2.3, z 0.1..0.86.
EB = "East base cabinets"
FX, OUT = -1.68, -1
for i, (u0, u1, z0, z1, kind, fill, key) in enumerate((
        (-2.9, -2.3, 0.1, 0.86, "door", "cleaning", None),
        (-3.5, -2.9, 0.62, 0.86, "drawer", "cutlery", None),
        (-3.5, -2.9, 0.37, 0.62, "drawer", "utensils", None),
        (-3.5, -2.9, 0.1, 0.37, "drawer", "containers", None),
        (-4.1, -3.5, 0.48, 0.86, "drawer", "plates", None),
        (-4.1, -3.5, 0.1, 0.48, "drawer", "pans", None),
        (-4.5, -4.1, 0.1, 0.86, "door", "pots", "s4"),
        (-4.9, -4.5, 0.1, 0.86, "door", None, "s4"),
)):
    name = f"East front {i}"
    front(name, FX, OUT, u0, u1, z0, z1, closed)
    if kind == "drawer":
        yc = (u0 + u1) / 2
        p = pull(f"East pull {i}", FX, OUT, yc - 0.15, yc + 0.15, z1 - 0.045, z1 - 0.03, closed)
    else:
        # the pull at the free edge: the first door and the pair's north door hinge at their north (higher y) end
        y = u0 + 0.04 if i in (0, 6) else u1 - 0.04
        p = pull(f"East pull {i}", FX, OUT, y - 0.008, y + 0.008, z1 - 0.25, z1 - 0.05, closed)
    specs.append((name, [p.name], EB, kind, fill, key))

# East wall cabinets: carcass x -1.45..-1.1 (face at -1.45), y -4.9..-2.3, z 1.5..2.2. Two pairs of doors.
EW = "East wall cabinets"
for i, (u0, u1, fill, key, pull_lo) in enumerate((
        (-2.95, -2.3, "glasses", "w01", True), (-3.6, -2.95, None, "w01", False),
        (-4.25, -3.6, "coffee-low", "w23", True), (-4.9, -4.25, None, "w23", False))):
    name = f"East wall front {i}"
    front(name, -1.45, -1, u0, u1, 1.5, 2.2, closed)
    y = u0 + 0.04 if pull_lo else u1 - 0.04
    p = pull(f"East wall pull {i}", -1.45, -1, y - 0.008, y + 0.008, 1.53, 1.73, closed)
    specs.append((name, [p.name], EW, "door", fill, key))

# West wall cabinet 0 (closed layout only): x -3.24..-2.89 (face at -2.89, facing +x), y -4.63..-2.83.
WW = "West wall cabinet 0"
for i, (u0, u1, fill, key, pull_lo) in enumerate((
        (-3.43, -2.83, "glasses", "a", True), (-4.03, -3.43, None, "a", False), (-4.63, -4.03, "coffee-low", None, False))):
    name = f"West wall front {i}"
    front(name, -2.89, 1, u0, u1, 1.5, 2.2, closed)
    y = u0 + 0.04 if pull_lo else u1 - 0.04
    p = pull(f"West wall pull {i}", -2.89, 1, y - 0.008, y + 0.008, 1.53, 1.73, closed)
    specs.append((name, [p.name], WW, "door", fill, key))

bpy.context.view_layer.update()
md["MOVABLES"] = specs
cavities = md["plan_cavities"]()
for spec in specs:
    md["make_movable"](spec, cavities[spec[0]])

# An LED strip under the east wall cabinets, like the west one.
west_light = bpy.data.objects["West under-cabinet light"]
east_light = west_light.copy()
east_light.data = west_light.data.copy()
east_light.animation_data_clear()
east_light.name = "East under-cabinet light"
closed.objects.link(east_light)
east_light.matrix_world = Matrix.Translation((-1.3, -3.6, 1.48)) @ west_light.matrix_world.to_3x3().to_4x4()
rot = east_light.matrix_world.to_3x3()
long_is_x = east_light.data.size >= east_light.data.size_y
if long_is_x:
    east_light.data.size = 2.5
else:
    east_light.data.size_y = 2.5
bpy.context.view_layer.update()
long_axis = rot @ Vector((1, 0, 0) if long_is_x else (0, 1, 0))
side = long_axis.cross(rot @ Vector((0, 0, 1))).normalized()
back = rot @ Vector((0, 0, 1))
c = east_light.matrix_world.translation + back * 0.004
half = long_axis * 2.5 / 2 + side * 0.008 + back * 0.002
corners = [c - half, c + half]
b = Builder()
b.box([min(p[i] for p in corners) for i in range(3)], [max(p[i] for p in corners) for i in range(3)], M["led"])
glow_only(b.build("LED strip East under-cabinet light", closed))

# On the worktops: the coffee machine and kettle move to the east run, with a fruit bowl and a board; the knife rail,
# utensils and oil bottles stay by the hob.
R90 = Matrix.Rotation(math.radians(90), 4, "Z")


def onto(dst, src_centre, rotate=False):
    """World transform moving an object centred at src_centre (x, y) to dst (x, y), turned a quarter if asked."""
    m = Matrix.Translation((dst[0], dst[1], 0)) @ (R90 if rotate else Matrix())
    return m @ Matrix.Translation((-src_centre[0], -src_centre[1], 0))


copy_object("Counter deco coffee machine", "East worktop coffee machine", closed, onto((-1.36, -2.62), (-1.73, -1.38), True))
copy_object("Counter deco kettle", "East worktop kettle", closed, onto((-1.36, -2.95), (-1.35, -1.38)))
fruit = [n for n in ("Island deco fruit bowl", *(f"Island deco fruit {i}" for i in range(5)))]
for n in fruit:
    copy_object(n, f"East worktop {n[len('Island deco '):]}", closed, onto((-1.4, -4.4), (-1.15, -3.45)))
copy_object("Island deco board", "East worktop board", closed, onto((-1.38, -3.75), (-1.3, -4.1)))
for n in [o.name for o in kopen.objects if o.name.startswith("Counter deco") and
          not o.name.endswith(("coffee machine", "kettle"))]:
    copy_object(n, n.replace("Counter deco", "Closed counter deco"), closed)

# The door to the Entrada (door 20): a copy of the Entrada / Sala door, modelled open into the kitchen along its
# east wall, hinged at the doorway's east jamb. The open plan fills this doorway in (`Door 20 infill`).
leaf = copy_object("Door leaf 4", "Door leaf 20", closed, Matrix.Translation((-1.19 - -0.8655, 0, 0)))
report.append(f"Door leaf 20: x {bbox(leaf)[0][0]:.3f}..{bbox(leaf)[1][0]:.3f}, y {bbox(leaf)[0][1]:.3f}..{bbox(leaf)[1][1]:.3f}")


# ---------------------------------------------------------------------------------------------------- corridors

def floor_polys(name):
    floor = bpy.data.objects[name]
    mw = floor.matrix_world
    return [[(mw @ floor.data.vertices[i].co).to_2d() for i in p.vertices] for p in floor.data.polygons]


def inside(pt, polys):
    for poly in polys:
        hit = False
        for a, b2 in zip(poly, poly[1:] + poly[:1]):
            if (a.y > pt.y) != (b2.y > pt.y) and pt.x < a.x + (pt.y - a.y) * (b2.x - a.x) / (b2.y - a.y):
                hit = not hit
        if hit:
            return True
    return False


walls = bpy.data.objects["Walls"]
corridor = floor_polys("Floor - Hall") + floor_polys("Floor - Entrada")
slots = {s.material.name: i for i, s in enumerate(walls.material_slots) if s.material}
paint = {slots["Paint terracotta (office)"], slots["Paint sand band"]}
mw, nm = walls.matrix_world, walls.matrix_world.to_3x3().inverted().transposed()
upper = {}
facing = []
for p in walls.data.polygons:
    c = mw @ p.center
    n = (nm @ p.normal).normalized()
    if abs(n.z) > 0.5 or not inside((c + n * 0.06).to_2d(), corridor):
        continue
    if p.material_index in paint:
        facing.append(p)
    elif c.z > 1.3:
        upper[p.material_index] = upper.get(p.material_index, 0) + p.area
plain = max(upper, key=upper.get)
for p in facing:
    p.material_index = plain
report.append(f"corridors: {len(facing)} painted wall faces now {walls.material_slots[plain].material.name}")


# ---------------------------------------------------------------------------------------------------- hall shelf

# The Entrada door opens into the hall against its east wall, where the console shelf was: move it (and the key
# bowl) to the west wall, between the doorway and the WC 01 door.
shelf_lo, shelf_hi = bbox(bpy.data.objects["Hall console shelf"])
new_lo, new_hi = (-1.095, 2.0), (-0.895, 2.48)
transform_world(bpy.data.objects["Hall console shelf"],
                Matrix.Translation((new_lo[0], new_lo[1], 0)) @ Matrix.Diagonal((1, (new_hi[1] - new_lo[1]) / (shelf_hi[1] - shelf_lo[1]), 1, 1))
                @ Matrix.Translation((-shelf_lo[0], -shelf_lo[1], 0)))
bowl_lo, bowl_hi = bbox(bpy.data.objects["Hall key bowl"])
translate(["Hall key bowl"], (-0.995 - (bowl_lo[0] + bowl_hi[0]) / 2, 2.3 - (bowl_lo[1] + bowl_hi[1]) / 2, 0))


# ---------------------------------------------------------------------------------------------------- WC 02

wc2 = col("WC 02 - existing")
# The toilet moves 45 cm along the east wall, away from the vanity.
translate(["WC02ex toilet bowl", "WC02ex toilet cistern", "WC02ex toilet seat", "WC02ex flush button"], (0, 0.45, 0))
# The vanity: cabinet 1.0..2.6, its top a wider shelf 0.86..2.75; the two basins and their spouts spread out.
stretch_x("WC02ex vanity cabinet", 1.25, 2.03, 1.0, 2.6)
stretch_x("WC02ex vanity top", 1.25, 2.03, 0.86, 2.75)
translate(["WC02ex vanity door split"], (1.8 - 1.64, 0, 0))
translate(["WC02ex vessel basin 1", "WC02ex wall spout 1", "WC02ex spout lever 1"], (1.42 - 1.445, 0, 0))
translate(["WC02ex vessel basin 0", "WC02ex wall spout 0", "WC02ex spout lever 0"], (2.18 - 1.835, 0, 0))
# A wide frameless mirror with a glowing frosted border, and the light it gives.
remove(["WC02ex mirror (octagon)", "WC02ex mirror frame (octagon)"])
MX0, MX1, MZ0, MZ1 = 1.0, 2.6, 1.32, 1.95
# The painted wall stands a few millimetres proud of the tiles below it: mount the mirror on the paint.
hit, loc, *_ = scene.ray_cast(bpy.context.evaluated_depsgraph_get(), Vector(((MX0 + MX1) / 2, 1.6, (MZ0 + MZ1) / 2)),
                              Vector((0, -1, 0)), distance=1.0)
if not hit:
    raise RuntimeError("WC 02: no wall behind the mirror")
WALL_Y = loc.y + 0.0005
report.append(f"WC 02 mirror on the wall at y {loc.y:.4f}")
b = Builder()
b.box((MX0, WALL_Y, MZ0), (MX1, WALL_Y + 0.008, MZ1), M["mirror"])
b.build("WC02ex LED mirror", wc2)
b = Builder()
y0, y1, w = WALL_Y + 0.008, WALL_Y + 0.0095, 0.025
for lo, hi in (((MX0 + 0.02, y0, MZ0 + 0.02), (MX1 - 0.02, y1, MZ0 + 0.02 + w)),
               ((MX0 + 0.02, y0, MZ1 - 0.02 - w), (MX1 - 0.02, y1, MZ1 - 0.02)),
               ((MX0 + 0.02, y0, MZ0 + 0.02 + w), (MX0 + 0.02 + w, y1, MZ1 - 0.02 - w)),
               ((MX1 - 0.02 - w, y0, MZ0 + 0.02 + w), (MX1 - 0.02, y1, MZ1 - 0.02 - w))):
    b.box(lo, hi, M["led"])
glow_only(b.build("WC02ex LED mirror band", wc2))
area_light("WC02ex LED mirror light", wc2, ((MX0 + MX1) / 2, WALL_Y + 0.05, MZ1 - 0.04), (math.radians(90), 0, 0),
           MX1 - MX0 - 0.1, 0.04, 18.0)

# ---------------------------------------------------------------------------------------------------- WC 01

wc1 = col("WC 01 - existing")
b = Builder()
gx0, gx1, gz0, gz1, gy = -1.699, -1.289, 1.195, 1.905, 3.99
y0, y1, w = gy - 0.0015, gy - 0.0005, 0.02
for lo, hi in (((gx0 + 0.012, y0, gz0 + 0.012), (gx1 - 0.012, y1, gz0 + 0.012 + w)),
               ((gx0 + 0.012, y0, gz1 - 0.012 - w), (gx1 - 0.012, y1, gz1 - 0.012)),
               ((gx0 + 0.012, y0, gz0 + 0.012 + w), (gx0 + 0.012 + w, y1, gz1 - 0.012 - w)),
               ((gx1 - 0.012 - w, y0, gz0 + 0.012 + w), (gx1 - 0.012, y1, gz1 - 0.012 - w))):
    b.box(lo, hi, M["led"])
glow_only(b.build("WC01ex mirror LED band", wc1))
area_light("WC01ex mirror LED light", wc1, ((gx0 + gx1) / 2, gy - 0.05, gz1 - 0.04), (math.radians(-90), 0, 0),
           gx1 - gx0 - 0.06, 0.04, 12.0)


# ---------------------------------------------------------------------------------------------------- Sala dining

sala = bpy.data.objects["Dining table top"].users_collection[0]
CX, CY = 1.8, -3.2
remove([o.name for o in bpy.data.objects if o.name.startswith(("Dining chair", "Dining table", "Dining pendant"))]
       + ["Bulb Dining pendant light"])


def outline_stadium(length, width, n=24):
    """A rounded-end rectangle (a stadium) around the origin, long along x."""
    r = width / 2
    pts = []
    for i in range(n + 1):
        a = -math.pi / 2 + math.pi * i / n
        pts.append((length / 2 - r + r * math.cos(a), r * math.sin(a)))
    for i in range(n + 1):
        a = math.pi / 2 + math.pi * i / n
        pts.append((-(length / 2 - r) + r * math.cos(a), r * math.sin(a)))
    return pts


def prism(bld, pts, z0, z1, mat, centre=(0, 0), angle=0.0, chamfer=0.0):
    """Extrude a 2D outline from z0 to z1 (a softened top edge when chamfer > 0), planar UVs."""
    ca, sa = math.cos(angle), math.sin(angle)
    tr = [(centre[0] + x * ca - y * sa, centre[1] + x * sa + y * ca) for x, y in pts]
    cx = sum(p[0] for p in tr) / len(tr)
    cy = sum(p[1] for p in tr) / len(tr)
    rings = [(z0, 0.0), (z1 - chamfer, 0.0)] + ([(z1, chamfer)] if chamfer else [])
    bm = bld.bm
    vs = []
    for z, inset in rings:
        ring = []
        for x, y in tr:
            dx, dy = x - cx, y - cy
            d = math.hypot(dx, dy) or 1.0
            ring.append(bm.verts.new((x - dx / d * inset, y - dy / d * inset, z)))
        vs.append(ring)
    faces = []
    for ra, rb in zip(vs, vs[1:]):
        for i in range(len(tr)):
            j = (i + 1) % len(tr)
            faces.append(bm.faces.new((ra[i], ra[j], rb[j], rb[i])))
    faces.append(bm.faces.new(list(reversed(vs[0]))))
    faces.append(bm.faces.new(vs[-1]))
    idx = bld._slot(mat)
    for f in faces:
        f.material_index = idx
        for loop in f.loops:
            co = loop.vert.co
            loop[bld.uv].uv = (co.x + co.z * 0.7, co.y + co.z * 0.3)


def sweep(bld, path, radius, mat, sides=10):
    """A round tube along a polyline."""
    bm = bld.bm
    rings = []
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        a = t.orthogonal().normalized()
        b2 = t.cross(a)
        rings.append([bm.verts.new(p + (a * math.cos(2 * math.pi * k / sides) + b2 * math.sin(2 * math.pi * k / sides))
                                   * radius) for k in range(sides)])
    faces = []
    for ra, rb in zip(rings, rings[1:]):
        for k in range(sides):
            faces.append(bm.faces.new((ra[k], ra[(k + 1) % sides], rb[(k + 1) % sides], rb[k])))
    faces.append(bm.faces.new(list(reversed(rings[0]))))
    faces.append(bm.faces.new(rings[-1]))
    idx = bld._slot(mat)
    for f in faces:
        f.material_index = idx
        for loop in f.loops:
            loop[bld.uv].uv = (loop.vert.co.x + loop.vert.co.z, loop.vert.co.y)


# The table: a 1.9 x 0.95 m rounded oak top on two oval plank legs.
b = Builder()
prism(b, outline_stadium(1.9, 0.95), 0.725, 0.76, M["oak"], (CX, CY), chamfer=0.006)
for dx in (-0.55, 0.55):
    prism(b, outline_stadium(0.5, 0.09, 10), 0.0, 0.725, M["oak"], (CX + dx, CY), angle=math.pi / 2)
    prism(b, outline_stadium(0.56, 0.12, 10), 0.69, 0.725, M["oak"], (CX + dx, CY), angle=math.pi / 2)
b.build("Dining table", sala)

# On it: a linen runner across, a footed bowl of fruit, a stack of books and a mug.
b = Builder()
b.box((CX + 0.05, CY - 0.5, 0.76), (CX + 0.45, CY + 0.5, 0.763), M["linen"])
b.build("Dining table runner", sala)
b = Builder()
bx, by = CX - 0.35, CY + 0.05
b.cylinder((bx, by, 0.775), 0.05, 0.03, "z", M["white"], segments=20)
b.cylinder((bx, by, 0.8), 0.14, 0.04, "z", M["white"], segments=24, radius2=0.1)
for k, (dx, dy) in enumerate(((-0.05, 0.02), (0.04, -0.03), (0.0, 0.06), (0.06, 0.04))):
    b.sphere((bx + dx, by + dy, 0.845), 0.035, M["fruit"][k % 3])
b.build("Dining table fruit bowl", sala)
b = Builder()
for k, (w, d, h) in enumerate(((0.24, 0.17, 0.03), (0.22, 0.16, 0.025), (0.2, 0.14, 0.03))):
    z0 = 0.763 + sum(x[2] for x in ((0.24, 0.17, 0.03), (0.22, 0.16, 0.025), (0.2, 0.14, 0.03))[:k])
    b.box((CX + 0.25 - w / 2, CY - 0.2 - d / 2, z0), (CX + 0.25 + w / 2, CY - 0.2 + d / 2, z0 + h), M["books"][k * 2])
b.cylinder((CX + 0.18, CY + 0.18, 0.808), 0.04, 0.09, "z", M["white"], segments=16)
b.build("Dining table books and mug", sala)


def chair(name, x, y, facing):
    """A wooden chair with a bent horseshoe back rail on spindles and a leather seat; facing = unit (x, y) to the table."""
    fx, fy = facing
    ang = math.atan2(fy, fx)

    def P(lx, ly, z):  # chair local: +lx toward the table, ly to the side
        return Vector((x + lx * fx - ly * fy, y + lx * fy + ly * fx, z))

    b = Builder()
    for lx, ly in ((0.18, 0.2), (0.18, -0.2), (-0.18, 0.2), (-0.18, -0.2)):
        b.cylinder(P(lx, ly, 0.21), 0.017, 0.42, "z", M["oak"], radius2=0.013)
    prism(b, outline_stadium(0.46, 0.46, 6), 0.42, 0.45, M["oak"], (x, y), angle=ang, chamfer=0.004)
    prism(b, outline_stadium(0.42, 0.42, 6), 0.45, 0.475, M["leather"], (x, y), angle=ang, chamfer=0.01)
    rail = []
    for i in range(25):
        a = math.pi / 2 + math.pi * i / 24  # the back half of a circle, ends pointing to the table
        rail.append(P(0.02 + 0.23 * math.cos(a), 0.23 * math.sin(a), 0.74))
    sweep(b, rail, 0.016, M["oak"])
    for k in range(5):
        a = math.pi * (0.62 + 0.76 * k / 4)
        lx, ly = 0.02 + 0.21 * math.cos(a), 0.21 * math.sin(a)
        b.cylinder(P(lx, ly, 0.6075), 0.008, 0.275, "z", M["oak"])
    for ly in (0.23, -0.23):  # arm posts
        b.cylinder(P(0.02, ly, 0.6075), 0.012, 0.275, "z", M["oak"])
    b.build(name, sala)


for i, cx in enumerate((CX - 0.55, CX, CX + 0.55)):
    chair(f"Dining chair N{i}", cx, CY + 0.78, (0, -1))
    chair(f"Dining chair S{i}", cx, CY - 0.78, (0, 1))

# The pendant: two ribbons twisted round each other, black outside and LED inside, on two cables from a ceiling bar.
LAMP = "pendant"
L, R, WAVE, PZ = 1.3, 0.065, 0.55, 1.6
RIB_W, RIB_T = 0.034, 0.008
k_wave = 2 * math.pi / WAVE


def helix_frame(t, phase):
    th = k_wave * t + phase
    radial = Vector((0, math.cos(th), math.sin(th)))
    tangent = Vector((1, -R * k_wave * math.sin(th), R * k_wave * math.cos(th))).normalized()
    across = radial.cross(tangent).normalized()
    return Vector((CX + t, CY, PZ)) + radial * R, radial, across


def ribbon(bld, phase, mat, inset, width, thick):
    bm = bld.bm
    steps = 160
    rings = []
    for i in range(steps + 1):
        t = -L / 2 + L * i / steps
        p, radial, across = helix_frame(t, phase)
        p = p - radial * inset
        rings.append([bm.verts.new(p + across * sa * width / 2 + radial * sr * thick / 2)
                      for sa, sr in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    faces = []
    for ra, rb in zip(rings, rings[1:]):
        for kk in range(4):
            faces.append(bm.faces.new((ra[kk], ra[(kk + 1) % 4], rb[(kk + 1) % 4], rb[kk])))
    faces.append(bm.faces.new(list(reversed(rings[0]))))
    faces.append(bm.faces.new(rings[-1]))
    idx = bld._slot(mat)
    for f in faces:
        f.material_index = idx
        for loop in f.loops:
            loop[bld.uv].uv = (loop.vert.co.x * 2, loop.vert.co.z)


b = Builder()
for ph in (0.0, math.pi):
    ribbon(b, ph, M["black"], 0.0, RIB_W, RIB_T)
pend = b.build("Dining pendant ribbons", sala)
pend["web_lamp"] = LAMP
b = Builder()
for ph in (0.0, math.pi):
    ribbon(b, ph, M["led"], RIB_T / 2 + 0.0008, RIB_W * 0.7, 0.0012)
glow_only(b.build("Dining pendant LED", sala), LAMP)
b = Builder()
ceil = 2.632
b.box((CX - 0.42, CY - 0.035, ceil - 0.03), (CX + 0.42, CY + 0.035, ceil), M["black"])
for dx in (-0.38, 0.38):
    top = PZ + R + RIB_T
    b.cylinder((CX + dx, CY, (top + ceil - 0.03) / 2), 0.0012, ceil - 0.03 - top, "z", M["steel"], segments=6)
    b.cylinder((CX + dx, CY, 2.0), 0.011, 0.07, "z", M["black"], segments=12)
hang = b.build("Dining pendant canopy and cables", sala)
hang["web_lamp"] = LAMP
area_light("Dining pendant light", sala, (CX, CY, PZ - R - 0.012), (0, 0, 0), L - 0.1, 0.05, 70.0, (1.0, 0.8, 0.58), LAMP)
area_light("Dining pendant uplight", sala, (CX, CY, PZ + R + 0.012), (math.pi, 0, 0), L - 0.1, 0.05, 25.0,
           (1.0, 0.8, 0.58), LAMP)

scene[MARK] = VERSION
print("\n".join(f"[fixes] {r}" for r in report))
if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
