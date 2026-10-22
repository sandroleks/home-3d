import { describe, expect, it } from 'vitest';
import { applyLook, MAX_PITCH, moveDelta, vfovFromHfov } from '../src/player';

const none = { forward: false, back: false, left: false, right: false, run: false };

describe('moveDelta', () => {
  it('walks forward along -z at yaw 0', () => {
    const [dx, dz] = moveDelta({ ...none, forward: true }, 0, 1, 1.4, 2.8);
    expect(dx).toBeCloseTo(0);
    expect(dz).toBeCloseTo(-1.4);
  });
  it('strafes right along +x at yaw 0, and runs', () => {
    const [dx, dz] = moveDelta({ ...none, right: true, run: true }, 0, 1, 1.4, 2.8);
    expect(dx).toBeCloseTo(2.8);
    expect(dz).toBeCloseTo(0);
  });
  it('turns with yaw and normalises diagonals', () => {
    const [dx] = moveDelta({ ...none, forward: true }, Math.PI / 2, 1, 1, 2);
    expect(dx).toBeCloseTo(-1);
    const [ax, az] = moveDelta({ ...none, forward: true, right: true }, 0, 1, 1, 2);
    expect(Math.hypot(ax, az)).toBeCloseTo(1);
  });
  it('is zero with no keys', () => {
    expect(moveDelta(none, 0, 1)).toEqual([0, 0]);
  });
});

describe('look', () => {
  it('clamps pitch', () => {
    const [yaw, pitch] = applyLook(0, 0, 100, -10000, 0.01);
    expect(yaw).toBeCloseTo(-1);
    expect(pitch).toBe(MAX_PITCH);
  });
  it('converts horizontal to vertical fov', () => {
    expect(vfovFromHfov(Math.PI / 2, 1)).toBeCloseTo(90);
    expect(vfovFromHfov(Math.PI / 2, 1.6)).toBeCloseTo(64.01, 1);
  });
});
