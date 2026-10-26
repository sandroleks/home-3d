"""One-off: nine black Nanoleaf Shapes triangles over the office desk (Quarto 02), on the slatted east wall.

An "A" of 23 cm triangles above the monitor: two legs and a peak. Each panel is a black body with a glowing face
(`Nanoleaf panel N`, its own material so the walkthrough can colour each one) in lamp group `nanoleaf`. Two lights
bake what they cast: a soft one into the room and a wash onto the slats around them. The walkthrough animates the
colours (web/src/nanoleaf.ts) and tints that baked light with them.

Reuses the helpers of model_details.py. Run headless on a copy:
    blender -b Untitled.blend --python blender/tools/nanoleaf.py -- --save
Refuses to run twice.
"""
import ast
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

MARK = "nanoleaf"
VERSION = 1

scene = bpy.context.scene
if scene.get(MARK) is not None:
    raise RuntimeError(f"already applied (version {scene[MARK]})")
scene.frame_set(scene.frame_end)


def _load_model_details():
    """The helper functions, classes and tables of model_details.py, without its one-off steps."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model_details.py")
    tree = ast.parse(open(path).read())
    tables = {"Z", "M", "details", "rng", "report"}
    body = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef))
            or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in tables for t in n.targets))]
    ns = {"__name__": "model_details_helpers", "scene": scene}
    exec(compile(ast.Module(body=body, type_ignores=[]), path, "exec"), ns)
    return ns


md = _load_model_details()
Builder, material = md["Builder"], md["material"]

LAMP = "nanoleaf"
SIDE = 0.23  # a Shapes triangle's edge
H = SIDE * math.sqrt(3) / 2
WALL_X = 3.111  # the slats' face
DEPTH = 0.011
CENTRE_Y, BOTTOM_Z = 5.72, 1.6  # centred over the monitor, clear of the webcam and the speakers
# Triangular grid cells (column i, row r): up-pointing when i + r is even. The "A": two legs and a peak, open below it.
CELLS = [(1, 0), (5, 0), (1, 1), (2, 1), (4, 1), (5, 1), (2, 2), (3, 2), (4, 2)]

office = bpy.data.objects["Desk top"].users_collection[0]
body_mat = material("Nanoleaf black", (0.018, 0.018, 0.02), 0.55)
rim = 0.012  # the black border around each lit face
gap = 0.003  # between neighbouring panels


def corners(i, r):
    """The cell's corners in wall coordinates (u to the viewer's right, v up), from the arrangement's left edge."""
    x0 = i * SIDE / 2
    if (i + r) % 2 == 0:
        return [(x0, r * H), (x0 + SIDE, r * H), (x0 + SIDE / 2, (r + 1) * H)]
    return [(x0, (r + 1) * H), (x0 + SIDE / 2, r * H), (x0 + SIDE, (r + 1) * H)]


def inset(tri, d):
    """The triangle shrunk by d on every side (towards its centroid along the angle bisectors)."""
    cu = sum(p[0] for p in tri) / 3
    cv = sum(p[1] for p in tri) / 3
    # inradius of an equilateral triangle with this edge
    edge = math.dist(tri[0], tri[1])
    r_in = edge / (2 * math.sqrt(3))
    k = (r_in - d) / r_in
    return [(cu + (u - cu) * k, cv + (v - cv) * k) for u, v in tri]


def rounded(tri, rad, steps=4):
    """A triangle with rounded corners, as a polygon."""
    out = []
    for k in range(3):
        p = tri[k]
        a, b = tri[k - 1], tri[(k + 1) % 3]
        da = ((a[0] - p[0]), (a[1] - p[1]))
        db = ((b[0] - p[0]), (b[1] - p[1]))
        la, lb = math.hypot(*da), math.hypot(*db)
        t = rad * math.sqrt(3)  # tangent length for a 60 degree corner
        pa = (p[0] + da[0] / la * t, p[1] + da[1] / la * t)
        pb = (p[0] + db[0] / lb * t, p[1] + db[1] / lb * t)
        for s in range(steps + 1):  # quadratic Bezier through the corner, close enough to an arc
            w = s / steps
            out.append(((1 - w) ** 2 * pa[0] + 2 * (1 - w) * w * p[0] + w ** 2 * pb[0],
                        (1 - w) ** 2 * pa[1] + 2 * (1 - w) * w * p[1] + w ** 2 * pb[1]))
    return out


min_u = min(u for c in CELLS for u, _ in corners(*c))
max_u = max(u for c in CELLS for u, _ in corners(*c))
mid_u = (min_u + max_u) / 2


def to_world(u, v, x):
    """Wall coordinates to the world: the viewer faces +x, so their right is -y."""
    return Vector((x, CENTRE_Y - (u - mid_u), BOTTOM_Z + v))


def slab(bld, poly, x_front, x_back, mat):
    bm = bld.bm
    front = [bm.verts.new(to_world(u, v, x_front)) for u, v in poly]
    back = [bm.verts.new(to_world(u, v, x_back)) for u, v in poly]
    faces = [bm.faces.new(front), bm.faces.new(list(reversed(back)))]
    n = len(poly)
    for k in range(n):
        faces.append(bm.faces.new((front[k], back[k], back[(k + 1) % n], front[(k + 1) % n])))
    idx = bld._slot(mat)
    for f in faces:
        f.material_index = idx
        for loop in f.loops:
            co = loop.vert.co
            loop[bld.uv].uv = (co.y * 2, co.z * 2)
    bmesh.ops.recalc_face_normals(bm, faces=faces)


b = Builder()
for i, r in CELLS:
    slab(b, rounded(inset(corners(i, r), gap / 2), 0.012), WALL_X - DEPTH, WALL_X, body_mat)
bodies = b.build("Nanoleaf panels", office)
bodies["web_lamp"] = LAMP

for n, (i, r) in enumerate(CELLS):
    mat = material(f"Nanoleaf panel {n}", (0.02, 0.02, 0.022), 0.4, emission=(1.0, 1.0, 1.0), strength=6.0)
    b = Builder()
    slab(b, rounded(inset(corners(i, r), gap / 2 + rim), 0.008), WALL_X - DEPTH - 0.0012, WALL_X - DEPTH - 0.0002, mat)
    face = b.build(f"Nanoleaf panel {n}", office)
    face.visible_shadow = False  # glows only: exported as part of the lamp, never blocking its light
    face["web_lamp"] = LAMP

height = max(v for c in CELLS for _, v in corners(*c))
centre = to_world(mid_u, height / 2, WALL_X - DEPTH - 0.03)
for name, rot_y, energy, size in (("Nanoleaf light", math.radians(90), 12.0, (height, max_u - min_u)),
                                  ("Nanoleaf wall wash", math.radians(-90), 3.0, (height + 0.2, max_u - min_u + 0.2))):
    data = bpy.data.lights.new(name, "AREA")
    data.shape, data.size, data.size_y, data.energy = "RECTANGLE", size[0], size[1], energy
    light = bpy.data.objects.new(name, data)
    office.objects.link(light)
    light.location = centre if name == "Nanoleaf light" else to_world(mid_u, height / 2, WALL_X - DEPTH - 0.004)
    light.rotation_euler = (0.0, rot_y, 0.0)  # an area light shines down its -Z: into the room, or back at the wall
    light["web_lamp"] = LAMP

print(f"[nanoleaf] 9 panels, {max_u - min_u:.2f} x {height:.2f} m, y {CENTRE_Y}, from z {BOTTOM_Z}")
scene[MARK] = VERSION
if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
