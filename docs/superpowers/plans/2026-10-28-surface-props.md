# Surface Props Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The model's own small things on surfaces (about 100: mugs, bottles, books, cushions, desk gadgets, tools…) become loose objects visitors can pick up, put down, drop and throw, keeping their own shapes and materials, and any mesh tagged `web_prop` in Blender becomes one.

**Architecture:** A one-off Blender tool tags, joins and splits the chosen objects. The export pipeline keeps `web_prop` meshes out of the baked rooms and collision, re-origins each at the middle of its base and exports it as its own `Prop_<slug>` node, listed in the manifest. The viewer turns each such node into a loose object of the existing `Props` system (a kind built from the node's meshes and materials), works out which things rest on which, and lets one thing carry several.

**Tech Stack:** Blender 5.1 Python (bpy, bmesh) for the tool and pipeline (unittest, run inside Blender); TypeScript, three.js 0.170, Vitest for the viewer.

**Spec:** `docs/superpowers/specs/2026-10-28-surface-props-design.md` (builds on `2026-10-28-loose-objects-design.md`).

## Global Constraints

- Never run Blender, or a Blender `make` target (`make test-blender`, `make export-*`), from Claude's Bash tool: it cuts the session off from `~/Documents`. Implementers write the Blender code and run only the pure tests (`cd blender && uv run --no-project --with numpy python -m unittest tests.test_geom`); the controller runs Blender from the terminal panel.
- Never edit `web/public/assets/` by hand; it comes from the export.
- The repo's `Untitled.blend` is the newest model; tools run on a staged copy, the result is copied back over it.
- Every interaction stays within 20 ms a frame at 60 Hz; nothing new casts sun shadows.
- Ids are the same in every browser: drawer things keep `<place slug>/<kind>/<n>`; surface things are `surface/<slug>` where `<slug>` is the node name without `Prop_`.
- Prompts follow the existing form: `Click: pick up mug`.
- Code style: match the surrounding files — short plain-English doc comments on exported things, `CONFIG` for viewer tunables (`blender/pipeline/config.py` for pipeline ones), no new dependencies.
- Commit after each task, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File structure

| File | Responsibility |
|---|---|
| `blender/tools/surface_props.py` (new) | One-off: tag, join, split the chosen objects |
| `blender/pipeline/config.py` | `PROP_PROP = "web_prop"`, `TIPS_PROP = "web_tips"` |
| `blender/pipeline/geom.py` | Pure: `base_centre`, `box_size_three`, `tips` |
| `blender/pipeline/props.py` (new) | Find, re-origin, rename, hide from the bake; specs |
| `blender/pipeline/run.py`, `manifest.py` | Keep props out of chunks/collision; export the nodes; `props` in the manifest and its check |
| `blender/tests/test_geom.py`, `test_props.py` (new), `fixture_scene.py`, `test_end_to_end.py` | Tests |
| `web/src/manifest.ts` | `PropInfo`, `Manifest.props` (optional in JSON) |
| `web/src/prop-models.ts` | `Look.map` |
| `web/src/surface-props.ts` (new) | A kind from a node; things on things; places from the manifest |
| `web/src/prop-places.ts` | `PlacedProp.info?` |
| `web/src/props.ts` | A kind from `place.info`; several things on one |
| `web/src/main.ts` | Surface places joined with the drawer ones |
| `README.md` | `web_prop`, `web_tips` |

---

### Task 1: The model tool

**Files:** Create `blender/tools/surface_props.py`.

No unit tests (one-off tools have none). The implementer writes it and checks it compiles (`python3 -m py_compile`), and that every object name in it appears in the model's own builder scripts or the inventory below; the controller runs it.

Object names (from an inventory of the model; all exist, render-visible, final frame). Open-kitchen names are in collection `Kitchen - open`; the kitchen-wall copies (`East worktop …`, `Closed counter deco …`) in `Kitchen - closed`:

- **Tag only** (`name → web_prop`):
  - `Coffee station mug 0`, `Coffee station mug 1`, `Bistro mug` → `mug`
  - `Counter deco bottle 0`, `Counter deco bottle 1`, `Closed counter deco bottle 0`, `Closed counter deco bottle 1`, `Bottle 0`…`Bottle 3` → `bottle`
  - `Counter deco kettle`, `East worktop kettle` → `kettle`
  - `Counter deco knife 0`…`4`, `Closed counter deco knife 0`…`4` → `knife`
  - `Island deco board`, `East worktop board` → `chopping board`
  - `Island deco fruit bowl`, `East worktop fruit bowl`, `Dining table fruit bowl` → `fruit bowl`
  - `Island deco fruit 0`…`4`, `East worktop fruit 0`…`4` → `fruit`
  - `Island deco vase`, `Office shelf bud vase` → `vase`
  - `Shelf item bowl 0`, `Shelf item bowl 1`, `Office shelf bowl` → `bowl`
  - `Shelf item cookbook 0`…`4` → `cookbook`
  - `Shelf item plate 00`…`05`, `Shelf item plate 10`…`15` → `plate`
  - `Coffee table round book`, `Office shelf book 0`…`8`, `Office shelf stack book 0`…`2` → `book`
  - `Corner sofa pillow 0`…`2`, `Entrada bench cushion`, `Cushion 0`, `Cushion 1`, `Sofa bed pillow 0`…`2` → `cushion`
  - `Sala Magic Keyboard` → `keyboard`; `Sala Magic Mouse`, `Mouse` → `mouse`
  - `Ice bucket` → `ice bucket`; `Bar tray` → `tray`; `Hall key bowl` → `key bowl`
  - `Portable SSD` → `SSD`; `Charger hub` → `charger`; `Dock` → `dock`; `Desk jar` → `jar`; `Audio interface` → `audio interface`
  - `Tool tray` → `tool tray`; `Hung tool 0`…`7` → `tool`
- **Join into the first, then tag:**
  - `Keyboard` + `Keyboard key enter`, `Keyboard keys`, `Keyboard keys mod column`, `Keyboard keys mod row` → `keyboard`
  - `Smartwatch` + `Smartwatch strap` → `smartwatch`
  - `Phone stand` + `Phone stand slot 0`…`2` → `phone stand`
  - `Smart speaker puck` + `Smart speaker puck top` → `smart speaker`
  - `Deer body` + `Deer face`, `Deer antler 0`, `Deer antler 0 tine 0`, `Deer antler 0 tine 1`, `Deer antler 1`, `Deer antler 1 tine 0`, `Deer antler 1 tine 1` → `wooden deer`
  - `Office shelf vase` + `Office shelf vase stem 0`…`2` → `vase`
  - `Organiser tray` + `Organiser tray bin 0`…`2` → `organiser tray`
  - `Spool i` + `Spool hub i` for i in 0…5 → `filament spool`
  - `Counter deco utensil crock` + `Counter deco utensil 0`…`3`, and `Closed counter deco utensil crock` + `Closed counter deco utensil 0`…`3` → `utensil crock`
- **Split by material, then tag:** `Dining table books and mug` (built by `home_fixes.py`: three stacked boxes with materials `Book 0`, `Book 2`, `Book 4`, bottom to top, and a cylinder in `Stoneware white`) → objects `Dining table book 0` (`Book 0`), `Dining table book 1` (`Book 2`), `Dining table book 2` (`Book 4`) tagged `book`, and `Dining table mug` (`Stoneware white`) tagged `mug`; the original is removed.

- [ ] **Step 1: Write the tool**

```python
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
```

- [ ] **Step 2: Check without Blender** — `python3 -m py_compile blender/tools/surface_props.py`; grep `blender/tools/*.py` for the builders of `Dining table books and mug` (home_fixes.py) and `East worktop` / `Closed counter deco` copies to confirm the names and materials. Report anything that doesn't match.

- [ ] **Step 3: Commit** the tool (`Model: a tool that makes the model's small things on surfaces loose`).

(The controller then runs it from the terminal panel on a staged copy, checks the `[surface]` report — 36 joined parts, 1 split, about 100 loose things — and commits the new `Untitled.blend`.)

---

### Task 2: The pipeline exports tagged things as their own nodes

**Files:** Modify `blender/pipeline/config.py`, `geom.py`, `run.py`, `manifest.py`; create `blender/pipeline/props.py`; tests in `blender/tests/test_geom.py`, new `blender/tests/test_props.py`, `fixture_scene.py`, `test_end_to_end.py`.

**Interfaces produced:**
- `config.PROP_PROP = "web_prop"`, `config.TIPS_PROP = "web_tips"` (doc comments like `MOVE_PROP`'s).
- `geom.base_centre(lo, hi) -> (x, y, z)` (Blender space: middle of the box's base); `geom.box_size_three(lo, hi) -> [w, h, l]` (three.js: x extent, z extent (up), y extent); `geom.tips(size, min_height=0.12, ratio=1.8) -> bool` (height over `min_height` and over `ratio` × the narrower of w and l). All pure, rounded to 4–5 decimals like the rest of geom.
- `props.find(meshes) -> [obj]`; `props.prepare_props(objs, floor_index) -> [spec]` with spec `{"source", "node": "Prop_<slug>", "name", "room", "size", "tips"}`; it moves each mesh's geometry so the object's origin is `base_centre` (like hinged movables re-origin at their pivot: `o.data.transform(Matrix.Translation(-base)); o.location = base`), renames it to the node name, and sets `hide_render = True` (never in a bake).
- `st["props"]` in the saved state; manifest `"props": [{"node", "name", "room", "size", "tips"}]`; `validate_manifest` checks each prop: `room` is None or a known room, `size` three positive numbers, `name` non-empty.

**Integration in `run.prepare`:**
- After `ctx["albedo"] = proc_materials.bake_procedural_albedo(meshes, quality)` (props need their procedural albedo baked like everything else), find `prop_objs = props.find(meshes)` and build the collision from the meshes without them (`collision.build_collision([o for o in meshes if o not in prop_set], …)`).
- Add `prop_objs` to `special`, so they're not in `static` (chunks, emitters, fixtures).
- After `movables.prepare_movables(…)`, `prop_specs = props.prepare_props(prop_objs, floor_index)`; put `"props": prop_specs` in `st`.
- In `export_stage`, add `[p["node"] for p in st.get("props", [])]` to the exported names.
- Check that `bake.py` never sets `hide_render = False` on objects it didn't hide itself (it saves and restores lights and movables); if anything would unhide a prop during the bake, keep props hidden explicitly there.

**Tests:**
- `test_geom.py` (pure, run with `cd blender && uv run --no-project --with numpy python -m unittest tests.test_geom`): `base_centre` of a box; `box_size_three` axis order; `tips` for a bottle (0.07 × 0.3 × 0.07 → True), a plate (0.26 × 0.012 × 0.26 → False), a 0.1 m tall jar (False: under the height floor).
- `fixture_scene.py`: add a small tagged box `Test mug` (`web_prop = "mug"`), e.g. 0.08 × 0.08 × 0.09 m standing on the floor in the middle of room alpha (away from walls and doors), and a tall one `Test bottle` with `web_tips = False`. Keep other tests' expectations working (they may count objects in a room; adjust them only if they counted all meshes).
- `test_props.py` (Blender): after `scene_select.prepare_scene` and `rooms.collect_rooms`, `props.find` finds both; `prepare_props` renames them `Prop_test-mug`, `Prop_test-bottle`, puts each origin at its base middle (location z = the box's bottom, x/y its middle), keeps the geometry where it was in the world (a vertex's world position unchanged), sets `hide_render`, sizes and tips (`Test bottle` False by its tag), and the room is `alpha`.
- `test_end_to_end.py`: the manifest has a `props` list with both nodes; the glb has the `Prop_test-mug` node; the mug is in no chunk (no chunk node contains it); `validate_manifest` passes; the collision grid cell under the mug is free.

- [ ] Steps: write the pure tests and helpers (run them with uv: RED then GREEN); write `props.py` and the integration; write the Blender tests; commit (`Export: things tagged web_prop are their own nodes, out of the bake and the collision, listed in the manifest`). The implementer does not run Blender; the controller runs `test_props` and `test_end_to_end` from the terminal panel and reports failures back.

---

### Task 3: The viewer reads `props` from the manifest

**Files:** Modify `web/src/manifest.ts`; tests in `web/tests/manifest.test.ts`, `web/tests/fixtures.ts`.

**Interfaces produced:**
```ts
/** A loose thing from the model: its node (origin at the middle of its base), what the prompt calls it, its room, its
 * box (m: width, height, length) and whether it falls over when it lands hard. */
export interface PropInfo { node: string; name: string; room: string | null; size: [number, number, number]; tips: boolean }
// Manifest gains: props: PropInfo[];   (JSON without `props` parses to [])
```

Tests: `sampleManifest()` gains one prop (`{ node: 'Prop_test-mug', name: 'mug', room: 'alpha', size: [0.08, 0.09, 0.08], tips: false }`); it parses; a manifest without `props` parses with `props: []`; a prop with a bad size or a non-string name throws `ManifestError` with its path (`props[0].size`). Follow the file's existing helpers (`obj`, `arr`, `num`, `str`, `strOrNull`, `vec`).

- [ ] Steps: failing tests, parse code, tests pass, `npx tsc --noEmit`, `npm test`, commit (`Manifest: the model's loose things`).

---

### Task 4: A loose thing from a model node, and things on things

**Files:** Create `web/src/surface-props.ts`; modify `web/src/prop-models.ts` (`Look.map`), `web/src/prop-places.ts` (`PlacedProp.info`); test `web/tests/surface-props.test.ts`.

**Interfaces produced:**
```ts
// prop-models.ts
export interface Look { colour: string; gloss?: boolean; opacity?: number; map?: Texture | null }
// prop-places.ts
export interface PlacedProp { …existing…; kind: PropKind | 'model'; info?: KindInfo }
// surface-props.ts
/** A kind built from a model node: the prompt name, size and tips from the manifest, its meshes' geometry (in the
 * node's space, origin at the middle of its base) with each material's colour, texture and opacity. Something more
 * than LIE_RATIO times taller than it is wide lies along its length when set down: `rest` is the turn from how it's
 * modelled to how it lies (identity otherwise), and `size` is lying. */
export function modelKind(node: Object3D, info: PropInfo): { kind: KindInfo; rest: Matrix4 };
/** For each box (world space, at home), the box it lies on, if any: a box whose base is between just above another's
 * base and just above its top (SUPPORT_SLACK), with its footprint's middle over that one's footprint; the highest such
 * one when several qualify. */
export function supportsOf(boxes: { id: string; box: Box3 }[]): Map<string, string | null>;
/** Every model thing of a layout as a placed prop at home: its node leaves `root`; id `surface/<slug>`. */
export function surfacePlaces(props: PropInfo[], root: Object3D): PlacedProp[];
export const LIE_RATIO = 4;
export const SUPPORT_SLACK = 0.01;
```

Details:
- `modelKind`: traverse the node's meshes; for each, `geometry.clone()` with the mesh's matrix relative to the node applied; the material (a `MeshStandardMaterial` from the glTF loader) → `Look { colour: '#' + color.getHexString(), gloss: roughness < 0.5, opacity: transparent ? opacity : undefined, map: material.map }`. `parts(_variant)` returns the same parts every call. Size: from the manifest, unless it lies: then compute the box of the rotated geometry. The lying turn: rotate −π/2 about x (its height goes along z), then translate so the box's base middle is at the origin; apply that matrix to every geometry, and return it as `rest`. `tips`: the manifest's, and false when it lies.
- `surfacePlaces`: for each `PropInfo` whose node exists under `root` (skip silently otherwise): `modelKind`; home world matrix = `node.matrixWorld × rest⁻¹`, decomposed to position and quaternion; `node.removeFromParent()`; a `PlacedProp { id: 'surface/' + slug, kind: 'model', variant: 0, node: null, front: '', position, quaternion, on, place: node.name, info: kind }` where `on` comes from `supportsOf` over each thing's world box at home (from its parts' boxes and the home matrix).
- `prop-places.ts`: only the type changes (`kind: PropKind | 'model'`, `info?: KindInfo`); `fits`/`LAYOUTS` keep using `PropKind`.

Tests (`surface-props.test.ts`), building nodes from three.js Groups/Meshes with MeshStandardMaterial:
- a mug-like node (cylinder geometry translated so its base is at 0) → size from the manifest, parts' colour from the material, texture map carried, opacity only when transparent;
- a knife-like node (0.004 × 0.26 × 0.025) lies: `size` has height ≈ 0.004–0.025 and length ≈ 0.26; `rest` turns local +y onto ±z; `tips` false;
- `supportsOf`: six plates stacked 0.014 apart each lie on the one below (not on the bottom one); four bottles and a bucket on a tray all lie on the tray; fruit inside a bowl (bases above the bowl's base, below its top) lie on the bowl; five books side by side lie on nothing; something beside but not over a box lies on nothing;
- `surfacePlaces`: nodes leave the root; ids `surface/test-mug`; position = the node's world position for an upright thing; an unknown node name is skipped.

- [ ] Steps: failing tests, code, pass, `npx tsc --noEmit`, `npm test`, commit (`Loose objects: things from the model, and what rests on what`).

---

### Task 5: Several things on one, and kinds from the model in `Props`

**Files:** Modify `web/src/props.ts`; tests in `web/tests/props.test.ts`.

**Changes:**
- `Prop` takes its kind from `place.info ?? KINDS[place.kind as PropKind]`. Its materials use `look.map` (`MeshMatcapMaterial({ …, map: look.map ?? null })`).
- Stacks hold several: `over: Prop[]` (was `Prop | null`). `top(p)`: while `p.over.length`, take the highest of `p.over` (largest world y of its root) and continue from it. `detach(p)`: remove `p` from `p.under.over` and clear `p.under`; for each `q` in `p.over` set `q.under = null`; `p.over = []`. `stackHome(p)`: link to `place.on`'s prop if that one is at home (no longer requires it to be bare). `goHome` re-links as now.
- Everything else is unchanged.

Tests: existing stack tests keep passing (two plates). New: a tray with three bottles at home: `top(tray)` is one of the bottles; picking up `tray` takes bottles until none is left on it, then the tray; a bottle put back home re-links onto the tray; a model-kind prop (a `PlacedProp` with `info` built inline: name 'mug', size, one part with a coloured look and a map) is built with that name, its material's map set, and picks up/places like the others.

- [ ] Steps: failing tests, code, pass, `npx tsc --noEmit`, `npm test`, commit (`Loose objects: one thing can carry several, and things can come from the model`).

---

### Task 6: Wiring, docs

**Files:** Modify `web/src/main.ts`, `README.md`.

- In `main.ts`, where `new Props(placesFor(fronts), …)` is built: `const places = [...placesFor(fronts), ...surfacePlaces(assets.manifest.props, world.root)]` and pass `places`. `surfacePlaces` must run before `new Props` and before `warmUpShaders` (it already sits there) and before `Interactions` (targets and pickables are filled from `props.list`).
- Check that `props.hideShut`'s lookup treats `front === ''` as not shut (surface things are never hidden behind a front).
- Check the glTF nodes of props don't cast shadows (they're removed from the scene by `surfacePlaces` before `daylight` collects casters? — `Daylight` is built after `buildWorld`; make sure the prop nodes are gone before anything collects occluders or casters; if `buildWorld` already collected them in `world.occluders`, filter them out there by name prefix `Prop_`).
- README: under the custom properties list, add: "`web_prop = "<name>"` on a mesh makes it a loose thing visitors can pick up, carry, put down and throw (the prompt calls it by that name); the export keeps it out of the baked rooms and the collision and exports it as its own node. `web_tips = true | false` says whether it falls over when it lands hard (default: tall and narrow ones do). `blender/tools/surface_props.py` tagged the flat's small things on surfaces once and refuses to run again." And mention it in the "Loose objects" section.

- [ ] Steps: wire, `npx tsc --noEmit`, `npm test`, commit (`Loose objects: the model's things on surfaces in the walkthrough`).

---

### Task 7 (controller): run, export, check

- Run the tool (Task 1) from the terminal panel; commit `Untitled.blend`.
- Run `test_props` and `test_end_to_end` in Blender from the terminal panel; fix failures through the Task 2 implementer.
- Preview-export both layouts; `npm test`; browser check (both layouts, two tabs, frame time) as the spec's Testing section lists; commit the assets.
- Final export of both layouts only with the user's OK.
