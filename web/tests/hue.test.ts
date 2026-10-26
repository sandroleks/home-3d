import { describe, expect, it } from 'vitest';
import { activeScene, blackBody, groupsIn, HUE_SCENES, levelFor, nextScene, sceneById, toneFor } from '../src/hue';
import { LightGroups } from '../src/lightmaps';

describe('Hue scenes', () => {
  it('uses the bridge ranges', () => {
    for (const s of HUE_SCENES) {
      expect(s.bri).toBeGreaterThanOrEqual(0);
      expect(s.bri).toBeLessThanOrEqual(254);
      if (s.ct) expect(s.ct).toBeGreaterThanOrEqual(153);
      expect(s.ct).toBeLessThanOrEqual(500);
    }
    expect(levelFor(254)).toBe(1);
    expect(levelFor(77)).toBeCloseTo(0.303, 3);
  });

  it('steps through the scenes and wraps', () => {
    expect(nextScene(null).id).toBe('bright');
    expect(nextScene('bright').id).toBe('read');
    expect(nextScene('off').id).toBe('bright');
    expect(sceneById('relax')?.bri).toBe(144);
  });

  it('tones baked light warmer or cooler at the same brightness', () => {
    const white = toneFor(0);
    expect([white.r, white.g, white.b]).toEqual([1, 1, 1]);
    const baked = toneFor(1e6 / 2850, 2850);
    expect(baked.r).toBeCloseTo(1, 5);
    expect(baked.b).toBeCloseTo(1, 5);
    const relax = toneFor(447, 2850);
    const energize = toneFor(156, 2850);
    expect(relax.r / relax.b).toBeGreaterThan(1.2);
    expect(energize.b / energize.r).toBeGreaterThan(1.5);
    const luma = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(luma(relax)).toBeCloseTo(1, 5);
    expect(luma(energize)).toBeCloseTo(1, 5);
  });

  it('black body runs from red to blue', () => {
    const warm = blackBody(2000);
    const cold = blackBody(9000);
    expect(warm.r).toBe(1);
    expect(warm.b).toBeLessThan(0.3);
    expect(cold.b).toBe(1);
  });

  it('finds a room\'s groups, leaving out screens\' bias lights', () => {
    const groups = [{ id: 'sala', room: 'sala' }, { id: 'sala/tv', room: 'sala' }, { id: 'sala/pendant', room: 'sala' }, { id: 'hall', room: 'hall' }];
    expect(groupsIn(groups, 'sala', new Set(['sala/tv']))).toEqual(['sala', 'sala/pendant']);
  });

  it('knows which scene a room shows', () => {
    const lights = new LightGroups(['sala', 'sala/pendant'], 0.4);
    expect(activeScene(lights, ['sala', 'sala/pendant'])).toBe('off');
    const relax = sceneById('relax')!;
    for (const id of ['sala', 'sala/pendant']) lights.setScene(id, levelFor(relax.bri), relax.ct);
    expect(activeScene(lights, ['sala', 'sala/pendant'])).toBe('relax');
    lights.toggle('sala/pendant');
    expect(activeScene(lights, ['sala', 'sala/pendant'])).toBeNull();
    expect(activeScene(lights, [])).toBeNull();
  });
});
