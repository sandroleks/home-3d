"""One-off: better lamp models throughout the flat (October 2026). The lights themselves stay where they are.

- Ceiling fixtures: a slim flush mount, an opal glass dome under a thin trim ring (brass in the living rooms and
  bedrooms, white in the wet rooms and utility spaces). Their bottom stays above the room's ceiling light.
- Sala floor lamp: an oak tripod with a brass stem and a linen drum shade.
- Quarto 02 floor lamp: an opal glass globe on a black stem.
- Bedside lamps: a ribbed ceramic gourd, a brass neck and a tapered linen shade.
- Hall wall lights: opal globes on brass arms.
- Island pendants (open kitchen): black metal domes with a brass rim, on brass canopies.

Opal globes with their lamp inside cast no shadow and only glow, so the pipeline exports them as glowing parts of their
lamp (see lamps.glow_only). Reuses the helpers of model_details.py. Run headless on a copy:
    blender -b Untitled.blend --python blender/tools/lamp_models.py -- --save
Refuses to run twice.
"""
import ast
import math
import os
import sys

import bpy
from mathutils import Vector

MARK = "lamp_models"
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
Builder, M, bbox, existing = md["Builder"], md["M"], md["bbox"], md["existing"]
report = md["report"]
M.update({
    "brass": existing("Brass", rgb=(0.8, 0.6, 0.3), metallic=1.0, roughness=0.3),
    "white metal": existing("Fixture white metal", rgb=(0.85, 0.85, 0.84)),
    "opal": existing("Opal diffuser", rgb=(0.93, 0.92, 0.9)),
    "linen": existing("Linen shade", rgb=(0.95, 0.9, 0.8)),
    "ceramic": existing("Ceramic", rgb=(0.8, 0.76, 0.7)),
})
CEILING = 2.632


def lathe(bld, centre, profile, mat, segments=36, closed=False):
    """Revolve (radius, z) points around a vertical axis through centre (x, y); r = 0 makes a single pole vertex."""
    bm = bld.bm
    cx, cy = centre
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((cx, cy, z))])
        else:
            rings.append([bm.verts.new((cx + r * math.cos(2 * math.pi * k / segments),
                                        cy + r * math.sin(2 * math.pi * k / segments), z)) for k in range(segments)])
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    faces = []
    for a, b in pairs:
        for k in range(segments):
            k1 = (k + 1) % segments
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                faces.append(bm.faces.new((a[0], b[k], b[k1])))
            elif len(b) == 1:
                faces.append(bm.faces.new((a[k], b[0], a[k1])))
            else:
                faces.append(bm.faces.new((a[k], b[k], b[k1], a[k1])))
    idx = bld._slot(mat)
    for f in faces:
        f.material_index = idx
        for loop in f.loops:
            co = loop.vert.co
            loop[bld.uv].uv = (math.atan2(co.y - cy, co.x - cx) / (2 * math.pi), co.z)


def shell(outer, thickness):
    """A closed profile for a thin shell: down the outside, back up the inside."""
    inner = [(max(r - thickness, 0.0), z) for r, z in reversed(outer)]
    return outer + inner


def make(bld, name, collection, lamp=None, glow=False):
    obj = bld.build(name, collection)
    if lamp:
        obj["web_lamp"] = lamp
    if glow:
        obj.visible_shadow = False
    return obj


def replace(names):
    """Remove the old parts; return the collection of the first, for the new ones."""
    col = bpy.data.objects[names[0]].users_collection[0]
    for n in names:
        o = bpy.data.objects.get(n)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)
    return col


# ---------------------------------------------------------------------------------------------------- ceiling

WHITE_TRIM = {"WC 01", "WC 02", "Closet", "Lavandaria", "Marquise"}
for base in [o for o in bpy.data.objects if o.name.startswith("Ceiling fixture ") and o.name.endswith(" base")]:
    room = base.name[len("Ceiling fixture "):-len(" base")]
    lo, hi = bbox(base)
    c = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
    R = (hi[0] - lo[0]) / 2
    col = replace([base.name, f"Ceiling fixture {room} diffuser"])
    trim = M["white metal"] if room in WHITE_TRIM else M["brass"]
    b = Builder()
    lathe(b, c, [(0.0, CEILING), (R * 0.82, CEILING), (R * 0.84, CEILING - 0.006), (R * 0.84, CEILING - 0.02),
                 (R * 0.8, CEILING - 0.024), (0.0, CEILING - 0.024)], M["white metal"])  # canopy
    lathe(b, c, shell([(R * 0.98, CEILING - 0.026), (R * 1.0, CEILING - 0.03), (R * 0.98, CEILING - 0.034)], 0.012),
          trim, closed=True)  # trim ring
    make(b, f"Ceiling fixture {room} base", col)
    b = Builder()
    dome = [(R * 0.97, CEILING - 0.03)] + [(R * 0.97 * math.cos(a), CEILING - 0.03 - 0.03 * math.sin(a))
                                           for a in (math.radians(d) for d in (25, 50, 70, 85))] + [(0.0, CEILING - 0.06)]
    lathe(b, c, [(0.0, CEILING - 0.03)] + dome, M["opal"])
    make(b, f"Ceiling fixture {room} diffuser", col)
report.append("ceiling fixtures: opal domes under trim rings")


# ---------------------------------------------------------------------------------------------------- Sala floor lamp

col = replace(["Sala floor lamp base", "Sala floor lamp pole", "Sala floor lamp shade"])
cx, cy = 0.4, -4.7
b = Builder()
apex = Vector((cx, cy, 1.05))
for k in range(3):
    a = math.radians(90 + 120 * k)
    foot = Vector((cx + 0.26 * math.cos(a), cy + 0.26 * math.sin(a), 0.0))
    d = apex - foot
    b.cylinder((foot + apex) / 2, 0.016, d.length, d.normalized(), M["oak"], segments=12, radius2=0.012)
b.sphere(apex, 0.025, M["brass"])
b.cylinder((cx, cy, 1.26), 0.009, 0.42, "z", M["brass"], segments=12)
b.cylinder((cx, cy, 1.47), 0.018, 0.04, "z", M["brass"], segments=16)
make(b, "Sala floor lamp stand", col, "floor-lamp")
b = Builder()
lathe(b, (cx, cy), shell([(0.21, 1.76), (0.23, 1.44)], 0.004), M["linen"], segments=48, closed=True)
make(b, "Sala floor lamp shade", col, "floor-lamp")


# ---------------------------------------------------------------------------------------------------- Quarto 02 floor lamp

col = replace(["Floor lamp base", "Floor lamp pole", "Floor lamp shade", "Bulb Floor lamp light"])
cx, cy = 0.22, 7.05
light = bpy.data.objects["Floor lamp light"]
gz = light.matrix_world.translation.z
b = Builder()
lathe(b, (cx, cy), [(0.0, 0.0), (0.13, 0.0), (0.13, 0.012), (0.11, 0.024), (0.0, 0.026)], M["black"])
b.cylinder((cx, cy, (0.026 + gz - 0.15) / 2), 0.01, gz - 0.15 - 0.026, "z", M["black"], segments=12)
b.cylinder((cx, cy, gz - 0.15), 0.03, 0.03, "z", M["brass"], segments=20)
make(b, "Floor lamp stand", col, "floor-lamp")
b = Builder()
b.sphere((cx, cy, gz), 0.15, M["opal"])
make(b, "Floor lamp globe", col, "floor-lamp", glow=True)


# ---------------------------------------------------------------------------------------------------- bedside

for i in range(2):
    lamp = bpy.data.objects[f"Bedside lamp shade {i}"].get("web_lamp")
    lo, _ = bbox(bpy.data.objects[f"Bedside lamp base {i}"])
    col = replace([f"Bedside lamp base {i}", f"Bedside lamp shade {i}"])
    cx, cy = -2.77, (5.63, 8.07)[i]
    z0 = lo[2]
    prof = []
    for k in range(25):  # a gourd with soft ribs
        t = k / 24
        r = 0.035 + 0.055 * math.sin(math.pi * min(t * 1.25, 1.0)) ** 0.8
        prof.append((r, z0 + 0.22 * t))
    b = Builder()
    lathe(b, (cx, cy), [(0.0, z0)] + prof + [(0.0, z0 + 0.22)], M["ceramic"], segments=40)
    bm = b.bm
    for v in bm.verts:  # ribs: push out the surface in 16 lobes
        dx, dy = v.co.x - cx, v.co.y - cy
        r = math.hypot(dx, dy)
        if r > 0.02:
            s = 1 + 0.045 * math.cos(16 * math.atan2(dy, dx))
            v.co.x, v.co.y = cx + dx * s, cy + dy * s
    b.cylinder((cx, cy, z0 + 0.245), 0.012, 0.05, "z", M["brass"], segments=16)
    make(b, f"Bedside lamp base {i}", col, lamp)
    b = Builder()
    lathe(b, (cx, cy), shell([(0.105, z0 + 0.5), (0.155, z0 + 0.3)], 0.003), M["linen"], segments=48, closed=True)
    make(b, f"Bedside lamp shade {i}", col, lamp)


# ---------------------------------------------------------------------------------------------------- hall wall lights

for i in range(2):
    lamp = bpy.data.objects[f"Hall wall light {i}"].get("web_lamp")
    col = replace([f"Hall wall light {i}"])
    p = bpy.data.objects[f"Hall wall light lamp {i}"].matrix_world.translation
    wall_x = -1.095
    b = Builder()
    b.cylinder((wall_x + 0.006, p.y, p.z - 0.04), 0.055, 0.012, "x", M["brass"], segments=32)
    b.cylinder(((wall_x + p.x) / 2, p.y, p.z - 0.04), 0.008, p.x - wall_x, "x", M["brass"], segments=12)
    b.cylinder((p.x, p.y, p.z - 0.055), 0.022, 0.03, "z", M["brass"], segments=20)
    make(b, f"Hall wall light {i} arm", col, lamp)
    b = Builder()
    b.sphere((p.x, p.y, p.z + 0.02), 0.075, M["opal"])
    make(b, f"Hall wall light {i}", col, lamp, glow=True)


# ---------------------------------------------------------------------------------------------------- island pendants

for i in range(2):
    lamp = bpy.data.objects[f"Island pendant {i}"].get("web_lamp")
    col = replace([f"Island pendant {i}", f"Island pendant cord {i}"])
    p = bpy.data.objects[f"Island pendant light {i}"].matrix_world.translation
    cx, cy = p.x, p.y
    b = Builder()
    outer = [(0.012, 1.86)] + [(0.012 + 0.138 * math.sin(math.radians(d)), 1.86 - 0.22 * (1 - math.cos(math.radians(d))))
                               for d in (15, 35, 55, 75, 90)]
    lathe(b, (cx, cy), shell(outer, 0.003), M["black"], segments=48, closed=True)
    lathe(b, (cx, cy), shell([(0.152, 1.645), (0.152, 1.635)], 0.006), M["brass"], segments=48, closed=True)
    b.cylinder((cx, cy, (1.86 + CEILING) / 2), 0.003, CEILING - 1.86, "z", M["black"], segments=8)
    b.cylinder((cx, cy, CEILING - 0.012), 0.05, 0.024, "z", M["brass"], segments=24)
    b.cylinder((cx, cy, 1.87), 0.02, 0.03, "z", M["brass"], segments=16)
    make(b, f"Island pendant {i}", col, lamp)

scene[MARK] = VERSION
print("\n".join(f"[lamps] {r}" for r in report))
if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
