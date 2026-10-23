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
