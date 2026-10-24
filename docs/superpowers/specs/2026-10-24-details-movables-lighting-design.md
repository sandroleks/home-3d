# Details, Movables, Lamps and Screens — Design

**Date:** 2026-10-24
**Status:** Implemented

## Goal

More of the flat works and it looks more lived in:

- Drawers slide out and cabinet doors swing open, with something inside.
- The glazed doors (Quarto 02 to the balcony, kitchen to laundry, laundry to the enclosed balcony) open as pairs of French door leaves and block the way while closed.
- Lamps have real colour temperatures; freestanding lamps switch on their own; fixtures visibly glow and bright things bloom; a lit room's light reaches the next room through an open door.
- The TV and the office monitor and laptop switch on and show generated, animated content, and the TV lights the room.
- Finer detail: drawer and cupboard contents, bulbs and LED strips, sockets, glazed door handles, better switch plates.

## The model (`blender/tools/model_details.py`)

A one-off script, run on the .blend like `fix_neighbourhood.py`, makes the model changes and marks the file so it refuses to run twice. Everything it adds follows conventions the pipeline reads, so later hand edits in Blender keep working.

- **Lamp colours:** every lamp uses Blender's colour temperature (ceilings 3000 K, table, floor, pendant and wall lamps 2700 K, LED strips 3000 K, kitchen under-cabinet 3500 K, workbench task light 4000 K, TV bias light 6500 K).
- **Fixtures:** emissive bulbs inside every shade and pendant, emissive LED strips where the strip lights are, and glowing diffusers on the ceiling fixtures.
- **Movables:** each drawer front with its pull becomes one object with a drawer box and contents; each cabinet door with its pull becomes one object; the carcass behind them is hollowed (a boolean cut) so there is an inside to see. Custom properties say how each one moves:
  - `web_move = "slide"`, `web_dir` (world unit vector), `web_dist` (m);
  - `web_move = "hinge"`, `web_pivot` (world point), `web_axis` (world unit vector), `web_angle` (radians, right-hand rule about the axis).
- **Glazed doors:** each glazed opening's glass, rails and mullion are rebuilt as two leaves with stiles, glass and a lever handle. Parts carry `web_leaf = "Door leaf 4a"`; the pipeline joins parts with the same value into that leaf. The glass halves keep the `Glazed Door N (A / B) glass` names (with a `.001` suffix) so the sun still enters through them.
- **Lamp groups:** a light and the fixture meshes around it carry `web_lamp = "<name>"` (e.g. `floor-lamp`). A group is (room, name). Lights without it are on the room's wall switch.
- **Screens:** the TV, monitor and laptop screens carry `web_screen = "tv" | "monitor" | "laptop"`. The TV's bias light is in lamp group `tv`, which follows the TV.
- **Trim:** sockets on free wall near the floor in every room and above the kitchen worktop.

## The pipeline

### Light groups

Every room with a ceiling light has a **switch group** (id = room id: the ceiling light plus every lamp without `web_lamp`) and one **lamp group** per `web_lamp` value (id `<room>/<name>`). Glowing materials are copied per group (`<material> @<group id>`) instead of per room, so a lamp's shade glows with its own lamp. Screens never glow in a bake.

### Layers

A surface's lighting is: the day layer (RGBM, as before), its room's switch layer (RGBM, full size, as before), and **packed layers**: 8-bit luminance layers, three to a texture (RGB; alpha stays opaque because lossless WebP drops the colour of transparent pixels), at half the surface's lightmap size (doors and movables: full size). Each packed layer is gamma-encoded (`(L / range)^(1/2.2)`) with its own range and has a tint, the mean colour of its bake, which the viewer multiplies back in. Packed layers are:

- the room's lamp groups;
- an open-plan neighbour's switch and lamp groups (the kitchen's on the living room and the other way round);
- **spill:** for each door between room A (with lights) and room B, A's lights baked onto B with that door open. The viewer weights it by how far the door is open and by A's lights (each group weighted by its share of A's lamp power).

Doors get both rooms' switch and lamp groups packed. A surface takes at most three packed textures (nine layers); the export check fails beyond that.

### Movables

Objects with `web_move` are exported as their own nodes (`Move_<slug>`), origin at the pivot for hinges. They're baked in their **open** pose so their insides are lit, one room at a time, in passes of movables at least 0.8 m apart (so an open drawer doesn't shade its neighbour's bake). All of a room's movables share an atlas: one tile each, per layer. The static chunks are baked with the movables hidden, so the hollow carcasses are lit inside and no open front casts a shadow.

### Double doors

`prepare_doors` accepts two leaves per opening when each is less than two thirds of its width. Both are ordinary doors in the manifest (`Door_4a`, `Door_4b`), with collision segments, so a closed glazed door blocks the way.

### Fixtures and screens

- Each lamp group with fixture meshes gets an invisible box node around them (`Lamp_<slug>`), added after the bake: the viewer's click target.
- Each screen mesh is its own node (`Screen_<room>-<kind>`) with planar UVs (u to the viewer's right, v up). The manifest records its centre, outward normal and size, and its lamp group if one has the same name.

### Manifest v3

`groups` (id, room, kind `switch | lamp`, name, target node, power), `chunks[].packs`, `doors[].packs`, `movables` (node, room, kind, pivot, axis, angle or direction and distance, day ref, packs), `screens`. Each pack is `{file, layers: [{group | spill: {door, from}, range, tint}]}`.

## The viewer

- `LightGroups` replaces `RoomLights`: one fading level per group. `L` and the wall switch toggle the room's switch group; clicking a fixture toggles its lamp group.
- The lightmap shader sums day, switch and up to three packs: `irradiance += tints * (pow(texel.rgb, 2.2) * gains)`, with gains = range × level per channel, updated each frame.
- Movables animate like doors (eased, 0.45 s); targets prompt "open drawer", "close cupboard".
- Screens: a canvas texture per screen (`screen-content.ts`: TV channels, desktop), unlit while off (a dark glossy panel). Clicking the TV turns it on, then steps through the channels, then off; the monitor and laptop toggle. Their light is baked: the pipeline puts an area light over each (a white picture, `SCREEN_LIGHT_WATTS`) in the screen's lamp group, and the viewer scales that layer by the picture's brightness and sets its tint to the picture's colour each frame.
- Halos: a depth-tested, additive sprite at each small glowing fixture, fading with its lamp (`halos.ts`).

### Performance

A first version used live `RectAreaLight`s for the screens and a full-screen bloom (half-float, multisampled target). Measured at 2400×1780 in the Sala: 13.1 ms a frame against 3.6 ms before this work; the area lights cost about 3 ms even while off (every lit pixel evaluates them), the bloom about 5 ms (2 ms even when bloomed from a copy of the finished frame, which forces the antialiasing to resolve mid-frame). Baking the screen light and replacing bloom with halos brought it to 4.2 ms; the rest is the packed lamp layers (about 0.6 ms).

## Costs

- Bake: roughly double the current final export (about 35 minutes) for the extra layers, spill and movables.
- Download: a few MB more of lightmaps (packed layers are a twelfth of an RGBM layer's texels each).
- GPU: the packed textures add about 4 MB per four layers on the largest rooms.

## Known limits

- An open drawer or cupboard keeps the lighting it was baked with open; when only a neighbour is open the shading doesn't change.
- Spill is per door, not per lamp: light through a door follows the overall brightness of the room behind it.
- Sun and sky light don't pass through open doors (the day layer is baked with doors closed).
- The TV and monitor light doesn't cast shadows.
