# Apartment Walkthrough

A first-person web walkthrough of the apartment, built from the Blender model. Visitors walk around with the keyboard and mouse, open doors and flip the light switches.

It has two halves: `blender/` turns the .blend into web assets (headless Blender, run through the Makefile), and `web/` is the viewer (Vite, TypeScript, three.js).

## Prerequisites

- Blender 5.1.x at `/Applications/Blender.app` (use another location with `BLENDER=/path/to/Blender make ...`)
- Node 22.12 or newer
- Once: `cd web && npm ci` (the postinstall step copies the Draco decoder)

## Working on the model

1. Edit the original `~/Documents/Untitled.blend` in Blender.
2. Copy it over the project's file before exporting: `cp ~/Documents/Untitled.blend .`
3. Export (below).

Good to know:

- The pipeline never writes to either .blend file. It runs Blender on a staged copy in `/private/tmp` with factory settings, so your add-ons don't load.
- External image textures must be packed: File > External Data > Pack Resources.

## Export

```
make export-preview    # about 1 minute, low-quality lighting, good for checking changes
make export-final      # about 35 minutes on the GPU
make export-surroundings   # about 30 seconds: only the view through the windows, nothing else changes
```

If the GPU bake hangs, quit Blender and try again, or run on the CPU (much slower): `WEB_BAKE_DEVICE=CPU make export-final`.

Outputs:

- `web/public/assets/`: what the viewer loads. `surroundings.glb` is the neighbourhood seen through the windows.
- `build/debug_map.png`: a floor plan check. Red = closed door, green = open door, blue = light switches, yellow = spawn point.
- `build/web-export.blend`: the baked scene, for inspection.

Exports leave `web/public/assets/audio/`, `climate.json` and `DATA-SOURCES.md` in place.

The export checks itself. If something is wrong it prints `EXPORT CHECKS FAILED` with the reasons and leaves the previous assets untouched.

## Naming the pipeline relies on

Keep these names in Blender, or the export won't find things:

- Floors: `Floor - <Room>`. Ceiling lights: `Ceiling light <Room>`.
- Doorways: `Door N (A / B) lintel` and `Glazed Door N (A / B) lintel`, where A and B are the rooms on either side.
- Door parts: `Door N infill` (a filled-in opening), `Door leaf N`, and the glazed parts (glass, mullion, rail).
- Cameras: `Cam_Entrada` is where visitors start. `Cam_Sala`, `Cam_Kitchen` and `Cam_Bedroom` are viewpoints (used for `?view=` and the reference renders).
- Exterior glass: `Window N (Exterior / Room) glass` and `Glazed Door N (Exterior / Room) glass`; the viewer measures the sunlight entering through them.
- Lights named `Portal …` are window fill and count as sky light; every other lamp is switched with its room's ceiling light.
- The build-up animation is fine: the export uses the final frame.
- The view through the windows is everything in `Exterior - neighbourhood` (and its sub-collections). It is too big to lightmap, so it goes to `surroundings.glb`. The viewer lights it live with the same sun and sky as the flat (no shadows between buildings). When only the neighbourhood changed, `make export-surroundings` is enough.

## Overrides

When the automatic choice is wrong, adjust the tables in `blender/pipeline/config.py`:

- `EXPECTED_DOOR_COUNT`: how many interactive doors the export check expects.
- `SWITCH_OVERRIDES`: move a room's light switch (`door`, `side`, and `face: outside` to put it on the other room's wall).
- `DOOR_OVERRIDES`: fix a door leaf's hinge side or swing direction.
- `QUALITY`: bake resolution and samples for preview and final.
- `SURROUNDINGS_COLLECTION_PREFIXES`: which collections make the view through the windows.

## Sound

The audio lives in `web/public/assets/audio/`: doors, switches and footsteps from Kenney's CC0 packs, birdsong and music from CC0 OpenGameArt uploads, and two generated room-tone loops. `CREDITS.md` there lists every source. To rebuild the files (needs ffmpeg), download the sources it lists into one folder, unzip each Kenney zip into a folder named after it (`kenney_rpg-audio`, `kenney_impact-sounds`, `kenney_ui-audio`), and run `web/scripts/build-audio.sh <folder>`. Levels, fades, footstep spacing and which rooms sound outdoors or like a kitchen are in `CONFIG.audio` and `CONFIG.roomAmbience` (`web/src/config.ts`).

## Sun

The sun is live: its position comes from the NOAA solar equations for the flat's coordinates and the chosen date and time (Lisbon time), and its strength and the sky's from a typical day of each month (`web/public/assets/climate.json`, sources in `web/public/assets/DATA-SOURCES.md`). The day layer of the bake is sky light only; the sun, its shadows (from the flat, the building and neighbours within 200 m) and the light it bounces into each sunlit room are added in the browser.

- At night (sun more than 6° below the horizon) the walkthrough opens with the entrance light on.
- Where the flat is: `SITE` in `blender/pipeline/config.py` (Blender's origin and the compass bearing of +Y).
- Refresh the climate data: `cd web && node scripts/fetch-climate.mjs 41.117327 -8.653914`.
- Compare with Cycles: `make render-refs SUN=2026-12-21T10:00` renders the viewpoints lit by the same sun into `build/ref/`.
- Tuning: `CONFIG.sun` in `web/src/config.ts` (bounce, skyGain, ambient, shadow bias, colours, time-lapse speed); `CONFIG.lightSpill` keeps a little of each room's lamp light with the lights off; `CONFIG.exposure` sets the overall brightness.
- Real sun and sky off (R, or the panel's checkbox; remembered per browser): the same even daylight at any time, set by `CONFIG.flatLighting`.
- Mirrors reflect the room live (`web/src/mirrors.ts`): any thin slab with the `Mirror` material.

## Run and test

```
cd web && npm run dev      # http://localhost:5173
```

Controls: WASD to walk, Shift to walk faster, mouse to look, click to open doors and use switches, L toggles the current room's light, M mutes sound, `,` and `.` move the time back and forward 15 minutes (hold to keep going), Shift + `,` and `.` move the date a week, P plays the day (one hour of sun every two seconds), R turns the real sun and sky on or off, and Esc pauses. The sun panel at the bottom left is always on screen. Press Tab to free the mouse and use it while you keep walking with WASD; press Tab again, or click the view, to look around. It also works while paused.

Handy URL options:

- `?view=Cam_Sala&autostart`: jump to a viewpoint and skip the start screen.
- `?sun=2026-12-21T10:00`: open at that moment (Lisbon time). It combines with `?view=` and `autostart`.
- `?debug=lightmap`: show the lighting alone, without textures.

Tests and comparisons:

```
make test-blender    # export pipeline tests
make web-test        # viewer tests
make render-refs     # Cycles reference renders in build/ref/ to compare against the viewer
```

## Deploy

The repo is self-contained: the exported assets in `web/public/assets/` (about 36 MB) and the source `Untitled.blend` are committed, so a host can build straight from GitHub.

**Vercel:** import the GitHub repo and set **Root Directory** to `web` (Vercel usually suggests it). `web/vercel.json` installs with `npm ci`, builds, and serves `dist/`. Leave the other build settings alone. Every push to `main` redeploys.

**Updating the live site:** re-export (`make export-final`), then commit the changed files in `web/public/assets/` (and `Untitled.blend`) and push.

**Building locally:** `cd web && npm run build` writes the static site to `web/dist/`. Any static host works. Serve it from a URL ending in `/`, because asset paths are relative.

File names are stable across exports. Vercel revalidates static files on every visit, so that's fine there. On another CDN, purge the cache after re-exporting, or use short cache times for `assets/manifest.json`, `assets/*.glb` (including `surroundings.glb`) and `assets/lightmaps/*`.

## Known limits

- Desktop only (keyboard and mouse); phones and tablets see a notice.
- Light from one room doesn't spill through doorways into the next.
- The baked sky light comes from below the horizon too, compensated globally by `CONFIG.sun.skyGain`, so ceilings near windows read a little bright and up-facing outdoor surfaces (balcony floor, sills) a little dark.
- The bounce fill is a flat approximation: rooms without exterior glass of their own (e.g. the kitchen, lit through the glazed doors) get none and read darker than Cycles.
