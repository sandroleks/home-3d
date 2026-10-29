"""One-off: Quarto 03, the workshop, becomes a music studio (October 2026).

- Out: the oak cubby shelving and its bins (north wall), the wardrobe with the mirror (south wall), and the pegboard
  with its tools, tape and tool tray (east wall).
- The workbench stays as the desk. The 3D printer keeps its place at the north end, the filament keeps the high
  shelf, and between them stand a 61-key synth and a pair of studio monitors on foam pads.
- North wall: a black digital upright piano with its bench (a seat, `web_seat`).
- South wall: an oak slat acoustic wall on black felt (one panel, the slats drawn on it), with an electric guitar, a
  bass and two ukuleles on wall hangers.
- Fabric acoustic panels on the other walls, a floor-to-ceiling bass trap in the free corner, and a rug.
- The piano, the synth and the four hung instruments are tagged `web_instrument`: visitors can play them. The four
  hung ones are loose things too (`web_prop`): visitors take them off their hangers to play.

Reuses the helpers of model_details.py. Run headless on a staged copy (README, "Working on the model"):
    blender -b source.blend --python blender/tools/music_studio.py -- --save
Refuses to run twice.
"""
import ast
import math
import os
import sys

import bmesh
import bpy

MARK = "music_studio"
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
Builder, M, bbox, existing, material = md["Builder"], md["M"], md["bbox"], md["existing"], md["material"]
report = []
GRAIN_UP, GRAIN_ALONG_X = (0.0, 0.0, -0.98), (-0.98, 0.0, 0.0)
CEILING = 2.628

M.update({
    "piano": material("Piano black satin", (0.02, 0.02, 0.022), 0.3),
    "key white": material("Piano key white", (0.92, 0.91, 0.87), 0.3),
    "key black": material("Piano key black", (0.015, 0.015, 0.015), 0.35),
    "felt red": material("Piano felt red", (0.45, 0.04, 0.05), 0.9),
    "brass": existing("Brass", rgb=(0.75, 0.55, 0.25), metallic=1.0, roughness=0.3),
    "paper": material("Sheet music paper", (0.93, 0.91, 0.85), 0.8),
    "cushion": material("Bench leather black", (0.03, 0.03, 0.03), 0.55),
    "synth": material("Synth body graphite", (0.09, 0.09, 0.1), 0.45),
    "walnut": material("Walnut", (0.25, 0.14, 0.08), 0.5),
    "knob": material("Knob black", (0.03, 0.03, 0.03), 0.4),
    "display": material("Synth display", (0.05, 0.16, 0.22), 0.1),
    "monitor": material("Monitor cabinet black", (0.03, 0.03, 0.035), 0.5),
    "cone": material("Woofer cone", (0.12, 0.12, 0.13), 0.7),
    "foam": material("Isolation foam", (0.2, 0.2, 0.21), 0.95),
    "cherry": material("Guitar cherry sunburst", (0.42, 0.04, 0.03), 0.2),
    "bass": material("Guitar gloss black", (0.02, 0.02, 0.02), 0.15),
    "pickguard": material("Pickguard white", (0.9, 0.88, 0.82), 0.3),
    "maple": material("Maple neck", (0.82, 0.64, 0.4), 0.35),
    "rosewood": material("Rosewood", (0.16, 0.09, 0.05), 0.5),
    "koa": material("Koa", (0.55, 0.3, 0.13), 0.3),
    "mint": material("Ukulele mint", (0.55, 0.8, 0.7), 0.3),
    "fret": material("Fret nickel", (0.75, 0.75, 0.72), 0.25, metallic=1.0),
    "string": material("String steel", (0.8, 0.8, 0.78), 0.2, metallic=1.0),
    "nylon": material("String nylon", (0.95, 0.93, 0.86), 0.4),
    "bone": material("Nut bone", (0.93, 0.9, 0.82), 0.4),
    "felt": material("Acoustic felt black", (0.02, 0.02, 0.02), 0.95),
    "panel charcoal": material("Acoustic fabric charcoal", (0.11, 0.11, 0.12), 0.95),
    "panel petrol": material("Acoustic fabric petrol", (0.07, 0.2, 0.24), 0.95),
    "panel rust": material("Acoustic fabric rust", (0.5, 0.2, 0.1), 0.95),
    "rug": material("Rug wool rust", (0.36, 0.17, 0.11), 0.95),
    "rug border": material("Rug wool oat", (0.75, 0.68, 0.56), 0.95),
})


def build(b, name, col, grain=None):
    obj = b.build(name, col)
    if grain:
        obj["grain_stretch"] = grain
    return obj


def remove(names):
    for n in names:
        o = bpy.data.objects.get(n)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)
        else:
            report.append(f"(not found: {n})")


def prism(b, outline, y0, y1, mat):
    """A slab in the x-z plane, from y0 to y1, its face the polygon `outline` [(x, z), ...] (counter-clockwise seen
    from +y). One ngon each side, so overlapping parts never share a face; UVs planar in x-z."""
    bm, uv = b.bm, b.uv
    back = [bm.verts.new((x, y0, z)) for x, z in outline]
    front = [bm.verts.new((x, y1, z)) for x, z in outline]
    faces = [bm.faces.new(front), bm.faces.new(list(reversed(back)))]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((back[i], back[j], front[j], front[i])))
    idx = b._slot(mat)
    for f in faces:
        f.material_index = idx
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = (co.x + co.y, co.z)
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def union_outline(circles, centre, n=128, smooth=3):
    """The outline of a union of circles [(x, z, r)], seen from `centre` (it must see every edge), its radii averaged
    over 2 * smooth + 1 neighbours to round where the circles meet: counter-clockwise seen from +y, i.e. clockwise in
    (x, z)."""
    cx, cz = centre
    dirs = [(math.cos(-2 * math.pi * i / n), math.sin(-2 * math.pi * i / n)) for i in range(n)]
    radii = []
    for dx, dz in dirs:
        far = 0.0
        for x, z, r in circles:
            ox, oz = cx - x, cz - z
            bq = ox * dx + oz * dz
            disc = bq * bq - (ox * ox + oz * oz - r * r)
            if disc >= 0:
                far = max(far, -bq + math.sqrt(disc))
        radii.append(far)
    radii = [sum(radii[(i + k) % n] for k in range(-smooth, smooth + 1)) / (2 * smooth + 1) for i in range(n)]
    return [(cx + dx * r, cz + dz * r) for (dx, dz), r in zip(dirs, radii)]


q03 = bpy.data.objects["Bench drawers"].users_collection[0]  # "Furniture - Quarto 03"
flo, fhi = bbox(bpy.data.objects["Floor - Quarto 03"])
WEST, EAST, SOUTH, NORTH = flo[0], fhi[0], flo[1], fhi[1]  # the walls' faces
report.append(f"Quarto 03 walls: x {WEST:.3f}..{EAST:.3f}, y {SOUTH:.3f}..{NORTH:.3f}")

# ---------------------------------------------------------------------------------------------------- out

remove([f"Storage shelf {i}" for i in range(5)] + [f"Storage upright {i}" for i in range(3)]
       + [f"Bin {i}" for i in range(14)])
remove(["Workshop wardrobe carcass", "Workshop wardrobe carcass contents", "Workshop wardrobe carcass contents.001",
        "Wardrobe door 0", "Wardrobe door 1", "Wardrobe door 2", "Wardrobe handle 1", "Wardrobe mirror"])
cutters = bpy.data.collections.get("Cutters - Workshop wardrobe carcass")
if cutters is not None:
    for o in list(cutters.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(cutters)
remove(["Pegboard", "Tape roll", "Tool tray"] + [f"Hung tool {i}" for i in range(8)])
report.append("removed the cubby shelving and bins, the wardrobe, the pegboard and its tools")

# ---------------------------------------------------------------------------------------------------- piano

PX0, PX1 = 0.98, 2.34  # clear of the door, which opens flat along this wall up to x 0.85
BACK_Y, FRONT_Y = NORTH - 0.01, NORTH - 0.42
CHEEK = 0.06
KX0, KX1 = PX0 + CHEEK, PX1 - CHEEK
KEY_FRONT, KEY_BACK, KEY_TOP = FRONT_Y + 0.012, FRONT_Y + 0.162, 0.755
CAB_Y = KEY_BACK + 0.02  # the cabinet's face above the keys (a red felt strip between)
TOP_Z = 0.97

b = Builder()
for x0, x1 in ((PX0, PX0 + CHEEK), (PX1 - CHEEK, PX1)):
    b.box((x0, FRONT_Y, 0.0), (x1, CAB_Y - 0.04, 0.8), M["piano"])  # the arms
    b.box((x0, CAB_Y - 0.04, 0.0), (x1, BACK_Y, TOP_Z), M["piano"])
b.box((KX0, CAB_Y, 0.7), (KX1, BACK_Y, TOP_Z), M["piano"])  # the cabinet above the keys
b.box((PX0 - 0.005, CAB_Y - 0.045, TOP_Z), (PX1 + 0.005, BACK_Y + 0.004, TOP_Z + 0.02), M["piano"])  # top board
b.box((KX0, FRONT_Y, 0.7), (KX1, KEY_FRONT, KEY_TOP - 0.01), M["piano"])  # key slip
b.box((KX0, KEY_FRONT, 0.7), (KX1, CAB_Y, KEY_TOP - 0.02), M["piano"])  # key bed
b.box((KX0, CAB_Y, 0.1), (KX1, CAB_Y + 0.016, 0.7), M["piano"])  # front board under the keys
b.box((KX0, BACK_Y - 0.016, 0.05), (KX1, BACK_Y, 0.7), M["piano"])  # back board
mid = (PX0 + PX1) / 2
b.box((mid - 0.32, CAB_Y - 0.045, TOP_Z + 0.02), (mid + 0.32, CAB_Y - 0.02, TOP_Z + 0.035), M["piano"])  # rest ledge
b.box((mid - 0.32, CAB_Y - 0.02, TOP_Z + 0.02), (mid + 0.32, CAB_Y - 0.005, TOP_Z + 0.29), M["piano"])  # music rest
b.box((mid - 0.1, CAB_Y - 0.06, 0.0), (mid + 0.1, CAB_Y + 0.016, 0.06), M["piano"])  # pedal box
for k in (-1, 0, 1):
    x = mid + k * 0.055
    b.box((x - 0.011, FRONT_Y + 0.03, 0.03), (x + 0.011, CAB_Y - 0.06, 0.045), M["brass"])
b.box((KX0, KEY_BACK, KEY_TOP - 0.02), (KX1, CAB_Y, KEY_TOP - 0.008), M["felt red"])
for i, x0 in enumerate((mid - 0.29, mid + 0.005)):  # an open book of sheet music on the rest
    b.box((x0, CAB_Y - 0.0225, TOP_Z + 0.04), (x0 + 0.285, CAB_Y - 0.0205, TOP_Z + 0.3), M["paper"])
build(b, "Studio piano", q03)["web_instrument"] = "piano"  # its box holds the keys too

b = Builder()  # 88 keys from A0: 52 white, with a black key after every A, C, D, F and G
WHITE = (KX1 - KX0) / 52
for i in range(52):
    x0 = KX0 + i * WHITE
    b.box((x0 + 0.0005, KEY_FRONT, KEY_TOP - 0.02), (x0 + WHITE - 0.0005, KEY_BACK, KEY_TOP), M["key white"])
for i in range(51):
    if "ABCDEFG"[i % 7] in "ACDFG":
        x = KX0 + (i + 1) * WHITE
        b.box((x - 0.0065, KEY_FRONT + 0.055, KEY_TOP), (x + 0.0065, KEY_BACK, KEY_TOP + 0.012), M["key black"])
build(b, "Studio piano keys", q03)

BENCH_Y0, BENCH_Y1 = FRONT_Y - 0.385, FRONT_Y - 0.085
b = Builder()
for x in (mid - 0.28, mid + 0.24):
    for y in (BENCH_Y0 + 0.02, BENCH_Y1 - 0.06):
        b.box((x, y, 0.0), (x + 0.04, y + 0.04, 0.44), M["piano"])
b.box((mid - 0.3, BENCH_Y0, 0.44), (mid + 0.3, BENCH_Y1, 0.47), M["piano"])
build(b, "Piano bench", q03)
b = Builder()
b.box((mid - 0.295, BENCH_Y0 + 0.005, 0.47), (mid + 0.295, BENCH_Y1 - 0.005, 0.5), M["cushion"])
seat = build(b, "Piano bench seat", q03)
seat["web_seat"] = "sit"
report.append(f"piano x {PX0}..{PX1}, front at y {FRONT_Y:.3f}; bench y {BENCH_Y0:.3f}..{BENCH_Y1:.3f}")

# ---------------------------------------------------------------------------------------------------- the desk

top = bbox(bpy.data.objects["Workbench top"])
DESK_Z = top[1][2]
DX0 = top[0][0] + 0.06  # the synth's front, the player's side
PILLAR_Y = -0.74  # a pillar fills the south-east corner up to here, from x 2.825 to the east wall
SY0, SY1 = PILLAR_Y, 0.16  # from the pillar to the printer's enclosure
b = Builder()
b.box((DX0, SY0, DESK_Z), (DX0 + 0.15, SY1, DESK_Z + 0.04), M["synth"])  # under the keys
b.box((DX0 + 0.15, SY0, DESK_Z), (DX0 + 0.34, SY1, DESK_Z + 0.055), M["synth"])
b.box((DX0 + 0.15, SY0 + 0.02, DESK_Z + 0.055), (DX0 + 0.34, SY1 - 0.02, DESK_Z + 0.09), M["synth"])  # panel
for y0, y1 in ((SY0, SY0 + 0.02), (SY1 - 0.02, SY1)):
    b.box((DX0, y0, DESK_Z), (DX0 + 0.34, y1, DESK_Z + 0.1), M["walnut"])  # end cheeks
b.box((DX0 + 0.17, -0.42, DESK_Z + 0.09), (DX0 + 0.25, -0.24, DESK_Z + 0.092), M["display"])
for row in range(2):
    for k in range(12):
        y = SY0 + 0.07 + k * 0.035 if k < 6 else 0.0 - (11 - k) * 0.035
        b.cylinder((DX0 + 0.19 + row * 0.04, y, DESK_Z + 0.098), 0.009, 0.016, "z", M["knob"], segments=12)
for k in range(8):  # pads
    b.box((DX0 + 0.265, -0.2 + k * 0.03, DESK_Z + 0.09), (DX0 + 0.29, -0.177 + k * 0.03, DESK_Z + 0.096),
          M["key white"])
KY0, KY1 = SY0 + 0.025, SY1 - 0.1  # keys; wheels at the low (player's left) end
WK = (KY1 - KY0) / 36
for i in range(36):
    y1 = KY1 - i * WK
    b.box((DX0 + 0.005, y1 - WK + 0.0005, DESK_Z + 0.04), (DX0 + 0.15, y1 - 0.0005, DESK_Z + 0.06), M["key white"])
for i in range(35):
    if "CDEFGAB"[i % 7] in "CDFGA":
        y = KY1 - (i + 1) * WK
        b.box((DX0 + 0.06, y - 0.006, DESK_Z + 0.06), (DX0 + 0.15, y + 0.006, DESK_Z + 0.071), M["key black"])
for y in (SY1 - 0.07, SY1 - 0.04):
    b.cylinder((DX0 + 0.07, y, DESK_Z + 0.06), 0.028, 0.016, "y", M["knob"], segments=20)
build(b, "Studio synth", q03)["web_instrument"] = "synth"

b = Builder()
for yc in (PILLAR_Y + 0.12, 0.27):
    y0, y1 = yc - 0.085, yc + 0.085
    x0, x1 = EAST - 0.27, EAST - 0.05
    b.box((x0 + 0.01, y0 + 0.01, DESK_Z), (x1 - 0.01, y1 - 0.01, DESK_Z + 0.04), M["foam"])
    b.box((x0, y0, DESK_Z + 0.04), (x1, y1, DESK_Z + 0.32), M["monitor"])
    b.cylinder((x0 - 0.002, yc, DESK_Z + 0.14), 0.062, 0.004, "x", M["cone"], segments=28)
    b.cylinder((x0 - 0.004, yc, DESK_Z + 0.14), 0.022, 0.004, "x", M["knob"], segments=16)
    b.cylinder((x0 - 0.002, yc, DESK_Z + 0.255), 0.024, 0.004, "x", M["cone"], segments=20)
build(b, "Studio monitors", q03)
report.append(f"synth y {SY0}..{SY1} and monitors on the desk (top at {DESK_Z:.3f})")

# ---------------------------------------------------------------------------------------------------- slat wall

TRAP = 0.3  # the bass trap's legs in the south-west corner
SX0, SX1 = WEST + TRAP + 0.02, top[0][0] - 0.03
SLAT_W, SLAT_GAP, SLAT_D = 0.027, 0.013, 0.033  # a slat, the felt between two, and the panel's depth
SZ0, SZ1 = 0.1, 2.4


def slat_material():
    """Oak slats on black felt, drawn on a flat panel: the Oak material's colour where a slat is, the felt's in the
    gaps, in vertical bands across x (object space is the room's: Builder meshes sit at the origin). Modelled slat by
    slat, each 27 mm face was too thin for the bake's textures and came out black."""
    mat = bpy.data.materials.get("Slat panel oak and felt")
    if mat is not None:
        return mat
    mat = M["oak"].copy()
    mat.name = "Slat panel oak and felt"
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    base = bsdf.inputs["Base Color"]
    if base.is_linked:
        oak = base.links[0].from_socket
    else:
        rgb = nt.nodes.new("ShaderNodeRGB")
        rgb.outputs[0].default_value = base.default_value[:]
        oak = rgb.outputs[0]
    coords = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type, wave.bands_direction, wave.wave_profile = "BANDS", "X", "SAW"
    wave.inputs["Scale"].default_value = 2 * math.pi / (20 * (SLAT_W + SLAT_GAP))  # one band a slat and its gap
    wave.inputs["Distortion"].default_value = 0.0
    wave.inputs["Detail"].default_value = 0.0
    nt.links.new(coords.outputs["Object"], wave.inputs["Vector"])
    slat = nt.nodes.new("ShaderNodeMath")
    slat.operation = "GREATER_THAN"
    slat.inputs[1].default_value = SLAT_GAP / (SLAT_W + SLAT_GAP)
    nt.links.new(wave.outputs["Fac"], slat.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    a, b_ = (next(s for s in mix.inputs if s.name == n and s.type == "RGBA") for n in ("A", "B"))
    a.default_value = (0.02, 0.02, 0.02, 1.0)  # the felt
    nt.links.new(slat.outputs[0], mix.inputs["Factor"])
    nt.links.new(oak, b_)
    nt.links.new(next(s for s in mix.outputs if s.type == "RGBA"), base)
    return mat


b = Builder()
b.box((SX0, SOUTH, SZ0), (SX1, SOUTH + SLAT_D, SZ1), slat_material())
build(b, "Studio slat wall", q03, GRAIN_UP)
SLAT_FRONT = SOUTH + SLAT_D
report.append(f"slat wall x {SX0:.3f}..{SX1:.3f}, one panel")

# ---------------------------------------------------------------------------------------------------- instruments

# Hung flat, face out (+y), by the neck under the headstock. Shapes are relative to the bridge: circles (dx, dz, r)
# whose union is the body; the neck meets it at `join` above the bridge.
INSTRUMENTS = {
    "electric guitar": dict(scale=0.648, frets=21, depth=0.045, neck=0.046, head=(0.18, 0.08, -0.018), strings=6,
                            circles=[(0.0, 0.0, 0.16), (0.0, 0.12, 0.135), (-0.08, 0.2, 0.08), (-0.105, 0.255, 0.045),
                                     (0.08, 0.19, 0.07), (0.095, 0.235, 0.035)],
                            centre=(0.0, 0.1), join=0.24, body="cherry", neck_mat="maple", board="rosewood",
                            pickups=(0.04, 0.1, 0.16), guard=[(0.02, 0.05, 0.06), (0.0, 0.11, 0.065), (-0.03, 0.17, 0.055)]),
    "bass": dict(scale=0.864, frets=20, depth=0.045, neck=0.05, head=(0.2, 0.09, -0.022), strings=4,
                 circles=[(0.0, 0.02, 0.17), (0.0, 0.15, 0.14), (-0.085, 0.24, 0.085), (-0.115, 0.31, 0.05),
                          (0.085, 0.22, 0.075), (0.1, 0.27, 0.04)],
                 centre=(0.0, 0.12), join=0.28, body="bass", neck_mat="maple", board="maple",
                 pickups=(0.08, 0.2), guard=[(0.03, 0.09, 0.06), (0.0, 0.15, 0.065), (-0.03, 0.21, 0.055)]),
    "ukulele": dict(scale=0.381, frets=15, depth=0.07, neck=0.036, head=(0.09, 0.056, 0.0), strings=4,
                    circles=[(0.0, 0.025, 0.115), (0.0, 0.125, 0.09)], centre=(0.0, 0.07), join=0.205,
                    body=None, neck_mat="koa", board="rosewood", pickups=(), guard=[]),
}
HANG_Z = 1.88  # the nut of every instrument, just above its hanger
HANG_OFF = 0.045  # the body's back from the slats


def fret_at(scale, k):
    return scale * (1 - 2 ** (-k / 12))


def instrument(name, kind, cx, body_mat):
    s = INSTRUMENTS[kind]
    nylon = kind == "ukulele"
    neck_mat = M[s["neck_mat"]]
    yb = SLAT_FRONT + HANG_OFF
    yf = yb + s["depth"]
    bridge = HANG_Z - s["scale"]
    b = Builder()
    circles = [(cx + dx, bridge + dz, r) for dx, dz, r in s["circles"]]
    prism(b, union_outline(circles, (cx + s["centre"][0], bridge + s["centre"][1])), yb, yf, body_mat)
    w = s["neck"]
    b.box((cx - w / 2, yf - 0.022, bridge + s["join"] - 0.04), (cx + w / 2, yf + 0.002, HANG_Z), neck_mat)
    fb_end = HANG_Z - fret_at(s["scale"], s["frets"]) - 0.008
    b.box((cx - w / 2 + 0.001, yf + 0.002, fb_end), (cx + w / 2 - 0.001, yf + 0.008, HANG_Z), M[s["board"]])
    for k in range(1, s["frets"] + 1):
        z = HANG_Z - fret_at(s["scale"], k)
        b.box((cx - w / 2 + 0.001, yf + 0.008, z - 0.001), (cx + w / 2 - 0.001, yf + 0.0095, z + 0.001), M["fret"])
    for k in (3, 5, 7, 9, 12, 15, 17):
        if k > s["frets"]:
            continue
        z = HANG_Z - (fret_at(s["scale"], k - 1) + fret_at(s["scale"], k)) / 2
        for dx in ((-0.009, 0.009) if k == 12 else (0.0,)):
            b.cylinder((cx + dx, yf + 0.0085, z), 0.0028, 0.001, "y", M["key black" if s["board"] == "maple" else "bone"],
                       segments=10)
    b.box((cx - w / 2, yf + 0.002, HANG_Z), (cx + w / 2, yf + 0.011, HANG_Z + 0.005), M["bone"])  # nut
    hl, hw, hdx = s["head"]
    hy0, hy1 = yf - 0.02, yf - 0.004
    b.box((cx + hdx - hw / 2, hy0, HANG_Z + 0.005), (cx + hdx + hw / 2, hy1, HANG_Z + hl), neck_mat)
    pegs = s["strings"]
    if nylon:  # two a side, buttons out to the sides
        for side in (-1, 1):
            for k in range(2):
                z = HANG_Z + 0.03 + k * 0.035
                b.cylinder((cx + side * (hw / 2 + 0.012), (hy0 + hy1) / 2, z), 0.004, 0.024, "x", M["fret"], segments=8)
                b.sphere((cx + side * (hw / 2 + 0.03), (hy0 + hy1) / 2, z), 0.009, M["bone"], scale=(0.5, 1, 1))
    else:  # in a line along the headstock's edge
        side = -1 if hdx < 0 else 1
        for k in range(pegs):
            z = HANG_Z + 0.03 + k * (hl - 0.05) / max(1, pegs - 1)
            b.cylinder((cx + hdx - side * (hw / 2 - 0.015), hy1 + 0.006, z), 0.004 if pegs == 6 else 0.006, 0.012, "y",
                       M["fret"], segments=10)
            b.cylinder((cx + hdx - side * (hw / 2 + 0.012), (hy0 + hy1) / 2, z), 0.003, 0.024, "x", M["fret"],
                       segments=8)
            b.box((cx + hdx - side * (hw / 2 + 0.03) - 0.008, (hy0 + hy1) / 2 - 0.003, z - 0.008),
                  (cx + hdx - side * (hw / 2 + 0.03) + 0.008, (hy0 + hy1) / 2 + 0.003, z + 0.008), M["fret"])
    if s["guard"]:
        guard = [(cx + dx, bridge + dz, r) for dx, dz, r in s["guard"]]
        centre = (sum(g[0] for g in guard) / len(guard), sum(g[1] for g in guard) / len(guard))
        prism(b, union_outline(guard, centre), yf, yf + 0.002, M["pickguard"])
    for pz in s["pickups"]:
        b.box((cx - 0.036, yf + 0.002, bridge + pz - 0.009), (cx + 0.036, yf + 0.009, bridge + pz + 0.009),
              M["key black"] if kind == "bass" else M["pickguard"])
    if s["pickups"]:
        for k in range(3 if kind != "bass" else 2):
            b.cylinder((cx + 0.075 + k * 0.012, yf + 0.009, bridge - 0.04 - k * 0.04), 0.011, 0.016, "y",
                       M["knob"], segments=14)
        b.box((cx - 0.04, yf, bridge - 0.012), (cx + 0.04, yf + 0.012, bridge + 0.02), M["steel"])
    else:  # the ukulele: a sound hole with a rosette and a rosewood bridge
        hole_z = bridge + 0.11
        b.cylinder((cx, yf + 0.0005, hole_z), 0.034, 0.001, "y", M["rosewood"], segments=28)
        b.cylinder((cx, yf + 0.001, hole_z), 0.03, 0.001, "y", M["key black"], segments=28)
        b.box((cx - 0.04, yf, bridge - 0.008), (cx + 0.04, yf + 0.009, bridge + 0.008), M["rosewood"])
    # strings, nut to bridge
    span = w * 0.75
    for k in range(pegs):
        x = cx - span / 2 + k * span / max(1, pegs - 1)
        t = 0.0008 if nylon else (0.0012 if kind == "bass" else 0.0007)
        b.box((x - t, yf + 0.0105, bridge), (x + t, yf + 0.0105 + 2 * t, HANG_Z + 0.004),
              M["nylon"] if nylon else M["string"])
    # the hanger, which stays on the wall when the instrument is taken: a wall plate and a padded yoke
    HANGERS.box((cx - 0.03, SLAT_FRONT, HANG_Z - 0.07), (cx + 0.03, SLAT_FRONT + 0.012, HANG_Z), M["knob"])
    for side in (-1, 1):
        HANGERS.cylinder((cx + side * (w / 2 + 0.007), (SLAT_FRONT + yf) / 2 + 0.01, HANG_Z - 0.002), 0.006,
                         yf - SLAT_FRONT + 0.01, "y", M["knob"], segments=10)
    obj = build(b, name, q03)
    obj["web_instrument"] = obj["web_prop"] = "bass guitar" if kind == "bass" else kind  # loose: picked up to play
    return bridge - max(r - dz for dx, dz, r in s["circles"])


HANGS = [("Studio ukulele 0", "ukulele", M["koa"]), ("Studio electric guitar", "electric guitar", M["cherry"]),
         ("Studio bass guitar", "bass", M["bass"]), ("Studio ukulele 1", "ukulele", M["mint"])]
widths = [2 * max(abs(dx) + r for dx, dz, r in INSTRUMENTS[k]["circles"]) for _, k, _ in HANGS]
gap = (SX1 - SX0 - sum(widths)) / (len(HANGS) + 1)
x = SX0 + gap
HANGERS = Builder()
for (name, kind, mat), w in zip(HANGS, widths):
    bottom = instrument(name, kind, x + w / 2, mat)
    report.append(f"{name} at x {x + w / 2:.3f}, z {bottom:.2f}..{HANG_Z:.2f}")
    x += w + gap
build(HANGERS, "Studio instrument hangers", q03)

# ---------------------------------------------------------------------------------------------------- treatment

PANEL_D = 0.05
b = Builder()  # the bass trap: a triangular column in the south-west corner, floor to ceiling
x0, y0 = WEST + 0.005, SOUTH + 0.005
bm, uv = b.bm, b.uv
corner = [(x0, y0), (x0 + TRAP, y0), (x0, y0 + TRAP)]
lower = [bm.verts.new((x, y, 0.0)) for x, y in corner]
upper = [bm.verts.new((x, y, CEILING - 0.005)) for x, y in corner]
faces = [bm.faces.new(upper), bm.faces.new(list(reversed(lower)))]
for i in range(3):
    j = (i + 1) % 3
    faces.append(bm.faces.new((lower[i], lower[j], upper[j], upper[i])))
idx = b._slot(M["panel charcoal"])
for f in faces:
    f.material_index = idx
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x + loop.vert.co.y, loop.vert.co.z)
bmesh.ops.recalc_face_normals(bm, faces=faces)
build(b, "Studio bass trap", q03)

PANELS = [  # (lo, hi, fabric): fabric-wrapped panels, 5 cm deep, on the walls
    ((PX0 + 0.04, NORTH - PANEL_D, 1.3), (mid - 0.03, NORTH, 2.4), "panel petrol"),  # above the piano
    ((mid + 0.03, NORTH - PANEL_D, 1.3), (PX1 - 0.04, NORTH, 2.4), "panel charcoal"),
    ((WEST, SOUTH + TRAP + 0.06, 0.95), (WEST + PANEL_D, -0.25, 2.15), "panel rust"),  # clear of the light switch
    ((EAST - PANEL_D, PILLAR_Y + 0.02, 1.24), (EAST, -0.22, 1.94), "panel charcoal"),  # behind the desk
    ((EAST - PANEL_D, -0.17, 1.24), (EAST, 0.33, 1.94), "panel petrol"),
]
b = Builder()
for lo, hi, fabric in PANELS:
    b.box(lo, hi, M[fabric])
build(b, "Studio acoustic panels", q03)

b = Builder()
RX0, RX1, RY0, RY1 = WEST + 0.55, top[0][0] - 0.12, SOUTH + 0.22, BENCH_Y0 - 0.04
b.box((RX0, RY0, 0.0), (RX1, RY1, 0.006), M["rug border"])
b.box((RX0 + 0.06, RY0 + 0.06, 0.0), (RX1 - 0.06, RY1 - 0.06, 0.008), M["rug"])
build(b, "Studio rug", q03)
report.append(f"rug x {RX0:.2f}..{RX1:.2f}, y {RY0:.2f}..{RY1:.2f}")

scene[MARK] = VERSION
print("\n".join(f"[studio] {r}" for r in report))
if "--save" in sys.argv:
    bpy.ops.wm.save_mainfile()
