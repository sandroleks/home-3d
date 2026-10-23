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

const CLOCK_PARTS = new Set(['year', 'month', 'day', 'hour', 'minute']);
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
  for (const part of formatter(tz).formatToParts(new Date(utcMillis))) {
    if (CLOCK_PARTS.has(part.type)) p[part.type] = Number(part.value);
  }
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

/** A local calendar day lasts 23, 24 or 25 hours; scan this many minutes of instants from local midnight. */
const MAX_DAY_MINUTES = 25 * 60;

/**
 * Sunrise and sunset as wall-clock minutes after local midnight on the zone's calendar day (0 to 1440),
 * found minute by minute over the day's instants; null if the sun does not cross the horizon that day.
 */
export function sunTimes(date: LocalDate, lat: number, lon: number, tz: string): { sunrise: number | null; sunset: number | null } {
  const start = fromLocal({ year: date.year, month: date.month, day: date.day, hour: 0, minute: 0 }, tz);
  let sunrise: number | null = null;
  let sunset: number | null = null;
  let wasUp = solarPosition(start, lat, lon).elevation > HORIZON;
  for (let m = 1; m <= MAX_DAY_MINUTES; m++) {
    const t = start + m * 60000;
    const up = solarPosition(t, lat, lon).elevation > HORIZON;
    if (up !== wasUp) {
      const local = toLocal(t, tz);
      if (local.year === date.year && local.month === date.month && local.day === date.day) {
        const wall = local.hour * 60 + local.minute;
        if (up) sunrise ??= wall;
        else sunset = wall;
      }
    }
    wasUp = up;
  }
  return { sunrise, sunset };
}
