import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { isMirror, mirrorFace } from '../src/mirrors';

const box = (w: number, h: number, d: number, x: number, y: number, z: number, name = '') => {
  const m = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ name }));
  m.position.set(x, y, z);
  return m;
};

describe('isMirror', () => {
  it('matches the mirror material, not its frame', () => {
    expect(isMirror(new MeshStandardMaterial({ name: 'Mirror' }))).toBe(true);
    expect(isMirror(new MeshStandardMaterial({ name: 'Mirror.001' }))).toBe(true);
    expect(isMirror(new MeshStandardMaterial({ name: 'WC02ex mirror frame black' }))).toBe(false);
  });
});

describe('mirrorFace', () => {
  it('faces away from the door it is mounted on', () => {
    const root = new Group();
    const door = box(0.6, 2, 0.04, 0, 1, 0);
    const mirror = box(0.44, 1.6, 0.004, 0, 1.2, -0.022, 'Mirror');
    root.add(door, mirror);
    root.updateMatrixWorld(true);
    const face = mirrorFace(mirror, [root])!;
    expect(face.normal.toArray()).toEqual([-0, -0, -1]);
    expect(face.center.z).toBeCloseTo(-0.025, 3);
    expect(face.center.y).toBeCloseTo(1.2);
    expect(face.width).toBeCloseTo(0.44);
    expect(face.height).toBeCloseTo(1.6);
  });

  it('works along x, with width taken from z', () => {
    const root = new Group();
    const wall = box(0.1, 3, 4, 0.06, 1.5, 0);
    const mirror = box(0.01, 0.6, 0.5, 0, 1.6, 0.3, 'Mirror');
    root.add(wall, mirror);
    root.updateMatrixWorld(true);
    const face = mirrorFace(mirror, [root])!;
    expect(face.normal.x).toBe(-1);
    expect(face.width).toBeCloseTo(0.5);
    expect(face.height).toBeCloseTo(0.6);
  });

  it('skips slabs that are not thin or have no open side', () => {
    const root = new Group();
    const thick = box(0.5, 0.5, 0.2, 0, 1, 0, 'Mirror');
    const boxed = box(0.4, 0.4, 0.004, 5, 1, 0, 'Mirror');
    root.add(thick, boxed, box(0.6, 0.6, 0.01, 5, 1, 0.02), box(0.6, 0.6, 0.01, 5, 1, -0.02));
    root.updateMatrixWorld(true);
    expect(mirrorFace(thick, [root])).toBeNull();
    expect(mirrorFace(boxed, [root])).toBeNull();
  });
});
