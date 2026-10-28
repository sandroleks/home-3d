# Surface Props — Design

**Date:** 2026-10-28
**Status:** Implemented (preview export; final export pending).
**Builds on:** `2026-10-28-loose-objects-design.md` (the loose things in drawers and cupboards: picking up, putting down, throwing, sharing).

## Goal

The model's own small things on worktops, tables, shelves, desks and beds become loose objects too: the mugs, bottles and kettle on the worktops, the fruit and its bowl, the cookbooks and plates on the kitchen shelves, the books and mug on the dining table, the cushions, the desk gadgets, the wooden deer, the filament spools, the tools on the pegboard. They keep their own shapes and materials from the model. From now on, making another object loose is a tag in Blender and an export, with no code.

## The objects

Everything in these groups, in both kitchen layouts where they exist (about 100 objects):

| Where | What |
|---|---|
| Kitchen worktops (open; the east run in the kitchen-wall layout) | coffee-station mugs, counter bottles, kettle, utensil crock (with its utensils, one thing), the five knives on the rail, the board, the fruit bowl, five pieces of fruit, the vase |
| Kitchen open shelves (open layout) | two bowls, five cookbooks, two stacks of six plates |
| Sala | the dining table's fruit bowl (bowl and fruit, one thing), its three books and mug (split apart), the coffee-table book, the three corner-sofa cushions, the Magic Keyboard and Mouse |
| Bar | four bottles, the ice bucket, the brass tray |
| Hall and Entrada | the key bowl, the bench cushion |
| Quarto 01 | the two bed cushions |
| Quarto 02 (office) | the keyboard, mouse, smartwatch, portable SSD, phone stand, charger hub, dock, desk jar, smart speaker, audio interface, the wooden deer; on the shelves, twelve books, a bowl, the bud vase and the vase with its stems; the three sofa-bed pillows, the organiser tray |
| Quarto 03 (workshop) | the six filament spools, the tool tray, the eight tools on the pegboard |
| Marquise | the bistro mug |

They stay fixed: plants, the coffee machine, the iMac, speakers, the PC and printer, storage bins and laundry baskets, taps, bathroom fittings and light fixtures.

## In the model

A one-off tool, `blender/tools/surface_props.py` (refuses to run twice):

- Tags each object in the table with `web_prop = "<what the prompt calls it>"` ("mug", "cookbook", "wooden deer", "cushion"…).
- Joins things modelled in parts into one object: the office keyboard and its keys, the deer and its antlers, the smart speaker and its top, the vase and its stems, the phone stand and its slots, the organiser tray and its bins, each spool and its hub, the utensil crock and its utensils, the smartwatch and its strap.
- Splits "Dining table books and mug" into three books and a mug.

By hand afterwards: `web_prop` on any mesh makes it loose; `web_tips = true | false` overrides whether it falls over when it lands hard.

## In the pipeline (`blender/pipeline/props.py`)

- Tagged meshes are kept out of the room chunks and the walking collision, and hidden for the whole bake, so nothing bakes their shadow where they stood.
- Each is re-origined at the middle of its base (its geometry is already in world space after the scene is realised) and exported as its own node, `Prop_<slug>`, with its materials, in `apartment.glb`. Each kitchen layout's export has its own.
- The manifest gets `props: [{node, name, room, size: [w, h, l], tips}]` (three.js space; size from the node's box). `tips`: `web_tips` if set, otherwise tall and narrow (height over 0.12 m and over 1.8 times its narrower side). A manifest without `props` still loads (an empty list).

## In the viewer

- **A loose thing from the model:** each manifest prop's node becomes a loose object. Its kind is built from the node: the prompt name, its size, whether it tips, and its meshes' geometry with their materials' colour, texture and opacity, as the same light-dimmed matcaps. The node itself leaves the scene; the loose object takes its place and pose. Its id is `surface/<slug>` (the node name without `Prop_`), the same in every browser.
- **Long thin things lie down:** something long and flat (its height over five times its thinnest side, and its widest side over 1.5 times its thinnest: knives, utensils, pegboard tools; round bottles stand) is set down and lands lying along its length; at home it still hangs or stands as modelled. Books lie when set down too. The Entrada bench cushion stays fixed (it's the bench's seat).
- **Things on things:** worked out at load from the boxes. A thing whose base sits on another (between just above that one's base and just above its top, and over its footprint) lies on it: plate stacks, the office shelf's stacked books, the bottles on the bar tray, the fruit in the island's bowl. A thing can have several on it; picking it up takes one of the things on it first, the highest, until it's bare. This replaces the one-on-one stacks the drawer things had, and they keep working.
- **Everything else is as for the drawer things:** pick up, the ghost, putting down, throwing, dropping, sharing and the change counter, layers, light. They're never hidden behind a shut front (they have none).

## Edge cases

- Things hanging (the rail knives, the pegboard tools) stay where they hang until taken; they can't be hung back.
- Things on the other kitchen layout's worktop don't exist in yours, like that layout's drawers; one left where your layout has nothing under it shows at home for you.
- The newly loose things lose their baked shading where they stood: moving one would otherwise leave its shadow behind.
- A received rest for a surface thing is checked for support like any other.

## Performance

About 100 more objects, each its own meshes and materials (one per material of the model's, for its own light). The frame budget (20 ms at 60 Hz) holds; measured in the browser check.

## Testing

- Pipeline: pure helpers (base origin, size, tips rule) in `blender/tests/test_geom.py` (runs without Blender); `blender/tests/test_props.py` in Blender with fixture objects: found, kept out of chunks and collision, re-origined, named, listed in the manifest; the manifest check accepts and validates `props`.
- Viewer (Vitest): the manifest parses `props` and tolerates its absence; a model kind from a node (size, tips, parts with colours and texture, the lying fix); things-on-things from boxes (plates, a tray with bottles, a bowl with fruit, side by side books not stacked); several on one in `Props` (top picks the highest, the support is bare only when all are taken, going home re-links).
- In the browser: both layouts; pick up the mug from the dining table, the top plate of a shelf stack, a bottle off the bar tray, a knife off the rail (lies down when put down), a cushion thrown onto the bed; two tabs agree; frame time.
