# Sun Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light the walkthrough with the real sun at the real flat (Rua do Sobreiro, Vila Nova de Gaia) for any date and time, using a typical day per month from open data.

**Architecture:**
- The Blender pipeline bakes a sky-only day layer. Each room's light layer now holds the room's lamps and glowing materials too.
- `manifest.json` (version 2) carries the site, the baked sky's irradiance and the exterior windows.
- In the viewer, pure modules work out the sun's position (NOAA equations), Lisbon time, the typical irradiance (from PVGIS and Open-Meteo data in `climate.json`) and the time state.
- A `Daylight` class drives one shadow-casting `DirectionalLight`, a shared sky-scale uniform, per-room bounce fills, the sky colour and a live sun-and-sky shader for the neighbourhood.
- A sun panel on the pause screen, plus keys while walking, set the moment.

**Tech Stack:** TypeScript, three.js 0.170, three-mesh-bvh 0.8, Vite and Vitest (node environment, no DOM). Blender 5.1 Python with numpy and unittest. Node 22 for the one-off climate fetch.

**Spec:** `docs/superpowers/specs/2026-10-23-sun-simulation-design.md`

## Global Constraints

- No new npm or Python dependencies.
- A Blender launched by Claude must never open anything under `~/Documents`. Always go through the Makefile, which stages files in `/private/tmp/apartment-walkthrough-blender`. The one exception is the user's own running Blender session, through the Blender MCP tools (Task 9).
- The pipeline never writes to a source `.blend`.
- Site: latitude **41.117327**, longitude **−8.653914**, time zone **Europe/Lisbon**, Blender +Y at compass bearing **142.1°**.
- Neighbourhood fix: move by **−7.44 m along Blender X**, except `Building lower facade N/S/E/W`. `Exterior block brick` keeps its gap at x −3.6…3.6.
- Real W/m² × **4/900** = scene light units (`WATTS_TO_SCENE`).
- Twilight: the sky has a floor of **2%** of the month's peak diffuse light, fading to 0 by **−6°**. The sun's elevation is clamped to at least **3°** for direct-normal irradiance.
- Time-lapse: **1 hour of sun per 2 s**. Keys: `Comma` / `Period` move the time **±15 min**; with `Shift` they move the date **±7 days**; `KeyP` plays or pauses. Use physical `e.code`.
- `?sun=YYYY-MM-DDTHH:MM` is read in Lisbon time.
- Shadows: one **4096²** map, reaching **200 m** toward the sun. The map is redrawn only when the sun or a door moves.
- Night start: if the sun is more than **6°** below the horizon when the page opens, the spawn room's light starts on.
- Manifest **version 2**. The viewer rejects version 1.
- Deliberate differences from the spec, both found while planning:
  - `WATTS_TO_SCENE` has a single home in `blender/pipeline/config.py`. It reaches the viewer as `manifest.sky.wattsToScene`, so the viewer and the Cycles reference renders can't drift apart.
  - The real world's colour comes from a Sky Texture, which has its own sun built in. The day bake therefore swaps it for a flat `SKY_BAKE_COLOR` sky, whose irradiance is known exactly.
  - `SURROUNDINGS_SKY_IRRADIANCE` goes away: the neighbourhood's sky light is now the real typical diffuse light × `wattsToScene`.
  - The `Portal …` area lights in the model are ordinary area lights placed at windows, not Cycles portals. They stay in the sky layer as window fill.
- Commit messages follow the repo's style (`Area: what changed`) and end with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- Run viewer tests with `cd web && npm test` (`npm ci` first if `web/node_modules` is missing). Run pipeline tests with `make test-blender` (optionally `TESTS=test_lamps.py`).

## File map

| File | Responsibility |
|---|---|
| `web/src/sun.ts` (new) | Solar position, local time ↔ UTC, sun direction in three.js space, sunrise and sunset |
| `web/src/climate.ts` (new) | Parse `climate.json`; typical beam and diffuse irradiance; direct-normal strength; twilight; sky scale |
| `web/src/sun-clock.ts` (new) | The current moment; nudges, play, `?sun=`; key mapping; readout formatting |
| `web/src/daylight.ts` (new) | Sun lamp, shadows, shadow-only casters, bounce fills, sky colour and environment |
| `web/src/lightmaps.ts` | `lmSkyScale` and `lmFill` uniforms |
| `web/src/scene-setup.ts` | Glass casts and receives no shadow; everything else does |
| `web/src/world.ts` | Shared sky uniform, per-room fills, glows that follow the room light, occluders, `root` |
| `web/src/surroundings.ts` | Live sun-and-sky shader; sky colour setter |
| `web/src/manifest.ts`, `loader.ts` | Version 2 fields; load `climate.json` |
| `web/src/ui.ts`, `index.html`, `style.css` | Sun panel, HUD clock, controls list |
| `web/src/main.ts` | Wiring |
| `web/src/config.ts` | `sun` settings |
| `web/scripts/fetch-climate.mjs` (new) | Builds `climate.json` |
| `web/public/assets/climate.json`, `DATA-SOURCES.md` (new) | Data and credits |
| `blender/pipeline/config.py` | `SITE`, `WATTS_TO_SCENE`, `SKY_BAKE_COLOR`, `DAY_FILL_LIGHT_PREFIX`, `LAMP_ROOM_MAX_DIST` |
| `blender/pipeline/lamps.py` (new) | Lamp → room assignment; per-room copies of glowing materials |
| `blender/pipeline/windows.py` (new) | Exterior glass panes → manifest windows |
| `blender/pipeline/sun.py` (new) | Python port of the sun position and typical irradiance (for reference renders) |
| `blender/pipeline/bake.py` | Sky-only day layer; room layers with lamps and emitters; `sky_irradiance` |
| `blender/pipeline/run.py` | Wiring of lamps, emitters, windows and sky irradiance into the state |
| `blender/pipeline/manifest.py`, `checks.py` | Version 2; lamp and window checks |
| `blender/pipeline/surroundings.py` | Export normals, no baked shade |
| `blender/render_refs.py` (new) | Cycles reference renders, optionally lit by the real sun at a given moment |
| `blender/tools/fix_neighbourhood.py` (new) | One-off fix to run in the user's Blender |
| `Makefile` | `render-refs SUN=…`; exports no longer delete `audio/`, `climate.json` or `DATA-SOURCES.md` |
| `README.md` | Docs |

**Order:**
- Tasks 1–3 are pure viewer modules.
- Tasks 4–8 change the pipeline.
- Task 9 fixes the source `.blend` with the user and makes a preview export, so Tasks 10–14 can be checked in the browser.
- Task 15 is the final export, calibration and docs.
- From Task 10 until Task 9's preview export exists, the dev server can't load the committed (version 1) manifest. That's expected.

---

### Task 1: Sun position and local time (`web/src/sun.ts`)

**Files:**
- Create: `web/src/sun.ts`
- Test: `web/tests/sun.test.ts`

**Interfaces:**
- Produces:
  - `interface SunPosition { azimuth: number; elevation: number }`
  - `interface LocalDate { year; month; day }`
  - `interface LocalTime extends LocalDate { hour; minute }`
  - `solarPosition(utcMillis, lat, lon): SunPosition`
  - `toLocal(utcMillis, tz): LocalTime`
  - `zoneOffset(utcMillis, tz): number` (ms)
  - `fromLocal(t: LocalTime, tz): number` (UTC ms)
  - `sunVector(sun: SunPosition, yBearing): [number, number, number]`
  - `sunTimes(date: LocalDate, lat, lon, tz): { sunrise: number | null; sunset: number | null }` (minutes after local midnight)

- [ ] **Step 1: Write the failing test** — `web/tests/sun.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fromLocal, solarPosition, sunTimes, sunVector, toLocal, zoneOffset } from '../src/sun';

const LAT = 41.117327;
const LON = -8.653914;
const TZ = 'Europe/Lisbon';

function maxElevation(year: number, month: number, day: number): number {
  const start = fromLocal({ year, month, day, hour: 0, minute: 0 }, TZ);
  let best = -90;
  for (let m = 0; m < 1440; m++) best = Math.max(best, solarPosition(start + m * 60000, LAT, LON).elevation);
  return best;
}

describe('solarPosition', () => {
  it('matches the NREL SPA reference case (17 Oct 2003 12:30:30 UTC-7, Golden CO)', () => {
    const p = solarPosition(Date.UTC(2003, 9, 17, 19, 30, 30), 39.742476, -105.1786);
    expect(Math.abs(90 - p.elevation - 50.11162)).toBeLessThan(0.05);
    expect(Math.abs(p.azimuth - 194.34024)).toBeLessThan(0.05);
  });

  it('gives the flat its solstice noon heights', () => {
    expect(Math.abs(maxElevation(2026, 6, 21) - 72.33)).toBeLessThan(0.05);
    expect(Math.abs(maxElevation(2026, 12, 21) - 25.48)).toBeLessThan(0.05);
  });

  it('puts a winter morning sun in the south-east and a summer evening sun in the west-north-west', () => {
    const morning = solarPosition(fromLocal({ year: 2026, month: 12, day: 21, hour: 9, minute: 0 }, TZ), LAT, LON);
    expect(morning.azimuth).toBeGreaterThan(125);
    expect(morning.azimuth).toBeLessThan(140);
    const evening = solarPosition(fromLocal({ year: 2026, month: 6, day: 21, hour: 20, minute: 0 }, TZ), LAT, LON);
    expect(evening.azimuth).toBeGreaterThan(285);
    expect(evening.azimuth).toBeLessThan(298);
  });
});

describe('Lisbon time', () => {
  it('handles both 2026 summer-time switches', () => {
    expect(fromLocal({ year: 2026, month: 3, day: 28, hour: 12, minute: 0 }, TZ)).toBe(Date.UTC(2026, 2, 28, 12));
    expect(fromLocal({ year: 2026, month: 3, day: 29, hour: 12, minute: 0 }, TZ)).toBe(Date.UTC(2026, 2, 29, 11));
    expect(fromLocal({ year: 2026, month: 10, day: 24, hour: 12, minute: 0 }, TZ)).toBe(Date.UTC(2026, 9, 24, 11));
    expect(fromLocal({ year: 2026, month: 10, day: 25, hour: 12, minute: 0 }, TZ)).toBe(Date.UTC(2026, 9, 25, 12));
  });

  it('round-trips and reports the offset', () => {
    const t = Date.UTC(2026, 6, 1, 17, 45);
    expect(toLocal(t, TZ)).toEqual({ year: 2026, month: 7, day: 1, hour: 18, minute: 45 });
    expect(zoneOffset(t, TZ)).toBe(3600000);
    expect(zoneOffset(Date.UTC(2026, 0, 1), TZ)).toBe(0);
  });
});

describe('sunVector', () => {
  it('maps the bearing of Blender +Y to three.js -Z, and +Y + 90 degrees to +X', () => {
    const [x, y, z] = sunVector({ azimuth: 142.1, elevation: 0 }, 142.1);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
    expect(sunVector({ azimuth: 232.1, elevation: 0 }, 142.1)[0]).toBeCloseTo(1);
    expect(sunVector({ azimuth: 10, elevation: 90 }, 142.1)[1]).toBeCloseTo(1);
  });
});

describe('sunTimes', () => {
  it('finds Porto sunrise and sunset (06:03 / 21:11 in June, 07:58 / 17:09 in December)', () => {
    const june = sunTimes({ year: 2026, month: 6, day: 21 }, LAT, LON, TZ);
    expect(june.sunrise!).toBeGreaterThanOrEqual(6 * 60);
    expect(june.sunrise!).toBeLessThanOrEqual(6 * 60 + 6);
    expect(june.sunset!).toBeGreaterThanOrEqual(21 * 60 + 8);
    expect(june.sunset!).toBeLessThanOrEqual(21 * 60 + 14);
    const dec = sunTimes({ year: 2026, month: 12, day: 21 }, LAT, LON, TZ);
    expect(dec.sunrise!).toBeGreaterThanOrEqual(7 * 60 + 55);
    expect(dec.sunrise!).toBeLessThanOrEqual(8 * 60 + 1);
    expect(dec.sunset!).toBeGreaterThanOrEqual(17 * 60 + 6);
    expect(dec.sunset!).toBeLessThanOrEqual(17 * 60 + 12);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `cd web && npx vitest run tests/sun.test.ts`
Expected: FAIL, "Failed to resolve import '../src/sun'".

- [ ] **Step 3: Implement** `web/src/sun.ts`:

```ts
/** Where the sun is: the NOAA solar calculator equations (after Meeus), and local time in the site's zone. */

export interface SunPosition {
  /** Compass bearing, degrees clockwise from north. */
  azimuth: number;
  /** Apparent height above the horizon in degrees, atmospheric refraction included. */
  elevation: number;
}
export interface LocalDate { year: number; month: number; day: number }
export interface LocalTime extends LocalDate { hour: number; minute: number }

const RAD = Math.PI / 180;
/** Apparent elevation of the sun's centre when its upper edge touches the horizon. */
const HORIZON = -0.27;

function refraction(elevation: number): number {
  if (elevation > 85) return 0;
  const t = Math.tan(elevation * RAD);
  let arcsec: number;
  if (elevation > 5) arcsec = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  else if (elevation > -0.575) {
    arcsec = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  } else arcsec = -20.772 / t;
  return arcsec / 3600;
}

export function solarPosition(utcMillis: number, lat: number, lon: number): SunPosition {
  const jd = utcMillis / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = m * RAD;
  const c = Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * mr) * 0.000289;
  const omega = (125.04 - 1934.136 * t) * RAD;
  const apparent = (l0 + c - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(apparent));
  const y = Math.tan(eps / 2) ** 2;
  const l0r = l0 * RAD;
  const eqTime = (4 / RAD) * (y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r)
    - 0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr));
  const minutes = (((utcMillis % 86400000) + 86400000) % 86400000) / 60000;
  const trueSolar = (((minutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = (trueSolar / 4 - 180) * RAD;
  const latr = lat * RAD;
  const cosZenith = Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const denom = Math.cos(latr) * Math.sin(zenith);
  let azimuth: number;
  if (Math.abs(denom) < 1e-12) azimuth = lat > decl / RAD ? 180 : 0;
  else {
    const a = Math.acos(Math.max(-1, Math.min(1, (Math.sin(latr) * Math.cos(zenith) - Math.sin(decl)) / denom))) / RAD;
    azimuth = hourAngle > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  const geometric = 90 - zenith / RAD;
  return { azimuth, elevation: geometric + refraction(geometric) };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function toLocal(utcMillis: number, tz: string): LocalTime {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(utcMillis))) p[part.type] = Number(part.value);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute };
}

/** How far the zone's clock is ahead of UTC at an instant, in ms (Lisbon summer time: 3 600 000). */
export function zoneOffset(utcMillis: number, tz: string): number {
  const l = toLocal(utcMillis, tz);
  return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute) - Math.floor(utcMillis / 60000) * 60000;
}

/** The UTC instant at which the zone's clock shows `t`. */
export function fromLocal(t: LocalTime, tz: string): number {
  const asUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute);
  const first = asUtc - zoneOffset(asUtc, tz);
  return asUtc - zoneOffset(first, tz);
}

/** Unit vector toward the sun in three.js space. yBearing: compass bearing of Blender +Y (three.js -Z). */
export function sunVector(sun: SunPosition, yBearing: number): [number, number, number] {
  const rel = (sun.azimuth - yBearing) * RAD;
  const el = sun.elevation * RAD;
  return [Math.sin(rel) * Math.cos(el), Math.sin(el), -Math.cos(rel) * Math.cos(el)];
}

/** Sunrise and sunset in minutes after local midnight, found minute by minute; null if it doesn't happen. */
export function sunTimes(date: LocalDate, lat: number, lon: number, tz: string): { sunrise: number | null; sunset: number | null } {
  const start = fromLocal({ year: date.year, month: date.month, day: date.day, hour: 0, minute: 0 }, tz);
  let sunrise: number | null = null;
  let sunset: number | null = null;
  let wasUp = solarPosition(start, lat, lon).elevation > HORIZON;
  for (let m = 1; m <= 1440; m++) {
    const up = solarPosition(start + m * 60000, lat, lon).elevation > HORIZON;
    if (up && !wasUp && sunrise === null) sunrise = m;
    if (!up && wasUp) sunset = m;
    wasUp = up;
  }
  return { sunrise, sunset };
}
```

- [ ] **Step 4: Run the test and check it passes**

Run: `cd web && npx vitest run tests/sun.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/sun.ts web/tests/sun.test.ts
git commit -m "Sun: solar position, Lisbon time, sun direction and sunrise/sunset

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Typical-month climate data (`climate.json`, `web/src/climate.ts`)

**Files:**
- Create: `web/scripts/fetch-climate.mjs`, `web/public/assets/climate.json` (generated), `web/public/assets/DATA-SOURCES.md`, `web/src/climate.ts`
- Test: `web/tests/climate.test.ts`

**Interfaces:**
- Produces:
  - `interface ClimateHour { utcHour; gb; gd; gcs }`
  - `interface ClimateMonth { month; hours: ClimateHour[]; sunshineHours; cloudCover }`
  - `interface Climate { months: ClimateMonth[] }`
  - `class ClimateError`
  - `parseClimate(json): Climate`
  - `typicalIrradiance(c, utcMillis): { beam; diffuse }` (W/m², horizontal)
  - `sunStrength(beam, elevation): number` (direct-normal W/m²)
  - `skyDiffuse(c, utcMillis, elevation, diffuse): number` (diffuse with twilight)
  - `skyScale(diffuse, wattsToScene, bakedIrradiance): number`

- [ ] **Step 1: Write the fetch script** `web/scripts/fetch-climate.mjs`:

```js
// Builds public/assets/climate.json: an average day for each month at the flat (PVGIS, SARAH3 2005-2023)
// and its typical sunshine and cloud cover (Open-Meteo archive, 2015-2024).
// Run from web/:  node scripts/fetch-climate.mjs 41.117327 -8.653914
import { writeFile } from 'node:fs/promises';

const [lat, lon] = process.argv.slice(2).map(Number);
if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error('usage: node scripts/fetch-climate.mjs <lat> <lon>');
  process.exit(1);
}
const pvgis = `https://re.jrc.ec.europa.eu/api/v5_3/DRcalc?lat=${lat}&lon=${lon}&month=0&global=1&clearsky=1&angle=0&aspect=0&outputformat=json`;
const openMeteo = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=2015-01-01&end_date=2024-12-31&daily=sunshine_duration,cloud_cover_mean&timezone=Europe%2FLisbon`;

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'apartment-walkthrough climate fetch' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const [p, o] = await Promise.all([json(pvgis), json(openMeteo)]);
const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hours: [], sunshine: [], cloud: [] }));
// PVGIS gives hourly means in UTC; "12:00" is the hour from 12:00 to 13:00, so it sits at 12.5.
for (const r of p.outputs.daily_profile) {
  const hour = Number(r.time.slice(0, 2));
  months[r.month - 1].hours[hour] = {
    utcHour: hour + 0.5, gb: round(r['Gb(i)'], 1), gd: round(r['Gd(i)'], 1), gcs: round(r['Gcs(i)'], 1),
  };
}
o.daily.time.forEach((day, k) => {
  const m = months[Number(day.slice(5, 7)) - 1];
  if (o.daily.sunshine_duration[k] !== null) m.sunshine.push(o.daily.sunshine_duration[k] / 3600);
  if (o.daily.cloud_cover_mean[k] !== null) m.cloud.push(o.daily.cloud_cover_mean[k]);
});
const out = {
  source: { pvgis, openMeteo, fetched: new Date().toISOString().slice(0, 10) },
  months: months.map((m) => {
    if (m.hours.length !== 24 || m.hours.some((h) => !h)) throw new Error(`PVGIS month ${m.month}: expected 24 hours`);
    return { month: m.month, hours: m.hours, sunshineHours: round(mean(m.sunshine), 1), cloudCover: Math.round(mean(m.cloud)) };
  }),
};
await writeFile(new URL('../public/assets/climate.json', import.meta.url), JSON.stringify(out) + '\n');
console.log('wrote public/assets/climate.json');
```

- [ ] **Step 2: Run it** (needs network)

Run: `cd web && node scripts/fetch-climate.mjs 41.117327 -8.653914`
Expected: `wrote public/assets/climate.json`. Check: `node -e "const c=require('./public/assets/climate.json');console.log(c.months.length,c.months[5].hours[12],c.months[5].sunshineHours)"` prints `12`, a June 12:30 hour with `gb` around 580, and roughly 10–11 sunshine hours.

- [ ] **Step 3: Write the credits** `web/public/assets/DATA-SOURCES.md`:

```markdown
# Data sources

`climate.json` is built by `web/scripts/fetch-climate.mjs` (the request URLs and fetch date are in its `source` field).

- **PVGIS 5.3**, European Commission Joint Research Centre: average daily irradiance profile per month (beam, diffuse and clear-sky irradiance on a horizontal surface) at 41.117327, −8.653914, from the SARAH3 satellite data, 2005–2023. https://re.jrc.ec.europa.eu/pvg_tools/ — © European Union, reuse allowed with acknowledgement of the source.
- **Open-Meteo Historical Weather API**: daily sunshine duration and mean cloud cover, 2015–2024, averaged per month. https://open-meteo.com/ — data licensed under CC BY 4.0 (based on ERA5 / Copernicus Climate Change Service).
```

- [ ] **Step 4: Write the failing test** `web/tests/climate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import real from '../public/assets/climate.json';
import { type Climate, ClimateError, parseClimate, skyDiffuse, skyScale, sunStrength, typicalIrradiance } from '../src/climate';

/** Beam is 100 W/m² in the 12:00-13:00 UTC hour only; diffuse equals the month number all day. */
function synthetic(): Climate {
  return parseClimate({
    months: Array.from({ length: 12 }, (_, m) => ({
      month: m + 1, sunshineHours: m + 0.5, cloudCover: 40,
      hours: Array.from({ length: 24 }, (_, h) => ({ utcHour: h + 0.5, gb: h === 12 ? 100 : 0, gd: m + 1, gcs: 0 })),
    })),
  });
}

describe('parseClimate', () => {
  it('accepts the committed data', () => {
    const c = parseClimate(real);
    expect(c.months).toHaveLength(12);
    expect(c.months[5].hours[12].gb).toBeGreaterThan(c.months[11].hours[12].gb);
  });

  it('rejects a broken file', () => {
    expect(() => parseClimate({ months: [] })).toThrow(ClimateError);
    const bad = JSON.parse(JSON.stringify(real));
    bad.months[3].hours[5].gd = 'x';
    expect(() => parseClimate(bad)).toThrow('months[3].hours[5].gd');
  });
});

describe('typicalIrradiance', () => {
  const c = synthetic();
  it('uses the month alone at mid-month and interpolates between hourly means', () => {
    expect(typicalIrradiance(c, Date.UTC(2026, 0, 16, 12, 0)).diffuse).toBeCloseTo(1, 6);
    expect(typicalIrradiance(c, Date.UTC(2026, 0, 16, 12, 30)).beam).toBeCloseTo(100, 6);
    expect(typicalIrradiance(c, Date.UTC(2026, 0, 16, 13, 0)).beam).toBeCloseTo(50, 6);
    expect(typicalIrradiance(c, Date.UTC(2026, 0, 16, 12, 0)).beam).toBeCloseTo(50, 6);
    expect(typicalIrradiance(c, Date.UTC(2026, 0, 16, 3, 0)).beam).toBe(0);
  });

  it('blends half and half at month boundaries, wrapping December into January', () => {
    expect(typicalIrradiance(c, Date.UTC(2026, 1, 1, 0, 0)).diffuse).toBeCloseTo(1.5, 6);
    expect(typicalIrradiance(c, Date.UTC(2026, 0, 31, 23, 59, 59)).diffuse).toBeCloseTo(1.5, 3);
    expect(typicalIrradiance(c, Date.UTC(2026, 11, 31, 23, 59, 59)).diffuse).toBeCloseTo(6.5, 3);
  });
});

describe('strengths', () => {
  it('turns horizontal beam into direct-normal, clamping low suns and zeroing below the horizon', () => {
    expect(sunStrength(500, 30)).toBeCloseTo(1000);
    expect(sunStrength(10, 1)).toBeCloseTo(10 / Math.sin((3 * Math.PI) / 180));
    expect(sunStrength(500, 0)).toBe(0);
    expect(sunStrength(500, -2)).toBe(0);
  });

  it('keeps a fading twilight sky and none at night', () => {
    const c = synthetic(); // June peak diffuse is 6
    const t = Date.UTC(2026, 5, 15, 21, 0);
    expect(skyDiffuse(c, t, 10, 30)).toBe(30);
    expect(skyDiffuse(c, t, 0, 0)).toBeCloseTo(0.02 * 6);
    expect(skyDiffuse(c, t, -3, 30)).toBeCloseTo(0.01 * 6);
    expect(skyDiffuse(c, t, -1, 30)).toBeCloseTo(15);
    expect(skyDiffuse(c, t, -7, 30)).toBe(0);
  });

  it('scales the baked sky to the real diffuse light', () => {
    expect(skyScale(150, 4 / 900, 0.6467)).toBeCloseTo((150 * 4) / 900 / 0.6467);
  });
});
```

- [ ] **Step 5: Run the test and check it fails**

Run: `cd web && npx vitest run tests/climate.test.ts`
Expected: FAIL, "Failed to resolve import '../src/climate'".

- [ ] **Step 6: Implement** `web/src/climate.ts`:

```ts
/** Typical sunlight at the flat for any moment, from the average day of each month in climate.json. */

export interface ClimateHour { utcHour: number; gb: number; gd: number; gcs: number }
export interface ClimateMonth { month: number; hours: ClimateHour[]; sunshineHours: number; cloudCover: number }
export interface Climate { months: ClimateMonth[] }
export interface Irradiance { beam: number; diffuse: number }

export class ClimateError extends Error {}

const RAD = Math.PI / 180;
/** Direct-normal light is beam / sin(elevation); below this elevation the division would blow up. */
const MIN_ELEVATION = 3;
/** End of civil twilight, degrees below the horizon. */
const TWILIGHT = 6;
/** Sky light kept through twilight, as a share of the month's peak diffuse light. */
const TWILIGHT_FLOOR = 0.02;
/** Below the horizon the typical diffuse light fades out over this many degrees. */
const DUSK_FADE = 2;

type Obj = Record<string, unknown>;

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ClimateError(`climate.${path}: expected a number`);
  return v;
}

export function parseClimate(json: unknown): Climate {
  const months = (json as Obj | null)?.months;
  if (!Array.isArray(months) || months.length !== 12) throw new ClimateError('climate.months: expected 12 months');
  return {
    months: months.map((v, i) => {
      const m = v as Obj;
      if (m?.month !== i + 1) throw new ClimateError(`climate.months[${i}].month: expected ${i + 1}`);
      if (!Array.isArray(m.hours) || m.hours.length !== 24) throw new ClimateError(`climate.months[${i}].hours: expected 24 hours`);
      const hours = m.hours.map((hv, k) => {
        const h = hv as Obj;
        const path = `months[${i}].hours[${k}]`;
        const hour = { utcHour: num(h?.utcHour, `${path}.utcHour`), gb: num(h.gb, `${path}.gb`), gd: num(h.gd, `${path}.gd`), gcs: num(h.gcs, `${path}.gcs`) };
        if (hour.utcHour !== k + 0.5) throw new ClimateError(`climate.${path}.utcHour: expected ${k + 0.5}`);
        return hour;
      });
      return { month: i + 1, hours, sunshineHours: num(m.sunshineHours, `months[${i}].sunshineHours`), cloudCover: num(m.cloudCover, `months[${i}].cloudCover`) };
    }),
  };
}

/** The month's hourly means are centred on HH:30 UTC; values in between are linear. */
function profile(m: ClimateMonth, hour: number, key: 'gb' | 'gd'): number {
  const x = (((hour - 0.5) % 24) + 24) % 24;
  const i = Math.floor(x);
  const f = x - i;
  const a = m.hours[i][key];
  return a + (m.hours[(i + 1) % 24][key] - a) * f;
}

/** Beam and diffuse W/m² on a horizontal surface: the month's average day, blended toward the neighbouring month away from mid-month. */
export function typicalIrradiance(c: Climate, utcMillis: number): Irradiance {
  const d = new Date(utcMillis);
  const m = d.getUTCMonth();
  const days = new Date(Date.UTC(d.getUTCFullYear(), m + 1, 0)).getUTCDate();
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const pos = (d.getUTCDate() - 1 + hour / 24) / days;
  const other = pos < 0.5 ? (m + 11) % 12 : (m + 1) % 12;
  const w = Math.abs(pos - 0.5);
  const mix = (key: 'gb' | 'gd') => (1 - w) * profile(c.months[m], hour, key) + w * profile(c.months[other], hour, key);
  return { beam: mix('gb'), diffuse: mix('gd') };
}

/** Direct-normal irradiance from horizontal beam irradiance. */
export function sunStrength(beam: number, elevation: number): number {
  if (elevation <= 0) return 0;
  return beam / Math.sin(Math.max(elevation, MIN_ELEVATION) * RAD);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Diffuse sky light with dusk handled: the typical value fades just below the horizon, and a small floor lasts until the end of civil twilight. */
export function skyDiffuse(c: Climate, utcMillis: number, elevation: number, diffuse: number): number {
  const month = c.months[new Date(utcMillis).getUTCMonth()];
  const peak = Math.max(...month.hours.map((h) => h.gd));
  const floor = TWILIGHT_FLOOR * peak * clamp01(1 + elevation / TWILIGHT);
  return Math.max(diffuse * clamp01(1 + elevation / DUSK_FADE), floor);
}

/** Factor for the baked sky layer: the real diffuse light in scene units over what the bake's own sky gave. */
export function skyScale(diffuse: number, wattsToScene: number, bakedIrradiance: number): number {
  return (diffuse * wattsToScene) / bakedIrradiance;
}
```

- [ ] **Step 7: Run the test and check it passes**

Run: `cd web && npx vitest run tests/climate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Commit**

```bash
git add web/scripts/fetch-climate.mjs web/public/assets/climate.json web/public/assets/DATA-SOURCES.md web/src/climate.ts web/tests/climate.test.ts
git commit -m "Sun: typical day per month from PVGIS and Open-Meteo, and the irradiance it gives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Time state, keys and readout (`web/src/sun-clock.ts`)

**Files:**
- Create: `web/src/sun-clock.ts`
- Modify: `web/src/config.ts` (add the `sun` block)
- Test: `web/tests/sun-clock.test.ts`

**Interfaces:**
- Consumes: from `sun.ts`, `fromLocal`, `toLocal`, `LocalDate`, `LocalTime` and `SunPosition`; from `climate.ts`, `ClimateMonth`.
- Produces:
  - `type SunKey = { minutes: number } | { days: number } | 'play'`
  - `sunKeyAction(code, shift): SunKey | null`
  - `parseSunParam(value: string | null, tz): number | null`
  - `daysInMonth(year, month)`, `daysInYear(year)`, `dayOfYear(d: LocalDate)`
  - `class SunClock(utc, timeZone, playRate?)` with:
    - fields `playing` and `version`;
    - getter `utc` and method `local()`;
    - setters `set(utc)`, `setDate(year, month, day)`, `setDayOfYear(n)`, `setMinutes(m)`;
    - nudges `nudgeMinutes(m)`, `nudgeDays(d)`;
    - `now(clock?)`, `togglePlay()`, `tick(dt)`, `apply(key)`.
  - Formatting: `formatClock(l: LocalTime)`, `compassName(azimuth)`, `formatReadout(l, sun, month)`.
  - `CONFIG.sun`.

- [ ] **Step 1: Add the config block** to `web/src/config.ts`, after `verticalFov: 70,`:

```ts
  sun: {
    /** Seconds of sun per real second while playing: one hour every two seconds. */
    playRate: 1800,
    nudgeMinutes: 15,
    nudgeDays: 7,
    shadowMapSize: 4096,
    /** How far toward the sun (m) shadow casters are collected; a 10 m building's shadow at 3 degrees reaches about 190 m. */
    shadowReach: 200,
    shadowBias: -0.00002,
    shadowNormalBias: 0.01,
    /** Share of the sunlight entering a room that comes back as an even fill, per m² of floor. Tuned against Cycles. */
    bounce: 0.2,
    /** The sun's colour at the horizon; white above 30 degrees. */
    warmColor: '#ffb070',
    sunsetSky: '#f2a46b',
    nightSky: '#0d1424',
  },
```

- [ ] **Step 2: Write the failing test** `web/tests/sun-clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ClimateMonth } from '../src/climate';
import {
  compassName, dayOfYear, daysInYear, formatClock, formatReadout, parseSunParam, SunClock, sunKeyAction,
} from '../src/sun-clock';
import { fromLocal } from '../src/sun';

const TZ = 'Europe/Lisbon';
const at = (year: number, month: number, day: number, hour: number, minute: number) =>
  fromLocal({ year, month, day, hour, minute }, TZ);

describe('parseSunParam', () => {
  it('reads Lisbon time', () => expect(parseSunParam('2026-06-21T18:30', TZ)).toBe(Date.UTC(2026, 5, 21, 17, 30)));
  it('rejects missing and invalid values', () => {
    expect(parseSunParam(null, TZ)).toBeNull();
    expect(parseSunParam('2026-02-30T10:00', TZ)).toBeNull();
    expect(parseSunParam('2026-06-21 18:30', TZ)).toBeNull();
    expect(parseSunParam('2026-06-21T24:00', TZ)).toBeNull();
  });
});

describe('sunKeyAction', () => {
  it('maps physical keys', () => {
    expect(sunKeyAction('Comma', false)).toEqual({ minutes: -15 });
    expect(sunKeyAction('Period', false)).toEqual({ minutes: 15 });
    expect(sunKeyAction('Comma', true)).toEqual({ days: -7 });
    expect(sunKeyAction('Period', true)).toEqual({ days: 7 });
    expect(sunKeyAction('KeyP', false)).toBe('play');
    expect(sunKeyAction('KeyL', false)).toBeNull();
  });
});

describe('SunClock', () => {
  it('keeps the clock time when the date crosses a summer-time switch', () => {
    const c = new SunClock(at(2026, 3, 25, 10, 0), TZ);
    c.nudgeDays(7);
    expect(c.local()).toEqual({ year: 2026, month: 4, day: 1, hour: 10, minute: 0 });
    c.nudgeDays(-7);
    expect(c.local()).toEqual({ year: 2026, month: 3, day: 25, hour: 10, minute: 0 });
  });

  it('nudges, sets and bumps the version only on change', () => {
    const c = new SunClock(at(2026, 6, 21, 12, 0), TZ);
    const v = c.version;
    c.nudgeMinutes(15);
    expect(c.local().minute).toBe(15);
    expect(c.version).toBe(v + 1);
    c.set(c.utc);
    expect(c.version).toBe(v + 1);
    c.setMinutes(18 * 60 + 30);
    expect(c.local()).toEqual({ year: 2026, month: 6, day: 21, hour: 18, minute: 30 });
    c.setDayOfYear(355);
    expect(c.local()).toEqual({ year: 2026, month: 12, day: 21, hour: 18, minute: 30 });
    c.setDate(2026, 3, 20);
    expect(c.local()).toEqual({ year: 2026, month: 3, day: 20, hour: 18, minute: 30 });
    c.now(() => Date.UTC(2026, 0, 1, 9));
    expect(c.utc).toBe(Date.UTC(2026, 0, 1, 9));
  });

  it('plays an hour every two seconds and applies keys', () => {
    const c = new SunClock(at(2026, 6, 21, 12, 0), TZ);
    c.tick(2);
    expect(c.local().hour).toBe(12);
    c.apply('play');
    expect(c.playing).toBe(true);
    c.tick(2);
    expect(c.local()).toMatchObject({ hour: 13, minute: 0 });
    c.apply({ minutes: -15 });
    expect(c.local()).toMatchObject({ hour: 12, minute: 45 });
    c.apply({ days: 7 });
    expect(c.local()).toMatchObject({ month: 6, day: 28 });
  });
});

describe('calendar helpers', () => {
  it('counts days', () => {
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2028)).toBe(366);
    expect(dayOfYear({ year: 2026, month: 12, day: 21 })).toBe(355);
    expect(dayOfYear({ year: 2026, month: 1, day: 1 })).toBe(1);
  });
});

describe('readout', () => {
  const june: ClimateMonth = { month: 6, hours: [], sunshineHours: 10.94, cloudCover: 30 };
  const l = { year: 2026, month: 6, day: 21, hour: 18, minute: 5 };
  it('formats the clock and compass', () => {
    expect(formatClock(l)).toBe('21 Jun · 18:05');
    expect(compassName(0)).toBe('north');
    expect(compassName(292)).toBe('west-north-west');
    expect(compassName(359)).toBe('north');
  });
  it('describes the sun and the typical month', () => {
    expect(formatReadout(l, { azimuth: 278, elevation: 27.4 }, june))
      .toBe('21 Jun · 18:05 · Sun 27° high, west · typical June: 10.9 h of sunshine a day');
    expect(formatReadout(l, { azimuth: 300, elevation: -1 }, june))
      .toBe('21 Jun · 18:05 · Sun below the horizon · typical June: 10.9 h of sunshine a day');
  });
});
```

- [ ] **Step 3: Run the test and check it fails**

Run: `cd web && npx vitest run tests/sun-clock.test.ts`
Expected: FAIL, "Failed to resolve import '../src/sun-clock'".

- [ ] **Step 4: Implement** `web/src/sun-clock.ts`:

```ts
import type { ClimateMonth } from './climate';
import { CONFIG } from './config';
import { fromLocal, type LocalDate, type LocalTime, type SunPosition, toLocal } from './sun';

export type SunKey = { minutes: number } | { days: number } | 'play';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const COMPASS = [
  'north', 'north-north-east', 'north-east', 'east-north-east', 'east', 'east-south-east', 'south-east', 'south-south-east',
  'south', 'south-south-west', 'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west',
];

/** Physical keys (e.code), so they sit in the same place on Portuguese and other layouts. */
export function sunKeyAction(code: string, shift: boolean): SunKey | null {
  const sign = code === 'Comma' ? -1 : code === 'Period' ? 1 : 0;
  if (sign) return shift ? { days: sign * CONFIG.sun.nudgeDays } : { minutes: sign * CONFIG.sun.nudgeMinutes };
  return code === 'KeyP' ? 'play' : null;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function daysInYear(year: number): number {
  return daysInMonth(year, 2) === 29 ? 366 : 365;
}

export function dayOfYear(d: LocalDate): number {
  return (Date.UTC(d.year, d.month - 1, d.day) - Date.UTC(d.year, 0, 1)) / 86400000 + 1;
}

/** `?sun=2026-06-21T18:30`, read as local time in tz; null when absent or not a real moment. */
export function parseSunParam(value: string | null, tz: string): number | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59) return null;
  return fromLocal({ year, month, day, hour, minute }, tz);
}

/** The moment the sun is shown for. */
export class SunClock {
  playing = false;
  /** Bumped on every change, so the daylight and the panel redo their work only when something moved. */
  version = 0;

  constructor(private utcMillis: number, readonly timeZone: string, private playRate = CONFIG.sun.playRate) {}

  get utc(): number {
    return this.utcMillis;
  }

  local(): LocalTime {
    return toLocal(this.utcMillis, this.timeZone);
  }

  set(utc: number): void {
    if (utc === this.utcMillis) return;
    this.utcMillis = utc;
    this.version++;
  }

  nudgeMinutes(minutes: number): void {
    this.set(this.utcMillis + minutes * 60000);
  }

  /** Moves to another day, keeping the clock time (across summer-time switches too). */
  setDate(year: number, month: number, day: number): void {
    const l = this.local();
    this.set(fromLocal({ year, month, day, hour: l.hour, minute: l.minute }, this.timeZone));
  }

  nudgeDays(days: number): void {
    const l = this.local();
    const d = new Date(Date.UTC(l.year, l.month - 1, l.day + days));
    this.setDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  setDayOfYear(n: number): void {
    const d = new Date(Date.UTC(this.local().year, 0, n));
    this.setDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  /** Minutes after local midnight on the current date. */
  setMinutes(minutes: number): void {
    const l = this.local();
    this.set(fromLocal({ year: l.year, month: l.month, day: l.day, hour: Math.floor(minutes / 60), minute: minutes % 60 }, this.timeZone));
  }

  now(clock: () => number = Date.now): void {
    this.set(clock());
  }

  togglePlay(): void {
    this.playing = !this.playing;
    this.version++;
  }

  tick(dt: number): void {
    if (this.playing) this.set(this.utcMillis + dt * this.playRate * 1000);
  }

  apply(key: SunKey): void {
    if (key === 'play') this.togglePlay();
    else if ('minutes' in key) this.nudgeMinutes(key.minutes);
    else this.nudgeDays(key.days);
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatClock(l: LocalTime): string {
  return `${l.day} ${MONTHS[l.month - 1]} · ${pad(l.hour)}:${pad(l.minute)}`;
}

export function compassName(azimuth: number): string {
  return COMPASS[Math.round((((azimuth % 360) + 360) % 360) / 22.5) % 16];
}

export function formatReadout(l: LocalTime, sun: SunPosition, month: ClimateMonth): string {
  const where = sun.elevation > 0
    ? `Sun ${Math.round(sun.elevation)}° high, ${compassName(sun.azimuth)}`
    : 'Sun below the horizon';
  return `${formatClock(l)} · ${where} · typical ${MONTH_NAMES[l.month - 1]}: ${month.sunshineHours.toFixed(1)} h of sunshine a day`;
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `cd web && npx vitest run tests/sun-clock.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/sun-clock.ts web/src/config.ts web/tests/sun-clock.test.ts
git commit -m "Sun: clock with nudges, play, ?sun= parsing, keys and readout text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lamps and glowing materials per room (pipeline)

**Files:**
- Modify: `blender/pipeline/config.py`, `blender/tests/fixture_scene.py`, `blender/tests/test_scene_select.py:79-87`
- Create: `blender/pipeline/lamps.py`
- Test: `blender/tests/test_lamps.py`

**Interfaces:**
- Produces:
  - `config.SITE`, `config.WATTS_TO_SCENE`, `config.SKY_BAKE_COLOR`, `config.DAY_FILL_LIGHT_PREFIX`, `config.LAMP_ROOM_MAX_DIST`
  - `lamps.is_day_fill(light_obj) -> bool`
  - `lamps.room_lamps(scene, floor_index, on_lights, ceiling_names) -> ({room id: [lamp names]}, [names in no room])`
  - `lamps.split_emitters(meshes, floor_index) -> ({room id: [material names]}, [mesh names in no room])`
  - New fixture objects: the `Desk lamp light` POINT lamp in Alpha; the `Portal Alpha window` AREA light; the `Alpha wall lamp` mesh using `Lamp glow`; the `Window 3 (Exterior / Alpha) glass` mesh; a Sky Texture driving the world colour.

- [ ] **Step 1: Add config** at the end of `blender/pipeline/config.py`:

```python

# Where the flat is: Blender's origin, and the compass bearing of Blender +Y. Measured by matching the model's
# neighbourhood to OpenStreetMap outlines (docs/superpowers/specs/2026-10-23-sun-simulation-design.md).
SITE = {"lat": 41.117327, "lon": -8.653914, "timeZone": "Europe/Lisbon", "yBearing": 142.1}
# Real W/m² to the scene's light units: 900 W/m² of direct sun equals the old Sun lamp (strength 4).
WATTS_TO_SCENE = 4.0 / 900.0
# The day layer bakes sky light only. The world's colour is replaced by this flat sky (the Sky Texture has a sun of its
# own built in) at the world's own strength, and only lights named DAY_FILL_LIGHT_PREFIX stay on.
SKY_BAKE_COLOR = (0.55, 0.70, 0.95)
DAY_FILL_LIGHT_PREFIX = "Portal "
# Lamps on a wall, and lampshades, can sit just outside their room's floor polygon.
LAMP_ROOM_MAX_DIST = 0.5
```

- [ ] **Step 2: Extend the fixture.** In `blender/tests/fixture_scene.py`, `build()`:

After the line `next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND").inputs["Strength"].default_value = 1.0`, add:

```python
    tree = scene.world.node_tree
    sky = tree.nodes.new("ShaderNodeTexSky")  # like the real file: a sky texture drives the world colour
    tree.links.new(sky.outputs["Color"], next(n for n in tree.nodes if n.type == "BACKGROUND").inputs["Color"])
```

After `glow = _mat_emissive("Lamp glow")`, add:

```python
    glass = _mat_flat("Window glass", (0.9, 0.95, 1.0), 0.05)
```

After the `box_object("Lamp", ...)` line, add:

```python
    box_object("Alpha wall lamp", [(0.3, 2.3, 1.75, 0.6, 2.6, 1.95)], glow, furniture)  # above the collision rays
    box_object("Window 3 (Exterior / Alpha) glass", [(1.0, -0.11, 1.0, 2.0, -0.09, 2.0)], glass, structure)
```

After `_light("Sun", "SUN", (0, 0, 10), 3.0, lights)`, add:

```python
    _light("Desk lamp light", "POINT", (0.5, 2.5, 0.9), 10.0, lights)
    _light("Portal Alpha window", "AREA", (1.5, 0.05, 1.5), 5.0, lights, size=1.0)
```

Update the module docstring's second paragraph to mention the new objects:

```python
"""A tiny two-room apartment that follows the real file's naming conventions.

Blender coordinates (Z up). Alpha: x 0..3, y 0..3. Beta: x 3.2..6, y 0..3.
A 0.2 m wall at x 3.0..3.2 has an opening at y 1.0..1.8 whose door leaf is modelled open into
Alpha (hinge at (3.1, 1.78)), and an infilled opening at y 2.2..2.8 with a leftover leaf open in Beta.
Alpha has an exterior window in its south wall (y -0.2..0), a desk lamp, a window fill light and a
glowing wall lamp; Beta's 'Lamp' glows with the same material.
"""
```

- [ ] **Step 3: Update `test_collections_and_lights`** in `blender/tests/test_scene_select.py`. Replace its two light assertions with:

```python
        self.assertEqual(self.day_lights, ["Desk lamp light", "Portal Alpha window", "Sun"])
        lights = bpy.data.collections["WEB_LIGHTS"]
        self.assertEqual({o.name for o in lights.objects},
                         {"Sun", "Desk lamp light", "Portal Alpha window", "Ceiling light Alpha", "Ceiling light Beta"})
```

- [ ] **Step 4: Write the failing test** `blender/tests/test_lamps.py`:

```python
import unittest

import bpy

from pipeline import lamps, rooms, scene_select
from tests import fixture_scene


class LampTests(unittest.TestCase):
    def setUp(self):
        fixture_scene.build()
        scene = bpy.context.scene
        self.meshes, self.on = scene_select.prepare_scene(scene, bpy.context.view_layer)
        self.index, self.rooms = rooms.collect_rooms(self.meshes, scene)
        self.ceilings = {r["light"] for r in self.rooms if r["light"]}

    def test_lamps_go_to_their_room(self):
        found, lost = lamps.room_lamps(bpy.context.scene, self.index, self.on, self.ceilings)
        self.assertEqual(found, {"alpha": ["Desk lamp light"]})
        self.assertEqual(lost, [])

    def test_lamp_outside_every_room_is_reported(self):
        bpy.data.objects["Desk lamp light"].location = (20.0, 20.0, 1.0)
        bpy.context.view_layer.update()
        found, lost = lamps.room_lamps(bpy.context.scene, self.index, self.on, self.ceilings)
        self.assertEqual(found, {})
        self.assertEqual(lost, ["Desk lamp light"])

    def test_day_fill_lights(self):
        self.assertTrue(lamps.is_day_fill(bpy.data.objects["Portal Alpha window"]))
        self.assertFalse(lamps.is_day_fill(bpy.data.objects["Desk lamp light"]))

    def test_glowing_materials_get_a_copy_per_room(self):
        found, lost = lamps.split_emitters(self.meshes, self.index)
        self.assertEqual(found, {"alpha": ["Lamp glow @alpha"], "beta": ["Lamp glow @beta"]})
        self.assertEqual(lost, [])
        self.assertEqual(bpy.data.objects["Alpha wall lamp"].material_slots[0].material.name, "Lamp glow @alpha")
        self.assertEqual(bpy.data.objects["Lamp"].material_slots[0].material.name, "Lamp glow @beta")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 5: Run the tests and check they fail**

Run: `make test-blender TESTS=test_lamps.py`
Expected: FAIL with `ImportError: cannot import name 'lamps'`.

- [ ] **Step 6: Implement** `blender/pipeline/lamps.py`:

```python
"""Which room each lamp and glowing object belongs to, so a room's light layer switches them with its ceiling light."""
from . import bpyutil, config, geom


def is_day_fill(light_obj):
    """Window fill lights stand in for sky light, so they belong to the day layer."""
    return light_obj.name.startswith(config.DAY_FILL_LIGHT_PREFIX)


def room_lamps(scene, floor_index, on_lights, ceiling_names):
    """({room id: [lamp names]}, [names of lamps in no room]) for the lights that are on in the render.
    Suns, day fill lights and ceiling lights are not lamps."""
    found, lost = {}, []
    for name in on_lights:
        o = scene.objects[name]
        if o.data.type == "SUN" or is_day_fill(o) or name in ceiling_names:
            continue
        p = o.matrix_world.translation
        k = int(floor_index.locate_many([geom.to_three_xz(p.x, p.y)], config.LAMP_ROOM_MAX_DIST)[0])
        if k < 0:
            lost.append(name)
        else:
            found.setdefault(floor_index.ids[k], []).append(name)
    return found, sorted(lost)


def _glows(mat):
    if mat is None or mat.node_tree is None:
        return False
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED" and n.inputs["Emission Strength"].default_value > 0:
            return True
        if n.type == "EMISSION" and n.inputs["Strength"].default_value > 0:
            return True
    return False


def split_emitters(meshes, floor_index):
    """Give every room its own copy of each glowing material its meshes use ('<name> @<room>'), so the bake can light
    one room's lampshades and screens without the others. Works on realized meshes (one mesh per object).
    Returns ({room id: [material names]}, [names of glowing meshes in no room])."""
    copies, found, lost = {}, {}, []
    for o in meshes:
        slots = [i for i, s in enumerate(o.material_slots) if _glows(s.material)]
        if not slots:
            continue
        co = bpyutil.world_coords(o)
        c = (co.min(0) + co.max(0)) / 2
        k = int(floor_index.locate_many([geom.to_three_xz(c[0], c[1])], config.LAMP_ROOM_MAX_DIST)[0])
        if k < 0:
            lost.append(o.name)
            continue
        room = floor_index.ids[k]
        for i in slots:
            mat = o.material_slots[i].material
            key = (mat.name, room)
            if key not in copies:
                copy = mat.copy()
                copy.name = f"{mat.name} @{room}"
                copies[key] = copy
                found.setdefault(room, []).append(copy.name)
            o.data.materials[i] = copies[key]
    return found, sorted(lost)
```

- [ ] **Step 7: Run the tests and check they pass**

Run: `make test-blender TESTS=test_lamps.py` and then `make test-blender TESTS=test_scene_select.py`
Expected: both PASS.

- [ ] **Step 8: Run the whole pipeline suite** to see what the fixture change breaks

Run: `make test-blender`
Expected: everything passes except `test_bake.LightingStateTests`, whose assumptions Task 5 replaces. If another test fails because of the new fixture objects, fix it now: move the object (keep it inside its room) rather than changing the test's intent.

- [ ] **Step 9: Commit**

```bash
git add blender/pipeline/config.py blender/pipeline/lamps.py blender/tests/fixture_scene.py blender/tests/test_lamps.py blender/tests/test_scene_select.py
git commit -m "Pipeline: site constants, lamps and glowing materials assigned to rooms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sky-only day layer; room layers with their lamps (pipeline)

**Files:**
- Modify: `blender/pipeline/bake.py` (`_emission_sockets`, `Lighting`, `bake_all`; new `sky_irradiance`), `blender/pipeline/run.py` (`prepare`), `blender/pipeline/checks.py` (`check_scene`)
- Test: `blender/tests/test_bake.py`

**Interfaces:**
- Consumes: from Task 4, `lamps.is_day_fill`, `lamps.room_lamps` and `lamps.split_emitters`; `config.SKY_BAKE_COLOR`.
- Produces:
  - `bake.Lighting(scene, room_lights: {room: [light names]}, room_emitters: {room: [material names]})` with methods `day()`, `room(id)` and `restore()`.
  - `bake.sky_irradiance(scene) -> float`.
  - New pipeline state keys:
    - `room_lights`, `room_emitters`;
    - `lost_lamps` (strings);
    - `windows` (filled in Task 6, initialised to `[]` here);
    - `sky_irradiance`.

- [ ] **Step 1: Rewrite the tests that pin the old behaviour.** In `blender/tests/test_bake.py`, add `import math` and add `config, lamps` to the pipeline import. Replace `LightingStateTests` with:

```python
def _bsdf(mat_name):
    return next(n for n in bpy.data.materials[mat_name].node_tree.nodes if n.type == "BSDF_PRINCIPLED")


class LightingStateTests(unittest.TestCase):
    def setUp(self):
        fixture_scene.build()
        self.scene = bpy.context.scene
        scene_select.prepare_scene(self.scene, bpy.context.view_layer)
        self.lighting = bake.Lighting(
            self.scene,
            {"alpha": ["Ceiling light Alpha", "Desk lamp light"], "beta": ["Ceiling light Beta"]},
            {"beta": ["Lamp glow"]},
        )
        self.bg = next(n for n in self.scene.world.node_tree.nodes if n.type == "BACKGROUND")
        self.glow = _bsdf("Lamp glow")

    def hidden(self, name):
        return bpy.data.objects[name].hide_render

    def test_day_is_sky_only(self):
        self.lighting.day()
        for name in ("Sun", "Desk lamp light", "Ceiling light Alpha", "Ceiling light Beta"):
            self.assertTrue(self.hidden(name), name)
        self.assertFalse(self.hidden("Portal Alpha window"))
        self.assertFalse(self.bg.inputs["Color"].is_linked)
        for got, want in zip(self.bg.inputs["Color"].default_value[:3], config.SKY_BAKE_COLOR):
            self.assertAlmostEqual(got, want, places=5)
        self.assertEqual(self.bg.inputs["Strength"].default_value, 1.0)
        self.assertEqual(self.glow.inputs["Emission Strength"].default_value, 0.0)

    def test_room_lights_its_lamps_and_glows_only(self):
        self.lighting.room("alpha")
        self.assertFalse(self.hidden("Ceiling light Alpha"))
        self.assertFalse(self.hidden("Desk lamp light"))
        self.assertTrue(self.hidden("Portal Alpha window"))
        self.assertTrue(self.hidden("Sun"))
        self.assertEqual(self.bg.inputs["Strength"].default_value, 0.0)
        self.assertEqual(self.glow.inputs["Emission Strength"].default_value, 0.0)
        self.lighting.room("beta")
        self.assertTrue(self.hidden("Desk lamp light"))
        self.assertEqual(self.glow.inputs["Emission Strength"].default_value, 2.0)

    def test_restore(self):
        self.lighting.day()
        self.lighting.restore()
        self.assertTrue(self.bg.inputs["Color"].is_linked)
        self.assertEqual(self.bg.inputs["Strength"].default_value, 1.0)
        self.assertEqual(self.glow.inputs["Emission Strength"].default_value, 2.0)
        self.assertFalse(self.hidden("Sun"))
        self.assertFalse(self.hidden("Desk lamp light"))
        self.assertTrue(self.hidden("Ceiling light Alpha"))

    def test_sky_irradiance(self):
        r, g, b = config.SKY_BAKE_COLOR
        self.assertAlmostEqual(bake.sky_irradiance(self.scene), math.pi * (0.2126 * r + 0.7152 * g + 0.0722 * b), places=6)
```

In `BakeAllTests.setUpClass`, replace the `state = {...}` line with:

```python
        state = {"rooms": room_list, "chunks": chunk_list, "day_lights": day,
                 "room_lights": {"alpha": ["Ceiling light Alpha", "Desk lamp light"], "beta": ["Ceiling light Beta"]},
                 "room_emitters": {},
                 "doors": [{"node": leaf.name, "key": "door-1"}], "door_lightmap_size": q.door_lightmap}
```

In `RoomIsolationTests`, replace the `lighting = bake.Lighting(...)` line with:

```python
        lighting = bake.Lighting(scene, {"alpha": ["Ceiling light Alpha"], "beta": ["Ceiling light Beta"]}, {})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `make test-blender TESTS=test_bake.py`
Expected: FAIL. `Lighting()` takes the wrong arguments, and `bake` has no `sky_irradiance`.

- [ ] **Step 3: Implement.** In `blender/pipeline/bake.py`:
- Change the module docstring to `"""Bake the sky-only daylight layer and each room's light layer, then save them as RGBM WebP."""`.
- Add `import math`.
- Change the relative import to `from . import bpyutil, config, lamps, raster`.
- Replace `_emission_sockets` and the whole `Lighting` class with:

```python
def _emission_sockets():
    """(material name, strength socket, original strength) for everything that glows."""
    out = []
    for mat in bpy.data.materials:
        if mat.node_tree is None:
            continue
        for n in mat.node_tree.nodes:
            socket = None
            if n.type == "BSDF_PRINCIPLED":
                socket = n.inputs["Emission Strength"]
            elif n.type == "EMISSION":
                socket = n.inputs["Strength"]
            if socket is not None and socket.default_value > 0:
                out.append((mat.name, socket, socket.default_value))
    return out


def sky_irradiance(scene):
    """Irradiance the day layer's flat sky gives an upward face, in the scene's light units (pi x radiance)."""
    bg = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
    r, g, b = config.SKY_BAKE_COLOR
    return math.pi * bg.inputs["Strength"].default_value * (0.2126 * r + 0.7152 * g + 0.0722 * b)


class Lighting:
    """Switch the scene between the sky-only daylight bake and one room's lights."""

    def __init__(self, scene, room_lights, room_emitters):
        """room_lights: {room id: [names of the lights the room's switch turns on]};
        room_emitters: {room id: [names of the glowing materials it turns on]}."""
        self.room_lights = {k: set(v) for k, v in room_lights.items()}
        self.room_emitters = {k: set(v) for k, v in room_emitters.items()}
        self.lights = [o for o in scene.objects if o.type == "LIGHT"]
        self.saved_hide = {o.name: o.hide_render for o in self.lights}
        world = scene.world
        self.tree = world.node_tree if world is not None else None
        nodes = self.tree.nodes if self.tree is not None else []
        self.background = next((n for n in nodes if n.type == "BACKGROUND"), None)
        if self.background is None:
            raise RuntimeError("scene world has no Background node")
        self.color = self.background.inputs["Color"]
        self.saved_color = tuple(self.color.default_value)
        self.saved_sources = [l.from_socket for l in self.tree.links if l.to_socket == self.color]
        self.saved_strength = self.background.inputs["Strength"].default_value
        self.emitters = _emission_sockets()

    def _sky(self, on):
        for link in [l for l in self.tree.links if l.to_socket == self.color]:
            self.tree.links.remove(link)
        self.color.default_value = (*config.SKY_BAKE_COLOR, 1.0)
        self.background.inputs["Strength"].default_value = self.saved_strength if on else 0.0

    def _glow(self, names):
        for name, socket, value in self.emitters:
            socket.default_value = value if name in names else 0.0

    def day(self):
        for o in self.lights:
            o.hide_render = self.saved_hide[o.name] or not lamps.is_day_fill(o)
        self._sky(True)
        self._glow(set())

    def room(self, room_id):
        keep = self.room_lights[room_id]
        for o in self.lights:
            o.hide_render = o.name not in keep
        self._sky(False)
        self._glow(self.room_emitters.get(room_id, set()))

    def restore(self):
        for o in self.lights:
            o.hide_render = self.saved_hide[o.name]
        self.background.inputs["Strength"].default_value = self.saved_strength
        self.color.default_value = self.saved_color
        for src in self.saved_sources:
            self.tree.links.new(src, self.color)
        self._glow({name for name, _, _ in self.emitters})
```

In `bake_all`, replace the two lines

```python
    room_lights = {r["id"]: r["light"] for r in state["rooms"] if r["light"]}
    lighting = Lighting(scene, state["day_lights"], room_lights)
```

with

```python
    room_lights = state["room_lights"]
    lighting = Lighting(scene, room_lights, state["room_emitters"])
```

(the later `if c["room"] in room_lights:` stays as it is).

- [ ] **Step 4: Wire the state** in `blender/pipeline/run.py`:
- Add `lamps` to the `from . import (...)` list.
- Then, in `prepare`, after `chunk_list = chunks.build_chunks(static, floor_index)` and before it, change the chunk block to:

```python
    ceilings = {r["light"] for r in room_list if r["light"]}
    found_lamps, lost_lamps = lamps.room_lamps(scene, floor_index, ctx["day_lights"], ceilings)
    found_glows, lost_glows = lamps.split_emitters(static, floor_index)  # before chunking joins the meshes
    switched = {r["id"] for r in room_list if r["light"]}
    lost = [f"{n} (in no room)" for n in lost_lamps + lost_glows]
    lost += [f"{n} (in {room}, which has no ceiling light)"
             for found in (found_lamps, found_glows) for room, names in sorted(found.items())
             if room not in switched for n in names]
    room_lights = {r["id"]: [r["light"]] + found_lamps.get(r["id"], []) for r in room_list if r["light"]}
    room_emitters = {k: v for k, v in found_glows.items() if k in switched}
    for msg in lost:
        print(f"[lamps] WARNING: {msg} is never lit", flush=True)

    chunk_list = chunks.build_chunks(static, floor_index)
```

This block replaces the single existing line `chunk_list = chunks.build_chunks(static, floor_index)`.

Then extend the `st = {...}` dict with:

```python
        "room_lights": room_lights, "room_emitters": room_emitters, "lost_lamps": lost,
        "windows": [], "sky_irradiance": bake.sky_irradiance(scene),
```

- [ ] **Step 5: Add the check.** At the end of `check_scene` in `blender/pipeline/checks.py`, before `return errors`:

```python
    for msg in state.get("lost_lamps", []):
        errors.append(f"lamp or glowing object {msg}: move it into a room with a ceiling light")
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `make test-blender TESTS=test_bake.py`, then `make test-blender`
Expected: all PASS. If `test_end_to_end` fails on `manifest`, that's Task 6's job only if the error mentions `windows` or `version`; nothing in this task changes the manifest.

- [ ] **Step 7: Commit**

```bash
git add blender/pipeline/bake.py blender/pipeline/run.py blender/pipeline/checks.py blender/tests/test_bake.py
git commit -m "Bake: sky-only day layer; each room's light layer includes its lamps and glowing materials

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Exterior windows and manifest version 2 (pipeline)

**Files:**
- Create: `blender/pipeline/windows.py`
- Modify: `blender/pipeline/run.py` (`prepare`), `blender/pipeline/manifest.py`, `blender/tests/test_manifest.py`, `blender/tests/test_checks.py` (`STATE`)
- Test: `blender/tests/test_windows.py`, `blender/tests/test_manifest.py`

**Interfaces:**
- Consumes: the fixture's `Window 3 (Exterior / Alpha) glass` (Task 4); `state["sky_irradiance"]` and `state["windows"]` (Task 5).
- Produces:
  - `windows.exterior_windows(meshes, floor_index) -> [{room, center: [x,y,z], normal: [x,0,z], width, height}]` (three.js space; the normal points outdoors).
  - `manifest.floor_area(floor) -> float`.
  - Manifest JSON version 2 with:
    - `site`;
    - `sky: {irradiance, wattsToScene}`;
    - `windows`;
    - `rooms[].area`.

- [ ] **Step 1: Write the failing tests.** Create `blender/tests/test_windows.py`:

```python
import unittest

import bpy
import numpy as np

from pipeline import rooms, scene_select, windows
from tests import fixture_scene


class WindowTests(unittest.TestCase):
    def test_exterior_glass_becomes_a_window_facing_outdoors(self):
        fixture_scene.build()
        scene = bpy.context.scene
        meshes, _ = scene_select.prepare_scene(scene, bpy.context.view_layer)
        index, _ = rooms.collect_rooms(meshes, scene)
        ws = windows.exterior_windows(meshes, index)
        self.assertEqual(len(ws), 1)
        w = ws[0]
        self.assertEqual(w["room"], "alpha")
        np.testing.assert_allclose(w["center"], [1.5, 1.5, 0.1], atol=1e-3)
        np.testing.assert_allclose(w["normal"], [0.0, 0.0, 1.0], atol=1e-3)  # Blender -Y is three.js +Z
        self.assertAlmostEqual(w["width"], 1.0, places=3)
        self.assertAlmostEqual(w["height"], 1.0, places=3)


if __name__ == "__main__":
    unittest.main()
```

In `blender/tests/test_manifest.py`, add `from pipeline import config, manifest` (replacing `from pipeline import manifest`). Add these keys to `STATE`:

```python
    "windows": [{"room": "alpha", "center": [0.5, 1.5, 0.0], "normal": [0.0, 0.0, 1.0], "width": 1.0, "height": 1.2}],
    "sky_irradiance": 0.6467,
```

Change `test_build`'s version and room assertions to:

```python
        self.assertEqual(m["version"], 2)
        self.assertEqual(m["rooms"][0], {"id": "alpha", "name": "Alpha", "floor": [0, 0, 1, 0, 1, 1],
                                         "switch": "Switch_alpha", "area": 0.5})
        self.assertEqual(m["site"], config.SITE)
        self.assertEqual(m["sky"], {"irradiance": 0.6467, "wattsToScene": config.WATTS_TO_SCENE})
        self.assertEqual(m["windows"], STATE["windows"])
```

and add this test method:

```python
    def test_validate_reports_window_problems(self):
        self.assertIn("no exterior windows: name the glass 'Window N (Exterior / Room) glass'",
                      manifest.validate_manifest(manifest.build_manifest(dict(STATE, windows=[]), RANGES, 1.6)))
        bad = [dict(STATE["windows"][0], room="attic")]
        self.assertIn("windows[0]: unknown room attic",
                      manifest.validate_manifest(manifest.build_manifest(dict(STATE, windows=bad), RANGES, 1.6)))
```

In `blender/tests/test_checks.py`, add the same two keys to its `STATE`:

```python
    "windows": [{"room": "alpha", "center": [0.5, 1.5, 0.0], "normal": [0.0, 0.0, 1.0], "width": 1.0, "height": 1.2}],
    "sky_irradiance": 0.6467,
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `make test-blender TESTS=test_windows.py` and `make test-blender TESTS=test_manifest.py`
Expected: FAIL (no module `windows`; version is 1; no `area`).

- [ ] **Step 3: Implement** `blender/pipeline/windows.py`:

```python
"""Exterior glass panes: the viewer works out from them how much sunlight enters each room."""
import re

import numpy as np

from . import bpyutil, geom

GLASS_RE = re.compile(r"^(?:Glazed Door|Window) \d+ \((?P<a>[^/]+?) / (?P<b>[^)]+?)\) glass$")
EXTERIOR = "Exterior"
PROBE = 0.4  # m from the pane: on the room's side this point lies on the room's floor


def exterior_windows(meshes, floor_index):
    """[{room, center, normal, width, height}] in three.js space, the normal pointing outdoors."""
    out = []
    for o in sorted(meshes, key=lambda o: o.name):
        m = GLASS_RE.match(o.name)
        if not m or EXTERIOR not in (m["a"], m["b"]):
            continue
        room = geom.slugify(m["b"] if m["a"] == EXTERIOR else m["a"])
        co = bpyutil.world_coords(o)
        (cx, cz), _, (nx, nz), width, _ = geom.principal_frame(np.stack([co[:, 0], -co[:, 1]], axis=1))
        if floor_index.locate(cx + nx * PROBE, cz + nz * PROBE) == room:
            nx, nz = -nx, -nz
        y0, y1 = float(co[:, 2].min()), float(co[:, 2].max())
        out.append({
            "room": room,
            "center": [round(cx, 4), round((y0 + y1) / 2, 4), round(cz, 4)],
            "normal": [round(nx, 4) + 0.0, 0.0, round(nz, 4) + 0.0],  # + 0.0 turns -0.0 into 0.0
            "width": round(width, 4),
            "height": round(y1 - y0, 4),
        })
    return out
```

In `blender/pipeline/run.py`:
- Add `windows` to the import list.
- In `prepare`, right after the `found_glows, lost_glows = ...` line from Task 5, add:

```python
    window_list = windows.exterior_windows(static, floor_index)  # also before chunking
```

- In `st`, change `"windows": []` to `"windows": window_list`.

Replace `blender/pipeline/manifest.py`'s import block and `build_manifest`, and extend `validate_manifest`:

```python
"""Assemble and validate manifest.json (pure)."""
from . import config


def floor_area(floor):
    """Area of a flat [x0, z0, x1, z1, x2, z2, ...] triangle list."""
    a = 0.0
    for k in range(0, len(floor) - 5, 6):
        x0, z0, x1, z1, x2, z2 = floor[k:k + 6]
        a += abs((x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0)) / 2
    return round(a, 3)


def build_manifest(state, ranges, eye_height):
    def ref(key, layer):
        name = f"{key}_{layer}"
        return {"file": f"lightmaps/{name}.webp", "range": ranges[name]} if name in ranges else None

    rooms = [
        {"id": r["id"], "name": r["name"], "floor": r["floor"], "switch": state["switches"].get(r["id"]),
         "area": floor_area(r["floor"])}
        for r in state["rooms"]
    ]
    chunks = [
        {"node": c["node"], "room": c["room"], "day": ref(c["key"], "day"), "light": ref(c["key"], "light")}
        for c in state["chunks"]
    ]
    doors = [
        {**{k: d[k] for k in ("node", "hinge", "dir", "width", "openAngle")}, "lightmap": ref(d["key"], "day")}
        for d in state["doors"]
    ]
    return {
        "version": 2, "eyeHeight": eye_height, "spawn": state["spawn"],
        "rooms": rooms, "chunks": chunks, "doors": doors, "viewpoints": state["viewpoints"],
        "site": dict(config.SITE),
        "sky": {"irradiance": round(state["sky_irradiance"], 5), "wattsToScene": config.WATTS_TO_SCENE},
        "windows": state["windows"],
    }
```

In `validate_manifest`, change the version check to

```python
    if m.get("version") != 2:
        errors.append("version must be 2")
```

and add, before `return errors`:

```python
    room_ids = {r["id"] for r in m["rooms"]}
    if not m["windows"]:
        errors.append("no exterior windows: name the glass 'Window N (Exterior / Room) glass'")
    for i, w in enumerate(m["windows"]):
        if w["room"] not in room_ids:
            errors.append(f"windows[{i}]: unknown room {w['room']}")
    if not m["sky"]["irradiance"] > 0:
        errors.append("sky.irradiance must be positive")
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `make test-blender`
Expected: all PASS, including `test_end_to_end` (the fixture has one exterior window).

- [ ] **Step 5: Commit**

```bash
git add blender/pipeline/windows.py blender/pipeline/run.py blender/pipeline/manifest.py blender/tests/test_windows.py blender/tests/test_manifest.py blender/tests/test_checks.py
git commit -m "Manifest v2: site, baked sky irradiance, exterior windows and room areas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Neighbourhood export without a baked sun (pipeline)

**Files:**
- Modify: `blender/pipeline/surroundings.py`, `blender/pipeline/checks.py` (`check_surroundings`), `blender/pipeline/config.py` (remove `SURROUNDINGS_SKY_IRRADIANCE`), `blender/tests/test_surroundings.py`
- Test: `blender/tests/test_surroundings.py`

**Interfaces:**
- Produces: `surroundings.glb` with `NORMAL` on every primitive and no `COLOR_0`. `checks.check_surroundings(out_dir)` now requires `NORMAL`.

- [ ] **Step 1: Update the tests.** In `blender/tests/test_surroundings.py`:
- Delete the `ShadeTests` class and the `import math` and `import numpy as np` lines.
- Replace `test_exports_render_visible_neighbourhood_with_shade` with:

```python
    def test_exports_render_visible_neighbourhood_with_normals_and_no_shade(self):
        self.assertEqual(self.names, ["Exterior grass", "Exterior pine"])
        self.assertEqual(checks.check_surroundings(self.out), [])
        gltf = checks.read_glb_json(self.path)
        self.assertEqual(len(gltf["meshes"]), 2)
        for mesh in gltf["meshes"]:
            for p in mesh["primitives"]:
                self.assertIn("NORMAL", p["attributes"])
                self.assertNotIn("COLOR_0", p["attributes"])
```

- [ ] **Step 2: Run the test and check it fails**

Run: `make test-blender TESTS=test_surroundings.py`
Expected: FAIL (`COLOR_0` is present).

- [ ] **Step 3: Implement.** In `blender/pipeline/surroundings.py`:
- Delete `SHADE`, `SHADE_STORE_SCALE`, `shade`, `day_suns` and `_add_shade`, and the `import numpy as np` line.
- In `export_surroundings`, delete the two lines `suns = day_suns(scene, visible)` and `for c in copies: _add_shade(c, suns)`.
- Change the export call to `export.export_glb(copies, path, export_vertex_color="NONE")`.
- Replace the module docstring with:

```python
"""The neighbourhood seen through the windows, exported apart from the apartment as surroundings.glb.

It is kilometre-scale, so it skips chunking, collision and lightmaps. Each object goes out as it is, with its
normals: the viewer lights it live with the same sun and sky as the apartment (see web/src/surroundings.ts).
"""
```

- Update the imports to `from . import export, proc_materials, scene_select` (drop `config` if it's no longer used).

In `blender/pipeline/checks.py`, replace `check_surroundings` with:

```python
def check_surroundings(out_dir):
    """surroundings.glb is optional, but when present every primitive needs normals: the viewer lights it live."""
    path = os.path.join(out_dir, "surroundings.glb")
    if not os.path.exists(path):
        return []
    for mesh in read_glb_json(path)["meshes"]:
        if any("NORMAL" not in p["attributes"] for p in mesh["primitives"]):
            return [f"surroundings.glb mesh {mesh.get('name')!r}: a primitive lacks NORMAL"]
    return []
```

In `blender/pipeline/config.py`:
- Delete `SURROUNDINGS_SKY_IRRADIANCE = 1.0`.
- Change the comment above `SURROUNDINGS_COLLECTION_PREFIXES` to:

```python
# Collections (and their sub-collections) seen through the windows. They are kilometre-scale, so
# instead of being chunked and lightmapped they go to surroundings.glb, which the viewer lights live.
```

Then run `grep -rn "SURROUNDINGS_SKY_IRRADIANCE\|day_suns\|_add_shade" blender/` and expect no matches.

- [ ] **Step 4: Run the tests and check they pass**

Run: `make test-blender`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add blender/pipeline/surroundings.py blender/pipeline/checks.py blender/pipeline/config.py blender/tests/test_surroundings.py
git commit -m "Surroundings: export normals instead of a baked sun, so the viewer lights them live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sun position in Python, reference renders with the real sun, Makefile fixes

**Files:**
- Create: `blender/pipeline/sun.py`, `blender/render_refs.py`
- Modify: `Makefile`
- Test: `blender/tests/test_sun.py`

**Interfaces:**
- Produces:
  - `sun.solar_position(utc_seconds, lat, lon) -> (azimuth, elevation)`
  - `sun.lisbon_to_utc_seconds(text, tz="Europe/Lisbon")`
  - `sun.blender_direction(az, el, y_bearing) -> (x, y, z)`
  - `sun.typical_irradiance(climate_dict, utc_seconds) -> (beam, diffuse)`
  - `sun.sun_strength(beam, el)`
  - `make render-refs [SUN=YYYY-MM-DDTHH:MM]` writes `build/ref/<Cam>.png`, or `build/ref/<Cam>_<YYYY-MM-DDTHHMM>.png` with `SUN`.

- [ ] **Step 1: Write the failing test** `blender/tests/test_sun.py`:

```python
import math
import unittest
from datetime import datetime, timezone

from pipeline import sun

PORTO = (41.117327, -8.653914)


def _utc(*args):
    return datetime(*args, tzinfo=timezone.utc).timestamp()


class SolarPositionTests(unittest.TestCase):
    def test_nrel_reference_case(self):
        az, el = sun.solar_position(_utc(2003, 10, 17, 19, 30, 30), 39.742476, -105.1786)
        self.assertLess(abs(90 - el - 50.11162), 0.05)
        self.assertLess(abs(az - 194.34024), 0.05)

    def test_porto_solstice_noons(self):
        for day, expected in (("2026-06-21", 72.33), ("2026-12-21", 25.48)):
            base = sun.lisbon_to_utc_seconds(day + "T00:00")
            best = max(sun.solar_position(base + 60 * m, *PORTO)[1] for m in range(1440))
            self.assertAlmostEqual(best, expected, delta=0.05)

    def test_lisbon_summer_time(self):
        self.assertEqual(sun.lisbon_to_utc_seconds("2026-03-29T12:00"), _utc(2026, 3, 29, 11))
        self.assertEqual(sun.lisbon_to_utc_seconds("2026-10-25T12:00"), _utc(2026, 10, 25, 12))

    def test_blender_direction(self):
        x, y, z = sun.blender_direction(142.1, 0.0, 142.1)
        self.assertAlmostEqual(x, 0.0)
        self.assertAlmostEqual(y, 1.0)
        self.assertAlmostEqual(z, 0.0)
        self.assertAlmostEqual(sun.blender_direction(232.1, 0.0, 142.1)[0], 1.0)


class ClimateTests(unittest.TestCase):
    CLIMATE = {"months": [{"month": m + 1, "sunshineHours": 0, "cloudCover": 0, "hours": [
        {"utcHour": h + 0.5, "gb": 100.0 if h == 12 else 0.0, "gd": float(m + 1), "gcs": 0.0} for h in range(24)]}
        for m in range(12)]}

    def test_typical_irradiance(self):
        beam, diffuse = sun.typical_irradiance(self.CLIMATE, _utc(2026, 1, 16, 12, 30))
        self.assertAlmostEqual(beam, 100.0)
        self.assertAlmostEqual(diffuse, 1.0, delta=0.01)
        beam, diffuse = sun.typical_irradiance(self.CLIMATE, _utc(2026, 2, 1))
        self.assertEqual(beam, 0.0)
        self.assertAlmostEqual(diffuse, 1.5)

    def test_sun_strength(self):
        self.assertEqual(sun.sun_strength(500, -1), 0)
        self.assertAlmostEqual(sun.sun_strength(500, 30), 1000)
        self.assertAlmostEqual(sun.sun_strength(10, 1), 10 / math.sin(math.radians(3)))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and check it fails**

Run: `make test-blender TESTS=test_sun.py`
Expected: FAIL, `ImportError: cannot import name 'sun'`.

- [ ] **Step 3: Implement** `blender/pipeline/sun.py`. It mirrors `web/src/sun.ts` and `web/src/climate.ts`; keep them in step.

```python
"""Sun position (NOAA solar calculator equations, after Meeus), Lisbon time and the typical-month irradiance.

Mirrors web/src/sun.ts and web/src/climate.ts so Cycles reference renders use the same sun as the viewer.
"""
import calendar
import math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

MIN_ELEVATION = 3.0


def _refraction(elev):
    if elev > 85:
        return 0.0
    t = math.tan(math.radians(elev))
    if elev > 5:
        r = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5
    elif elev > -0.575:
        r = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)))
    else:
        r = -20.772 / t
    return r / 3600


def solar_position(utc_seconds, lat, lon):
    """(azimuth clockwise from north, apparent elevation) in degrees."""
    jd = utc_seconds / 86400 + 2440587.5
    t = (jd - 2451545) / 36525
    l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
    m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    mr = math.radians(m)
    c = (math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t))
         + math.sin(2 * mr) * (0.019993 - 0.000101 * t) + math.sin(3 * mr) * 0.000289)
    omega = math.radians(125.04 - 1934.136 * t)
    apparent = math.radians(l0 + c - 0.00569 - 0.00478 * math.sin(omega))
    eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
    eps = math.radians(eps0 + 0.00256 * math.cos(omega))
    decl = math.asin(math.sin(eps) * math.sin(apparent))
    y = math.tan(eps / 2) ** 2
    l0r = math.radians(l0)
    eq_time = 4 * math.degrees(y * math.sin(2 * l0r) - 2 * e * math.sin(mr)
                               + 4 * e * y * math.sin(mr) * math.cos(2 * l0r)
                               - 0.5 * y * y * math.sin(4 * l0r) - 1.25 * e * e * math.sin(2 * mr))
    minutes = (utc_seconds % 86400) / 60
    true_solar = (minutes + eq_time + 4 * lon) % 1440
    hour_angle = true_solar / 4 - 180
    latr, har = math.radians(lat), math.radians(hour_angle)
    cos_zenith = math.sin(latr) * math.sin(decl) + math.cos(latr) * math.cos(decl) * math.cos(har)
    zenith = math.acos(max(-1.0, min(1.0, cos_zenith)))
    denom = math.cos(latr) * math.sin(zenith)
    if abs(denom) < 1e-12:
        az = 180.0 if lat > math.degrees(decl) else 0.0
    else:
        a = math.degrees(math.acos(max(-1.0, min(1.0, (math.sin(latr) * math.cos(zenith) - math.sin(decl)) / denom))))
        az = (a + 180) % 360 if hour_angle > 0 else (540 - a) % 360
    elev = 90 - math.degrees(zenith)
    return az, elev + _refraction(elev)


def lisbon_to_utc_seconds(text, tz="Europe/Lisbon"):
    """'2026-12-21T10:00' read as local time in tz -> UTC Unix seconds."""
    return datetime.fromisoformat(text).replace(tzinfo=ZoneInfo(tz)).astimezone(timezone.utc).timestamp()


def blender_direction(az, el, y_bearing):
    """Unit vector toward the sun in Blender space, given the compass bearing of Blender +Y."""
    rel, e = math.radians(az - y_bearing), math.radians(el)
    return (math.sin(rel) * math.cos(e), math.cos(rel) * math.cos(e), math.sin(e))


def _profile(month, hour, key):
    x = (hour - 0.5) % 24
    i = int(math.floor(x))
    f = x - i
    a = month["hours"][i][key]
    return a + (month["hours"][(i + 1) % 24][key] - a) * f


def typical_irradiance(climate, utc_seconds):
    """(beam, diffuse) W/m² on a horizontal surface from climate.json: the month's average day, blended toward the
    neighbouring month away from mid-month, interpolated between hourly means centred on HH:30 UTC."""
    dt = datetime.fromtimestamp(utc_seconds, timezone.utc)
    hour = dt.hour + dt.minute / 60 + dt.second / 3600
    pos = (dt.day - 1 + hour / 24) / calendar.monthrange(dt.year, dt.month)[1]
    m = dt.month - 1
    other = (m - 1) % 12 if pos < 0.5 else (m + 1) % 12
    w = abs(pos - 0.5)
    months = climate["months"]

    def mix(key):
        return (1 - w) * _profile(months[m], hour, key) + w * _profile(months[other], hour, key)

    return mix("gb"), mix("gd")


def sun_strength(beam, el):
    """Direct-normal W/m² from horizontal beam W/m²."""
    if el <= 0:
        return 0.0
    return beam / math.sin(math.radians(max(el, MIN_ELEVATION)))
```

- [ ] **Step 4: Run the test and check it passes**

Run: `make test-blender TESTS=test_sun.py`
Expected: PASS (6 tests).

- [ ] **Step 5: Write** `blender/render_refs.py`:

```python
"""Cycles reference renders of the viewpoint cameras, to compare with the viewer.

Run through the Makefile (`make render-refs`, or `make render-refs SUN=2026-12-21T10:00`). With --sun the scene
is lit like the viewer at that moment (Lisbon time): the Sun lamp is pointed and sized from the site, the NOAA
position and the typical-month data; the sky is the day bake's flat sky scaled to the typical diffuse light; lamps
and glowing materials are off. Without --sun the scene renders as it is.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from pipeline import config, lamps, sun  # noqa: E402


def light_for(scene, when, climate):
    site = config.SITE
    t = sun.lisbon_to_utc_seconds(when, site["timeZone"])
    az, el = sun.solar_position(t, site["lat"], site["lon"])
    beam, diffuse = sun.typical_irradiance(climate, t)
    lamp = scene.objects["Sun"]
    lamp.rotation_mode = "QUATERNION"
    lamp.rotation_quaternion = Vector(sun.blender_direction(az, el, site["yBearing"])).to_track_quat("Z", "Y")
    lamp.data.energy = sun.sun_strength(beam, el) * config.WATTS_TO_SCENE
    lamp.hide_render = False
    for o in scene.objects:
        if o.type == "LIGHT" and o is not lamp:
            o.hide_render = o.hide_render or not lamps.is_day_fill(o)
    tree = scene.world.node_tree
    bg = next(n for n in tree.nodes if n.type == "BACKGROUND")
    for link in [l for l in tree.links if l.to_socket == bg.inputs["Color"]]:
        tree.links.remove(link)
    bg.inputs["Color"].default_value = (*config.SKY_BAKE_COLOR, 1.0)
    r, g, b = config.SKY_BAKE_COLOR
    bg.inputs["Strength"].default_value = diffuse * config.WATTS_TO_SCENE / (math.pi * (0.2126 * r + 0.7152 * g + 0.0722 * b))
    for mat in bpy.data.materials:
        for n in (mat.node_tree.nodes if mat.node_tree else []):
            if n.type == "BSDF_PRINCIPLED":
                n.inputs["Emission Strength"].default_value = 0.0
            elif n.type == "EMISSION":
                n.inputs["Strength"].default_value = 0.0
    print(f"[refs] {when}: sun az {az:.1f} el {el:.1f}, strength {lamp.data.energy:.3f}, "
          f"sky strength {bg.inputs['Strength'].default_value:.3f}", flush=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="render_refs")
    p.add_argument("--out", required=True)
    p.add_argument("--sun")
    p.add_argument("--climate")
    args = p.parse_args(argv)
    scene = bpy.context.scene
    suffix = ""
    if args.sun:
        with open(args.climate) as f:
            light_for(scene, args.sun, json.load(f))
        suffix = "_" + args.sun.replace(":", "")
    scene.frame_set(scene.frame_end)
    scene.render.resolution_percentage = 50
    scene.render.image_settings.file_format = "PNG"
    for cam in config.VIEWPOINT_CAMERAS:
        if cam not in scene.objects:
            continue
        scene.camera = scene.objects[cam]
        scene.render.filepath = os.path.abspath(os.path.join(args.out, f"{cam}{suffix}.png"))
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Update the Makefile.** Replace the `render-refs` rule with:

```make
# Cycles renders of the viewpoints. SUN=2026-12-21T10:00 (Lisbon time) lights them like the viewer at that
# moment: the real sun and the month's typical sky, with lamps off.
render-refs:
	$(SYNC) && cp "$(SOURCE)" $(STAGE)/source.blend && cp web/public/assets/climate.json $(STAGE)/climate.json && mkdir -p $(STAGE)/ref
	$(IN_STAGE) -b --factory-startup source.blend --python-exit-code 1 --python blender/render_refs.py -- --out ref $(if $(SUN),--sun $(SUN) --climate climate.json)
	mkdir -p $(BUILD)/ref && rsync -a $(STAGE)/ref/ $(BUILD)/ref/
```

In the `export-preview export-final` rule, `rsync -a --delete` into `web/public/assets/` would delete the committed audio, climate data and credits, which no export writes. Exclude them (excluded files are also protected from `--delete`). Change that rule's last line to:

```make
	mkdir -p $(OUT) $(BUILD) && rsync -a --delete --exclude audio/ --exclude climate.json --exclude DATA-SOURCES.md $(STAGE)/out/assets/ $(OUT)/ && rsync -a $(STAGE)/out/build/ $(BUILD)/
```

- [ ] **Step 7: Check that the Makefile still parses**

Run: `make -n render-refs SUN=2026-12-21T10:00 | tail -2` and `make -n export-preview | tail -1`
Expected: the first prints the Blender command containing `--sun 2026-12-21T10:00 --climate climate.json`. The second prints the rsync line containing `--exclude audio/`.

- [ ] **Step 8: Commit**

```bash
git add blender/pipeline/sun.py blender/render_refs.py blender/tests/test_sun.py Makefile
git commit -m "Refs: Cycles renders lit by the real sun at a given moment; exports keep audio and climate data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Fix the neighbourhood in the source .blend, then a preview export

This task needs the user. Their source file is `~/Documents/Untitled.blend`. A Blender launched by Claude must not open it.

**Files:**
- Create: `blender/tools/fix_neighbourhood.py`
- Updated by the user: `Untitled.blend` (copied in)
- Generated, not committed until Task 15: `web/public/assets/*`

- [ ] **Step 1: Write the script** `blender/tools/fix_neighbourhood.py`:

```python
"""One-off: move the neighbourhood 7.44 m along -X so the flat sits where it really is.

The flat is the unit whose balcony end meets the bend of the south-east facade (checked against satellite imagery;
docs/superpowers/specs/2026-10-23-sun-simulation-design.md). Run once, in the Blender session that has
~/Documents/Untitled.blend open, then save. Refuses to run twice.
"""
import bmesh
import bpy
from mathutils import Matrix, Vector

SHIFT = -7.44
KEEP = {f"Building lower facade {s}" for s in "NSEW"}  # directly under the flat: they stay
BLOCK = "Exterior block brick"  # the rest of the building at the flat's level, with a gap for the flat
MARK = "site_shift_x"

top = bpy.data.collections["Exterior - neighbourhood"]
if top.get(MARK) is not None:
    raise RuntimeError(f"already applied: {top[MARK]} m")
objs = {o for c in [top, *top.children_recursive] for o in c.objects}
block = bpy.data.objects[BLOCK]
mw = block.matrix_world
if any(abs(mw[i][j] - (1.0 if i == j else 0.0)) > 1e-6 for i in range(4) for j in range(4)):
    raise RuntimeError(f"{BLOCK} is expected to sit at the origin with no rotation or scale")

move = Matrix.Translation(Vector((SHIFT, 0.0, 0.0)))
moved = 0
for o in objs:
    if o.name in KEEP or o.name == BLOCK or o.parent in objs:  # children follow their parent
        continue
    o.matrix_world = move @ o.matrix_world
    moved += 1
bm = bmesh.new()
bm.from_mesh(block.data)
for v in bm.verts:
    v.co.x += SHIFT
    if abs(v.co.x - (-3.6 + SHIFT)) < 0.02:  # the gap's -X side follows the flat back to x = -3.6
        v.co.x = -3.6
    elif abs(v.co.x - (3.6 + SHIFT)) < 0.02:  # and its +X side to x = 3.6
        v.co.x = 3.6
degenerate = [f for f in bm.faces if f.calc_area() < 1e-6]  # the old front piece between the gap and the bend
bmesh.ops.delete(bm, geom=degenerate, context="FACES")
bm.to_mesh(block.data)
bm.free()
block.data.update()
top[MARK] = SHIFT
xs = sorted({round(v.co.x, 2) for v in block.data.vertices})
print(f"moved {moved} objects; {BLOCK} x values now {xs}; removed {len(degenerate)} face(s)")
```

- [ ] **Step 2: Commit the script**

```bash
git add blender/tools/fix_neighbourhood.py
git commit -m "Tools: one-off script that moves the neighbourhood to the flat's real position

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Apply it with the user.** Ask the user to open `~/Documents/Untitled.blend` in Blender (with the Blender MCP add-on connected), and to confirm. Then:
  - call `mcp__blender__get_scene_info` to check it's the right file (the `Exterior - neighbourhood` collection exists);
  - run the script's full text with `mcp__blender__execute_blender_code`.

  Expected output: `moved … objects; Exterior block brick x values now [-23.05, -23.04, -22.11, -13.91, -3.6, 3.6, 29.46, 30.79]; removed 1 face(s)`. The values may differ by ±0.01.

  If there is no MCP connection, give the user the script to paste into Blender's Text Editor and run (Alt+P).

- [ ] **Step 4: Check it visually.** Call `mcp__blender__look` from above. The south facade of the building (the long `Exterior block brick` wall running toward +X and −Y) should start at the flat's balcony corner (x 3.6, y 9.09).

- [ ] **Step 5: The user saves and copies the file in.** Ask the user to save in Blender (Cmd+S). Then run:

```bash
cp ~/Documents/Untitled.blend .
```

Run this copy yourself only if the user agrees; reading `~/Documents` from the shell is fine, since only Blender must stay out of it.

- [ ] **Step 6: Preview export**

Run: `make export-preview` (about 1 minute)
Expected: `Export OK`. If it prints `EXPORT CHECKS FAILED` with `lamp or glowing object …`, the named lamp or object sits outside every room with a ceiling light. Report it to the user and stop: the fix is a modelling decision.

- [ ] **Step 7: Check the manifest**

Run: `node -e "const m=require('./web/public/assets/manifest.json');console.log(m.version,m.site,m.sky,m.windows.map(w=>w.room))"`
Expected:
- `2`;
- the site object;
- `sky.irradiance` around 0.65;
- windows for `quarto-01`, `quarto-02`, `marquise` and `sala`.

Then `git status --short web/public/assets` shows the changed assets: **do not commit them** (preview quality; Task 15 replaces them). Also check that `web/public/assets/audio/` and `climate.json` are still there.

- [ ] **Step 8: Commit the source file**

```bash
git add Untitled.blend
git commit -m "Model: neighbourhood moved 7.44 m so the flat sits at its real position

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Viewer reads manifest version 2 and the climate data

**Files:**
- Modify: `web/src/manifest.ts`, `web/src/loader.ts`, `web/tests/fixtures.ts`, `web/tests/manifest.test.ts`
- Test: `web/tests/manifest.test.ts`

**Interfaces:**
- Consumes: `parseClimate` and `Climate` (Task 2).
- Produces:
  - `SiteInfo { lat; lon; timeZone; yBearing }`
  - `SkyInfo { irradiance; wattsToScene }`
  - `WindowInfo { room; center: [n,n,n]; normal: [n,n,n]; width; height }`
  - `RoomInfo.area: number`
  - `Manifest` with `version: 2; site; sky; windows`
  - `LoadedAssets.climate: Climate`

- [ ] **Step 1: Update the fixture and tests.** In `web/tests/fixtures.ts`:
- Set `version: 2`.
- Add `area: 9` to room `alpha` and `area: 8.4` to room `beta`.
- Add, after `viewpoints`:

```ts
    site: { lat: 41.117327, lon: -8.653914, timeZone: 'Europe/Lisbon', yBearing: 142.1 },
    sky: { irradiance: 0.6467, wattsToScene: 0.0044444 },
    windows: [{ room: 'alpha', center: [1.5, 1.5, 0.1], normal: [0, 0, 1], width: 1, height: 1 }],
```

In `web/tests/manifest.test.ts`, extend `accepts a valid manifest` with:

```ts
    expect(m.version).toBe(2);
    expect(m.rooms[0].area).toBe(9);
    expect(m.site.timeZone).toBe('Europe/Lisbon');
    expect(m.sky.irradiance).toBeCloseTo(0.6467);
    expect(m.windows[0].normal).toEqual([0, 0, 1]);
```

and change `rejects other versions` to:

```ts
  it('rejects other versions', () => {
    expect(() => parseManifest({ ...(sampleManifest() as object), version: 1 })).toThrow('version');
  });

  it('names a broken window field', () => {
    const bad = sampleManifest() as { windows: { normal: unknown }[] };
    bad.windows[0].normal = [0, 1];
    expect(() => parseManifest(bad)).toThrow('windows[0].normal');
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `cd web && npx vitest run tests/manifest.test.ts`
Expected: FAIL (`version: expected 1, got 2`).

- [ ] **Step 3: Implement.** In `web/src/manifest.ts`:
- Add `area: number` to `RoomInfo`.
- Add these interfaces:

```ts
export interface SiteInfo { lat: number; lon: number; timeZone: string; yBearing: number }
/** The baked sky's irradiance on an upward face, and the factor from real W/m² to the scene's light units. */
export interface SkyInfo { irradiance: number; wattsToScene: number }
/** An exterior glass pane in three.js space; the normal points outdoors. */
export interface WindowInfo { room: string; center: [number, number, number]; normal: [number, number, number]; width: number; height: number }
```

- Change `Manifest` to `version: 2;` and add `site: SiteInfo; sky: SkyInfo; windows: WindowInfo[];`.
- In `parseManifest`, change the version check to `if (m.version !== 2) throw new ManifestError(\`version: expected 2, got ${String(m.version)}\`);` and return `version: 2`.
- Add `area: num(r.area, \`rooms[${i}].area\`),` to rooms.
- Before `parseManifest` returns, add:

```ts
    site: (() => {
      const s = obj(m.site, 'site');
      return { lat: num(s.lat, 'site.lat'), lon: num(s.lon, 'site.lon'), timeZone: str(s.timeZone, 'site.timeZone'), yBearing: num(s.yBearing, 'site.yBearing') };
    })(),
    sky: (() => {
      const s = obj(m.sky, 'sky');
      return { irradiance: num(s.irradiance, 'sky.irradiance'), wattsToScene: num(s.wattsToScene, 'sky.wattsToScene') };
    })(),
    windows: arr(m.windows, 'windows').map((v, i) => {
      const w = obj(v, `windows[${i}]`);
      return {
        room: str(w.room, `windows[${i}].room`),
        center: vec(w.center, 3, `windows[${i}].center`) as [number, number, number],
        normal: vec(w.normal, 3, `windows[${i}].normal`) as [number, number, number],
        width: num(w.width, `windows[${i}].width`),
        height: num(w.height, `windows[${i}].height`),
      };
    }),
```

In `web/src/loader.ts`:
- Import `{ type Climate, parseClimate } from './climate'`.
- Add `climate: Climate;` to `LoadedAssets`.
- After the `collision` line, add `const climate = parseClimate(await fetchJson(\`${base}climate.json\`));`.
- Add `climate` to the returned object.

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd web && npm test`
Expected: PASS. Then `npx tsc --noEmit` passes too.

- [ ] **Step 5: Commit**

```bash
git add web/src/manifest.ts web/src/loader.ts web/tests/fixtures.ts web/tests/manifest.test.ts
git commit -m "Viewer: read manifest v2 (site, sky, windows, room areas) and the climate data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Sky scale, room fills, glows and shadow flags in the apartment

**Files:**
- Modify: `web/src/lightmaps.ts`, `web/src/scene-setup.ts`, `web/src/world.ts`, `web/tests/lightmaps.test.ts`, `web/tests/scene-setup.test.ts`
- Test: those two test files, plus `web/tests/world.test.ts` (new)

**Interfaces:**
- Produces:
  - `LightmapBinding` gains `sky: { value: number }` and `fill: { value: Color }`; shader uniforms `lmSkyScale` and `lmFill`; cache key `'room-lightmap-v2'`.
  - `prepareMeshes` sets `castShadow` and `receiveShadow` (false for glass).
  - `World` gains `root`, `sky`, `fills: Map<string, { value: Color }>`, `glows: Glow[]` and `occluders: Mesh[]`.
  - `interface Glow { room; material; base }` and `applyGlows(glows, lights)`.

- [ ] **Step 1: Update the tests.** In `web/tests/lightmaps.test.ts`:
- Import `Color` from three.
- Change the `applyLightmap` test to:

```ts
  it('wires uniforms through onBeforeCompile, sharing the intensity, sky and fill objects', () => {
    const m = new MeshStandardMaterial();
    const intensity = { value: 0.25 };
    const sky = { value: 0.8 };
    const fill = { value: new Color(0.1, 0.05, 0) };
    applyLightmap(m, { day: new Texture(), dayRange: 4, light: new Texture(), lightRange: 2, intensity, sky, fill }, 3);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.lmLightIntensity).toBe(intensity);
    expect(shader.uniforms.lmSkyScale).toBe(sky);
    expect(shader.uniforms.lmFill).toBe(fill);
    expect(shader.uniforms.lmScale.value).toBe(3);
    expect(shader.uniforms.lmDayRange.value).toBe(4);
    expect(m.customProgramCacheKey()).toBe('room-lightmap-v2');
  });
```

- In `shader patches`, add `expect(f).toContain('uniform float lmSkyScale;'); expect(f).toContain('uniform vec3 lmFill;'); expect(f).toContain('+ lmFill');`.

In `web/tests/scene-setup.test.ts`:
- Import `Color`.
- In the `prepareMeshes` test, add `sky: { value: 1 }, fill: { value: new Color() }` to `binding`, and after the existing expectations add:

```ts
    expect(a.castShadow).toBe(true);
    expect(a.receiveShadow).toBe(true);
    expect(b.castShadow).toBe(false);
    expect(b.receiveShadow).toBe(false);
```

Create `web/tests/world.test.ts`:

```ts
import { MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { RoomLights } from '../src/lightmaps';
import { applyGlows } from '../src/world';

describe('applyGlows', () => {
  it('dims a glowing material with its room light', () => {
    const lights = new RoomLights(['sala'], 0.4);
    const material = new MeshStandardMaterial({ emissive: 0xffeecc, emissiveIntensity: 3 });
    const glows = [{ room: 'sala', material, base: 3 }];
    applyGlows(glows, lights);
    expect(material.emissiveIntensity).toBe(0);
    lights.toggle('sala');
    lights.update(1);
    applyGlows(glows, lights);
    expect(material.emissiveIntensity).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `cd web && npx vitest run tests/lightmaps.test.ts tests/scene-setup.test.ts tests/world.test.ts`
Expected: FAIL (no `lmSkyScale`; no shadow flags; no `applyGlows`).

- [ ] **Step 3: Implement `lightmaps.ts`:**
- Import `Color` (as a type: `import { type Color, DataTexture, ... }`).
- Add to `LightmapBinding`:

```ts
  /** Shared by every lightmapped material: how bright the baked sky is right now. */
  sky: { value: number };
  /** Per room: flat bounce light from sun entering its windows. */
  fill: { value: Color };
```

In `FRAGMENT_DECL`, add `uniform float lmSkyScale;` and `uniform vec3 lmFill;` after `uniform float lmScale;`. Replace `ACCUMULATE` with:

```ts
const ACCUMULATE = /* glsl */ `
#if defined( RE_IndirectDiffuse )
	irradiance += ( lmSkyScale * rgbmDecode( texture( lmDay, vLmUv ), lmDayRange )
		+ lmLightIntensity * rgbmDecode( texture( lmLight, vLmUv ), lmLightRange ) ) * lmScale
		+ lmFill;
#endif`;
```

In `applyLightmap`, add `lmSkyScale: b.sky, lmFill: b.fill,` to `uniforms`, and change the cache key to `'room-lightmap-v2'`. The existing test checks `f.indexOf('irradiance += (')`; that string still occurs.

**Implement `scene-setup.ts`:**
- In `prepareMeshes`, in the glass branch, add `mesh.castShadow = false; mesh.receiveShadow = false;` before `return`.
- For other meshes, add `mesh.castShadow = true; mesh.receiveShadow = true;` before `mesh.material = m;`.

**Implement `world.ts`:**
- Add `Color` to the three import.
- Replace the `World` interface with:

```ts
/** A glowing material (lampshade, screen) that follows its room's light. */
export interface Glow { room: string; material: MeshStandardMaterial; base: number }
export interface World {
  root: Object3D;
  lights: RoomLights;
  doors: DoorRuntime[];
  targets: Map<Object3D, Target>;
  switches: Map<string, Object3D>;
  pickables: Object3D[];
  rooms: RoomLocator;
  collision: Collision;
  lightmapped: MeshStandardMaterial[];
  /** Multiplies every baked sky layer; the daylight sets it from the time of day. */
  sky: { value: number };
  /** Per room: flat bounce light from sun entering its windows. */
  fills: Map<string, { value: Color }>;
  glows: Glow[];
  /** Meshes that block sunlight: everything except glass. */
  occluders: Mesh[];
}
```

In `buildWorld`, before the chunk loop, add:

```ts
  const sky = { value: 1 };
  const noFill = { value: new Color(0, 0, 0) };
  const fills = new Map(manifest.rooms.map((r) => [r.id, { value: new Color(0, 0, 0) }] as const));
  const glows: Glow[] = [];
```

In the chunk loop:
- Pass `sky` and `fill: (chunk.room && fills.get(chunk.room)) || noFill` in the `prepareMeshes` binding.
- After `lightmapped.push(...mats);`, add:

```ts
    if (chunk.room && lights.has(chunk.room)) {
      for (const m of mats) {
        if (m.emissive.r + m.emissive.g + m.emissive.b > 0) glows.push({ room: chunk.room, material: m, base: m.emissiveIntensity });
      }
    }
```

In the door loop's `prepareMeshes` binding, add `sky, fill: noFill`. Before `return`, add:

```ts
  const occluders: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh && o.castShadow) occluders.push(o as Mesh);
  });
```

and return `{ root, lights, doors, targets, switches, pickables, rooms: new RoomLocator(manifest.rooms), collision, lightmapped, sky, fills, glows, occluders }`.

Add at the end of the file:

```ts
/** Lampshades and screens glow only while their room's light is on. */
export function applyGlows(glows: Glow[], lights: RoomLights): void {
  for (const g of glows) g.material.emissiveIntensity = g.base * lights.uniform(g.room).value;
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lightmaps.ts web/src/scene-setup.ts web/src/world.ts web/tests/lightmaps.test.ts web/tests/scene-setup.test.ts web/tests/world.test.ts
git commit -m "Viewer: sky scale and per-room fill uniforms, glows that follow the room light, shadow flags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Neighbourhood lit live (`web/src/surroundings.ts`)

**Files:**
- Modify: `web/src/surroundings.ts`, `web/src/config.ts` (remove `surroundingsShadeScale`), `web/tests/surroundings.test.ts`

**Interfaces:**
- Produces:
  - `interface SurroundingsLight { sunDir: { value: Vector3 }; sunLight: { value: Color }; skyLight: { value: number } }`
  - `makeSurroundingsLight()`
  - `prepareSurroundings(root, light)`
  - `Surroundings.light` and `Surroundings.setSky(color: Color)`

- [ ] **Step 1: Rewrite the material test.** In `web/tests/surroundings.test.ts`:
- Replace the second `it(...)` with the test below.
- Update the imports to `BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, Texture` and `{ groundOffsets, makeSurroundingsLight, prepareSurroundings }`. Drop the `CONFIG` import.

```ts
  it('lights every mesh live from shared sun and sky uniforms, keeping colour, texture and ground offsets', () => {
    const root = new Group();
    const grass = new Mesh(new PlaneGeometry(100, 100).rotateX(-Math.PI / 2), new MeshStandardMaterial({ name: 'Ext grass', color: 0x204010 }));
    const map = new Texture();
    const wall = new Mesh(new BoxGeometry(10, 6, 10), new MeshStandardMaterial({ name: 'Ext wall pink', color: 0x806050, map }));
    root.add(grass, wall);
    const light = makeSurroundingsLight();
    prepareSurroundings(root, light);

    const g = grass.material as ShaderMaterial;
    const w = wall.material as ShaderMaterial;
    expect(g).toBeInstanceOf(ShaderMaterial);
    expect(g.name).toBe('Ext grass');
    expect(g.uniforms.sunDir).toBe(light.sunDir);
    expect(w.uniforms.skyLight).toBe(light.skyLight);
    expect((w.uniforms.color.value as Color).getHex()).toBe(new MeshStandardMaterial({ color: 0x806050 }).color.getHex());
    expect(w.uniforms.map.value).toBe(map);
    expect(w.defines.USE_SURROUNDINGS_MAP).toBe('');
    expect(g.defines.USE_SURROUNDINGS_MAP).toBeUndefined();
    expect(g.polygonOffset).toBe(true);
    expect(g.polygonOffsetFactor).toBe(1);
    expect(w.polygonOffset).toBe(false);
  });
```

- [ ] **Step 2: Run the test and check it fails**

Run: `cd web && npx vitest run tests/surroundings.test.ts`
Expected: FAIL (`makeSurroundingsLight` is not exported).

- [ ] **Step 3: Implement.** In `web/src/surroundings.ts`:
- Change the three import to `Box3, Color, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, Scene, ShaderMaterial, Vector3, type WebGLRenderer`.
- Replace `prepareSurroundings` with:

```ts
export interface SurroundingsLight {
  /** Unit vector toward the sun, three.js space. */
  sunDir: { value: Vector3 };
  /** Sun colour times its direct-normal strength, scene units. */
  sunLight: { value: Color };
  /** Sky irradiance on an upward face, scene units. */
  skyLight: { value: number };
}

export function makeSurroundingsLight(): SurroundingsLight {
  return { sunDir: { value: new Vector3(0, 1, 0) }, sunLight: { value: new Color(0, 0, 0) }, skyLight: { value: 0 } };
}

const VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = normalize( mat3( modelMatrix ) * normal );
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

// Lambert sun plus a sky that lights an upward face fully, a wall half and a downward face not at all
// (the same formula the export used to bake). No shadows between buildings.
const FRAGMENT = /* glsl */ `
#include <common>
uniform vec3 color;
uniform sampler2D map;
uniform vec3 sunDir;
uniform vec3 sunLight;
uniform float skyLight;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 n = normalize( vNormal );
  vec3 albedo = color;
#ifdef USE_SURROUNDINGS_MAP
  albedo *= texture2D( map, vUv ).rgb;
#endif
  vec3 e = vec3( skyLight * ( 1.0 + n.y ) * 0.5 ) + sunLight * max( dot( n, sunDir ), 0.0 );
  gl_FragColor = vec4( albedo * e / PI, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Swap the glTF materials for the live sun-and-sky shader. */
export function prepareSurroundings(root: Object3D, light: SurroundingsLight): void {
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  const size = new Vector3();
  const offsets = groundOffsets(
    meshes.map((m) => {
      new Box3().setFromObject(m).getSize(size);
      return { flat: size.y < CONFIG.surroundingsFlatHeight, area: size.x * size.z };
    }),
  );
  meshes.forEach((m, i) => {
    const src = m.material as MeshStandardMaterial;
    m.material = new ShaderMaterial({
      name: src.name,
      uniforms: { color: { value: src.color.clone() }, map: { value: src.map }, ...light },
      defines: src.map ? { USE_SURROUNDINGS_MAP: '' } : {},
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: src.side,
      polygonOffset: offsets[i] > 0, polygonOffsetFactor: offsets[i], polygonOffsetUnits: offsets[i],
    });
  });
}
```

In the `Surroundings` class:
- Add `readonly light = makeSurroundingsLight();`.
- Change `add` to call `prepareSurroundings(root, this.light);`.
- Add:

```ts
  setSky(color: Color): void {
    (this.scene.background as Color).copy(color);
  }
```

- Change the constructor to `this.scene.background = sky.clone();`, so the shared config colour is never mutated.

In `web/src/config.ts`, delete `surroundingsShadeScale` and its comment. Then run `grep -rn surroundingsShadeScale web/src web/tests` and expect no matches.

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/surroundings.ts web/src/config.ts web/tests/surroundings.test.ts
git commit -m "Surroundings: live sun-and-sky shader from shared uniforms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The daylight (`web/src/daylight.ts`)

**Files:**
- Create: `web/src/daylight.ts`
- Test: `web/tests/daylight.test.ts`

**Interfaces:**
- Consumes:
  - `solarPosition` and `sunVector` (Task 1);
  - `typicalIrradiance`, `sunStrength`, `skyDiffuse` and `skyScale` (Task 2);
  - `CONFIG.sun` (Task 3);
  - `Manifest` and `WindowInfo` (Task 10);
  - `World` with `root`, `sky`, `fills` and `occluders` (Task 11);
  - `Surroundings.light` and `setSky` (Task 12).
- Produces:
  - Pure helpers: `sunColor(elevation): Color`, `sunFade(elevation): number`, `skyColor(elevation): Color`, `casterPositions(position, index, centre: [x, z], radius): Float32Array`, `paneSamples(w): [number, number, number][]`, `enteringLight(w, dir, visible, strength): number`, `roomFill(entering, area, bounce?): number`.
  - `class Daylight(renderer, scene, world, manifest, climate, surroundings)` with `light`, `addCasters(root)`, `update(utc, version, doorsMoved)` and `isNight(utc)`.

- [ ] **Step 1: Write the failing test** `web/tests/daylight.test.ts`:

```ts
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { casterPositions, enteringLight, paneSamples, roomFill, skyColor, sunColor, sunFade } from '../src/daylight';
import type { WindowInfo } from '../src/manifest';

const pane: WindowInfo = { room: 'sala', center: [0, 1.5, 0], normal: [0, 0, 1], width: 2, height: 1 };

describe('colours', () => {
  it('keeps a high sun white and warms it at the horizon', () => {
    expect(sunColor(45).getHex()).toBe(0xffffff);
    expect(sunColor(0).getHex()).toBe(new Color(CONFIG.sun.warmColor).getHex());
    expect(sunFade(1)).toBe(1);
    expect(sunFade(-1)).toBe(0);
    expect(sunFade(0)).toBeCloseTo(0.5);
  });

  it('runs the sky from day through sunset to night', () => {
    expect(skyColor(20).getHex()).toBe(new Color(CONFIG.skyColor).getHex());
    expect(skyColor(0).getHex()).toBe(new Color(CONFIG.sun.sunsetSky).getHex());
    expect(skyColor(-6).getHex()).toBe(new Color(CONFIG.sun.nightSky).getHex());
    expect(skyColor(-20).getHex()).toBe(new Color(CONFIG.sun.nightSky).getHex());
  });
});

describe('casterPositions', () => {
  it('keeps triangles whose centre is within the radius, indexed or not', () => {
    const near = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const far = [300, 0, 0, 301, 0, 0, 300, 1, 0];
    expect(Array.from(casterPositions([...near, ...far], null, [0, 0], 200))).toEqual(near);
    const indexed = casterPositions([...near, ...far], [3, 4, 5, 0, 1, 2], [300, 0], 10);
    expect(Array.from(indexed)).toEqual(far);
  });
});

describe('windows', () => {
  it('samples the centre and four inner points on the pane', () => {
    const s = paneSamples(pane);
    expect(s).toHaveLength(5);
    expect(s[0]).toEqual([0, 1.5, 0]);
    for (const p of s) expect(p[2]).toBe(0);
    expect(Math.max(...s.map((p) => Math.abs(p[0])))).toBeCloseTo(0.7);
    expect(Math.max(...s.map((p) => Math.abs(p[1] - 1.5)))).toBeCloseTo(0.35);
  });

  it('counts light entering by area, angle, visibility and strength', () => {
    expect(enteringLight(pane, [0, 0, 1], 1, 4)).toBeCloseTo(8);
    expect(enteringLight(pane, [0, Math.SQRT1_2, Math.SQRT1_2], 0.6, 4)).toBeCloseTo(2 * Math.SQRT1_2 * 0.6 * 4);
    expect(enteringLight(pane, [0, 0, -1], 1, 4)).toBe(0);
  });

  it('spreads it over the floor', () => {
    expect(roomFill(8, 20, 0.2)).toBeCloseTo(0.08);
    expect(roomFill(8, 0, 0.2)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `cd web && npx vitest run tests/daylight.test.ts`
Expected: FAIL, "Failed to resolve import '../src/daylight'".

- [ ] **Step 3: Implement** `web/src/daylight.ts`:

```ts
import {
  Box3, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, Mesh, MeshBasicMaterial, Object3D,
  PCFSoftShadowMap, Raycaster, type Scene, Sphere, Vector3, type WebGLRenderer,
} from 'three';
import { type Climate, skyDiffuse, skyScale, sunStrength, typicalIrradiance } from './climate';
import { CONFIG } from './config';
import type { Manifest, WindowInfo } from './manifest';
import { solarPosition, sunVector } from './sun';
import type { Surroundings } from './surroundings';
import type { World } from './world';

type Vec3 = [number, number, number];

const WHITE = new Color(1, 1, 1);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** White above 30 degrees, warming toward CONFIG.sun.warmColor at the horizon. */
export function sunColor(elevation: number): Color {
  const t = clamp01((30 - elevation) / 30);
  return WHITE.clone().lerp(new Color(CONFIG.sun.warmColor), t * t);
}

/** The sun's light fades in and out as its disc crosses the horizon. */
export function sunFade(elevation: number): number {
  const t = clamp01((elevation + 0.5) / 1);
  return t * t * (3 - 2 * t);
}

/** Flat colour behind the neighbourhood: day, then a sunset band, then night by the end of civil twilight. */
export function skyColor(elevation: number): Color {
  const day = new Color(CONFIG.skyColor);
  const sunset = new Color(CONFIG.sun.sunsetSky);
  const night = new Color(CONFIG.sun.nightSky);
  if (elevation >= 6) return day;
  if (elevation >= 0) return sunset.lerp(day, elevation / 6);
  if (elevation >= -6) return night.lerp(sunset, (elevation + 6) / 6);
  return night;
}

/** Triangles (as flat xyz positions) whose centre lies within `radius` of `centre` on the ground plane. */
export function casterPositions(
  position: ArrayLike<number>, index: ArrayLike<number> | null, centre: [number, number], radius: number,
): Float32Array {
  const count = index ? index.length : position.length / 3;
  const out: number[] = [];
  for (let t = 0; t + 2 < count; t += 3) {
    const v = [0, 1, 2].map((k) => (index ? index[t + k] : t + k));
    const cx = (position[v[0] * 3] + position[v[1] * 3] + position[v[2] * 3]) / 3;
    const cz = (position[v[0] * 3 + 2] + position[v[1] * 3 + 2] + position[v[2] * 3 + 2]) / 3;
    if (Math.hypot(cx - centre[0], cz - centre[1]) > radius) continue;
    for (const i of v) out.push(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
  }
  return new Float32Array(out);
}

/** The pane's centre and four points 35% of the way to its edges. */
export function paneSamples(w: WindowInfo): Vec3[] {
  const [nx, , nz] = w.normal;
  const right: Vec3 = [-nz, 0, nx];
  const du = w.width * 0.35;
  const dv = w.height * 0.35;
  const at = (u: number, v: number): Vec3 => [w.center[0] + right[0] * u, w.center[1] + v, w.center[2] + right[2] * u];
  return [at(0, 0), at(-du, -dv), at(du, -dv), at(-du, dv), at(du, dv)];
}

/** Sunlight through a pane, in scene power units: area x cosine x share not blocked x direct-normal strength. */
export function enteringLight(w: WindowInfo, dir: Vec3, visible: number, strength: number): number {
  const cos = w.normal[0] * dir[0] + w.normal[1] * dir[1] + w.normal[2] * dir[2];
  return cos > 0 ? w.width * w.height * cos * visible * strength : 0;
}

/** Flat irradiance that the sunlight entering a room adds to all its surfaces. */
export function roomFill(entering: number, area: number, bounce = CONFIG.sun.bounce): number {
  return area > 0 ? (bounce * entering) / area : 0;
}

/**
 * Everything that changes with the date and time: the sun lamp and its shadows, the baked sky's brightness,
 * the bounce fill per room, the colour behind the neighbourhood and the neighbourhood's own lighting.
 */
export class Daylight {
  readonly light = new DirectionalLight();
  private centre = new Vector3();
  private radius: number;
  private distance: number;
  private casters = new Object3D();
  private occluders: Mesh[];
  private raycaster = new Raycaster();
  private seen = -1;
  private dirty = true;

  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    private world: World,
    private manifest: Manifest,
    private climate: Climate,
    private surroundings: Surroundings,
  ) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // redrawn only when the sun or a door moves
    const sphere = new Box3().setFromObject(world.root).getBoundingSphere(new Sphere());
    this.centre.copy(sphere.center);
    this.radius = sphere.radius + 1;
    this.distance = CONFIG.sun.shadowReach + this.radius;
    const l = this.light;
    l.castShadow = true;
    l.shadow.mapSize.set(CONFIG.sun.shadowMapSize, CONFIG.sun.shadowMapSize);
    l.shadow.bias = CONFIG.sun.shadowBias;
    l.shadow.normalBias = CONFIG.sun.shadowNormalBias;
    const cam = l.shadow.camera;
    cam.left = -this.radius;
    cam.right = this.radius;
    cam.top = this.radius;
    cam.bottom = -this.radius;
    cam.near = 0.1;
    cam.far = this.distance + this.radius; // the camera sits `distance` toward the sun, so far casters fit
    cam.updateProjectionMatrix();
    l.target.position.copy(this.centre);
    scene.add(l, l.target, this.casters);
    this.occluders = [...world.occluders];
    (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  }

  /** Shadow-only copies of the neighbourhood within reach: drawn into the shadow map, invisible otherwise. */
  addCasters(root: Object3D): void {
    root.updateMatrixWorld(true);
    const material = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const size = new Vector3();
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      new Box3().setFromObject(m).getSize(size);
      if (size.y < CONFIG.surroundingsFlatHeight) return; // ground layers cast nothing
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const pos = casterPositions(g.attributes.position.array, g.index?.array ?? null, [this.centre.x, this.centre.z], CONFIG.sun.shadowReach);
      g.dispose();
      if (pos.length === 0) return;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
      geo.computeBoundsTree?.();
      const proxy = new Mesh(geo, material);
      proxy.castShadow = true;
      this.casters.add(proxy);
      this.occluders.push(proxy);
    });
    this.dirty = true;
  }

  isNight(utc: number): boolean {
    const { lat, lon } = this.manifest.site;
    return solarPosition(utc, lat, lon).elevation < -6;
  }

  /** Call every frame; work happens only when the moment changed, the casters arrived or a door moved. */
  update(utc: number, version: number, doorsMoved: boolean): void {
    if (version !== this.seen || this.dirty) {
      this.seen = version;
      this.dirty = false;
      this.apply(utc);
      this.renderer.shadowMap.needsUpdate = true;
    } else if (doorsMoved) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  private apply(utc: number): void {
    const { site, sky } = this.manifest;
    const sun = solarPosition(utc, site.lat, site.lon);
    const { beam, diffuse } = typicalIrradiance(this.climate, utc);
    const strength = sunStrength(beam, sun.elevation) * sky.wattsToScene * sunFade(sun.elevation);
    const dir = sunVector(sun, site.yBearing);
    const color = sunColor(sun.elevation);

    const l = this.light;
    l.color.copy(color);
    l.intensity = strength;
    l.visible = strength > 0;
    l.position.set(this.centre.x + dir[0] * this.distance, this.centre.y + dir[1] * this.distance, this.centre.z + dir[2] * this.distance);

    const d = skyDiffuse(this.climate, utc, sun.elevation, diffuse);
    const scale = skyScale(d, sky.wattsToScene, sky.irradiance);
    this.world.sky.value = scale;
    this.scene.environmentIntensity = CONFIG.envIntensity * Math.min(scale, 1.5);

    this.surroundings.setSky(skyColor(sun.elevation));
    const s = this.surroundings.light;
    s.sunDir.value.set(dir[0], dir[1], dir[2]);
    s.sunLight.value.copy(color).multiplyScalar(strength);
    s.skyLight.value = d * sky.wattsToScene;

    this.updateFills(dir, strength, color);
  }

  private updateFills(dir: Vec3, strength: number, color: Color): void {
    const entering = new Map<string, number>();
    if (strength > 0) {
      const toSun = new Vector3(dir[0], dir[1], dir[2]);
      const origin = new Vector3();
      this.raycaster.far = this.distance;
      for (const w of this.manifest.windows) {
        if (enteringLight(w, dir, 1, 1) === 0) continue;
        const samples = paneSamples(w);
        let open = 0;
        for (const p of samples) {
          origin.set(p[0] + w.normal[0] * 0.05, p[1], p[2] + w.normal[2] * 0.05);
          this.raycaster.set(origin, toSun);
          if (this.raycaster.intersectObjects(this.occluders, false).length === 0) open++;
        }
        entering.set(w.room, (entering.get(w.room) ?? 0) + enteringLight(w, dir, open / samples.length, strength));
      }
    }
    for (const room of this.manifest.rooms) {
      const fill = this.world.fills.get(room.id);
      if (fill) fill.value.copy(color).multiplyScalar(roomFill(entering.get(room.id) ?? 0, room.area));
    }
  }
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `cd web && npm test && npx tsc --noEmit`
Expected: PASS. (`geo.computeBoundsTree?.()` type-checks because `world.ts` imports the `three-mesh-bvh` type augmentation; if `tsc` complains, add `import type {} from 'three-mesh-bvh';` at the top of `daylight.ts`.)

- [ ] **Step 5: Commit**

```bash
git add web/src/daylight.ts web/tests/daylight.test.ts
git commit -m "Sun: live sun lamp with shadows from the flat and its neighbours, sky scale, bounce fill and sky colour

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Panel, keys, HUD and wiring

**Files:**
- Modify: `web/index.html`, `web/src/style.css`, `web/src/ui.ts`, `web/src/main.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `UI.bindSunPanel(h: SunPanelHandlers)`, `UI.setSunPanel(s: SunPanelState)` and `UI.setClock(text)`.
  - `interface SunPanelHandlers { dayOfYear(n); season(month, day); minutes(m); now(); play() }`.
  - `interface SunPanelState { dayOfYear; daysInYear; minutes; sunrise: number | null; sunset: number | null; readout; playing }`.

Vitest runs in node with no DOM, so this task's DOM and wiring are checked in the browser (Step 6). Everything it formats or computes was unit-tested in Tasks 1–3.

- [ ] **Step 1: Markup.** In `web/index.html`, replace the `<li><kbd>Esc</kbd> pause</li>` line with:

```html
        <li><kbd>,</kbd><kbd>.</kbd> change the time</li>
        <li><kbd>Shift</kbd> + <kbd>,</kbd><kbd>.</kbd> change the date</li>
        <li><kbd>P</kbd> play the day</li>
        <li><kbd>Esc</kbd> pause, set the date and time</li>
```

Inside `#hud`, before `<div id="muted" hidden>`, add `<div id="sun-clock"></div>`. Replace the whole `#pause` overlay with:

```html
    <div id="pause" class="overlay" hidden>
      <p>Paused</p>
      <section id="sun-panel" aria-label="Sun">
        <h2>Sun</h2>
        <label class="sun-row"><span>Date</span><input id="sun-date" type="range" min="1" max="365" step="1" /></label>
        <div class="sun-months" aria-hidden="true">
          <span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span>
          <span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span>
        </div>
        <div class="sun-buttons">
          <button type="button" data-season="12-21">Winter solstice</button>
          <button type="button" data-season="3-20">Spring equinox</button>
          <button type="button" data-season="6-21">Summer solstice</button>
          <button type="button" data-season="9-22">Autumn equinox</button>
        </div>
        <label class="sun-row"><span>Time</span><input id="sun-time" type="range" min="0" max="1435" step="5" /></label>
        <div class="sun-track" aria-hidden="true"><i id="sun-rise" title="Sunrise"></i><i id="sun-set" title="Sunset"></i></div>
        <div class="sun-buttons">
          <button type="button" id="sun-now">Now</button>
          <button type="button" id="sun-play">Play</button>
        </div>
        <p id="sun-readout" aria-live="polite"></p>
        <button type="button" id="resume-button">Keep exploring</button>
      </section>
      <p class="hint">Click outside the panel to keep exploring</p>
    </div>
```

- [ ] **Step 2: Styles.** Append to `web/src/style.css`:

```css
#sun-panel {
  width: min(460px, calc(100vw - 32px)); box-sizing: border-box; padding: 18px 20px; border-radius: 12px;
  background: rgba(30, 28, 25, 0.92); text-align: left; display: flex; flex-direction: column; gap: 10px;
}
#sun-panel h2 { margin: 0; font-size: 15px; font-weight: 500; letter-spacing: 0.04em; color: var(--muted); }
.sun-row { display: grid; grid-template-columns: 44px 1fr; align-items: center; gap: 10px; font-size: 14px; }
.sun-row input { width: 100%; accent-color: var(--accent); }
.sun-months { display: flex; justify-content: space-between; margin-left: 54px; font-size: 11px; color: var(--muted); }
.sun-track { position: relative; height: 8px; margin: -6px 0 0 54px; }
.sun-track i { position: absolute; top: 0; width: 2px; height: 8px; background: var(--accent); transform: translateX(-1px); }
.sun-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.sun-buttons button { padding: 6px 12px; font-size: 13px; background: rgba(255, 255, 255, 0.12); color: var(--ink); }
#sun-readout { margin: 0; font-size: 13px; line-height: 1.4; min-height: 2.8em; }
#resume-button { align-self: flex-end; padding: 8px 18px; font-size: 14px; }
#sun-clock {
  position: fixed; right: 20px; bottom: 46px; font-size: 13px; letter-spacing: 0.03em; opacity: 0.55;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7); transition: opacity 0.4s;
}
#sun-clock.flash { opacity: 1; transition: none; }
```

- [ ] **Step 3: UI methods.** In `web/src/ui.ts`, add these exports after `isTouchOnly`:

```ts
export interface SunPanelHandlers {
  dayOfYear(n: number): void;
  season(month: number, day: number): void;
  minutes(m: number): void;
  now(): void;
  play(): void;
}
export interface SunPanelState {
  dayOfYear: number;
  daysInYear: number;
  minutes: number;
  sunrise: number | null;
  sunset: number | null;
  readout: string;
  playing: boolean;
}
```

In the `UI` class:
- Add the field `private clockTimer: ReturnType<typeof setTimeout> | undefined;`.
- Replace `onResume` with:

```ts
  /** Resumes on Keep exploring, or on a click anywhere on the pause screen outside the sun panel. */
  onResume(cb: () => void): void {
    const panel = this.el('sun-panel');
    this.el('pause').addEventListener('click', (e) => {
      if (!panel.contains(e.target as Node)) cb();
    });
    this.el('resume-button').addEventListener('click', cb);
  }

  bindSunPanel(h: SunPanelHandlers): void {
    const date = this.el<HTMLInputElement>('sun-date');
    date.addEventListener('input', () => h.dayOfYear(Number(date.value)));
    const time = this.el<HTMLInputElement>('sun-time');
    time.addEventListener('input', () => h.minutes(Number(time.value)));
    for (const b of this.doc.querySelectorAll<HTMLButtonElement>('[data-season]')) {
      const [month, day] = (b.dataset.season ?? '').split('-').map(Number);
      b.addEventListener('click', () => h.season(month, day));
    }
    this.el('sun-now').addEventListener('click', () => h.now());
    this.el('sun-play').addEventListener('click', () => h.play());
  }

  setSunPanel(s: SunPanelState): void {
    const date = this.el<HTMLInputElement>('sun-date');
    date.max = String(s.daysInYear);
    if (date.value !== String(s.dayOfYear)) date.value = String(s.dayOfYear);
    const time = this.el<HTMLInputElement>('sun-time');
    const minutes = String(Math.min(1435, Math.round(s.minutes / 5) * 5));
    if (time.value !== minutes) time.value = minutes;
    const mark = (id: string, m: number | null) => {
      const el = this.el(id);
      el.hidden = m === null;
      if (m !== null) el.style.left = `${(m / 1435) * 100}%`;
    };
    mark('sun-rise', s.sunrise);
    mark('sun-set', s.sunset);
    this.el('sun-readout').textContent = s.readout;
    this.el('sun-play').textContent = s.playing ? 'Pause' : 'Play';
  }

  /** The HUD's date and time; it brightens briefly whenever it changes. */
  setClock(text: string): void {
    const c = this.el('sun-clock');
    if (c.textContent === text) return;
    c.textContent = text;
    c.classList.add('flash');
    clearTimeout(this.clockTimer);
    this.clockTimer = setTimeout(() => c.classList.remove('flash'), 1500);
  }
```

- [ ] **Step 4: Wire `main.ts`.**

Imports, added to the existing ones:

```ts
import { Daylight } from './daylight';
import { solarPosition, sunTimes } from './sun';
import { dayOfYear, daysInYear, formatClock, formatReadout, parseSunParam, SunClock, sunKeyAction } from './sun-clock';
import { applyDoorRotation, applyGlows, buildWorld } from './world';
```

(The last line replaces the existing `world` import.)

Replace `assets.surroundings.then((root) => root && surroundings.add(root));` with:

```ts
  const site = assets.manifest.site;
  const clock = new SunClock(parseSunParam(params.get('sun'), site.timeZone) ?? Date.now(), site.timeZone);
  const daylight = new Daylight(renderer, scene, world, assets.manifest, assets.climate, surroundings);
  assets.surroundings.then((root) => {
    if (!root) return;
    surroundings.add(root);
    daylight.addCasters(root);
  });
```

After `player.update(0);` (the line that places the camera), add:

```ts
  const spawnRoom = world.rooms.locate(player.x, player.z, null);
  if (spawnRoom && world.lights.has(spawnRoom) && daylight.isNight(clock.utc)) world.lights.toggle(spawnRoom);
```

After `ui.onStart(start);`, add:

```ts
  ui.bindSunPanel({
    dayOfYear: (n) => clock.setDayOfYear(n),
    season: (month, day) => clock.setDate(clock.local().year, month, day),
    minutes: (m) => clock.setMinutes(m),
    now: () => clock.now(),
    play: () => clock.togglePlay(),
  });
  let shownVersion = -1;
  const times = new Map<string, ReturnType<typeof sunTimes>>();
  const showSun = () => {
    const l = clock.local();
    const key = `${l.year}-${l.month}-${l.day}`;
    let t = times.get(key);
    if (!t) {
      t = sunTimes(l, site.lat, site.lon, site.timeZone);
      times.set(key, t);
    }
    ui.setClock(formatClock(l));
    ui.setSunPanel({
      dayOfYear: dayOfYear(l), daysInYear: daysInYear(l.year), minutes: l.hour * 60 + l.minute,
      sunrise: t.sunrise, sunset: t.sunset, playing: clock.playing,
      readout: formatReadout(l, solarPosition(clock.utc, site.lat, site.lon), assets.climate.months[l.month - 1]),
    });
  };
```

Replace the whole `keydown` listener with:

```ts
  window.addEventListener('keydown', (e) => {
    if (!started || paused) return;
    const sunKey = sunKeyAction(e.code, e.shiftKey);
    if (sunKey) {
      if (sunKey !== 'play' || !e.repeat) clock.apply(sunKey); // holding , or . keeps scrolling
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyL' && currentRoom && world.lights.has(currentRoom)) {
      world.lights.toggle(currentRoom);
      sound?.click(world.switches.get(currentRoom));
    }
    if (e.code === 'KeyM' && sound) {
      muted = !muted;
      saveMuted(() => localStorage, muted);
      sound.setMuted(muted);
      ui.setMuted(muted);
    }
  });
```

In the animation loop:
- Declare `let doorsMoved = false;` before `world.doors.forEach(...)`.
- Inside that callback, before `before.target = d.state.target;`, add `if (d.state.progress !== before.progress) doorsMoved = true;`.
- Then replace the line `world.lights.update(dt);` with:

```ts
    clock.tick(dt);
    daylight.update(clock.utc, clock.version, doorsMoved);
    if (clock.version !== shownVersion) {
      shownVersion = clock.version;
      showSun();
    }
    world.lights.update(dt);
    applyGlows(world.glows, world.lights);
```

- [ ] **Step 5: Type-check and test**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: no errors; all tests PASS.

- [ ] **Step 6: Check in the browser.** This needs Task 9's preview assets in `web/public/assets/`. Start the dev server with `preview_start` (the `.claude/launch.json` entry for `web`; if there isn't one, add `{"name": "web", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "web", "run", "dev"], "port": 5173}`). Then check each of these:
  1. Open `http://localhost:5173/?sun=2026-12-21T10:00&view=Cam_Bedroom&autostart`. A sharp sun patch lies on the bedroom floor, and the window frame shadows cross it. `read_console_messages` with `onlyErrors` returns nothing.
  2. Open `?sun=2026-06-21T13:30&view=Cam_Bedroom&autostart`. The patch is small or absent: the summer sun is high and the balcony overhang blocks it.
  3. Open `?sun=2026-06-21T20:00&view=Cam_Sala&autostart`. The evening sun enters the Sala (it faces about 322°).
  4. Open `?sun=2026-12-21T19:00&autostart`. The sky behind the windows is navy, and the entrance light is on.
  5. Open `/` with no options, click to start, press `.` several times. The HUD clock steps 15 minutes at a time and the light moves. `Shift` + `.` moves the date by a week; `P` plays.
  6. Press Esc. The panel shows; drag the date and time sliders and the view updates behind the panel. Press the solstice buttons, Now, Play and Pause. Clicking inside the panel doesn't resume; **Keep exploring** does, and so does clicking outside the panel.
  7. With `javascript_tool`, run `performance.now()` around 120 frames of `requestAnimationFrame` while walking (or just idle). Expect about 60 fps on this Mac with the time not changing; the shadow map is not redrawn every frame.

  Take a screenshot of check 1 and check 6 for the user.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/src/style.css web/src/ui.ts web/src/main.ts
git commit -m "Walkthrough: sun panel on the pause screen, , . Shift P keys, HUD clock, night start

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Final export, Cycles comparison and calibration, docs

**Files:**
- Modify: `web/src/config.ts` (`sun.bounce`, shadow bias, if tuning needs it), `blender/pipeline/config.py` (`WATTS_TO_SCENE`, only if the overall exposure is off), `README.md`
- Commit: `web/public/assets/*` (final)

- [ ] **Step 1: Final export.** Run `make export-final` in the background (about 35 minutes; `run_in_background: true`).
Expected: `Export OK`.

- [ ] **Step 2: Reference renders.** Run each of these (each one renders the three cameras):

```bash
make render-refs SUN=2026-12-21T10:00
```
```bash
make render-refs SUN=2026-06-21T20:00
```
```bash
make render-refs SUN=2026-03-20T15:00
```

Expected: `build/ref/Cam_Bedroom_2026-12-21T1000.png` and the others. Each run prints `[refs] … sun az … el …`. Check that the az and el match `solarPosition` for the same moment in the viewer, within 0.1°.

- [ ] **Step 3: Compare the sun patches.** For each moment and camera, open the viewer at `?view=<Cam>&autostart&sun=<moment>` and take a screenshot. Compare it side by side with the Cycles PNG (`Read` both images). The sun patches and the shadow edges must land in the same places. If they're mirrored or rotated, the direction is wrong: check `sunVector` against `blender_direction`, and the sign of `yBearing`. If the shadows show acne or float off their objects, adjust `CONFIG.sun.shadowBias` and `shadowNormalBias`.

- [ ] **Step 4: Tune the bounce.** Compare the mean brightness of the whole view, viewer against Cycles, for each sunlit moment.
  1. Temporarily add `preserveDrawingBuffer: true` to the `WebGLRenderer` options in `web/src/main.ts`, and don't commit it.
  2. With the view open, read the mean with `javascript_tool`:

```js
const c = document.getElementById('view');
const g = c.getContext('webgl2');
const w = c.width, h = c.height, px = new Uint8Array(w * h * 4);
g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
let s = 0; for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
s / (w * h)
```

  3. Remove `preserveDrawingBuffer` again once tuning is done.
  4. In Cycles, compute the same mean over the reference PNG. Run this from a staged copy with the ref, never in `~/Documents`: `cd /private/tmp/apartment-walkthrough-blender && HOME=$PWD/home /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-expr "import bpy,numpy as np; i=bpy.data.images.load('ref/Cam_Bedroom_2026-12-21T1000.png'); p=np.array(i.pixels[:]).reshape(-1,4); print('MEAN', (p[:,:3]@[0.2126,0.7152,0.0722]).mean()*255)"`. Adjust `CONFIG.sun.bounce` until the sunlit room's mean is within about 10% of Cycles. Only if every view, sunlit or not, is off by the same factor, adjust `WATTS_TO_SCENE` in `blender/pipeline/config.py`. That needs a re-export: `make export-final`, or for the manifest alone, `--stage export` through a staged Blender run.

- [ ] **Step 5: Ask the user for the real-world check.** Ask for one or two moments they remember from the flat, for example "the sun reaches the bedroom floor around … in December". Open that `?sun=` moment and confirm with them.

- [ ] **Step 6: README.** In `README.md`:
- Add `,` `.` `Shift + , .` and `P` to the Controls line.
- Add `?sun=2026-12-21T10:00` (Lisbon time) to "Handy URL options".
- Add a "Sun" section after "Sound":

```markdown
## Sun

The sun is live: its position comes from the NOAA solar equations for the flat's coordinates and the chosen date and time (Lisbon time), and its strength and the sky's from a typical day of each month (`web/public/assets/climate.json`, sources in `DATA-SOURCES.md`). The day layer of the bake is sky light only; the sun, its shadows (from the flat, the building and neighbours within 200 m) and the light it bounces into each sunlit room are added in the browser.

- Where the flat is: `SITE` in `blender/pipeline/config.py` (Blender's origin and the compass bearing of +Y).
- Refresh the climate data: `cd web && node scripts/fetch-climate.mjs 41.117327 -8.653914`.
- Compare with Cycles: `make render-refs SUN=2026-12-21T10:00` renders the viewpoints lit by the same sun into `build/ref/`.
- Tuning: `CONFIG.sun` in `web/src/config.ts` (bounce, shadow bias, colours, time-lapse speed).
```

- In "Naming the pipeline relies on", add:
  - "Exterior glass: `Window N (Exterior / Room) glass` and `Glazed Door N (Exterior / Room) glass`; the viewer measures the sunlight entering through them."
  - "Lights named `Portal …` are window fill and count as sky light; every other lamp is switched with its room's ceiling light."
- Remove the `SURROUNDINGS_SKY_IRRADIANCE` mention in "Overrides".

- [ ] **Step 7: Full checks**

Run: `make test-blender` and `cd web && npm test && npm run build`
Expected: all PASS; the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add web/public/assets web/src/config.ts blender/pipeline/config.py README.md
git commit -m "Assets: final export with the sky-only day layer; sun calibrated against Cycles; docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
