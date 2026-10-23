# Doors, a visible sun and a textured sky — Plan

**Date:** 2026-10-23
**Builds on:** `claude/time-panel-ux-e518c8` (sun simulation plus the sun panel), not yet merged into `main`.

## What the review found

### Doors

- On `main`, door leaves get only the daylight layer. They are tied to a black lamp layer and a light intensity of 0, so a room's light never reaches its doors.
- The sun-simulation branch fixed this in the pipeline and the viewer (commit `3068415`). The bake adds `door-N_light-<room>` for each lit room a leaf faces, and the viewer binds up to two of them. **But the assets were never re-exported.** The committed `manifest.json` has no `doors[].lights`, so every door still gets no lamp light and no lamp spill. The only thing lighting a door is the flat ambient term, which makes it a pale panel with no shading, unlike the walls next to it.
- The `make export-final` that would have produced those layers was cut off part-way when the app quit (after Quarto 02). It never baked the Quarto 03, Sala, WC 01 and WC 02 layers and never wrote the manifest.
- Checked and found correct:
  - **The doors' daylight layer.** Each leaf's daylight bake matches the wall right beside it, about 0 on interior sides and 0.20 against 0.22 at the front door. It is near black because the hall and Entrada get almost no daylight, not because of a fault.
  - **The geometry around each door.** Raycasts from every door face reach the room in front of it.
  - **The room lookup.** `geom.door_rooms` finds both rooms for every leaf.
  - **The viewer binding.** With the staged layers wired into a local test manifest, every face with a layer lit up from its own room's switch.

**Fix:** a complete `make export-final` on this branch, committed. Nothing in the pipeline or the viewer changes. Run the export yourself: a Blender bake launched from a Claude session blocked its access to ~/Documents.

**Known limit, kept:** an open door keeps the lighting it was baked with closed.

### Sun and sky

The spec left "visible clouds, a sun disc" out of scope. The surroundings pass clears to one flat colour (`skyColor`, which follows the sun's elevation).

## Implementation

1. **`web/src/sky.ts`.** A sky dome drawn first in the surroundings scene, at the far plane (`xyww`) so every camera sees it at infinity, the mirrors' included. It uses one shader:
   - A gradient from the horizon to the zenith. The colours come from the sun's elevation: day, sunset and night, using the same colours as `skyColor` at the horizon.
   - A warm glow around the sun, stronger near the horizon.
   - A sun disc with a soft halo, which fades out as the sun sets (`sunFade`). Buildings and the apartment hide it because they draw over the dome.
   - Procedural clouds: fbm noise projected onto a cloud layer, drifting slowly and thinning toward the horizon. They are lit by the sun's colour, with a bright edge near the sun, and dim the disc behind them.
   - Cloud cover from the month's `cloudCover` in `climate.json`, scaled by `CONFIG.sky.cloudScale`, since the monthly average includes overcast days. With real lighting off, cover is a fixed `CONFIG.sky.flatCloudCover`.
2. **`Surroundings.setSky`** takes the sun's direction, elevation and the cloud cover instead of a colour. `Daylight` passes them in both modes.
3. **Tests:** the sky colours by elevation, cloud cover from the climate data, and that `Surroundings` builds the dome. Update the existing daylight test for the new `setSky`.
4. **Docs:** README controls and known limits, and the spec's "Out" list.

## The kitchen's light doesn't reach the living room

The Cozinha and the Sala are open plan: their floors share a 4.1 m edge with no wall between them, the only two rooms that meet like this. The bake puts each room's lamp layer only onto that room's own chunk. In Cycles the kitchen lamps do light the living room, but that light was never baked into the Sala chunk, so the living room stays dark until its own switch is on, with a hard line where the floors meet.

Fix, done the same way as the doors:

1. `geom.open_neighbours` finds rooms whose floors meet. It samples every floor edge and probes 2 cm to each side; pairs that share at least 0.5 m count. A wall or a doorway between two rooms leaves its thickness between their floors, so those never count. On the current floors it finds only Cozinha and Sala.
2. Each chunk lists its lit open-plan neighbours (`neighbours`). The bake adds `<room>_light-<neighbour>` with only the neighbour's lamps on, and the manifest lists it under `chunks[].lights`. A chunk with more than one neighbour fails the export checks, since the viewer binds one.
3. The viewer binds that layer to the chunk's second lamp slot, which doors already use, switched by the neighbour's light, spill included.

It needs the same complete `make export-final` as the doors: about two more 2048 px bakes and about 3 MB of light maps, loaded after the first view.
