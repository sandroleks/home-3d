"""One-off: the drawer and cupboard contents visitors can pick up become the viewer's (October 2026).

The viewer makes the glasses, mugs, plates, cutlery and the rest itself (web/src/prop-models.ts) and lets visitors pick
them up, put them down and throw them. This removes the baked stand-ins from exactly those places, keeping the drawer
boxes, the cutlery inserts, the shelves and everything else, and writes where each place's insides are, in three.js
space with the drawers shut, to --frames (web/src/prop-frames.json).

Run headless on a staged copy (README, "Working on the model"):
    blender -b source.blend --python blender/tools/loose_contents.py -- --save --frames prop-frames.json
Refuses to run twice.
"""
import json
import os
import re
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from pipeline.geom import slugify, to_three  # noqa: E402

MARK = "loose_contents"
VERSION = 1

scene = bpy.context.scene
if scene.get(MARK) is not None:
    raise RuntimeError(f"already applied (version {scene[MARK]})")
scene.frame_set(scene.frame_end)  # the export uses the finished flat

# (front, fill, where its contents are: "drawer" in the front's own mesh, else the carcass whose contents object holds
# them). A cupboard is named by the door that carries its fill; its other door opens the same hollow.
PLACES = [
    ("Front S3 prep drawers 0", "cutlery", "drawer"),
    ("Island front 00", "cutlery", "drawer"),
    ("Sala storage drawer 00", "cutlery", "drawer"),
    ("East front 1", "cutlery", "drawer"),
    ("Island front 10", "plates", "drawer"),
    ("Sala storage drawer 11", "plates", "drawer"),
    ("East front 4", "plates", "drawer"),
    ("Island front 30", "spices", "drawer"),
    ("Island front 01", "containers", "drawer"),
    ("Island front 31", "containers", "drawer"),
    ("Sala storage drawer 10", "containers", "drawer"),
    ("East front 3", "containers", "drawer"),
    ("Front S1 pull-out", "oils", "drawer"),
    ("Nightstand drawer 0", "nightstand", "drawer"),
    ("Nightstand drawer 1", "nightstand", "drawer"),
    ("Bench drawer front 0", "tools", "drawer"),
    ("Bench drawer front 2", "spools", "drawer"),
    ("Coffee station upper door 0", "glasses", "Coffee station carcass"),
    ("Coffee station lower door 0", "coffee-low", "Coffee station carcass"),
    ("Sala storage left door 0", "glasses", "Sala storage tall left"),
    ("East wall front 0", "glasses", "East wall cabinets"),
    ("East wall front 2", "coffee-low", "East wall cabinets"),
    ("West wall front 0", "glasses", "West wall cabinet 0"),
    ("West wall front 2", "coffee-low", "West wall cabinet 0"),
    ("Bar cabinet door 0", "bar", "Bar cabinet bar block"),
]

# The materials of what goes (model_details.py's fills); everything else in a place stays.
REMOVE = {
    "cutlery": {"Stainless"},
    "plates": {"Stoneware white", "Stoneware blue"},
    "spices": {"Jar glass", "Black steel", "Oak"},
    "containers": {"Glassware", "Stoneware white", "Stoneware blue"},
    "oils": {"Bottle 0", "Bottle 1", "Black steel"},
    "nightstand": {f"Cookbook {i}" for i in range(5)} | {"Black steel"},
    "tools": {"Tool red", "Tool yellow", "Stainless"},
    "spools": {f"Filament {i}" for i in range(6)},
    "glasses": {"Glassware"},
    "coffee-low": {"Stoneware white", "Stoneware blue"},
    "bar": {"Glassware", "Bottle 0", "Bottle 1", "Black steel"},
}
BOX = {"Drawer box birch", "Wire rack"}  # a drawer's or pull-out's own box
SHELVES = {"Cabinet interior", "Wire rack"}
SHELF = 0.018  # a shelf's thickness (fill_shelves)
report = []


def base(name):
    """A material's name without Blender's .001 suffix."""
    return re.sub(r"\.\d{3}$", "", name)


def faces_of(obj):
    """The mesh as bmesh, and each face with its world centre, world normal and material name."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    mw = obj.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    slots = obj.material_slots

    def mat(i):
        return base(slots[i].material.name) if i < len(slots) and slots[i].material else ""

    return bm, [(f, mw @ f.calc_center_median(), (nm @ f.normal).normalized(), mat(f.material_index)) for f in bm.faces]


def bounds(points):
    xs, ys, zs = zip(*points)
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def corners(obj, faces):
    mw = obj.matrix_world
    return [mw @ v.co for f in faces for v in f.verts]


def world_verts(obj):
    return [obj.matrix_world @ v.co for v in obj.data.vertices]


def shelf_tops(obj, faces, lo, hi):
    """Heights of the shelves inside a box: faces of a shelf material facing up, spanning most of it across and deep,
    clear of its floor and top."""
    tops = set()
    for f, c, n, m in faces:
        if m not in SHELVES or n.z < 0.9 or not (lo.z + 0.03 < c.z < hi.z - 0.03):
            continue
        flo, fhi = bounds(corners(obj, [f]))
        if (fhi.x - flo.x) > 0.5 * (hi.x - lo.x) and (fhi.y - flo.y) > 0.5 * (hi.y - lo.y):
            tops.add(round(c.z, 3))
    return sorted(tops)


def levels(lo, hi, tops):
    """The boxes between the floor, the shelves and the top."""
    floors = [lo.z] + tops
    ceilings = [t - SHELF for t in tops] + [hi.z]
    return [(Vector((lo.x, lo.y, f)), Vector((hi.x, hi.y, c))) for f, c in zip(floors, ceilings)]


def box3(lo, hi):
    a, b = to_three(lo), to_three(hi)
    return {"min": [round(min(a[i], b[i]), 4) for i in range(3)], "max": [round(max(a[i], b[i]), 4) for i in range(3)]}


def direction3(v):
    return [round(float(x), 4) + 0.0 for x in to_three(v)]


def delete(obj, bm, gone):
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    bm.to_mesh(obj.data)
    obj.data.update()
    bm.free()


def drawer(front, fill):
    obj = scene.objects[front]
    bm, faces = faces_of(obj)
    box = [f for f, c, n, m in faces if m in BOX]
    if not box:
        raise RuntimeError(f"{front}: no drawer box")
    lo, hi = bounds(corners(obj, box))
    side = 0.012 if any(m == "Drawer box birch" for *_, m in faces) else 0.005
    lo, hi = Vector((lo.x + side, lo.y + side, lo.z + 0.012)), Vector((hi.x - side, hi.y - side, hi.z))
    inside = lambda c: all(lo[i] - 0.002 <= c[i] <= hi[i] + 0.002 for i in range(3))  # noqa: E731
    gone = [f for f, c, n, m in faces if m in REMOVE[fill] and inside(c)]
    tops = shelf_tops(obj, faces, lo, hi)
    delete(obj, bm, gone)
    node = f"Move_{slugify(front)}"
    report.append(f"{front}: {len(gone)} faces of {fill} gone, {len(tops) + 1} level(s)")
    return {"source": front, "fill": fill, "node": node, "front": node, "out": direction3(Vector(obj["web_dir"])),
            "levels": [box3(a, b) for a, b in levels(lo, hi, tops)]}


def cupboard(front, fill, carcass):
    door = scene.objects[front]
    dlo, dhi = bounds(world_verts(door))
    dc = (dlo + dhi) / 2
    k = 0 if (dhi - dlo).x < (dhi - dlo).y else 1  # the door is thin along its outward axis
    candidates = [o for o in scene.objects if o.type == "MESH" and re.fullmatch(re.escape(f"{carcass} contents") + r"(\.\d{3})?", o.name)]
    if not candidates:
        raise RuntimeError(f"{front}: no {carcass} contents")

    def miss(o):  # the contents behind this door: nearest across its face and in height
        lo, hi = bounds(world_verts(o))
        c = (lo + hi) / 2
        return abs(c[1 - k] - dc[1 - k]) + abs(c.z - dc.z)

    obj = min(candidates, key=miss)
    bm, faces = faces_of(obj)
    shelves = [f for f, c, n, m in faces if m in SHELVES]
    if not shelves:
        raise RuntimeError(f"{obj.name}: no shelves")
    slo, shi = bounds(corners(obj, shelves))
    olo, ohi = bounds(world_verts(obj))
    oc = (olo + ohi) / 2
    col = bpy.data.collections.get(f"Cutters - {carcass}")
    cutters = [c for c in (col.objects if col else []) if c.type == "MESH"]
    hollow = None
    for c in cutters:
        clo, chi = bounds(world_verts(c))
        if all(clo[i] <= oc[i] <= chi[i] for i in range(3)):
            hollow = (clo, chi)
    if hollow is None:
        raise RuntimeError(f"{obj.name}: no hollow around it")
    lo, hi = Vector((slo.x, slo.y, hollow[0].z)), Vector((shi.x, shi.y, hollow[1].z))
    tops = shelf_tops(obj, faces, lo, hi)
    gone = [f for f, c, n, m in faces if m in REMOVE[fill]]
    delete(obj, bm, gone)
    out = Vector((0.0, 0.0, 0.0))
    out[k] = 1.0 if dc[k] > oc[k] else -1.0
    report.append(f"{front}: {len(gone)} faces of {fill} gone from {obj.name}, {len(tops) + 1} level(s)")
    return {"source": front, "fill": fill, "node": None, "front": f"Move_{slugify(front)}", "out": direction3(out),
            "levels": [box3(a, b) for a, b in levels(lo, hi, tops)]}


places = [drawer(f, fill) if where == "drawer" else cupboard(f, fill, where) for f, fill, where in PLACES]
scene[MARK] = VERSION
print("\n".join(f"[loose] {r}" for r in report))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--frames" in argv:
    with open(argv[argv.index("--frames") + 1], "w") as fh:
        json.dump({"places": places}, fh, indent=1)
if "--save" in argv:
    bpy.ops.wm.save_mainfile()
