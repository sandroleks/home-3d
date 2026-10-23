# Apartment Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Blender apartment (`Untitled.blend` in the project root, a copy of `/Users/sandrolek/Documents/Untitled.blend`) into a desktop website where visitors walk through it in first person, with baked Cycles lighting, doors that open, and per-room light switches.

**Architecture:** A headless Blender Python pipeline (`blender/`) copies the file, merges geometry into one chunk per room, bakes procedural materials and two lighting layers (daylight plus each room's ceiling light) with Cycles, builds a 2D collision grid, and exports `apartment.glb` + RGBM WebP lightmaps + `manifest.json` + `collision.json`. A Vite + TypeScript + three.js site (`web/`) loads those assets, patches `MeshStandardMaterial` to add `day + intensity × roomLight`, and runs a pointer-lock first-person controller with door and light interactions.

**Tech Stack:** Blender 5.1.1 (Cycles on Metal, bundled Python + numpy, `unittest`), three.js 0.170.0, three-mesh-bvh 0.8.3, Vite 8.3.4, TypeScript 5.6.3, Vitest 5.0.3, Node 22.

## Global Constraints

- Never launch Blender directly on files in this project (it lives in `~/Documents`). Always go through the Makefile targets (`test-blender`, `export-preview`, `export-final`, `render-refs`), which run Blender on a staged copy in `/private/tmp/apartment-walkthrough-blender` with `HOME` redirected. When a Blender launched from Claude touches `~/Documents`, macOS blocks the whole session's file access.
- Never modify the source file `Untitled.blend` (project root). The pipeline's first action is `save_as_mainfile` to `build/web-export.blend`. The pipeline reads the project-root copy so the project is self-contained. Re-copy it after editing the original in Blender. `*.blend` files are git-ignored.
- The exported variant is exactly the current render state (open kitchen, existing WCs, sofa bed closed), plus the `Ceiling*` collections.
- Desktop only. Phones and tablets with only a touch pointer see: "Best viewed on desktop. This walkthrough needs a keyboard and mouse."
- Visitors can only open/close the 9 interior doors and switch the 12 rooms' ceiling lights. (Door leaf 5 sits in the infilled doorway 20 and is removed.) No hotspots, minimap or variant toggles.
- Coordinates: every value in `manifest.json` and `collision.json` is three.js space (Y up, metres). A Blender point `(x, y, z)` maps to `(x, z, -y)`. A rotation about Blender +Z by φ equals a rotation about three.js +Y by φ.
- First-view download (glb + collision.json + manifest.json + all `*_day.webp`) must be ≤ 30 MB (`30 * 1024 * 1024` bytes).
- Eye height is 1.6 m. Door swing takes 0.6 s (ease-in-out). Light fade takes 0.4 s.
- The starting state is the Entrada (from `Cam_Entrada`), all doors closed, daylight, all ceiling lights off.
- Lightmap UVs live in UV map `UVLightmap` at index 1 (`TEXCOORD_1` / three.js attribute `uv1`). Index 0 is always `UVMap`.
- Lightmaps are RGBM in 8-bit lossless WebP: `rgb_linear = rgb * a * range`, with `range` stored per file in the manifest.
- Commit after each task. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions Made During Planning (amend the spec)

These came out of probing the real file and Blender 5.1. Task 1 records them in the spec.

1. **Procedural materials** are all driven by world position (`Geometry → Position`) with non-repeating noise, so each object using one gets its own baked albedo texture (256 px/m, capped at 2048²) rather than a tileable one.
2. **Collision** is a 2D occupancy grid (5 cm cells, player radius 0.2 m) plus door segments, instead of `collision.glb` with a capsule. The apartment is a single flat floor, so this is simpler and cannot fall through anything. three-mesh-bvh is still used, for interaction raycasts. "Falling through geometry" becomes "if the player ends up in a blocked cell, move them to the nearest free cell".
3. **Glazed doors** (Cozinha↔Lavandaria, Lavandaria↔Marquise, Quarto 02↔Varanda) are fixed glass, so their glass, mullions and rails don't block movement. Otherwise those rooms would be unreachable.
4. **Light switches** are separate, slightly emissive meshes that aren't baked into the room lightmap.
5. **Door leaves** get a daylight lightmap only, baked closed.
6. **Emissive materials** (LED, Linen shade, Mirror LED, Screen, Wall light shade) are muted during room-light bakes so their glow isn't counted twice.
7. **Denoising:** 512 samples plus a masked Gaussian blur (σ = 1 px), not OIDN. The Blender 5 compositor can't easily denoise a bake image.
8. **Highlighting:** the hovered object gets an emissive tint, not an outline.
9. **Reflections** come from three.js `RoomEnvironment` at intensity 0.2, not a sky-derived map.
10. **Manifest:** the room floor is a flat triangle list `[x0,z0,x1,z1,x2,z2,…]`, and there's no "light colour" field because colour is already in the bake.
11. **Chunking** first cuts large faces (ceiling, slab, walls) on a 25 cm grid, and assigns faces over interior walls to the nearest room within 0.2 m. Otherwise one big ceiling face could land in a single room's chunk and light up with the wrong switch.


## Amendments from the first real export (Task 12, 2026-10-22)

The first run on the real file found that the model differs from the plan's assumptions. The user decided points 2 and 3.

12. **Doors are modelled open.** All 10 leaves stand at 90° in the room they open into, not closed in their doorway. `doors.prepare_doors` now matches each leaf to the opening whose jamb end is nearest one of the leaf's ends (within 0.25 m). That leaf end is the hinge, and the closed direction runs from the hinge along the opening toward its other jamb. `openAngle` is the signed `rot_y` angle from the closed direction to the modelled (open) direction, so the user's own open pose is the open state. The leaf mesh is rotated about the hinge into the closed pose before the bake, so doors are baked closed and visitors start with closed doors. `geom.choose_door_swing` and `DOOR_OVERRIDES` remain only as a fallback for a leaf that matches no opening.
13. **Door leaf 5 is removed.** It belongs to opening 20 (Cozinha / Entrada), which the open-kitchen layout fills in ("Door 20 infill"). A leaf whose matched opening is infilled is deleted from the export. `EXPECTED_DOOR_COUNT` is 9.
14. **Switches may sit outside the room.** The Closet and Lavandaria have no free wall inside their doorways, so `SWITCH_OVERRIDES` gains `"face": "outside"`, which puts the switch on the other room's face of that opening. Closet: in the Entrada beside opening 18. Lavandaria: on the Marquise side of glazed door 26.
15. **Exports run with `--factory-startup`.** The user's own add-ons (e.g. BlenderGIS, which downloaded a library during a run) must not load during exports or reference renders. Cycles is enabled in factory settings.

16. **Sky behind the windows.** The web scene's background is a flat daylight sky colour (`CONFIG.skyColor`, `#cfdbe6`), so windows don't show black. **Reference renders use the finished frame**, i.e. `render-refs` sets the scene to `frame_end` before rendering.

---

## File Structure

```
Makefile                             # test/export shortcuts
.gitignore
shared/fixtures/rle.json             # RLE cases shared by Python and TS tests
blender/
  export_web.py                      # CLI entry: parses args, calls pipeline.run
  pipeline/
    __init__.py
    config.py                        # quality presets, constants, override tables
    geom.py                          # pure: coordinate maps, FloorIndex, principal_frame, door swing choice, camera yaw/pitch
    raster.py                        # pure numpy: texture sizing, RGBM, masked blur, dilate, RLE
    placement.py                     # pure: light switch spot selection
    manifest.py                      # pure: manifest assembly + validation
    state.py                         # pipeline state stored on the scene as JSON
    bpyutil.py                       # bpy helpers: selection, joins, splits, cycles setup
    scene_select.py                  # pick render-visible meshes, realize, collections
    rooms.py                         # Floor - <room> → rooms + FloorIndex
    proc_materials.py                # bake procedural albedo, rewire to image textures
    openings.py                      # parse "Door N (A / B) lintel" openings
    collision.py                     # Grid + build from BVH
    doors.py                         # hinge origins + swing direction
    switches.py                      # create switch meshes
    chunks.py                        # join + split into Room_<id> chunks
    uvs.py                           # UVLightmap generation
    bake.py                          # Lighting states, lightmap bakes, RGBM WebP
    export.py                        # camera poses, glb export, json writing
    checks.py                        # output self-checks
    debug_map.py                     # top-down PNG of grid/doors/switches/spawn
    run.py                           # stage orchestration (prepare, bake, export)
  tests/
    __init__.py
    run.py                           # unittest runner inside Blender
    fixture_scene.py                 # tiny two-room apartment
    test_geom.py  test_raster.py  test_placement.py  test_manifest.py
    test_scene_select.py  test_proc_materials.py  test_collision.py
    test_doors.py  test_switches.py  test_chunks.py  test_uvs.py
    test_bake.py  test_end_to_end.py
web/
  package.json  tsconfig.json  vite.config.ts  index.html
  scripts/copy-draco.mjs
  src/
    config.ts  manifest.ts  rle.ts  rgbm.ts  lightmaps.ts  collision.ts
    doors.ts  rooms.ts  player.ts  interactions.ts  scene-setup.ts
    loader.ts  world.ts  ui.ts  main.ts  style.css
  tests/
    fixtures.ts  manifest.test.ts  rle.test.ts  rgbm.test.ts  lightmaps.test.ts
    collision.test.ts  doors.test.ts  rooms.test.ts  player.test.ts
    interactions.test.ts  scene-setup.test.ts  ui.test.ts
.claude/launch.json                  # dev server for the in-app browser
```

---

### Task 1: Blender test harness and geometry helpers

**Files:**
- Create: `Makefile`, `blender/pipeline/__init__.py`, `blender/pipeline/geom.py`, `blender/tests/__init__.py`, `blender/tests/run.py`, `blender/tests/test_geom.py`
- Modify: `.gitignore`, `docs/superpowers/specs/2026-10-22-apartment-walkthrough-design.md` (append amendments)

**Interfaces:**
- Produces: `geom.to_three(p)`, `geom.to_three_xz(x, y)`, `geom.from_three_xz(x, z)`, `geom.slugify(name)`, `geom.rot_y((x, z), phi)`, `geom.FloorIndex(rooms: dict[str, list[float]])` with `.ids`, `.locate_many(pts, max_dist=0.0) -> np.ndarray[int]` (-1 = none; with `max_dist > 0`, points outside every floor go to the nearest floor within that distance), `.locate(x, z) -> str | None`, `.bounds() -> (x0, z0, x1, z1)`, `geom.principal_frame(points_xz) -> (center, u, n, extent_u, extent_n)` (u canonicalised to point +x, or +z when vertical), `geom.choose_door_swing(end_a, end_b, is_blocked, override=None) -> dict(hinge, dir, width, sign, hinge_end)`, `geom.yaw_pitch_from_forward((fx, fy, fz)) -> (yaw, pitch)`.
- Produces: `make test-blender [TESTS=test_x.py]`, which runs `unittest` inside Blender and exits non-zero on failure.

- [ ] **Step 1: Record the planning decisions in the spec**

Append this section to the end of `docs/superpowers/specs/2026-10-22-apartment-walkthrough-design.md`:

```markdown
## Amendments from implementation planning (2026-10-22)

1. Procedural materials are baked per object (non-tiling, 256 px/m, max 2048²) because their patterns are world-position driven and non-repeating.
2. Collision is a 2D occupancy grid (5 cm cells, player radius 0.2 m) exported as `collision.json`, plus door leaf segments at runtime. `collision.glb` and the capsule are dropped; three-mesh-bvh is used only for interaction raycasts. A player in a blocked cell is moved to the nearest free cell.
3. Glazed doors are fixed glass, so their glass, mullions and rails don't block movement. This keeps Lavandaria, Marquise and Varanda reachable.
4. Light switches are separate emissive meshes, not part of the room bake.
5. Door leaves get a daylight lightmap only, baked closed.
6. Emissive materials are muted during room-light bakes.
7. Denoising uses 512 samples plus a masked Gaussian blur (σ = 1 px) instead of OIDN.
8. Hover highlighting is an emissive tint, not an outline.
9. Reflections come from three.js `RoomEnvironment` at intensity 0.2.
10. In the manifest, the room floor is a triangle list and there is no light colour field.
11. Before splitting into room chunks, meshes with large faces (ceiling, slab, walls) are cut on a 25 cm grid, and faces over interior walls join the nearest room within 0.2 m. That way no ceiling face lights up with the wrong room's switch.
```

- [ ] **Step 2: Add ignores and the Makefile**

Replace `.gitignore` with:

```gitignore
build/
node_modules/
web/dist/
web/public/assets/
web/public/draco/
.DS_Store
__pycache__/
*.blend
*.blend1
```

Create `Makefile` (recipe lines are indented with a tab):

```make
BLENDER ?= /Applications/Blender.app/Contents/MacOS/Blender
SOURCE ?= Untitled.blend
OUT := web/public/assets
BUILD := build
# Blender must never touch ~/Documents: when a Blender launched from Claude reaches into it,
# macOS blocks the whole session's file access. Code and the .blend are copied to STAGE,
# Blender runs there with HOME redirected, and outputs are copied back.
STAGE := /private/tmp/apartment-walkthrough-blender
SYNC = mkdir -p $(STAGE)/home && rsync -a --delete blender $(wildcard shared) $(STAGE)/
IN_STAGE = cd $(STAGE) && HOME=$(STAGE)/home "$(BLENDER)"

.PHONY: test-blender export-preview export-final render-refs web-test

test-blender:
	$(SYNC)
	$(IN_STAGE) -b --factory-startup --python-exit-code 1 --python blender/tests/run.py -- $(TESTS)

export-preview export-final: export-%:
	$(SYNC) && cp "$(SOURCE)" $(STAGE)/source.blend && rm -rf $(STAGE)/out
	$(IN_STAGE) -b --factory-startup source.blend --python-exit-code 1 --python blender/export_web.py -- --quality $* --out out/assets --build out/build
	mkdir -p $(OUT) $(BUILD) && rsync -a --delete $(STAGE)/out/assets/ $(OUT)/ && rsync -a $(STAGE)/out/build/ $(BUILD)/

render-refs:
	$(SYNC) && cp "$(SOURCE)" $(STAGE)/source.blend && mkdir -p $(STAGE)/ref
	for cam in Cam_Sala Cam_Kitchen Cam_Bedroom; do $(IN_STAGE) -b --factory-startup source.blend --python-expr "import bpy; s=bpy.context.scene; s.camera=bpy.data.objects['$$cam']; s.render.resolution_percentage=50; s.render.filepath='$(STAGE)/ref/$$cam'" -f 1 || exit 1; done
	mkdir -p $(BUILD)/ref && rsync -a $(STAGE)/ref/ $(BUILD)/ref/

web-test:
	cd web && npm test
```

- [ ] **Step 3: Create the test runner**

`blender/pipeline/__init__.py` and `blender/tests/__init__.py` are empty files.

`blender/tests/run.py`:

```python
"""Run the pipeline's unittest suite inside Blender.

    blender -b --factory-startup --python-exit-code 1 --python blender/tests/run.py -- [pattern]
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # blender/
sys.path.insert(0, ROOT)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
pattern = argv[0] if argv else "test_*.py"
suite = unittest.defaultTestLoader.discover(HERE, pattern=pattern, top_level_dir=ROOT)
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
```

- [ ] **Step 4: Write the failing tests**

`blender/tests/test_geom.py`:

```python
import math
import unittest

from pipeline import geom


class CoordinateTests(unittest.TestCase):
    def test_to_three_maps_blender_z_up_to_y_up(self):
        self.assertEqual(geom.to_three((1.0, 2.0, 3.0)), (1.0, 3.0, -2.0))

    def test_ground_plane_round_trip(self):
        self.assertEqual(geom.from_three_xz(*geom.to_three_xz(4.0, -5.0)), (4.0, -5.0))

    def test_slugify(self):
        self.assertEqual(geom.slugify("Quarto 01"), "quarto-01")
        self.assertEqual(geom.slugify("WC 02"), "wc-02")

    def test_rot_y_matches_blender_z_rotation(self):
        # Blender (1, 0) rotated +90° about Z is (0, 1); in three.js xz that is (0, -1).
        x, z = geom.rot_y((1.0, 0.0), math.pi / 2)
        self.assertAlmostEqual(x, 0.0)
        self.assertAlmostEqual(z, -1.0)


class FloorIndexTests(unittest.TestCase):
    def setUp(self):
        square = lambda x0, z0, x1, z1: [x0, z0, x1, z0, x1, z1, x0, z0, x1, z1, x0, z1]
        self.index = geom.FloorIndex({"a": square(0, 0, 1, 1), "b": square(2, 0, 3, 1)})

    def test_locate(self):
        self.assertEqual(self.index.locate(0.5, 0.5), "a")
        self.assertEqual(self.index.locate(2.5, 0.2), "b")
        self.assertIsNone(self.index.locate(1.5, 0.5))

    def test_locate_many(self):
        self.assertEqual(self.index.locate_many([(0.5, 0.5), (2.5, 0.5), (9, 9)]).tolist(), [0, 1, -1])

    def test_nearest_floor_within_max_dist(self):
        pts = [(1.1, 0.5), (1.5, 0.5), (1.85, 0.5)]
        self.assertEqual(self.index.locate_many(pts).tolist(), [-1, -1, -1])
        self.assertEqual(self.index.locate_many(pts, max_dist=0.2).tolist(), [0, -1, 1])

    def test_degenerate_triangles_are_ignored(self):
        index = geom.FloorIndex({"flat": [0, 0, 1, 1, 2, 2]})
        self.assertIsNone(index.locate(5.0, -3.0))

    def test_bounds(self):
        self.assertEqual(self.index.bounds(), (0.0, 0.0, 3.0, 1.0))


class PrincipalFrameTests(unittest.TestCase):
    def test_rotated_rectangle(self):
        a = math.radians(30)
        u = (math.cos(a), math.sin(a))
        n = (-u[1], u[0])
        pts = [(2 + su * 0.385 * u[0] + sn * 0.06 * n[0], 1 + su * 0.385 * u[1] + sn * 0.06 * n[1])
               for su in (-1, 1) for sn in (-1, 1)]
        c, uu, nn, wu, wn = geom.principal_frame(pts)
        self.assertAlmostEqual(c[0], 2.0)
        self.assertAlmostEqual(c[1], 1.0)
        self.assertAlmostEqual(wu, 0.77)
        self.assertAlmostEqual(wn, 0.12)
        self.assertAlmostEqual(abs(uu[0] * u[0] + uu[1] * u[1]), 1.0)
        self.assertGreater(uu[0], 0)

    def test_vertical_axis_points_plus_z(self):
        pts = [(0, 0), (0.1, 0), (0, 2), (0.1, 2)]
        _, u, n, wu, wn = geom.principal_frame(pts)
        self.assertAlmostEqual(u[0], 0.0)
        self.assertAlmostEqual(u[1], 1.0)
        self.assertAlmostEqual(n[0], -1.0)


def corner_room(x, z):
    """Wall along x with a doorway at x 0..0.8, a side wall at x≈-0.1 on +z, a wardrobe on -z."""
    if -0.05 <= z <= 0.05 and not (0.0 <= x <= 0.8):
        return True
    if -0.15 <= x <= -0.05 and 0.0 <= z <= 3.0:
        return True
    if 0.0 <= x <= 1.0 and -1.0 <= z <= -0.1:
        return True
    return False


class DoorSwingTests(unittest.TestCase):
    def test_swings_away_from_furniture_and_rests_against_side_wall(self):
        c = geom.choose_door_swing((0.0, 0.0), (0.8, 0.0), corner_room)
        self.assertEqual(c["hinge_end"], "a")
        self.assertEqual(c["sign"], -1)
        self.assertAlmostEqual(c["width"], 0.8)
        self.assertEqual(c["dir"], (1.0, 0.0))

    def test_override_forces_hinge(self):
        c = geom.choose_door_swing((0.0, 0.0), (0.8, 0.0), corner_room, {"hinge": "b"})
        self.assertEqual(c["hinge"], (0.8, 0.0))
        self.assertEqual(c["sign"], 1)

    def test_impossible_override_raises(self):
        with self.assertRaises(ValueError):
            geom.choose_door_swing((0.0, 0.0), (0.8, 0.0), corner_room, {"hinge": "c"})


class CameraTests(unittest.TestCase):
    def test_yaw_pitch(self):
        self.assertEqual(geom.yaw_pitch_from_forward((0.0, 0.0, -1.0)), (0.0, 0.0))
        yaw, pitch = geom.yaw_pitch_from_forward((-1.0, 0.0, 0.0))
        self.assertAlmostEqual(yaw, math.pi / 2)
        yaw, pitch = geom.yaw_pitch_from_forward((0.0, 1.0, 0.0))
        self.assertAlmostEqual(pitch, math.pi / 2)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `make test-blender TESTS=test_geom.py`
Expected: FAIL with `ImportError: cannot import name 'geom'`

- [ ] **Step 6: Implement `geom.py`**

`blender/pipeline/geom.py`:

```python
"""Pure geometry helpers for the export pipeline (no bpy).

The web app works in three.js space (Y up). A Blender point (x, y, z) becomes
(x, z, -y). Ground-plane values here are three.js (x, z) unless named otherwise.
"""
import math
import re

import numpy as np


def to_three(p):
    x, y, z = p
    return (x, z, -y)


def to_three_xz(x, y):
    return (x, -y)


def from_three_xz(x, z):
    return (x, -z)


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def rot_y(v, phi):
    """Rotate a ground-plane vector (x, z) about +Y by phi radians."""
    x, z = v
    c, s = math.cos(phi), math.sin(phi)
    return (x * c + z * s, -x * s + z * c)


def _edge(p, a, b):
    return (p[:, 0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[:, 1] - b[1])


def _segment_distance(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(float(ab @ ab), 1e-12), 0.0, 1.0)
    q = a + t[:, None] * ab
    return np.hypot(p[:, 0] - q[:, 0], p[:, 1] - q[:, 1])


class FloorIndex:
    """Find which room's floor triangles contain a ground-plane point."""

    def __init__(self, rooms):
        """rooms: dict room_id -> flat [x0, z0, x1, z1, x2, z2, ...] triangle list."""
        self.ids = list(rooms)
        tris, owner = [], []
        for k, rid in enumerate(self.ids):
            for t in np.asarray(rooms[rid], dtype=np.float64).reshape(-1, 3, 2):
                area = (t[1, 0] - t[0, 0]) * (t[2, 1] - t[0, 1]) - (t[2, 0] - t[0, 0]) * (t[1, 1] - t[0, 1])
                if abs(area) > 1e-9:
                    tris.append(t)
                    owner.append(k)
        self.tris = np.asarray(tris, dtype=np.float64).reshape(-1, 3, 2)
        self.owner = np.asarray(owner, dtype=np.int64)

    def locate_many(self, pts, max_dist=0.0):
        pts = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
        out = np.full(len(pts), -1, dtype=np.int64)
        for t, k in zip(self.tris, self.owner):
            d1, d2, d3 = _edge(pts, t[0], t[1]), _edge(pts, t[1], t[2]), _edge(pts, t[2], t[0])
            neg = (d1 < -1e-12) | (d2 < -1e-12) | (d3 < -1e-12)
            pos = (d1 > 1e-12) | (d2 > 1e-12) | (d3 > 1e-12)
            out[~(neg & pos) & (out < 0)] = k
        rest = np.flatnonzero(out < 0)
        if max_dist > 0 and rest.size:
            p = pts[rest]
            best = np.full(rest.size, np.inf)
            owner = np.full(rest.size, -1, dtype=np.int64)
            for t, k in zip(self.tris, self.owner):
                for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                    d = _segment_distance(p, a, b)
                    better = d < best
                    best[better] = d[better]
                    owner[better] = k
            hit = best <= max_dist
            out[rest[hit]] = owner[hit]
        return out

    def locate(self, x, z):
        k = int(self.locate_many([(x, z)])[0])
        return None if k < 0 else self.ids[k]

    def bounds(self):
        flat = self.tris.reshape(-1, 2)
        return (float(flat[:, 0].min()), float(flat[:, 1].min()), float(flat[:, 0].max()), float(flat[:, 1].max()))


def principal_frame(points_xz):
    """Oriented bounding rectangle of ground-plane points.

    Returns (center, u, n, extent_u, extent_n): u is the long axis, made to point
    +x (or +z when vertical) so results are deterministic; n = (-u.z, u.x).
    """
    p = np.asarray(points_xz, dtype=np.float64).reshape(-1, 2)
    c = (p.min(0) + p.max(0)) / 2
    w, v = np.linalg.eigh(np.cov((p - c).T))
    u = v[:, int(np.argmax(w))]
    if u[0] < -1e-9 or (abs(u[0]) <= 1e-9 and u[1] < 0):
        u = -u
    n = np.array([-u[1], u[0]])
    pu, pn = (p - c) @ u, (p - c) @ n
    c = c + u * (pu.max() + pu.min()) / 2 + n * (pn.max() + pn.min()) / 2
    return (
        (float(c[0]), float(c[1])),
        (float(u[0]), float(u[1])),
        (float(n[0]), float(n[1])),
        float(pu.max() - pu.min()),
        float(pn.max() - pn.min()),
    )


def choose_door_swing(end_a, end_b, is_blocked, override=None):
    """Pick the hinge end and swing direction for a closed door leaf.

    end_a, end_b: the leaf's two ends on the ground plane.
    is_blocked(x, z): raw occupancy (walls and furniture, not inflated).
    override: optional {"hinge": "a" | "b", "sign": 1 | -1}.
    Prefers the fewest blocked samples in the swept quarter circle, then the most
    blocked samples just behind the open leaf (it should rest against a wall).
    """
    best = None
    for name, hinge, free in (("a", end_a, end_b), ("b", end_b, end_a)):
        dx, dz = free[0] - hinge[0], free[1] - hinge[1]
        width = math.hypot(dx, dz)
        d = (dx / width, dz / width)
        for sign in (1, -1):
            if override and (override.get("hinge", name) != name or override.get("sign", sign) != sign):
                continue
            sweep = 0
            for k in range(1, 10):
                vx, vz = rot_y(d, sign * (math.pi / 2) * k / 9)
                for f in (0.35, 0.65, 0.95):
                    if is_blocked(hinge[0] + vx * width * f, hinge[1] + vz * width * f):
                        sweep += 1
            ox, oz = rot_y(d, sign * math.pi / 2)
            hug = sum(
                1
                for f in (0.25, 0.5, 0.75, 1.0)
                if is_blocked(hinge[0] + ox * width * f - d[0] * 0.12, hinge[1] + oz * width * f - d[1] * 0.12)
            )
            key = (sweep, -hug)
            if best is None or key < best[0]:
                best = (key, dict(hinge=tuple(hinge), dir=d, width=width, sign=sign, hinge_end=name))
    if best is None:
        raise ValueError(f"door override {override} matches no hinge/sign combination")
    return best[1]


def yaw_pitch_from_forward(f):
    """three.js camera yaw/pitch (rotation order YXZ) for a forward vector."""
    fx, fy, fz = f
    return (math.atan2(-fx, -fz), math.asin(max(-1.0, min(1.0, fy))))
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `make test-blender TESTS=test_geom.py`
Expected: PASS, 15 tests, `OK`

- [ ] **Step 8: Commit**

```bash
git add Makefile .gitignore blender docs/superpowers/specs
git commit -m "Add Blender test harness and geometry helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Raster helpers and the shared RLE fixture

**Files:**
- Create: `blender/pipeline/raster.py`, `blender/tests/test_raster.py`, `shared/fixtures/rle.json`

**Interfaces:**
- Produces: `raster.texture_size_for_area(area_m2, texels_per_m, lo, hi) -> int` (power of two in [lo, hi]), `raster.rgbm_encode(rgb, mask=None, max_range=64.0) -> (rgba float32 (h,w,4), range float)`, `raster.rgbm_decode(rgba, range)`, `raster.masked_blur(rgb, mask, sigma) -> float32`, `raster.dilate(mask, radius_cells) -> bool`, `raster.rle_encode(flags) -> list[int]` (runs alternate, starting with a run of 0/False), `raster.rle_decode(runs, n) -> np.ndarray[bool]`.

- [ ] **Step 1: Write the shared fixture**

`shared/fixtures/rle.json`:

```json
{
  "cases": [
    { "data": [0, 0, 1, 1, 1, 0, 1, 1, 0, 0], "runs": [2, 3, 1, 2, 2] },
    { "data": [1, 1, 0], "runs": [0, 2, 1] },
    { "data": [0, 0, 0], "runs": [3] }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`blender/tests/test_raster.py`:

```python
import json
import os
import unittest

import numpy as np

from pipeline import raster

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "..", "shared", "fixtures", "rle.json")


class TextureSizeTests(unittest.TestCase):
    def test_powers_of_two_within_bounds(self):
        self.assertEqual(raster.texture_size_for_area(1.0, 256, 64, 2048), 256)
        self.assertEqual(raster.texture_size_for_area(150.0, 100, 512, 2048), 2048)
        self.assertEqual(raster.texture_size_for_area(0.0, 100, 512, 2048), 512)
        self.assertEqual(raster.texture_size_for_area(10000.0, 100, 512, 2048), 2048)


class RgbmTests(unittest.TestCase):
    def test_round_trip_error_relative_to_pixel_peak(self):
        # RGBM shares one multiplier per pixel, so every channel's error scales with the
        # pixel's brightest channel, not with the channel itself.
        rng = np.random.default_rng(3)
        rgb = rng.uniform(0.05, 6.0, (32, 32, 3))
        rgba, r = raster.rgbm_encode(rgb)
        self.assertGreaterEqual(r, 6.0)
        back = raster.rgbm_decode(rgba, r)
        peak = np.maximum(rgb.max(axis=-1, keepdims=True), 0.05 * r)
        self.assertLess((np.abs(back - rgb) / peak).max(), 0.01)

    def test_masked_pixels_are_zero_and_range_ignores_them(self):
        rgb = np.full((4, 4, 3), 2.0)
        rgb[0, 0] = 500.0
        mask = np.ones((4, 4), bool)
        mask[0, 0] = False
        rgba, r = raster.rgbm_encode(rgb, mask)
        self.assertEqual(r, 2.0)
        self.assertTrue(np.all(rgba[0, 0] == 0))

    def test_range_is_at_least_one(self):
        _, r = raster.rgbm_encode(np.full((2, 2, 3), 0.1))
        self.assertEqual(r, 1.0)


class BlurTests(unittest.TestCase):
    def test_constant_stays_constant(self):
        rgb = np.full((16, 16, 3), 0.7)
        out = raster.masked_blur(rgb, np.ones((16, 16), bool), 1.0)
        np.testing.assert_allclose(out, 0.7, atol=1e-5)

    def test_masked_out_values_do_not_leak(self):
        rgb = np.full((16, 16, 3), 1.0)
        mask = np.ones((16, 16), bool)
        mask[:, 8:] = False
        rgb[:, 8:] = 100.0
        out = raster.masked_blur(rgb, mask, 1.5)
        np.testing.assert_allclose(out[:, :8], 1.0, atol=1e-5)


class DilateTests(unittest.TestCase):
    def test_disk(self):
        m = np.zeros((9, 9), bool)
        m[4, 4] = True
        self.assertEqual(int(raster.dilate(m, 2).sum()), 13)


class RleTests(unittest.TestCase):
    def test_shared_cases(self):
        with open(FIXTURE) as f:
            cases = json.load(f)["cases"]
        for case in cases:
            self.assertEqual(raster.rle_encode(case["data"]), case["runs"])
            self.assertEqual(raster.rle_decode(case["runs"], len(case["data"])).astype(int).tolist(), case["data"])

    def test_two_dimensional_is_row_major(self):
        grid = np.array([[0, 1], [1, 1]], bool)
        self.assertEqual(raster.rle_encode(grid), [1, 3])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `make test-blender TESTS=test_raster.py`
Expected: FAIL with `ImportError: cannot import name 'raster'`

- [ ] **Step 4: Implement `raster.py`**

`blender/pipeline/raster.py`:

```python
"""Pure numpy image/grid helpers (no bpy)."""
import math

import numpy as np


def texture_size_for_area(area_m2, texels_per_m, lo, hi):
    want = math.sqrt(max(area_m2, 0.0)) * texels_per_m
    size = lo
    while size < want and size < hi:
        size *= 2
    return min(size, hi)


def rgbm_encode(rgb, mask=None, max_range=64.0):
    """Encode linear HDR rgb (h, w, 3) as RGBM. Returns (rgba in [0, 1] on a 1/255 grid, range)."""
    rgb = np.clip(np.asarray(rgb, dtype=np.float64), 0.0, None)
    if mask is None:
        mask = np.ones(rgb.shape[:-1], dtype=bool)
    peak = rgb.max(axis=-1)
    valid = peak[mask]
    top = float(np.percentile(valid, 99.9)) if valid.size else 1.0
    rng = float(min(max(math.ceil(top * 2) / 2, 1.0), max_range))
    m = np.clip(peak / rng, 1.0 / 255.0, 1.0)
    m = np.ceil(m * 255.0) / 255.0
    enc = np.clip(rgb / (m[..., None] * rng), 0.0, 1.0)
    out = np.zeros(rgb.shape[:-1] + (4,), dtype=np.float32)
    out[..., :3] = np.round(enc * 255.0) / 255.0
    out[..., 3] = m
    out[~mask] = 0.0
    return out, rng


def rgbm_decode(rgba, rng):
    rgba = np.asarray(rgba, dtype=np.float64)
    return rgba[..., :3] * rgba[..., 3:4] * rng


def _shift(a, dy, dx):
    """out[y + dy, x + dx] = a[y, x], filling with zeros."""
    out = np.zeros_like(a)
    h, w = a.shape[:2]
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = a[ys, xs]
    return out


def masked_blur(rgb, mask, sigma):
    """Gaussian blur that only averages pixels where mask is True."""
    rgb = np.asarray(rgb, dtype=np.float64)
    if sigma <= 0:
        return rgb.astype(np.float32)
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    m = mask.astype(np.float64)
    num, den = rgb * m[..., None], m
    for axis in (0, 1):
        num_acc, den_acc = np.zeros_like(num), np.zeros_like(den)
        for i, wgt in zip(range(-r, r + 1), k):
            dy, dx = (i, 0) if axis == 0 else (0, i)
            num_acc += wgt * _shift(num, dy, dx)
            den_acc += wgt * _shift(den, dy, dx)
        num, den = num_acc, den_acc
    out = np.where(den[..., None] > 1e-6, num / np.maximum(den[..., None], 1e-6), 0.0)
    out[~mask] = 0.0
    return out.astype(np.float32)


def dilate(mask, radius_cells):
    out = mask.copy()
    r = int(radius_cells)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy * dy + dx * dx <= r * r:
                out |= _shift(mask, dy, dx)
    return out


def rle_encode(flags):
    """Run lengths of alternating values, starting with False (row-major)."""
    flags = np.asarray(flags).astype(bool).ravel()
    runs, current, count = [], False, 0
    for v in flags.tolist():
        if v == current:
            count += 1
        else:
            runs.append(count)
            current, count = v, 1
    runs.append(count)
    return runs


def rle_decode(runs, n):
    out = np.zeros(n, dtype=bool)
    pos, value = 0, False
    for run in runs:
        if value:
            out[pos:pos + run] = True
        pos += run
        value = not value
    if pos != n:
        raise ValueError(f"RLE covers {pos} cells, expected {n}")
    return out
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `make test-blender TESTS=test_raster.py`
Expected: PASS, 9 tests, `OK`

- [ ] **Step 6: Commit**

```bash
git add blender/pipeline/raster.py blender/tests/test_raster.py shared
git commit -m "Add raster helpers: texture sizing, RGBM, masked blur, dilate, RLE

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Fixture scene, config, scene selection and rooms

**Files:**
- Create: `blender/pipeline/config.py`, `blender/pipeline/state.py`, `blender/pipeline/bpyutil.py`, `blender/pipeline/scene_select.py`, `blender/pipeline/rooms.py`, `blender/tests/fixture_scene.py`, `blender/tests/test_scene_select.py`

**Interfaces:**
- Produces: `config.Quality` (fields `name, albedo_texels_per_m, albedo_max, lightmap_texels_per_m, lightmap_min, lightmap_max, door_lightmap, bake_samples, blur_sigma_px`), `config.QUALITY["test" | "preview" | "final"]`, plus the constants listed in the code below.
- Produces: `state.save(scene, dict)`, `state.load(scene) -> dict`.
- Produces: `bpyutil.select_only(objs, active=None)`, `bpyutil.world_coords(obj) -> (n,3)`, `bpyutil.polygon_vectors(me, attr) -> (n,3)`, `bpyutil.polygon_scalars(me, attr) -> (n,)`, `bpyutil.polygon_ints(me, attr) -> (n,)`, `bpyutil.set_cycles(scene, samples) -> device str`, `bpyutil.select_faces_in_edit(obj, mask)`, `bpyutil.join(objs, name) -> obj`, `bpyutil.split_by_face_values(obj, values, name_for) -> dict[int, obj]`.
- Produces: `scene_select.prepare_scene(scene, view_layer) -> (meshes: list[Object], day_lights: list[str])`. Afterwards every kept mesh is realized (modifiers applied, world transform baked in, no parent, identity matrix), linked only to collection `WEB`, and all lights are in `WEB_LIGHTS`.
- Produces: `rooms.collect_rooms(meshes, scene) -> (FloorIndex, list[{"id", "name", "floor", "light"}])`.
- Produces: `fixture_scene.build()`, a two-room scene described in the code below.

- [ ] **Step 1: Write the fixture scene**

`blender/tests/fixture_scene.py`:

```python
"""A tiny two-room apartment that follows the real file's naming conventions.

Blender coordinates (Z up). Alpha: x 0..3, y 0..3. Beta: x 3.2..6, y 0..3.
A 0.2 m wall at x 3.0..3.2 has an opening at y 1.0..1.8 with a door leaf.
"""
import math

import bmesh
import bpy
from mathutils import Vector


def _principled(mat):
    if mat.node_tree is None:
        mat.use_nodes = True
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def _mat_flat(name, rgb, roughness=0.8):
    mat = bpy.data.materials.new(name)
    bsdf = _principled(mat)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def _mat_procedural(name):
    mat = _mat_flat(name, (0.5, 0.5, 0.5))
    nt = mat.node_tree
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.inputs["Scale"].default_value = 2.0
    nt.links.new(geo.outputs["Position"], brick.inputs["Vector"])
    nt.links.new(brick.outputs["Color"], _principled(mat).inputs["Base Color"])
    return mat


def _mat_emissive(name):
    mat = _mat_flat(name, (1.0, 0.9, 0.7))
    bsdf = _principled(mat)
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.9, 0.7, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 2.0
    return mat


def _collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def box_object(name, boxes, material, collection):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for x0, y0, z0, x1, y1, z1 in boxes:
        verts = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        bmesh.ops.scale(bm, vec=Vector((x1 - x0, y1 - y0, z1 - z0)), verts=verts)
        bmesh.ops.translate(bm, vec=Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), verts=verts)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    collection.objects.link(obj)
    return obj


def _light(name, kind, location, energy, collection, size=None):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    if size is not None:
        data.size = size
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    collection.objects.link(obj)
    return obj


def _camera(name, location, rotation, collection):
    obj = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    obj.location = location
    obj.rotation_euler = rotation
    collection.objects.link(obj)
    return obj


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("World")
    if scene.world.node_tree is None:
        scene.world.use_nodes = True
    next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND").inputs["Strength"].default_value = 1.0

    plaster = _mat_flat("Plaster", (0.8, 0.8, 0.78), 0.9)
    wood = _mat_flat("Wood", (0.4, 0.25, 0.15), 0.6)
    tile = _mat_procedural("Tile proc")
    glow = _mat_emissive("Lamp glow")

    structure = _collection("Structure")
    floors = _collection("Floors")
    furniture = _collection("Furniture")
    doors = _collection("Doors.001")
    ceiling = _collection("Ceiling")
    ceiling.hide_render = True
    variant = _collection("Variant")
    variant.hide_render = True
    lights = _collection("Lights")
    interior = _collection("Interior lights")
    cams = _collection("Cameras")

    box_object("Floor - Alpha", [(0, 0, 0, 3.0, 3.0, 0.02)], tile, floors)
    box_object("Floor - Beta", [(3.2, 0, 0, 6.0, 3.0, 0.02)], wood, floors)
    box_object("Walls", [
        (-0.2, -0.2, 0, 6.2, 0, 2.6),
        (-0.2, 3.0, 0, 6.2, 3.2, 2.6),
        (-0.2, 0, 0, 0, 3.0, 2.6),
        (6.0, 0, 0, 6.2, 3.0, 2.6),
        (3.0, 0, 0, 3.2, 1.0, 2.6),
        (3.0, 1.8, 0, 3.2, 3.0, 2.6),
    ], plaster, structure)
    box_object("Door 1 (Alpha / Beta) lintel", [(3.0, 1.0, 2.05, 3.2, 1.8, 2.6)], plaster, structure)
    box_object("Ceiling", [(-0.2, -0.2, 2.6, 6.2, 3.2, 2.7)], plaster, ceiling)
    box_object("Door leaf 1", [(3.08, 1.02, 0, 3.12, 1.78, 2.0)], wood, doors)
    box_object("Shelf", [(3.4, 0.5, 0, 3.9, 1.3, 1.2)], wood, furniture)
    box_object("Lamp", [(5.5, 2.5, 0, 5.8, 2.8, 0.5)], glow, furniture)
    box_object("Hidden sofa", [(1.0, 2.0, 0, 2.5, 2.8, 0.8)], wood, variant)

    rig = bpy.data.objects.new("Table rig", None)
    furniture.objects.link(rig)
    rig.location = (0.5, 0.5, 0)
    table = box_object("Table", [(-0.3, -0.3, 0, 0.3, 0.3, 0.8)], wood, furniture)
    table.parent = rig
    table.location = (1.0, 1.0, 0)
    table.modifiers.new("Bevel", "BEVEL").width = 0.01

    _light("Sun", "SUN", (0, 0, 10), 3.0, lights)
    _light("Ceiling light Alpha", "AREA", (1.5, 1.5, 2.55), 100.0, interior, size=0.5)
    _light("Ceiling light Beta", "AREA", (4.6, 1.5, 2.55), 100.0, interior, size=0.5)
    bpy.context.view_layer.layer_collection.children["Interior lights"].exclude = True

    _camera("Cam_Entrada", (1.0, 0.8, 1.6), (math.pi / 2, 0, -math.pi / 2), cams)
    _camera("Cam_Sala", (4.5, 1.5, 1.6), (math.pi / 2, 0, math.pi / 2), cams)
    scene.camera = scene.objects["Cam_Entrada"]
    bpy.context.view_layer.update()
```

- [ ] **Step 2: Write the failing tests**

`blender/tests/test_scene_select.py`:

```python
import unittest

import bpy

from pipeline import rooms, scene_select
from tests import fixture_scene


class SceneSelectTests(unittest.TestCase):
    def setUp(self):
        fixture_scene.build()
        self.meshes, self.day_lights = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        self.names = {o.name for o in self.meshes}

    def test_keeps_render_visible_meshes_and_ceiling(self):
        for name in ("Walls", "Floor - Alpha", "Floor - Beta", "Ceiling", "Door leaf 1", "Table",
                     "Door 1 (Alpha / Beta) lintel", "Lamp", "Shelf"):
            self.assertIn(name, self.names)

    def test_deletes_hidden_variants(self):
        self.assertNotIn("Hidden sofa", self.names)
        self.assertNotIn("Hidden sofa", bpy.data.objects)

    def test_realizes_transforms_and_modifiers(self):
        table = bpy.data.objects["Table"]
        self.assertIsNone(table.parent)
        self.assertEqual(len(table.modifiers), 0)
        self.assertTrue(table.matrix_world.is_identity)
        xs = [v.co.x for v in table.data.vertices]
        ys = [v.co.y for v in table.data.vertices]
        self.assertAlmostEqual((min(xs) + max(xs)) / 2, 1.5, places=3)
        self.assertAlmostEqual((min(ys) + max(ys)) / 2, 1.5, places=3)
        self.assertGreater(len(table.data.polygons), 6)  # bevel applied

    def test_collections_and_lights(self):
        web = bpy.data.collections["WEB"]
        for o in self.meshes:
            self.assertEqual([c.name for c in o.users_collection], ["WEB"])
        self.assertEqual(self.day_lights, ["Sun"])
        lights = bpy.data.collections["WEB_LIGHTS"]
        self.assertEqual({o.name for o in lights.objects}, {"Sun", "Ceiling light Alpha", "Ceiling light Beta"})
        self.assertFalse(bpy.data.objects["Sun"].hide_render)
        self.assertTrue(bpy.data.objects["Ceiling light Alpha"].hide_render)
        self.assertIs(web, bpy.data.collections["WEB"])

    def test_collect_rooms(self):
        index, room_list = rooms.collect_rooms(self.meshes, bpy.context.scene)
        self.assertEqual([r["id"] for r in room_list], ["alpha", "beta"])
        self.assertEqual([r["light"] for r in room_list], ["Ceiling light Alpha", "Ceiling light Beta"])
        self.assertEqual(index.locate(1.0, -1.0), "alpha")  # Blender (1, 1)
        self.assertEqual(index.locate(4.0, -2.0), "beta")
        self.assertIsNone(index.locate(3.1, -0.5))  # inside the middle wall


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `make test-blender TESTS=test_scene_select.py`
Expected: FAIL with `ImportError: cannot import name 'rooms'`

- [ ] **Step 4: Implement config, state and bpy helpers**

`blender/pipeline/config.py`:

```python
"""Pipeline settings. Override tables at the bottom are for hand fixes after reviewing build/debug_map.png."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Quality:
    name: str
    albedo_texels_per_m: int
    albedo_max: int
    lightmap_texels_per_m: int
    lightmap_min: int
    lightmap_max: int
    door_lightmap: int
    bake_samples: int
    blur_sigma_px: float


QUALITY = {
    "test": Quality("test", 16, 64, 8, 32, 64, 32, 4, 0.0),
    "preview": Quality("preview", 64, 1024, 24, 256, 1024, 128, 32, 1.0),
    "final": Quality("final", 256, 2048, 100, 512, 2048, 512, 512, 1.0),
}

EYE_HEIGHT = 1.6
PLAYER_RADIUS = 0.2
GRID_CELL = 0.05
COLLISION_SAMPLE_HEIGHTS = (0.3, 1.0, 1.7)
COLLISION_RAY_TOP = 2.0
LOW_OBJECT_MAX_Z = 0.1
SWITCH_HEIGHT = 1.1
SWITCH_OFFSET_FROM_OPENING = 0.15
SWITCH_SIZE = (0.08, 0.01, 0.08)
SPAWN_CAMERA = "Cam_Entrada"
VIEWPOINT_CAMERAS = ("Cam_Sala", "Cam_Kitchen", "Cam_Bedroom")
FIRST_VIEW_BUDGET_BYTES = 30 * 1024 * 1024
EXPECTED_DOOR_COUNT = 9
# Chunking: faces over a wall (no floor below) join the nearest room within this distance;
# meshes with faces larger than DICE_MAX_FACE_AREA m² are first cut on a DICE_CELL grid.
ROOM_ASSIGN_MAX_DIST = 0.2
DICE_CELL = 0.25
DICE_MAX_FACE_AREA = 0.5

DROP_OBJECT_NAMES = ("Walls (backup before finishes)",)
FORCE_INCLUDE_COLLECTION_PREFIXES = ("Ceiling",)
PASSABLE_NAME_PATTERN = r"^Glazed Door .* (glass|mullion|rail)(\.\d+)?$"

# {"Door leaf 3": {"hinge": "b", "sign": -1}}: hinge end "a" is the end with the smaller (x, z).
DOOR_OVERRIDES = {}
# {"cozinha": {"door": 24, "side": -1}}: door number from the lintel name, side along the wall.
SWITCH_OVERRIDES = {}
```

`blender/pipeline/state.py`:

```python
"""Pipeline state carried between stages, stored on the scene so a saved .blend can resume."""
import json

KEY = "web_state"


def save(scene, state):
    scene[KEY] = json.dumps(state)


def load(scene):
    return json.loads(scene[KEY])
```

`blender/pipeline/bpyutil.py`:

```python
"""Small bpy helpers used across stages."""
import bmesh
import bpy
import numpy as np


def select_only(objs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def world_coords(obj):
    me = obj.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    m = np.array(obj.matrix_world, dtype=np.float64)
    return co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]


def polygon_vectors(me, attr):
    a = np.empty(len(me.polygons) * 3, dtype=np.float64)
    me.polygons.foreach_get(attr, a)
    return a.reshape(-1, 3)


def polygon_scalars(me, attr):
    a = np.empty(len(me.polygons), dtype=np.float64)
    me.polygons.foreach_get(attr, a)
    return a


def polygon_ints(me, attr):
    a = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get(attr, a)
    return a


def set_cycles(scene, samples):
    """Switch to Cycles on the best available GPU. Returns the device type used."""
    try:
        scene.render.engine = "CYCLES"
    except TypeError as e:
        raise RuntimeError(f"Cycles is not available: {e}") from e
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        getattr(prefs, "refresh_devices", prefs.get_devices)()
        if any(d.type == kind for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = "GPU"
            return kind
    scene.cycles.device = "CPU"
    return "CPU"


def select_faces_in_edit(obj, mask):
    """In edit mode: select exactly the faces whose index is True in mask."""
    bpy.ops.mesh.select_all(action="DESELECT")
    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        if mask[f.index]:
            f.select_set(True)
    bmesh.update_edit_mesh(obj.data)


def join(objs, name):
    select_only(objs, objs[0])
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


def split_by_face_values(obj, values, name_for):
    """Separate obj into one object per distinct per-face value. Returns {value: object}."""
    attr = obj.data.attributes.new("split_key", "INT", "FACE")
    attr.data.foreach_set("value", np.asarray(values, dtype=np.int32))
    keys = sorted(set(int(v) for v in values))
    result = {}
    for v in keys[:-1]:
        select_only([obj], obj)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bm = bmesh.from_edit_mesh(obj.data)
        layer = bm.faces.layers.int["split_key"]
        for f in bm.faces:
            if f[layer] == v:
                f.select_set(True)
        bmesh.update_edit_mesh(obj.data)
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        new = next(o for o in bpy.context.selected_objects if o != obj)
        new.name = name_for(v)
        result[v] = new
    obj.name = name_for(keys[-1])
    result[keys[-1]] = obj
    return result
```

- [ ] **Step 5: Implement scene selection and rooms**

`blender/pipeline/scene_select.py`:

```python
"""Choose what goes on the web, and bake every kept mesh into world space."""
import bpy
from mathutils import Matrix

from . import config


def visible_collections(view_layer):
    out = {view_layer.layer_collection.collection}

    def walk(lc):
        for ch in lc.children:
            if ch.exclude or ch.collection.hide_render:
                continue
            out.add(ch.collection)
            walk(ch)

    walk(view_layer.layer_collection)
    return out


def is_render_visible(obj, visible):
    return (not obj.hide_render) and any(c in visible for c in obj.users_collection)


def _forced(obj):
    return any(c.name.startswith(config.FORCE_INCLUDE_COLLECTION_PREFIXES) for c in obj.users_collection)


def _placeholder_material():
    mat = bpy.data.materials.get("Web default")
    if mat is None:
        mat = bpy.data.materials.new("Web default")
        if mat.node_tree is None:
            mat.use_nodes = True
    return mat


def realize(objs):
    """Apply modifiers and world transforms into each object's own mesh; clear parents."""
    dg = bpy.context.evaluated_depsgraph_get()
    matrices = {o.name: o.matrix_world.copy() for o in objs}
    slots = {o.name: [s.material for s in o.material_slots] for o in objs}
    meshes = {}
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(matrices[o.name])
        if matrices[o.name].determinant() < 0:
            me.flip_normals()
        meshes[o.name] = me
    for o in objs:
        o.modifiers.clear()
        o.parent = None
        o.data = meshes[o.name]
        o.matrix_world = Matrix.Identity(4)
        mats = slots[o.name] or [None]
        o.data.materials.clear()
        for m in mats:
            o.data.materials.append(m or _placeholder_material())
        for s in o.material_slots:
            s.link = "DATA"


def _move_to(objs, name):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
        o.hide_viewport = False
        o.hide_set(False)
    return col


def prepare_scene(scene, view_layer):
    """Returns (kept meshes, names of lights that are on in the current render)."""
    visible = visible_collections(view_layer)
    lights = [o for o in scene.objects if o.type == "LIGHT"]
    day_lights = sorted(o.name for o in lights if is_render_visible(o, visible))
    keep = [
        o for o in scene.objects
        if o.type == "MESH" and o.name not in config.DROP_OBJECT_NAMES
        and (is_render_visible(o, visible) or _forced(o))
    ]
    keep_set = set(keep)
    for o in [o for o in scene.objects if o.type == "MESH" and o not in keep_set]:
        bpy.data.objects.remove(o, do_unlink=True)
    realize(keep)
    _move_to(keep, "WEB")
    _move_to(lights, "WEB_LIGHTS")
    for o in lights:
        o.hide_render = o.name not in day_lights
    view_layer.update()
    return keep, day_lights
```

`blender/pipeline/rooms.py`:

```python
"""Rooms come from the 'Floor - <room>' meshes."""
import numpy as np

from . import geom

PREFIX = "Floor - "


def floor_triangles(obj):
    """Upward-facing triangles of a realized floor mesh, flat [x0, z0, ...] in three.js space."""
    me = obj.data
    me.calc_loop_triangles()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
    me.loop_triangles.foreach_get("vertices", tri)
    normals = np.empty(len(me.loop_triangles) * 3)
    me.loop_triangles.foreach_get("normal", normals)
    up = normals.reshape(-1, 3)[:, 2] > 0.5
    pts = co[tri.reshape(-1, 3)][up][:, :, :2]
    three = np.stack([pts[..., 0], -pts[..., 1]], axis=-1)
    return [round(float(v), 4) for v in three.reshape(-1)]


def collect_rooms(meshes, scene):
    floors = sorted((o for o in meshes if o.name.startswith(PREFIX)), key=lambda o: o.name)
    light_names = {o.name for o in scene.objects if o.type == "LIGHT"}
    room_list = []
    for f in floors:
        name = f.name[len(PREFIX):]
        light = f"Ceiling light {name}"
        room_list.append({
            "id": geom.slugify(name),
            "name": name,
            "floor": floor_triangles(f),
            "light": light if light in light_names else None,
        })
    index = geom.FloorIndex({r["id"]: r["floor"] for r in room_list})
    return index, room_list
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `make test-blender TESTS=test_scene_select.py`
Expected: PASS, 5 tests, `OK`

- [ ] **Step 7: Commit**

```bash
git add blender
git commit -m "Add fixture scene, config, and scene selection with rooms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Bake procedural materials to albedo textures

**Files:**
- Create: `blender/pipeline/proc_materials.py`, `blender/tests/test_proc_materials.py`

**Interfaces:**
- Consumes: `scene_select.prepare_scene`, `bpyutil.*`, `raster.texture_size_for_area`, `config.Quality`.
- Produces: `proc_materials.PROCEDURAL_NODE_TYPES`, `proc_materials.is_procedural(mat) -> bool`, `proc_materials.bake_procedural_albedo(meshes, quality) -> list[str]` (names of objects that were baked). After it runs, each procedural slot holds a per-object copy named `"<material> [<object>]"`: Principled BSDF ← packed image texture (sRGB) via a `UVMap` UV node. Original roughness and metallic values are kept; bump is dropped.

- [ ] **Step 1: Write the failing tests**

`blender/tests/test_proc_materials.py`:

```python
import unittest

import bpy
import numpy as np

from pipeline import config, proc_materials, scene_select
from tests import fixture_scene


class ProceduralAlbedoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        cls.baked = proc_materials.bake_procedural_albedo(meshes, config.QUALITY["test"])

    def test_reports_baked_objects(self):
        self.assertEqual(self.baked, ["Floor - Alpha"])

    def test_material_is_rewired_to_an_image(self):
        floor = bpy.data.objects["Floor - Alpha"]
        mat = floor.material_slots[0].material
        self.assertEqual(mat.name, "Tile proc [Floor - Alpha]")
        self.assertFalse(proc_materials.is_procedural(mat))
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        link = bsdf.inputs["Base Color"].links[0]
        self.assertEqual(link.from_node.type, "TEX_IMAGE")
        img = link.from_node.image
        self.assertIsNotNone(img.packed_file)
        self.assertIn("UVMap", floor.data.uv_layers)

    def test_baked_image_has_the_pattern(self):
        img = bpy.data.objects["Floor - Alpha"].material_slots[0].material.node_tree.nodes["Image Texture"].image
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        self.assertGreater(px.reshape(-1, 4)[:, :3].std(), 0.01)

    def test_other_materials_untouched_and_no_bake_nodes_left(self):
        plaster = bpy.data.materials["Plaster"]
        self.assertFalse(any(n.type == "TEX_IMAGE" for n in plaster.node_tree.nodes))
        for mat in bpy.data.materials:
            if mat.node_tree:
                self.assertNotIn(proc_materials.BAKE_NODE, mat.node_tree.nodes)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test-blender TESTS=test_proc_materials.py`
Expected: FAIL with `ImportError: cannot import name 'proc_materials'`

- [ ] **Step 3: Implement `proc_materials.py`**

`blender/pipeline/proc_materials.py`:

```python
"""Bake procedural base colours to per-object image textures that glTF can carry."""
import math

import bpy
import numpy as np

from . import bpyutil, geom, raster

PROCEDURAL_NODE_TYPES = {
    "TEX_NOISE", "TEX_VORONOI", "TEX_WAVE", "TEX_BRICK", "TEX_CHECKER",
    "TEX_MAGIC", "TEX_GRADIENT", "TEX_WHITE_NOISE", "TEX_MUSGRAVE",
}
BAKE_NODE = "WEB_ALBEDO_TARGET"


def is_procedural(mat):
    return bool(mat and mat.node_tree and any(n.type in PROCEDURAL_NODE_TYPES for n in mat.node_tree.nodes))


def _dummy_image():
    img = bpy.data.images.get("web_bake_dummy")
    return img or bpy.data.images.new("web_bake_dummy", 8, 8)


def _rewire_to_image(mat, img):
    nt = mat.node_tree
    old = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    keep = {k: old.inputs[k].default_value for k in ("Roughness", "Metallic")}
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.name = "Image Texture"
    tex.image = img
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    for k, v in keep.items():
        bsdf.inputs[k].default_value = v


def _bake_object(obj, quality):
    me = obj.data
    proc_slots = [i for i, s in enumerate(obj.material_slots) if is_procedural(s.material)]
    mask = np.isin(bpyutil.polygon_ints(me, "material_index"), proc_slots)
    area = float(bpyutil.polygon_scalars(me, "area")[mask].sum())
    size = raster.texture_size_for_area(area, quality.albedo_texels_per_m, 64, quality.albedo_max)

    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    me.uv_layers.active = uv
    bpyutil.select_only([obj], obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpyutil.select_faces_in_edit(obj, mask)
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), margin_method="FRACTION",
                             island_margin=4 / size, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    img = bpy.data.images.new(f"albedo_{geom.slugify(obj.name)}", size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    copies = {}
    for i, slot in enumerate(obj.material_slots):
        if i in proc_slots:
            copies[i] = slot.material.copy()
            copies[i].name = f"{slot.material.name} [{obj.name}]"
            slot.material = copies[i]
        node = slot.material.node_tree.nodes.new("ShaderNodeTexImage")
        node.name = BAKE_NODE
        node.image = img if i in proc_slots else _dummy_image()
        slot.material.node_tree.nodes.active = node

    bpyutil.select_only([obj], obj)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=4, margin_type="EXTEND",
                        use_clear=True, uv_layer="UVMap", target="IMAGE_TEXTURES")

    for slot in obj.material_slots:
        nodes = slot.material.node_tree.nodes
        if BAKE_NODE in nodes:
            nodes.remove(nodes[BAKE_NODE])
    img.pack()
    for mat in copies.values():
        _rewire_to_image(mat, img)


def bake_procedural_albedo(meshes, quality):
    bpyutil.set_cycles(bpy.context.scene, 4)
    baked = []
    for obj in sorted(meshes, key=lambda o: o.name):
        if any(is_procedural(s.material) for s in obj.material_slots):
            _bake_object(obj, quality)
            baked.append(obj.name)
            print(f"[albedo] {obj.name}", flush=True)
    return baked
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test-blender TESTS=test_proc_materials.py`
Expected: PASS, 4 tests, `OK`

If `smart_project` or `bake` raises a context error in background mode, put `with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):` around that call and re-run.

- [ ] **Step 5: Commit**

```bash
git add blender
git commit -m "Bake procedural materials to per-object albedo textures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Openings and the collision grid

**Files:**
- Create: `blender/pipeline/openings.py`, `blender/pipeline/collision.py`, `blender/tests/test_collision.py`

**Interfaces:**
- Consumes: `geom.principal_frame`, `geom.FloorIndex`, `raster.dilate`, `raster.rle_encode`, `bpyutil.world_coords`.
- Produces: `openings.Opening(num, glazed, rooms, center, u, n, width, thickness)` (frozen dataclass, three.js xz), `openings.opening_from_points(num, glazed, rooms, points_xz)`, `openings.parse_openings(meshes) -> (list[Opening], set[int] infilled_door_numbers)`.
- Produces: `collision.Grid(x0, z0, cell, width, height, blocked, raw)` with `.is_blocked(x, z, raw=False)` and `.to_json(radius) -> {"x0","z0","cell","width","height","radius","runs"}` (runs row-major, row = z index). Also `collision.cell_centres(bounds, cell)`, `collision.assemble_grid(bounds, cell, radius, walkable, solid, near)`, `collision.in_opening(pts, opening, slack=0.05)` and `collision.build_collision(meshes, floor_index, openings, radius=PLAYER_RADIUS, cell=GRID_CELL) -> Grid`.

- [ ] **Step 1: Write the failing tests**

`blender/tests/test_collision.py`:

```python
import unittest

import bpy
import numpy as np

from pipeline import collision, openings, rooms, scene_select
from tests import fixture_scene


class GridAssemblyTests(unittest.TestCase):
    def test_inflates_raw_by_radius(self):
        bounds, cell = (0.0, 0.0, 1.0, 1.0), 0.1
        w, h, pts = collision.cell_centres(bounds, cell)
        walkable = np.ones(len(pts), bool)
        solid = np.zeros(len(pts), bool)
        solid[np.isclose(pts[:, 0], 0.55)] = True
        grid = collision.assemble_grid(bounds, cell, 0.1, walkable, solid, np.zeros(len(pts), bool))
        self.assertEqual(grid.raw[0].nonzero()[0].tolist(), [5])
        self.assertEqual(grid.blocked[0].nonzero()[0].tolist(), [4, 5, 6])
        self.assertTrue(grid.is_blocked(0.45, 0.5))
        self.assertFalse(grid.is_blocked(0.45, 0.5, raw=True))
        self.assertTrue(grid.is_blocked(-1.0, 0.5))  # outside the grid

    def test_json_round_trips_runs(self):
        bounds, cell = (0.0, 0.0, 0.3, 0.2), 0.1
        w, h, pts = collision.cell_centres(bounds, cell)
        solid = np.array([False, True, False, False, False, True])
        grid = collision.assemble_grid(bounds, cell, 0.0, np.ones(6, bool), solid, np.zeros(6, bool))
        j = grid.to_json(0.0)
        self.assertEqual((j["width"], j["height"]), (3, 2))
        self.assertEqual(j["runs"], [1, 1, 3, 1])


class FixtureCollisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        cls.ops, cls.infilled = openings.parse_openings(meshes)
        cls.grid = collision.build_collision(meshes, index, cls.ops)

    def test_parses_the_door_opening(self):
        self.assertEqual(len(self.ops), 1)
        op = self.ops[0]
        self.assertEqual((op.num, op.glazed, op.rooms), (1, False, ("Alpha", "Beta")))
        self.assertAlmostEqual(op.center[0], 3.1, places=3)
        self.assertAlmostEqual(op.center[1], -1.4, places=3)
        self.assertAlmostEqual(op.width, 0.8, places=3)
        self.assertAlmostEqual(op.thickness, 0.2, places=3)
        self.assertEqual(self.infilled, set())

    def test_occupancy(self):
        g = self.grid
        self.assertFalse(g.is_blocked(0.5, -2.5))   # open floor in Alpha
        self.assertTrue(g.is_blocked(1.5, -1.5))    # table
        self.assertTrue(g.is_blocked(3.1, -0.5))    # middle wall
        self.assertFalse(g.is_blocked(3.1, -1.4))   # doorway (door leaf is dynamic)
        self.assertTrue(g.is_blocked(3.65, -0.9))   # shelf
        self.assertTrue(g.is_blocked(-1.0, -1.0))   # outside
        self.assertTrue(g.is_blocked(0.1, -1.5))    # within radius of the west wall
        self.assertFalse(g.is_blocked(0.1, -1.5, raw=True))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test-blender TESTS=test_collision.py`
Expected: FAIL with `ImportError: cannot import name 'collision'`

- [ ] **Step 3: Implement `openings.py`**

`blender/pipeline/openings.py`:

```python
"""Door openings, read from the 'Door N (A / B) lintel' objects."""
import re
from dataclasses import dataclass

import numpy as np

from . import bpyutil, geom

OPENING_RE = re.compile(r"^(?P<glazed>Glazed )?Door (?P<num>\d+) \((?P<a>[^/]+?) / (?P<b>[^)]+?)\) lintel$")
INFILL_RE = re.compile(r"^Door (?P<num>\d+) infill$")


@dataclass(frozen=True)
class Opening:
    num: int
    glazed: bool
    rooms: tuple
    center: tuple
    u: tuple
    n: tuple
    width: float
    thickness: float


def opening_from_points(num, glazed, room_names, points_xz):
    center, u, n, width, thickness = geom.principal_frame(points_xz)
    return Opening(num, glazed, tuple(room_names), center, u, n, width, thickness)


def parse_openings(meshes):
    ops, infilled = [], set()
    for o in meshes:
        m = OPENING_RE.match(o.name)
        if m:
            co = bpyutil.world_coords(o)
            pts = np.stack([co[:, 0], -co[:, 1]], axis=1)
            ops.append(opening_from_points(int(m["num"]), bool(m["glazed"]), (m["a"], m["b"]), pts))
        mi = INFILL_RE.match(o.name)
        if mi:
            infilled.add(int(mi["num"]))
    ops.sort(key=lambda op: op.num)
    return ops, infilled
```

- [ ] **Step 4: Implement `collision.py`**

`blender/pipeline/collision.py`:

```python
"""2D occupancy grid on the three.js ground plane: where can a 0.2 m-radius visitor stand?"""
import math
import re
from dataclasses import dataclass

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from . import bpyutil, config, geom, raster


@dataclass
class Grid:
    x0: float
    z0: float
    cell: float
    width: int
    height: int
    blocked: np.ndarray  # (height, width), inflated by the player radius
    raw: np.ndarray      # (height, width), geometry only

    def is_blocked(self, x, z, raw=False):
        i = int(math.floor((x - self.x0) / self.cell))
        j = int(math.floor((z - self.z0) / self.cell))
        if not (0 <= i < self.width and 0 <= j < self.height):
            return True
        return bool((self.raw if raw else self.blocked)[j, i])

    def to_json(self, radius):
        return {
            "x0": round(self.x0, 4), "z0": round(self.z0, 4), "cell": self.cell,
            "width": self.width, "height": self.height, "radius": radius,
            "runs": raster.rle_encode(self.blocked),
        }


def cell_centres(bounds, cell):
    x0, z0, x1, z1 = bounds
    w = int(math.ceil(round((x1 - x0) / cell, 6)))
    h = int(math.ceil(round((z1 - z0) / cell, 6)))
    xs = x0 + (np.arange(w) + 0.5) * cell
    zs = z0 + (np.arange(h) + 0.5) * cell
    gx, gz = np.meshgrid(xs, zs)
    return w, h, np.stack([gx.ravel(), gz.ravel()], axis=1)


def assemble_grid(bounds, cell, radius, walkable, solid, near):
    w, h, _ = cell_centres(bounds, cell)
    raw = (~walkable | solid).reshape(h, w)
    blocked = raster.dilate(raw, int(math.ceil(round(radius / cell, 6)))) | near.reshape(h, w)
    return Grid(bounds[0], bounds[1], cell, w, h, blocked, raw)


def in_opening(pts, op, slack=0.05):
    d = pts - np.asarray(op.center)
    along = np.abs(d @ np.asarray(op.u))
    across = np.abs(d @ np.asarray(op.n))
    return (along <= op.width / 2) & (across <= op.thickness / 2 + slack)


def collision_meshes(meshes):
    passable = re.compile(config.PASSABLE_NAME_PATTERN)
    out = []
    for o in meshes:
        if o.name.startswith(("Floor - ", "Door leaf")) or passable.match(o.name):
            continue
        if bpyutil.world_coords(o)[:, 2].max() < config.LOW_OBJECT_MAX_Z:
            continue
        out.append(o)
    return out


def build_bvh(objs):
    verts, polys, off = [], [], 0
    for o in objs:
        co = bpyutil.world_coords(o)
        verts.extend(map(tuple, co))
        polys.extend([off + v for v in p.vertices] for p in o.data.polygons)
        off += len(co)
    return BVHTree.FromPolygons(verts, polys)


def build_collision(meshes, floor_index, openings, radius=config.PLAYER_RADIUS, cell=config.GRID_CELL):
    x0, z0, x1, z1 = floor_index.bounds()
    bounds = (x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5)
    _, _, pts = cell_centres(bounds, cell)
    walkable = floor_index.locate_many(pts) >= 0
    for op in openings:
        walkable |= in_opening(pts, op)
    bvh = build_bvh(collision_meshes(meshes))
    solid = np.zeros(len(pts), bool)
    near = np.zeros(len(pts), bool)
    down = Vector((0.0, 0.0, -1.0))
    reach = config.COLLISION_RAY_TOP - config.LOW_OBJECT_MAX_Z
    for k in np.flatnonzero(walkable):
        bx, by = geom.from_three_xz(*pts[k])
        if bvh.ray_cast(Vector((bx, by, config.COLLISION_RAY_TOP)), down, reach)[0] is not None:
            solid[k] = True
            continue
        for hgt in config.COLLISION_SAMPLE_HEIGHTS:
            if bvh.find_nearest(Vector((bx, by, hgt)), radius)[0] is not None:
                near[k] = True
                break
    return assemble_grid(bounds, cell, radius, walkable, solid, near)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `make test-blender TESTS=test_collision.py`
Expected: PASS, 4 tests, `OK`

- [ ] **Step 6: Commit**

```bash
git add blender
git commit -m "Parse door openings and build the 2D collision grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Door hinges and swing direction

**Files:**
- Create: `blender/pipeline/doors.py`, `blender/tests/test_doors.py`

**Interfaces:**
- Consumes: `geom.principal_frame`, `geom.choose_door_swing`, `geom.from_three_xz`, `collision.Grid.is_blocked(raw=True)`, `bpyutil.world_coords`.
- Produces: `doors.prepare_doors(door_objs, grid, overrides) -> list[dict]`. Each dict is `{"node": "Door_<n>", "key": "door-<n>", "hinge": [x, z], "dir": [dx, dz], "width": w, "openAngle": ±π/2}`, rounded to 4 or 5 decimals. Each object is renamed `Door_<n>` and its origin moved to the hinge (z = bottom of the leaf), so rotation about local Z (three.js Y) swings it.

- [ ] **Step 1: Write the failing tests**

`blender/tests/test_doors.py`:

```python
import math
import unittest

import bpy

from pipeline import collision, doors, openings, rooms, scene_select
from tests import fixture_scene


class DoorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        ops, _ = openings.parse_openings(meshes)
        grid = collision.build_collision(meshes, index, ops)
        leaves = [o for o in meshes if o.name.startswith("Door leaf")]
        cls.specs = doors.prepare_doors(leaves, grid, {})

    def test_spec(self):
        self.assertEqual(len(self.specs), 1)
        d = self.specs[0]
        self.assertEqual((d["node"], d["key"]), ("Door_1", "door-1"))
        self.assertAlmostEqual(d["hinge"][0], 3.1, places=3)
        self.assertAlmostEqual(d["hinge"][1], -1.78, places=3)
        self.assertAlmostEqual(d["dir"][0], 0.0, places=3)
        self.assertAlmostEqual(d["dir"][1], 1.0, places=3)
        self.assertAlmostEqual(d["width"], 0.76, places=3)
        # The shelf blocks the swing into Beta, so it opens into Alpha (negative angle).
        self.assertAlmostEqual(d["openAngle"], -math.pi / 2, places=4)

    def test_origin_is_at_the_hinge(self):
        obj = bpy.data.objects["Door_1"]
        self.assertAlmostEqual(obj.location.x, 3.1, places=3)
        self.assertAlmostEqual(obj.location.y, 1.78, places=3)
        self.assertAlmostEqual(obj.location.z, 0.0, places=3)
        far = max((v.co.x ** 2 + v.co.y ** 2) ** 0.5 for v in obj.data.vertices)
        self.assertAlmostEqual(far, 0.76, delta=0.03)

    def test_override(self):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        ops, _ = openings.parse_openings(meshes)
        grid = collision.build_collision(meshes, index, ops)
        leaves = [o for o in meshes if o.name.startswith("Door leaf")]
        spec = doors.prepare_doors(leaves, grid, {"Door leaf 1": {"hinge": "b"}})[0]
        self.assertAlmostEqual(spec["hinge"][1], -1.02, places=3)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test-blender TESTS=test_doors.py`
Expected: FAIL with `ImportError: cannot import name 'doors'`

- [ ] **Step 3: Implement `doors.py`**

`blender/pipeline/doors.py`:

```python
"""Move each door leaf's origin to its hinge and decide which way it swings."""
import math
import re

import numpy as np
from mathutils import Matrix, Vector

from . import bpyutil, geom

NUM_RE = re.compile(r"(\d+)")


def _number(name):
    m = NUM_RE.search(name)
    return int(m.group(1)) if m else 0


def prepare_doors(door_objs, grid, overrides):
    specs = []
    for obj in sorted(door_objs, key=lambda o: _number(o.name)):
        n = _number(obj.name)
        co = bpyutil.world_coords(obj)
        pts = np.stack([co[:, 0], -co[:, 1]], axis=1)
        center, u, _, width, _ = geom.principal_frame(pts)
        ends = sorted(
            [(center[0] - u[0] * width / 2, center[1] - u[1] * width / 2),
             (center[0] + u[0] * width / 2, center[1] + u[1] * width / 2)],
            key=lambda p: (round(p[0], 3), round(p[1], 3)),
        )
        choice = geom.choose_door_swing(
            ends[0], ends[1], lambda x, z: grid.is_blocked(x, z, raw=True), overrides.get(obj.name)
        )
        hx, hz = choice["hinge"]
        bx, by = geom.from_three_xz(hx, hz)
        hinge = Vector((bx, by, float(co[:, 2].min())))
        obj.data.transform(Matrix.Translation(-hinge))
        obj.location = hinge
        obj.name = f"Door_{n}"
        specs.append({
            "node": obj.name,
            "key": f"door-{n}",
            "hinge": [round(hx, 4), round(hz, 4)],
            "dir": [round(choice["dir"][0], 5), round(choice["dir"][1], 5)],
            "width": round(choice["width"], 4),
            "openAngle": round(choice["sign"] * math.pi / 2, 5),
        })
        print(f"[doors] {obj.name}: hinge {specs[-1]['hinge']} sign {choice['sign']}", flush=True)
    return specs
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test-blender TESTS=test_doors.py`
Expected: PASS, 3 tests, `OK`

- [ ] **Step 5: Commit**

```bash
git add blender
git commit -m "Set door hinge origins and choose swing direction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Light switches

**Files:**
- Create: `blender/pipeline/placement.py`, `blender/pipeline/switches.py`, `blender/tests/test_placement.py`, `blender/tests/test_switches.py`

**Interfaces:**
- Consumes: `openings.Opening`, `geom.FloorIndex.locate`, `collision.Grid.is_blocked(raw=True)`, `config.SWITCH_*`.
- Produces: `placement.choose_switch_spot(room_id, room_name, openings, infilled, locate, is_blocked_raw, override=None, offset=0.15) -> {"pos": (x, z), "u": (ux, uz), "n": (nx, nz), "door": int} | None`. `pos` is on the room-side wall surface plus 6 mm; `n` points into the room.
- Produces: `switches.switch_material()` and `switches.create_switch(room_id, spot, collection, material) -> Object` (named `Switch_<room_id>`, centred at 1.1 m), plus `switches.place_switches(rooms, openings, infilled, floor_index, grid, collection, overrides) -> dict[room_id, object name]`. Only rooms with a ceiling light get a switch.

- [ ] **Step 1: Write the failing pure test**

`blender/tests/test_placement.py`:

```python
import unittest

from pipeline.openings import Opening
from pipeline.placement import choose_switch_spot

# Wall along z at x = 3.1 (0.2 thick); opening centre (3.1, -1.4), 0.8 wide.
OP = Opening(1, False, ("Alpha", "Beta"), (3.1, -1.4), (0.0, 1.0), (-1.0, 0.0), 0.8, 0.2)


def locate(x, z):
    if x < 3.0:
        return "alpha"
    if x > 3.2:
        return "beta"
    return None


def blocked(x, z):
    in_wall = 3.0 <= x <= 3.2 and not (-1.8 <= z <= -1.0)
    shelf = 3.4 <= x <= 3.9 and -1.3 <= z <= -0.5
    return in_wall or shelf


class SwitchSpotTests(unittest.TestCase):
    def test_alpha_first_side(self):
        s = choose_switch_spot("alpha", "Alpha", [OP], set(), locate, blocked)
        self.assertAlmostEqual(s["pos"][0], 2.994)
        self.assertAlmostEqual(s["pos"][1], -0.85)
        self.assertEqual(s["n"], (-1.0, 0.0))
        self.assertEqual(s["door"], 1)

    def test_beta_skips_side_blocked_by_furniture(self):
        s = choose_switch_spot("beta", "Beta", [OP], set(), locate, blocked)
        self.assertAlmostEqual(s["pos"][0], 3.206)
        self.assertAlmostEqual(s["pos"][1], -1.95)

    def test_override_side(self):
        s = choose_switch_spot("alpha", "Alpha", [OP], set(), locate, blocked, {"side": -1})
        self.assertAlmostEqual(s["pos"][1], -1.95)

    def test_infilled_or_unrelated_doors_give_none(self):
        self.assertIsNone(choose_switch_spot("alpha", "Alpha", [OP], {1}, locate, blocked))
        self.assertIsNone(choose_switch_spot("gamma", "Gamma", [OP], set(), locate, blocked))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Write the failing Blender test**

`blender/tests/test_switches.py`:

```python
import unittest

import bpy

from pipeline import collision, openings, rooms, scene_select, switches
from tests import fixture_scene


class SwitchObjectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, room_list = rooms.collect_rooms(meshes, bpy.context.scene)
        ops, infilled = openings.parse_openings(meshes)
        grid = collision.build_collision(meshes, index, ops)
        cls.result = switches.place_switches(room_list, ops, infilled, index, grid,
                                             bpy.data.collections["WEB"], {})

    def test_one_switch_per_lit_room(self):
        self.assertEqual(self.result, {"alpha": "Switch_alpha", "beta": "Switch_beta"})

    def test_switch_transform_and_material(self):
        sw = bpy.data.objects["Switch_alpha"]
        self.assertAlmostEqual(sw.location.x, 2.994, places=3)
        self.assertAlmostEqual(sw.location.y, 0.85, places=3)
        self.assertAlmostEqual(sw.location.z, 1.1, places=3)
        self.assertAlmostEqual(sw.dimensions.x, 0.08, places=3)
        self.assertAlmostEqual(sw.dimensions.y, 0.01, places=3)
        mat = sw.material_slots[0].material
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        self.assertGreater(bsdf.inputs["Emission Strength"].default_value, 0)
        self.assertIn(sw.name, bpy.data.collections["WEB"].objects)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `make test-blender TESTS="test_placement.py"` and then `make test-blender TESTS="test_switches.py"`
Expected: both FAIL with `ImportError` (`placement`, `switches`)

- [ ] **Step 4: Implement `placement.py`**

`blender/pipeline/placement.py`:

```python
"""Pure logic: where on the wall beside a room's door the light switch goes."""
import numpy as np


def choose_switch_spot(room_id, room_name, openings, infilled, locate, is_blocked_raw, override=None, offset=0.15):
    override = override or {}
    cands = [o for o in openings if room_name in o.rooms and o.num not in infilled]
    if "door" in override:
        cands = [o for o in cands if o.num == override["door"]]
    cands.sort(key=lambda o: (o.glazed, o.num))
    sides = (override["side"],) if "side" in override else (1, -1)
    for op in cands:
        c, u, n = np.asarray(op.center), np.asarray(op.u), np.asarray(op.n)
        inward = next(
            (s for s in (1, -1) if locate(*(c + n * s * (op.thickness / 2 + 0.3))) == room_id), None
        )
        if inward is None:
            continue
        for side in sides:
            along = c + u * side * (op.width / 2 + offset)
            front = along + n * inward * (op.thickness / 2 + 0.25)
            if not is_blocked_raw(*along) or is_blocked_raw(*front):
                continue
            pos = along + n * inward * (op.thickness / 2 + 0.006)
            return {
                "pos": (round(float(pos[0]), 4), round(float(pos[1]), 4)),
                "u": (float(u[0]), float(u[1])),
                "n": (float(n[0] * inward), float(n[1] * inward)),
                "door": op.num,
            }
    return None
```

- [ ] **Step 5: Implement `switches.py`**

`blender/pipeline/switches.py`:

```python
"""Create a small wall switch mesh for each room that has a ceiling light."""
import math

import bmesh
import bpy

from . import config
from .placement import choose_switch_spot


def switch_material():
    mat = bpy.data.materials.get("Web switch")
    if mat:
        return mat
    mat = bpy.data.materials.new("Web switch")
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.92, 0.92, 0.9, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.4
    bsdf.inputs["Emission Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 0.3
    return mat


def create_switch(room_id, spot, collection, material):
    name = f"Switch_{room_id}"
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    collection.objects.link(obj)
    ux, uz = spot["u"]
    px, pz = spot["pos"]
    obj.scale = config.SWITCH_SIZE
    obj.rotation_euler = (0.0, 0.0, math.atan2(-uz, ux))  # local X along the wall
    obj.location = (px, -pz, config.SWITCH_HEIGHT)
    return obj


def place_switches(room_list, openings, infilled, floor_index, grid, collection, overrides):
    material = switch_material()
    result = {}
    for room in room_list:
        if not room["light"]:
            continue
        spot = choose_switch_spot(
            room["id"], room["name"], openings, infilled, floor_index.locate,
            lambda x, z: grid.is_blocked(x, z, raw=True), overrides.get(room["id"]),
            config.SWITCH_OFFSET_FROM_OPENING,
        )
        if spot is None:
            print(f"[switches] WARNING no spot for {room['name']}; add it to SWITCH_OVERRIDES", flush=True)
            continue
        result[room["id"]] = create_switch(room["id"], spot, collection, material).name
    return result
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `make test-blender TESTS="test_placement.py"` and then `make test-blender TESTS="test_switches.py"`
Expected: PASS (4 tests) and PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add blender
git commit -m "Place a light switch beside each lit room's door

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Room chunks

**Files:**
- Create: `blender/pipeline/chunks.py`, `blender/tests/test_chunks.py`

**Interfaces:**
- Consumes: `bpyutil.join`, `bpyutil.split_by_face_values`, `bpyutil.polygon_vectors`, `geom.FloorIndex.locate_many`.
- Produces: `chunks.dice_large_faces(obj, cell, max_area) -> bool` and `chunks.build_chunks(static_objs, floor_index) -> list[{"node": "Room_<key>", "room": room_id | None, "key": room_id | "exterior"}]`, sorted by FloorIndex order with exterior last. Meshes with big faces (the ceiling, slab and walls) are first cut on a 25 cm grid, so a single face can't span several rooms. Each face then goes to the room whose floor contains the point 5 cm in front of it. Failing that, it goes to the nearest floor within 0.2 m (faces over interior walls); otherwise to `exterior`.

- [ ] **Step 1: Write the failing tests**

`blender/tests/test_chunks.py`:

```python
import unittest

import bpy

from pipeline import chunks, rooms, scene_select
from tests import fixture_scene


class ChunkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        static = [o for o in meshes if not o.name.startswith("Door leaf")]
        cls.result = chunks.build_chunks(static, index)

    def test_chunk_list(self):
        self.assertEqual(self.result, [
            {"node": "Room_alpha", "room": "alpha", "key": "alpha"},
            {"node": "Room_beta", "room": "beta", "key": "beta"},
            {"node": "Room_exterior", "room": None, "key": "exterior"},
        ])

    def test_sources_are_consumed_and_door_kept(self):
        for name in ("Walls", "Floor - Alpha", "Table", "Ceiling"):
            self.assertNotIn(name, bpy.data.objects)
        self.assertIn("Door leaf 1", bpy.data.objects)

    def test_faces_land_on_the_correct_side(self):
        # The single big ceiling face is diced, so each room only gets its own part of it.
        alpha = bpy.data.objects["Room_alpha"].data
        beta = bpy.data.objects["Room_beta"].data
        self.assertLessEqual(max(v.co.x for v in alpha.vertices), 3.2 + 1e-4)
        self.assertGreaterEqual(min(v.co.x for v in beta.vertices), 3.0 - 1e-4)
        names = {m.name for m in alpha.materials}
        self.assertIn("Tile proc", {n.split(" [")[0] for n in names})

    def test_outer_wall_faces_are_exterior(self):
        ext = bpy.data.objects["Room_exterior"].data
        self.assertAlmostEqual(min(v.co.x for v in ext.vertices), -0.2, places=3)


if __name__ == "__main__":
    unittest.main()
```

The fixture's procedural floor isn't baked here (this test skips the albedo stage), so the material is still named `Tile proc`. The assertion strips the `[...]` suffix so it works either way.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test-blender TESTS=test_chunks.py`
Expected: FAIL with `ImportError: cannot import name 'chunks'`

- [ ] **Step 3: Implement `chunks.py`**

`blender/pipeline/chunks.py`:

```python
"""Merge all static geometry, then split it into one chunk per room (+ exterior)."""
import bmesh
import numpy as np

from . import bpyutil, config


def dice_large_faces(obj, cell, max_area):
    """Cut a mesh on a vertical-plane grid so no face spans more than one room. Returns True if cut."""
    me = obj.data
    if len(me.polygons) == 0 or bpyutil.polygon_scalars(me, "area").max() <= max_area:
        return False
    co = bpyutil.world_coords(obj)
    bm = bmesh.new()
    bm.from_mesh(me)
    for axis in (0, 1):
        normal = (1.0, 0.0, 0.0) if axis == 0 else (0.0, 1.0, 0.0)
        for v in np.arange(co[:, axis].min() + cell, co[:, axis].max(), cell):
            point = [0.0, 0.0, 0.0]
            point[axis] = float(v)
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                                   plane_co=point, plane_no=normal)
    bm.to_mesh(me)
    bm.free()
    return True


def build_chunks(static_objs, floor_index):
    for obj in static_objs:
        dice_large_faces(obj, config.DICE_CELL, config.DICE_MAX_FACE_AREA)
    joined = bpyutil.join(list(static_objs), "ALL_STATIC")
    me = joined.data
    centre = bpyutil.polygon_vectors(me, "center")
    normal = bpyutil.polygon_vectors(me, "normal")
    probe = centre[:, :2] + normal[:, :2] * 0.05
    idx = floor_index.locate_many(np.stack([probe[:, 0], -probe[:, 1]], axis=1), config.ROOM_ASSIGN_MAX_DIST)
    keys = list(floor_index.ids) + ["exterior"]
    idx[idx < 0] = len(floor_index.ids)
    parts = bpyutil.split_by_face_values(joined, idx, lambda v: f"Room_{keys[v]}")
    return [
        {"node": obj.name, "room": keys[v] if v < len(floor_index.ids) else None, "key": keys[v]}
        for v, obj in sorted(parts.items())
    ]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test-blender TESTS=test_chunks.py`
Expected: PASS, 4 tests, `OK`

- [ ] **Step 5: Commit**

```bash
git add blender
git commit -m "Split static geometry into per-room chunks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Lightmap UVs

**Files:**
- Create: `blender/pipeline/uvs.py`, `blender/tests/test_uvs.py`

**Interfaces:**
- Consumes: `raster.texture_size_for_area`, `bpyutil.select_only`, `bpyutil.polygon_scalars`.
- Produces: `uvs.add_lightmap_uvs(obj, texels_per_m, lo, hi) -> int` (lightmap size). After it runs, `obj.data.uv_layers` is exactly `["UVMap", "UVLightmap"]`, `UVMap` is the render-active map, and `UVLightmap` is smart-projected into [0, 1] with a 2-texel island margin (8 texels collapsed islands on small maps and wastes space on chunks with thousands of islands; the bake's 4-px margin only fills empty texels).

- [ ] **Step 1: Write the failing tests**

`blender/tests/test_uvs.py`:

```python
import unittest

import bpy
import numpy as np

from pipeline import chunks, rooms, scene_select, uvs
from tests import fixture_scene


class UvTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        meshes, _ = scene_select.prepare_scene(bpy.context.scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, bpy.context.scene)
        static = [o for o in meshes if not o.name.startswith("Door leaf")]
        chunks.build_chunks(static, index)
        cls.obj = bpy.data.objects["Room_alpha"]
        cls.size = uvs.add_lightmap_uvs(cls.obj, 8, 32, 64)
        cls.door_size = uvs.add_lightmap_uvs(bpy.data.objects["Door leaf 1"], 0, 32, 32)

    def test_layers(self):
        layers = self.obj.data.uv_layers
        self.assertEqual([l.name for l in layers], ["UVMap", "UVLightmap"])
        self.assertTrue(layers["UVMap"].active_render)

    def test_lightmap_uvs_are_laid_out(self):
        lm = self.obj.data.uv_layers["UVLightmap"]
        uv = np.empty(len(lm.data) * 2)
        lm.data.foreach_get("uv", uv)
        self.assertGreaterEqual(uv.min(), -1e-4)
        self.assertLessEqual(uv.max(), 1 + 1e-4)
        self.assertGreater(uv.std(), 0.05)

    def test_sizes(self):
        self.assertIn(self.size, (32, 64))
        self.assertEqual(self.door_size, 32)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test-blender TESTS=test_uvs.py`
Expected: FAIL with `ImportError: cannot import name 'uvs'`

- [ ] **Step 3: Implement `uvs.py`**

`blender/pipeline/uvs.py`:

```python
"""Second UV map for baked lighting."""
import math

import bpy

from . import bpyutil, raster


def add_lightmap_uvs(obj, texels_per_m, lo, hi):
    me = obj.data
    if len(me.uv_layers) == 0:
        me.uv_layers.new(name="UVMap")
    if me.uv_layers[0].name != "UVMap":
        raise RuntimeError(f"{obj.name}: first UV map is {me.uv_layers[0].name!r}, expected 'UVMap'")
    if "UVLightmap" in me.uv_layers:
        me.uv_layers.remove(me.uv_layers["UVLightmap"])
    lm = me.uv_layers.new(name="UVLightmap")
    me.uv_layers.active = lm
    me.uv_layers["UVMap"].active_render = True
    area = float(bpyutil.polygon_scalars(me, "area").sum())
    size = raster.texture_size_for_area(area, texels_per_m, lo, hi)
    bpyutil.select_only([obj], obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), margin_method="FRACTION",
                             island_margin=2 / size, area_weight=1.0, correct_aspect=True,
                             scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    return size
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test-blender TESTS=test_uvs.py`
Expected: PASS, 3 tests, `OK`

- [ ] **Step 5: Commit**

```bash
git add blender
git commit -m "Generate lightmap UVs for chunks and doors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Lighting bakes and RGBM WebP output

**Files:**
- Create: `blender/pipeline/bake.py`, `blender/tests/test_bake.py`

**Interfaces:**
- Consumes: `bpyutil.set_cycles`, `bpyutil.select_only`, `raster.masked_blur`, `raster.rgbm_encode`, state dict fields `rooms`, `chunks` (with `size`), `doors`, `door_lightmap_size`, `day_lights`.
- Produces: `bake.Lighting(scene, day_lights, room_lights)` with `.day()`, `.room(room_id)` and `.restore()`. Also `bake.bake_lighting(obj, size, name) -> Image`, `bake.encode_and_save(img, path, blur_sigma) -> range`, and `bake.bake_all(scene, state, quality, out_dir) -> dict["<key>_<layer>", range]`. Files are written to `<out_dir>/lightmaps/<key>_<layer>.webp`, with layer `day` or `light`.

- [ ] **Step 1: Write the failing tests**

`blender/tests/test_bake.py`:

```python
import os
import tempfile
import unittest

import bpy
import numpy as np

from pipeline import bake, chunks, config, rooms, scene_select, uvs
from tests import fixture_scene


def _load_decoded(path, rng):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    return px[:, :3] * px[:, 3:4] * rng


class LightingStateTests(unittest.TestCase):
    def test_room_state_and_restore(self):
        fixture_scene.build()
        scene = bpy.context.scene
        _, day = scene_select.prepare_scene(scene, bpy.context.view_layer)
        lighting = bake.Lighting(scene, day, {"alpha": "Ceiling light Alpha", "beta": "Ceiling light Beta"})
        glow = next(n for n in bpy.data.materials["Lamp glow"].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bg = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
        lighting.room("alpha")
        self.assertTrue(bpy.data.objects["Sun"].hide_render)
        self.assertFalse(bpy.data.objects["Ceiling light Alpha"].hide_render)
        self.assertTrue(bpy.data.objects["Ceiling light Beta"].hide_render)
        self.assertEqual(bg.inputs["Strength"].default_value, 0.0)
        self.assertEqual(glow.inputs["Emission Strength"].default_value, 0.0)
        lighting.day()
        self.assertFalse(bpy.data.objects["Sun"].hide_render)
        self.assertTrue(bpy.data.objects["Ceiling light Alpha"].hide_render)
        self.assertEqual(glow.inputs["Emission Strength"].default_value, 2.0)
        lighting.restore()
        self.assertEqual(bg.inputs["Strength"].default_value, 1.0)


class BakeAllTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        scene = bpy.context.scene
        meshes, day = scene_select.prepare_scene(scene, bpy.context.view_layer)
        index, room_list = rooms.collect_rooms(meshes, scene)
        leaf = bpy.data.objects["Door leaf 1"]
        static = [o for o in meshes if o != leaf]
        chunk_list = chunks.build_chunks(static, index)
        q = config.QUALITY["test"]
        for c in chunk_list:
            c["size"] = uvs.add_lightmap_uvs(bpy.data.objects[c["node"]], q.lightmap_texels_per_m, q.lightmap_min, q.lightmap_max)
        uvs.add_lightmap_uvs(leaf, 0, q.door_lightmap, q.door_lightmap)
        state = {"rooms": room_list, "chunks": chunk_list, "day_lights": day,
                 "doors": [{"node": leaf.name, "key": "door-1"}], "door_lightmap_size": q.door_lightmap}
        cls.out = tempfile.mkdtemp()
        cls.ranges = bake.bake_all(scene, state, q, cls.out)

    def test_files_and_ranges(self):
        expected = {"alpha_day", "beta_day", "exterior_day", "door-1_day", "alpha_light", "beta_light"}
        self.assertEqual(set(self.ranges), expected)
        for key in expected:
            self.assertTrue(os.path.exists(os.path.join(self.out, "lightmaps", f"{key}.webp")), key)
            self.assertGreaterEqual(self.ranges[key], 1.0)

    def test_room_light_bake_has_light(self):
        lit = _load_decoded(os.path.join(self.out, "lightmaps", "alpha_light.webp"), self.ranges["alpha_light"])
        self.assertGreater(lit.max(), 0.01)

    def test_cleanup(self):
        for mat in bpy.data.materials:
            if mat.node_tree:
                self.assertNotIn(bake.BAKE_NODE, mat.node_tree.nodes)
        self.assertFalse(bpy.data.objects["Sun"].hide_render)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `make test-blender TESTS=test_bake.py`
Expected: FAIL with `ImportError: cannot import name 'bake'`

- [ ] **Step 3: Implement `bake.py`**

`blender/pipeline/bake.py`:

```python
"""Bake daylight and per-room ceiling-light layers, then save them as RGBM WebP."""
import os

import bpy
import numpy as np

from . import bpyutil, raster

BAKE_NODE = "WEB_LIGHTMAP_TARGET"


def _emission_sockets():
    sockets = []
    for mat in bpy.data.materials:
        if mat.node_tree is None:
            continue
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                sockets.append(n.inputs["Emission Strength"])
            elif n.type == "EMISSION":
                sockets.append(n.inputs["Strength"])
    return [(s, s.default_value) for s in sockets if s.default_value > 0]


class Lighting:
    """Switch the scene between the daylight bake setup and one room's ceiling light."""

    def __init__(self, scene, day_lights, room_lights):
        self.day_lights = set(day_lights)
        self.room_lights = dict(room_lights)
        self.lights = [o for o in scene.objects if o.type == "LIGHT"]
        self.saved_hide = {o.name: o.hide_render for o in self.lights}
        self.background = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
        self.saved_strength = self.background.inputs["Strength"].default_value
        self.emitters = _emission_sockets()

    def day(self):
        ceiling = set(self.room_lights.values())
        for o in self.lights:
            o.hide_render = not (o.name in self.day_lights and o.name not in ceiling)
        self.background.inputs["Strength"].default_value = self.saved_strength
        for socket, value in self.emitters:
            socket.default_value = value

    def room(self, room_id):
        keep = self.room_lights[room_id]
        for o in self.lights:
            o.hide_render = o.name != keep
        self.background.inputs["Strength"].default_value = 0.0
        for socket, _ in self.emitters:
            socket.default_value = 0.0

    def restore(self):
        for o in self.lights:
            o.hide_render = self.saved_hide[o.name]
        self.background.inputs["Strength"].default_value = self.saved_strength
        for socket, value in self.emitters:
            socket.default_value = value


def _target_node(mat):
    node = mat.node_tree.nodes.get(BAKE_NODE)
    if node is None:
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.name = BAKE_NODE
    return node


def bake_lighting(obj, size, name):
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    for slot in obj.material_slots:
        if slot.material is None:
            continue
        node = _target_node(slot.material)
        node.image = img
        slot.material.node_tree.nodes.active = node
    bpyutil.select_only([obj], obj)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=4,
                        margin_type="EXTEND", use_clear=True, uv_layer="UVLightmap",
                        target="IMAGE_TEXTURES")
    return img


def encode_and_save(img, path, blur_sigma):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    mask = px[..., 3] > 0.5
    rgb = raster.masked_blur(px[..., :3], mask, blur_sigma)
    rgba, rng = raster.rgbm_encode(rgb, mask)
    out = bpy.data.images.new(img.name + "_rgbm", w, h, alpha=True, float_buffer=False)
    out.colorspace_settings.name = "Non-Color"
    out.alpha_mode = "STRAIGHT"
    out.pixels.foreach_set(rgba.ravel())
    out.file_format = "WEBP"
    out.save(filepath=path, quality=100)  # quality 100 = lossless WebP
    bpy.data.images.remove(out)
    bpy.data.images.remove(img)
    return rng


def remove_bake_nodes():
    for mat in bpy.data.materials:
        if mat.node_tree and BAKE_NODE in mat.node_tree.nodes:
            mat.node_tree.nodes.remove(mat.node_tree.nodes[BAKE_NODE])


def bake_all(scene, state, quality, out_dir):
    device = bpyutil.set_cycles(scene, quality.bake_samples)
    print(f"[bake] Cycles on {device}, {quality.bake_samples} samples", flush=True)
    os.makedirs(os.path.join(out_dir, "lightmaps"), exist_ok=True)
    room_lights = {r["id"]: r["light"] for r in state["rooms"] if r["light"]}
    lighting = Lighting(scene, state["day_lights"], room_lights)
    ranges = {}

    def run(node, key, layer, size):
        img = bake_lighting(bpy.data.objects[node], size, f"lm_{key}_{layer}")
        path = os.path.join(out_dir, "lightmaps", f"{key}_{layer}.webp")
        ranges[f"{key}_{layer}"] = encode_and_save(img, path, quality.blur_sigma_px)
        print(f"[bake] {key}_{layer} {size}px range {ranges[f'{key}_{layer}']}", flush=True)

    try:
        lighting.day()
        for c in state["chunks"]:
            run(c["node"], c["key"], "day", c["size"])
        for d in state["doors"]:
            run(d["node"], d["key"], "day", state["door_lightmap_size"])
        for c in state["chunks"]:
            if c["room"] in room_lights:
                lighting.room(c["room"])
                run(c["node"], c["key"], "light", c["size"])
    finally:
        lighting.restore()
        remove_bake_nodes()
    return ranges
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test-blender TESTS=test_bake.py`
Expected: PASS, 4 tests, `OK`

If `test_room_light_bake_has_light` fails because baked texels have alpha 0, check what `use_clear` writes: print `px[..., 3]` min/max in `encode_and_save`. If baked texels aren't alpha 1, build the mask from `px[..., :3].max(-1) > 0` instead.

- [ ] **Step 5: Commit**

```bash
git add blender
git commit -m "Bake daylight and room-light lightmaps to RGBM WebP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Manifest, export, checks, debug map and CLI

**Files:**
- Create: `blender/pipeline/manifest.py`, `blender/pipeline/export.py`, `blender/pipeline/checks.py`, `blender/pipeline/debug_map.py`, `blender/pipeline/run.py`, `blender/export_web.py`, `blender/tests/test_manifest.py`, `blender/tests/test_end_to_end.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `manifest.build_manifest(state, ranges, eye_height) -> dict` and `manifest.validate_manifest(m) -> list[str]`, which is pure. The manifest schema is below and is the contract the web app relies on.
- Produces: `export.camera_pose(cam) -> {"name", "position": [x,y,z], "yaw", "pitch", "hfov"}`, `export.spawn_from(scene, rooms) -> {"x","z","yaw"}`, `export.viewpoints(scene) -> list`, `export.export_glb(objs, path)`, `export.write_json(path, data)`.
- Produces: `checks.read_glb_json(path) -> dict`, `checks.check_outputs(out_dir, manifest, budget_bytes, expected_doors) -> list[str]`, `checks.check_scene(state) -> list[str]` (bpy).
- Produces: `debug_map.render_map(grid, doors, switch_points, spawn, scale=4) -> np.ndarray (H, W, 3)` and `debug_map.save_map(...)`.
- Produces: `run.prepare(scene, quality, out_dir, build_dir, stop_after="uvs") -> ctx dict`, `run.bake_stage(scene, quality, out_dir)`, `run.export_stage(scene, out_dir, expected_doors, budget) -> list[str] errors`, and `run.run_all(quality_name, out_dir, build_dir, expected_doors=10, budget=FIRST_VIEW_BUDGET_BYTES) -> list[str]`.
- Produces: the CLI `blender -b <file> --python blender/export_web.py -- --quality test|preview|final --out DIR --build DIR [--stage all|bake|export]`.

Manifest schema (`manifest.json`, three.js space):

```json
{
  "version": 1,
  "eyeHeight": 1.6,
  "spawn": { "x": -0.95, "z": -1.45, "yaw": 0.0 },
  "rooms": [{ "id": "sala", "name": "Sala", "floor": [0, 0, 1, 0, 1, 1], "switch": "Switch_sala" }],
  "chunks": [{ "node": "Room_sala", "room": "sala",
               "day": { "file": "lightmaps/sala_day.webp", "range": 6.5 },
               "light": { "file": "lightmaps/sala_light.webp", "range": 3.0 } }],
  "doors": [{ "node": "Door_1", "hinge": [0.1, -2.2], "dir": [0, 1], "width": 0.75,
              "openAngle": -1.5708, "lightmap": { "file": "lightmaps/door-1_day.webp", "range": 2.0 } }],
  "viewpoints": [{ "name": "Cam_Sala", "position": [2.85, 1.6, 1.55], "yaw": 0.3, "pitch": -0.05, "hfov": 1.57 }]
}
```

`collision.json` is `Grid.to_json(radius)`.

- [ ] **Step 1: Write the failing manifest tests (pure)**

`blender/tests/test_manifest.py`:

```python
import unittest

from pipeline import manifest

STATE = {
    "rooms": [
        {"id": "alpha", "name": "Alpha", "floor": [0, 0, 1, 0, 1, 1], "light": "Ceiling light Alpha"},
        {"id": "porch", "name": "Porch", "floor": [2, 0, 3, 0, 3, 1], "light": None},
    ],
    "switches": {"alpha": "Switch_alpha"},
    "chunks": [
        {"node": "Room_alpha", "room": "alpha", "key": "alpha", "size": 64},
        {"node": "Room_porch", "room": "porch", "key": "porch", "size": 64},
        {"node": "Room_exterior", "room": None, "key": "exterior", "size": 64},
    ],
    "doors": [{"node": "Door_1", "key": "door-1", "hinge": [3.1, -1.78], "dir": [0, 1], "width": 0.76, "openAngle": -1.5708}],
    "spawn": {"x": 1.0, "z": -0.8, "yaw": -1.5708},
    "viewpoints": [],
}
RANGES = {"alpha_day": 4.0, "alpha_light": 2.0, "porch_day": 3.0, "exterior_day": 8.0, "door-1_day": 2.5}


class ManifestTests(unittest.TestCase):
    def test_build(self):
        m = manifest.build_manifest(STATE, RANGES, 1.6)
        self.assertEqual(m["version"], 1)
        self.assertEqual(m["rooms"][0], {"id": "alpha", "name": "Alpha", "floor": [0, 0, 1, 0, 1, 1], "switch": "Switch_alpha"})
        self.assertEqual(m["rooms"][1]["switch"], None)
        self.assertEqual(m["chunks"][0]["light"], {"file": "lightmaps/alpha_light.webp", "range": 2.0})
        self.assertIsNone(m["chunks"][1]["light"])
        self.assertEqual(m["doors"][0]["lightmap"], {"file": "lightmaps/door-1_day.webp", "range": 2.5})
        self.assertNotIn("key", m["doors"][0])
        self.assertEqual(manifest.validate_manifest(m), [])

    def test_validate_reports_missing_pieces(self):
        m = manifest.build_manifest(STATE, {k: v for k, v in RANGES.items() if k != "alpha_light"}, 1.6)
        errors = manifest.validate_manifest(m)
        self.assertIn("chunks[0] (Room_alpha): room has a switch but no light lightmap", errors)
        m2 = manifest.build_manifest(STATE, {k: v for k, v in RANGES.items() if k != "porch_day"}, 1.6)
        self.assertIn("chunks[1] (Room_porch): missing day lightmap", manifest.validate_manifest(m2))

    def test_validate_reports_lit_room_without_switch_and_room_without_chunk(self):
        state = dict(STATE, switches={})
        self.assertIn("room alpha: has a light layer but no switch",
                      manifest.validate_manifest(manifest.build_manifest(state, RANGES, 1.6)))
        state = dict(STATE, chunks=[c for c in STATE["chunks"] if c["room"] != "porch"])
        self.assertIn("room porch: no chunk",
                      manifest.validate_manifest(manifest.build_manifest(state, RANGES, 1.6)))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Write the failing end-to-end test**

`blender/tests/test_end_to_end.py`:

```python
import json
import os
import tempfile
import unittest

import bpy

from pipeline import checks, run
from tests import fixture_scene


class EndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_scene.build()
        root = tempfile.mkdtemp()
        cls.out = os.path.join(root, "assets")
        cls.build = os.path.join(root, "build")
        cls.errors = run.run_all("test", cls.out, cls.build, expected_doors=1)

    def test_no_check_errors(self):
        self.assertEqual(self.errors, [])

    def test_outputs(self):
        for name in ("apartment.glb", "manifest.json", "collision.json"):
            self.assertTrue(os.path.exists(os.path.join(self.out, name)), name)
        self.assertTrue(os.path.exists(os.path.join(self.build, "web-export.blend")))
        self.assertTrue(os.path.exists(os.path.join(self.build, "debug_map.png")))

    def test_manifest_content(self):
        with open(os.path.join(self.out, "manifest.json")) as f:
            m = json.load(f)
        self.assertEqual([r["id"] for r in m["rooms"]], ["alpha", "beta"])
        self.assertEqual({c["node"] for c in m["chunks"]}, {"Room_alpha", "Room_beta", "Room_exterior"})
        self.assertAlmostEqual(m["spawn"]["yaw"], -1.5708, places=3)  # Cam_Entrada looks +X
        self.assertEqual([v["name"] for v in m["viewpoints"]], ["Cam_Sala"])

    def test_glb_has_lightmap_uvs(self):
        gltf = checks.read_glb_json(os.path.join(self.out, "apartment.glb"))
        names = {n["name"] for n in gltf["nodes"]}
        self.assertTrue({"Room_alpha", "Door_1", "Switch_alpha"} <= names)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `make test-blender TESTS=test_manifest.py`, then `make test-blender TESTS=test_end_to_end.py`
Expected: both FAIL with `ImportError` (`manifest`, `run`)

- [ ] **Step 4: Implement `manifest.py`**

`blender/pipeline/manifest.py`:

```python
"""Assemble and validate manifest.json (pure)."""


def build_manifest(state, ranges, eye_height):
    def ref(key, layer):
        name = f"{key}_{layer}"
        return {"file": f"lightmaps/{name}.webp", "range": ranges[name]} if name in ranges else None

    rooms = [
        {"id": r["id"], "name": r["name"], "floor": r["floor"], "switch": state["switches"].get(r["id"])}
        for r in state["rooms"]
    ]
    chunks = [
        {"node": c["node"], "room": c["room"], "day": ref(c["key"], "day"), "light": ref(c["key"], "light")}
        for c in state["chunks"]
    ]
    doors = [
        {**{k: d[k] for k in ("node", "hinge", "dir", "width", "openAngle")}, "lightmap": ref(d["key"], "day")}
        for d in state["doors"]
    ]
    return {
        "version": 1, "eyeHeight": eye_height, "spawn": state["spawn"],
        "rooms": rooms, "chunks": chunks, "doors": doors, "viewpoints": state["viewpoints"],
    }


def validate_manifest(m):
    errors = []
    if m.get("version") != 1:
        errors.append("version must be 1")
    switched = {r["id"] for r in m["rooms"] if r["switch"]}
    for i, c in enumerate(m["chunks"]):
        label = f"chunks[{i}] ({c['node']})"
        if c["day"] is None:
            errors.append(f"{label}: missing day lightmap")
        if c["room"] in switched and c["light"] is None:
            errors.append(f"{label}: room has a switch but no light lightmap")
    for i, d in enumerate(m["doors"]):
        if d["lightmap"] is None:
            errors.append(f"doors[{i}] ({d['node']}): missing lightmap")
    chunk_rooms = {c["room"] for c in m["chunks"]}
    lit_rooms = {c["room"] for c in m["chunks"] if c["light"]}
    for r in m["rooms"]:
        if r["id"] not in chunk_rooms:
            errors.append(f"room {r['id']}: no chunk")
        if r["id"] in lit_rooms and not r["switch"]:
            errors.append(f"room {r['id']}: has a light layer but no switch")
    for k in ("x", "z", "yaw"):
        if not isinstance(m["spawn"].get(k), (int, float)):
            errors.append(f"spawn.{k} must be a number")
    return errors
```

- [ ] **Step 5: Implement `export.py`, `checks.py` and `debug_map.py`**

`blender/pipeline/export.py`:

```python
"""Camera poses, glTF export and JSON writing."""
import json
import os

import bpy
import numpy as np
from mathutils import Vector

from . import bpyutil, config, geom


def camera_pose(cam):
    m = cam.matrix_world
    pos = geom.to_three(tuple(m.translation))
    fwd = geom.to_three(tuple(m.to_3x3() @ Vector((0.0, 0.0, -1.0))))
    yaw, pitch = geom.yaw_pitch_from_forward(fwd)
    return {
        "name": cam.name,
        "position": [round(v, 4) for v in pos],
        "yaw": round(yaw, 5),
        "pitch": round(pitch, 5),
        "hfov": round(cam.data.angle_x, 5),
    }


def spawn_from(scene, room_list):
    cam = scene.objects.get(config.SPAWN_CAMERA)
    if cam is not None:
        p = camera_pose(cam)
        return {"x": p["position"][0], "z": p["position"][2], "yaw": p["yaw"]}
    c = np.asarray(room_list[0]["floor"]).reshape(-1, 2).mean(0)
    return {"x": round(float(c[0]), 4), "z": round(float(c[1]), 4), "yaw": 0.0}


def viewpoints(scene):
    return [camera_pose(scene.objects[n]) for n in config.VIEWPOINT_CAMERAS if n in scene.objects]


def export_glb(objs, path):
    bpyutil.select_only(objs, objs[0])
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_image_format="WEBP", export_image_quality=90,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_draco_texcoord_quantization=14, export_cameras=False, export_lights=False,
        export_extras=False, export_yup=True,
    )


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
```

`blender/pipeline/checks.py`:

```python
"""Self-checks that run after every export; any message means the export is not usable."""
import json
import os
import struct

from . import geom, manifest as manifest_mod


def read_glb_json(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, _, _ = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ValueError(f"{path} is not a GLB file")
    length, kind = struct.unpack_from("<I4s", data, 12)
    if kind != b"JSON":
        raise ValueError(f"{path}: first chunk is not JSON")
    return json.loads(data[20:20 + length])


def check_outputs(out_dir, m, budget_bytes, expected_doors):
    errors = list(manifest_mod.validate_manifest(m))
    refs = [c["day"] for c in m["chunks"]] + [c["light"] for c in m["chunks"]] + [d["lightmap"] for d in m["doors"]]
    for ref in refs:
        if ref and not os.path.exists(os.path.join(out_dir, ref["file"])):
            errors.append(f"missing file {ref['file']}")
    for name in ("apartment.glb", "collision.json", "manifest.json"):
        if not os.path.exists(os.path.join(out_dir, name)):
            errors.append(f"missing file {name}")
    if errors:
        return errors
    if len(m["doors"]) != expected_doors:
        errors.append(f"expected {expected_doors} doors, found {len(m['doors'])}")
    gltf = read_glb_json(os.path.join(out_dir, "apartment.glb"))
    nodes = {n["name"]: n for n in gltf["nodes"]}
    for name in [c["node"] for c in m["chunks"]] + [d["node"] for d in m["doors"]]:
        node = nodes.get(name)
        if node is None or "mesh" not in node:
            errors.append(f"glb has no mesh node {name}")
            continue
        for p in gltf["meshes"][node["mesh"]]["primitives"]:
            if "TEXCOORD_1" not in p["attributes"]:
                errors.append(f"glb node {name}: a primitive lacks TEXCOORD_1 (lightmap UVs)")
                break
    for sw in [r["switch"] for r in m["rooms"] if r["switch"]]:
        if sw not in nodes:
            errors.append(f"glb has no switch node {sw}")
    first_view = ["apartment.glb", "collision.json", "manifest.json"] + [c["day"]["file"] for c in m["chunks"]] + [
        d["lightmap"]["file"] for d in m["doors"]
    ]
    total = sum(os.path.getsize(os.path.join(out_dir, f)) for f in first_view)
    if total > budget_bytes:
        errors.append(f"first-view download is {total / 1048576:.1f} MB, budget {budget_bytes / 1048576:.0f} MB")
    return errors


def check_scene(state):
    import bpy

    from .proc_materials import is_procedural

    errors = []
    names = [c["node"] for c in state["chunks"]] + [d["node"] for d in state["doors"]]
    for name in names:
        obj = bpy.data.objects[name]
        if [l.name for l in obj.data.uv_layers] != ["UVMap", "UVLightmap"]:
            errors.append(f"{name}: UV maps are {[l.name for l in obj.data.uv_layers]}")
        for slot in obj.material_slots:
            mat = slot.material
            if is_procedural(mat):
                errors.append(f"{name}: material {mat.name} is still procedural")
                continue
            bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if mat else None
            if bsdf and bsdf.inputs["Base Color"].is_linked:
                src = bsdf.inputs["Base Color"].links[0].from_node.type
                if src != "TEX_IMAGE":
                    errors.append(f"{name}: material {mat.name} base colour comes from {src}, which glTF cannot export")
    for d in state["doors"]:
        loc = bpy.data.objects[d["node"]].location
        bx, by = geom.from_three_xz(*d["hinge"])
        if abs(loc.x - bx) > 1e-3 or abs(loc.y - by) > 1e-3:
            errors.append(f"{d['node']}: origin is not at its hinge")
    return errors
```

`blender/pipeline/debug_map.py`:

```python
"""Top-down PNG for reviewing collision, door swings, switches and spawn (build/debug_map.png)."""
import math

import numpy as np

from . import geom


def render_map(grid, doors, switch_points, spawn, scale=4):
    """Row 0 of the result is the smallest z (Blender +y, 'north' at the top)."""
    img = np.ones((grid.height, grid.width, 3))
    img[grid.blocked] = 0.8
    img[grid.raw] = 0.35
    img = img.repeat(scale, 0).repeat(scale, 1)

    def dot(x, z, color, r=1):
        i = int((x - grid.x0) / grid.cell * scale)
        j = int((z - grid.z0) / grid.cell * scale)
        img[max(j - r, 0):j + r + 1, max(i - r, 0):i + r + 1] = color

    for d in doors:
        hx, hz = d["hinge"]
        for angle, color in ((0.0, (0.9, 0.1, 0.1)), (d["openAngle"], (0.1, 0.7, 0.1))):
            vx, vz = geom.rot_y(d["dir"], angle)
            for k in range(21):
                f = d["width"] * k / 20
                dot(hx + vx * f, hz + vz * f, color, 0)
    for x, z in switch_points:
        dot(x, z, (0.1, 0.3, 0.95), 2)
    dot(spawn["x"], spawn["z"], (0.95, 0.8, 0.1), 3)
    dx, dz = -math.sin(spawn["yaw"]), -math.cos(spawn["yaw"])
    for k in range(1, 9):
        dot(spawn["x"] + dx * 0.05 * k, spawn["z"] + dz * 0.05 * k, (0.95, 0.8, 0.1), 1)
    return img


def save_map(path, grid, doors, switch_points, spawn):
    import bpy

    rgb = render_map(grid, doors, switch_points, spawn)
    h, w, _ = rgb.shape
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = rgb[::-1]  # Blender stores the bottom row first
    img = bpy.data.images.new("debug_map", w, h, alpha=True)
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.save(filepath=path)
    bpy.data.images.remove(img)
```

- [ ] **Step 6: Implement `run.py` and the CLI**

`blender/pipeline/run.py`:

```python
"""Stage orchestration: prepare (geometry), bake (lighting), export (files + checks)."""
import os

import bpy

from . import (bake, chunks, checks, collision, config, debug_map, doors, export, manifest,
               openings, proc_materials, rooms, scene_select, state, switches, uvs)


def prepare(scene, quality, out_dir, build_dir, stop_after="uvs"):
    os.makedirs(build_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    # First action: switch to a copy so the source .blend is never written.
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(build_dir, "web-export.blend"))

    meshes, day_lights = scene_select.prepare_scene(scene, bpy.context.view_layer)
    floor_index, room_list = rooms.collect_rooms(meshes, scene)
    ctx = {"meshes": meshes, "day_lights": day_lights, "floor_index": floor_index, "rooms": room_list}
    if stop_after == "select":
        return ctx

    ctx["albedo"] = proc_materials.bake_procedural_albedo(meshes, quality)
    if stop_after == "albedo":
        return ctx

    ops, infilled = openings.parse_openings(meshes)
    grid = collision.build_collision(meshes, floor_index, ops)
    export.write_json(os.path.join(out_dir, "collision.json"), grid.to_json(config.PLAYER_RADIUS))
    ctx.update(openings=ops, infilled=infilled, grid=grid)
    if stop_after == "collision":
        return ctx

    leaves = [o for o in meshes if o.name.startswith("Door leaf")]
    door_specs = doors.prepare_doors(leaves, grid, config.DOOR_OVERRIDES)
    ctx["doors"] = door_specs
    if stop_after == "doors":
        return ctx

    sw = switches.place_switches(room_list, ops, infilled, floor_index, grid,
                                 bpy.data.collections["WEB"], config.SWITCH_OVERRIDES)
    ctx["switches"] = sw
    if stop_after == "switches":
        return ctx

    door_names = {d["node"] for d in door_specs}
    static = [o for o in meshes if o.name not in door_names]
    chunk_list = chunks.build_chunks(static, floor_index)
    ctx["chunks"] = chunk_list
    if stop_after == "chunks":
        return ctx

    for c in chunk_list:
        c["size"] = uvs.add_lightmap_uvs(bpy.data.objects[c["node"]], quality.lightmap_texels_per_m,
                                         quality.lightmap_min, quality.lightmap_max)
    for d in door_specs:
        uvs.add_lightmap_uvs(bpy.data.objects[d["node"]], 0, quality.door_lightmap, quality.door_lightmap)

    st = {
        "rooms": room_list, "switches": sw, "doors": door_specs, "chunks": chunk_list,
        "door_lightmap_size": quality.door_lightmap, "day_lights": day_lights,
        "spawn": export.spawn_from(scene, room_list), "viewpoints": export.viewpoints(scene),
    }
    state.save(scene, st)
    switch_points = [(bpy.data.objects[n].location.x, -bpy.data.objects[n].location.y) for n in sw.values()]
    debug_map.save_map(os.path.join(build_dir, "debug_map.png"), grid, door_specs, switch_points, st["spawn"])
    bpy.ops.wm.save_mainfile()
    ctx["state"] = st
    return ctx


def bake_stage(scene, quality, out_dir):
    st = state.load(scene)
    st["ranges"] = bake.bake_all(scene, st, quality, out_dir)
    state.save(scene, st)
    bpy.ops.wm.save_mainfile()


def export_stage(scene, out_dir, expected_doors, budget):
    st = state.load(scene)
    names = [c["node"] for c in st["chunks"]] + [d["node"] for d in st["doors"]] + list(st["switches"].values())
    export.export_glb([bpy.data.objects[n] for n in names], os.path.join(out_dir, "apartment.glb"))
    m = manifest.build_manifest(st, st["ranges"], config.EYE_HEIGHT)
    export.write_json(os.path.join(out_dir, "manifest.json"), m)
    return checks.check_scene(st) + checks.check_outputs(out_dir, m, budget, expected_doors)


def run_all(quality_name, out_dir, build_dir, expected_doors=config.EXPECTED_DOOR_COUNT,
            budget=config.FIRST_VIEW_BUDGET_BYTES):
    quality = config.QUALITY[quality_name]
    scene = bpy.context.scene
    out_dir, build_dir = os.path.abspath(out_dir), os.path.abspath(build_dir)
    prepare(scene, quality, out_dir, build_dir)
    bake_stage(scene, quality, out_dir)
    return export_stage(scene, out_dir, expected_doors, budget)
```

`blender/export_web.py`:

```python
"""Export the apartment for the web walkthrough.

    blender -b <file.blend> --python-exit-code 1 --python blender/export_web.py -- --quality preview
    blender -b build/web-export.blend --python blender/export_web.py -- --stage bake --quality final
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from pipeline import config, run  # noqa: E402


def parse_args(argv):
    p = argparse.ArgumentParser(prog="export_web")
    p.add_argument("--quality", choices=sorted(config.QUALITY), default="preview")
    p.add_argument("--out", default="web/public/assets")
    p.add_argument("--build", default="build")
    p.add_argument("--stage", choices=("all", "bake", "export"), default="all")
    return p.parse_args(argv)


def main():
    args = parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    out_dir, build_dir = os.path.abspath(args.out), os.path.abspath(args.build)
    quality = config.QUALITY[args.quality]
    scene = bpy.context.scene
    if args.stage == "all":
        errors = run.run_all(args.quality, out_dir, build_dir)
    else:
        if args.stage == "bake":
            run.bake_stage(scene, quality, out_dir)
        errors = run.export_stage(scene, out_dir, config.EXPECTED_DOOR_COUNT, config.FIRST_VIEW_BUDGET_BYTES)
    if errors:
        print("\nEXPORT CHECKS FAILED:", *errors, sep="\n  - ", flush=True)
        sys.exit(1)
    print(f"\nExport OK → {out_dir}", flush=True)


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `make test-blender TESTS=test_manifest.py`, then `make test-blender TESTS=test_end_to_end.py`
Expected: PASS (3 tests) and PASS (4 tests)

- [ ] **Step 8: Run the whole Blender suite**

Run: `make test-blender`
Expected: every test passes, `OK`

- [ ] **Step 9: Commit**

```bash
git add blender
git commit -m "Add manifest, glTF export, self-checks, debug map and export CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Preview export of the real apartment and review

**Files:**
- Modify: `blender/pipeline/config.py` (only the `DOOR_OVERRIDES` / `SWITCH_OVERRIDES` tables, if the review finds problems)

**Interfaces:**
- Consumes: `make export-preview`.
- Produces: `web/public/assets/{apartment.glb, manifest.json, collision.json, lightmaps/*.webp}` at preview quality for web development, and `build/debug_map.png`.

- [ ] **Step 1: Run the preview export**

Run in the background (it takes several minutes): `mkdir -p build && make export-preview 2>&1 | tee build/export-preview.log`
Expected: the log ends with `Export OK → …/web/public/assets`. If it ends with `EXPORT CHECKS FAILED`, fix each listed problem (missing switch → add a `SWITCH_OVERRIDES` entry; door count ≠ 10 → inspect the `[doors]` lines) and re-run.

- [ ] **Step 2: Check the source file was not modified**

Run: `ls -l Untitled.blend` before Step 1 and again now.
Expected: identical modification time and size.

- [ ] **Step 3: Review the debug map**

Open `build/debug_map.png` (Read tool). Check that:
- Blocked areas (dark grey for walls and furniture, light grey for the inflated margin) outline 13 rooms, and every doorway is a white gap.
- Each of the 9 doors has a red line (closed, inside its doorway) and a green line (open), and the green line ends up alongside a wall, not across a corridor or into furniture.
- 12 blue dots (switches) sit on a wall next to a doorway, one per lit room, and none are in the Varanda.
- The yellow spawn dot is in the Entrada, and its tick points into the flat.

For each wrong door, add `"Door leaf N": {"hinge": "a"|"b", "sign": 1|-1}` to `DOOR_OVERRIDES`. Hinge end `a` is the end with the smaller (x, z) in three.js coordinates (Blender x, then −y). For each wrong switch, add `"<room id>": {"door": N, "side": 1|-1}` to `SWITCH_OVERRIDES`. Re-run Step 1 until the map looks right.

- [ ] **Step 4: Record sizes and timing**

Run: `du -sh web/public/assets web/public/assets/lightmaps && ls -la web/public/assets`
Note the numbers in the commit message.

- [ ] **Step 5: Commit**

```bash
git add blender/pipeline/config.py
git commit --allow-empty -m "Tune door/switch overrides after preview export review

Preview export: <glb size>, <lightmaps size>, <minutes> min.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Web scaffold, manifest parsing and RLE

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/scripts/copy-draco.mjs`, `web/src/config.ts`, `web/src/manifest.ts`, `web/src/rle.ts`, `web/tests/fixtures.ts`, `web/tests/manifest.test.ts`, `web/tests/rle.test.ts`

**Interfaces:**
- Produces: `CONFIG` (in `config.ts`, as below).
- Produces the manifest types `LightmapRef`, `ChunkInfo`, `RoomInfo`, `DoorInfo`, `Viewpoint`, `Spawn`, `Manifest` and `CollisionData` (`{x0, z0, cell, width, height, radius, blocked: Uint8Array}`), plus `ManifestError`, `parseManifest(json: unknown): Manifest` and `parseCollision(json: unknown): CollisionData`.
- Produces: `rleDecode(runs: number[], length: number): Uint8Array`.
- Produces: `tests/fixtures.ts` with `sampleManifest(): unknown`, which later tests reuse.

- [ ] **Step 1: Scaffold the package**

`web/package.json`:

```json
{
  "name": "apartment-walkthrough",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "postinstall": "node scripts/copy-draco.mjs"
  },
  "dependencies": {
    "three": "0.170.0",
    "three-mesh-bvh": "0.8.3"
  },
  "devDependencies": {
    "@types/three": "0.170.0",
    "typescript": "5.6.3",
    "vite": "8.3.4",
    "vitest": "5.0.3"
  }
}
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

Also add `"@types/node": "22.19.0"` to `devDependencies` (the tests read the shared fixture with `node:fs`).

`web/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

`web/scripts/copy-draco.mjs`:

```js
// Copies three.js's Draco decoder into public/ so the site has no CDN dependency.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/three/examples/jsm/libs/draco/gltf');
const dest = join(root, 'public/draco');
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Draco decoder copied to ${dest}`);
```

Run: `cd web && npm install`
Expected: installs without errors and prints `Draco decoder copied to …/web/public/draco`.

`web/src/config.ts`:

```ts
export const CONFIG = {
  assetsBase: 'assets/',
  dracoPath: 'draco/',
  walkSpeed: 1.4,
  runSpeed: 2.8,
  mouseSensitivity: 0.0022,
  doorDuration: 0.6,
  lightFadeDuration: 0.4,
  interactDistance: 2.5,
  /** Blender renders at +0.5 EV. */
  exposure: Math.pow(2, 0.5),
  /** Cycles' diffuse light pass is outgoing/albedo; three.js wants irradiance (×π). */
  lightmapScale: Math.PI,
  envIntensity: 0.2,
  verticalFov: 70,
  /** Optional display names by room id, e.g. { sala: 'Living room' }. */
  roomNames: {} as Record<string, string>,
};
```

- [ ] **Step 2: Write the failing tests**

`web/tests/fixtures.ts`:

```ts
export function sampleManifest(): unknown {
  return {
    version: 1,
    eyeHeight: 1.6,
    spawn: { x: 1, z: -0.8, yaw: -1.5708 },
    rooms: [
      { id: 'alpha', name: 'Alpha', floor: [0, 0, 3, 0, 3, -3, 0, 0, 3, -3, 0, -3], switch: 'Switch_alpha' },
      { id: 'beta', name: 'Beta', floor: [3.2, 0, 6, 0, 6, -3, 3.2, 0, 6, -3, 3.2, -3], switch: null },
    ],
    chunks: [
      { node: 'Room_alpha', room: 'alpha', day: { file: 'lightmaps/alpha_day.webp', range: 4 }, light: { file: 'lightmaps/alpha_light.webp', range: 2 } },
      { node: 'Room_beta', room: 'beta', day: { file: 'lightmaps/beta_day.webp', range: 3 }, light: null },
      { node: 'Room_exterior', room: null, day: { file: 'lightmaps/exterior_day.webp', range: 8 }, light: null },
    ],
    doors: [
      { node: 'Door_1', hinge: [3.1, -1.78], dir: [0, 1], width: 0.76, openAngle: -1.5708, lightmap: { file: 'lightmaps/door-1_day.webp', range: 2.5 } },
    ],
    viewpoints: [{ name: 'Cam_Sala', position: [4.5, 1.6, -1.5], yaw: 1.5708, pitch: 0, hfov: 1.5708 }],
  };
}
```

`web/tests/rle.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rleDecode } from '../src/rle';

const fixture = JSON.parse(
  readFileSync(new URL('../../shared/fixtures/rle.json', import.meta.url), 'utf8'),
) as { cases: { data: number[]; runs: number[] }[] };

describe('rleDecode', () => {
  it('matches the cases shared with the Python encoder', () => {
    for (const c of fixture.cases) {
      expect(Array.from(rleDecode(c.runs, c.data.length))).toEqual(c.data);
    }
  });

  it('rejects runs that do not cover the grid', () => {
    expect(() => rleDecode([2, 2], 5)).toThrow(/covers 4 cells, expected 5/);
  });
});
```

`web/tests/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ManifestError, parseCollision, parseManifest } from '../src/manifest';
import { sampleManifest } from './fixtures';

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    const m = parseManifest(sampleManifest());
    expect(m.rooms.map((r) => r.id)).toEqual(['alpha', 'beta']);
    expect(m.chunks[1].light).toBeNull();
    expect(m.doors[0].hinge).toEqual([3.1, -1.78]);
    expect(m.viewpoints[0].name).toBe('Cam_Sala');
  });

  it('names the path of a broken field', () => {
    const bad = sampleManifest() as { chunks: { day: unknown }[] };
    bad.chunks[0].day = null;
    expect(() => parseManifest(bad)).toThrow(ManifestError);
    expect(() => parseManifest(bad)).toThrow('chunks[0].day');
  });

  it('rejects other versions', () => {
    expect(() => parseManifest({ ...(sampleManifest() as object), version: 2 })).toThrow('version');
  });
});

describe('parseCollision', () => {
  it('decodes runs into a grid', () => {
    const c = parseCollision({ x0: 0, z0: 0, cell: 0.1, width: 3, height: 2, radius: 0.2, runs: [1, 1, 3, 1] });
    expect(Array.from(c.blocked)).toEqual([0, 1, 0, 0, 0, 1]);
  });

  it('rejects a grid whose runs do not match its size', () => {
    expect(() => parseCollision({ x0: 0, z0: 0, cell: 0.1, width: 3, height: 3, radius: 0.2, runs: [6] })).toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npm test`
Expected: FAIL with `Failed to resolve import "../src/rle"` (and the same for `../src/manifest`)

- [ ] **Step 4: Implement `rle.ts` and `manifest.ts`**

`web/src/rle.ts`:

```ts
/** Decode run lengths of alternating 0/1 values that start with 0 (matches raster.rle_encode). */
export function rleDecode(runs: number[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let pos = 0;
  let value = 0;
  for (const run of runs) {
    if (value) out.fill(1, pos, pos + run);
    pos += run;
    value ^= 1;
  }
  if (pos !== length) throw new Error(`RLE covers ${pos} cells, expected ${length}`);
  return out;
}
```

`web/src/manifest.ts`:

```ts
import { rleDecode } from './rle';

export interface LightmapRef { file: string; range: number }
export interface Spawn { x: number; z: number; yaw: number }
export interface RoomInfo { id: string; name: string; floor: number[]; switch: string | null }
export interface ChunkInfo { node: string; room: string | null; day: LightmapRef; light: LightmapRef | null }
export interface DoorInfo {
  node: string;
  hinge: [number, number];
  dir: [number, number];
  width: number;
  openAngle: number;
  lightmap: LightmapRef;
}
export interface Viewpoint { name: string; position: [number, number, number]; yaw: number; pitch: number; hfov: number }
export interface Manifest {
  version: 1;
  eyeHeight: number;
  spawn: Spawn;
  rooms: RoomInfo[];
  chunks: ChunkInfo[];
  doors: DoorInfo[];
  viewpoints: Viewpoint[];
}
export interface CollisionData {
  x0: number;
  z0: number;
  cell: number;
  width: number;
  height: number;
  radius: number;
  blocked: Uint8Array;
}

export class ManifestError extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ManifestError(`${path}: expected an object`);
  return v as Obj;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ManifestError(`${path}: expected an array`);
  return v;
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ManifestError(`${path}: expected a number`);
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new ManifestError(`${path}: expected a string`);
  return v;
}
function strOrNull(v: unknown, path: string): string | null {
  return v === null ? null : str(v, path);
}
function vec<N extends number>(v: unknown, n: N, path: string): number[] & { length: N } {
  const a = arr(v, path);
  if (a.length !== n) throw new ManifestError(`${path}: expected ${n} numbers`);
  return a.map((x, i) => num(x, `${path}[${i}]`)) as number[] & { length: N };
}
function lightmap(v: unknown, path: string): LightmapRef {
  const o = obj(v, path);
  return { file: str(o.file, `${path}.file`), range: num(o.range, `${path}.range`) };
}

export function parseManifest(json: unknown): Manifest {
  const m = obj(json, 'manifest');
  if (m.version !== 1) throw new ManifestError(`version: expected 1, got ${String(m.version)}`);
  const spawn = obj(m.spawn, 'spawn');
  return {
    version: 1,
    eyeHeight: num(m.eyeHeight, 'eyeHeight'),
    spawn: { x: num(spawn.x, 'spawn.x'), z: num(spawn.z, 'spawn.z'), yaw: num(spawn.yaw, 'spawn.yaw') },
    rooms: arr(m.rooms, 'rooms').map((v, i) => {
      const r = obj(v, `rooms[${i}]`);
      return {
        id: str(r.id, `rooms[${i}].id`),
        name: str(r.name, `rooms[${i}].name`),
        floor: arr(r.floor, `rooms[${i}].floor`).map((x, k) => num(x, `rooms[${i}].floor[${k}]`)),
        switch: strOrNull(r.switch, `rooms[${i}].switch`),
      };
    }),
    chunks: arr(m.chunks, 'chunks').map((v, i) => {
      const c = obj(v, `chunks[${i}]`);
      return {
        node: str(c.node, `chunks[${i}].node`),
        room: strOrNull(c.room, `chunks[${i}].room`),
        day: lightmap(c.day, `chunks[${i}].day`),
        light: c.light === null ? null : lightmap(c.light, `chunks[${i}].light`),
      };
    }),
    doors: arr(m.doors, 'doors').map((v, i) => {
      const d = obj(v, `doors[${i}]`);
      return {
        node: str(d.node, `doors[${i}].node`),
        hinge: vec(d.hinge, 2, `doors[${i}].hinge`) as [number, number],
        dir: vec(d.dir, 2, `doors[${i}].dir`) as [number, number],
        width: num(d.width, `doors[${i}].width`),
        openAngle: num(d.openAngle, `doors[${i}].openAngle`),
        lightmap: lightmap(d.lightmap, `doors[${i}].lightmap`),
      };
    }),
    viewpoints: arr(m.viewpoints, 'viewpoints').map((v, i) => {
      const p = obj(v, `viewpoints[${i}]`);
      return {
        name: str(p.name, `viewpoints[${i}].name`),
        position: vec(p.position, 3, `viewpoints[${i}].position`) as [number, number, number],
        yaw: num(p.yaw, `viewpoints[${i}].yaw`),
        pitch: num(p.pitch, `viewpoints[${i}].pitch`),
        hfov: num(p.hfov, `viewpoints[${i}].hfov`),
      };
    }),
  };
}

export function parseCollision(json: unknown): CollisionData {
  const c = obj(json, 'collision');
  const width = num(c.width, 'collision.width');
  const height = num(c.height, 'collision.height');
  const runs = arr(c.runs, 'collision.runs').map((x, i) => num(x, `collision.runs[${i}]`));
  return {
    x0: num(c.x0, 'collision.x0'),
    z0: num(c.z0, 'collision.z0'),
    cell: num(c.cell, 'collision.cell'),
    width,
    height,
    radius: num(c.radius, 'collision.radius'),
    blocked: rleDecode(runs, width * height),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npm test`
Expected: PASS, 2 files, 7 tests

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts web/scripts web/src web/tests
git commit -m "Scaffold the web app with manifest and collision parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Lightmap shader patch and room light fading

**Files:**
- Create: `web/src/rgbm.ts`, `web/src/lightmaps.ts`, `web/tests/rgbm.test.ts`, `web/tests/lightmaps.test.ts`

**Interfaces:**
- Produces: `RGBM_GLSL: string` and `rgbmDecode(r, g, b, a, range): [number, number, number]`.
- Produces: `patchVertex(src): string` and `patchFragment(src): string` (both throw if three's include anchors are missing).
- Produces: `LightmapBinding { day: Texture; dayRange: number; light: Texture; lightRange: number; intensity: { value: number } }`, `applyLightmap(material: MeshStandardMaterial, b: LightmapBinding, scale?: number): void`, `setLightTexture(material, texture, range): void`, `BLACK_LIGHTMAP: DataTexture` and `fadeToward(current, target, dt, duration): number`.
- Produces: `class RoomLights { constructor(roomIds: string[], duration?); uniform(id): { value: number }; has(id): boolean; isOn(id): boolean; toggle(id): void; update(dt): void }`.

- [ ] **Step 1: Write the failing tests**

`web/tests/rgbm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RGBM_GLSL, rgbmDecode } from '../src/rgbm';

describe('rgbm', () => {
  it('decodes rgb * a * range', () => {
    expect(rgbmDecode(0.5, 0.25, 1, 0.5, 8)).toEqual([2, 1, 4]);
  });
  it('exposes the same formula in GLSL', () => {
    expect(RGBM_GLSL).toContain('c.rgb * c.a * range');
  });
});
```

`web/tests/lightmaps.test.ts`:

```ts
import { MeshStandardMaterial, ShaderLib, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { applyLightmap, fadeToward, patchFragment, patchVertex, RoomLights } from '../src/lightmaps';

describe('shader patches', () => {
  it('patch the standard material shaders', () => {
    const v = patchVertex(ShaderLib.standard.vertexShader);
    expect(v).toContain('attribute vec2 uv1;');
    expect(v).toContain('vLmUv = uv1;');
    const f = patchFragment(ShaderLib.standard.fragmentShader);
    expect(f).toContain('uniform sampler2D lmDay;');
    expect(f).toContain('irradiance += ');
    expect(f.indexOf('irradiance += (')).toBeGreaterThan(f.indexOf('#include <lights_fragment_maps>'));
  });

  it('fails loudly if three.js changes its includes', () => {
    expect(() => patchFragment('void main() {}')).toThrow(/lights_fragment_maps|common/);
  });
});

describe('applyLightmap', () => {
  it('wires uniforms through onBeforeCompile, sharing the intensity object', () => {
    const m = new MeshStandardMaterial();
    const intensity = { value: 0.25 };
    applyLightmap(m, { day: new Texture(), dayRange: 4, light: new Texture(), lightRange: 2, intensity }, 3);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.lmLightIntensity).toBe(intensity);
    expect(shader.uniforms.lmScale.value).toBe(3);
    expect(shader.uniforms.lmDayRange.value).toBe(4);
    expect(m.customProgramCacheKey()).toBe('room-lightmap-v1');
  });
});

describe('fading', () => {
  it('moves linearly toward the target and clamps', () => {
    expect(fadeToward(0, 1, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(fadeToward(0.9, 1, 0.2, 0.4)).toBe(1);
    expect(fadeToward(0.3, 0, 0.2, 0.4)).toBe(0);
  });

  it('RoomLights toggles and eases intensity', () => {
    const lights = new RoomLights(['alpha'], 0.4);
    expect(lights.isOn('alpha')).toBe(false);
    lights.toggle('alpha');
    expect(lights.isOn('alpha')).toBe(true);
    lights.update(0.2);
    expect(lights.uniform('alpha').value).toBeCloseTo(0.5);
    lights.update(1);
    expect(lights.uniform('alpha').value).toBe(1);
    lights.toggle('nope');
    expect(lights.has('nope')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm test`
Expected: FAIL with `Failed to resolve import "../src/rgbm"` and `"../src/lightmaps"`

- [ ] **Step 3: Implement `rgbm.ts` and `lightmaps.ts`**

`web/src/rgbm.ts`:

```ts
/** RGBM decode, matching blender/pipeline/raster.py rgbm_encode. */
export const RGBM_GLSL = /* glsl */ `
vec3 rgbmDecode( vec4 c, float range ) { return c.rgb * c.a * range; }
`;

export function rgbmDecode(r: number, g: number, b: number, a: number, range: number): [number, number, number] {
  return [r * a * range, g * a * range, b * a * range];
}
```

`web/src/lightmaps.ts`:

```ts
import { DataTexture, MeshStandardMaterial, Texture } from 'three';
import { CONFIG } from './config';
import { RGBM_GLSL } from './rgbm';

export interface LightmapBinding {
  day: Texture;
  dayRange: number;
  light: Texture;
  lightRange: number;
  intensity: { value: number };
}

export const BLACK_LIGHTMAP = (() => {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

// Our own attribute + varying keep this independent of three's USE_UV1 handling.
// Don't also give these materials a map on UV channel 1, or three will declare uv1 twice.
const VERTEX_DECL = /* glsl */ `
attribute vec2 uv1;
varying vec2 vLmUv;`;

const FRAGMENT_DECL = /* glsl */ `
varying vec2 vLmUv;
uniform sampler2D lmDay;
uniform sampler2D lmLight;
uniform float lmDayRange;
uniform float lmLightRange;
uniform float lmLightIntensity;
uniform float lmScale;
${RGBM_GLSL}`;

const ACCUMULATE = /* glsl */ `
#if defined( RE_IndirectDiffuse )
	irradiance += ( rgbmDecode( texture( lmDay, vLmUv ), lmDayRange )
		+ lmLightIntensity * rgbmDecode( texture( lmLight, vLmUv ), lmLightRange ) ) * lmScale;
#endif`;

function inject(src: string, anchor: string, extra: string): string {
  if (!src.includes(anchor)) throw new Error(`three.js shader is missing ${anchor}; update the lightmap patch`);
  return src.replace(anchor, `${anchor}\n${extra}`);
}

export function patchVertex(src: string): string {
  return inject(inject(src, '#include <common>', VERTEX_DECL), '#include <uv_vertex>', 'vLmUv = uv1;');
}

export function patchFragment(src: string): string {
  return inject(inject(src, '#include <common>', FRAGMENT_DECL), '#include <lights_fragment_maps>', ACCUMULATE);
}

export function applyLightmap(material: MeshStandardMaterial, b: LightmapBinding, scale = CONFIG.lightmapScale): void {
  const uniforms = {
    lmDay: { value: b.day },
    lmLight: { value: b.light },
    lmDayRange: { value: b.dayRange },
    lmLightRange: { value: b.lightRange },
    lmLightIntensity: b.intensity,
    lmScale: { value: scale },
  };
  material.userData.lightmapUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchVertex(shader.vertexShader);
    shader.fragmentShader = patchFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => 'room-lightmap-v1';
  material.needsUpdate = true;
}

export function setLightTexture(material: MeshStandardMaterial, texture: Texture, range: number): void {
  const u = material.userData.lightmapUniforms;
  u.lmLight.value = texture;
  u.lmLightRange.value = range;
}

export function fadeToward(current: number, target: number, dt: number, duration: number): number {
  const step = dt / duration;
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step);
}

export class RoomLights {
  private uniforms = new Map<string, { value: number }>();
  private targets = new Map<string, number>();
  private linear = new Map<string, number>();

  constructor(roomIds: string[], private duration = CONFIG.lightFadeDuration) {
    for (const id of roomIds) {
      this.uniforms.set(id, { value: 0 });
      this.targets.set(id, 0);
      this.linear.set(id, 0);
    }
  }

  uniform(id: string): { value: number } {
    const u = this.uniforms.get(id);
    if (!u) throw new Error(`no light for room ${id}`);
    return u;
  }

  has(id: string): boolean {
    return this.uniforms.has(id);
  }

  isOn(id: string): boolean {
    return this.targets.get(id) === 1;
  }

  toggle(id: string): void {
    if (this.has(id)) this.targets.set(id, this.isOn(id) ? 0 : 1);
  }

  update(dt: number): void {
    for (const [id, u] of this.uniforms) {
      const l = fadeToward(this.linear.get(id)!, this.targets.get(id)!, dt, this.duration);
      this.linear.set(id, l);
      u.value = l * l * (3 - 2 * l);
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npm test`
Expected: PASS. The `RoomLights` 0.5 assertion holds because smoothstep(0.5) = 0.5.

- [ ] **Step 5: Commit**

```bash
git add web/src web/tests
git commit -m "Patch standard material with day + room-light lightmaps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Collision, doors and room detection

**Files:**
- Create: `web/src/collision.ts`, `web/src/doors.ts`, `web/src/rooms.ts`, `web/tests/collision.test.ts`, `web/tests/doors.test.ts`, `web/tests/rooms.test.ts`

**Interfaces:**
- Consumes: `CollisionData`, `DoorInfo`, `RoomInfo`, `CONFIG.doorDuration`.
- Produces: `Segment { ax; az; bx; bz }`, `segmentDistance(px, pz, s): number`, and `class Collision { constructor(grid: CollisionData, segments?: () => Segment[]); gridBlocked(x, z); isBlocked(x, z); move(x, z, dx, dz): [number, number]; nearestFree(x, z): [number, number] }`.
- Produces: `rotY(v: readonly [number, number], phi): [number, number]`, `easeInOut(t)`, and `class DoorState { info; progress; target; get angle(); get isOpen(); toggle(); update(dt); segment(): Segment }`.
- Produces: `pointInTriangle(...)` and `class RoomLocator { constructor(rooms: RoomInfo[]); locate(x, z, previous: string | null): string | null }`.

- [ ] **Step 1: Write the failing tests**

`web/tests/collision.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Collision, segmentDistance } from '../src/collision';
import type { CollisionData } from '../src/manifest';

function wallGrid(): CollisionData {
  // 10×10 cells of 0.1 m from (0, 0); column 5 (x 0.5..0.6) blocked.
  const blocked = new Uint8Array(100);
  for (let j = 0; j < 10; j++) blocked[j * 10 + 5] = 1;
  return { x0: 0, z0: 0, cell: 0.1, width: 10, height: 10, radius: 0.1, blocked };
}

describe('segmentDistance', () => {
  it('measures to the closest point on the segment', () => {
    const s = { ax: 0, az: 0, bx: 1, bz: 0 };
    expect(segmentDistance(0.5, 0.3, s)).toBeCloseTo(0.3);
    expect(segmentDistance(-0.4, 0.3, s)).toBeCloseTo(0.5);
  });
});

describe('Collision', () => {
  it('treats outside the grid as blocked', () => {
    expect(new Collision(wallGrid()).isBlocked(-0.1, 0.5)).toBe(true);
  });

  it('stops at walls and slides along them', () => {
    const c = new Collision(wallGrid());
    const [x1] = c.move(0.25, 0.5, 0.5, 0);
    expect(x1).toBeLessThan(0.5);
    const [x2, z2] = c.move(0.25, 0.5, 0.5, 0.2);
    expect(x2).toBeLessThan(0.5);
    expect(z2).toBeCloseTo(0.7);
  });

  it('blocks within the radius of door segments', () => {
    const c = new Collision(wallGrid(), () => [{ ax: 0.2, az: 0, bx: 0.2, bz: 1 }]);
    expect(c.isBlocked(0.25, 0.5)).toBe(true);
    expect(c.isBlocked(0.35, 0.5)).toBe(false);
  });

  it('finds the nearest free spot', () => {
    const c = new Collision(wallGrid());
    const [x, z] = c.nearestFree(0.55, 0.5);
    expect(c.isBlocked(x, z)).toBe(false);
    // Lands on an adjacent free cell centre: at most ~1.5 cells away.
    expect(Math.hypot(x - 0.55, z - 0.5)).toBeLessThanOrEqual(0.15);
    expect(c.nearestFree(0.25, 0.25)).toEqual([0.25, 0.25]);
  });
});
```

`web/tests/doors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DoorState, easeInOut, rotY } from '../src/doors';
import type { DoorInfo } from '../src/manifest';

const info: DoorInfo = {
  node: 'Door_1', hinge: [3.1, -1.78], dir: [0, 1], width: 0.76, openAngle: -Math.PI / 2,
  lightmap: { file: 'x', range: 1 },
};

describe('rotY', () => {
  it('matches the Python pipeline convention', () => {
    const [x, z] = rotY([1, 0], Math.PI / 2);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
  });
});

describe('easeInOut', () => {
  it('is symmetric with fixed ends', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });
});

describe('DoorState', () => {
  it('opens over the duration and reports its segment', () => {
    const d = new DoorState(info, 0.6);
    expect(d.segment()).toEqual({ ax: 3.1, az: -1.78, bx: 3.1, bz: -1.78 + 0.76 });
    d.toggle();
    d.update(0.3);
    expect(d.progress).toBeCloseTo(0.5);
    d.update(1);
    expect(d.angle).toBeCloseTo(-Math.PI / 2);
    const s = d.segment();
    expect(s.bx).toBeCloseTo(3.1 - 0.76); // swung into Alpha (−x)
    expect(s.bz).toBeCloseTo(-1.78);
  });

  it('reverses mid-swing', () => {
    const d = new DoorState(info, 0.6);
    d.toggle();
    d.update(0.3);
    d.toggle();
    expect(d.isOpen).toBe(false);
    d.update(0.15);
    expect(d.progress).toBeCloseTo(0.25);
  });
});
```

`web/tests/rooms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest';
import { pointInTriangle, RoomLocator } from '../src/rooms';
import { sampleManifest } from './fixtures';

describe('RoomLocator', () => {
  const locator = new RoomLocator(parseManifest(sampleManifest()).rooms);

  it('finds the room under a point', () => {
    expect(locator.locate(1, -1, null)).toBe('alpha');
    expect(locator.locate(4, -2, null)).toBe('beta');
  });

  it('keeps the previous room in doorways', () => {
    expect(locator.locate(3.1, -1.4, 'alpha')).toBe('alpha');
    expect(locator.locate(3.1, -1.4, null)).toBeNull();
  });

  it('pointInTriangle handles both windings', () => {
    expect(pointInTriangle(0.2, 0.2, 0, 0, 1, 0, 0, 1)).toBe(true);
    expect(pointInTriangle(0.2, 0.2, 0, 0, 0, 1, 1, 0)).toBe(true);
    expect(pointInTriangle(0.8, 0.8, 0, 0, 1, 0, 0, 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm test`
Expected: FAIL with unresolved imports `../src/collision`, `../src/doors`, `../src/rooms`

- [ ] **Step 3: Implement**

`web/src/collision.ts`:

```ts
import type { CollisionData } from './manifest';

export interface Segment { ax: number; az: number; bx: number; bz: number }

export function segmentDistance(px: number, pz: number, s: Segment): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / len2)) : 0;
  return Math.hypot(px - (s.ax + t * dx), pz - (s.az + t * dz));
}

export class Collision {
  constructor(private grid: CollisionData, private segments: () => Segment[] = () => []) {}

  gridBlocked(x: number, z: number): boolean {
    const g = this.grid;
    const i = Math.floor((x - g.x0) / g.cell);
    const j = Math.floor((z - g.z0) / g.cell);
    if (i < 0 || j < 0 || i >= g.width || j >= g.height) return true;
    return g.blocked[j * g.width + i] === 1;
  }

  isBlocked(x: number, z: number): boolean {
    if (this.gridBlocked(x, z)) return true;
    for (const s of this.segments()) if (segmentDistance(x, z, s) < this.grid.radius) return true;
    return false;
  }

  /** Axis-separated sliding, in sub-steps no longer than half a cell. */
  move(x: number, z: number, dx: number, dz: number): [number, number] {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (this.grid.cell / 2)));
    const sx = dx / steps;
    const sz = dz / steps;
    for (let k = 0; k < steps; k++) {
      if (!this.isBlocked(x + sx, z)) x += sx;
      if (!this.isBlocked(x, z + sz)) z += sz;
    }
    return [x, z];
  }

  nearestFree(x: number, z: number): [number, number] {
    if (!this.isBlocked(x, z)) return [x, z];
    const g = this.grid;
    const i0 = Math.floor((x - g.x0) / g.cell);
    const j0 = Math.floor((z - g.z0) / g.cell);
    for (let r = 1; r < Math.max(g.width, g.height); r++) {
      let best: [number, number] | null = null;
      let bestDist = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const cx = g.x0 + (i0 + di + 0.5) * g.cell;
          const cz = g.z0 + (j0 + dj + 0.5) * g.cell;
          const d = Math.hypot(cx - x, cz - z);
          if (d < bestDist && !this.isBlocked(cx, cz)) {
            best = [cx, cz];
            bestDist = d;
          }
        }
      }
      if (best) return best;
    }
    return [x, z];
  }
}
```

`web/src/doors.ts`:

```ts
import type { Segment } from './collision';
import { CONFIG } from './config';
import type { DoorInfo } from './manifest';

/** Rotate a ground-plane vector (x, z) about +Y, same as geom.rot_y in the pipeline. */
export function rotY(v: readonly [number, number], phi: number): [number, number] {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c];
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class DoorState {
  progress = 0;
  target = 0;

  constructor(readonly info: DoorInfo, private duration = CONFIG.doorDuration) {}

  get angle(): number {
    return this.info.openAngle * easeInOut(this.progress);
  }

  get isOpen(): boolean {
    return this.target === 1;
  }

  toggle(): void {
    this.target = this.target === 1 ? 0 : 1;
  }

  update(dt: number): void {
    const step = dt / this.duration;
    this.progress = this.target > this.progress
      ? Math.min(1, this.progress + step)
      : Math.max(0, this.progress - step);
  }

  segment(): Segment {
    const [dx, dz] = rotY(this.info.dir, this.angle);
    const [hx, hz] = this.info.hinge;
    return { ax: hx, az: hz, bx: hx + dx * this.info.width, bz: hz + dz * this.info.width };
  }
}
```

`web/src/rooms.ts`:

```ts
import type { RoomInfo } from './manifest';

export function pointInTriangle(
  px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
): boolean {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

export class RoomLocator {
  constructor(private rooms: RoomInfo[]) {}

  locate(x: number, z: number, previous: string | null): string | null {
    for (const room of this.rooms) {
      const f = room.floor;
      for (let k = 0; k + 5 < f.length; k += 6) {
        if (pointInTriangle(x, z, f[k], f[k + 1], f[k + 2], f[k + 3], f[k + 4], f[k + 5])) return room.id;
      }
    }
    return previous;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src web/tests
git commit -m "Add grid collision, door state machine and room locator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Player controller and interactions

**Files:**
- Create: `web/src/player.ts`, `web/src/interactions.ts`, `web/tests/player.test.ts`, `web/tests/interactions.test.ts`

**Interfaces:**
- Consumes: `Collision`, `DoorState`, `RoomLights`, `CONFIG`.
- Produces: `MoveKeys`, `moveDelta(keys, yaw, dt, walk?, run?): [dx, dz]`, `applyLook(yaw, pitch, mx, my, sens): [yaw, pitch]`, `MAX_PITCH`, `vfovFromHfov(hfovRad, aspect): number` (degrees), and `class Player { x; z; yaw; pitch; eyeHeight; frozen; keys; constructor(camera, collision, spawn, eyeHeight); attach(target: Window, lockElement: () => Element | null); update(dt); resolve(); teleport(x, z, yaw, pitch, eyeHeight?) }`.
- Produces: `Target = { kind: 'door'; door: DoorState; node: Object3D } | { kind: 'switch'; room: string; node: Object3D }`, `promptFor(t, lights): string`, `activate(t, lights)`, `findTarget(hit, targets)`, `setHighlight(node, on)`, and `class Interactions { current; constructor(camera, pickables, targets, lights); update(): Target | null; click(): void }`.

- [ ] **Step 1: Write the failing tests**

`web/tests/player.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyLook, MAX_PITCH, moveDelta, vfovFromHfov } from '../src/player';

const none = { forward: false, back: false, left: false, right: false, run: false };

describe('moveDelta', () => {
  it('walks forward along -z at yaw 0', () => {
    const [dx, dz] = moveDelta({ ...none, forward: true }, 0, 1, 1.4, 2.8);
    expect(dx).toBeCloseTo(0);
    expect(dz).toBeCloseTo(-1.4);
  });
  it('strafes right along +x at yaw 0, and runs', () => {
    const [dx, dz] = moveDelta({ ...none, right: true, run: true }, 0, 1, 1.4, 2.8);
    expect(dx).toBeCloseTo(2.8);
    expect(dz).toBeCloseTo(0);
  });
  it('turns with yaw and normalises diagonals', () => {
    const [dx] = moveDelta({ ...none, forward: true }, Math.PI / 2, 1, 1, 2);
    expect(dx).toBeCloseTo(-1);
    const [ax, az] = moveDelta({ ...none, forward: true, right: true }, 0, 1, 1, 2);
    expect(Math.hypot(ax, az)).toBeCloseTo(1);
  });
  it('is zero with no keys', () => {
    expect(moveDelta(none, 0, 1)).toEqual([0, 0]);
  });
});

describe('look', () => {
  it('clamps pitch', () => {
    const [yaw, pitch] = applyLook(0, 0, 100, -10000, 0.01);
    expect(yaw).toBeCloseTo(-1);
    expect(pitch).toBe(MAX_PITCH);
  });
  it('converts horizontal to vertical fov', () => {
    expect(vfovFromHfov(Math.PI / 2, 1)).toBeCloseTo(90);
    expect(vfovFromHfov(Math.PI / 2, 1.6)).toBeCloseTo(64.01, 1);
  });
});
```

`web/tests/interactions.test.ts`:

```ts
import { Color, Mesh, MeshStandardMaterial, Object3D, BoxGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { DoorState } from '../src/doors';
import { activate, findTarget, promptFor, setHighlight, type Target } from '../src/interactions';
import { RoomLights } from '../src/lightmaps';

const doorInfo = { node: 'Door_1', hinge: [0, 0] as [number, number], dir: [1, 0] as [number, number], width: 0.8, openAngle: 1.5, lightmap: { file: 'x', range: 1 } };

describe('interactions', () => {
  it('prompts and activates doors', () => {
    const lights = new RoomLights([]);
    const t: Target = { kind: 'door', door: new DoorState(doorInfo), node: new Object3D() };
    expect(promptFor(t, lights)).toBe('Click: open door');
    activate(t, lights);
    expect(promptFor(t, lights)).toBe('Click: close door');
  });

  it('prompts and activates switches', () => {
    const lights = new RoomLights(['sala']);
    const t: Target = { kind: 'switch', room: 'sala', node: new Object3D() };
    expect(promptFor(t, lights)).toBe('Click: turn light on');
    activate(t, lights);
    expect(promptFor(t, lights)).toBe('Click: turn light off');
  });

  it('finds the target through parent nodes', () => {
    const node = new Object3D();
    const child = new Object3D();
    node.add(child);
    const t: Target = { kind: 'switch', room: 'sala', node };
    const targets = new Map<Object3D, Target>([[node, t]]);
    expect(findTarget(child, targets)).toBe(t);
    expect(findTarget(new Object3D(), targets)).toBeNull();
    expect(findTarget(null, targets)).toBeNull();
  });

  it('highlights by tinting emissive and restores it', () => {
    const mat = new MeshStandardMaterial({ emissive: new Color(0.1, 0.1, 0.1) });
    const mesh = new Mesh(new BoxGeometry(), mat);
    setHighlight(mesh, true);
    expect(mat.emissive.r).toBeGreaterThan(0.1);
    setHighlight(mesh, false);
    expect(mat.emissive.r).toBeCloseTo(0.1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm test`
Expected: FAIL with unresolved `../src/player` and `../src/interactions`

- [ ] **Step 3: Implement `player.ts`**

`web/src/player.ts`:

```ts
import type { PerspectiveCamera } from 'three';
import type { Collision } from './collision';
import { CONFIG } from './config';
import type { Spawn } from './manifest';

export interface MoveKeys { forward: boolean; back: boolean; left: boolean; right: boolean; run: boolean }

export const MAX_PITCH = Math.PI / 2 - 0.01;

const KEY_MAP: Record<string, keyof MoveKeys> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};

/** Forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw). */
export function moveDelta(
  keys: MoveKeys, yaw: number, dt: number, walk = CONFIG.walkSpeed, run = CONFIG.runSpeed,
): [number, number] {
  let f = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  let s = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const len = Math.hypot(f, s);
  if (len === 0) return [0, 0];
  f /= len;
  s /= len;
  const speed = (keys.run ? run : walk) * dt;
  return [
    (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed,
    (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed,
  ];
}

export function applyLook(yaw: number, pitch: number, mx: number, my: number, sens: number): [number, number] {
  return [yaw - mx * sens, Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch - my * sens))];
}

export function vfovFromHfov(hfov: number, aspect: number): number {
  return (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI;
}

export class Player {
  x: number;
  z: number;
  yaw: number;
  pitch = 0;
  frozen = false;
  keys: MoveKeys = { forward: false, back: false, left: false, right: false, run: false };

  constructor(
    private camera: PerspectiveCamera,
    private collision: Collision,
    spawn: Spawn,
    public eyeHeight: number,
  ) {
    this.x = spawn.x;
    this.z = spawn.z;
    this.yaw = spawn.yaw;
    camera.rotation.order = 'YXZ';
  }

  attach(target: Window, lockElement: () => Element | null): void {
    target.addEventListener('keydown', (e) => {
      const k = KEY_MAP[e.code];
      if (k) this.keys[k] = true;
    });
    target.addEventListener('keyup', (e) => {
      const k = KEY_MAP[e.code];
      if (k) this.keys[k] = false;
    });
    target.addEventListener('blur', () => {
      for (const k of Object.keys(this.keys) as (keyof MoveKeys)[]) this.keys[k] = false;
    });
    target.addEventListener('mousemove', (e) => {
      if (!lockElement()) return;
      [this.yaw, this.pitch] = applyLook(this.yaw, this.pitch, e.movementX, e.movementY, CONFIG.mouseSensitivity);
    });
  }

  update(dt: number): void {
    if (!this.frozen) {
      const [dx, dz] = moveDelta(this.keys, this.yaw, dt);
      [this.x, this.z] = this.collision.move(this.x, this.z, dx, dz);
    }
    this.camera.position.set(this.x, this.eyeHeight, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  resolve(): void {
    [this.x, this.z] = this.collision.nearestFree(this.x, this.z);
  }

  teleport(x: number, z: number, yaw: number, pitch: number, eyeHeight = this.eyeHeight): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = pitch;
    this.eyeHeight = eyeHeight;
  }
}
```

- [ ] **Step 4: Implement `interactions.ts`**

`web/src/interactions.ts`:

```ts
import { Camera, Color, Mesh, MeshStandardMaterial, Object3D, Raycaster, Vector2 } from 'three';
import { CONFIG } from './config';
import type { DoorState } from './doors';
import type { RoomLights } from './lightmaps';

export type Target =
  | { kind: 'door'; door: DoorState; node: Object3D }
  | { kind: 'switch'; room: string; node: Object3D };

const HIGHLIGHT = new Color(0.12, 0.12, 0.09);
const CENTER = new Vector2(0, 0);

export function promptFor(t: Target, lights: RoomLights): string {
  if (t.kind === 'door') return t.door.isOpen ? 'Click: close door' : 'Click: open door';
  return lights.isOn(t.room) ? 'Click: turn light off' : 'Click: turn light on';
}

export function activate(t: Target, lights: RoomLights): void {
  if (t.kind === 'door') t.door.toggle();
  else lights.toggle(t.room);
}

export function findTarget(hit: Object3D | null, targets: Map<Object3D, Target>): Target | null {
  for (let o: Object3D | null = hit; o; o = o.parent) {
    const t = targets.get(o);
    if (t) return t;
  }
  return null;
}

export function setHighlight(node: Object3D, on: boolean): void {
  node.traverse((o) => {
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!m || !m.emissive) return;
    if (!m.userData.baseEmissive) m.userData.baseEmissive = m.emissive.clone();
    m.emissive.copy(m.userData.baseEmissive);
    if (on) m.emissive.add(HIGHLIGHT);
  });
}

export class Interactions {
  current: Target | null = null;
  private raycaster = new Raycaster();

  constructor(
    private camera: Camera,
    private pickables: Object3D[],
    private targets: Map<Object3D, Target>,
    private lights: RoomLights,
  ) {
    this.raycaster.far = CONFIG.interactDistance;
    (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  }

  /** Raycast from the crosshair; walls in `pickables` occlude targets behind them. */
  update(): Target | null {
    this.raycaster.setFromCamera(CENTER, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, true)[0];
    const t = findTarget(hit?.object ?? null, this.targets);
    if (t !== this.current) {
      if (this.current) setHighlight(this.current.node, false);
      if (t) setHighlight(t.node, true);
      this.current = t;
    }
    return t;
  }

  click(): void {
    if (this.current) activate(this.current, this.lights);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src web/tests
git commit -m "Add first-person player controller and crosshair interactions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Asset loading and scene setup

**Files:**
- Create: `web/src/scene-setup.ts`, `web/src/loader.ts`, `web/src/world.ts`, `web/tests/scene-setup.test.ts`

**Interfaces:**
- Consumes: `parseManifest`, `parseCollision`, `applyLightmap`, `setLightTexture`, `BLACK_LIGHTMAP`, `RoomLights`, `DoorState`, `Collision`, `RoomLocator`, `Target`.
- Produces: `isGlass(m: Material): boolean`, `makeGlass(m: MeshStandardMaterial): MeshStandardMaterial`, and `prepareMeshes(node: Object3D, binding: LightmapBinding | null): MeshStandardMaterial[]` (returns the lightmapped clones).
- Produces: `configureLightmap(t: Texture)`, `FALLBACK_LIGHTMAP`, `LoadedMap { texture; range }`, `LoadedAssets { manifest; collision; scene: Group; day: Map<string, LoadedMap>; light: Promise<Map<string, LoadedMap>> }` and `loadAssets(onProgress): Promise<LoadedAssets>`. Maps are keyed by `LightmapRef.file`.
- Produces: `World { lights; doors: { state: DoorState; node: Object3D; base: Quaternion }[]; targets; pickables: Object3D[]; rooms: RoomLocator; collision: Collision; lightmapped: MeshStandardMaterial[] }`, `buildWorld(assets, scene: Scene): World` and `applyDoorRotation(d)`.

- [ ] **Step 1: Write the failing tests**

`web/tests/scene-setup.test.ts`:

```ts
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { isGlass, makeGlass, prepareMeshes } from '../src/scene-setup';

describe('scene setup', () => {
  it('detects glass by name or transmission', () => {
    expect(isGlass(Object.assign(new MeshStandardMaterial(), { name: 'Window Glass' }))).toBe(true);
    expect(isGlass(Object.assign(new MeshPhysicalMaterial(), { transmission: 1 }))).toBe(true);
    expect(isGlass(new MeshStandardMaterial({ name: 'Wall plaster' }))).toBe(false);
  });

  it('makes a cheap transparent glass', () => {
    const g = makeGlass(Object.assign(new MeshStandardMaterial(), { name: 'Glass' }));
    expect(g.transparent).toBe(true);
    expect(g.opacity).toBeLessThan(0.3);
    expect(g.depthWrite).toBe(false);
  });

  it('clones materials per mesh and lightmaps everything except glass', () => {
    const shared = new MeshStandardMaterial({ name: 'Wall plaster' });
    const group = new Group();
    const a = new Mesh(new BoxGeometry(), shared);
    const b = new Mesh(new BoxGeometry(), Object.assign(new MeshStandardMaterial(), { name: 'Glass' }));
    group.add(a, b);
    const binding = { day: new Texture(), dayRange: 2, light: new Texture(), lightRange: 1, intensity: { value: 0 } };
    const lit = prepareMeshes(group, binding);
    expect(lit).toHaveLength(1);
    expect(a.material).not.toBe(shared);
    expect((a.material as MeshStandardMaterial).userData.lightmapUniforms.lmDayRange.value).toBe(2);
    expect((b.material as MeshStandardMaterial).transparent).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm test`
Expected: FAIL with unresolved `../src/scene-setup`

- [ ] **Step 3: Implement `scene-setup.ts`**

`web/src/scene-setup.ts`:

```ts
import { Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D } from 'three';
import { applyLightmap, type LightmapBinding } from './lightmaps';

export function isGlass(m: Material): boolean {
  return /glass|acrylic/i.test(m.name) || ((m as MeshPhysicalMaterial).transmission ?? 0) > 0;
}

export function makeGlass(m: MeshStandardMaterial): MeshStandardMaterial {
  return new MeshStandardMaterial({
    name: m.name,
    color: m.color,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
}

/** Clone each mesh's material (chunks share glTF materials) and attach the chunk's lightmaps. */
export function prepareMeshes(node: Object3D, binding: LightmapBinding | null): MeshStandardMaterial[] {
  const lit: MeshStandardMaterial[] = [];
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as MeshStandardMaterial;
    if (isGlass(src)) {
      mesh.material = makeGlass(src);
      return;
    }
    const m = src.clone();
    if (binding) {
      applyLightmap(m, binding);
      lit.push(m);
    }
    mesh.material = m;
  });
  return lit;
}
```

- [ ] **Step 4: Implement `loader.ts`**

`web/src/loader.ts`:

```ts
import { DataTexture, Group, LinearFilter, NoColorSpace, Texture, TextureLoader } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config';
import { type CollisionData, type LightmapRef, type Manifest, parseCollision, parseManifest } from './manifest';

export interface LoadedMap { texture: Texture; range: number }
export interface LoadedAssets {
  manifest: Manifest;
  collision: CollisionData;
  scene: Group;
  day: Map<string, LoadedMap>;
  light: Promise<Map<string, LoadedMap>>;
}

/** Mid-grey RGBM (0.5 × π irradiance): flat lighting when a lightmap fails to load. */
export const FALLBACK_LIGHTMAP = (() => {
  const t = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

export function configureLightmap(t: Texture): void {
  t.flipY = false; // glTF UV convention
  t.colorSpace = NoColorSpace; // RGBM data, not colour
  t.premultiplyAlpha = false;
  t.generateMipmaps = false;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadAssets(onProgress: (fraction: number) => void): Promise<LoadedAssets> {
  const base = CONFIG.assetsBase;
  const manifest = parseManifest(await fetchJson(`${base}manifest.json`));
  const collision = parseCollision(await fetchJson(`${base}collision.json`));

  const draco = new DRACOLoader().setDecoderPath(CONFIG.dracoPath);
  const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
  const texLoader = new TextureLoader();

  const dayRefs: LightmapRef[] = [...manifest.chunks.map((c) => c.day), ...manifest.doors.map((d) => d.lightmap)];
  let glbFraction = 0;
  let mapsDone = 0;
  const report = () => onProgress(0.6 * glbFraction + 0.4 * (mapsDone / Math.max(1, dayRefs.length)));

  const loadMap = async (ref: LightmapRef): Promise<LoadedMap> => {
    try {
      const t = await texLoader.loadAsync(base + ref.file);
      configureLightmap(t);
      return { texture: t, range: ref.range };
    } catch (err) {
      console.warn(`Lightmap ${ref.file} failed to load; that surface uses flat lighting.`, err);
      return { texture: FALLBACK_LIGHTMAP, range: 1 };
    }
  };

  const gltfPromise = gltfLoader.loadAsync(`${base}apartment.glb`, (e) => {
    if (e.total) {
      glbFraction = e.loaded / e.total;
      report();
    }
  });
  const dayEntries = await Promise.all(
    dayRefs.map(async (ref) => {
      const m = await loadMap(ref);
      mapsDone++;
      report();
      return [ref.file, m] as const;
    }),
  );
  const gltf = await gltfPromise;
  glbFraction = 1;
  report();

  const lightRefs = manifest.chunks.flatMap((c) => (c.light ? [c.light] : []));
  const light = Promise.all(lightRefs.map(async (ref) => [ref.file, await loadMap(ref)] as const)).then(
    (entries) => new Map(entries),
  );
  return { manifest, collision, scene: gltf.scene, day: new Map(dayEntries), light };
}
```

- [ ] **Step 5: Implement `world.ts`**

`web/src/world.ts`:

```ts
import { Mesh, MeshStandardMaterial, Object3D, Quaternion, Scene, Vector3 } from 'three';
import type {} from 'three-mesh-bvh';
import { Collision } from './collision';
import { DoorState } from './doors';
import type { Target } from './interactions';
import { BLACK_LIGHTMAP, RoomLights, setLightTexture } from './lightmaps';
import type { LoadedAssets } from './loader';
import { RoomLocator } from './rooms';
import { prepareMeshes } from './scene-setup';

export interface DoorRuntime { state: DoorState; node: Object3D; base: Quaternion }
export interface World {
  lights: RoomLights;
  doors: DoorRuntime[];
  targets: Map<Object3D, Target>;
  pickables: Object3D[];
  rooms: RoomLocator;
  collision: Collision;
  lightmapped: MeshStandardMaterial[];
}

const UP = new Vector3(0, 1, 0);
const tmp = new Quaternion();

function node(root: Object3D, name: string): Object3D {
  const n = root.getObjectByName(name);
  if (!n) throw new Error(`apartment.glb has no node named ${name}`);
  return n;
}

export function applyDoorRotation(d: DoorRuntime): void {
  d.node.quaternion.copy(d.base).premultiply(tmp.setFromAxisAngle(UP, d.state.angle));
}

export function buildWorld(assets: LoadedAssets, scene: Scene): World {
  const { manifest, day } = assets;
  const root = assets.scene;
  scene.add(root);

  const lightRooms = manifest.chunks.filter((c) => c.light && c.room).map((c) => c.room!);
  const lights = new RoomLights(lightRooms);
  const lightmapped: MeshStandardMaterial[] = [];
  const pickables: Object3D[] = [];
  const pendingLight = new Map<string, MeshStandardMaterial[]>();

  for (const chunk of manifest.chunks) {
    const n = node(root, chunk.node);
    const d = day.get(chunk.day.file)!;
    const intensity = chunk.room && lights.has(chunk.room) ? lights.uniform(chunk.room) : { value: 0 };
    const mats = prepareMeshes(n, {
      day: d.texture, dayRange: d.range, light: BLACK_LIGHTMAP, lightRange: 0, intensity,
    });
    lightmapped.push(...mats);
    if (chunk.light) pendingLight.set(chunk.light.file, mats);
    n.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).geometry.computeBoundsTree?.();
    });
    pickables.push(n);
  }

  assets.light.then((maps) => {
    for (const [file, mats] of pendingLight) {
      const m = maps.get(file);
      if (m) for (const mat of mats) setLightTexture(mat, m.texture, m.range);
    }
  });

  const targets = new Map<Object3D, Target>();
  const doors: DoorRuntime[] = manifest.doors.map((info) => {
    const n = node(root, info.node);
    const d = day.get(info.lightmap.file)!;
    lightmapped.push(...prepareMeshes(n, { day: d.texture, dayRange: d.range, light: BLACK_LIGHTMAP, lightRange: 0, intensity: { value: 0 } }));
    const state = new DoorState(info);
    targets.set(n, { kind: 'door', door: state, node: n });
    pickables.push(n);
    return { state, node: n, base: n.quaternion.clone() };
  });

  for (const room of manifest.rooms) {
    if (!room.switch) continue;
    const n = node(root, room.switch);
    prepareMeshes(n, null);
    targets.set(n, { kind: 'switch', room: room.id, node: n });
    pickables.push(n);
  }

  const collision = new Collision(assets.collision, () => doors.map((d) => d.state.segment()));
  return { lights, doors, targets, pickables, rooms: new RoomLocator(manifest.rooms), collision, lightmapped };
}

```

`world.ts` also starts with `import type {} from 'three-mesh-bvh';`. That pulls in three-mesh-bvh's own `declare module 'three'` augmentation, which types `computeBoundsTree`. Don't declare it locally: a local optional declaration conflicts with the library's (TS2687) as soon as `main.ts` imports three-mesh-bvh.

- [ ] **Step 6: Run the tests and type-check**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: tests PASS and tsc reports no errors

- [ ] **Step 7: Commit**

```bash
git add web/src web/tests
git commit -m "Load assets and build the runtime world (chunks, doors, switches)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: UI, main loop and in-browser check

**Files:**
- Create: `web/index.html`, `web/src/style.css`, `web/src/ui.ts`, `web/src/main.ts`, `web/tests/ui.test.ts`, `.claude/launch.json`

**Interfaces:**
- Consumes: everything in `web/src`.
- Produces: `class UI` (methods below) and `isTouchOnly(matchMedia)`.
- Produces URL parameters: `?view=<camera name>` teleports to that viewpoint with its field of view and freezes movement. `?autostart` skips the start screen and pointer lock (for screenshots). `?debug=lightmap` renders lightmaps only (white albedo).

- [ ] **Step 1: Write the failing UI test**

`web/tests/ui.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isTouchOnly } from '../src/ui';

const media = (coarse: boolean, fine: boolean) => (q: string) => ({
  matches: q === '(pointer: coarse)' ? coarse : q === '(pointer: fine)' ? fine : false,
});

describe('isTouchOnly', () => {
  it('flags phones and tablets', () => expect(isTouchOnly(media(true, false))).toBe(true));
  it('allows desktops and touch laptops', () => {
    expect(isTouchOnly(media(false, true))).toBe(false);
    expect(isTouchOnly(media(true, true))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test`
Expected: FAIL with unresolved `../src/ui`

- [ ] **Step 3: Write the page and styles**

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Apartment Walkthrough</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <canvas id="view"></canvas>
    <div id="start" class="overlay">
      <h1>Apartment Walkthrough</h1>
      <div class="progress"><div id="progress-bar"></div></div>
      <button id="start-button" disabled>Loading…</button>
      <ul class="controls">
        <li><kbd>W A S D</kbd> walk</li>
        <li><kbd>Shift</kbd> walk faster</li>
        <li><kbd>Mouse</kbd> look around</li>
        <li><kbd>Click</kbd> open doors, flip light switches</li>
        <li><kbd>L</kbd> toggle this room's light</li>
        <li><kbd>Esc</kbd> pause</li>
      </ul>
      <p id="error" hidden></p>
      <button id="retry-button" hidden>Try again</button>
    </div>
    <div id="hud" hidden>
      <div id="crosshair"></div>
      <div id="room-name"></div>
      <div id="prompt" hidden></div>
    </div>
    <div id="pause" class="overlay" hidden>
      <p>Paused</p>
      <p class="hint">Click to keep exploring</p>
    </div>
    <div id="notice" class="overlay" hidden><p id="notice-text"></p></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/src/style.css`:

```css
:root {
  --ink: #f4f1ea;
  --muted: #b9b4aa;
  --veil: rgba(18, 17, 15, 0.82);
  --accent: #e8c27a;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--ink);
}
html, body { margin: 0; height: 100%; overflow: hidden; background: #121110; }
#view { display: block; width: 100vw; height: 100vh; }
[hidden] { display: none !important; }
.overlay {
  position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 18px; background: var(--veil); text-align: center; padding: 16px;
}
h1 { font-weight: 500; letter-spacing: 0.02em; margin: 0; }
.progress { width: min(320px, 80vw); height: 4px; background: rgba(255, 255, 255, 0.15); border-radius: 2px; }
#progress-bar { width: 0; height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.2s; }
button {
  font: inherit; color: #121110; background: var(--accent); border: 0; border-radius: 999px;
  padding: 10px 26px; cursor: pointer;
}
button:disabled { opacity: 0.5; cursor: default; }
.controls { list-style: none; padding: 0; margin: 0; color: var(--muted); line-height: 1.9; }
kbd {
  font: inherit; font-size: 0.85em; color: var(--ink); border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px; padding: 1px 6px; margin-right: 6px;
}
#error { color: #f2a19a; max-width: 420px; }
.hint { color: var(--muted); }
#crosshair {
  position: fixed; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px;
  border-radius: 50%; background: rgba(255, 255, 255, 0.85); box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
}
#room-name {
  position: fixed; left: 20px; bottom: 18px; font-size: 15px; letter-spacing: 0.04em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
}
#prompt {
  position: fixed; left: 50%; top: calc(50% + 22px); transform: translateX(-50%); font-size: 14px;
  background: rgba(18, 17, 15, 0.6); padding: 4px 10px; border-radius: 6px;
}
```

- [ ] **Step 4: Implement `ui.ts`**

`web/src/ui.ts`:

```ts
export const COPY = {
  ready: 'Click to explore',
  loadError: "Couldn't load the apartment. Check your connection and try again.",
  mobile: 'Best viewed on desktop. This walkthrough needs a keyboard and mouse.',
  noWebGL: "Your browser doesn't support WebGL 2, which this walkthrough needs. Try a recent Chrome, Firefox, Safari or Edge.",
};

export function isTouchOnly(matchMedia: (q: string) => { matches: boolean }): boolean {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
}

export class UI {
  private lastRoom = '';

  constructor(private doc: Document) {}

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.doc.getElementById(id) as T;
  }

  setProgress(fraction: number): void {
    this.el('progress-bar').style.width = `${Math.round(fraction * 100)}%`;
  }

  setReady(): void {
    const b = this.el<HTMLButtonElement>('start-button');
    b.disabled = false;
    b.textContent = COPY.ready;
  }

  onStart(cb: () => void): void {
    this.el('start-button').addEventListener('click', cb);
  }

  hideStart(): void {
    this.el('start').hidden = true;
  }

  showHud(): void {
    this.el('hud').hidden = false;
  }

  showError(message: string, retry: () => void): void {
    this.el('start-button').hidden = true;
    const e = this.el('error');
    e.textContent = message;
    e.hidden = false;
    const r = this.el('retry-button');
    r.hidden = false;
    r.addEventListener('click', retry, { once: true });
  }

  setRoom(name: string): void {
    if (name === this.lastRoom) return;
    this.lastRoom = name;
    this.el('room-name').textContent = name;
  }

  setPrompt(text: string | null): void {
    const p = this.el('prompt');
    p.hidden = !text;
    if (text && p.textContent !== text) p.textContent = text;
  }

  setPaused(paused: boolean): void {
    this.el('pause').hidden = !paused;
  }

  onResume(cb: () => void): void {
    this.el('pause').addEventListener('click', cb);
  }

  showNotice(text: string): void {
    this.el('start').hidden = true;
    this.el('notice-text').textContent = text;
    this.el('notice').hidden = false;
  }
}
```

- [ ] **Step 5: Implement `main.ts`**

`web/src/main.ts`:

```ts
import {
  AgXToneMapping, BufferGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator,
  Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { CONFIG } from './config';
import { Interactions, promptFor } from './interactions';
import { loadAssets, type LoadedAssets } from './loader';
import { Player, vfovFromHfov } from './player';
import { COPY, isTouchOnly, UI } from './ui';
import { applyDoorRotation, buildWorld } from './world';
import './style.css';

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

const params = new URLSearchParams(location.search);
const ui = new UI(document);

async function boot(): Promise<void> {
  if (isTouchOnly((q) => window.matchMedia(q))) return ui.showNotice(COPY.mobile);
  if (!WebGL.isWebGL2Available()) return ui.showNotice(COPY.noWebGL);

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = CONFIG.exposure;

  const scene = new Scene();
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = CONFIG.envIntensity;

  const camera = new PerspectiveCamera(CONFIG.verticalFov, 1, 0.05, 60);
  let fixedHfov: number | null = null;
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    if (fixedHfov !== null) camera.fov = vfovFromHfov(fixedHfov, camera.aspect);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  let assets: LoadedAssets;
  try {
    assets = await loadAssets((f) => ui.setProgress(f));
  } catch (err) {
    console.error(err);
    return ui.showError(COPY.loadError, () => location.reload());
  }

  const world = buildWorld(assets, scene);
  const names = new Map(assets.manifest.rooms.map((r) => [r.id, CONFIG.roomNames[r.id] ?? r.name]));
  const player = new Player(camera, world.collision, assets.manifest.spawn, assets.manifest.eyeHeight);
  player.resolve();
  player.attach(window, () => document.pointerLockElement);

  const view = params.get('view');
  const vp = view ? assets.manifest.viewpoints.find((v) => v.name === view) : undefined;
  if (vp) {
    player.teleport(vp.position[0], vp.position[2], vp.yaw, vp.pitch, vp.position[1]);
    player.frozen = true;
    fixedHfov = vp.hfov;
    resize();
  }
  if (params.get('debug') === 'lightmap') {
    for (const m of world.lightmapped as MeshStandardMaterial[]) {
      m.color.setRGB(1, 1, 1);
      m.map = null;
      m.needsUpdate = true;
    }
  }

  const interactions = new Interactions(camera, world.pickables, world.targets, world.lights);
  const autostart = params.has('autostart');
  let started = false;
  let currentRoom: string | null = null;

  const start = () => {
    ui.hideStart();
    ui.showHud();
    started = true;
    if (!autostart) canvas.requestPointerLock();
  };
  ui.setReady();
  ui.onStart(start);
  ui.onResume(() => canvas.requestPointerLock());
  if (autostart) start();
  document.addEventListener('pointerlockchange', () => {
    ui.setPaused(started && !autostart && document.pointerLockElement !== canvas);
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && (autostart || document.pointerLockElement === canvas)) interactions.click();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyL' && started && currentRoom && world.lights.has(currentRoom)) world.lights.toggle(currentRoom);
  });

  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const d of world.doors) {
      d.state.update(dt);
      applyDoorRotation(d);
    }
    if (started) player.update(dt);
    if (!player.frozen && world.collision.isBlocked(player.x, player.z)) player.resolve();
    currentRoom = world.rooms.locate(player.x, player.z, currentRoom);
    ui.setRoom(currentRoom ? names.get(currentRoom) ?? '' : '');
    const target = started ? interactions.update() : null;
    ui.setPrompt(target ? promptFor(target, world.lights) : null);
    world.lights.update(dt);
    renderer.render(scene, camera);
  });
}

boot();
```

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "walkthrough",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["--prefix", "web", "run", "dev"],
      "port": 5173
    }
  ]
}
```

- [ ] **Step 6: Run the tests, type-check and build**

Run: `cd web && npm test && npm run build`
Expected: tests PASS, `tsc --noEmit` is clean, and `vite build` writes `web/dist/`.

- [ ] **Step 7: Check it in the browser with the preview assets**

Start the dev server with `preview_start` using the name `walkthrough`, then:
1. Open `http://localhost:5173/`. The start screen shows a filling progress bar, and the button changes to "Click to explore". `read_console_messages` shows no errors.
2. Open `http://localhost:5173/?autostart`. Take a screenshot: you're in the Entrada and the room label reads "Entrada". Hold `W` for 2 s (`computer` key action with `repeat`): the camera moves and stops at walls.
3. Open `?view=Cam_Sala&autostart` and take a screenshot. The Sala is recognisable and lit, with no black chunks and no shimmering seams.
4. Open `?debug=lightmap&view=Cam_Sala&autostart` and take a screenshot. Soft shading should follow the geometry. If the shading looks scrambled or upside down, the lightmap orientation is wrong: flip `t.flipY` in `configureLightmap` and recheck.
5. Aim at a door (`?view=` a camera that faces one, or walk to it) and click: it swings open and the prompt changes to "Click: close door". Aim at a switch and click: the room's light fades in over 0.4 s.

- [ ] **Step 8: Commit**

```bash
git add web .claude/launch.json
git commit -m "Add start screen, HUD and main loop for the walkthrough

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Final bake and visual verification

**Files:**
- Modify: `web/src/config.ts` (`exposure`, `lightmapScale` and `envIntensity` only, if tuning is needed)
- Modify: `blender/pipeline/config.py` (`QUALITY["final"]` only, if the budget check fails)

**Interfaces:**
- Consumes: `make export-final`, the web app's `?view=`, `?autostart` and `?debug=` parameters.
- Produces: final assets in `web/public/assets` and a verified site.

- [ ] **Step 1: Run the final export**

Run in the background with a long timeout: `mkdir -p build && make export-final 2>&1 | tee build/export-final.log`
Expected: `Export OK`. If the budget check fails, lower `lightmap_texels_per_m` in `QUALITY["final"]` from 100 to 80 (or `albedo_max` from 2048 to 1024) and re-run. Record the reported size.

- [ ] **Step 2: Render Cycles reference images from the original file**

These are read-only renders of a staged copy of the source file:

```bash
make render-refs
```

Expected: `build/ref/Cam_Sala.png`, `Cam_Kitchen.png` and `Cam_Bedroom.png` (800×500), rendered at the scene's last frame so the source file's build-up animation has finished.

- [ ] **Step 3: Compare against the browser**

With the dev server running, `resize_window` to 1600×1000 (render aspect 1.6). For each of `Cam_Sala`, `Cam_Kitchen` and `Cam_Bedroom`, open `?view=<cam>&autostart`, take a screenshot, and compare it with `build/ref/<cam>.png` (Read tool). They should match in framing, overall brightness, shadow placement, and colours of the floor, walls and furniture.
- Everything uniformly too bright or too dark: adjust `CONFIG.exposure`.
- Lit areas wrong relative to the albedo: adjust `CONFIG.lightmapScale` (start from `Math.PI`).
- Glossy surfaces too flat or too chrome-like: adjust `CONFIG.envIntensity`.
Keep the values that match best.

- [ ] **Step 4: Walk the whole apartment**

At `?autostart`:
1. Walk into each of the 13 rooms, and check the room label for each.
2. Open and close all 9 doors.
3. Toggle all 12 lights, using both the switch and the L key.
4. Confirm the glazed doorways into the Lavandaria, Marquise and Varanda can be walked through.
5. Confirm you can't leave the apartment or walk through furniture.
6. Close a door while standing in its swing; you should end up next to it, not stuck.

- [ ] **Step 5: Check performance**

At `?view=Cam_Sala&autostart`, run with `javascript_tool`:

```js
await new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(n / 2); }; requestAnimationFrame(f); });
```

Expected: about 60 (frames per second). If it's well below, lower `renderer.setPixelRatio` to `Math.min(devicePixelRatio, 1.5)` in `main.ts` and re-measure.

- [ ] **Step 6: Run all the tests one last time**

Run: `make test-blender && make web-test && (cd web && npm run build)`
Expected: everything passes and the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/config.ts blender/pipeline/config.py
git commit -m "Tune lighting to match Cycles references after the final bake

Final export: <size> MB first view, bake <minutes> min. Verified Sala/Kitchen/Bedroom
against Cycles, walked all rooms, all doors and lights work, ~<fps> fps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
