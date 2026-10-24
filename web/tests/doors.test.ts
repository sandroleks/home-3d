import { describe, expect, it } from 'vitest';
import { DoorState, easeInOut, rotY } from '../src/doors';
import type { DoorInfo } from '../src/manifest';

const info: DoorInfo = {
  node: 'Door_1', hinge: [3.1, -1.78], dir: [0, 1], width: 0.76, openAngle: -Math.PI / 2,
  opening: 1, lightmap: { file: 'x', range: 1 }, packs: [],
};

describe('rotY', () => {
  it('matches the Python pipeline convention', () => {
    const [x, z] = rotY([1, 0], Math.PI / 2);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
  });
});

describe('easeInOut', () => {
  it('is symmetric with fixed ends', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });
});

describe('DoorState', () => {
  it('opens over the duration and reports its segment', () => {
    const d = new DoorState(info, 0.6);
    expect(d.segment()).toEqual({ ax: 3.1, az: -1.78, bx: 3.1, bz: -1.78 + 0.76 });
    d.toggle();
    d.update(0.3);
    expect(d.progress).toBeCloseTo(0.5);
    d.update(1);
    expect(d.angle).toBeCloseTo(-Math.PI / 2);
    const s = d.segment();
    expect(s.bx).toBeCloseTo(3.1 - 0.76); // swung into Alpha (−x)
    expect(s.bz).toBeCloseTo(-1.78);
  });

  it('reverses mid-swing', () => {
    const d = new DoorState(info, 0.6);
    d.toggle();
    d.update(0.3);
    d.toggle();
    expect(d.isOpen).toBe(false);
    d.update(0.15);
    expect(d.progress).toBeCloseTo(0.25);
  });
});

describe('a sliding door', () => {
  const sliding: DoorInfo = { ...info, hinge: [1.58, -7.27], dir: [1, 0], width: 0.617, openAngle: 0, opening: 4, slide: { dir: [-1, 0], distance: 0.62 } };

  it('slides its leaf along the slide instead of swinging, and lets the player come closer', () => {
    const d = new DoorState(sliding, 1);
    expect(d.segment()).toMatchObject({ ax: 1.58, bx: 1.58 + 0.617 });
    d.toggle();
    d.update(0.5);
    expect(d.offset).toBeCloseTo(0.31);
    d.update(1);
    expect(d.angle).toBe(0);
    const s = d.segment();
    expect(s.ax).toBeCloseTo(0.96);
    expect(s.bx).toBeCloseTo(1.577);
    expect(s.az).toBeCloseTo(-7.27);
    expect(s.radius).toBeLessThan(0.2);
    expect(new DoorState(info).segment().radius).toBeUndefined();
  });
});
