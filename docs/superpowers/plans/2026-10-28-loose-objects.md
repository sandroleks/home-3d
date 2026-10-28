# Loose Objects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visitors pick up, carry, put down, drop and throw the glasses, mugs, plates, cutlery and other everyday things in the flat's drawers and cupboards, and everyone in the flat sees it live.

**Architecture:** A one-off Blender tool removes the baked stand-ins from those drawers and cupboards and writes where each one's insides are (`web/src/prop-frames.json`). The viewer builds the objects itself (lathe and extruded three.js geometry, matcap materials dimmed by the room's light, like the dining table's game pieces), lays them out from those frames, and runs their flights with its own small physics (ray steps against the flat's meshes). A new `prop` message with a per-object change counter shares holding, flights and resting places between visitors.

**Tech Stack:** TypeScript, three.js 0.170 (with three-mesh-bvh for raycasts), Vitest, Trystero (through the existing `Room`), Blender 5.1 Python (bpy, bmesh) for the one-off tool.

**Spec:** `docs/superpowers/specs/2026-10-28-loose-objects-design.md`

## Global Constraints

- Every interaction stays within 20 ms a frame at 60 Hz; nothing new casts sun shadows (`castShadow = false`), so drawers keep leaving the shadow map alone.
- Never edit `web/public/assets/` by hand; it comes from the export.
- Never run Blender, or a Blender `make` target, from Claude's Bash tool: it cuts the session off from `~/Documents`. Run it from the terminal panel (`mcp__terminal__run_in_terminal`) as its own app with `open -W -n -g -j -a /Applications/Blender.app …`, on a staged copy in `/private/tmp/apartment-walkthrough-blender`.
- The repo's `Untitled.blend` is the newest model (newer than `~/Documents/Untitled.blend`). The tool runs on a staged copy of the repo's file, and the result is copied back over the repo's file.
- A final export (about 1 to 1.5 hours) only starts after the user has seen the preview and said yes.
- Prompts follow the existing form: `Click: pick up glass` / `Tap: put down glass`.
- Ids are the same in every browser: `<slug of the place's Blender name>/<kind>/<n>`, e.g. `island-front-00/fork/3`.
- Code style: match the surrounding files — short doc comments in plain English on exported things, `CONFIG` for every tunable, no new dependencies.
- Commit after each task, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run web tests from `web/`: `npx vitest run tests/<file>.test.ts`; the whole suite with `npm test`; types with `npx tsc --noEmit`.

## File structure

| File | Responsibility |
|---|---|
| `blender/tools/loose_contents.py` (new) | One-off: delete the baked contents of the chosen places; write `prop-frames.json` |
| `web/src/prop-frames.json` (new, generated once by the tool) | Each place's fill, drawer node, front, outward direction and level boxes (three.js space, drawers shut) |
| `web/src/prop-models.ts` (new) | The 17 kinds: name, size, tips, geometry parts and looks |
| `web/src/prop-places.ts` (new) | Layouts per fill; `placesFor(fronts)` → every object's home; `drawerHeights` |
| `web/src/prop-physics.ts` (new) | `Raycast`, `meshRaycast`, `launch`, `fly` (one flight, pure) |
| `web/src/prop-placement.ts` (new) | `findPlacement`: the ghost's pose, or why there's no room |
| `web/src/props.ts` (new) | `Prop`, `Props`: state, materials and light, messages, stacks, leaving visitors |
| `web/src/holding.ts` (new) | The local visitor's hand: hand pose, ghost, throw charge, prompts |
| `web/src/config.ts` | `CONFIG.props` |
| `web/src/world.ts` | `World.solids`: what flights and placement hit |
| `web/src/interactions.ts` | `prop` target kind and prompt |
| `web/src/multiplayer.ts` | `prop` message kind, `sendProp`, hooks `onProp`, `props`, `onLeave` |
| `web/src/ui.ts`, `web/index.html`, `web/src/style.css` | Copy, the touch Throw and Drop buttons |
| `web/src/main.ts` | Wiring |
| `web/tests/planes.ts` (new) | Test helper: an analytic `Raycast` over planes |
| `web/tests/prop-*.test.ts`, `props.test.ts`, `holding.test.ts` (new) | Tests |
| `README.md`, spec | Docs |

---

### Task 1: The model tool, and the frames

**Files:**
- Create: `blender/tools/loose_contents.py`
- Create (generated): `web/src/prop-frames.json`
- Modify (generated): `Untitled.blend`

**Interfaces:**
- Produces `web/src/prop-frames.json`:
  ```json
  { "places": [ { "source": "Island front 00", "fill": "cutlery", "node": "Move_island-front-00", "front": "Move_island-front-00",
                  "out": [0, 0, 1], "levels": [ { "min": [x, y, z], "max": [x, y, z] } ] } ] }
  ```
  three.js world space with the drawers shut. `node` is the drawer the objects ride with (null for a cupboard); `front` is the movable that opens the place (a drawer's own node, or the cupboard's door); `out` is the horizontal unit vector the front faces; each level is the usable box, floor at `min[1]`.

This task has no unit tests (the model's one-off tools have none); it's checked by its report, the JSON and the preview export in Task 10.

- [ ] **Step 1: Write the tool**

```python
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
```

- [ ] **Step 2: Run it on a staged copy, from the terminal panel**

Use `mcp__terminal__run_in_terminal` (never the Bash tool), from the worktree root:

```bash
S=/private/tmp/apartment-walkthrough-blender; mkdir -p $S/home && rsync -a --delete blender shared $S/ && cp Untitled.blend $S/source.blend && rm -f $S/loose.log $S/prop-frames.json && open -W -n -g -j -a /Applications/Blender.app --env HOME=$S/home --stdout $S/loose.log --stderr $S/loose.log --args -b --factory-startup $S/source.blend --python-exit-code 1 --python $S/blender/tools/loose_contents.py -- --save --frames $S/prop-frames.json; tail -40 $S/loose.log
```

Expected: 25 `[loose]` lines, each with a non-zero face count (`… faces of cutlery gone …`), and no traceback. If a line says `0 faces`, the materials or the box for that place are wrong: open `$S/source.blend`'s object in a fresh staged copy, check its material names, fix `REMOVE`/`BOX`, re-stage (the repo's `Untitled.blend` is untouched until Step 3) and run again.

- [ ] **Step 3: Copy the results into the repo and check the JSON**

From the terminal panel:

```bash
S=/private/tmp/apartment-walkthrough-blender; cp $S/source.blend Untitled.blend && cp $S/prop-frames.json web/src/prop-frames.json && node -e "const p=require('./web/src/prop-frames.json').places;console.log(p.length, p.map(x=>x.fill+':'+x.levels.length+':'+x.levels.map(l=>l.max.map((v,i)=>(v-l.min[i]).toFixed(2)).join('x')).join('|')).join('\n'))"
```

Expected: `25`, then one line per place. Every level is wider and deeper than 0.2 m and taller than 0.05 m; cupboards (`glasses`, `coffee-low`, `bar`) have 2 or 3 levels; `oils` has 2; drawers have 1.

- [ ] **Step 4: Commit**

```bash
git add blender/tools/loose_contents.py web/src/prop-frames.json Untitled.blend
git commit -m "Model: the loose things' baked stand-ins go from their drawers and cupboards, and where their insides are

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The kinds of object

**Files:**
- Create: `web/src/prop-models.ts`
- Test: `web/tests/prop-models.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PropKind = 'fork' | 'knife' | 'spoon' | 'teaspoon' | 'plate' | 'bowl' | 'tumbler' | 'wineglass' | 'mug'
    | 'spicejar' | 'container' | 'oilbottle' | 'winebottle' | 'book' | 'case' | 'screwdriver' | 'spool';
  export interface Look { colour: string; gloss?: boolean; opacity?: number }
  export interface Part { geometry: BufferGeometry; look: Look }
  export interface KindInfo { name: string; size: [number, number, number]; tips: boolean; parts(variant: number): Part[] }
  export const KINDS: Record<PropKind, KindInfo>;
  ```
  `size` is the box standing as it rests: width (x), height (y), length (z); origin at the middle of its base; long things lie along z. `parts(v)` returns the same geometry objects every call for the same variant.

- [ ] **Step 1: Write the failing test**

```ts
import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { KINDS, type PropKind } from '../src/prop-models';

const kinds = Object.keys(KINDS) as PropKind[];

describe('prop models', () => {
  it('has the seventeen kinds', () => {
    expect(kinds).toHaveLength(17);
  });

  it.each(kinds)('%s fits its size, standing on its origin', (kind) => {
    const { size, parts } = KINDS[kind];
    for (const variant of [0, 1, 2, 5]) {
      const box = new Box3();
      for (const p of parts(variant)) {
        p.geometry.computeBoundingBox();
        box.union(p.geometry.boundingBox!);
      }
      expect(box.min.x).toBeGreaterThanOrEqual(-size[0] / 2 - 1e-3);
      expect(box.max.x).toBeLessThanOrEqual(size[0] / 2 + 1e-3);
      expect(box.min.z).toBeGreaterThanOrEqual(-size[2] / 2 - 1e-3);
      expect(box.max.z).toBeLessThanOrEqual(size[2] / 2 + 1e-3);
      expect(box.min.y).toBeGreaterThanOrEqual(-1e-3);
      expect(box.max.y).toBeLessThanOrEqual(size[1] + 1e-3);
      expect(box.max.y).toBeGreaterThan(size[1] * 0.8); // the size isn't much bigger than the thing
    }
  });

  it('shares geometry between objects of a kind', () => {
    expect(KINDS.tumbler.parts(0)[0].geometry).toBe(KINDS.tumbler.parts(0)[0].geometry);
    expect(KINDS.book.parts(1)[0].geometry).toBe(KINDS.book.parts(3)[0].geometry);
  });

  it('tips only tall things', () => {
    expect(kinds.filter((k) => KINDS[k].tips).sort()).toEqual(['mug', 'oilbottle', 'spicejar', 'tumbler', 'winebottle', 'wineglass']);
  });

  it('names things for the prompt', () => {
    expect(KINDS.wineglass.name).toBe('wine glass');
    expect(KINDS.tumbler.name).toBe('glass');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd web && npx vitest run tests/prop-models.test.ts`
Expected: FAIL, cannot find `../src/prop-models`.

- [ ] **Step 3: Write `prop-models.ts`**

```ts
import { BoxGeometry, type BufferGeometry, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Shape, TorusGeometry, Vector2 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The things in the drawers and cupboards that visitors can pick up (props.ts). */
export type PropKind = 'fork' | 'knife' | 'spoon' | 'teaspoon' | 'plate' | 'bowl' | 'tumbler' | 'wineglass' | 'mug'
  | 'spicejar' | 'container' | 'oilbottle' | 'winebottle' | 'book' | 'case' | 'screwdriver' | 'spool';

/** What a part is made of: its colour, and whether it shines or is see-through. */
export interface Look { colour: string; gloss?: boolean; opacity?: number }
export interface Part { geometry: BufferGeometry; look: Look }
export interface KindInfo {
  /** What the prompt calls it. */
  name: string;
  /** Its box (m) standing as it rests: width (x), height (y), length (z). The origin is the middle of its base, and
   * long things lie along z. */
  size: [number, number, number];
  /** Tall things fall over when they land hard. */
  tips: boolean;
  /** Its parts; `variant` picks among the looks where there are several (books, spools, lids). Geometry is shared. */
  parts(variant: number): Part[];
}

const STEEL: Look = { colour: '#c9cbcd', gloss: true };
const GLASS: Look = { colour: '#dfeeee', gloss: true, opacity: 0.35 };
const STONEWARE: Look[] = [{ colour: '#ebe8e0', gloss: true }, { colour: '#4f6c8c', gloss: true }];
const BLACK: Look = { colour: '#1c1c1c', gloss: true };
const BOTTLE: Look = { colour: '#3e5c3e', gloss: true, opacity: 0.8 };
const OIL: Look = { colour: '#a8902e', gloss: true, opacity: 0.8 };
const LIDS: Look[] = [BLACK, { colour: '#9a6b42' }];
const CAPSULES: Look[] = [{ colour: '#6d1a24', gloss: true }, { colour: '#c9a227', gloss: true }];
const COVERS: Look[] = ['#7a3b2e', '#2f4a63', '#6b6b3a', '#8a6a3a', '#3d3d3d'].map((colour) => ({ colour }));
const PAGES: Look = { colour: '#efe6d0' };
const HANDLES: Look[] = [{ colour: '#b3261e', gloss: true }, { colour: '#d9a520', gloss: true }];
const FILAMENTS: Look[] = ['#e8e8e8', '#2a2a2a', '#c0392b', '#2e86c1', '#27ae60', '#f39c12'].map((colour) => ({ colour, gloss: true }));

type Profile = [number, number][];
const merge = (parts: BufferGeometry[]) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
/** Turned about y: radius and height (m) from the base up. */
const turned = (p: Profile) => new LatheGeometry(p.map(([r, y]) => new Vector2(r, y)), 24);
/** A flat outline (x across, z along) `thick` m thick, lying on y = 0. */
function flat(outline: Profile, thick: number): BufferGeometry {
  const shape = new Shape(outline.map(([x, z]) => new Vector2(x, -z)));
  return new ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false }).rotateX(-Math.PI / 2);
}
const box = (w: number, h: number, l: number, y: number, x = 0, z = 0) => new BoxGeometry(w, h, l).translate(x, y + h / 2, z);
const ellipse = (rx: number, rz: number, cz: number, n = 16): Profile =>
  Array.from({ length: n }, (_, i) => [rx * Math.cos((2 * Math.PI * i) / n), cz + rz * Math.sin((2 * Math.PI * i) / n)]);

/** Geometry made once, the first time it's asked for. */
function once<T>(make: () => T): () => T {
  let made: T | undefined;
  return () => (made ??= make());
}
/** A kind's parts: shared geometries, each with the look a variant gives it. */
function kind(name: string, size: [number, number, number], tips: boolean, geometry: () => BufferGeometry[], looks: (variant: number) => Look[]): KindInfo {
  const shared = once(geometry);
  return { name, size, tips, parts: (v) => shared().map((g, i) => ({ geometry: g, look: looks(v)[i] })) };
}
const pick = (looks: Look[], v: number) => looks[((v % looks.length) + looks.length) % looks.length];

const FORK: Profile = [
  [-0.006, -0.1], [0.006, -0.1], [0.006, 0.03], [0.004, 0.05], [0.0125, 0.065], [0.0125, 0.1], [0.009, 0.1], [0.009, 0.072],
  [0.0055, 0.072], [0.0055, 0.1], [0.0015, 0.1], [0.0015, 0.072], [-0.0015, 0.072], [-0.0015, 0.1], [-0.0055, 0.1],
  [-0.0055, 0.072], [-0.009, 0.072], [-0.009, 0.1], [-0.0125, 0.1], [-0.0125, 0.065], [-0.004, 0.05], [-0.006, 0.03],
];
const KNIFE: Profile = [[-0.006, -0.11], [0.006, -0.11], [0.007, 0], [0.01, 0.02], [0.009, 0.1], [0, 0.11], [-0.005, 0.1], [-0.006, 0.02]];
const spoon = (s: number) => merge([
  flat([[-0.005 * s, -0.1 * s], [0.005 * s, -0.1 * s], [0.004 * s, 0.04 * s], [-0.004 * s, 0.04 * s]], 0.003 * s),
  flat(ellipse(0.02 * s, 0.032 * s, 0.068 * s), 0.006 * s),
]);

export const KINDS: Record<PropKind, KindInfo> = {
  fork: kind('fork', [0.025, 0.003, 0.2], false, () => [flat(FORK, 0.003)], () => [STEEL]),
  knife: kind('knife', [0.02, 0.003, 0.22], false, () => [flat(KNIFE, 0.003)], () => [STEEL]),
  spoon: kind('spoon', [0.04, 0.006, 0.2], false, () => [spoon(1)], () => [STEEL]),
  teaspoon: kind('teaspoon', [0.028, 0.0042, 0.14], false, () => [spoon(0.7)], () => [STEEL]),
  plate: kind('plate', [0.27, 0.022, 0.27], false,
    () => [turned([[0, 0], [0.06, 0], [0.065, 0.004], [0.12, 0.014], [0.135, 0.022], [0.13, 0.022], [0.115, 0.016], [0.06, 0.007], [0, 0.007]])],
    (v) => [pick(STONEWARE, v)]),
  bowl: kind('bowl', [0.15, 0.065, 0.15], false,
    () => [turned([[0, 0], [0.035, 0], [0.038, 0.005], [0.07, 0.04], [0.075, 0.065], [0.07, 0.065], [0.065, 0.042], [0.034, 0.01], [0, 0.01]])],
    (v) => [pick(STONEWARE, v + 1)]),
  tumbler: kind('glass', [0.076, 0.1, 0.076], true,
    () => [turned([[0, 0], [0.036, 0], [0.038, 0.1], [0.035, 0.1], [0.033, 0.008], [0, 0.008]])], () => [GLASS]),
  wineglass: kind('wine glass', [0.084, 0.2, 0.084], true,
    () => [turned([[0, 0], [0.035, 0], [0.035, 0.003], [0.004, 0.006], [0.004, 0.09], [0.03, 0.11], [0.042, 0.15], [0.038, 0.2],
      [0.036, 0.2], [0.039, 0.15], [0.028, 0.113], [0, 0.1]])], () => [GLASS]),
  mug: kind('mug', [0.14, 0.095, 0.09], true,
    () => [merge([
      turned([[0, 0], [0.04, 0], [0.042, 0.095], [0.038, 0.095], [0.036, 0.006], [0, 0.006]]),
      new TorusGeometry(0.022, 0.005, 8, 16, Math.PI).rotateZ(-Math.PI / 2).translate(0.04, 0.05, 0),
    ])],
    (v) => [pick(STONEWARE, v)]),
  spicejar: kind('spice jar', [0.05, 0.105, 0.05], true,
    () => [turned([[0, 0], [0.022, 0], [0.022, 0.088], [0, 0.088]]), new CylinderGeometry(0.023, 0.023, 0.017, 16).translate(0, 0.0965, 0)],
    (v) => [GLASS, pick(LIDS, v)]),
  container: kind('container', [0.175, 0.075, 0.125], false,
    () => [box(0.17, 0.06, 0.12, 0), box(0.172, 0.012, 0.122, 0.06)], (v) => [GLASS, pick(STONEWARE, v)]),
  oilbottle: kind('oil bottle', [0.065, 0.28, 0.065], true,
    () => [turned([[0, 0], [0.032, 0], [0.032, 0.19], [0.014, 0.23], [0.012, 0.265], [0, 0.265]]),
      new CylinderGeometry(0.013, 0.013, 0.015, 12).translate(0, 0.2725, 0)],
    () => [OIL, BLACK]),
  winebottle: kind('bottle', [0.075, 0.3, 0.075], true,
    () => [turned([[0, 0], [0.037, 0], [0.037, 0.2], [0.034, 0.215], [0.015, 0.245], [0.013, 0.285], [0, 0.285]]),
      new CylinderGeometry(0.0145, 0.0145, 0.05, 12).translate(0, 0.275, 0)],
    (v) => [BOTTLE, pick(CAPSULES, v)]),
  book: kind('book', [0.15, 0.025, 0.22], false,
    () => [merge([box(0.15, 0.003, 0.22, 0), box(0.15, 0.003, 0.22, 0.022), box(0.003, 0.025, 0.22, 0, -0.0735)]),
      box(0.144, 0.019, 0.212, 0.003, 0.002)],
    (v) => [pick(COVERS, v), PAGES]),
  case: kind('glasses case', [0.06, 0.035, 0.16], false, () => [box(0.06, 0.035, 0.16, 0)], () => [BLACK]),
  screwdriver: kind('screwdriver', [0.03, 0.03, 0.2], false,
    () => [new CylinderGeometry(0.014, 0.014, 0.1, 12).rotateX(Math.PI / 2).translate(0, 0.014, -0.05),
      merge([new CylinderGeometry(0.003, 0.003, 0.095, 8).rotateX(Math.PI / 2).translate(0, 0.014, 0.0475), box(0.006, 0.002, 0.006, 0.013, 0, 0.097)])],
    (v) => [pick(HANDLES, v), STEEL]),
  spool: kind('filament spool', [0.2, 0.065, 0.2], false,
    () => [merge([
      turned([[0.02, 0], [0.1, 0], [0.1, 0.005], [0.02, 0.005], [0.02, 0]]),
      turned([[0.02, 0.06], [0.1, 0.06], [0.1, 0.065], [0.02, 0.065], [0.02, 0.06]]),
      turned([[0.02, 0.005], [0.03, 0.005], [0.03, 0.06], [0.02, 0.06], [0.02, 0.005]]),
    ]), turned([[0.03, 0.005], [0.07, 0.005], [0.07, 0.06], [0.03, 0.06], [0.03, 0.005]])],
    (v) => [BLACK, pick(FILAMENTS, v)]),
};
```

- [ ] **Step 4: Run the test**

Run: `cd web && npx vitest run tests/prop-models.test.ts`
Expected: PASS. If a size check fails, fix the `size` (not the test) to the geometry's real extent, keeping the origin at the base's middle.

- [ ] **Step 5: Commit**

```bash
git add web/src/prop-models.ts web/tests/prop-models.test.ts
git commit -m "Loose objects: the seventeen kinds, turned and cut in the browser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Where everything starts

**Files:**
- Create: `web/src/prop-places.ts`
- Test: `web/tests/prop-places.test.ts`

**Interfaces:**
- Consumes: `KINDS`, `PropKind` (Task 2); `web/src/prop-frames.json` (Task 1).
- Produces:
  ```ts
  export type Fill = 'cutlery' | 'plates' | 'spices' | 'containers' | 'oils' | 'nightstand' | 'tools' | 'spools' | 'glasses' | 'coffee-low' | 'bar';
  export interface Level { min: [number, number, number]; max: [number, number, number] }
  export interface PropFrame { source: string; fill: Fill; node: string | null; front: string; out: [number, number, number]; levels: Level[] }
  export interface Slot { kind: PropKind; variant?: number; a: number; b: number; c?: number; yaw?: number; on?: number }
  export interface PlacedProp { id: string; kind: PropKind; variant: number; node: string | null; position: Vector3; quaternion: Quaternion; on: string | null; place: string }
  export const FRAMES: PropFrame[];
  export function levelFrame(out: [number, number, number], level: Level): { corner: Vector3; across: Vector3; inward: Vector3; w: number; d: number; h: number };
  export function fits(s: Slot, w: number, d: number, h: number): boolean;
  export function placesFor(fronts: Set<string>, frames?: PropFrame[]): PlacedProp[];
  export function drawerHeights(fronts: Set<string>, frames?: PropFrame[]): Map<string, number>;
  export function slug(name: string): string;
  ```
  `position`/`quaternion` are world space with the drawers shut; `node` is the drawer node to parent to (null: the room); `on` is the id of the object it lies on (a stack).

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { drawerHeights, fits, FRAMES, levelFrame, placesFor, slug, type PropFrame } from '../src/prop-places';

const fronts = (path: string) =>
  new Set<string>((JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { movables: { node: string }[] }).movables.map((m) => m.node));
const LAYOUTS = {
  open: fronts('../public/assets/manifest.json'),
  wall: fronts('../public/assets/variants/kitchen-wall/manifest.json'),
};
const drawer: PropFrame = {
  source: 'Test drawer', fill: 'cutlery', node: 'Move_test-drawer', front: 'Move_test-drawer', out: [1, 0, 0],
  levels: [{ min: [0, 0.7, 0], max: [0.5, 0.8, 0.45] }],
};

describe('prop places', () => {
  it('turns a level into a frame at its front left corner', () => {
    const f = levelFrame([1, 0, 0], drawer.levels[0]);
    expect(f.inward.x).toBe(-1);
    expect(Math.abs(f.inward.z)).toBe(0);
    expect(f.across.x).toBeCloseTo(0);
    expect(f.across.z).toBeCloseTo(1);
    expect(f.corner.toArray()).toEqual([0.5, 0.7, 0]); // front face at max x, left edge at min z
    expect([f.w, f.d, f.h].map((v) => +v.toFixed(3))).toEqual([0.45, 0.5, 0.1]);
  });

  it('checks that a slot fits its level', () => {
    expect(fits({ kind: 'tumbler', a: 0.05, b: 0.05 }, 0.3, 0.3, 0.2)).toBe(true);
    expect(fits({ kind: 'tumbler', a: 0.02, b: 0.05 }, 0.3, 0.3, 0.2)).toBe(false); // over the side
    expect(fits({ kind: 'wineglass', a: 0.1, b: 0.1 }, 0.3, 0.3, 0.15)).toBe(false); // too tall
    expect(fits({ kind: 'fork', a: 0.1, b: 0.12, yaw: Math.PI / 2 }, 0.3, 0.3, 0.1)).toBe(true); // across, not along
  });

  it('lays a drawer out in the world, stacks included, with stable ids', () => {
    const placed = placesFor(new Set(['Move_test-drawer']), [drawer]);
    expect(placed.length).toBeGreaterThanOrEqual(12);
    expect(placed[0].id).toBe('test-drawer/fork/0');
    expect(placed[0].node).toBe('Move_test-drawer');
    const stacked = placed.filter((p) => p.on);
    expect(stacked.length).toBeGreaterThan(0);
    for (const p of stacked) {
      const under = placed.find((q) => q.id === p.on)!;
      expect(p.position.y).toBeGreaterThan(under.position.y);
    }
    for (const p of placed) { // inside the drawer's box
      expect(p.position.x).toBeLessThanOrEqual(0.5);
      expect(p.position.x).toBeGreaterThanOrEqual(0);
      expect(p.position.y).toBeGreaterThanOrEqual(0.7);
    }
    // its length runs into the drawer: local z turned to -x
    expect(new Vector3(0, 0, 1).applyQuaternion(placed[0].quaternion).x).toBeCloseTo(-1);
  });

  it('leaves out places whose front this layout has not', () => {
    expect(placesFor(new Set(), [drawer])).toEqual([]);
  });

  it('gives drawers their inside height', () => {
    expect(drawerHeights(new Set(['Move_test-drawer']), [drawer]).get('Move_test-drawer')).toBeCloseTo(0.1);
  });

  it('slugs like the export', () => {
    expect(slug('Island front 00')).toBe('island-front-00');
    expect(slug('Front S1 pull-out')).toBe('front-s1-pull-out');
  });

  it.each(Object.entries(LAYOUTS))('stocks the %s layout from the model', (_, layout) => {
    const placed = placesFor(layout);
    expect(new Set(placed.map((p) => p.id)).size).toBe(placed.length);
    expect(placed.length).toBeGreaterThan(80);
    expect(placed.length).toBeLessThan(220);
    for (const p of placed) if (p.node) expect(layout.has(p.node)).toBe(true);
    for (const f of FRAMES.filter((x) => layout.has(x.front))) {
      expect(placed.some((p) => p.place === f.source), `${f.source} has something in it`).toBe(true);
    }
  });

  it('knows every place in some layout', () => {
    for (const f of FRAMES) expect(LAYOUTS.open.has(f.front) || LAYOUTS.wall.has(f.front), f.front).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd web && npx vitest run tests/prop-places.test.ts`
Expected: FAIL, cannot find `../src/prop-places`.

- [ ] **Step 3: Write `prop-places.ts`**

```ts
import { Matrix4, Quaternion, Vector3 } from 'three';
import data from './prop-frames.json';
import { KINDS, type PropKind } from './prop-models';

/** What a place holds: the model's own fills (blender/tools/model_details.py). */
export type Fill = 'cutlery' | 'plates' | 'spices' | 'containers' | 'oils' | 'nightstand' | 'tools' | 'spools' | 'glasses' | 'coffee-low' | 'bar';
/** A usable box inside a drawer or cupboard, three.js space with the drawers shut; its floor is at min[1]. */
export interface Level { min: [number, number, number]; max: [number, number, number] }
/** A drawer or cupboard whose things are loose (blender/tools/loose_contents.py writes them): `node` is the drawer they
 * ride with (null: a cupboard's, in the room), `front` the movable that opens it, `out` the way it faces. */
export interface PropFrame { source: string; fill: Fill; node: string | null; front: string; out: [number, number, number]; levels: Level[] }
/** One object in a level: `a` across from its left edge (facing it), `b` in from the front, `c` up from the floor (m);
 * `yaw` about up (0: its length runs inward); `on`: the slot it lies on, by its index in the level's list. */
export interface Slot { kind: PropKind; variant?: number; a: number; b: number; c?: number; yaw?: number; on?: number }
/** An object at home: its world pose with the drawers shut, the drawer node it rides with (null: the room), and what it
 * lies on (picking up takes the top of a stack). */
export interface PlacedProp { id: string; kind: PropKind; variant: number; node: string | null; position: Vector3; quaternion: Quaternion; on: string | null; place: string }

export const FRAMES = data.places as PropFrame[];
const UP = new Vector3(0, 1, 0);
const TOLERANCE = 0.003;

/** Like the export's slugify. */
export const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const count = (space: number, step: number, max: number) => Math.max(0, Math.min(max, Math.floor(space / step)));
/** `n` places `step` apart, centred across `w`. */
const centred = (n: number, w: number, step: number) => Array.from({ length: n }, (_, i) => (w - (n - 1) * step) / 2 + i * step);

/** Tumblers in front and, where it's tall enough, wine glasses behind. */
function glasses(w: number, h: number): Slot[] {
  const xs = centred(count(w - 0.04, 0.095, 4), w, 0.095);
  return [...xs.map((a): Slot => ({ kind: 'tumbler', a, b: 0.07 })), ...xs.map((a): Slot => ({ kind: h >= 0.21 ? 'wineglass' : 'tumbler', a, b: 0.18 }))];
}
/** `n` of a kind on top of each other, each `step` higher. */
function stack(out: Slot[], kind: PropKind, n: number, a: number, b: number, step: number, variant = 0): void {
  for (let k = 0; k < n; k++) out.push({ kind, variant, a, b, c: k * step, ...(k ? { on: out.length - 1 } : {}) });
}

/** Each fill's layout of a level `w` across, `d` deep and `h` high: the `level`th of `levels`, from the floor up. */
export const LAYOUTS: Record<Fill, (w: number, d: number, h: number, level: number, levels: number) => Slot[]> = {
  cutlery: (w) => { // forks, knives, spoons and teaspoons in the insert's first four columns, a few in each
    const out: Slot[] = [];
    const col = (w - 0.02) / 5;
    (['fork', 'knife', 'spoon', 'teaspoon'] as PropKind[]).forEach((kind, i) => {
      const [, t, len] = KINDS[kind].size;
      for (let k = 0; k < 4; k++) {
        out.push({ kind, a: 0.01 + col * (i + 0.5) + (k - 1.5) * 0.002, b: 0.03 + len / 2, c: 0.008 + k * t, ...(k ? { on: out.length - 1 } : {}) });
      }
    });
    return out;
  },
  plates: (w, d) => {
    const out: Slot[] = [];
    stack(out, 'plate', 5, 0.145, d / 2, 0.02);
    if (w >= 0.46) stack(out, 'bowl', 3, w - 0.085, d / 2, 0.03);
    return out;
  },
  spices: (w) => [0.05, 0.12].flatMap((b) => centred(count(w - 0.04, 0.065, 6), w, 0.065).map((a, i): Slot => ({ kind: 'spicejar', variant: i, a, b }))),
  containers: (w, d) => {
    const xs = centred(count(w - 0.02, 0.185, 3), w, 0.185);
    return Array.from({ length: count(d - 0.04, 0.135, 2) }, (_, j) => xs.map((a, i): Slot => ({ kind: 'container', variant: i + j, a, b: 0.09 + j * 0.135 }))).flat();
  },
  oils: (w, d) => [0.3, 0.7].map((f): Slot => ({ kind: 'oilbottle', a: w * f, b: d / 2 })),
  nightstand: (w) => {
    const out: Slot[] = [];
    stack(out, 'book', 1, 0.095, 0.13, 0, 1);
    out.push({ kind: 'book', variant: 3, a: 0.095, b: 0.13, c: 0.025, on: 0 });
    out.push({ kind: 'case', a: Math.min(0.25, w - 0.04), b: 0.1 });
    return out;
  },
  tools: (w) => Array.from({ length: 5 }, (_, i): Slot => ({ kind: 'screwdriver', variant: i, a: 0.05 + (i * (w - 0.1)) / 4, b: 0.13 })),
  spools: (w, d) => Array.from({ length: count(w - 0.02, 0.21, 6) }, (_, i): Slot => ({ kind: 'spool', variant: i, a: 0.11 + i * 0.21, b: d / 2 })),
  glasses: (w, _d, h, level) => (level < 2 ? glasses(w, h) : []),
  'coffee-low': (w) => centred(count(w - 0.04, 0.12, 5), w, 0.12).map((a, i): Slot => ({ kind: 'mug', variant: i, a, b: 0.08, yaw: Math.PI / 2 })),
  bar: (w, d, h, level) => (level === 0
    ? centred(count(w - 0.02, 0.09, 4), w, 0.09).map((a, i): Slot => ({ kind: 'winebottle', variant: i, a, b: d / 2 }))
    : level === 1 ? glasses(w, h) : []),
};

/** A level's front left corner (facing it), at its floor, and its axes: across to the right, and inward. */
export function levelFrame(out: [number, number, number], level: Level) {
  const o = new Vector3(...out);
  const inward = o.clone().negate();
  const across = new Vector3().crossVectors(UP, inward);
  const corner = new Vector3(0, level.min[1], 0);
  for (const [k, j] of [['x', 0], ['z', 2]] as const) {
    if (Math.abs(across[k]) > 0.5) corner[k] = across[k] > 0 ? level.min[j] : level.max[j];
    else corner[k] = o[k] > 0 ? level.max[j] : level.min[j];
  }
  const extent = (v: Vector3) => Math.abs(v.x) * (level.max[0] - level.min[0]) + Math.abs(v.z) * (level.max[2] - level.min[2]);
  return { corner, across, inward, w: extent(across), d: extent(inward), h: level.max[1] - level.min[1] };
}

/** Whether a slot's object is inside a level `w` across, `d` deep and `h` high. */
export function fits(s: Slot, w: number, d: number, h: number): boolean {
  const [x, y, z] = KINDS[s.kind].size;
  const c = Math.abs(Math.cos(s.yaw ?? 0));
  const n = Math.abs(Math.sin(s.yaw ?? 0));
  const ha = (x * c + z * n) / 2; // half its footprint across and inward, turned by its yaw
  const hb = (x * n + z * c) / 2;
  return s.a - ha >= -TOLERANCE && s.a + ha <= w + TOLERANCE && s.b - hb >= -TOLERANCE && s.b + hb <= d + TOLERANCE
    && (s.c ?? 0) + y <= h + TOLERANCE;
}

const basis = new Matrix4();
const turn = new Quaternion();

/** Every object's home in a layout: the places whose front it has, laid out level by level. What wouldn't fit is left
 * out, and so is anything that would have lain on it. */
export function placesFor(fronts: Set<string>, frames: PropFrame[] = FRAMES): PlacedProp[] {
  const out: PlacedProp[] = [];
  for (const f of frames) {
    if (!fronts.has(f.front)) continue;
    const counts = new Map<PropKind, number>();
    f.levels.forEach((level, li) => {
      const fr = levelFrame(f.out, level);
      const facing = new Quaternion().setFromRotationMatrix(basis.makeBasis(fr.across, UP, fr.inward));
      const ids: (string | null)[] = [];
      for (const s of LAYOUTS[f.fill](fr.w, fr.d, fr.h, li, f.levels.length)) {
        const on = s.on === undefined ? null : ids[s.on];
        if (!fits(s, fr.w, fr.d, fr.h) || on === undefined || (s.on !== undefined && on === null)) {
          ids.push(null);
          continue;
        }
        const n = counts.get(s.kind) ?? 0;
        counts.set(s.kind, n + 1);
        const id = `${slug(f.source)}/${s.kind}/${n}`;
        ids.push(id);
        out.push({
          id, kind: s.kind, variant: s.variant ?? 0, node: f.node, on, place: f.source,
          position: fr.corner.clone().addScaledVector(fr.across, s.a).addScaledVector(fr.inward, s.b).addScaledVector(UP, s.c ?? 0),
          quaternion: facing.clone().multiply(turn.setFromAxisAngle(UP, s.yaw ?? 0)),
        });
      }
    });
  }
  return out;
}

/** How tall a thing may be inside each drawer of a layout (its lowest level), by node. */
export function drawerHeights(fronts: Set<string>, frames: PropFrame[] = FRAMES): Map<string, number> {
  return new Map(frames.filter((f) => f.node && fronts.has(f.front)).map((f) => [f.node!, Math.min(...f.levels.map((l) => l.max[1] - l.min[1]))]));
}
```

- [ ] **Step 4: Run the test**

Run: `cd web && npx vitest run tests/prop-places.test.ts`
Expected: PASS. If a real place has nothing in it ("… has something in it"), print `levelFrame` for that place's levels; the layout's fixed offsets assume at least 0.3 × 0.25 m. Adjust that fill's layout (not the test) so its first object fits.

- [ ] **Step 5: Commit**

```bash
git add web/src/prop-places.ts web/tests/prop-places.test.ts
git commit -m "Loose objects: each drawer and cupboard laid out like the model's fills, with stable ids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Flights

**Files:**
- Modify: `web/src/config.ts` (add `props`)
- Create: `web/src/prop-physics.ts`
- Create: `web/tests/planes.ts`
- Test: `web/tests/prop-physics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Hit { point: Vector3; normal: Vector3; object: Object3D }
  export type Raycast = (from: Vector3, to: Vector3) => Hit | null; // normal faces back along the segment
  export function meshRaycast(objects: Object3D[]): Raycast;
  export interface Flight { position: Vector3; velocity: Vector3; spin: Vector3; quaternion: Quaternion; time: number; bounces: number; impact: number; sliding: boolean }
  export interface Shape { radius: number; tips: boolean }
  export interface Landing { point: Vector3; support: Object3D; tipped: boolean; yaw: number }
  export type Step = { kind: 'flying' } | ({ kind: 'rest' } & Landing) | { kind: 'lost' };
  export function launch(position: Vector3, velocity: Vector3, spin?: Vector3, quaternion?: Quaternion): Flight;
  export function fly(f: Flight, dt: number, raycast: Raycast, shape: Shape, cfg?: typeof CONFIG.props.physics): Step;
  export function yawOf(q: Quaternion): number;
  ```
  `Flight.position` is the object's middle (a ball of `shape.radius`); a landing's `point` is the surface point under it.
- `web/tests/planes.ts` produces `planesRaycast(planes: Plane[]): Raycast`, `floor(y, within?)`, `wallX(x)`, `ceiling(y, within?)`, used by Tasks 5 and 6.

- [ ] **Step 1: Add `CONFIG.props`**

In `web/src/config.ts`, after the `games: { … },` block and before the final `};`, add:

```ts
  /** The things in the drawers and cupboards that visitors pick up, put down and throw (props.ts). */
  props: {
    /** Light inside a drawer or cupboard, as a share of the room's. */
    insideLight: 0.6,
    /** The object under the crosshair, this much brighter. */
    highlight: 1.35,
    /** Where the held object is: right, down and forward (m) from the eye. */
    hand: [0.2, -0.24, -0.45] as [number, number, number],
    /** Another visitor's: forward and down (m) from their animal's mouth. */
    otherHand: [0.18, 0.08] as [number, number],
    /** A throw's speed (m/s) at a tap and at full strength, reached after `chargeTime` s held. */
    throwSpeed: [2, 7] as [number, number],
    chargeTime: 1,
    /** Spin (rad/s) a throw gives, about the axis across its flight. */
    throwSpin: 6,
    /** A drop lets go this far (m) in front of the eye and below it. */
    dropAhead: 0.3,
    dropBelow: 0.6,
    ghostOpacity: 0.35,
    /** Seconds the "someone else took it" note stays up. */
    noticeTime: 1.5,
    physics: {
      gravity: 9.81,
      /** Longest step (s): a fast throw mustn't pass through a thin shelf. */
      step: 1 / 120,
      /** Share of the speed into a surface that comes back from a floor, and from a wall. */
      restitution: 0.3,
      wallRestitution: 0.4,
      /** Share of the speed along a surface kept through a bounce. */
      friction: 0.6,
      /** Slowing (m/s²) while sliding, and the speed it stops at. */
      slideFriction: 3,
      stopSpeed: 0.05,
      /** A rebound slower than this (m/s) and it slides instead. */
      restSpeed: 0.5,
      maxBounces: 4,
      /** Landing faster than this (m/s), a tall thing tips over. A drop from the hand lands slower. */
      tipSpeed: 5,
      /** Seconds before a flight is set down where it is. */
      maxFlight: 6,
      /** Below this height (m) a thing has fallen out of the flat: it goes home. */
      floorCatch: -1,
      /** A surface whose normal points up at least this much (its y) is one to land on. */
      upNormal: 0.7,
      /** How far below a sliding thing its surface may be (m) before it falls off the edge. */
      support: 0.03,
      /** The flying ball's radius at most (m). */
      radiusCap: 0.06,
    },
    place: {
      /** A surface to put things on faces up at least this much (cos 45°). */
      upNormal: 0.707,
      /** How far the surface under each corner may be from the one aimed at (m). */
      support: 0.015,
    },
  },
```

- [ ] **Step 2: Write the test helper `web/tests/planes.ts`**

```ts
import { Object3D, Vector3 } from 'three';
import type { Hit, Raycast } from '../src/prop-physics';

/** An infinite plane n·p = d, cut to where `within` says, standing in for the flat's meshes. */
export interface Plane { normal: Vector3; d: number; within?: (p: Vector3) => boolean; object?: Object3D }
export const SURFACE = new Object3D();

export function planesRaycast(planes: Plane[]): Raycast {
  return (from, to) => {
    const dir = to.clone().sub(from);
    let best: Hit | null = null;
    let bestT = Infinity;
    for (const pl of planes) {
      const denom = pl.normal.dot(dir);
      if (Math.abs(denom) < 1e-12) continue;
      const t = (pl.d - pl.normal.dot(from)) / denom;
      if (t < 1e-9 || t > 1 || t >= bestT) continue;
      const point = from.clone().addScaledVector(dir, t);
      if (pl.within && !pl.within(point)) continue;
      bestT = t;
      best = { point, normal: denom > 0 ? pl.normal.clone().negate() : pl.normal.clone(), object: pl.object ?? SURFACE };
    }
    return best;
  };
}
export const floor = (y = 0, within?: (p: Vector3) => boolean, object?: Object3D): Plane => ({ normal: new Vector3(0, 1, 0), d: y, within, object });
export const ceiling = (y: number, within?: (p: Vector3) => boolean): Plane => ({ normal: new Vector3(0, -1, 0), d: -y, within });
export const wallX = (x: number): Plane => ({ normal: new Vector3(-1, 0, 0), d: -x });
```

- [ ] **Step 3: Write the failing test `web/tests/prop-physics.test.ts`**

```ts
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { fly, launch, type Raycast, type Shape, type Step } from '../src/prop-physics';
import { floor, planesRaycast, wallX } from './planes';

const glass: Shape = { radius: 0.04, tips: true };
const plate: Shape = { radius: 0.06, tips: false };

/** Runs a flight until it stops, at 60 frames a second, for at most `seconds`. */
function run(start: Vector3, velocity: Vector3, ray: Raycast, shape: Shape, seconds = 10, cfg = CONFIG.props.physics): Step {
  const f = launch(start, velocity);
  for (let t = 0; t < seconds; t += 1 / 60) {
    const s = fly(f, 1 / 60, ray, shape, cfg);
    if (s.kind !== 'flying') return s;
  }
  return { kind: 'flying' };
}

describe('prop physics', () => {
  it('drops onto the floor and stays upright from the hand', () => {
    const s = run(new Vector3(0, 1, 0), new Vector3(), planesRaycast([floor(0)]), glass);
    expect(s.kind).toBe('rest');
    if (s.kind !== 'rest') return;
    expect(s.point.y).toBeCloseTo(0, 3);
    expect(Math.abs(s.point.x)).toBeLessThan(0.01);
    expect(s.tipped).toBe(false);
  });

  it('tips a tall thing that lands hard, but not a flat one', () => {
    const hard = run(new Vector3(0, 3, 0), new Vector3(), planesRaycast([floor(0)]), glass);
    expect(hard.kind === 'rest' && hard.tipped).toBe(true);
    const flatOne = run(new Vector3(0, 3, 0), new Vector3(), planesRaycast([floor(0)]), plate);
    expect(flatOne.kind === 'rest' && flatOne.tipped).toBe(false);
  });

  it('bounces and slides to a stop along the floor', () => {
    const s = run(new Vector3(0, 0.05, 0), new Vector3(3, 0, 0), planesRaycast([floor(0)]), plate);
    expect(s.kind).toBe('rest');
    if (s.kind === 'rest') {
      expect(s.point.x).toBeGreaterThan(0.3);
      expect(s.point.x).toBeLessThan(1.2);
    }
  });

  it('comes off a wall and lands in front of it', () => {
    const s = run(new Vector3(0, 1, 0), new Vector3(6, 0, 0), planesRaycast([floor(0), wallX(1)]), glass);
    expect(s.kind).toBe('rest');
    if (s.kind === 'rest') expect(s.point.x).toBeLessThan(1);
  });

  it('slides off the edge of a table onto the floor', () => {
    const table = floor(0.7, (p) => p.x < 0.5);
    const s = run(new Vector3(0, 0.75, 0), new Vector3(3, 0, 0), planesRaycast([table, floor(0)]), plate);
    expect(s.kind).toBe('rest');
    if (s.kind === 'rest') {
      expect(s.point.y).toBeCloseTo(0, 3);
      expect(s.point.x).toBeGreaterThan(0.5);
    }
  });

  it('is lost when it falls out of the flat', () => {
    expect(run(new Vector3(0, 1, 0), new Vector3(), () => null, glass).kind).toBe('lost');
  });

  it('sets a flight down where it is after the longest flight', () => {
    const cfg = { ...CONFIG.props.physics, maxFlight: 0.2, gravity: 0, floorCatch: -1e9 };
    const s = run(new Vector3(0, 1, 0), new Vector3(1, 0, 0), planesRaycast([floor(0)]), glass, 2, cfg);
    expect(s.kind).toBe('rest');
    if (s.kind === 'rest') {
      expect(s.point.y).toBeCloseTo(0, 3);
      expect(s.point.x).toBeCloseTo(0.2, 1);
    }
  });

  it('steps a fast throw finely enough not to pass through a thin shelf', () => {
    const shelf = floor(0.5);
    const s = run(new Vector3(0, 0.6, 0), new Vector3(0, -12, 0), planesRaycast([shelf, floor(0)]), glass);
    expect(s.kind === 'rest' && s.point.y).toBeCloseTo(0.5, 3);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `cd web && npx vitest run tests/prop-physics.test.ts`
Expected: FAIL, cannot find `../src/prop-physics`.

- [ ] **Step 5: Write `prop-physics.ts`**

```ts
import { Euler, type Object3D, Quaternion, Raycaster, Vector3 } from 'three';
import { CONFIG } from './config';

/** Where a segment first meets the flat: the point, the surface's normal facing back along the segment, and the mesh. */
export interface Hit { point: Vector3; normal: Vector3; object: Object3D }
export type Raycast = (from: Vector3, to: Vector3) => Hit | null;
/** A thing in the air: its middle, velocity, spin (rad/s about each axis) and turn; how long it has flown, its bounces,
 * its hardest landing (m/s) and whether it's sliding along a surface now. */
export interface Flight { position: Vector3; velocity: Vector3; spin: Vector3; quaternion: Quaternion; time: number; bounces: number; impact: number; sliding: boolean }
/** A flying thing is a ball: `radius`, and whether it falls over when it lands hard. */
export interface Shape { radius: number; tips: boolean }
/** Where it comes to rest: the surface point under it, the mesh it's on, whether it lies on its side, its heading. */
export interface Landing { point: Vector3; support: Object3D; tipped: boolean; yaw: number }
export type Step = { kind: 'flying' } | ({ kind: 'rest' } & Landing) | { kind: 'lost' };
type Physics = typeof CONFIG.props.physics;

const UP = new Vector3(0, 1, 0);
const move = new Vector3();
const end = new Vector3();
const tangent = new Vector3();
const below = new Vector3();
const axis = new Vector3();
const dq = new Quaternion();
const euler = new Euler();

/** Rays against meshes (three-mesh-bvh makes them fast): the nearest hit, with its normal in world space. */
export function meshRaycast(objects: Object3D[]): Raycast {
  const ray = new Raycaster() as Raycaster & { firstHitOnly?: boolean };
  ray.firstHitOnly = true;
  const dir = new Vector3();
  return (from, to) => {
    dir.subVectors(to, from);
    const far = dir.length();
    if (far < 1e-9) return null;
    ray.set(from, dir.divideScalar(far));
    ray.far = far;
    const hit = ray.intersectObjects(objects, true)[0];
    if (!hit?.face) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (normal.dot(dir) > 0) normal.negate();
    return { point: hit.point.clone(), normal, object: hit.object };
  };
}

export function launch(position: Vector3, velocity: Vector3, spin = new Vector3(), quaternion = new Quaternion()): Flight {
  return { position: position.clone(), velocity: velocity.clone(), spin: spin.clone(), quaternion: quaternion.clone(), time: 0, bounces: 0, impact: 0, sliding: false };
}

/** The heading of a turn: its angle about up. */
export function yawOf(q: Quaternion): number {
  return euler.setFromQuaternion(q, 'YXZ').y;
}

/** Advances a flight by `dt`, in steps of at most `cfg.step`; tells when it comes to rest or is lost. */
export function fly(f: Flight, dt: number, raycast: Raycast, shape: Shape, cfg: Physics = CONFIG.props.physics): Step {
  for (let left = dt; left > 1e-9; left -= cfg.step) {
    const h = Math.min(cfg.step, left);
    f.time += h;
    const s = f.time > cfg.maxFlight ? settle(f, raycast, shape, cfg) : f.sliding ? slide(f, h, raycast, shape, cfg) : step(f, h, raycast, shape, cfg);
    if (s.kind !== 'flying') return s;
  }
  return { kind: 'flying' };
}

function turn(f: Flight, dt: number): void {
  const w = f.spin.length();
  if (w > 1e-6) f.quaternion.premultiply(dq.setFromAxisAngle(axis.copy(f.spin).divideScalar(w), w * dt));
}

function rest(f: Flight, point: Vector3, support: Object3D, shape: Shape, cfg: Physics): Step {
  return { kind: 'rest', point: point.clone(), support, tipped: shape.tips && f.impact > cfg.tipSpeed, yaw: yawOf(f.quaternion) };
}

/** Out of time: put it on whatever is under it. */
function settle(f: Flight, raycast: Raycast, shape: Shape, cfg: Physics): Step {
  const hit = raycast(f.position, below.copy(f.position).addScaledVector(UP, -3));
  return hit ? rest(f, hit.point, hit.object, shape, cfg) : { kind: 'lost' };
}

/** Bounces `v` off a surface: the speed into it comes back times `back`, the speed along it times `keep`. */
function bounce(v: Vector3, n: Vector3, back: number, keep: number): number {
  const vn = v.dot(n);
  tangent.copy(v).addScaledVector(n, -vn).multiplyScalar(keep);
  v.copy(tangent).addScaledVector(n, -vn * back);
  return vn;
}

function step(f: Flight, dt: number, raycast: Raycast, shape: Shape, cfg: Physics): Step {
  f.velocity.y -= cfg.gravity * dt;
  turn(f, dt);
  move.copy(f.velocity).multiplyScalar(dt);
  const len = move.length();
  if (len < 1e-9) return { kind: 'flying' };
  const hit = raycast(f.position, end.copy(f.position).addScaledVector(move, (len + shape.radius) / len));
  if (!hit) {
    f.position.add(move);
    return f.position.y < cfg.floorCatch ? { kind: 'lost' } : { kind: 'flying' };
  }
  f.position.copy(hit.point).addScaledVector(hit.normal, shape.radius);
  if (hit.normal.y < cfg.upNormal) { // a wall or a side: off it, still flying
    bounce(f.velocity, hit.normal, cfg.wallRestitution, 0.8);
    return { kind: 'flying' };
  }
  const vn = bounce(f.velocity, hit.normal, cfg.restitution, cfg.friction);
  f.impact = Math.max(f.impact, -vn);
  f.bounces += 1;
  f.spin.multiplyScalar(0.5);
  if (-vn * cfg.restitution < cfg.restSpeed || f.bounces >= cfg.maxBounces) { // too little left to bounce: slide
    f.sliding = true;
    f.velocity.y = 0;
  }
  return { kind: 'flying' };
}

/** Along the surface it landed on, slowing, until it stops, meets a wall or runs off an edge. */
function slide(f: Flight, dt: number, raycast: Raycast, shape: Shape, cfg: Physics): Step {
  const reach = shape.radius + cfg.support;
  const speed = Math.hypot(f.velocity.x, f.velocity.z);
  const slower = Math.max(0, speed - cfg.slideFriction * dt);
  if (slower < cfg.stopSpeed) {
    const under = raycast(f.position, below.copy(f.position).addScaledVector(UP, -reach));
    if (under) return rest(f, under.point, under.object, shape, cfg);
    f.sliding = false;
    return { kind: 'flying' };
  }
  f.velocity.set(f.velocity.x * (slower / speed), 0, f.velocity.z * (slower / speed));
  move.copy(f.velocity).multiplyScalar(dt);
  const len = move.length();
  const ahead = raycast(f.position, end.copy(f.position).addScaledVector(move, (len + shape.radius) / len));
  if (ahead && ahead.normal.y < cfg.upNormal) {
    f.position.copy(ahead.point).addScaledVector(ahead.normal, shape.radius);
    bounce(f.velocity, ahead.normal, cfg.wallRestitution, 0.8);
    f.velocity.y = 0;
  } else f.position.add(move);
  if (!raycast(f.position, below.copy(f.position).addScaledVector(UP, -reach))) f.sliding = false; // off the edge: it falls
  return { kind: 'flying' };
}
```

- [ ] **Step 6: Run the tests**

Run: `cd web && npx vitest run tests/prop-physics.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. If "bounces and slides" lands outside 0.3 to 1.2 m, check `friction` and `slideFriction` are applied as written; don't widen the test.

- [ ] **Step 7: Commit**

```bash
git add web/src/config.ts web/src/prop-physics.ts web/tests/planes.ts web/tests/prop-physics.test.ts
git commit -m "Loose objects: flights that bounce, slide, tip and come to rest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Putting things down

**Files:**
- Create: `web/src/prop-placement.ts`
- Test: `web/tests/prop-placement.test.ts`

**Interfaces:**
- Consumes: `Raycast`, `Hit` (Task 4); `CONFIG.props.place`, `CONFIG.interactDistance`.
- Produces:
  ```ts
  export interface PlaceProbe {
    raycast: Raycast;
    overlaps: (box: Box3) => boolean;
    drawerOf: (o: Object3D) => { node: Object3D; height: number | null } | null;
  }
  export interface Placement { point: Vector3; yaw: number; node: Object3D | null }
  export type PlaceResult = { ok: true; placement: Placement } | { ok: false; reason: 'wall' | 'room' };
  export function findPlacement(from: Vector3, dir: Vector3, yaw: number, size: [number, number, number], probe: PlaceProbe, cfg?: typeof CONFIG.props.place, reach?: number): PlaceResult | null;
  ```
  `null`: nothing in reach. `'wall'`: aimed at something that isn't a surface facing up (then the crosshair's own target, a door or a drawer front, takes the click). `'room'`: a surface, but the thing doesn't fit there.

- [ ] **Step 1: Write the failing test**

```ts
import { Box3, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { findPlacement, type PlaceProbe } from '../src/prop-placement';
import { ceiling, floor, planesRaycast, wallX } from './planes';

const down = new Vector3(0, -1, -1).normalize();
const eye = new Vector3(0, 1.6, 0);
const glass: [number, number, number] = [0.076, 0.1, 0.076];
const probe = (planes: Parameters<typeof planesRaycast>[0], extra: Partial<PlaceProbe> = {}): PlaceProbe =>
  ({ raycast: planesRaycast(planes), overlaps: () => false, drawerOf: () => null, ...extra });

describe('findPlacement', () => {
  it('puts a thing on a worktop where the crosshair meets it', () => {
    const r = findPlacement(eye, down, 0.3, glass, probe([floor(0.9)]));
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.placement.point.y).toBeCloseTo(0.9);
      expect(r.placement.point.z).toBeCloseTo(-0.7);
      expect(r.placement.yaw).toBe(0.3);
      expect(r.placement.node).toBeNull();
    }
  });

  it('does not put things on walls', () => {
    expect(findPlacement(eye, new Vector3(1, 0, 0), 0, glass, probe([wallX(1)]))).toEqual({ ok: false, reason: 'wall' });
  });

  it('only reaches so far', () => {
    expect(findPlacement(eye, down, 0, glass, probe([floor(0.9)]), undefined, 0.5)).toBeNull();
  });

  it('needs the surface under all of it', () => {
    const edge = floor(0.9, (p) => p.z > -0.72); // the worktop ends just past where the crosshair meets it
    expect(findPlacement(eye, down, 0, glass, probe([edge, floor(0)]))).toEqual({ ok: false, reason: 'room' });
  });

  it('needs room above it', () => {
    expect(findPlacement(eye, down, 0, glass, probe([floor(0.9), ceiling(0.95, (p) => p.z < -0.5)]))).toEqual({ ok: false, reason: 'room' });
  });

  it('keeps things apart', () => {
    const boxes: Box3[] = [];
    const r = findPlacement(eye, down, 0, glass, probe([floor(0.9)], { overlaps: (b) => (boxes.push(b.clone()), true) }));
    expect(r).toEqual({ ok: false, reason: 'room' });
    expect(boxes[0].max.y - boxes[0].min.y).toBeCloseTo(0.1);
  });

  it('puts a thing in a drawer when it fits under the drawer above', () => {
    const drawer = new Object3D();
    const inside = (height: number) => probe([floor(0.9)], { drawerOf: () => ({ node: drawer, height }) });
    const ok = findPlacement(eye, down, 0, glass, inside(0.15));
    expect(ok?.ok && ok.placement.node).toBe(drawer);
    expect(findPlacement(eye, down, 0, glass, inside(0.08))).toEqual({ ok: false, reason: 'room' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd web && npx vitest run tests/prop-placement.test.ts`
Expected: FAIL, cannot find `../src/prop-placement`.

- [ ] **Step 3: Write `prop-placement.ts`**

```ts
import { Box3, type Object3D, Vector3 } from 'three';
import { CONFIG } from './config';
import type { Raycast } from './prop-physics';

/** What placing needs from the flat: rays, the other loose things, and which drawer a surface is part of (and how tall
 * a thing may be in it, so it can still close). */
export interface PlaceProbe {
  raycast: Raycast;
  overlaps: (box: Box3) => boolean;
  drawerOf: (o: Object3D) => { node: Object3D; height: number | null } | null;
}
/** Where a thing would go: the surface point under its middle, its heading, and the drawer it would ride with. */
export interface Placement { point: Vector3; yaw: number; node: Object3D | null }
/** `wall`: not a surface facing up; `room`: a surface, but the thing doesn't fit there. */
export type PlaceResult = { ok: true; placement: Placement } | { ok: false; reason: 'wall' | 'room' };

const UP = new Vector3(0, 1, 0);
const to = new Vector3();
const a = new Vector3();
const b = new Vector3();

/**
 * Where a thing of `size` (width, height, length) goes when put down along a ray from `from`: on the first surface the
 * ray meets within reach, standing upright and turned to `yaw`, if the surface is under all of its footprint, nothing is
 * above it, and no other loose thing is in the way. Null when nothing is in reach.
 */
export function findPlacement(from: Vector3, dir: Vector3, yaw: number, size: [number, number, number], probe: PlaceProbe,
  cfg = CONFIG.props.place, reach = CONFIG.interactDistance): PlaceResult | null {
  const hit = probe.raycast(from, to.copy(from).addScaledVector(dir, reach));
  if (!hit) return null;
  if (hit.normal.y < cfg.upNormal) return { ok: false, reason: 'wall' };
  const point = hit.point;
  const [w, h, l] = size;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) =>
    new Vector3((i * w) / 2, 0, (j * l) / 2).applyAxisAngle(UP, yaw).add(point));
  const box = new Box3().setFromPoints([...corners, point.clone().addScaledVector(UP, h)]);
  for (const c of [point, ...corners.map((c) => c.clone().lerp(point, 0.1))]) { // nothing above it
    if (probe.raycast(a.copy(c).addScaledVector(UP, 0.01), b.copy(c).addScaledVector(UP, h + 0.01))) return { ok: false, reason: 'room' };
  }
  for (const c of corners) { // the surface under each corner
    const under = probe.raycast(a.copy(c).addScaledVector(UP, 0.05), b.copy(c).addScaledVector(UP, -0.03));
    if (!under || Math.abs(under.point.y - point.y) > cfg.support) return { ok: false, reason: 'room' };
  }
  if (probe.overlaps(box)) return { ok: false, reason: 'room' };
  const drawer = probe.drawerOf(hit.object);
  if (drawer && drawer.height !== null && h > drawer.height + 0.002) return { ok: false, reason: 'room' };
  return { ok: true, placement: { point: point.clone(), yaw, node: drawer?.node ?? null } };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run tests/prop-placement.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/prop-placement.ts web/tests/prop-placement.test.ts
git commit -m "Loose objects: where a held thing can be put down, and when there's no room

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The objects and their shared state

**Files:**
- Create: `web/src/props.ts`
- Test: `web/tests/props.test.ts`

**Interfaces:**
- Consumes: `KINDS` (Task 2), `PlacedProp` (Task 3), `fly`, `launch`, `Raycast`, `Landing`, `yawOf` (Task 4), `Placement` (Task 5), `Matcaps` (`web/src/creatures.ts`), `CONFIG.props`.
- Produces:
  ```ts
  export type PropMessage =
    | { id: string; n: number; by: string; s: 'held' }
    | { id: string; n: number; by: string; s: 'fly'; p: V3; v: V3; w: V3 }
    | { id: string; n: number; by: string; s: 'rest'; parent: string | null; p: V3; q: V4 }
    | { id: string; n: number; by: string; s: 'home' };
  export function isPropMessage(v: unknown): v is PropMessage;
  export const CARRIED_LAYER = 1;
  export interface PropWorld {
    root: Object3D; node: (name: string) => Object3D | null; drawerOf: (o: Object3D) => Object3D | null; raycast: Raycast;
    light: (x: number, z: number) => number; selfId: () => string; hand: (id: string, position: Vector3, quaternion: Quaternion) => boolean;
  }
  export class Prop { readonly root: Group; readonly place: PlacedProp; readonly info: KindInfo; id: string; n: number; by: string;
    state: 'rest' | 'held' | 'fly'; holder: string | null; atHome: boolean; over: Prop | null; under: Prop | null; }
  export class Props {
    readonly list: Prop[];
    constructor(places: PlacedProp[], world: PropWorld, matcaps: Matcaps);
    get held(): Prop | null;                      // what this visitor holds
    top(p: Prop): Prop;                           // the top of p's stack
    highlight(p: Prop | null): void;
    overlaps(box: Box3): boolean;                 // any resting thing but the held one
    pickUp(p: Prop): PropMessage | null;
    place(at: Placement): PropMessage | null;
    throw(from: Vector3, velocity: Vector3): PropMessage | null;
    drop(from: Vector3): PropMessage | null;
    update(dt: number): PropMessage[];            // flights this visitor threw that came to rest (or were lost)
    receive(m: PropMessage): boolean;
    messages(): PropMessage[];                    // everything away from home, for a newcomer
    leave(id: string, at: Vector3 | null): void;  // a visitor gone: what they held drops where they were
  }
  ```
  Message poses (`p`, `q`) are in the parent's space: the drawer node named by `parent`, or `world.root` when it's null. `fly`'s `p` is the middle in world space.

- [ ] **Step 1: Write the failing test**

```ts
import { Box3, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { PlacedProp } from '../src/prop-places';
import { CARRIED_LAYER, isPropMessage, type PropMessage, Props, type PropWorld } from '../src/props';
import { floor, planesRaycast } from './planes';

const matcaps = { matte: null, gloss: null };
const placed = (id: string, extra: Partial<PlacedProp> = {}): PlacedProp => ({
  id, kind: 'tumbler', variant: 0, node: null, position: new Vector3(0, 0.9, 0), quaternion: new Quaternion(), on: null, place: 'Test', ...extra,
});

function setup(places: PlacedProp[] = [placed('a/tumbler/0'), placed('a/tumbler/1', { position: new Vector3(0.2, 0.9, 0) })]) {
  const root = new Object3D();
  const drawer = new Object3D();
  drawer.name = 'Move_drawer';
  drawer.position.set(1, 0, 0);
  root.add(drawer);
  const floorMesh = new Object3D();
  root.add(floorMesh);
  const hands = new Map<string, Vector3>([['me', new Vector3(0, 1.4, 0)], ['ana', new Vector3(2, 1.4, 0)]]);
  const world: PropWorld = {
    root,
    node: (n) => (n === drawer.name ? drawer : null),
    drawerOf: (o) => (o === drawer ? drawer : null),
    raycast: planesRaycast([floor(0, undefined, floorMesh)]),
    light: () => 1,
    selfId: () => 'me',
    hand: (id, p, q) => {
      const h = hands.get(id);
      if (!h) return false;
      p.copy(h);
      q.identity();
      return true;
    },
  };
  const props = new Props(places, world, matcaps);
  return { props, world, root, drawer };
}
const world = (o: Object3D) => o.getWorldPosition(new Vector3());

describe('Props', () => {
  it('builds every object at home, in the room or its drawer', () => {
    const { props, drawer } = setup([placed('a/tumbler/0'), placed('d/fork/0', { kind: 'fork', node: 'Move_drawer', position: new Vector3(1.1, 0.8, 0) })]);
    expect(props.list).toHaveLength(2);
    expect(props.list[1].root.parent).toBe(drawer);
    expect(world(props.list[1].root).x).toBeCloseTo(1.1);
    drawer.position.x += 0.4; // the drawer opens: its things go with it
    expect(world(props.list[1].root).x).toBeCloseTo(1.5);
  });

  it('picks up one thing at a time and shows it in the hand', () => {
    const { props } = setup();
    const [a, b] = props.list;
    expect(props.pickUp(a)).toEqual({ id: 'a/tumbler/0', n: 1, by: 'me', s: 'held' });
    expect(props.held).toBe(a);
    expect(props.pickUp(b)).toBeNull();
    props.update(1 / 60);
    expect(world(a.root).y).toBeCloseTo(1.4);
    a.root.traverse((o) => expect(o.layers.isEnabled(CARRIED_LAYER)).toBe(true));
  });

  it('takes the top of a stack', () => {
    const { props } = setup([placed('p/plate/0', { kind: 'plate' }), placed('p/plate/1', { kind: 'plate', position: new Vector3(0, 0.92, 0), on: 'p/plate/0' })]);
    const [bottom, top] = props.list;
    expect(props.top(bottom)).toBe(top);
    expect(props.pickUp(bottom)?.id).toBe('p/plate/1');
    expect(props.top(bottom)).toBe(bottom);
  });

  it('puts a thing down in the room or in a drawer, relative to it', () => {
    const { props, drawer } = setup();
    const [a, b] = props.list;
    props.pickUp(a);
    const m = props.place({ point: new Vector3(0.5, 0.9, -0.5), yaw: 0, node: null }) as Extract<PropMessage, { s: 'rest' }>;
    expect(m).toMatchObject({ id: a.id, n: 2, s: 'rest', parent: null });
    expect(m.p.map((v) => +v.toFixed(4))).toEqual([0.5, 0.9, -0.5]);
    expect(props.held).toBeNull();
    expect(a.atHome).toBe(false);
    props.pickUp(b);
    const inDrawer = props.place({ point: new Vector3(1.1, 0.8, 0), yaw: 0, node: drawer }) as Extract<PropMessage, { s: 'rest' }>;
    expect(inDrawer.parent).toBe('Move_drawer');
    expect(inDrawer.p[0]).toBeCloseTo(0.1);
    expect(b.root.parent).toBe(drawer);
  });

  it('throws a thing, and tells the others where it came to rest', () => {
    const { props } = setup();
    const [a] = props.list;
    props.pickUp(a);
    const m = props.throw(new Vector3(0, 1.2, 0), new Vector3(2, 0, 0)); // soft enough to land upright
    expect(m).toMatchObject({ id: a.id, n: 2, s: 'fly', v: [2, 0, 0] });
    let rest: PropMessage[] = [];
    for (let i = 0; i < 600 && !rest.length; i++) rest = props.update(1 / 60);
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ id: a.id, n: 3, by: 'me', s: 'rest', parent: null });
    expect(world(a.root).y).toBeCloseTo(0, 2);
    expect(world(a.root).x).toBeGreaterThan(0.5);
  });

  it('drops a thing at its feet, upright', () => {
    const { props } = setup();
    const [a] = props.list;
    props.pickUp(a);
    props.drop(new Vector3(0, 1, -0.3));
    for (let i = 0; i < 300; i++) props.update(1 / 60);
    expect(world(a.root).y).toBeCloseTo(0, 2);
    expect(new Vector3(0, 1, 0).applyQuaternion(a.root.getWorldQuaternion(new Quaternion())).y).toBeCloseTo(1);
  });

  it('takes the newer change, and on a tie the lower id', () => {
    const { props } = setup();
    const [a] = props.list;
    expect(props.receive({ id: a.id, n: 1, by: 'zed', s: 'held' })).toBe(true);
    expect(a.holder).toBe('zed');
    expect(props.receive({ id: a.id, n: 1, by: 'ana', s: 'held' })).toBe(true); // same count, lower id
    expect(a.holder).toBe('ana');
    expect(props.receive({ id: a.id, n: 1, by: 'zed', s: 'held' })).toBe(false);
    expect(props.receive({ id: a.id, n: 0, by: 'ana', s: 'home' })).toBe(false);
    expect(props.receive({ id: 'nope', n: 9, by: 'ana', s: 'home' })).toBe(false);
  });

  it('loses a thing to someone who took it at the same moment', () => {
    const { props } = setup();
    const [a] = props.list;
    props.pickUp(a); // n 1 by me
    props.receive({ id: a.id, n: 1, by: 'ana', s: 'held' }); // 'ana' < 'me'
    expect(props.held).toBeNull();
    expect(a.holder).toBe('ana');
  });

  it('runs a flight another visitor threw, and moves it where they say it landed', () => {
    const { props } = setup();
    const [a] = props.list;
    props.receive({ id: a.id, n: 1, by: 'ana', s: 'fly', p: [0, 1.2, 0], v: [1, 0, 0], w: [0, 0, 0] });
    let sent: PropMessage[] = [];
    for (let i = 0; i < 600; i++) sent = sent.concat(props.update(1 / 60));
    expect(sent).toEqual([]); // ana tells where it landed, not this visitor
    expect(world(a.root).y).toBeCloseTo(0, 2);
    props.receive({ id: a.id, n: 2, by: 'ana', s: 'rest', parent: null, p: [0.7, 0, 0.1], q: [0, 0, 0, 1] });
    expect(world(a.root).toArray().map((v) => +v.toFixed(3))).toEqual([0.7, 0, 0.1]);
  });

  it('shows a thing at home when its resting place is not in this layout', () => {
    const { props } = setup();
    const [a] = props.list;
    props.receive({ id: a.id, n: 1, by: 'ana', s: 'rest', parent: 'Move_island', p: [0, 0, 0], q: [0, 0, 0, 1] });
    expect(a.atHome).toBe(true);
    props.receive({ id: a.id, n: 2, by: 'ana', s: 'rest', parent: null, p: [3, 0.9, 0], q: [0, 0, 0, 1] }); // nothing under it here
    expect(a.atHome).toBe(true);
    expect(a.n).toBe(2);
  });

  it('drops what a leaving visitor held where they were', () => {
    const { props } = setup();
    const [a, b] = props.list;
    props.receive({ id: a.id, n: 4, by: 'ana', s: 'held' });
    props.leave('ana', new Vector3(2, 1, 0));
    expect(a.state).toBe('rest');
    expect(a.n).toBe(5);
    expect(world(a.root).toArray().map((v) => +v.toFixed(3))).toEqual([2, 0, 0]);
    props.receive({ id: b.id, n: 1, by: 'bo', s: 'held' });
    props.leave('bo', null);
    expect(b.atHome).toBe(true);
  });

  it('sends a newcomer everything away from home', () => {
    const { props } = setup();
    const [a, b] = props.list;
    expect(props.messages()).toEqual([]);
    props.pickUp(a);
    props.receive({ id: b.id, n: 1, by: 'ana', s: 'rest', parent: null, p: [0.5, 0, 0], q: [0, 0, 0, 1] });
    expect(props.messages().map((m) => [m.id, m.s])).toEqual([[a.id, 'held'], [b.id, 'rest']]);
  });

  it('sends home what falls out of the flat', () => {
    const { props, world: w } = setup();
    w.raycast = () => null;
    const [a] = props.list;
    props.pickUp(a);
    props.throw(new Vector3(0, 1.5, 0), new Vector3(1, 0, 0));
    let sent: PropMessage[] = [];
    for (let i = 0; i < 600 && !sent.length; i++) sent = props.update(1 / 60);
    expect(sent[0]).toMatchObject({ id: a.id, s: 'home', n: 3 });
    expect(a.atHome).toBe(true);
  });

  it('finds what is in the way of a new place', () => {
    const { props } = setup();
    expect(props.overlaps(new Box3(new Vector3(-0.05, 0.9, -0.05), new Vector3(0.05, 1, 0.05)))).toBe(true);
    expect(props.overlaps(new Box3(new Vector3(-0.05, 2, -0.05), new Vector3(0.05, 2.1, 0.05)))).toBe(false);
  });

  it('checks messages from the network', () => {
    expect(isPropMessage({ id: 'a', n: 1, by: 'x', s: 'held' })).toBe(true);
    expect(isPropMessage({ id: 'a', n: 1, by: 'x', s: 'rest', parent: null, p: [0, 0, 0], q: [0, 0, 0, 1] })).toBe(true);
    expect(isPropMessage({ id: 'a', n: 1, by: 'x', s: 'fly', p: [0, 0, 0], v: [0, 0], w: [0, 0, 0] })).toBe(false);
    expect(isPropMessage({ id: 'a', n: -1, by: 'x', s: 'home' })).toBe(false);
    expect(isPropMessage({ id: 'a', n: 1, by: 'x', s: 'rest', parent: 3, p: [0, 0, 0], q: [0, 0, 0, 1] })).toBe(false);
    expect(isPropMessage({ id: 'a', n: 1, by: 'x', s: 'fly', p: [0, NaN, 0], v: [0, 0, 0], w: [0, 0, 0] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd web && npx vitest run tests/props.test.ts`
Expected: FAIL, cannot find `../src/props`.

- [ ] **Step 3: Write `props.ts`**

```ts
import { Box3, Color, Group, Matrix4, Mesh, MeshMatcapMaterial, type Object3D, Quaternion, Vector3 } from 'three';
import { CONFIG } from './config';
import type { Matcaps } from './creatures';
import { KINDS, type KindInfo } from './prop-models';
import type { PlacedProp } from './prop-places';
import type { Placement } from './prop-placement';
import { type Flight, fly, type Landing, launch, type Raycast, type Shape } from './prop-physics';

type V3 = [number, number, number];
type V4 = [number, number, number, number];
/** A change to one loose thing, as sent between visitors. `n` counts its changes: the higher wins, then the lower `by`
 * (who made it). A rest's `p` and `q` are in its parent's space (a drawer's node, or the room's when null); a flight's
 * `p` is its middle, `v` its velocity and `w` its spin, in the room's. */
export type PropMessage =
  | { id: string; n: number; by: string; s: 'held' }
  | { id: string; n: number; by: string; s: 'fly'; p: V3; v: V3; w: V3 }
  | { id: string; n: number; by: string; s: 'rest'; parent: string | null; p: V3; q: V4 }
  | { id: string; n: number; by: string; s: 'home' };

const finite = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
export function isPropMessage(v: unknown): v is PropMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  if (typeof m.id !== 'string' || typeof m.by !== 'string' || typeof m.n !== 'number' || !Number.isInteger(m.n) || m.n < 0) return false;
  switch (m.s) {
    case 'held': case 'home': return true;
    case 'fly': return finite(m.p, 3) && finite(m.v, 3) && finite(m.w, 3);
    case 'rest': return (m.parent === null || typeof m.parent === 'string') && finite(m.p, 3) && finite(m.q, 4);
    default: return false;
  }
}

/** Held and flying things are drawn on this layer too, which the crosshair's rays leave out. */
export const CARRIED_LAYER = 1;

/** What the loose things need from the flat and the visitors. */
export interface PropWorld {
  /** The room: what rests outside a drawer is its child. */
  root: Object3D;
  /** A drawer's node by name (null: not in this layout). */
  node: (name: string) => Object3D | null;
  /** The drawer node a mesh is part of, if any. */
  drawerOf: (o: Object3D) => Object3D | null;
  raycast: Raycast;
  /** How lit a spot is, 0..1. */
  light: (x: number, z: number) => number;
  selfId: () => string;
  /** Where a visitor's hand is, in the room; false while they can't be seen. */
  hand: (id: string, position: Vector3, quaternion: Quaternion) => boolean;
}

const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);
const ONE = new Vector3(1, 1, 1);
const m4 = new Matrix4();
const inv = new Matrix4();
const pos = new Vector3();
const quat = new Quaternion();
const box = new Box3();
const a = new Vector3();
const b = new Vector3();

/** Sets an object's pose in the world, whatever its parent. */
function setWorldPose(o: Object3D, position: Vector3, quaternion: Quaternion): void {
  o.parent!.updateWorldMatrix(true, false);
  m4.compose(position, quaternion, ONE).premultiply(inv.copy(o.parent!.matrixWorld).invert());
  m4.decompose(o.position, o.quaternion, o.scale);
  o.updateMatrixWorld(true);
}
const upright = (yaw: number) => new Quaternion().setFromAxisAngle(UP, yaw);

/** One loose thing: its meshes and materials, where it lives, and its share of the flat's state. */
export class Prop {
  readonly root = new Group();
  readonly info: KindInfo;
  n = 0;
  by = '';
  state: 'rest' | 'held' | 'fly' = 'rest';
  /** Who holds it, or threw it while it flies. */
  holder: string | null = null;
  flight: Flight | null = null;
  atHome = true;
  /** At home in a stack: what lies on it, and what it lies on. */
  over: Prop | null = null;
  under: Prop | null = null;
  readonly shape: Shape;
  private materials: { material: MeshMatcapMaterial; base: Color }[] = [];
  private level = -1;

  constructor(readonly place: PlacedProp, matcaps: Matcaps) {
    this.info = KINDS[place.kind];
    this.root.name = `Prop_${place.id}`;
    for (const part of this.info.parts(place.variant)) {
      const base = new Color(part.look.colour);
      const see = part.look.opacity !== undefined;
      const material = new MeshMatcapMaterial({
        color: base.clone(), matcap: (part.look.gloss ? matcaps.gloss : matcaps.matte) ?? null,
        transparent: see, opacity: part.look.opacity ?? 1, depthWrite: !see,
      });
      this.materials.push({ material, base });
      const mesh = new Mesh(part.geometry, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
    }
    const [w, h, l] = this.info.size;
    this.shape = { radius: Math.min(CONFIG.props.physics.radiusCap, Math.max(w, h, l) / 2), tips: this.info.tips };
  }

  get id(): string {
    return this.place.id;
  }

  /** At home, or back in the drawer it came from: a little darker. */
  get inside(): boolean {
    return this.state === 'rest' && (this.atHome || (this.place.node !== null && this.root.parent?.name === this.place.node));
  }

  /** Held or flying: drawn on the carried layer only, so the crosshair's rays (layer 0) pass it by. */
  setCarried(on: boolean): void {
    this.root.traverse((o) => o.layers.set(on ? CARRIED_LAYER : 0));
  }

  /** How lit it is, 0..1 (and more for the highlight). */
  setLevel(level: number): void {
    if (Math.abs(level - this.level) < 1e-3) return;
    this.level = level;
    for (const m of this.materials) m.material.color.copy(m.base).multiplyScalar(level);
  }
}

/** Every loose thing in the flat, what this visitor does with them, and what the others did. */
export class Props {
  readonly list: Prop[];
  private byId = new Map<string, Prop>();
  private homes = new Map<Prop, { parent: Object3D; position: Vector3; quaternion: Quaternion }>();
  private lit: Prop | null = null;

  constructor(places: PlacedProp[], private world: PropWorld, matcaps: Matcaps) {
    this.list = places.map((p) => new Prop(p, matcaps));
    for (const p of this.list) {
      this.byId.set(p.id, p);
      const parent = (p.place.node && world.node(p.place.node)) || world.root;
      parent.add(p.root);
      setWorldPose(p.root, p.place.position, p.place.quaternion);
      this.homes.set(p, { parent, position: p.root.position.clone(), quaternion: p.root.quaternion.clone() });
    }
    for (const p of this.list) this.stackHome(p);
  }

  /** What this visitor holds. */
  get held(): Prop | null {
    const me = this.world.selfId();
    return this.list.find((p) => p.state === 'held' && p.holder === me) ?? null;
  }

  /** The top of a stack: picking up any of it takes that one. */
  top(p: Prop): Prop {
    while (p.over) p = p.over;
    return p;
  }

  highlight(p: Prop | null): void {
    this.lit = p;
  }

  /** Whether a box meets anything resting (or flying), the held thing aside. */
  overlaps(test: Box3): boolean {
    return this.list.some((p) => p.state !== 'held' && box.setFromObject(p.root).intersectsBox(test));
  }

  pickUp(p: Prop): PropMessage | null {
    if (this.held) return null;
    const t = this.top(p);
    if (t.state !== 'rest') return null;
    this.bump(t, this.world.selfId());
    this.hold(t, t.by);
    return { id: t.id, n: t.n, by: t.by, s: 'held' };
  }

  place(at: Placement): PropMessage | null {
    const p = this.held;
    if (!p) return null;
    this.bump(p, this.world.selfId());
    this.restAt(p, at.node ?? this.world.root, at.point, upright(at.yaw));
    return this.restMessage(p);
  }

  throw(from: Vector3, velocity: Vector3): PropMessage | null {
    const p = this.held;
    if (!p) return null;
    const spin = new Vector3().crossVectors(UP, velocity);
    if (spin.lengthSq() > 1e-9) spin.setLength(CONFIG.props.throwSpin);
    return this.launchHeld(p, from, velocity, spin);
  }

  drop(from: Vector3): PropMessage | null {
    const p = this.held;
    return p ? this.launchHeld(p, from, new Vector3(), new Vector3()) : null;
  }

  update(dt: number): PropMessage[] {
    const out: PropMessage[] = [];
    const me = this.world.selfId();
    for (const p of this.list) {
      if (p.state === 'held') {
        p.root.visible = !!p.holder && this.world.hand(p.holder, pos, quat);
        if (p.root.visible) setWorldPose(p.root, pos, quat);
      } else if (p.state === 'fly' && p.flight) {
        const step = fly(p.flight, dt, this.world.raycast, p.shape);
        if (step.kind === 'flying') this.poseFlight(p);
        else {
          const mine = p.holder === me;
          if (step.kind === 'rest') this.land(p, step);
          else this.goHome(p);
          if (mine) {
            this.bump(p, me);
            out.push(step.kind === 'rest' ? this.restMessage(p) : { id: p.id, n: p.n, by: p.by, s: 'home' });
          }
        }
      }
      p.root.getWorldPosition(pos);
      p.setLevel(this.world.light(pos.x, pos.z) * (p.inside ? CONFIG.props.insideLight : 1) * (p === this.lit ? CONFIG.props.highlight : 1));
    }
    return out;
  }

  receive(m: PropMessage): boolean {
    const p = this.byId.get(m.id);
    if (!p || !(m.n > p.n || (m.n === p.n && m.by < p.by))) return false;
    p.n = m.n;
    p.by = m.by;
    if (m.s === 'held') this.hold(p, m.by);
    else if (m.s === 'home') this.goHome(p);
    else if (m.s === 'fly') {
      const v = new Vector3(...m.v);
      const most = CONFIG.props.throwSpeed[1] * 1.5;
      if (v.length() > most) v.setLength(most);
      this.startFlight(p, new Vector3(...m.p), v, new Vector3(...m.w), m.by);
    } else {
      const parent = m.parent === null ? this.world.root : this.world.node(m.parent);
      if (!parent) this.goHome(p); // a drawer of the other kitchen
      else {
        this.detach(p);
        parent.add(p.root);
        p.root.position.set(...m.p);
        p.root.quaternion.set(...m.q);
        p.root.updateMatrixWorld(true);
        this.settle(p);
        if (m.parent === null && !this.supported(p)) this.goHome(p); // nothing under it in this layout
      }
    }
    return true;
  }

  messages(): PropMessage[] {
    return this.list.filter((p) => !p.atHome).map((p): PropMessage => {
      if (p.state === 'held') return { id: p.id, n: p.n, by: p.by, s: 'held' };
      if (p.state === 'fly' && p.flight) {
        const f = p.flight;
        return { id: p.id, n: p.n, by: p.by, s: 'fly', p: f.position.toArray() as V3, v: f.velocity.toArray() as V3, w: f.spin.toArray() as V3 };
      }
      return this.restMessage(p);
    });
  }

  leave(id: string, at: Vector3 | null): void {
    for (const p of this.list) {
      if (p.state !== 'held' || p.holder !== id) continue;
      this.bump(p, id);
      const hit = at && this.world.raycast(a.copy(at), b.copy(at).addScaledVector(UP, -3));
      if (hit) this.restAt(p, this.world.root, hit.point, upright(0));
      else this.goHome(p);
    }
  }

  private bump(p: Prop, by: string): void {
    p.n += 1;
    p.by = by;
  }

  private hold(p: Prop, holder: string): void {
    this.detach(p);
    p.state = 'held';
    p.holder = holder;
    p.flight = null;
    p.atHome = false;
    this.world.root.attach(p.root);
    p.setCarried(true);
  }

  private launchHeld(p: Prop, from: Vector3, velocity: Vector3, spin: Vector3): PropMessage {
    this.bump(p, this.world.selfId());
    this.startFlight(p, from, velocity, spin, p.by);
    const f = p.flight!;
    return { id: p.id, n: p.n, by: p.by, s: 'fly', p: f.position.toArray() as V3, v: f.velocity.toArray() as V3, w: f.spin.toArray() as V3 };
  }

  private startFlight(p: Prop, from: Vector3, velocity: Vector3, spin: Vector3, thrower: string): void {
    this.detach(p);
    if (p.root.parent !== this.world.root) this.world.root.attach(p.root);
    p.state = 'fly';
    p.holder = thrower;
    p.atHome = false;
    p.flight = launch(from, velocity, spin, p.root.getWorldQuaternion(new Quaternion()));
    p.setCarried(true);
    this.poseFlight(p);
  }

  /** A flight's middle is its ball's; the object's origin is the middle of its base. */
  private poseFlight(p: Prop): void {
    const f = p.flight!;
    pos.copy(UP).applyQuaternion(f.quaternion).multiplyScalar(-p.info.size[1] / 2).add(f.position);
    setWorldPose(p.root, pos, f.quaternion);
  }

  private land(p: Prop, l: Landing): void {
    const parent = this.world.drawerOf(l.support) ?? this.world.root;
    const q = upright(l.yaw);
    const point = l.point.clone();
    if (l.tipped) { // on its side, along its heading
      q.multiply(new Quaternion().setFromAxisAngle(SIDE, Math.PI / 2));
      point.addScaledVector(UP, p.info.size[0] / 2);
    }
    this.restAt(p, parent, point, q);
  }

  private restAt(p: Prop, parent: Object3D, point: Vector3, q: Quaternion): void {
    this.detach(p);
    parent.add(p.root);
    setWorldPose(p.root, point, q);
    this.settle(p);
  }

  private settle(p: Prop): void {
    p.state = 'rest';
    p.holder = null;
    p.flight = null;
    p.atHome = false;
    p.root.visible = true;
    p.setCarried(false);
  }

  private goHome(p: Prop): void {
    const home = this.homes.get(p)!;
    this.detach(p);
    home.parent.add(p.root);
    p.root.position.copy(home.position);
    p.root.quaternion.copy(home.quaternion);
    p.root.updateMatrixWorld(true);
    this.settle(p);
    p.atHome = true;
    this.stackHome(p);
    for (const q of this.list) if (q.atHome && q.place.on === p.id) this.stackHome(q);
  }

  /** At home, lie on what it lay on, if that's at home and bare. */
  private stackHome(p: Prop): void {
    const under = p.place.on ? this.byId.get(p.place.on) : undefined;
    if (under && under.atHome && !under.over) {
      under.over = p;
      p.under = under;
    }
  }

  /** Out of its stack, as it leaves its place. */
  private detach(p: Prop): void {
    if (p.under) p.under.over = null;
    p.under = null;
  }

  /** Whether there's a surface just under a resting thing. */
  private supported(p: Prop): boolean {
    p.root.getWorldPosition(pos);
    return !!this.world.raycast(a.copy(pos).addScaledVector(UP, 0.05), b.copy(pos).addScaledVector(UP, -0.05));
  }

  private restMessage(p: Prop): PropMessage {
    const parent = p.root.parent === this.world.root ? null : p.root.parent?.name ?? null;
    return { id: p.id, n: p.n, by: p.by, s: 'rest', parent, p: p.root.position.toArray() as V3, q: p.root.quaternion.toArray() as V4 };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run tests/props.test.ts && npx tsc --noEmit`
Expected: PASS. Two things to watch:
- "drops a thing at its feet, upright": the drop starts 1 m up, so it lands at about 4.4 m/s, under `tipSpeed` 5.
- In "puts a thing down … in a drawer", the drawer is at x = 1, so the local x is 0.1.

- [ ] **Step 5: Commit**

```bash
git add web/src/props.ts web/tests/props.test.ts
git commit -m "Loose objects: picking up, putting down, throwing and dropping, shared with a change counter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The `prop` message between visitors

**Files:**
- Modify: `web/src/multiplayer.ts`
- Test: `web/tests/multiplayer.test.ts`

**Interfaces:**
- Consumes: `PropMessage`, `isPropMessage` (Task 6).
- Produces: `MessageKind` gains `'prop'`; `Multiplayer.sendProp(m: PropMessage): void`; `MultiplayerHooks` gains:
  ```ts
  /** A loose thing another visitor moved (well-formed; whether to take it is the props' call). */
  onProp?: (m: PropMessage) => void;
  /** Everything away from home, sent to a newcomer with the flat's state. */
  props?: () => PropMessage[];
  /** A visitor left or timed out (before their animal goes). */
  onLeave?: (id: string) => void;
  ```

- [ ] **Step 1: Write the failing tests**

In `web/tests/multiplayer.test.ts`, add `import type { PropMessage } from '../src/props';` at the top. In `setup`, add `const propsIn: PropMessage[] = []; const leftIds: string[] = []; let away: PropMessage[] = [];`, pass these hooks to `new Multiplayer` alongside `games`:

```ts
    onProp: (m) => void propsIn.push(m), props: () => away, onLeave: (id) => void leftIds.push(id),
```

and return `propsIn, leftIds, setAway: (m: PropMessage[]) => { away = m; }` from `setup`. Then add, inside `describe('Multiplayer', …)`:

```ts
  it('passes on loose things that others move, and only well-formed ones', () => {
    const { fake, propsIn } = setup();
    fake.receive('prop', { id: 'a/tumbler/0', n: 1, by: 'p1', s: 'held' }, 'p1');
    fake.receive('prop', { id: 'a/tumbler/0', n: 'x', by: 'p1', s: 'held' }, 'p1');
    expect(propsIn).toEqual([{ id: 'a/tumbler/0', n: 1, by: 'p1', s: 'held' }]);
  });

  it('sends a newcomer the loose things away from home, with the flat', () => {
    const { fake, setAway } = setup();
    const away: PropMessage = { id: 'a/tumbler/0', n: 2, by: 'me', s: 'rest', parent: null, p: [1, 0, 1], q: [0, 0, 0, 1] };
    setAway([away]);
    fake.receive('state', { want: 1 }, 'p1');
    expect(fake.sent.filter((s) => s.kind === 'prop')).toEqual([{ kind: 'prop', data: away, to: 'p1' }]);
  });

  it('sends a loose thing to everyone', () => {
    const { fake, mp } = setup();
    mp.sendProp({ id: 'a/tumbler/0', n: 1, by: 'me', s: 'held' });
    expect(fake.sent.at(-1)).toEqual({ kind: 'prop', data: { id: 'a/tumbler/0', n: 1, by: 'me', s: 'held' } });
  });

  it('says who left, while their animal is still there', () => {
    const { fake, leftIds, avatars } = setup();
    fake.receive('hello', { name: 'Bo', since: 500 }, 'p1');
    let seen = false;
    const before = avatars.remove.bind(avatars);
    avatars.remove = (id: string) => { seen = leftIds.includes(id); before(id); };
    fake.leave('p1');
    expect(leftIds).toEqual(['p1']);
    expect(seen).toBe(true);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run tests/multiplayer.test.ts`
Expected: FAIL (`'prop'` has no handler; `sendProp` is not a function; `onLeave` never called).

- [ ] **Step 3: Change `multiplayer.ts`**

1. Imports: add `import { isPropMessage, type PropMessage } from './props';`.
2. Kinds:
   ```ts
   export type MessageKind = 'hello' | 'pose' | 'state' | 'game' | 'prop';
   const KINDS: MessageKind[] = ['hello', 'pose', 'state', 'game', 'prop'];
   ```
3. In `MultiplayerHooks`, after `games?`, add the three hooks from **Interfaces** above, with their doc comments.
4. In the constructor's `'state'` handler, after `for (const game of hooks.games?.() ?? []) room.send('game', game, id);` add:
   ```ts
        for (const m of hooks.props?.() ?? []) room.send('prop', m as unknown as Json, id);
   ```
5. After the `'game'` handler, add:
   ```ts
    room.onMessage('prop', (data, id) => {
      if (!isPropMessage(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      hooks.onProp?.(data);
    });
   ```
6. After `sendGame`, add:
   ```ts
  /** Tells the others what happened to a loose thing. */
  sendProp(m: PropMessage): void {
    this.room.send('prop', m as unknown as Json);
  }
   ```
7. In `depart`, after `if (!this.peers.remove(id)) return;` add `this.hooks.onLeave?.(id);` (before `this.avatars.remove(id)`). In `tick`, inside `for (const id of gone) {`, add `this.hooks.onLeave?.(id);` as the first line.

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run tests/multiplayer.test.ts && npx tsc --noEmit`
Expected: PASS, the old tests included.

- [ ] **Step 5: Commit**

```bash
git add web/src/multiplayer.ts web/tests/multiplayer.test.ts
git commit -m "Multiplayer: a prop message for the loose things, to newcomers too, and word of who left

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Targets, solids and the hand

**Files:**
- Modify: `web/src/interactions.ts`
- Modify: `web/src/world.ts`
- Create: `web/src/holding.ts`
- Modify: `web/src/ui.ts` (copy only), `web/src/presence.ts`, `web/src/main.ts` (one line)
- Test: `web/tests/interactions.test.ts`, `web/tests/world.test.ts`, `web/tests/holding.test.ts`

**Interfaces:**
- Consumes: `Prop`, `Props`, `PropMessage`, `CARRIED_LAYER` (Task 6); `findPlacement`, `PlaceProbe`, `PlaceResult` (Task 5); `yawOf` (Task 4).
- Produces:
  - `Target` gains `| { kind: 'prop'; prop: Prop; node: Object3D }`; `promptFor` gives `${verb}: pick up ${name}`; `activate` does nothing for it (main picks it up).
  - `World.solids: Object3D[]`: the chunks, doors and movables (what flights hit and things are put on).
  - `COPY.holdHint`, `COPY.holdHintTouch`, `COPY.noRoom`, `COPY.taken`.
  - ```ts
    export class Holding {
      readonly ghost: Group;
      constructor(props: Props, camera: PerspectiveCamera, probe: PlaceProbe, send: (m: PropMessage) => void, now?: () => number);
      get holding(): boolean;
      hand(position: Vector3, quaternion: Quaternion): void;
      update(dt: number, aim?: Vector2): void;
      prompt(verb: string, touch: boolean, otherTarget: boolean): string | null;
      place(): boolean;
      placeAt(aim: Vector2): boolean;
      startThrow(): void;
      releaseThrow(): void;
      drop(): void;
      lost(): void;
    }
    ```

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/interactions.test.ts`. In its first line, change `type Vector3` to `Vector3` and add `Quaternion` to the three import; add `import { Prop } from '../src/props';`. Then:

```ts
  it('prompts a loose thing to be picked up, and leaves the picking up to the caller', () => {
    const lights = new LightGroups([]);
    const prop = new Prop({ id: 'a/wineglass/0', kind: 'wineglass', variant: 0, node: null, position: new Vector3(), quaternion: new Quaternion(), on: null, place: 'A' }, { matte: null, gloss: null });
    const t: Target = { kind: 'prop', prop, node: prop.root };
    expect(promptFor(t, lights)).toBe('Click: pick up wine glass');
    expect(promptFor(t, lights, 'Tap')).toBe('Tap: pick up wine glass');
    activate(t, lights);
    expect(prop.state).toBe('rest');
  });
```

Add to `web/tests/world.test.ts`, inside `describe('buildWorld', …)`:

```ts
  it('gives flights and placing the rooms, doors and movables to hit, not switches or lamp boxes', () => {
    const { world, root } = build();
    expect(world.solids.map((o) => o.name)).toEqual(['Room_alpha', 'Room_beta', 'Room_exterior', 'Door_1', 'Move_cabinet-drawer', 'Move_cabinet-door']);
    expect(world.solids).not.toContain(root.getObjectByName('Switch_alpha'));
  });
```

Create `web/tests/holding.test.ts`:

```ts
import { Object3D, PerspectiveCamera, Quaternion, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Holding } from '../src/holding';
import type { PropMessage } from '../src/props';
import { Props } from '../src/props';
import { COPY } from '../src/ui';
import { floor, planesRaycast, wallX } from './planes';

function setup(planes = [floor(0.9)]) {
  const root = new Object3D();
  const camera = new PerspectiveCamera(70, 1, 0.05, 60);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 0.9, -0.7);
  camera.updateMatrixWorld();
  const raycast = planesRaycast(planes);
  const sent: PropMessage[] = [];
  let holding!: Holding;
  const props = new Props([{ id: 'a/tumbler/0', kind: 'tumbler', variant: 0, node: null, position: new Vector3(5, 0.9, 5), quaternion: new Quaternion(), on: null, place: 'A' }], {
    root, node: () => null, drawerOf: () => null, raycast, light: () => 1, selfId: () => 'me',
    hand: (id, p, q) => (id === 'me' ? (holding.hand(p, q), true) : false),
  }, { matte: null, gloss: null });
  let t = 0;
  holding = new Holding(props, camera, { raycast, overlaps: (b) => props.overlaps(b), drawerOf: () => null }, (m) => void sent.push(m), () => t);
  return { props, holding, sent, camera, tick: (s: number) => { t += s; holding.update(s); } };
}

describe('Holding', () => {
  it('says nothing while the hand is empty', () => {
    const { holding } = setup();
    holding.update(0);
    expect(holding.prompt('Click', false, false)).toBeNull();
  });

  it('shows where a held thing would go, and puts it there', () => {
    const { props, holding, sent } = setup();
    sent.push(props.pickUp(props.list[0])!);
    holding.update(0);
    expect(holding.ghost.visible).toBe(true);
    expect(holding.ghost.position.y).toBeCloseTo(0.9);
    expect(holding.prompt('Click', false, false)).toBe('Click: put down glass');
    expect(holding.place()).toBe(true);
    expect(sent.at(-1)).toMatchObject({ s: 'rest' });
    expect(holding.holding).toBe(false);
  });

  it('hints at throwing where there is nowhere to put it, unless something else is under the crosshair', () => {
    const { props, holding } = setup([wallX(-0.5)]);
    props.pickUp(props.list[0]);
    holding.update(0);
    expect(holding.ghost.visible).toBe(false);
    expect(holding.prompt('Click', false, false)).toBe(COPY.holdHint);
    expect(holding.prompt('Tap', true, false)).toBe(COPY.holdHintTouch);
    expect(holding.prompt('Click', false, true)).toBeNull(); // a door or drawer front: its own prompt
    expect(holding.place()).toBe(false);
  });

  it('throws harder the longer it is held, up to full strength', () => {
    const speed = (seconds: number) => {
      const { props, holding, sent, tick } = setup();
      props.pickUp(props.list[0]);
      holding.startThrow();
      tick(seconds);
      holding.releaseThrow();
      const m = sent.at(-1) as Extract<PropMessage, { s: 'fly' }>;
      return new Vector3(...m.v).length();
    };
    const [slow, fast] = CONFIG.props.throwSpeed;
    expect(speed(0)).toBeCloseTo(slow);
    expect(speed(CONFIG.props.chargeTime / 2)).toBeCloseTo((slow + fast) / 2);
    expect(speed(5)).toBeCloseTo(fast);
  });

  it('drops in front of the eye, below it', () => {
    const { props, holding, sent, camera } = setup();
    props.pickUp(props.list[0]);
    holding.drop();
    const m = sent.at(-1) as Extract<PropMessage, { s: 'fly' }>;
    expect(m.v).toEqual([0, 0, 0]);
    expect(m.p[1]).toBeCloseTo(camera.position.y - CONFIG.props.dropBelow);
  });

  it('says so for a while when someone else took it', () => {
    const { holding, tick } = setup();
    holding.lost();
    expect(holding.prompt('Click', false, false)).toBe(COPY.taken);
    tick(CONFIG.props.noticeTime + 0.1);
    expect(holding.prompt('Click', false, false)).toBeNull();
  });

  it('puts it down where a tap says', () => {
    const { props, holding } = setup();
    props.pickUp(props.list[0]);
    expect(holding.placeAt(new Vector2(0, 0))).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx vitest run tests/interactions.test.ts tests/world.test.ts tests/holding.test.ts`
Expected: FAIL (`kind: 'prop'` is not a `Target`; `world.solids` undefined; cannot find `../src/holding`).

- [ ] **Step 3: Change `interactions.ts`**

- Import: `import type { Prop } from './props';`
- In `Target`, add after the `screen` member: `| { kind: 'prop'; prop: Prop; node: Object3D }`
- In `promptFor`'s switch, add: `case 'prop': return \`${verb}: pick up ${t.prop.info.name}\`;`
- In `activate`'s switch, change `case 'seat': return;` to `case 'seat': case 'prop': return; // sitting and picking up are main.ts's`
- In the `Interactions` constructor, after `this.raycaster.far = CONFIG.interactDistance;`, add nothing: the default raycaster layer is 0, which held and flying things leave (Task 6's `setCarried`).

Loose things are never part of the flat's shared state (they have their own message), so keep them out of it. In `web/src/presence.ts`:

```ts
export type SharedTarget = Exclude<Target, { kind: 'seat' } | { kind: 'prop' }>;
```

and in `stateDelta`: `return t.kind === 'seat' || t.kind === 'prop' ? {} : { [stateKey(t)]: stateValue(t, lights) };`. In `web/src/main.ts`, the `byKey` line: `(t.kind === 'seat' || t.kind === 'prop' ? [] : …)`. Add `web/src/presence.ts` to this task's commit.

- [ ] **Step 4: Change `world.ts`**

- In `interface World`, after `pickables: Object3D[];`, add:
  ```ts
  /** What flights hit and things are put on: the rooms, the doors and the drawers and cupboard doors. */
  solids: Object3D[];
  ```
- In `buildWorld`, declare `const solids: Object3D[] = [];` next to `pickables`. Push into it in three places: in the chunk loop (`for (const chunk of manifest.chunks) solids.push(lightmap(…))` won't work since `lightmap` returns materials, so write it as `{ const n = node(root, chunk.node); lightmap(n, …); solids.push(n); }`), after `lightmap(n, info.lightmap, …)` in `doors`, and after the same in `movables`.
- Add `solids` to the returned object.

- [ ] **Step 5: Add copy to `ui.ts`**

In `COPY`, after `stand: 'Move to stand up',` add:

```ts
  holdHint: 'Right-click or F to throw, Q to drop',
  holdHintTouch: 'Throw or drop it with the buttons',
  noRoom: 'No room here',
  taken: 'Someone else took it',
```

- [ ] **Step 6: Write `holding.ts`**

```ts
import { Group, Mesh, MeshBasicMaterial, type PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { CONFIG } from './config';
import { yawOf } from './prop-physics';
import { findPlacement, type PlaceProbe, type PlaceResult } from './prop-placement';
import { CARRIED_LAYER, type Prop, type PropMessage, type Props } from './props';
import { COPY } from './ui';

const UP = new Vector3(0, 1, 0);
const CENTRE = new Vector2(0, 0);
const camQ = new Quaternion();

/** This visitor's hand: where the held thing is, where it would go, throwing and dropping it. */
export class Holding {
  /** A faint copy of the held thing where it would go; in the scene, on the carried layer. */
  readonly ghost = new Group();
  private result: PlaceResult | null = null;
  private charge: number | null = null;
  private noticeUntil = -Infinity;
  private ghostOf: Prop | null = null;
  private ray = new Raycaster();
  private ghostMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: CONFIG.props.ghostOpacity, depthWrite: false });

  constructor(private props: Props, private camera: PerspectiveCamera, private probe: PlaceProbe, private send: (m: PropMessage) => void,
    private now: () => number = () => performance.now() / 1000) {
    this.ghost.name = 'Prop ghost';
    this.ghost.visible = false;
  }

  get holding(): boolean {
    return this.props.held !== null;
  }

  /** Low and to the right of the view, upright and turned the way the visitor faces. */
  hand(position: Vector3, quaternion: Quaternion): void {
    this.camera.updateMatrixWorld();
    position.fromArray(CONFIG.props.hand).applyMatrix4(this.camera.matrixWorld);
    quaternion.setFromAxisAngle(UP, this.yaw());
  }

  /** Every frame: the throw's charge, and where the held thing would go along the ray through `aim`. */
  update(dt: number, aim: Vector2 = CENTRE): void {
    if (this.charge !== null) this.charge += dt;
    const held = this.props.held;
    this.result = held ? this.find(held, aim) : null;
    if (!held || !this.result?.ok) {
      this.ghost.visible = false;
      return;
    }
    if (this.ghostOf !== held) this.makeGhost(held);
    this.ghost.visible = true;
    this.ghost.position.copy(this.result.placement.point);
    this.ghost.quaternion.setFromAxisAngle(UP, this.result.placement.yaw);
  }

  /** What to say: a note, or what a click would do with the held thing. Null hands the prompt back to the crosshair's
   * target (`otherTarget`: a door, a drawer front, a lamp), or to nothing. */
  prompt(verb: string, touch: boolean, otherTarget: boolean): string | null {
    if (this.now() < this.noticeUntil) return COPY.taken;
    const held = this.props.held;
    if (!held) return null;
    if (this.result?.ok) return `${verb}: put down ${held.info.name}`;
    if (this.result?.reason === 'room') return COPY.noRoom;
    return otherTarget ? null : touch ? COPY.holdHintTouch : COPY.holdHint;
  }

  /** Puts the held thing where the ghost is; false when there's nowhere to. */
  place(): boolean {
    if (!this.result?.ok) return false;
    const m = this.props.place(this.result.placement);
    if (m) this.send(m);
    this.ghost.visible = false;
    return !!m;
  }

  /** A tap: put it down where the tap points. */
  placeAt(aim: Vector2): boolean {
    this.update(0, aim);
    return this.place();
  }

  startThrow(): void {
    if (this.holding && this.charge === null) this.charge = 0;
  }

  /** Throws along the view, harder the longer it was held. */
  releaseThrow(): void {
    if (this.charge === null) return;
    const strength = Math.min(1, this.charge / CONFIG.props.chargeTime);
    this.charge = null;
    const [slow, fast] = CONFIG.props.throwSpeed;
    const from = this.camera.getWorldPosition(new Vector3());
    const m = this.props.throw(from, this.camera.getWorldDirection(new Vector3()).multiplyScalar(slow + (fast - slow) * strength));
    if (m) this.send(m);
  }

  /** Lets go in front of the eye and below it, or at the eye where a wall is that close. */
  drop(): void {
    this.charge = null;
    const eye = this.camera.getWorldPosition(new Vector3());
    const ahead = new Vector3(-Math.sin(this.yaw()), 0, -Math.cos(this.yaw()));
    const at = eye.clone().addScaledVector(ahead, CONFIG.props.dropAhead).addScaledVector(UP, -CONFIG.props.dropBelow);
    const m = this.props.drop(this.probe.raycast(eye, at) ? eye : at);
    if (m) this.send(m);
  }

  /** Someone else took what this visitor held. */
  lost(): void {
    this.charge = null;
    this.noticeUntil = this.now() + CONFIG.props.noticeTime;
  }

  private yaw(): number {
    return yawOf(this.camera.getWorldQuaternion(camQ));
  }

  private find(held: Prop, aim: Vector2): PlaceResult | null {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(aim, this.camera);
    return findPlacement(this.ray.ray.origin, this.ray.ray.direction, this.yaw(), held.info.size, this.probe);
  }

  private makeGhost(held: Prop): void {
    this.ghost.clear();
    for (const part of held.info.parts(held.place.variant)) {
      const mesh = new Mesh(part.geometry, this.ghostMaterial);
      mesh.layers.set(CARRIED_LAYER);
      this.ghost.add(mesh);
    }
    this.ghost.layers.set(CARRIED_LAYER);
    this.ghostOf = held;
  }
}
```

- [ ] **Step 7: Run the tests**

Run: `cd web && npx vitest run tests/interactions.test.ts tests/world.test.ts tests/holding.test.ts && npx tsc --noEmit`
Expected: PASS. If `props.ts` and `ui.ts` now import each other in a cycle (`holding` → `ui`), that's fine: `ui.ts` doesn't import `holding`.

- [ ] **Step 8: Commit**

```bash
git add web/src/interactions.ts web/src/presence.ts web/src/main.ts web/src/world.ts web/src/holding.ts web/src/ui.ts web/tests/interactions.test.ts web/tests/world.test.ts web/tests/holding.test.ts
git commit -m "Loose objects: a target to pick up, the flat's solids, and the hand with its ghost and throws

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Wiring it into the walkthrough

**Files:**
- Modify: `web/src/main.ts`
- Modify: `web/src/ui.ts`, `web/index.html`, `web/src/style.css` (the touch Throw and Drop buttons)

**Interfaces:**
- Consumes: everything above. `UI.bindHoldBar(h: { throwStart(): void; throwEnd(): void; drop(): void }): void`, `UI.setHolding(on: boolean): void` are new here.

This task is wiring; it's checked in the browser (Task 10) and by the whole suite and the type check.

- [ ] **Step 1: The touch buttons**

In `web/index.html`, right after the closing `</div>` of `#touch-bar`, add:

```html
      <div id="hold-bar" hidden>
        <button type="button" id="hold-throw">Throw</button>
        <button type="button" id="hold-drop">Drop</button>
      </div>
```

In `web/src/style.css`, after the `#touch-bar svg { … }` rule, add:

```css
/* While holding something on a touch screen: Throw (hold and let go) and Drop, above the stick's side of the screen. */
#hold-bar { display: none; }
body.touch #hold-bar:not([hidden]) {
  position: fixed; right: calc(16px + env(safe-area-inset-right)); bottom: calc(24px + env(safe-area-inset-bottom));
  display: flex; gap: 10px; touch-action: none;
}
#hold-bar button { min-width: 72px; height: 48px; background: rgba(30, 28, 25, 0.78); color: var(--ink); }
#hold-bar button:active { background: var(--accent); color: #121110; }
```

In `web/src/ui.ts`, add an interface after `TouchBarHandlers`:

```ts
export interface HoldBarHandlers {
  throwStart(): void;
  throwEnd(): void;
  drop(): void;
}
```

and two methods after `bindTouchBar`:

```ts
  /** The touch Throw button throws on letting go, harder the longer it's held; Drop lets go. */
  bindHoldBar(h: HoldBarHandlers): void {
    const t = this.el('hold-throw');
    t.addEventListener('pointerdown', (e) => { e.preventDefault(); h.throwStart(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) t.addEventListener(ev, () => h.throwEnd());
    this.el('hold-drop').addEventListener('click', () => h.drop());
  }

  /** Holding something: the touch screen's Throw and Drop buttons show. */
  setHolding(on: boolean): void {
    if (on === this.lastHolding) return;
    this.lastHolding = on;
    this.el('hold-bar').hidden = !on;
  }
```

and the field `private lastHolding = false;` next to `lastSitting`.

- [ ] **Step 2: Build the props and the hand in `main.ts`**

Imports to add:

```ts
import { makeMatcaps } from './creatures';
import { Holding } from './holding';
import { meshRaycast } from './prop-physics';
import { drawerHeights, placesFor } from './prop-places';
import { CARRIED_LAYER, type PropMessage, Props } from './props';
import { domCanvas } from './screens';
```

Right after `const avatarLight = (x, z) => { … };` (which the props use for their light), add:

```ts
  // The loose things in the drawers and cupboards (props.ts): built now, so the warm-up compiles them and the crosshair
  // finds them; held and flying ones are drawn on their own layer, which the crosshair leaves out.
  const solidRay = meshRaycast(world.solids);
  const movableNodes = new Set(world.movables.map((m) => m.node));
  const drawerOf = (o: Object3D): Object3D | null => {
    for (let p: Object3D | null = o; p; p = p.parent) if (movableNodes.has(p)) return p;
    return null;
  };
  const fronts = new Set(assets.manifest.movables.map((m) => m.node));
  const heights = drawerHeights(fronts);
  const handAt = new Vector3();
  const props = new Props(placesFor(fronts), {
    root: world.root,
    node: (name) => world.root.getObjectByName(name) ?? null,
    drawerOf,
    raycast: solidRay,
    light: avatarLight,
    selfId: () => selfId(),
    hand: (id, p, q) => {
      if (id === selfId()) {
        holding.hand(p, q);
        return true;
      }
      const figure = avatars.get(id);
      if (!figure || !avatars.mouth(id, p)) return false;
      const yaw = figure.pose[2];
      const [ahead, below] = CONFIG.props.otherHand;
      p.add(handAt.set(-Math.sin(yaw) * ahead, -below, -Math.cos(yaw) * ahead));
      q.setFromAxisAngle(UP, yaw);
      return true;
    },
  }, makeMatcaps(domCanvas));
  for (const p of props.list) {
    world.targets.set(p.root, { kind: 'prop', prop: p, node: p.root });
    world.pickables.push(p.root);
  }
  const holding = new Holding(props, camera, {
    raycast: solidRay,
    overlaps: (box) => props.overlaps(box),
    drawerOf: (o) => {
      const node = drawerOf(o);
      return node ? { node, height: heights.get(node.name) ?? null } : null;
    },
  }, (m) => sendProp(m));
  scene.add(holding.ghost);
  camera.layers.enable(CARRIED_LAYER);
  const sendProp = (m: PropMessage | null) => {
    if (m) others?.sendProp(m);
  };
  /** Picks up a loose thing under the crosshair or a tap; false when it wasn't one. */
  const pickUp = (t: Target | null): boolean => {
    if (t?.kind !== 'prop') return false;
    if (!holding.holding && !player.frozen) sendProp(props.pickUp(t.prop));
    return true;
  };
```

Add `const UP = new Vector3(0, 1, 0);` near the top of `run()` (after `const scene = new Scene();`), and add `Object3D` is already imported. `sendProp` is used inside `Holding`'s callback before its `const` line; that's fine because the callback only runs later, in the frame loop and in input handlers. `selfId` and `others` are declared further down; they are likewise only read later.

Add `props` and `holding` to the `?debug` object on the `walkthrough` line: `…, get games() { return games; }, props, holding } });` — move that `Object.assign` line below the props block if it sits above it.

- [ ] **Step 3: Join them to the others**

In the `new Multiplayer(…, { … })` hooks, after `games: () => games.messages(),` add:

```ts
        onProp: (m) => {
          const had = props.held;
          props.receive(m);
          if (had && !props.held) holding.lost();
        },
        props: () => props.messages(),
        onLeave: (id) => {
          const f = avatars.get(id);
          props.leave(id, f?.root.visible ? new Vector3(f.pose[0], 1, f.pose[1]) : null);
        },
```

- [ ] **Step 4: Clicks, keys and taps**

In the `mousedown` handler, replace the last four lines (`const t = interactions.click(); sitOn(t); used(t); share(t);`) with:

```ts
    if (e.button === 2) return holding.startThrow();
    if (e.button !== 0) return;
    if (holding.holding) {
      if (holding.place()) return;
      if (interactions.current?.kind === 'prop') return; // another loose thing: one at a time
    }
    const t = interactions.click();
    if (pickUp(t)) return;
    sitOn(t);
    used(t);
    share(t);
```

and change the guard line above them from `if (e.button !== 0 || !(autostart || document.pointerLockElement === canvas)) return;` to `if (!(autostart || document.pointerLockElement === canvas)) return;`.

After the `mousedown` listener, add:

```ts
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) holding.releaseThrow();
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault()); // the right button throws
```

In the `keydown` handler, after the `if (e.repeat) return;` line, add:

```ts
    if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey && !e.altKey) holding.startThrow();
    if (e.code === 'KeyQ' && !e.metaKey && !e.ctrlKey && !e.altKey) holding.drop();
```

and add a `keyup` listener after the `keydown` one:

```ts
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyF') holding.releaseThrow();
  });
```

In the touch controls' `tap` handler, replace its last four lines with:

```ts
      const aim = new Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2);
      if (holding.holding && holding.placeAt(aim)) return;
      if (holding.holding && interactions.at(aim)?.kind === 'prop') return;
      const t = interactions.tap(aim);
      if (pickUp(t)) return;
      sitOn(t);
      used(t);
      share(t);
```

(the `const t = interactions.tap(new Vector2(…))` line it replaces built the same vector inline).

After `ui.bindTouchBar({ … });` add:

```ts
  ui.bindHoldBar({
    throwStart: () => holding.startThrow(),
    throwEnd: () => holding.releaseThrow(),
    drop: () => holding.drop(),
  });
```

In `setKitchen`, as its first line after the `if (k === kitchen) return;` guard, add `holding.drop(); // the other kitchen reloads the page: let go first`.

- [ ] **Step 5: The frame loop**

After `avatars.update(dt, avatarLight);` add:

```ts
    for (const m of props.update(dt)) sendProp(m);
    holding.update(dt);
```

Replace the two lines that set the target and the prompt:

```ts
    const target = started ? interactions.update() : null;
    ui.setPrompt(boardPanel.isOpen ? null : target ? promptFor(target, world.lights, touch ? 'Tap' : 'Click') : player.seat && started ? COPY.stand : null);
```

with:

```ts
    const target = started ? interactions.update() : null;
    const verb = touch ? 'Tap' : 'Click';
    props.highlight(!holding.holding && target?.kind === 'prop' ? props.top(target.prop) : null);
    const handPrompt = started ? holding.prompt(verb, touch, target !== null && target.kind !== 'prop') : null;
    const aimed = target && !(holding.holding && target.kind === 'prop') ? promptFor(target, world.lights, verb) : null;
    ui.setPrompt(boardPanel.isOpen ? null : handPrompt ?? aimed ?? (player.seat && started ? COPY.stand : null));
    ui.setHolding(touch && holding.holding);
```

- [ ] **Step 6: Check types and the suite**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/main.ts web/src/ui.ts web/index.html web/src/style.css
git commit -m "Loose objects in the walkthrough: pick up, put down, throw, drop, on touch too, shared with the others

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Export, check in the browser, docs

**Files:**
- Modify (generated): `web/public/assets/**`, `web/public/assets/variants/kitchen-wall/**`
- Modify: `README.md`, `docs/superpowers/specs/2026-10-28-loose-objects-design.md`

- [ ] **Step 1: Preview export of both layouts, from the terminal panel**

With `mcp__terminal__run_in_terminal`, from the worktree root (each about a minute):

```bash
S=/private/tmp/apartment-walkthrough-blender; mkdir -p $S/home && rsync -a --delete blender shared $S/ && cp Untitled.blend $S/source.blend && rm -rf $S/out && open -W -n -g -j -a /Applications/Blender.app --env HOME=$S/home --stdout $S/export.log --stderr $S/export.log --args -b --factory-startup $S/source.blend --python-exit-code 1 --python $S/blender/export_web.py -- --quality preview --out $S/out/assets --build $S/out/build; tail -5 $S/export.log && rsync -a --delete --exclude audio/ --exclude climate.json --exclude DATA-SOURCES.md --exclude variants/ $S/out/assets/ web/public/assets/ && rsync -a $S/out/build/ build/
```

```bash
S=/private/tmp/apartment-walkthrough-blender; rm -rf $S/out && open -W -n -g -j -a /Applications/Blender.app --env HOME=$S/home --stdout $S/export-wall.log --stderr $S/export-wall.log --args -b --factory-startup $S/source.blend --python-exit-code 1 --python $S/blender/export_web.py -- --quality preview --variant kitchen-wall --out $S/out/assets --build $S/out/build; tail -5 $S/export-wall.log && mkdir -p web/public/assets/variants/kitchen-wall && rsync -a --delete --exclude audio/ --exclude climate.json --exclude DATA-SOURCES.md --exclude variants/ --exclude surroundings.glb $S/out/assets/ web/public/assets/variants/kitchen-wall/
```

Expected: each log ends with `Export OK`. On `EXPORT CHECKS FAILED`, read the reasons and fix the cause.

- [ ] **Step 2: Run the suite against the new manifests**

Run: `cd web && npm test`
Expected: PASS (Task 3's layout tests read the exported manifests).

- [ ] **Step 3: Check it in the browser**

- `cd web && npm ci` if `web/node_modules` is missing.
- `preview_start` with name `walkthrough`, then navigate to `http://localhost:5173/?view=Cam_Kitchen&debug&solo`, click to start.
- With `javascript_tool`:
  - `walkthrough.props.list.length`: about 100 to 200.
  - Open a cutlery drawer and a glasses cupboard from the console (`walkthrough.world.movables.find(m => m.node.name === 'Move_island-front-00').state.toggle()`), wait a second, screenshot: real cutlery in the insert, no baked boxes left.
  - Pick up a glass by aiming at it (`walkthrough.player.teleport(…)` near the coffee station, then a click) or by calling `walkthrough.props.pickUp(walkthrough.props.list.find(p => p.kind === 'tumbler'))`; screenshot the hand and the ghost on the worktop; place it; screenshot.
  - Throw (`walkthrough.holding.startThrow()`, then after 0.5 s `walkthrough.holding.releaseThrow()`), screenshot where it lands.
- `read_console_messages` with `onlyErrors`: none.
- Two tabs on the same `?room=loose-test` (without `solo`): pick up and throw in one, confirm the other sees the held glass in front of the animal and the same resting place (compare `JSON.stringify(walkthrough.props.messages())` in both tabs).
- `resize_window` preset `mobile`, reload: the Throw and Drop buttons show only while holding.
- Frame time: in the kitchen with a drawer full of things open, `performance` sampling over 120 frames (as the details spec did) stays under 20 ms.

Fix anything that's off in the source, re-run the tests, and repeat the check. Reset the window with preset `desktop` at the end.

- [ ] **Step 4: Docs**

In `README.md`, after the paragraph that lists `web_move` (the custom properties list), add a section:

```markdown
## Loose objects

The glasses, mugs, plates, bowls, cutlery, spice jars, food containers, oil and wine bottles, books, glasses cases, screwdrivers and filament spools in the drawers and cupboards are made in the browser (`web/src/prop-models.ts`), not in Blender: visitors pick them up (click), put them down on any surface facing up (click where the ghost shows), throw them (hold the right button or F, longer is harder) and drop them (Q); on touch, tap to pick up and put down, and Throw and Drop buttons show while holding. Everyone in the flat sees it, and things stay where they're left until the flat empties.

- Where each drawer's or cupboard's insides are is in `web/src/prop-frames.json`, written once by `blender/tools/loose_contents.py` (which also removed the baked stand-ins there). Moving or resizing one of those drawers or cupboards in Blender means updating its entry by hand, or the objects will float or sink.
- What goes where: `LAYOUTS` in `web/src/prop-places.ts`, one per fill. Throws, light, the hand: `CONFIG.props` (`web/src/config.ts`).
```

In the spec, set `**Status:** Implemented.` and, under "Edge cases and known limits", add a line: `- Held and flying things aren't in the mirrors (they're drawn on a layer the mirrors' camera doesn't see).` if that's what the browser check showed.

- [ ] **Step 5: Commit**

```bash
git add web/public/assets README.md docs/superpowers/specs/2026-10-28-loose-objects-design.md
git commit -m "Loose objects: preview export without the baked stand-ins, and the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Ask before the final export**

Show the user the screenshots and ask whether to run the final export (about 1 to 1.5 hours on the GPU, both layouts). Only on a yes, run the two commands of Step 1 with `--quality final` instead of `--quality preview`, in the background from the terminal panel, then re-run `npm test`, re-check one screenshot, and commit the assets.
