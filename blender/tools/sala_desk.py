"""One-off: a desk for Oksana in the Sala's window corner, and the corner sofa made straight to make room for it.

- The corner sofa loses the section along the window (base, plinth, back frame, seats with the corner one, back
  cushions and its arm). The long part stays against the kitchen side and gets a south arm like its north one, so it is
  a straight sofa from y -4.90 to -7.70. The cushions that sat on the return move to the long part.
- In the corner it frees, against the short wall left of the window (collection `Sala - desk by the window`): a light
  oak desk on black steel legs, a blue iMac 24" whose screen is a `web_screen = "monitor"` (it switches on like the
  office's), a Magic Keyboard and Magic Mouse, a copy of the Quarto 02 office chair facing the desk, and a socket.

Design note: docs/superpowers/specs/2026-10-27-sala-desk-design.md. Run headless on a copy:
    blender -b Untitled.blend --python blender/tools/sala_desk.py -- --save
Refuses to run twice.
"""
import ast
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

MARK = "sala_desk"
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
Builder, bbox, collection, material, existing = md["Builder"], md["bbox"], md["collection"], md["material"], md["existing"]

oak = existing("Desk oak light", rgb=(0.7, 0.55, 0.38))
steel = existing("Black steel", rgb=(0.03, 0.03, 0.03), metallic=1.0, roughness=0.4)
display = existing("Monitor display on", rgb=(0.02, 0.02, 0.025), roughness=0.1)
imac_blue = material("iMac blue", (0.32, 0.5, 0.72), 0.35, metallic=0.6)
imac_chin = material("iMac blue light", (0.62, 0.76, 0.9), 0.4, metallic=0.4)
bezel = material("iMac bezel white", (0.92, 0.92, 0.9), 0.3)
aluminium = material("Aluminium silver", (0.8, 0.8, 0.8), 0.3, metallic=1.0)
white = material("Apple accessory white", (0.94, 0.94, 0.93), 0.35)


def own_mesh(obj):
    if obj.data.users > 1:
        obj.data = obj.data.copy()


def transform_world(obj, m):
    """Apply a world-space transform to the mesh itself, so the build-up animation can't undo it."""
    own_mesh(obj)
    mw = obj.matrix_world
    obj.data.transform(mw.inverted() @ m @ mw)


def stretch_y(name, lo0, hi0, lo1, hi1):
    """Map world y lo0..hi0 to lo1..hi1 (a box made longer or shorter)."""
    s = (hi1 - lo1) / (hi0 - lo0)
    m = Matrix.Translation((0, lo1, 0)) @ Matrix.Diagonal((1, s, 1, 1)) @ Matrix.Translation((0, -lo0, 0))
    transform_world(bpy.data.objects[name], m)


def turned(centre, target, angle):
    """Turn about the vertical through `centre`, then move `centre` to `target`."""
    return Matrix.Translation(Vector(target)) @ Matrix.Rotation(angle, 4, "Z") @ Matrix.Translation(-Vector(centre))


def copy_object(src_name, new_name, col, world=Matrix()):
    """A standalone copy (own mesh, no animation, no parent) placed at `world` @ the source's final pose."""
    src = bpy.data.objects[src_name]
    mw = src.matrix_world.copy()
    obj = src.copy()
    obj.data = src.data.copy()
    obj.animation_data_clear()
    obj.parent = None
    obj.name = new_name
    col.objects.link(obj)
    obj.matrix_world = world @ mw
    return obj


def bevelled(obj, like):
    """The bevel of `like` (an object of the office desk), so new edges catch the light the same way."""
    src = next(m for m in bpy.data.objects[like].modifiers if m.type == "BEVEL")
    mod = obj.modifiers.new("Bevel", "BEVEL")
    for prop in ("width", "segments", "limit_method", "angle_limit"):
        setattr(mod, prop, getattr(src, prop))
    return obj


def hexahedron(bld, corners, mat):
    """Eight corners, bottom four then top four, each counter-clockwise seen from above."""
    bm = bld.bm
    v = [bm.verts.new(c) for c in corners]
    faces = [bm.faces.new((v[3], v[2], v[1], v[0])), bm.faces.new((v[4], v[5], v[6], v[7]))]
    for k in range(4):
        faces.append(bm.faces.new((v[k], v[(k + 1) % 4], v[4 + (k + 1) % 4], v[4 + k])))
    idx = bld._slot(mat)
    for f in faces:
        f.material_index = idx
        for loop in f.loops:
            loop[bld.uv].uv = (loop.vert.co.y * 2, loop.vert.co.z * 2)
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def wall_face(origin, direction):
    """Where a ray from inside the room first meets something; prints what it hit, so a stray object shows."""
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, _n, _i, obj, _m = scene.ray_cast(dg, Vector(origin), Vector(direction))
    if not hit:
        raise RuntimeError(f"no wall from {origin} towards {direction}")
    print(f"[sala_desk] wall towards {tuple(direction)}: {obj.name} at {tuple(round(c, 4) for c in loc)}")
    return loc


# ---------------------------------------------------------------------------------------------------- the sofa

for n in ("Corner sofa plinth return", "Corner sofa base return", "Corner sofa back frame (window",
          "Corner sofa arm east", "Corner sofa seat corner", "Corner sofa seat return",
          "Corner sofa back cushion W0", "Corner sofa back cushion S0", "Corner sofa back cushion S1"):
    bpy.data.objects.remove(next(o for o in bpy.data.objects if o.name.startswith(n)), do_unlink=True)

SOFA_END = -7.70  # the new south arm's outer face: 20 cm past the seats, as the north arm is
arm_north = bpy.data.objects["Corner sofa arm north"]
sofa_col = arm_north.users_collection[0]
lo, hi = bbox(arm_north)
copy_object(arm_north.name, "Corner sofa arm south", sofa_col, Matrix.Translation((0, SOFA_END - lo[1], 0)))
for n, end in (("Corner sofa base long", SOFA_END), ("Corner sofa back frame (kitchen", SOFA_END),
               ("Corner sofa plinth long", SOFA_END + 0.03)):
    obj = next(o for o in sofa_col.objects if o.name.startswith(n))
    lo, hi = bbox(obj)
    stretch_y(obj.name, lo[1], hi[1], end, hi[1])

# The cushions of the return: the terracotta one into the new south corner, the sage one turned to lean on the back.
pillow = bpy.data.objects["Corner sofa pillow 0"]
lo, hi = bbox(pillow)
transform_world(pillow, Matrix.Translation((0, SOFA_END + 0.23 - lo[1], 0)))
pillow = bpy.data.objects["Corner sofa pillow 1"]
lo, hi = bbox(pillow)
transform_world(pillow, turned((lo + hi) / 2, (0.46, SOFA_END + 0.88, (lo[2] + hi[2]) / 2), math.pi / 2))

# ---------------------------------------------------------------------------------------------------- the desk

W = wall_face((0.6, -8.3, 1.2), (-1, 0, 0)).x  # the short wall left of the window (the Marquise is behind it)
S = wall_face((0.4, -8.0, 1.2), (0, -1, 0)).y  # the window wall, east of which the window is
desk_col = collection("Sala - desk by the window", parent=bpy.data.collections["Furniture - Sala"])

TOP_Z, TOP_T = 0.75, 0.025
X0, X1 = W + 0.005, W + 0.605  # 60 cm deep
Y0, Y1 = S + 0.01, S + 0.96  # 95 cm wide, 7 cm short of the sofa's new arm
YC = (Y0 + Y1) / 2

b = Builder()
b.box((X0, Y0, TOP_Z - TOP_T), (X1, Y1, TOP_Z), oak)
top = bevelled(b.build("Sala desk top", desk_col), "Desk top")
top["grain_stretch"] = bpy.data.objects["Desk top"]["grain_stretch"]  # the office desk's grain also runs along y

b = Builder()
LEG, INSET = 0.03, 0.03
for x in (X0 + INSET, X1 - INSET - LEG):
    for y in (Y0 + INSET, Y1 - INSET - LEG):
        b.box((x, y, 0.0), (x + LEG, y + LEG, TOP_Z - TOP_T), steel)
for y in (Y0 + INSET, Y1 - INSET - LEG):  # side rails under the top
    b.box((X0 + INSET, y, TOP_Z - TOP_T - 0.03), (X1 - INSET, y + LEG, TOP_Z - TOP_T), steel)
b.box((X0 + INSET, Y0 + INSET, TOP_Z - TOP_T - 0.03), (X0 + INSET + LEG, Y1 - INSET, TOP_Z - TOP_T), steel)
bevelled(b.build("Sala desk frame", desk_col), "Desk leg 0")

# iMac 24": 54.7 x 46.1 cm, display 11.5 mm thick, stand 14.7 cm deep. Oksana faces -x, so its screen faces +x.
PANEL_BACK, PANEL_FRONT = W + 0.125, W + 0.1365
PANEL_Z0, PANEL_Z1 = TOP_Z + 0.066, TOP_Z + 0.461
CHIN_Z = PANEL_Z0 + 0.07
HALF = 0.547 / 2
b = Builder()
b.box((PANEL_BACK, YC - HALF, PANEL_Z0), (PANEL_FRONT - 0.0015, YC + HALF, PANEL_Z1), imac_blue)
b.box((PANEL_FRONT - 0.0015, YC - HALF, PANEL_Z0), (PANEL_FRONT, YC + HALF, CHIN_Z), imac_chin)
b.box((PANEL_FRONT - 0.0015, YC - HALF, CHIN_Z), (PANEL_FRONT, YC + HALF, PANEL_Z1), bezel)
b.box((W + 0.06, YC - 0.065, TOP_Z), (W + 0.207, YC + 0.065, TOP_Z + 0.006), imac_blue)  # the stand's foot
foot_x, hinge_x, hinge_z, t = W + 0.07, PANEL_BACK, TOP_Z + 0.21, 0.012  # its arm leans forward to the display
hexahedron(b, [(foot_x, YC - 0.065, TOP_Z + 0.006), (foot_x + t, YC - 0.065, TOP_Z + 0.006),
               (foot_x + t, YC + 0.065, TOP_Z + 0.006), (foot_x, YC + 0.065, TOP_Z + 0.006),
               (hinge_x - t, YC - 0.065, hinge_z), (hinge_x, YC - 0.065, hinge_z),
               (hinge_x, YC + 0.065, hinge_z), (hinge_x - t, YC + 0.065, hinge_z)], imac_blue)
bevelled(b.build("Sala iMac", desk_col), "Monitor")

b = Builder()
b.box((PANEL_FRONT, YC - 0.261, PANEL_Z1 - 0.013 - 0.294), (PANEL_FRONT + 0.001, YC + 0.261, PANEL_Z1 - 0.013), display)
b.build("Sala iMac screen", desk_col)["web_screen"] = "monitor"

KB_X = W + 0.30  # Magic Keyboard, 27.9 x 11.5 cm, in front of the iMac: one block, its keys a white top
b = Builder()
b.box((KB_X, YC - 0.1395, TOP_Z), (KB_X + 0.115, YC + 0.1395, TOP_Z + 0.008), aluminium)
b._slot(white)
keyboard = b.build("Sala Magic Keyboard", desk_col)
for p in keyboard.data.polygons:  # a thin key slab stacked on a base bakes black in the lightmap
    if p.normal.z > 0.5:
        p.material_index = keyboard.data.materials.find(white.name)
bevelled(keyboard, "Keyboard")

b = Builder()  # Magic Mouse, 11.3 x 5.7 x 2.2 cm, on her right (+y, as she faces -x)
b.sphere((KB_X + 0.06, YC + 0.25, TOP_Z + 0.002), 1.0, white, scale=(0.0565, 0.0285, 0.02))
mouse = b.build("Sala Magic Mouse", desk_col)
for v in mouse.data.vertices:  # its underside flat on the desk
    v.co.z = max(v.co.z, TOP_Z)

# The Quarto 02 office chair, turned to face the desk, its seat's front edge 6 cm from the desk.
office = bpy.data.objects["Desk top"].users_collection[0]
column_lo, column_hi = bbox(bpy.data.objects["Chair column"])
centre = Vector((column_lo + column_hi) / 2)
b = Builder()
for src in [o for o in office.objects if o.name.startswith("Chair ")]:
    b.absorb(copy_object(src.name, f"Sala desk {src.name}", desk_col,
                         turned((centre.x, centre.y, 0), (X1 + 0.31, YC, 0), math.pi)))
b.build("Sala desk chair", desk_col)

socket = bpy.data.objects["Socket Sala 0"]  # under the desk, on its wall
lo, hi = bbox(socket)
copy_object(socket.name, "Socket Sala desk", socket.users_collection[0],
            turned((lo + hi) / 2, (W + (hi[0] - lo[0]) / 2, Y1 - 0.25, (lo[2] + hi[2]) / 2), math.pi))

print(f"[sala_desk] wall x {W:.3f}, window wall y {S:.3f}; desk x {X0:.3f}..{X1:.3f}, y {Y0:.3f}..{Y1:.3f}; "
      f"sofa now y {SOFA_END:.2f}..-4.90")
scene[MARK] = VERSION
if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
