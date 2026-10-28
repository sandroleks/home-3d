"""One-off: the model's small things on surfaces become loose things in the walkthrough (October 2026).

Tags each with `web_prop` (what the walkthrough's prompt calls it), joins things modelled in parts into one object, and
splits the dining table's books and mug apart. The export then keeps tagged meshes out of the baked rooms and exports
each as its own node (blender/pipeline/props.py). From then on, `web_prop` on any mesh by hand makes it loose.

Run headless on a staged copy:
    blender -b source.blend --python blender/tools/surface_props.py -- --save
Refuses to run twice.
"""
import sys

import bmesh
import bpy

MARK = "surface_props"
VERSION = 1
PROP = "web_prop"

scene = bpy.context.scene
if scene.get(MARK) is not None:
    raise RuntimeError(f"already applied (version {scene[MARK]})")
scene.frame_set(scene.frame_end)  # the export uses the finished flat
report = []


def r(prefix, a, b):
    return [f"{prefix}{i}" for i in range(a, b + 1)]


TAGS = {
    "mug": ["Coffee station mug 0", "Coffee station mug 1", "Bistro mug"],
    "bottle": ["Counter deco bottle 0", "Counter deco bottle 1", "Closed counter deco bottle 0",
               "Closed counter deco bottle 1", *r("Bottle ", 0, 3)],
    "kettle": ["Counter deco kettle", "East worktop kettle"],
    "knife": [*r("Counter deco knife ", 0, 4), *r("Closed counter deco knife ", 0, 4)],
    "chopping board": ["Island deco board", "East worktop board"],
    "fruit bowl": ["Island deco fruit bowl", "East worktop fruit bowl", "Dining table fruit bowl"],
    "fruit": [*r("Island deco fruit ", 0, 4), *r("East worktop fruit ", 0, 4)],
    "vase": ["Island deco vase", "Office shelf bud vase"],
    "bowl": ["Shelf item bowl 0", "Shelf item bowl 1", "Office shelf bowl"],
    "cookbook": r("Shelf item cookbook ", 0, 4),
    "plate": [*r("Shelf item plate 0", 0, 5), *r("Shelf item plate 1", 0, 5)],
    "book": ["Coffee table round book", *r("Office shelf book ", 0, 8), *r("Office shelf stack book ", 0, 2)],
    "cushion": [*r("Corner sofa pillow ", 0, 2), "Entrada bench cushion", "Cushion 0", "Cushion 1",
                *r("Sofa bed pillow ", 0, 2)],
    "keyboard": ["Sala Magic Keyboard"],
    "mouse": ["Sala Magic Mouse", "Mouse"],
    "ice bucket": ["Ice bucket"],
    "tray": ["Bar tray"],
    "key bowl": ["Hall key bowl"],
    "SSD": ["Portable SSD"],
    "charger": ["Charger hub"],
    "dock": ["Dock"],
    "jar": ["Desk jar"],
    "audio interface": ["Audio interface"],
    "tool tray": ["Tool tray"],
    "tool": r("Hung tool ", 0, 7),
}
# (the object the parts join into, its parts, its web_prop)
JOINS = [
    ("Keyboard", ["Keyboard key enter", "Keyboard keys", "Keyboard keys mod column", "Keyboard keys mod row"], "keyboard"),
    ("Smartwatch", ["Smartwatch strap"], "smartwatch"),
    ("Phone stand", r("Phone stand slot ", 0, 2), "phone stand"),
    ("Smart speaker puck", ["Smart speaker puck top"], "smart speaker"),
    ("Deer body", ["Deer face", "Deer antler 0", "Deer antler 0 tine 0", "Deer antler 0 tine 1", "Deer antler 1",
                   "Deer antler 1 tine 0", "Deer antler 1 tine 1"], "wooden deer"),
    ("Office shelf vase", r("Office shelf vase stem ", 0, 2), "vase"),
    ("Organiser tray", r("Organiser tray bin ", 0, 2), "organiser tray"),
    *[(f"Spool {i}", [f"Spool hub {i}"], "filament spool") for i in range(6)],
    ("Counter deco utensil crock", r("Counter deco utensil ", 0, 3), "utensil crock"),
    ("Closed counter deco utensil crock", r("Closed counter deco utensil ", 0, 3), "utensil crock"),
]
# (the object, {material name: (new object name, web_prop)})
SPLITS = [
    ("Dining table books and mug", {
        "Book 0": ("Dining table book 0", "book"), "Book 2": ("Dining table book 1", "book"),
        "Book 4": ("Dining table book 2", "book"), "Stoneware white": ("Dining table mug", "mug"),
    }),
]


def obj(name):
    o = bpy.data.objects.get(name)
    if o is None or o.type != "MESH":
        raise RuntimeError(f"no mesh named {name!r}")
    return o


def join(target, parts):
    """Join the parts into the target, keeping the target's name, transform and collections."""
    objs = [obj(target)] + [obj(p) for p in parts]
    for o in objs:  # a part parented to another would move with it as the join applies transforms
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    with bpy.context.temp_override(active_object=objs[0], object=objs[0], selected_objects=objs,
                                   selected_editable_objects=objs):
        bpy.ops.object.join()
    return objs[0]


def split(name, by_material):
    """One new object per listed material, with only that material's faces; the original goes."""
    src = obj(name)
    made = []
    for i, slot in enumerate(src.material_slots):
        mat = slot.material
        if mat is None or mat.name.split(".")[0] not in by_material:
            continue
        new_name, prop = by_material[mat.name.split(".")[0]]
        bm = bmesh.new()
        bm.from_mesh(src.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != i], context="FACES")
        me = bpy.data.meshes.new(new_name)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(new_name, me)
        o.data.materials.clear()
        for s in src.material_slots:
            o.data.materials.append(s.material)
        o.matrix_world = src.matrix_world.copy()
        for c in src.users_collection:
            c.objects.link(o)
        o[PROP] = prop
        made.append(new_name)
    if len(made) != len(by_material):
        raise RuntimeError(f"{name}: split {len(made)} of {len(by_material)} parts")
    bpy.data.objects.remove(src, do_unlink=True)
    return made


for target, parts, prop in JOINS:
    o = join(target, parts)
    o[PROP] = prop
    report.append(f"joined {len(parts)} into {target}: {prop}")
for name, by_material in SPLITS:
    report.append(f"split {name} into {', '.join(split(name, by_material))}")
for prop, names in TAGS.items():
    for n in names:
        obj(n)[PROP] = prop
    report.append(f"{prop}: {len(names)}")

scene[MARK] = VERSION
print("\n".join(f"[surface] {line}" for line in report))
print(f"[surface] {sum(1 for o in bpy.data.objects if o.get(PROP))} loose things")
if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
