import { describe, expect, it } from 'vitest';
import { activeScene, blackBody, colourAt, groupsIn, HUE_SCENES, hueColour, levelFor, nextScene, packColour, sceneById, tintFor, toneFor, unpackColour } from '../src/hue';
import { LightGroups } from '../src/lightmaps';

describe('Hue scenes', () => {
  it('uses the bridge ranges', () => {
    for (const s of HUE_SCENES) {
      expect(s.bri).toBeGreaterThanOrEqual(0);
      expect(s.bri).toBeLessThanOrEqual(254);
      if (s.ct) expect(s.ct).toBeGreaterThanOrEqual(153);
      expect(s.ct).toBeLessThanOrEqual(500);
      for (const [hue, sat] of s.colours ?? []) {
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThanOrEqual(65535);
        expect(sat).toBeGreaterThanOrEqual(0);
        expect(sat).toBeLessThanOrEqual(254);
      }
      if (s.colours) expect(s.ct).toBe(0);
    }
    expect(HUE_SCENES.filter((s) => s.colours).length).toBeGreaterThanOrEqual(4);
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

  it('gives a colour scene\'s lights its colours in turn', () => {
    const sunset = sceneById('savanna-sunset')!;
    expect(colourAt(sunset, 0)).toEqual(sunset.colours![0]);
    expect(colourAt(sunset, sunset.colours!.length + 1)).toEqual(sunset.colours![1]);
    expect(colourAt(sceneById('relax')!, 0)).toBeNull();
    expect(unpackColour(packColour([48500, 254]))).toEqual([48500, 254]);
  });

  it('turns Hue colours into light, deep colours capped so they stay deep', () => {
    const red = hueColour([0, 254]);
    expect([red.r, red.g, red.b]).toEqual([1, 0, 0]);
    const green = hueColour([21845, 254]);
    expect(green.g).toBe(1);
    expect(green.r).toBeLessThan(0.01);
    const white = hueColour([12345, 0]);
    expect([white.r, white.g, white.b]).toEqual([1, 1, 1]);
    const blue = tintFor([43690, 254], 2850, 1.5);
    expect(blue.b).toBeCloseTo(1.5, 5);
    expect(blue.r).toBeLessThan(0.01);
    const pale = tintFor([7300, 60], 2850, 1.5); // near the bake's own warm white: not capped
    expect(0.2126 * pale.r + 0.7152 * pale.g + 0.0722 * pale.b).toBeCloseTo(1, 5);
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
    const sunset = sceneById('savanna-sunset')!;
    ['sala', 'sala/pendant'].forEach((id, i) => {
      lights.setScene(id, levelFor(sunset.bri), sunset.ct);
      lights.setColour(id, colourAt(sunset, i)!);
    });
    expect(activeScene(lights, ['sala', 'sala/pendant'])).toBe('savanna-sunset');
    lights.setColour('sala/pendant', colourAt(sunset, 0)!);
    expect(activeScene(lights, ['sala', 'sala/pendant'])).toBeNull();
  });
});
