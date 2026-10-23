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
