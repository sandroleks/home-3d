"""One-off: the glazed doors slide, as the real ones do, and the turntable's platter spins.

- Each glazed door (4: Quarto 02 to the balcony, 24: kitchen to laundry, 26: laundry to the Marquise) was two French
  door leaves (model_details.py). It becomes a fixed panel on the frame line (`Glazed Door N (A / B) fixed panel`,
  static, with the `… glass`) and one sliding leaf (`Door leaf Nb`, with the `… glass.001` tagged `web_leaf`) just in
  front of it on the second room's side, tagged `web_move = "slide"` like a drawer: it slides over the fixed panel.
  Flush pulls replace the levers, which would catch on the other panel.
- The turntable's platter and record become one object, `Turntable platter`, tagged `web_move = "spin"` with its
  pivot, axis and speed: it plays the music.

Run once in the Blender session that has the .blend open, then save; or headless:
    blender -b Untitled.blend --python blender/tools/sliding_doors.py -- --save
Needs model_details.py applied first. Refuses to run twice.
"""
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

MARK = "sliding_doors"
VERSION = 1
GAP = 0.003  # between a leaf and the jamb or the other leaf, as model_details.py
DEPTH = 0.025  # half a leaf's thickness
OFFSET = 0.058  # the sliding leaf's centre line from the fixed panel's: 8 mm between their faces
RPM = 33.333

scene = bpy.context.scene
if scene.get(MARK) is not None:
    raise RuntimeError(f"already applied (version {scene[MARK]})")
if scene.get("model_details") is None:
    raise RuntimeError("apply model_details.py first: this rebuilds its French doors")


def finished_frame():
    """The frame at which the build-up animation has finished (as scene_select.finished_frame)."""
    frame = scene.frame_end
    for action in bpy.data.actions:
        for layer in getattr(action, "layers", ()):
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", ()):
                    for fc in bag.fcurves:
                        for kp in fc.keyframe_points:
                            frame = max(frame, int(np.ceil(kp.co[0])))
    return frame


def world_coords(obj):
    me = obj.data
    return np.array([obj.matrix_world @ v.co for v in me.vertices]) if len(me.vertices) else np.zeros((0, 3))


def bbox(obj):
    co = world_coords(obj)
    return co.min(0), co.max(0)


class Builder:
    """World-space mesh made of boxes, one material slot per material used."""

    def __init__(self):
        self.bm = bmesh.new()
        self.bm.loops.layers.uv.new("UVMap")
        self.mats = []

    def box(self, lo, hi, mat):
        lo, hi = Vector([min(a, b) for a, b in zip(lo, hi)]), Vector([max(a, b) for a, b in zip(lo, hi)])
        if min(hi - lo) <= 0:
            return
        if mat not in self.mats:
            self.mats.append(mat)
        m = Matrix.Translation((lo + hi) / 2) @ Matrix.Diagonal((*(hi - lo), 1.0))
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m, calc_uvs=True)["verts"]
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = self.mats.index(mat)

    def build(self, name, col):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        obj = bpy.data.objects.new(name, me)
        col.objects.link(obj)
        return obj


def material(name):
    mat = bpy.data.materials.get(name)
    if mat is None:
        raise RuntimeError(f"material {name!r} is missing")
    return mat


def panel(b, x0, x1, yc, top, frame):
    """Stiles and rails of a leaf between x0 and x1 (the 5.5 cm stile at x0, as the French doors had at the hinge)."""
    d0, d1 = yc - DEPTH, yc + DEPTH
    b.box((x0, d0, 0.005), (x0 + 0.055, d1, top - 0.004), frame)
    b.box((x1 - 0.045, d0, 0.005), (x1, d1, top - 0.004), frame)
    b.box((x0, d0, 0.005), (x1, d1, 0.095), frame)
    b.box((x0, d0, top - 0.06), (x1, d1, top - 0.004), frame)


def side_of(room, x, yc):
    """+1 or -1: which way along Y from the frame line the room's floor lies."""
    floor = scene.objects[f"Floor - {room}"]
    lo, hi = bbox(floor)
    for s in (1, -1):
        y = yc + s * 0.4
        if lo[0] <= x <= hi[0] and lo[1] <= y <= hi[1]:
            return s
    raise RuntimeError(f"no floor of {room} beside the glazed door at x {x:.2f}")


def sliding_door(num, rooms):
    prefix = f"Glazed Door {num} ({rooms})"
    jambs = sorted((bbox(scene.objects[f"{prefix} jamb{s}"]) for s in ("", ".001")), key=lambda b: b[0][0])
    (j0lo, j0hi), (j1lo, _) = jambs
    u0, u1 = float(j0hi[0]), float(j1lo[0])
    yc = float(j0lo[1] + j0hi[1]) / 2
    top = float(j0hi[2])
    um = (u0 + u1) / 2
    for name in (f"Door leaf {num}a", f"Door leaf {num}b", f"{prefix} glass", f"{prefix} glass.001"):
        bpy.data.objects.remove(scene.objects[name], do_unlink=True)
    col = scene.objects[f"{prefix} jamb"].users_collection[0]
    frame, glass, pull = material("Window frame aluminium"), material("Glass"), material("Black steel")

    # The fixed panel, west of the middle, on the frame line.
    x0, x1 = u0 + GAP, um - GAP / 2
    b = Builder()
    panel(b, x0, x1, yc, top, frame)
    b.build(f"{prefix} fixed panel", col)
    g = Builder()
    g.box((x0 + 0.05, yc - 0.003, 0.09), (x1 - 0.04, yc + 0.003, top - 0.055), glass)
    g.build(f"{prefix} glass", col)

    # The sliding leaf, east of the middle, in front of the frame on the second room's side; it slides west.
    s = side_of(rooms.split(" / ")[1], um, yc)
    y = yc + s * OFFSET
    x0, x1 = um + GAP / 2, u1 - GAP
    b = Builder()
    b.box((x0, y - DEPTH, 0.005), (x0 + 0.045, y + DEPTH, top - 0.004), frame)  # meeting stile at x0
    b.box((x1 - 0.055, y - DEPTH, 0.005), (x1, y + DEPTH, top - 0.004), frame)
    b.box((x0, y - DEPTH, 0.005), (x1, y + DEPTH, 0.095), frame)
    b.box((x0, y - DEPTH, top - 0.06), (x1, y + DEPTH, top - 0.004), frame)
    # Pulls on the meeting stile: a bar on the outer face, a flush plate on the face that passes the fixed panel.
    b.box((x0 + 0.012, y + s * DEPTH, 0.85), (x0 + 0.032, y + s * (DEPTH + 0.012), 1.25), pull)
    b.box((x0 + 0.012, y - s * DEPTH, 0.9), (x0 + 0.032, y - s * (DEPTH + 0.0015), 1.2), pull)
    leaf = b.build(f"Door leaf {num}b", col)
    leaf["web_move"] = "slide"
    leaf["web_dir"] = [-1.0, 0.0, 0.0]
    leaf["web_dist"] = round(x0 - (u0 + GAP), 4)
    g = Builder()
    g.box((x0 + 0.04, y - 0.003, 0.09), (x1 - 0.05, y + 0.003, top - 0.055), glass)
    glass_obj = g.build(f"{prefix} glass.001", col)
    glass_obj["web_leaf"] = leaf.name
    report.append(f"glazed door {num}: fixed {u0:.3f}..{um:.3f}, {leaf.name} slides {leaf['web_dist']} m, "
                  f"{s * OFFSET:+.3f} m off the frame")


def turntable():
    platter, record = scene.objects["Turntable platter"], scene.objects["Record on platter"]
    lo, hi = bbox(platter)
    pivot = (float(lo[0] + hi[0]) / 2, float(lo[1] + hi[1]) / 2, float(lo[2]))
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    platter.select_set(True)
    record.select_set(True)
    bpy.context.view_layer.objects.active = platter
    bpy.ops.object.join()
    platter["web_move"] = "spin"
    platter["web_pivot"] = [round(v, 4) for v in pivot]
    platter["web_axis"] = [0.0, 0.0, -1.0]  # clockwise seen from above
    platter["web_rpm"] = RPM
    report.append(f"turntable platter spins about {platter['web_pivot']}")


scene.frame_set(finished_frame())  # read the frames and floors where the build-up animation leaves them
report = []
sliding_door(4, "Exterior / Quarto 02")
sliding_door(24, "Cozinha / Lavandaria")
sliding_door(26, "Lavandaria / Marquise")
turntable()

scene[MARK] = VERSION
print("\n".join(f"[sliding] {r}" for r in report))
if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
