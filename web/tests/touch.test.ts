import { describe, expect, it } from 'vitest';
import { STILL } from '../src/player';
import { shrinkFactor } from '../src/shrink';
import { isTap, stickFrom } from '../src/touch';

describe('stickFrom', () => {
  it('does nothing inside the dead zone', () => {
    expect(stickFrom(3, -3, 56)).toBe(STILL);
  });
  it('walks forward when pushed up the screen, at full speed at the ring', () => {
    const s = stickFrom(0, -56, 56);
    expect(s.forward).toBeCloseTo(1);
    expect(s.right).toBeCloseTo(0);
    expect(s.run).toBe(false);
  });
  it('is analog between the dead zone and the ring, and never longer than 1', () => {
    const half = stickFrom(31.36, 0, 56); // halfway from the 6.72 px dead zone to the ring
    expect(half.right).toBeCloseTo(0.5);
    expect(half.forward).toBeCloseTo(0);
    const far = stickFrom(60, 60, 56);
    expect(Math.hypot(far.forward, far.right)).toBeCloseTo(1);
    expect(far.forward).toBeLessThan(0); // pulled down: backwards
  });
  it('runs when pushed well past the ring', () => {
    expect(stickFrom(0, -80, 56).run).toBe(false);
    expect(stickFrom(0, -90, 56).run).toBe(true);
  });
});

describe('isTap', () => {
  it('needs a short touch that barely moved', () => {
    expect(isTap(4, 120)).toBe(true);
    expect(isTap(25, 120)).toBe(false);
    expect(isTap(4, 600)).toBe(false);
  });
});

describe('shrinkFactor', () => {
  it('halves until the map fits', () => {
    expect(shrinkFactor(512, 1024)).toBe(1);
    expect(shrinkFactor(1024, 1024)).toBe(1);
    expect(shrinkFactor(2048, 1024)).toBe(2);
    expect(shrinkFactor(4096, 1024)).toBe(4);
  });
});
