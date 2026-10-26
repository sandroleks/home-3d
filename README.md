# Apartment Walkthrough

A first-person web walkthrough of the apartment, built from the Blender model. Visitors walk around with the keyboard and mouse, or by touch on phones and tablets, open doors (the glazed ones slide), drawers and cupboards, flip the light switches and lamps, watch TV and put a record on. Visitors who are there at the same time see each other and share the flat.

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

- `blender/tools/model_details.py` added the drawers and cupboards that open (with insides), the French door leaves, lamp colour temperatures, bulbs, LED strips and sockets. It has run once on `Untitled.blend` and refuses to run again; edit those things by hand from now on, following the conventions below.
- `blender/tools/sliding_doors.py` then rebuilt the glazed doors as the real ones are, sliding: a fixed panel and a leaf that slides over it. It also tagged the turntable's platter to spin. It too has run once and refuses to run again.
- The pipeline never writes to either .blend file. It runs Blender on a staged copy in `/private/tmp` with factory settings, so your add-ons don't load.
- External image textures must be packed: File > External Data > Pack Resources.

## Export

```
make export-preview    # about 1 minute, low-quality lighting, good for checking changes
make export-final      # about 1 to 1.5 hours on the GPU
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
- Lights named `Portal …` are window fill and count as sky light; every other lamp is switched with its room's ceiling light, unless it's in a lamp group (below).
- Sliding glazed doors: a fixed panel (`Glazed Door N (A / B) fixed panel`, with `… glass`, both part of the room and solid to walk into) and one leaf, `Door leaf Nb`, tagged `web_move = "slide"` with `web_dir` and `web_dist`. It sits 5.8 cm in front of the panel so they pass. Its glass is `… glass.001` with a `web_leaf` custom property naming the leaf it joins. Both glass names keep the window pattern so the sun still comes in. (Two leaves at one opening, `Door leaf Na` and `Nb` without `web_move`, still make French doors.)

Custom properties (Object Properties > Custom Properties):

- `web_lamp = "<name>"` on a light, and on the meshes around it (shade, base, bulb), makes a lamp that switches on its own: click it in the walkthrough. Its glowing materials glow with it. Lamps with the same name in one room switch together.
- `web_screen = "tv" | "monitor" | "laptop"` on a screen mesh: it shows a generated picture when switched on. The TV's bias light is lamp group `tv` and follows the TV.
- `web_move` makes a mesh open. `"slide"` with `web_dir` (a world direction, e.g. `[1, 0, 0]`) and `web_dist` (m) for a drawer; `"hinge"` with `web_pivot` (a world point on the hinge line), `web_axis` (the hinge direction) and `web_angle` (radians, right-handed about the axis) for a door or flap; `"spin"` with `web_pivot`, `web_axis` and `web_rpm` for the turntable's platter, which turns while the record plays. On a `Door leaf`, `"slide"` makes a sliding door. Give the carcass behind it a hollow (a boolean against a hidden cutter, as the script does) so there is an inside to see.
- A mesh that casts no shadow (Object Properties > Visibility > Shadow off) and only uses glowing materials is a bulb or LED strip: it is exported unlit and glows with its lamp, and it never blocks the lamp inside it.
- The build-up animation is fine: the export uses the final frame.
- The view through the windows is everything in `Exterior - neighbourhood` (and its sub-collections). It is too big to lightmap, so it goes to `surroundings.glb`. The viewer lights it live with the same sun and sky as the flat (no shadows between buildings). When only the neighbourhood changed, `make export-surroundings` is enough.

## Overrides

When the automatic choice is wrong, adjust the tables in `blender/pipeline/config.py`:

- `EXPECTED_DOOR_COUNT`: how many interactive doors the export check expects.
- `SWITCH_OVERRIDES`: move a room's light switch (`door`, `side`, and `face: outside` to put it on the other room's wall).
- `DOOR_OVERRIDES`: fix a door leaf's hinge side or swing direction (`sign` alone also works for a leaf modelled closed in its doorway, as the French doors are).
- `QUALITY`: bake resolution and samples for preview and final.
- `SURROUNDINGS_COLLECTION_PREFIXES`: which collections make the view through the windows.

## Sound

The audio lives in `web/public/assets/audio/`: doors, switches and footsteps from Kenney's CC0 packs, birdsong and music from CC0 OpenGameArt uploads, and two generated room-tone loops. `CREDITS.md` there lists every source. To rebuild the files (needs ffmpeg), download the sources it lists into one folder, unzip each Kenney zip into a folder named after it (`kenney_rpg-audio`, `kenney_impact-sounds`, `kenney_ui-audio`), and run `web/scripts/build-audio.sh <folder>`. The music is off until the visitor starts the turntable in the Sala; it plays from the top each time and fades out when the record stops. Levels, fades, footstep spacing and which rooms sound outdoors or like a kitchen are in `CONFIG.audio` and `CONFIG.roomAmbience` (`web/src/config.ts`).

## Sun

The sun is live: its position comes from the NOAA solar equations for the flat's coordinates and the chosen date and time (Lisbon time), and its strength and the sky's from a typical day of each month (`web/public/assets/climate.json`, sources in `web/public/assets/DATA-SOURCES.md`). The day layer of the bake is sky light only; the sun, its shadows (from the flat, the building and neighbours within 200 m) and the light it bounces into each sunlit room are added in the browser.

- At night (sun more than 6° below the horizon) the walkthrough opens with the entrance light on.
- Where the flat is: `SITE` in `blender/pipeline/config.py` (Blender's origin and the compass bearing of +Y).
- Refresh the climate data: `cd web && node scripts/fetch-climate.mjs 41.117327 -8.653914`.
- Compare with Cycles: `make render-refs SUN=2026-12-21T10:00` renders the viewpoints lit by the same sun into `build/ref/`.
- Tuning: `CONFIG.sun` in `web/src/config.ts` (bounce, skyGain, ambient, shadow bias, colours, time-lapse speed); `CONFIG.lightSpill` keeps a little of each room's lamp light with the lights off; `CONFIG.exposure` sets the overall brightness.
- Real sun and sky off (R, or the panel's checkbox; remembered per browser): the same even daylight at any time, set by `CONFIG.flatLighting`.
- Mirrors reflect the room live (`web/src/mirrors.ts`): any thin slab with the `Mirror` material.
- The sky behind the neighbourhood (`web/src/sky.ts`) has a gradient, the sun's disc and glow where the sun really is, and drifting clouds. Cloud cover follows each month's average from `climate.json`, scaled by `CONFIG.sky.cloudScale`. Colours and the disc's size are in `CONFIG.sky`.

## Run and test

```
cd web && npm run dev      # http://localhost:5173
```

Controls: WASD to walk, Shift to walk faster, mouse to look, click to open doors, drawers and cupboards and to use switches, lamps, screens and the turntable (the TV steps through its channels, then switches off), L toggles the current room's light, M mutes sound, `,` and `.` move the time back and forward 15 minutes (hold to keep going), Shift + `,` and `.` move the date a week, P plays the day (one hour of sun every two seconds), R turns the real sun and sky on or off, and Esc pauses. The sun panel at the bottom left is always on screen. Press Tab to free the mouse and use it while you keep walking with WASD; press Tab again, or click the view, to look around. It also works while paused.

On phones and tablets (no mouse): drag on the left half of the screen to walk (a stick appears under your thumb; push past its ring to walk faster), drag on the right half to look around, and tap doors, switches, lamps, screens and the turntable. Both thumbs work at once. The buttons at the top right open the sun panel, toggle the room's light, mute and pause. Android goes fullscreen on start; iPhones can't. Tuning (stick size, dead zone, look speed, tap timing) is in `CONFIG.touch`. To try it on a desktop, use the browser's device toolbar with a phone selected and reload.

Handy URL options:

- `?room=friends`: meet only the people who open the same `?room=` link (see Visitors together, below). `?solo` explores alone.
- `?view=Cam_Sala&autostart`: jump to a viewpoint and skip the start screen.
- `?sun=2026-12-21T10:00`: open at that moment (Lisbon time). It combines with `?view=` and `autostart`.
- `?debug=lightmap`: show the lighting alone, without textures.

Tests and comparisons:

```
make test-blender    # export pipeline tests
make web-test        # viewer tests
make render-refs     # Cycles reference renders in build/ref/ to compare against the viewer
```

## Visitors together

People who open the walkthrough at the same time see each other as little pastel toy animals after the wooden reindeer on the sofa (a reindeer, bear, bunny or fox in its visitor's own colour, with googly eyes and a face of its own, `web/src/creatures.ts`), with the name they typed on the start screen above it (remembered per browser; blank reads "Guest"), and a "With …" line under the room name. The flat is shared: doors, drawers and cupboards, lights, screens and the turntable are in the same state for everyone, and whoever arrives later gets the flat as the others left it. The sun's date and time are not shared: they stay each visitor's own.

There is no server. The browsers connect to each other with WebRTC through [Trystero](https://github.com/dmotz/trystero), which finds the other visitors through public Nostr relays. Everyone on the site shares one room by default; `?room=<name>` gives a group a room of their own, and `?solo` stays alone. Trystero loads only after the start click, and if it can't load or a network blocks WebRTC, the walkthrough carries on alone (a warning in the console). It connects everyone to everyone, so it suits a handful of people, not a crowd. Reference renders (`?autostart`) never join.

Tuning is in `CONFIG.multiplayer` (`web/src/config.ts`): the room, how often poses are sent, how long a silent visitor stays, the colours, and the creatures' size, walk, bounce, googly eyes, blinking and how they dim with the room's light. The design note is `docs/superpowers/specs/2026-10-25-multiplayer-design.md`.

## Deploy

The repo is self-contained: the exported assets in `web/public/assets/` (about 36 MB) and the source `Untitled.blend` are committed, so a host can build straight from GitHub.

**Vercel:** import the GitHub repo and set **Root Directory** to `web` (Vercel usually suggests it). `web/vercel.json` installs with `npm ci`, builds, and serves `dist/`. Leave the other build settings alone. Every push to `main` redeploys.

**Updating the live site:** re-export (`make export-final`), then commit the changed files in `web/public/assets/` (and `Untitled.blend`) and push.

**Building locally:** `cd web && npm run build` writes the static site to `web/dist/`. Any static host works. Serve it from a URL ending in `/`, because asset paths are relative.

File names are stable across exports. Vercel revalidates static files on every visit, so that's fine there. On another CDN, purge the cache after re-exporting, or use short cache times for `assets/manifest.json`, `assets/*.glb` (including `surroundings.glb`) and `assets/lightmaps/*`.

## Lighting

Each room's wall switch turns on its ceiling light and every lamp without a lamp group; lamps with one (`web_lamp`) switch on their own. Lamps use real colour temperatures (2700 to 4000 K). Each group is baked on its own: a room's wall switch as a full colour layer, everything else (its lamps, an open-plan neighbour's lamps, and the light from a lit room through each of its doors) as 8-bit luminance layers three to a texture (RGB), with the light's colour as a tint (`blender/pipeline/packs.py`, `layers.py`). The light through a door follows how far it's open and how bright the room behind it is.

Drawers and cupboard doors are baked open, so their insides are lit; the rooms are baked with them taken away, so the hollow carcasses get light inside and no open front leaves a shadow behind.

Lit bulbs, shades and ceiling diffusers get a soft halo (`src/halos.ts`, `CONFIG.halos`): one depth-tested sprite each, much cheaper than a full-screen bloom. The TV's and monitor's light is baked like a lamp's, for an all-white picture (`SCREEN_LIGHT_WATTS` in `blender/pipeline/config.py`); the viewer scales it by the picture's brightness and tints it with its colour.

Keep the frame cheap: every live light (three.js light) is paid for by every pixel of every lit surface, and a full-screen pass costs about as much as one. Bake what can be baked. And keep it smooth: stutters, not slow frames, are what feel laggy. At load every shader is compiled in the background (`src/warmup.ts`), including the screens' pictures, the halos and the variants a mirror needs, and lightmaps go up to the GPU two per frame instead of when a room first comes into view. Mirrors draw at half resolution (`CONFIG.mirrorScale`). Drawers and cupboards don't redraw the sun's shadow map as they move; doors still do.

## Known limits

- Phones get a lighter load to fit their GPU memory: lightmaps larger than 1024 px are halved on the GPU as they load (the 2048 px rooms, about 290 MB down to 140 MB), and the sun's shadow map is 2048 px instead of 4096 (`CONFIG.touch`). A touch laptop, or an iPad with a trackpad, counts as a desktop.
- Light through a door is one layer per door and room: it follows the room's overall brightness, not which of its lamps are on, and lights only the rooms, not the door leaves or drawers. Sun and sky don't come through open doors.
- An open door, or a slid glazed leaf, keeps the lighting it was baked with closed; a drawer or cupboard keeps the lighting it was baked with open, and doesn't shade its neighbours.
- The TV's and monitor's light takes the picture's average colour, the same everywhere in the room.
- No moon or stars at night.
- The baked sky light comes from below the horizon too, compensated globally by `CONFIG.sun.skyGain`, so ceilings near windows read a little bright and up-facing outdoor surfaces (balcony floor, sills) a little dark.
- The bounce fill is a flat approximation: rooms without exterior glass of their own (e.g. the kitchen, lit through the glazed doors) get none and read darker than Cycles.
