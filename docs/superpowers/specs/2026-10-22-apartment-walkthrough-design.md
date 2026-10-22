# Apartment Walkthrough — Design

**Date:** 2026-10-22
**Status:** Approved in brainstorming, awaiting spec review

## Goal

A personal/portfolio website where visitors freely walk through the T2 apartment modelled in Blender, in real-time 3D, with lighting that looks like the Cycles renders. Visitors can open and close the interior doors and switch each room's ceiling light on and off.

## Source

- Blender file: `/Users/sandrolek/Documents/Untitled.blend` (never modified by this project).
- About 6.95 × 18.2 m, ~129k visible triangles, 836 render-visible meshes, 150 materials in use.
- Rooms: Sala, Cozinha, Lavandaria, Marquise, Entrada, Closet, Hall, Quarto 01, Quarto 02, Quarto 03, WC 01, WC 02, Varanda. Each has a `Floor - <room>` mesh.
- Doors: `Door leaf 1`–`Door leaf 10` in collection `Doors.001`. They are separate meshes, 0.75 × 2.05 m.
- Lights: one `Ceiling light <room>` area light per room except the Varanda (12 in total, collection `Interior lights.001`, currently hidden for rendering), plus a sun, a sky texture and 4 daylight portals. Most rooms have no visible ceiling fixture mesh, only the hidden area light.
- Materials: 138 are flat Principled values and export directly. 12 are procedural and must be baked: Bath wall tile, Floor hardwood (existing), Floor tile, Limewash sand (Sala), Slat natural oak, Splashback tile, WC01ex tile plain, WC01ex tile ribbed, WC02ex cream floor tile, WC02ex grey shower floor, WC02ex grey stone tile, WC02ex pale wall tile.
- No mesh currently has UV maps.

## Scope

**In:** desktop browsers, first-person free walk, collision, door interaction, per-room light toggle, room name readout, loading and start screens.

**Out:** mobile or touch controls (phones see a "best viewed on desktop" notice), info hotspots, minimap, variant toggles, cabinet, drawer or TV interactions, VR, multiplayer, and deployment (a separate later step).

## Part 1: Blender export pipeline

A single Python script, `blender/export_web.py`, run inside Blender. It is idempotent and re-runnable, and works only on a saved copy, `build/web-export.blend`.

1. **Scene selection.** Keep objects that are render-visible in the current file, and also enable the `Ceiling` collections, since the walkthrough needs ceilings. Drop the hidden variants (`Kitchen - closed`, `Sala - old sofa (hidden)`, `Sala - sofa bed (opened)`, the `Furniture - WC 0x` alternatives), all `Scan - *` collections, and `Walls (backup before finishes)`. The variant shown is exactly the current render state: open kitchen and existing WCs.
2. **Room chunks.** Assign each static mesh to a room by testing its world-space centre against the `Floor - <room>` footprints, with shared structure such as walls, slab and ceiling split per room footprint. Join each room's meshes into one chunk object named `Room_<room>` (13 chunks). Door leaves are excluded and stay as individual objects, with their origins moved to the hinge edge.
3. **Lightmap UVs.** Give every chunk and door a second UV map, `UVLightmap`, using Lightmap Pack (or Smart UV Project) with enough margin to avoid bleeding.
4. **Procedural material bake.** For each of the 12 procedural materials, bake its base colour (and its roughness, where that varies) to a tileable texture on a plain planar or box UV map, `UVMap`. Then replace the node tree with a Principled BSDF and image textures, so the glTF exporter keeps the look.
5. **Lighting bake (Cycles, GPU).** Two diffuse-lighting bakes per room chunk and door, with no albedo (Diffuse pass: direct + indirect, colour off):
   - `day`: sun, sky and portals on, all ceiling lights off.
   - `light_<room>`: only that room's ceiling light on, with the sky, sun and portals off. It is baked onto that room's chunk only, so spill into neighbouring rooms is not captured. The Varanda has no ceiling light and gets only a `day` bake.
6. **Light switches.** For each of the 12 lit rooms, the script adds a small wall switch mesh (`Switch_<room>`, 8 × 8 × 1 cm, white) on the wall beside the room's main door frame at 1.1 m height, on the room side. Position and door choice can be overridden per room in a table at the top of the script. Switches are part of the room chunk's bake but exported as separate nodes so they can be targeted.
7. **Collision mesh.** Export a simplified `collision.glb` containing walls, closed door leaves (as separate named nodes), and the bounding boxes of furniture at or below 1.8 m. It is used only for physics, never rendered.
8. **Export.**
   - `apartment.glb`: geometry and materials, meshopt-compressed, with textures as WebP.
   - `lightmaps/<room>_day.webp` and `lightmaps/<room>_light.webp`: HDR encoded as RGBM in 8-bit WebP, 2048² per room (smaller rooms may use 1024²).
   - `manifest.json`: per room, its name, chunk node name, lightmap files, RGBM range, light colour, switch node name (if any) and the floor polygon (XY) used for room detection; per door, its node name, hinge axis, swing direction and open angle; plus the spawn point and orientation.
9. **Self-check.** The script fails with a clear message if any check fails: every chunk has `UVLightmap` and a `day` lightmap; every lit room has a `light` lightmap and a switch; there are 10 doors with hinge origins; no procedural texture nodes remain; the manifest validates; the total size is under budget.

**Budget:** first-view download of 30 MB or less; bake time of roughly 30–90 minutes on GPU.

## Part 2: Website

Vite + TypeScript + three.js, with no UI framework. The output is a static site in `web/dist`.

Modules (in `web/src/`):

| Module | Responsibility | Depends on |
|---|---|---|
| `config.ts` | Display names for rooms, spawn override, speeds, fade times. | none |
| `loader.ts` | Loads `manifest.json`, `apartment.glb` and `collision.glb`, then streams lightmaps, reporting progress. | three |
| `lightmaps.ts` | Patches `MeshStandardMaterial` via `onBeforeCompile` so the shader adds `day + intensity × roomLight` (RGBM-decoded) on UV channel 1. Exposes `setRoomLight(room, 0..1)`. | three, manifest |
| `player.ts` | Pointer-lock first-person controller: mouse look, WASD, Shift for faster walking, eye height 1.6 m, capsule collision against the collision mesh using `three-mesh-bvh`. Closed doors block movement. If the player falls below the floor, they are reset to the last safe position. | three, three-mesh-bvh |
| `interactions.ts` | Raycasts from the screen-centre crosshair to find what is targeted, outlines the target and shows a prompt. On click, a door animates 0 ↔ open angle over 0.6 s with ease-in-out and its collision node is toggled; clicking a room's wall switch fades that room's light over 0.4 s. **L** toggles the light of the current room (ignored in the Varanda). | player, lightmaps, rooms |
| `rooms.ts` | Point-in-polygon test of the player's XY position against the room floor polygons, returning the current room. | manifest |
| `ui.ts` | Start screen (title, "Click to explore", controls, progress bar), HUD (crosshair, room name, prompt), pause on Esc, mobile notice, and the WebGL2-unsupported message. | none |
| `main.ts` | Wiring and the render loop. | all |

Rendering uses ACES Filmic tone mapping and sRGB output. A low-intensity environment map is generated from the scene sky so glossy surfaces get some reflection.

**Initial state:** the player starts in the Entrada, with all doors closed, daylight on and every ceiling light off.

## Error handling

- No WebGL2: show a message instead of the canvas.
- A lightmap fails to load: that room renders with a flat ambient term, a console warning is logged, and the walkthrough continues.
- The `.glb` or manifest fails to load: an error on the start screen with a retry button.
- Falling through geometry: the player is reset to the last grounded position.

## Testing

- **Pipeline:** the self-checks in step 9 run on every export.
- **Unit tests (Vitest):** RGBM encode/decode round-trip, light-intensity fades, room point-in-polygon detection (including doorways), and the door state machine (closed → opening → open → closing, clicks during an animation, collision toggling).
- **Visual verification in the browser:** match the positions of `Cam_Sala`, `Cam_Kitchen` and `Cam_Bedroom` and compare screenshots against Cycles renders from those cameras; walk every room, open all 10 doors and toggle all 12 lights; confirm 60 fps on a typical laptop.

## Repository layout

```
blender/export_web.py      # export + bake pipeline
build/                     # web-export.blend (git-ignored)
web/public/assets/         # apartment.glb, collision.glb, lightmaps/, manifest.json
web/src/                   # modules above
web/tests/                 # Vitest unit tests
docs/superpowers/specs/    # this document
```
