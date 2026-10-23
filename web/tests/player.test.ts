import { describe, expect, it } from 'vitest';
import { applyLook, MAX_PITCH, moveDelta, screenFov, vfovFromHfov } from '../src/player';

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
  it('walks by the touch stick, slower for a partial push, and runs when it says so', () => {
    const [dx, dz] = moveDelta(none, 0, 1, 1.4, 2.8, { forward: 0.5, right: 0, run: false });
    expect(dx).toBeCloseTo(0);
    expect(dz).toBeCloseTo(-0.7);
    const [rx] = moveDelta(none, 0, 1, 1.4, 2.8, { forward: 0, right: 1, run: true });
    expect(rx).toBeCloseTo(2.8);
  });
  it('lets the keys win over the stick', () => {
    const [dx, dz] = moveDelta({ ...none, back: true }, 0, 1, 1, 2, { forward: 1, right: 0, run: true });
    expect(dx).toBeCloseTo(0);
    expect(dz).toBeCloseTo(1);
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
  it('keeps the vertical fov on wide screens and widens it on tall ones', () => {
    expect(screenFov(16 / 9, 70, 50)).toBe(70);
    const tall = 390 / 844;
    expect(screenFov(tall, 70, 50)).toBeGreaterThan(70);
    expect(2 * Math.atan(Math.tan((screenFov(tall, 70, 50) * Math.PI) / 360) * tall) * 180 / Math.PI).toBeCloseTo(50);
  });
});
