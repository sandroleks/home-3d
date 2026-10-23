# Sun Simulation — Design

**Date:** 2026-10-23
**Status:** Implemented

## Goal

Light the walkthrough with the real sun for any date and time. Sunlight should enter each window exactly as it does at the real flat. Each season should have its typical weather: weaker, hazier sun in winter and strong sun in summer. Visitors pick the date and time on the pause screen, or nudge them with keys while walking.

## Scope

**In:**
- The real site: coordinates, compass orientation and the corrected position of the neighbourhood.
- Sun position from astronomical formulas.
- A typical day for each month, from open data (PVGIS and Open-Meteo).
- A live sun with real-time shadows from the apartment, the building itself and nearby neighbours.
- An approximate bounce fill per room.
- Sky brightness and colour that follow the sun, from day through sunset to night.
- The neighbourhood seen through the windows, lit by the same sun.
- The sun panel on the pause screen, keys while walking, a HUD readout and the `?sun=` URL option.

**Out:**
- Weather for a specific day in the past, and runtime network calls.
- Visible clouds, a sun disc, the moon and stars.
- Street lights.
- Neighbours shadowing each other in the view through the windows.
- Baked sun-bounce layers. That was option C; it can be added later on top of this design.
- Phones and tablets, which remain unsupported.

## Site

Measured by matching the model's neighbourhood against OpenStreetMap building outlines (Microsoft Building Footprints): 99% of the model's ground-level walls within 300 m lie on an OSM outline. The user confirmed the apartment's position on satellite imagery.

- Building: Rua do Sobreiro, Vila Nova de Gaia. The flat is on the top floor, on the south-east facade, with its balcony end at the bend where the south facade begins.
- Model origin (Blender 0, 0, 0) after the fix below: **latitude 41.117327, longitude −8.653914**.
- Blender +Y (the bedroom and balcony side) points to a **compass bearing of 142.1°**, and +X to 232.1°. The estimated error is under 1°.
- Time zone: **Europe/Lisbon**.
- Terrain: the PVGIS horizon is 3.1° or less in every direction, so hills are ignored and only buildings block the sun.
- The apartment floor sits 7.5 m above the street (the neighbourhood's ground is at z = −7.5), which matches the top floor. It needs no change.

These values live in `blender/pipeline/config.py` as `SITE = {"lat": ..., "lon": ..., "timeZone": "Europe/Lisbon", "yBearing": 142.1}`. The pipeline writes them to `manifest.json` as `site`.

### Fixing the neighbourhood's position

The model places the apartment 7.44 m too far north-east along the facade. Fix it in the source .blend (`~/Documents/Untitled.blend`), in the user's own Blender session. Either the Blender connection makes the change or the user does, from these numbers. A Blender launched by Claude must never open `~/Documents` (see the Makefile). Once done, the file is copied into the project as usual.

- Move every object in `Exterior - neighbourhood` and its sub-collections by **−7.44 m along Blender X**, except the four `Building lower facade N/S/E/W` walls. Those sit directly under the apartment and stay where they are.
- `Exterior block brick` is the rest of the building at the apartment's level, with a gap where the apartment sits. Rebuild it so that its outline moves with the neighbourhood while the gap stays at x −3.6…3.6:
  - The piece on the −X side gets a front from x −3.6 to −13.91 and keeps its end wall and back. Its old x values all shift by −7.44.
  - The piece on the +X side starts at the bend (3.6, 9.09) and runs along the south facade to (30.79, −6.38), then (29.46, −8.71), then back along y = −8.72 to (3.6, −8.72).
- Check: the balcony edge (x 0.3…3.1, y 9.1) now ends at the corner where the south facade begins.

## Sun position

New module `web/src/sun.ts`, pure and unit-tested:

- **`solarPosition(utcMillis, lat, lon)`** returns `{ azimuth, elevation }` in degrees. Azimuth is a compass bearing, clockwise from north. It uses the NOAA solar-position equations (after Meeus) with the usual atmospheric refraction correction, and is accurate to a few hundredths of a degree for 1900–2100.
- **`lisbonToUtc(dateParts)` and `utcToLisbon(ms)`** convert between Lisbon local time and UTC, using `Intl.DateTimeFormat` with `timeZone: 'Europe/Lisbon'`. Summer time comes from the browser's time-zone database, not hand-written rules.
- **`sunVector(azimuth, elevation, yBearing)`** converts to a three.js direction. A compass bearing B maps to Blender components `(sin(B − yBearing), cos(B − yBearing))`. Blender (x, y, z) maps to three.js (x, z, −y), so the direction to the sun is:
  - x = `sin(Az − yB)·cos(El)`
  - y = `sin(El)`
  - z = `−cos(Az − yB)·cos(El)`
- **`sunTimes(date, lat, lon)`** returns sunrise and sunset in Lisbon time, used for the marks on the time slider.

## Climate data (typical month)

A one-off script, `web/scripts/fetch-climate.mjs` (Node, no dependencies), writes `web/public/assets/climate.json`. The file is committed. A new `web/public/assets/DATA-SOURCES.md` lists both sources with their URLs, query parameters, fetch date and licence (PVGIS: © European Union, free reuse with attribution; Open-Meteo: CC BY 4.0).

- **PVGIS 5.3 daily profiles** (`DRcalc`, `month=0`, `global=1`, `clearsky=1`, horizontal plane) at the site. Each month gets an average day of 24 hourly values: beam `Gb`, diffuse `Gd` and clear-sky `Gcs` irradiance in W/m². These are SARAH3 data averaged over 2005–2023. The times are UTC.
- **Open-Meteo archive** (`daily=sunshine_duration,cloud_cover_mean`, 2015–2024, `timezone=Europe/Lisbon`), averaged per month. It is kept in the data file for reference but not shown: Open-Meteo overstates Porto sunshine (12.9 h in June against about 10 h observed). The readout uses the PVGIS figures instead, for example "typical June: 78% of clear-sky sunlight" (the month's sum of beam + diffuse over the sum of clear-sky global, whole percent).
- Format:

  ```
  { "source": {...}, "months": [{ "month": 1, "hours": [{ "utcHour": 0.5, "gb": 0, "gd": 0, "gcs": 0 }, ...], "sunshineHours": 4.9, "cloudCover": 58 }, ...] }
  ```

  `source` holds the request URLs and fetch date. `hours` has 24 entries per month, in UTC.

New module `web/src/climate.ts`, pure and unit-tested:

- **`typicalIrradiance(climate, utcMillis)`** returns `{ beam, diffuse }` in W/m² on a horizontal surface. It interpolates linearly between hours, and between the middles of neighbouring months.
- **`sunStrength(beam, elevation)`** returns the direct-normal irradiance, `beam / sin(elevation)`. Elevation is clamped to at least 3° to avoid dividing by near-zero. The result is 0 when the sun is below the horizon.
- **One exposure constant, `WATTS_TO_SCENE = 32 / 900`,** converts real W/m² into the scene's light units. It lives in `blender/pipeline/config.py` and reaches the viewer as `manifest.sky.wattsToScene`, so the viewer and the Cycles reference renders share it. The original 4/900 (900 W/m² of direct sun equal to the old Blender sun lamp, strength 4) was calibrated against Cycles references and came out 8× too dark, so the scale is now 8× that. Further calibration: `CONFIG.sun.skyGain` = 0.38 scales the baked sky layer, because the bake world shines from below the horizon too and the baked scene has no ground (Cycles references render the full .blend, where ground and neighbours block that light); the proper fix is a horizon in the bake world, then a re-bake and re-fit. `CONFIG.sun.bounce` = 0.04 and `CONFIG.envIntensity` = 0.0015.
- **`skyScale(diffuse)`** = `diffuse × wattsToScene / manifest.sky.irradiance`, where `sky.irradiance` is the irradiance that the baked sky delivers to an upward-facing surface, in scene units. The pipeline works it out from the world's background colour and strength and writes it to the manifest.
- **Twilight:** PVGIS returns 0 at night. Between sunset and the end of civil twilight (sun 6° below the horizon), the sky keeps a small floor that fades out: 2% of the day's maximum `Gd`, falling to 0. That keeps dusk from cutting to black.

## Lighting

### Pipeline (bake) changes

- **The day layer becomes sky-only.** `Lighting.day()` hides every sun lamp, every ceiling light and every other lamp, and sets all emission strengths to 0. Only the world background and the `Portal …` window fill lights stay (they are ordinary area lights at the windows). The world's Sky Texture has its own sun built in, so for this bake the world colour is a flat sky colour (`SKY_BAKE_COLOR`) at the world's own strength, which gives a known sky irradiance. The layer's name and files are unchanged (`<chunk>_day.webp`); the manifest records that the layer is sky-only.
- **Each room's light layer gains that room's lamps and glowing materials.** Today they are baked into the day layer, so they glow at noon. A new step, `lamps.room_lamps(scene, floor_index)`, assigns each render-visible lamp other than a sun to the room whose floor polygon contains it. It does the same for each object with an emissive material, using the object's bounding-box centre. `Lighting.room(id)` then turns on that room's ceiling light, its lamps and its emitters.
  - Emissive materials shared between rooms are duplicated per object on the staged copy, so their emission can be switched per room.
  - Lamps outside every room (none expected) are reported by the export checks.
- **The bake count is unchanged:** one day bake and one light bake per chunk. `make export-final` still takes about 35 minutes.
- **The manifest gains these fields** and becomes **version 2**, so a stale manifest fails loudly:
  - `site`, as described above;
  - `sky: { irradiance }`;
  - `windows`: each exterior glass pane as `{ room, center, normal, width, height }` in three.js space, read from the `… glass` objects of openings whose name includes `Exterior`;
  - for each room, its floor area.
- **The neighbourhood export (`surroundings.py`) stops baking the sun into vertex colours.** It exports the meshes with their normals and drops the `Shade` attribute and `SHADE_STORE_SCALE`. `SURROUNDINGS_SKY_IRRADIANCE` goes away: the viewer lights the neighbourhood with the typical diffuse light × `wattsToScene`.
- **The scene's `Sun` lamp stays in the .blend.** The bake ignores it. `make render-refs SUN=…` uses it (see Testing).

### Viewer

New module `web/src/daylight.ts`, which owns everything that changes with the date and time:

- **Sun lamp:** a `DirectionalLight`. Its direction comes from `sunVector`, its intensity from `sunStrength(beam, el) × wattsToScene`, and its colour from elevation. It is white above 30°, warms toward roughly 2500 K at the horizon, and fades out by −0.5°.
- **Shadows** (`PCFSoftShadowMap`):
  - A single 4096 × 4096 shadow map. Its orthographic frustum fits the apartment's bounds plus a 1 m margin, so texels are about 6 mm.
  - The frustum's near plane is pulled back **200 m toward the sun**. That way the building itself and every neighbour within 200 m cast into the same map; a 10 m building's shadow at 3° elevation reaches about 190 m.
  - Apartment meshes cast and receive shadows, except glass. Doors cast, and their shadows move as they swing.
  - Neighbourhood meshes within 200 m of the apartment are cloned as shadow-only casters into the apartment scene, on a layer that only the shadow camera renders. They never draw in the main pass.
  - `renderer.shadowMap.autoUpdate = false`. The map is redrawn only when the sun moves or a door moves.
- **Bounce fill:** each frame (or only when something changes), the viewer estimates how much sunlight enters each room through its exterior windows.
  - For each pane: `area × max(0, n·s) × sunStrength × visible`. `visible` is the fraction of 5 sample points on the pane whose ray toward the sun is not blocked. The rays use the BVH that is already in place (`three-mesh-bvh`), against the apartment and the shadow-only casters.
  - The room's fill is `CONFIG.bounce × entering / roomFloorArea × wattsToScene`. It is added as a flat irradiance term to that room's chunks through a new lightmap uniform, `lmFill`. The light falls only on the sunlit room; rooms without exterior glass get no fill.
  - `CONFIG.bounce` is tuned against Cycles references.
- **Sky light:** a new shared uniform, `lmSkyScale`, multiplies the baked day layer by `skyScale(diffuse)`. The room-light layer is unaffected.
- **Sky colour:** the background of the view through the windows blends from day blue (`CONFIG.skyColor`) through a sunset band (sun between 6° and −2°, toward peach and orange near the horizon) to night navy (`#0d1424`) once the sun is 6° below. It is a flat colour, as today.
- **Environment reflections:** `scene.environmentIntensity` scales with the sky, so reflections dim at night.
- **View through the windows:** `prepareSurroundings` swaps in a small `ShaderMaterial` per mesh:
  - colour × texture × (`sky` uniform × (1 + n.y)/2 + `sun` uniform × max(0, n·s)) / π;
  - the same formula as `surroundings.py` today, but with live uniforms;
  - unlit otherwise, with no shadows (as today); the ground layers keep their polygon offsets.
- **Night:** if the walkthrough opens with the sun more than 6° below the horizon, the spawn room's light (`entrada`) starts on. Everything else behaves as by day.

`web/src/lightmaps.ts`: the patched shader gains `lmSkyScale`, shared by all chunks, and `lmFill` (a vec3), one per room. The accumulation becomes `(day × lmSkyScale + intensity × light) × lmScale + lmFill`.

## Controls

### Time state

New module `web/src/sun-clock.ts`, pure and unit-tested. It holds the current moment as a UTC millisecond count and handles:

- **Start:** `?sun=YYYY-MM-DDTHH:MM`, read as Lisbon time, if the option is present and valid; otherwise the current time.
- **Nudges:** `nudgeTime(±15 min)` and `nudgeDate(±7 days)`, which keep the Lisbon clock time when the date moves across a summer-time switch.
- **Absolute settings:** `setDayOfYear(n)` and `setMinutes(m)`.
- **`now()`.**
- **Play and pause:** while playing, `tick(dt)` advances 1 hour of sun every 2 seconds (`CONFIG.sun.playRate`), running through night as well.
- **A change counter,** so the shadow map, fill and readout update only when the moment has changed.

### Pause-screen panel

The pause overlay gains a sun panel. Clicks inside the panel don't resume the walkthrough; clicks outside it, or on **Keep exploring**, do.

- **Date:** a slider over the days of the year, labelled Jan–Dec, plus four buttons: **Winter solstice** (21 Dec), **Spring equinox** (20 Mar), **Summer solstice** (21 Jun) and **Autumn equinox** (22 Sep). The year is the current one.
- **Time:** a slider from 00:00 to 24:00 in 5-minute steps, with sunrise and sunset marked for the chosen date.
- **Now**, **Play / Pause**, and **Keep exploring**.
- **Readout:** for example `21 Jun · 18:30 · Sun 24° high, west-north-west · typical June: 78% of clear-sky sunlight`. Below the horizon it reads `Sun below the horizon` instead.
- The panel follows the existing overlay style (`style.css` variables, rounded accent buttons) and fits within 16 px side margins down to 768 px wide.

### Keys while walking

These are physical keys (`e.code`), so they work on Portuguese and other layouts:

| Key | Action |
|---|---|
| `Comma` / `Period` | time −15 / +15 min; holding repeats |
| `Shift` + `Comma` / `Period` | date −7 / +7 days |
| `P` | start or stop the time-lapse |

Like `L` and `M`, they are ignored before starting and while paused. The start screen's controls list gains `, .` (change the time), `Shift + , .` (change the date) and `P` (play the day).

### HUD

A small date-and-time label (`21 Jun · 18:30`) sits in the bottom-right corner, above the mute icon. It brightens for about 1.5 s after each change.

## Files

| File | Change |
|---|---|
| `blender/pipeline/config.py` | `SITE` |
| `blender/pipeline/lamps.py` (new) | lamp and emitter → room assignment |
| `blender/pipeline/bake.py` | sky-only day layer; room layers include the room's lamps and emitters |
| `blender/pipeline/manifest.py` | version 2: `site`, `sky`, `windows`, room floor areas; validation |
| `blender/pipeline/surroundings.py` | export normals, no baked shade |
| `blender/pipeline/checks.py` | lamps outside every room; exterior windows present |
| `Makefile` | `render-refs SUN=<Lisbon time>` points the `Sun` lamp from the site constants |
| `web/src/sun.ts`, `climate.ts`, `sun-clock.ts` (new) | pure logic |
| `web/src/daylight.ts` (new) | sun lamp, shadows, casters, fill, sky |
| `web/src/lightmaps.ts` | `lmSkyScale`, `lmFill` |
| `web/src/surroundings.ts` | live sun-and-sky shader |
| `web/src/manifest.ts` | parse version 2 |
| `web/src/ui.ts`, `index.html`, `style.css` | panel, HUD readout, controls list |
| `web/src/main.ts` | wiring: clock, keys, panel, daylight update, night start |
| `web/src/config.ts` | `sun: { playRate, nudgeMinutes, nudgeDays, shadowMapSize, shadowReach, shadowBias, shadowNormalBias, bounce, warmColor, sunsetSky, nightSky }`; `surroundingsShadeScale` removed |
| `web/scripts/fetch-climate.mjs` (new) | builds `climate.json` |
| `web/public/assets/climate.json` (new) | typical month data |
| `web/public/assets/DATA-SOURCES.md` (new) | climate data sources and licences |
| `README.md` | sun controls, `?sun=`, refreshing the climate data, `render-refs SUN=` |

## Testing

**Viewer unit tests (Vitest):**
- `sun.test.ts`:
  - NREL SPA's published test case: 17 Oct 2003 12:30:30, UTC−7, latitude 39.742476, longitude −105.1786. Expected zenith 50.11162° and azimuth 194.34024°, within 0.05°.
  - Porto noon elevations: 72.3° at the June solstice, 25.4° at the December solstice, within 0.2°.
  - `lisbonToUtc` on both summer-time switch days of 2026 (29 Mar and 25 Oct).
  - `sunVector`: the sun due along +Y gives three.js −Z.
- `climate.test.ts`: interpolation between hours and months, night gives 0, the elevation clamp, the twilight floor, and `skyScale`.
- `sun-clock.test.ts`: `?sun=` parsing (valid, invalid, missing), nudges across a summer-time switch, and play ticks.
- Panel, keys and readout text: extending `ui.test.ts`, as for the existing overlay tests.
- `manifest.test.ts`: version 2 fields, and rejecting version 1.

**Pipeline tests (`make test-blender`):**
- On the fixture scene, the day layer has the sun, ceiling lights and lamps hidden, with emission at 0.
- A room's light layer includes its lamp and emitter, and only its own.
- Lamp-to-room assignment.
- The manifest's `site`, `sky.irradiance` and `windows`.
- The neighbourhood export includes normals and no `Shade` attribute.

**Comparison with Cycles:**
- `make render-refs SUN=2026-12-21T10:00` (and similar) points the `Sun` lamp from the site constants and the NOAA position, using a small Python port of the same equations in the pipeline, tested against the same NREL case.
- The sun's strength comes from the same typical-month data: the Python side reads `climate.json`.
- Compare Cam_Bedroom on a winter morning and Cam_Sala on a summer evening with the viewer at the same `?sun=`. Sun patches must land in the same place. `CONFIG.sun.bounce` is tuned on these renders; `WATTS_TO_SCENE` only changes if every view is off by the same factor.

**In the browser:**
- Open the site and check that it starts at the current Porto time.
- Esc → move the panel's sliders and press the buttons → resume.
- Use `,` `.`, `Shift`, and `P`.
- Check that the shadows from the balcony overhang and the window frames move.
- Scrub through sunset and check that the sky and the view through the windows darken.
- Load at night and check that the entrance light is on.
- The console must show no errors, and the frame rate must stay smooth while walking (the shadow map isn't redrawn).

**Real-world check (optional, from the user):** one or two observations from the actual flat, such as when the sun first reaches the bedroom floor in December. Set the same moment with `?sun=` and confirm it matches.

## Risks

- **The bounce fill is approximate.** Sunny rooms will look flatter than in Cycles. Option C (baked bounce layers) is the follow-up if that bothers the user.
- **The 4096 shadow map** costs about 64 MB of GPU memory. If a target machine struggles, fall back to 2048, with 12 mm texels.
- **Microsoft Building Footprints** sometimes simplify outlines. Bearing errors of 1–2° remain possible; the real-world check catches anything larger.
