import { describe, expect, it } from 'vitest';
import { clearSkyShare, type ClimateMonth } from '../src/climate';
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

  it('ignores presses with Cmd, Ctrl or Alt held', () => {
    expect(sunKeyAction('KeyP', false, true)).toBeNull();
    expect(sunKeyAction('Comma', true, true)).toBeNull();
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

describe('clearSkyShare', () => {
  it('ignores hours without clear-sky light and rounds to a whole percent', () => {
    const hours = Array.from({ length: 24 }, (_, k) => ({ utcHour: k + 0.5, gb: 0, gd: 5, gcs: 0 }));
    hours[12] = { utcHour: 12.5, gb: 100, gd: 50, gcs: 300 };
    expect(clearSkyShare({ month: 6, hours, sunshineHours: 0, cloudCover: 0 })).toBe(50);
    expect(clearSkyShare({ month: 6, hours: hours.map((h) => ({ ...h, gcs: 0 })), sunshineHours: 0, cloudCover: 0 })).toBe(0);
  });
});

describe('readout', () => {
  // Night hours (gcs 0) add nothing; the day hours give (300 + 100 + 200 + 100) / 1000 = 70%.
  const hours = Array.from({ length: 24 }, (_, k) => ({ utcHour: k + 0.5, gb: 0, gd: 0, gcs: 0 }));
  hours[10] = { utcHour: 10.5, gb: 300, gd: 100, gcs: 500 };
  hours[11] = { utcHour: 11.5, gb: 200, gd: 100, gcs: 500 };
  const june: ClimateMonth = { month: 6, hours, sunshineHours: 10.94, cloudCover: 30 };
  const l = { year: 2026, month: 6, day: 21, hour: 18, minute: 5 };
  it('formats the clock and compass', () => {
    expect(formatClock(l)).toBe('21 Jun · 18:05');
    expect(compassName(0)).toBe('north');
    expect(compassName(292)).toBe('west-north-west');
    expect(compassName(359)).toBe('north');
  });
  it('describes the sun and the typical month', () => {
    expect(formatReadout(l, { azimuth: 278, elevation: 27.4 }, june))
      .toBe('21 Jun · 18:05 · Sun 27° high, west · typical June: 70% of clear-sky sunlight');
    expect(formatReadout(l, { azimuth: 300, elevation: -1 }, june))
      .toBe('21 Jun · 18:05 · Sun below the horizon · typical June: 70% of clear-sky sunlight');
  });
});
