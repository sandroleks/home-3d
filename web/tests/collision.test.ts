import { describe, expect, it } from 'vitest';
import { Collision, segmentDistance } from '../src/collision';
import type { CollisionData } from '../src/manifest';

function wallGrid(): CollisionData {
  // 10×10 cells of 0.1 m from (0, 0); column 5 (x 0.5..0.6) blocked.
  const blocked = new Uint8Array(100);
  for (let j = 0; j < 10; j++) blocked[j * 10 + 5] = 1;
  return { x0: 0, z0: 0, cell: 0.1, width: 10, height: 10, radius: 0.1, blocked };
}

describe('segmentDistance', () => {
  it('measures to the closest point on the segment', () => {
    const s = { ax: 0, az: 0, bx: 1, bz: 0 };
    expect(segmentDistance(0.5, 0.3, s)).toBeCloseTo(0.3);
    expect(segmentDistance(-0.4, 0.3, s)).toBeCloseTo(0.5);
  });
});

describe('Collision', () => {
  it('treats outside the grid as blocked', () => {
    expect(new Collision(wallGrid()).isBlocked(-0.1, 0.5)).toBe(true);
  });

  it('stops at walls and slides along them', () => {
    const c = new Collision(wallGrid());
    const [x1] = c.move(0.25, 0.5, 0.5, 0);
    expect(x1).toBeLessThan(0.5);
    const [x2, z2] = c.move(0.25, 0.5, 0.5, 0.2);
    expect(x2).toBeLessThan(0.5);
    expect(z2).toBeCloseTo(0.7);
  });

  it('blocks within the radius of door segments', () => {
    const c = new Collision(wallGrid(), () => [{ ax: 0.2, az: 0, bx: 0.2, bz: 1 }]);
    expect(c.isBlocked(0.25, 0.5)).toBe(true);
    expect(c.isBlocked(0.35, 0.5)).toBe(false);
  });

  it('finds the nearest free spot', () => {
    const c = new Collision(wallGrid());
    const [x, z] = c.nearestFree(0.55, 0.5);
    expect(c.isBlocked(x, z)).toBe(false);
    // Lands on an adjacent free cell centre: at most ~1.5 cells away.
    expect(Math.hypot(x - 0.55, z - 0.5)).toBeLessThanOrEqual(0.15);
    expect(c.nearestFree(0.25, 0.25)).toEqual([0.25, 0.25]);
  });
});
