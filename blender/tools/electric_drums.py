"""One-off: an electronic drum kit in the music studio, Quarto 03 (November 2026).

A compact kit stands sideways on the rug: the drummer sits at its east end, back to the desk, facing the door.
- A black rack (two posts on floor feet, a front bar, side arms) holds a mesh snare, two toms and a floor tom, all
  with petrol shells, and the drum module on the left post.
- A kick tower with its pedal, a hi-hat pad on its own stand and pedal (the drummer's left, toward the slat wall),
  a crash on the left post and a ride on the right one: rubber cymbal pads.
- A round throne with a small backrest. The backrest tells the export which way the seat faces (seats.py: away from
  its back); without it the desk's stool behind would turn the drummer round to face the desk.
- The kit is tagged `web_instrument = "drums"` (played from a panel of pads), the throne's cushion and backrest
  `web_seat` (from the door the kit hides most of the cushion).

Reuses the helpers of model_details.py. Run headless on a staged copy (README, "Working on the model"):
    blender -b source.blend --python blender/tools/electric_drums.py -- --save
Refuses to run twice.
"""
import ast
import math
import os
import sys

import bpy
from mathutils import Vector

MARK = "electric_drums"
VERSION = 1

scene = bpy.context.scene
if scene.get(MARK) is not None:
    raise RuntimeError(f"already applied (version {scene[MARK]})")
if scene.get("music_studio") is None:
    raise RuntimeError("the music studio (music_studio.py) isn't in this model")
scene.frame_set(scene.frame_end)  # the export uses the finished flat


def _load_model_details():
    """The helper functions, classes and tables of model_details.py, without its one-off steps."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model_details.py")
    tree = ast.parse(open(path).read())
    tables = {"Z", "M", "details", "report"}
    body = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef))
            or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in tables for t in n.targets))]
    ns = {"__name__": "model_details_helpers", "scene": scene}
    exec(compile(ast.Module(body=body, type_ignores=[]), path, "exec"), ns)
    return ns


md = _load_model_details()
Builder, bbox, material = md["Builder"], md["bbox"], md["material"]
report = []

M = {
    "rack": material("Drum rack black", (0.025, 0.025, 0.027), 0.35, metallic=0.4),
    "chrome": material("Drum clamp chrome", (0.75, 0.75, 0.74), 0.2, metallic=1.0),
    "shell": material("Drum shell petrol", (0.04, 0.16, 0.19), 0.3),
    "head": material("Drum mesh head", (0.07, 0.07, 0.075), 0.95),
    "rim": material("Drum rim rubber", (0.015, 0.015, 0.016), 0.6),
    "cymbal": material("Cymbal pad rubber", (0.012, 0.012, 0.012), 0.75),
    "module": material("Synth body graphite", (0.09, 0.09, 0.1), 0.45),
    "display": material("Synth display", (0.05, 0.16, 0.22), 0.1),
    "knob": material("Knob black", (0.03, 0.03, 0.03), 0.4),
    "felt": material("Cymbal felt red", (0.45, 0.04, 0.05), 0.9),
    "seat": material("Bench leather black", (0.03, 0.03, 0.03), 0.55),
}

q03 = bpy.data.objects["Studio rug"].users_collection[0]  # "Furniture - Quarto 03"
rug_lo, rug_hi = bbox(bpy.data.objects["Studio rug"])
stool_lo, _ = bbox(bpy.data.objects["Stool seat"])  # the desk's stool, just east of the rug

# The kit is laid out from the drummer: `a` metres ahead (west, -x), `s` to their right (north, +y), `z` up.
TX = stool_lo[0] - 0.22  # the throne's middle, its backrest clear of the stool
TY = rug_lo[1] + 0.51  # the hi-hat clear of the guitars on the slat wall, the ride and floor tom of the piano bench


def at(a, s, z):
    return Vector((TX - a, TY + s, z))


def ahead(a, s, z):
    """A direction in the drummer's frame."""
    return Vector((-a, s, z)).normalized()


def rod(b, p0, p1, r, mat, segments=10):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    b.cylinder((p0 + p1) / 2, r, d.length, d, mat, segments=segments)


def pad(b, centre, r, depth, normal):
    """A drum pad: a shell, a rubber rim proud of it, and the mesh head inside the rim (`centre`: the shell's)."""
    n = Vector(normal).normalized()
    c = Vector(centre)
    b.cylinder(c, r, depth, n, M["shell"], segments=32)
    b.cylinder(c + n * (depth / 2 - 0.004), r + 0.006, 0.016, n, M["rim"], segments=32)
    b.cylinder(c + n * (depth / 2 + 0.003), r - 0.008, 0.006, n, M["head"], segments=32)


def cymbal(b, centre, r, normal):
    """A rubber cymbal pad: a shallow cone with its bell, and the felt and wing nut on top."""
    n = Vector(normal).normalized()
    c = Vector(centre)
    b.cylinder(c, r, 0.014, n, M["cymbal"], segments=36, radius2=r * 0.35)
    b.cylinder(c + n * 0.014, r * 0.3, 0.016, n, M["cymbal"], segments=24, radius2=r * 0.12)
    b.cylinder(c + n * 0.026, 0.016, 0.008, n, M["felt"], segments=12)
    b.cylinder(c + n * 0.034, 0.008, 0.01, n, M["chrome"], segments=8)


def tripod(b, foot_at, top_z, legs_r, mat=M["rack"]):
    """A stand's three splayed legs from a collar on its pole down to rubber feet."""
    collar = Vector((foot_at[0], foot_at[1], top_z))
    for k in range(3):
        t = 2 * math.pi * k / 3 + math.pi / 2
        foot = Vector((foot_at[0] + legs_r * math.cos(t), foot_at[1] + legs_r * math.sin(t), 0.012))
        rod(b, collar, foot, 0.008, mat, segments=8)
        b.cylinder(foot, 0.014, 0.024, "z", M["rim"], segments=10)


# ---------------------------------------------------------------------------------------------------- the kit

b = Builder()

# The rack: two posts on feet that run fore and aft, a front bar for the toms, side arms for the snare and floor tom.
POST_A, POST_S, POST_TOP = 0.55, 0.42, 0.96
for side in (-1, 1):
    s = side * POST_S
    b.box(at(POST_A + 0.24, s - 0.02, 0.0), at(POST_A - 0.2, s + 0.02, 0.04), M["rack"])  # the foot
    for a in (POST_A + 0.24, POST_A - 0.2):
        b.box(at(a + 0.025, s - 0.025, 0.0), at(a - 0.025, s + 0.025, 0.012), M["rim"])
    b.box(at(POST_A + 0.02, s - 0.02, 0.04), at(POST_A - 0.02, s + 0.02, POST_TOP), M["rack"])  # the post
    b.box(at(POST_A + 0.03, s - 0.03, 0.66), at(POST_A - 0.03, s + 0.03, 0.72), M["chrome"])  # its clamp
    b.box(at(POST_A + 0.02, s - 0.02, 0.66), at(0.26, s + 0.02, 0.7), M["rack"])  # the side arm, back to the drummer
FRONT_Z = 0.74
b.box(at(POST_A + 0.02, -POST_S, FRONT_Z), at(POST_A - 0.02, POST_S, FRONT_Z + 0.04), M["rack"])  # the front bar

# Pads, tilted toward the drummer: the snare and floor tom off the side arms, the two toms off the front bar.
SNARE = at(0.33, -0.1, 0.63)
pad(b, SNARE, 0.15, 0.07, ahead(-0.2, 0.05, 1))
rod(b, at(0.33, -0.1, 0.59), at(0.28, -POST_S, 0.68), 0.01, M["chrome"])
TOMS = [(at(0.5, -0.13, 0.84), ahead(-0.42, 0.12, 1)), (at(0.5, 0.13, 0.84), ahead(-0.42, -0.12, 1))]
for c, n in TOMS:
    pad(b, c, 0.105, 0.06, n)
    rod(b, c - n * 0.03, Vector((c.x, c.y, FRONT_Z + 0.02)), 0.01, M["chrome"])
FLOOR_TOM = at(0.32, 0.29, 0.62)
pad(b, FLOOR_TOM, 0.11, 0.065, ahead(-0.15, -0.2, 1))
rod(b, at(0.32, 0.29, 0.58), at(0.28, POST_S, 0.68), 0.01, M["chrome"])

# The module on the left post, above the first tom, its face to the drummer.
b.box(at(0.56, -0.4, 0.93), at(0.5, -0.22, 1.05), M["module"])
b.box(at(0.5, -0.36, 0.99), at(0.498, -0.27, 1.03), M["display"])
for k in range(4):
    b.cylinder(at(0.495, -0.38 + k * 0.045, 0.955), 0.007, 0.012, "x", M["knob"], segments=10)
rod(b, at(0.53, -0.4, 0.99), at(POST_A, -POST_S, 0.99), 0.01, M["chrome"])

# Cymbals: the crash off the left post, the ride off the right one, on booms from extensions of the posts.
CRASH = at(0.64, -0.28, 1.1)
RIDE = at(0.46, 0.36, 1.02)
for (centre, r, n), s in (((CRASH, 0.15, ahead(-0.25, 0.1, 1)), -POST_S), ((RIDE, 0.16, ahead(-0.2, -0.12, 1)), POST_S)):
    top = at(POST_A, s, 1.08 if s < 0 else 1.0)
    rod(b, at(POST_A, s, POST_TOP), top, 0.011, M["rack"])
    rod(b, top, centre - n * 0.01, 0.008, M["rack"])
    cymbal(b, centre, r, n)

# The kick tower: a base on the floor, two uprights holding the pad upright facing the drummer, and its pedal.
KICK_A, KICK_S = 0.64, 0.02
b.box(at(KICK_A + 0.08, KICK_S - 0.13, 0.0), at(KICK_A - 0.06, KICK_S + 0.13, 0.03), M["rack"])
for s in (KICK_S - 0.1, KICK_S + 0.1):
    b.box(at(KICK_A + 0.04, s - 0.012, 0.03), at(KICK_A, s + 0.012, 0.42), M["rack"])
pad(b, at(KICK_A - 0.02, KICK_S, 0.25), 0.095, 0.05, ahead(-1, 0, 0))
b.box(at(KICK_A - 0.04, KICK_S - 0.06, 0.0), at(0.4, KICK_S + 0.06, 0.02), M["rack"])  # the pedal's plate
b.box(at(KICK_A - 0.08, KICK_S - 0.045, 0.03), at(0.42, KICK_S + 0.045, 0.06), M["chrome"])  # its footboard
rod(b, at(KICK_A - 0.08, KICK_S, 0.05), at(KICK_A - 0.08, KICK_S, 0.21), 0.005, M["chrome"])  # the beater's shaft
b.sphere(at(KICK_A - 0.065, KICK_S, 0.22), 0.025, M["felt"], scale=(0.7, 1, 1))  # its head

# The hi-hat: its own stand on the drummer's left, the pad high on the pole, the pedal toward the drummer.
HH_A, HH_S, HH_Z = 0.3, -0.36, 0.92
pole = at(HH_A, HH_S, 0.0)
rod(b, at(HH_A, HH_S, 0.1), at(HH_A, HH_S, HH_Z), 0.012, M["rack"])
tripod(b, pole, 0.32, 0.2)
cymbal(b, at(HH_A, HH_S, HH_Z), 0.13, ahead(-0.1, 0.05, 1))
b.box(at(HH_A - 0.03, HH_S - 0.045, 0.0), at(0.08, HH_S + 0.045, 0.045), M["chrome"])  # its pedal
b.box(at(HH_A + 0.02, HH_S - 0.05, 0.0), at(HH_A - 0.03, HH_S + 0.05, 0.03), M["rack"])

kit = b.build("Studio drum kit", q03)
kit["web_instrument"] = "drums"

# ---------------------------------------------------------------------------------------------------- the throne

b = Builder()
SEAT_TOP = 0.55
b.cylinder(at(0, 0, 0.475), 0.15, 0.03, "z", M["rack"], segments=28)
b.cylinder(at(0, 0, 0.3), 0.022, 0.36, "z", M["chrome"], segments=12)
b.cylinder(at(0, 0, 0.42), 0.032, 0.05, "z", M["rack"], segments=12)  # the height lock
tripod(b, at(0, 0, 0), 0.16, 0.27)
build_throne = b.build("Drum throne", q03)

# The cushion and the backrest are the seat: from the door the kit hides most of the cushion, so the backrest is
# what a visitor clicks to sit. The export sees the backrest as the seat's back, and faces the seat away from it.
b = Builder()
b.cylinder(at(0, 0, SEAT_TOP - 0.035), 0.17, 0.05, "z", M["seat"], segments=32)
b.cylinder(at(0, 0, SEAT_TOP - 0.006), 0.15, 0.012, "z", M["seat"], segments=32)
rod(b, at(-0.06, 0, 0.47), at(-0.13, 0, 0.66), 0.012, M["chrome"])  # the backrest's post
b.box(at(-0.11, -0.13, 0.64), at(-0.15, 0.13, 0.9), M["seat"])
seat = b.build("Drum throne seat", q03)
seat["web_seat"] = "sit"

for o in (kit, build_throne, seat):
    lo, hi = bbox(o)
    report.append(f"{o.name}: x {lo[0]:.2f}..{hi[0]:.2f}, y {lo[1]:.2f}..{hi[1]:.2f}, z {lo[2]:.2f}..{hi[2]:.2f}")
report.append(f"rug x {rug_lo[0]:.2f}..{rug_hi[0]:.2f}, y {rug_lo[1]:.2f}..{rug_hi[1]:.2f}; throne at x {TX:.2f}, y {TY:.2f}")

scene[MARK] = VERSION
print("\n".join(f"[drums] {r}" for r in report))
if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
