# Loose Objects — Design

**Date:** 2026-10-28
**Status:** Implemented (preview export; final export pending).

## Goal

The things in the drawers and cupboards become real objects a visitor can **pick up, carry, put down on another surface, drop or throw**. A glass taken from the coffee station can go on the dining table, into another drawer, or across the room, where it lands, bounces and comes to rest. Everyone in the flat sees it: in the visitor's hands, in the air and where it ends up.

Today the contents are rough boxes and cylinders (`blender/tools/model_details.py` `FILLS`, also used by `home_fixes.py` and `storage_and_wardrobes.py`), part of each drawer's mesh or of `<carcass> contents`, and baked. They can't move on their own. The objects that replace them are made in the browser and lit live, like the dining table's game pieces: lightmaps fit one place, so a thing that moves can't use one anyway.

## The objects

Seventeen kinds, replacing the baked contents in these places (about 150 objects in all):

| Kind | Where it starts |
|---|---|
| fork, knife, spoon, teaspoon | the cutlery drawers, in the oak insert: west run (`Front S3 prep drawers 0`), island (`Island front 00`), Sala storage (`Sala storage drawer 00`), and in the kitchen-wall layout the east run (`East front 1`) |
| dinner plate, bowl | the plates drawers: island (`Island front 10`), Sala storage (`Sala storage drawer 11`), east run (`East front 4`) |
| tumbler, wine glass | the glasses cupboards: coffee station upper (`Coffee station upper door 0`), Sala storage tall left, and in the kitchen-wall layout the east and west wall cabinets |
| mug | the coffee cupboards: coffee station lower, and in the kitchen-wall layout the east and west wall cabinets |
| spice jar | the spice drawer (`Island front 30`) |
| food container | the containers drawers (`Island front 01`, `31`, `Sala storage drawer 10`, `East front 3`) |
| oil bottle | the oils pull-out (`Front S1 pull-out`) |
| wine bottle | the bar cabinet's lower shelf (tumblers and wine glasses on its upper shelf) |
| book, glasses case | the nightstands |
| screwdriver | the workbench's tools drawer (`Bench drawer front 0`) |
| filament spool | the workbench's spools drawer (`Bench drawer front 2`) |

Pots and pans, utensils, towels, clothes, shoes, the pantry, fridge, freezer, dishwasher, under-sink, cleaning, parts bins and storage boxes stay as they are: fixed and baked.

Objects in a drawer of one kitchen layout exist only in that layout; the Sala, bar, nightstand and workbench ones are in both.

## What a visitor does

- **Pick up:** looking at an object in an open drawer or cupboard, or wherever it was left, within reach: "Click: pick up glass". A closed drawer's front hides what's inside, so only what you can see can be taken.
- **Hold:** one thing at a time, shown low and to the right of the view. Walking, doors, drawers, lamps and sitting all still work while holding.
- **Put down:** looking at a surface that faces up (more than about 45° from vertical) within reach (a worktop, table, floor, shelf, the inside of an open drawer), a faint ghost of the object shows where it would stand, upright and turned the way you face. Click to place it. Where it doesn't fit (something above, another object in the way, a drawer too shallow) there's no ghost and the prompt says so. Something placed in a drawer is part of the drawer: it rides along when the drawer closes and opens.
- **Throw:** hold the right mouse button or F, release to throw toward the crosshair. Holding longer throws harder, up to full strength at about a second (`CONFIG.props`). It flies, bounces once or twice, slides to a stop; tall things (glasses, bottles, jars, mugs) tip onto their side when they land hard. Then it can be picked up again from there.
- **Drop:** Q lets go where you stand; it falls straight down from your hand.
- **Touch:** tap an object to pick it up, tap a surface to put it down. While holding, a "Throw" button shows: hold and release it to throw toward the middle of the view, and a "Drop" button next to it.
- **Others** see the object in front of the holder's animal, see it fly and see it land in the same place.
- **Things stay where they're left** while anyone is in the flat. When the flat empties, everything is back home for the next visitor, as with doors and lights.

## The viewer

Small files beside the games', each testable on its own:

- **`prop-models.ts`:** one builder per kind — lathe profiles (glasses, mugs, bowls, plates, bottles, jars, spools), extrusions (cutlery, screwdrivers), boxes (books, cases, containers) — with geometry shared by kind. Each kind has its size (a bounding box), whether it tips over, and its materials.
- **`prop-places.ts`:** where each object starts. `prop-frames.json` (written by the model tool, below) gives each place's insides: the fill (`cutlery`, `plates`, …), the drawer node it belongs to (null for a cupboard), the front that opens it, which way it faces, and its levels (floor and shelves) as boxes in three.js space. A layout per fill, like the model's own fills, puts the objects on each level; anything that wouldn't fit is left out. Drawer objects are children of the drawer's node, so they slide with it; cupboard objects are in the room. A place is in this layout when its front is in the manifest. Each object's id comes from its start (`island-front-00/fork/3`), the same in every browser. Plates, bowls, books and cutlery start in stacks: picking up any of a stack takes the top one.
- **`props.ts`:** the objects and their state. Each is **at rest** (a parent — the room or a drawer node — and a pose; at home or not), **held** (by a visitor id), or **flying** (position, velocity, spin, and who threw it). It picks up, places, throws and drops, and updates the flights each frame. Materials are matcaps dimmed by the light where the object is, like `TableMaterials`, a little darker inside a cupboard or drawer (`CONFIG.props.insideLight`). Objects never cast sun shadows, so drawers keep leaving the shadow map alone.
- **`prop-physics.ts`:** one pure step of a flight: position, velocity and spin, a time step and a `raycast(from, to)` → `{point, normal} | null`, to the new state. Gravity; a ray along each step against the flat's meshes and the open drawers; meeting a surface that faces up: a bounce that keeps a fraction of the speed, then friction until it's slow enough to stop; meeting a wall or a side: a bounce off it. Tall kinds landing faster than `tipSpeed` rest on their side. Anything below the floor goes back home; a flight longer than `maxFlight` seconds sets the object down where it is. Windows and glazed doors stop it like walls (physics rays don't see through glass, unlike the crosshair).
- **`prop-placement.ts`:** the ghost: the crosshair's ray, a surface that faces up within reach, a fit test (a few short rays up and around the footprint, and no other object's box overlapping), and the result: the pose, and which drawer node it would belong to if it's inside an open drawer's box (and then it must fit below the drawer's sides).
- **`interactions.ts` and `main.ts`:** a new target, `{ kind: 'prop' }`, with prompts ("pick up glass", "put down", "no room here"); the held object in view; the ghost; F / right mouse to throw, Q to drop; on touch, the Throw and Drop buttons.

## Sharing

A new message kind, `prop`, beside `state` and `game`: `{id, n, s, by, ...}` where `n` is the object's change counter (one higher than the last change anyone made to it) and `s` is what happened:

- **`held`** `{by}`: others show it in front of that visitor's animal, which already follows their pose. Nothing more is sent while it's held.
- **`fly`** `{by, p, v, w}`: the launch — position, velocity, spin. Every browser runs the same flight with the same physics.
- **`rest`** `{parent, p, q}`: where it is now: after a place or a drop, and from the thrower once its flight stops (the others move theirs there; it's within a few centimetres anyway).

The higher `n` wins; on equal `n`, the lower visitor id. So when two visitors grab the same glass at once, both see the same one holding it, and the other sees it leave their hand ("Someone else took it"). A visitor who leaves or times out while holding something drops it on the floor where their animal was: every browser applies the same rule and gets the same pose, with `n` one higher. A newcomer is sent every object that isn't at home along with the flat's state, as the games are.

## The model

A new one-off tool, `blender/tools/loose_contents.py`, with the same refuse-to-run-twice mark as the others, removes the old contents of exactly the places in the table above:

- In a drawer they're part of the drawer's mesh: delete the faces inside the drawer box, above its floor (the cutlery insert stays).
- In a cupboard they're in `<carcass> contents` with the shelves: delete the faces of the contents' materials on that cupboard's levels and keep the shelves.

It also writes `web/src/prop-frames.json`: for each place, its fill, drawer node, front, outward direction and levels (from the drawer box or the shelves and the hollow's cutter), in three.js space with the drawers shut.

It runs headless on a staged copy of the repo's `Untitled.blend` (the repo's copy is the newest; Blender is started with `open -a` from the terminal panel, not from Claude's shell), checked with `look`, then a preview export, then — after the user has seen it — a final export (about 1 to 1.5 hours). The other kinds of contents keep their bakes.

## Edge cases and known limits

- A swinging door or a closing drawer goes through objects in its way; nothing is pushed. A drawer can always close on what's inside it, since only what fits is placed there.
- Visitors walk through objects and aren't hit by them.
- Objects don't meet each other: placing keeps them apart, but a thrown one flies through others and may come to rest overlapping one. Both can still be picked up.
- Each visitor picks their own kitchen layout. An object in a drawer of the other layout doesn't exist in yours; an object resting where your layout has nothing under it (the island, in the kitchen-wall layout) shows at home for you. Switching (K) drops what you hold first.
- Objects through an open balcony door land on the balcony; nothing can fall out of the flat for good (the floor catch).
- Each drawer's light stays as baked; an object takes the light of where it is, not shadows from what's around it.

## Performance

About 150 meshes with shared geometry per kind and a handful of matcap materials; most are inside closed drawers and are culled. Flights cost a few raycasts a frame per flying object, against the room's chunks only. Nothing new casts shadows. Every interaction should stay within 20 ms a frame at 60 Hz, as now.

## Testing

Vitest, like the rest:

- `prop-physics`: falls, lands on a floor, bounces and stops, slides off a slope, bounces off a wall, tips over above `tipSpeed`, the floor catch and the flight time limit.
- `prop-placement`: accepts a worktop, refuses a wall, anything out of reach, an overlap and a low shelf; finds a drawer's node and its fit.
- `props`: pick up, place, throw, drop; messages, counters and ties; a holder leaving; a newcomer's snapshot.
- `prop-places`: ids are unique, every node named exists in the real manifest of its layout, every object fits inside its drawer or cupboard.
- `interactions`: the new prompts.

Then in the browser: pick up, place, throw and drop in the kitchen, with two tabs to check sharing, and screenshots.
