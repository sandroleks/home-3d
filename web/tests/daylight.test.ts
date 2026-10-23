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
