# Apartment Walkthrough

A first-person web walkthrough of the apartment, built from the Blender model. Visitors walk around with the keyboard and mouse, or by touch on phones and tablets, open doors (the glazed ones slide), drawers and cupboards, flip the light switches and lamps, watch TV and put a record on, sit on the sofas and chairs and lie on the bed. Visitors who are there at the same time see each other and share the flat.

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

- `blender/tools/model_details.py` added the drawers and cupboards that open (with insides), the French door leaves, lamp colour temperatures, bulbs, LED strips and sockets. It has run once on `Untitled.blend` and refuses to run again; edit those things by hand from now on, following the conventions below.
- `blender/tools/sliding_doors.py` then rebuilt the glazed doors as the real ones are, sliding: a fixed panel and a leaf that slides over it. It also tagged the turntable's platter to spin. It too has run once and refuses to run again.
- `blender/tools/loose_contents.py` removed the baked glasses, plates and cutlery from the drawers and cupboards and wrote where their insides are to `web/src/prop-frames.json` (see Loose objects below). It has run once and refuses to run again.
- The pipeline never writes to either .blend file. It runs Blender on a staged copy in `/private/tmp` with factory settings, so your add-ons don't load.
- External image textures must be packed: File > External Data > Pack Resources.

## Export

```
make export-preview    # about 1 minute, low-quality lighting, good for checking changes
make export-final      # about 1 to 1.5 hours on the GPU
make export-surroundings   # about 30 seconds: only the view through the windows, nothing else changes
make export-seats          # seconds: only where visitors can sit and lie (seats.json); add VARIANT=kitchen-wall for that layout too
make export-final VARIANT=kitchen-wall   # the kitchen with its wall, as it is now (see Kitchen wall, below)
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
- `web_seat = "sit" | "lie"` on a mesh: visitors can sit on it (a sofa cushion, chair, stool or bench) or lie on it (a bed). The export finds the seat's height, which way it faces (away from its back, toward the table a stool is pulled up to, or away from the wall behind a bench; a bed's head is at its pillows) and one spot per 55 cm across it (80 cm on a bed). The model's own furniture is matched by name instead (`SEATS` in `blender/pipeline/config.py`); the toilets are left out on purpose.
- `web_screen = "tv" | "monitor" | "laptop"` on a screen mesh: it shows a generated picture when switched on. The TV's bias light is lamp group `tv` and follows the TV.
- `web_move` makes a mesh open. `"slide"` with `web_dir` (a world direction, e.g. `[1, 0, 0]`) and `web_dist` (m) for a drawer; `"hinge"` with `web_pivot` (a world point on the hinge line), `web_axis` (the hinge direction) and `web_angle` (radians, right-handed about the axis) for a door or flap; `"spin"` with `web_pivot`, `web_axis` and `web_rpm` for the turntable's platter, which turns while the record plays. On a `Door leaf`, `"slide"` makes a sliding door. Give the carcass behind it a hollow (a boolean against a hidden cutter, as the script does) so there is an inside to see.
- `web_prop = "<name>"` on a mesh makes it a loose thing visitors can pick up, carry, put down and throw (the prompt calls it by that name); the export keeps it out of the baked rooms and the collision and exports it as its own node. `web_tips = true | false` says whether it falls over when it lands hard (default: tall and narrow ones do; it must be true/false or 1/0). Long flat things (knives, tools, books) are set down lying and never tip, whatever `web_tips` says. `blender/tools/surface_props.py` tagged the flat's small things on surfaces once and refuses to run again.
- A mesh that casts no shadow (Object Properties > Visibility > Shadow off) and only uses glowing materials is a bulb or LED strip: it is exported unlit and glows with its lamp, and it never blocks the lamp inside it.
- The build-up animation is fine: the export uses the final frame.
- The view through the windows is everything in `Exterior - neighbourhood` (and its sub-collections). It is too big to lightmap, so it goes to `surroundings.glb`. The viewer lights it live with the same sun and sky as the flat (no shadows between buildings). When only the neighbourhood changed, `make export-surroundings` is enough.

## Loose objects

The glasses, mugs, plates, bowls, cutlery, spice jars, food containers, oil and wine bottles, books, glasses cases, screwdrivers and filament spools in the drawers and cupboards are made in the browser (`web/src/prop-models.ts`), not in Blender: visitors pick them up (click), put them down on any surface facing up (click where the ghost shows; the held thing's ghost shows where it'll go), throw them (hold the right button or F, longer is harder) and drop them (Q); on touch, tap to pick up and put down, and Throw and Drop buttons show while holding. Everyone in the flat sees it, and things stay where they're left until the flat empties.

- Where each drawer's or cupboard's insides are is in `web/src/prop-frames.json`, written once by `blender/tools/loose_contents.py` (which also removed the baked stand-ins there, and has run once and refuses to run again). Moving or resizing one of those drawers or cupboards in Blender means updating its entry by hand, or the objects will float or sink.
- The flat's own small things on surfaces (books, mugs, bottles and the like) are tagged `web_prop` in the model and are loose too, with the same pick up, put down and throw; they start where the model has them, and a thing modelled on another one rests on it (`web/src/surface-props.ts`).
- What goes where: `LAYOUTS` in `web/src/prop-places.ts`, one per fill. Throws, light, the hand: `CONFIG.props` (`web/src/config.ts`).

## Overrides

When the automatic choice is wrong, adjust the tables in `blender/pipeline/config.py`:

- `EXPECTED_DOOR_COUNT`: how many interactive doors the export check expects.
- `SWITCH_OVERRIDES`: move a room's light switch (`door`, `side`, and `face: outside` to put it on the other room's wall).
- `DOOR_OVERRIDES`: fix a door leaf's hinge side or swing direction (`sign` alone also works for a leaf modelled closed in its doorway, as the French doors are).
- `QUALITY`: bake resolution and samples for preview and final.
- `SURROUNDINGS_COLLECTION_PREFIXES`: which collections make the view through the windows.
- `SEATS`, `SEAT_SPACING`: which furniture visitors can sit or lie on, and how many fit.

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

## Hue scenes

The flat runs on Philips Hue, so the walkthrough has Hue's own white scenes (Bright, Read, Concentrate, Energize, Relax, Dimmed, Nightlight, and Off) in the sun panel, for the room you're in or the whole home; H steps through them. A scene sets each light's brightness and colour temperature with the bridge's own values (`bri` 1–254, `ct` in mireds; `HUE_SCENES` in `web/src/hue.ts`). The baked lamp light is dimmed and re-tinted live, relative to the colour temperature it was baked at (`CONFIG.hue.bakedKelvin`). Clicking a lamp or a switch afterwards keeps its dimmed level, and the other visitors see the scenes too.

Linking the real bridge comes later: fill in `CONFIG.hue` (the bridge's address, an app key, and each room id's Hue room) and give `main.ts` a `HueLink` that sends `applyScene(rooms, scene)` to the bridge. Until then scenes change only the walkthrough.

## Run and test

```
cd web && npm run dev      # http://localhost:5173
```

Controls: WASD to walk, Shift to walk faster, mouse to look, click to open doors, drawers and cupboards and to use switches, lamps, screens and the turntable (the TV steps through its channels, then switches off), click a sofa, chair, stool or bench to sit on it or the bed to lie on it (moving gets you up), C sits on the floor or gets you up (or, at a game board, asks first), click a chair at the chessboard, the backgammon case or the Go board on the dining table to play, L toggles the current room's light, H steps through the Hue scenes in the current room, M mutes sound, G shows who's here, `,` and `.` move the time back and forward 15 minutes (hold to keep going), Shift + `,` and `.` move the date a week, P plays the day (one hour of sun every two seconds), R turns the real sun and sky on or off, K puts the kitchen wall up or takes it down, and Esc pauses. The sun panel at the bottom left is always on screen. Press Tab to free the mouse and use it while you keep walking with WASD; press Tab again, or click the view, to look around. It also works while paused.

On phones and tablets (no mouse): drag on the left half of the screen to walk (a stick appears under your thumb; push past its ring to walk faster), drag on the right half to look around, and tap doors, switches, lamps, screens, the turntable, seats and the bed. Tap a chair at the chessboard, the backgammon case or the Go board on the dining table to play. Both thumbs work at once. The buttons at the top right open the sun panel, show who's here, toggle the room's light, mute, sit on the floor (or get up) and pause. Android goes fullscreen on start; iPhones can't. Tuning (stick size, dead zone, look speed, tap timing) is in `CONFIG.touch`. To try it on a desktop, use the browser's device toolbar with a phone selected and reload.

Handy URL options:

- `?room=friends`: meet only the people who open the same `?room=` link (see Visitors together, below). `?solo` explores alone.
- `?view=Cam_Sala&autostart`: jump to a viewpoint and skip the start screen.
- `?sun=2026-12-21T10:00`: open at that moment (Lisbon time). It combines with `?view=` and `autostart`.
- `?kitchen=wall`: open with the kitchen wall up, as it is now.
- `?debug=lightmap`: show the lighting alone, without textures.

Tests and comparisons:

```
make test-blender    # export pipeline tests
make web-test        # viewer tests
make render-refs     # Cycles reference renders in build/ref/ to compare against the viewer
```

## Kitchen wall

The model as saved is the plan: the kitchen opened up into the Sala, with the island, coffee station and pendants (collection `Kitchen - open`, and the `Kitchen opening` boolean on `Walls`). The flat as it is now has the wall, with units along it (`Kitchen - closed`). `Kitchen - shared` is in both.

The walkthrough shows either: the checkbox in the sun panel or K switches. Each is lit by its own bake, so the wall version is a second export into `web/public/assets/variants/kitchen-wall/` (`make export-final VARIANT=kitchen-wall`, as long as the main one). It shares the climate, sound and neighbourhood with the main export, and the main export leaves `variants/` alone. Switching reloads the page into the other version; where you stand, the time, and the doors, lights and screens carry over. Run both exports after changing the model, so the two stay in step.

What a variant changes is `VARIANTS` in `blender/pipeline/config.py`: the collections to show and hide, the modifiers to remove, and the floor faces to drop under the closed opening (otherwise the Cozinha's floor would still reach the Sala's under the wall, and the export would treat them as one open-plan room).

## Visitors together

People who open the walkthrough at the same time see each other as little pastel toy animals after the wooden reindeer on the sofa (a reindeer, bear, bunny or fox in its visitor's own colour, with googly eyes and a face of its own, `web/src/creatures.ts`), with the name they typed on the start screen above it (remembered per browser; blank reads "Guest"), and a "With …" line under the room name. The flat is shared: doors, drawers and cupboards, lights, screens and the turntable are in the same state for everyone, and whoever arrives later gets the flat as the others left it. The sun's date and time are not shared: they stay each visitor's own.

Whoever arrived first is the host: every browser works it out alone from the arrival time each visitor sends in its hello, earliest first and ties to the lower peer id, so all agree without a server. The arrival time is kept per room in the tab's `sessionStorage`, so a host who reloads stays host; one who closes the tab hands over to the next to have arrived. For now the host only wears a crown; the party's music, lights and TV controls will go to the host. G (or a click on the "With …" line with the mouse free, or the people button on touch) opens "Who's here": everyone in arrival order with their animal's colour, a 👑 on the host, the room they're in and 🔊 while they talk. The design note is `docs/superpowers/specs/2026-10-28-party-host-guest-list-design.md`.

There is no server. The browsers connect to each other with WebRTC through [Trystero](https://github.com/dmotz/trystero), which finds the other visitors through public Nostr relays. Everyone on the site shares one room by default; `?room=<name>` gives a group a room of their own, and `?solo` stays alone. Trystero loads only after the start click, and if it can't load or a network blocks WebRTC, the walkthrough carries on alone (a warning in the console). Visitors whose networks block a direct connection (strict NAT, mobile carriers, some offices) are relayed through Cloudflare's TURN service, once it is set up (see Deploy); without it they explore alone. It connects everyone to everyone, so it suits a handful of people, not a crowd. Reference renders (`?autostart`) never join.

Visitors can talk. The start screen's "Talk with your voice" checkbox (on by default, remembered) asks for the mic on the start click; without it, or if the mic is refused, they still hear the others. A voice comes from its animal's mouth, quieter with distance and muffled by walls and closed doors, and the animal's mouth moves with it; the "With …" line marks whoever is talking. V turns the mic off and on (a mic button on touch), M mutes everyone's voices with the other sounds, and pausing turns the mic off. Everyone's mic goes to everyone, so it suits a handful of people. Headphones are recommended: on speakers, the others may hear themselves echoed back. Tuning is in `CONFIG.multiplayer.voice`; the design note is `docs/superpowers/specs/2026-10-27-proximity-voice-design.md`.

Visitors sit and lie down where the others can see it: on a sofa, chair, stool or bench their animal sits leaning back with its legs out in front, swinging its front ones; on the bed it lies on its back, head on the pillows and feet in the air; C sits it on the floor. A seat someone is on is taken ("Someone is here"); a sofa cushion seats two and the bed sleeps two. Getting up puts you a step in front of the seat. Visitors still on a version from before seats see a seated visitor standing where they last stood. Eye heights, the lying view and timing are in `CONFIG.seats`, and the animals' sitting and lying in `avatars.ts`.

Two visitors can play chess at the dining table. The board stands between the two chairs at the table's end; the chair on the window side plays white. Sitting in one opens a panel with the board, your side at the bottom (the mouse is freed, as with Tab): click a piece to see where it can go, then a square to move it there; a pawn reaching the last rank asks what it becomes. Resign and Offer draw work on your move (an offer lapses when the other player moves instead of accepting). A game starts when both chairs are taken and ends by its rules (checkmate, stalemate, threefold repetition, the 50-move rule, insufficient material), by a resignation or an agreed draw, or when a player leaves the chair, which loses it; a closed or timed-out tab leaves it too. While the panel is open the movement keys don't move you: Stand up (or C) asks "Stand up and resign?" during a game. The final position stays on the table until the next game; to play the same person again, one of you stands up and sits back down. Everyone else sees the game on the table in 3D as it's played, and whoever arrives later gets it with the flat's state. There is still no server: every browser checks the moves with [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause), each change sends the whole game in a `game` message, and every browser works out a player leaving from the empty chair. Visitors on an older version see the players sitting but no board. Tuning (where the boards stand, the table's height, the slide, the colours) is in `CONFIG.games`; the design note is `docs/superpowers/specs/2026-10-28-dining-table-games-design.md`.

Backgammon is played at the middle pair of chairs, in a small travel case between the fruit bowl and the books; the window side plays white again. The panel shows the board from your chair, with a Roll button, the dice (used ones faded) and both pip counts. White presses Roll for the opening, one die each (a tie is rolled again), and the higher die starts, playing both dice. On your turn press Roll, then click a checker (or the bar) and one of the marked points (or the tray, to bear off), one die at a time: doubles give four moves, checkers on the bar enter first, a point with two of the other side's checkers is blocked and a single one is hit, you must use both dice if you can (the larger if only one fits), and the turn passes by itself when the dice are used up or none can be. A game ends when a side has borne off all 15, as a single game, a gammon (the loser has borne off none) or a backgammon (the loser still has a checker on the bar or in the winner's home board); there is no doubling cube. Resigning, standing up and leaving work as in chess. The rules are our own (`web/src/backgammon-game.ts`); dice are rolled in the roller's browser, which is fine among friends.

Go is played on a 9×9 board at the third pair of chairs, on the table's rounded end right of the runner; the window side plays white, so black, across the table, moves first. The panel shows the board from your chair: on your move the points you may play show a faint stone under the pointer, and a click places yours there; Pass gives up your move. Stones left without liberties are captured, a stone may not take its own last liberty unless it captures, and a ko can't be retaken straight away. The line under the board counts the prisoners each side has taken and says when the other player passed. Two passes in a row end the game, counted by area: each side's stones plus the empty points only its stones surround, and 7 komi for white. Stones count as they stand, so capture dead stones before you pass. The result reads like "White wins by 4", with the count under it; an equal score is a draw. Resigning, standing up and leaving work as in chess. The rules are our own (`web/src/go-game.ts`); a game's moves are written as points, `D4`, with the columns A to J skipping I.

Tuning is in `CONFIG.multiplayer` (`web/src/config.ts`): the room, how often poses are sent, how long a silent visitor stays, the colours, and the creatures' size, walk, bounce, googly eyes, blinking and how they dim with the room's light. The design note is `docs/superpowers/specs/2026-10-25-multiplayer-design.md`.

## Deploy

The repo is self-contained: the exported assets in `web/public/assets/` (about 36 MB) and the source `Untitled.blend` are committed, so a host can build straight from GitHub.

**Vercel:** import the GitHub repo and set **Root Directory** to `web` (Vercel usually suggests it). `web/vercel.json` installs with `npm ci`, builds, and serves `dist/`. Leave the other build settings alone. Every push to `main` redeploys.

**TURN for multiplayer (optional):** in the Cloudflare dashboard, under Realtime → TURN Server, create a TURN key (the free tier covers 1,000 GB a month), and add its key ID and API token to the Vercel project's environment variables as `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN`, then redeploy. `web/api/turn.ts` (a Vercel function) hands each visitor credentials that expire after a day, so the token never reaches the browser. Without the variables, `/api/turn` answers an empty list and visitors connect directly only. Only connections that can't be made directly go through TURN; they stay end-to-end encrypted. Local `npm run dev` has no `/api`, so it never uses TURN.

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
- Visitors together see each other whichever kitchen they chose, so with the wall up, someone in the open plan walks through it.
- The bounce fill is a flat approximation: rooms without exterior glass of their own (e.g. the kitchen, lit through the glazed doors) get none and read darker than Cycles.
