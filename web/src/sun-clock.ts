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
