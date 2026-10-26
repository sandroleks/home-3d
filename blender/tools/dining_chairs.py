"""One-off: the six dining chairs become Poly Haven's "Dining Chair 02" (CC0, polyhaven.com/a/dining_chair_02).

Download the glTF (1k textures) into a folder and pass it; the textures are packed into the .blend:
    blender -b Untitled.blend --python blender/tools/dining_chairs.py -- <folder>/dining_chair_02_1k.gltf --save
Replaces the chairs home_fixes.py made (`Dining chair N0`..`S2`), and gives its table the oak grain it lacked.
"""
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
gltf = next(a for a in args if a.endswith(".gltf"))
scene = bpy.context.scene
scene.frame_set(scene.frame_end)

table = bpy.data.objects["Dining table"]
table["grain_stretch"] = (-0.98, 0.0, 0.0)  # the Oak material's grain runs along the table, as on the other oak tops
sala = table.users_collection[0]
co = np.array([table.matrix_world @ v.co for v in table.data.vertices])
CX, CY = (co[:, 0].min() + co[:, 0].max()) / 2, (co[:, 1].min() + co[:, 1].max()) / 2
HALF_W = (co[:, 1].max() - co[:, 1].min()) / 2

for o in [o for o in bpy.data.objects if o.name.startswith("Dining chair")]:
    bpy.data.objects.remove(o, do_unlink=True)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=gltf)
parts = [o for o in bpy.data.objects if o not in before]
meshes = [o for o in parts if o.type == "MESH"]
for o in meshes:  # bake each part's own transform into its mesh, then join them into one chair
    o.data = o.data.copy()
    o.data.transform(o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix()
for o in parts:
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
for o in meshes:
    for c in list(o.users_collection):
        c.objects.unlink(o)
    sala.objects.link(o)
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
model = bpy.context.view_layer.objects.active
model.name = "Dining chair model"

# Stand it on the floor, centred on its seat, with the back toward -y (so its front looks +y).
v = np.array([vv.co[:] for vv in model.data.vertices])
lo, hi = v.min(0), v.max(0)
tall = v[v[:, 2] > lo[2] + 0.75 * (hi[2] - lo[2])]  # the top of the back
back_y = tall[:, 1].mean() - (lo[1] + hi[1]) / 2
back_x = tall[:, 0].mean() - (lo[0] + hi[0]) / 2
turn = math.atan2(back_y, back_x) - (-math.pi / 2)  # how far the back is from pointing to -y
centre = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]))
model.data.transform(Matrix.Rotation(-turn, 4, "Z") @ Matrix.Translation(-centre))
v = np.array([vv.co[:] for vv in model.data.vertices])
lo, hi = v.min(0), v.max(0)
print(f"[chairs] model {hi[0] - lo[0]:.3f} x {hi[1] - lo[1]:.3f} x {hi[2] - lo[2]:.3f} m, {len(model.data.polygons)} faces")
depth = hi[1] - lo[1]

bpy.ops.file.pack_all()

# Three a side, the seat's front edge just under the table's edge, facing it.
for i, dx in enumerate((-0.55, 0.0, 0.55)):
    for side, sy in (("N", 1), ("S", -1)):
        chair = model.copy()
        chair.data = model.data.copy()
        chair.name = f"Dining chair {side}{i}"
        sala.objects.link(chair)
        # front looks +y; north chairs look south (-y) at the table: turn them half round
        rot = Matrix.Rotation(math.pi if sy > 0 else 0.0, 4, "Z")
        y = CY + sy * (HALF_W + depth / 2 - 0.08)
        chair.matrix_world = Matrix.Translation((CX + dx, y, 0.0)) @ rot
bpy.data.objects.remove(model, do_unlink=True)

if "--save" in args:
    bpy.ops.wm.save_mainfile()
