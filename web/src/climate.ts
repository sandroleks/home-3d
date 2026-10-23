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
