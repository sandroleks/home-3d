# Apartment Walkthrough

A first-person web walkthrough of the apartment, built from the Blender model. Visitors walk around with the keyboard and mouse, open doors and flip the light switches.

It has two halves: `blender/` turns the .blend into web assets (headless Blender, run through the Makefile), and `web/` is the viewer (Vite, TypeScript, three.js).

## Prerequisites

- Blender 5.1.x at `/Applications/Blender.app` (use another location with `BLENDER=/path/to/Blender make ...`)
- Node 22.12 or newer
- Once: `cd web && npm ci` (the postinstall step copies the Draco decoder)

## Working on the model

For which changes need Blender and which don't, and the full edit → export → check → publish workflow, see [docs/changing-the-model.md](docs/changing-the-model.md).

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

The export checks itself. If something is wrong it prints `EXPORT CHECKS FAILED` with the reasons and leaves the previous assets untouched.

## Naming the pipeline relies on

Keep these names in Blender, or the export won't find things:

- Floors: `Floor - <Room>`. Ceiling lights: `Ceiling light <Room>`.
- Doorways: `Door N (A / B) lintel` and `Glazed Door N (A / B) lintel`, where A and B are the rooms on either side.
- Door parts: `Door N infill` (a filled-in opening), `Door leaf N`, and the glazed parts (glass, mullion, rail).
- Cameras: `Cam_Entrada` is where visitors start. `Cam_Sala`, `Cam_Kitchen` and `Cam_Bedroom` are viewpoints (used for `?view=` and the reference renders).
- The build-up animation is fine: the export uses the final frame.
- The view through the windows is everything in `Exterior - neighbourhood` (and its sub-collections). It is too big to lightmap, so it goes to `surroundings.glb` with simple sun-and-sky shading worked out from the scene's sun lamp (no shadows between buildings). When only the neighbourhood changed, `make export-surroundings` is enough.

## Overrides

When the automatic choice is wrong, adjust the tables in `blender/pipeline/config.py`:

- `EXPECTED_DOOR_COUNT`: how many interactive doors the export check expects.
- `SWITCH_OVERRIDES`: move a room's light switch (`door`, `side`, and `face: outside` to put it on the other room's wall).
- `DOOR_OVERRIDES`: fix a door leaf's hinge side or swing direction.
- `QUALITY`: bake resolution and samples for preview and final.
- `SURROUNDINGS_COLLECTION_PREFIXES`: which collections make the view through the windows. `SURROUNDINGS_SKY_IRRADIANCE`: how much the sky brightens it besides the sun.

## Run and test

```
cd web && npm run dev      # http://localhost:5173
```

Controls: WASD to walk, Shift to walk faster, mouse to look, click to open doors and use switches, L toggles the current room's light, Esc pauses.

Handy URL options:

- `?view=Cam_Sala&autostart`: jump to a viewpoint and skip the start screen.
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
