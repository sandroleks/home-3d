import { Box3, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { findPlacement, type PlaceProbe } from '../src/prop-placement';
import { ceiling, floor, planesRaycast, wallX } from './planes';

const down = new Vector3(0, -1, -1).normalize();
const eye = new Vector3(0, 1.6, 0);
const glass: [number, number, number] = [0.076, 0.1, 0.076];
const probe = (planes: Parameters<typeof planesRaycast>[0], extra: Partial<PlaceProbe> = {}): PlaceProbe =>
  ({ raycast: planesRaycast(planes), overlaps: () => false, drawerOf: () => null, ...extra });

describe('findPlacement', () => {
  it('puts a thing on a worktop where the crosshair meets it', () => {
    const r = findPlacement(eye, down, 0.3, glass, probe([floor(0.9)]));
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.placement.point.y).toBeCloseTo(0.9);
      expect(r.placement.point.z).toBeCloseTo(-0.7);
      expect(r.placement.yaw).toBe(0.3);
      expect(r.placement.node).toBeNull();
    }
  });

  it('does not put things on walls', () => {
    expect(findPlacement(eye, new Vector3(1, 0, 0), 0, glass, probe([wallX(1)]))).toEqual({ ok: false, reason: 'wall' });
  });

  it('only reaches so far', () => {
    expect(findPlacement(eye, down, 0, glass, probe([floor(0.9)]), undefined, 0.5)).toBeNull();
  });

  it('needs the surface under all of it', () => {
    const edge = floor(0.9, (p) => p.z > -0.72); // the worktop ends just past where the crosshair meets it
    expect(findPlacement(eye, down, 0, glass, probe([edge, floor(0)]))).toEqual({ ok: false, reason: 'room' });
  });

  it('needs room above it', () => {
    expect(findPlacement(eye, down, 0, glass, probe([floor(0.9), ceiling(0.95, (p) => p.z < -0.67 && p.z > -0.75)]))).toEqual({ ok: false, reason: 'room' });
  });

  it('keeps things apart', () => {
    const boxes: Box3[] = [];
    const r = findPlacement(eye, down, 0, glass, probe([floor(0.9)], { overlaps: (b) => (boxes.push(b.clone()), true) }));
    expect(r).toEqual({ ok: false, reason: 'room' });
    expect(boxes[0].max.y - boxes[0].min.y).toBeCloseTo(0.1);
  });

  it('puts a thing in a drawer when it fits under the drawer above', () => {
    const drawer = new Object3D();
    const inside = (height: number) => probe([floor(0.9)], { drawerOf: () => ({ node: drawer, height }) });
    const ok = findPlacement(eye, down, 0, glass, inside(0.15));
    expect(ok?.ok && ok.placement.node).toBe(drawer);
    expect(findPlacement(eye, down, 0, glass, inside(0.08))).toEqual({ ok: false, reason: 'room' });
  });
});
