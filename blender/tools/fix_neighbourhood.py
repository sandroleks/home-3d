"""One-off: move the neighbourhood 7.44 m along -X so the flat sits where it really is.

The flat is the unit whose balcony end meets the bend of the south-east facade (checked against satellite imagery;
docs/superpowers/specs/2026-10-23-sun-simulation-design.md). Run once, in the Blender session that has
~/Documents/Untitled.blend open, then save. Refuses to run twice.
"""
import bmesh
import bpy
from mathutils import Matrix, Vector

SHIFT = -7.44
KEEP = {f"Building lower facade {s}" for s in "NSEW"}  # directly under the flat: they stay
BLOCK = "Exterior block brick"  # the rest of the building at the flat's level, with a gap for the flat
MARK = "site_shift_x"

top = bpy.data.collections["Exterior - neighbourhood"]
if top.get(MARK) is not None:
    raise RuntimeError(f"already applied: {top[MARK]} m")
objs = {o for c in [top, *top.children_recursive] for o in c.objects}
block = bpy.data.objects[BLOCK]
mw = block.matrix_world
if any(abs(mw[i][j] - (1.0 if i == j else 0.0)) > 1e-6 for i in range(4) for j in range(4)):
    raise RuntimeError(f"{BLOCK} is expected to sit at the origin with no rotation or scale")

move = Matrix.Translation(Vector((SHIFT, 0.0, 0.0)))
moved = 0
for o in objs:
    if o.name in KEEP or o.name == BLOCK or o.parent in objs:  # children follow their parent
        continue
    o.matrix_world = move @ o.matrix_world
    moved += 1
bm = bmesh.new()
bm.from_mesh(block.data)
for v in bm.verts:
    v.co.x += SHIFT
    if abs(v.co.x - (-3.6 + SHIFT)) < 0.02:  # the gap's -X side follows the flat back to x = -3.6
        v.co.x = -3.6
    elif abs(v.co.x - (3.6 + SHIFT)) < 0.02:  # and its +X side to x = 3.6
        v.co.x = 3.6
# The old front piece between the gap and the bend collapses to a sliver a few mm wide (the bend sat at x = 11.044).
degenerate = [f for f in bm.faces if f.calc_area() < 0.1]
bmesh.ops.delete(bm, geom=degenerate, context="FACES")
bm.to_mesh(block.data)
bm.free()
block.data.update()
top[MARK] = SHIFT
xs = sorted({round(v.co.x, 2) for v in block.data.vertices})
print(f"moved {moved} objects; {BLOCK} x values now {xs}; removed {len(degenerate)} face(s)")
