import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { fly, launch, type Raycast, type Shape, type Step } from '../src/prop-physics';
import { floor, planesRaycast, wallX } from './planes';

const glass: Shape = { radius: 0.04, tips: true };
const plate: Shape = { radius: 0.06, tips: false };

/** Runs a flight until it stops, at 60 frames a second, for at most `seconds`. */
function run(start: Vector3, velocity: Vector3, ray: Raycast, shape: Shape, seconds = 10, cfg = CONFIG.props.physics): Step {
  const f = launch(start, velocity);
  for (let t = 0; t < seconds; t += 1 / 60) {
    const s = fly(f, 1 / 60, ray, shape, cfg);
    if (s.kind !== 'flying') return s;
  }
  return { kind: 'flying' };
}

describe('prop physics', () => {
  it('drops onto the floor and stays upright from the hand', () => {
    const s = run(new Vector3(0, 1, 0), new Vector3(), planesRaycast([floor(0)]), glass);
    expect(s.kind).toBe('rest');
    if (s.kind !== 'rest') return;
    expect(s.point.y).toBeCloseTo(0, 3);
    expect(Math.abs(s.point.x)).toBeLessThan(0.01);
    expect(s.tipped).toBe(false);
  });

  it('tips a tall thing that lands hard, but not a flat one', () => {
    const hard = run(new Vector3(0, 3, 0), new Vector3(), planesRaycast([floor(0)]), glass);
    expect(hard.kind === 'rest' && hard.tipped).toBe(true);
    const flatOne = run(new Vector3(0, 3, 0), new Vector3(), planesRaycast([floor(0)]), plate);
    expect(flatOne.kind === 'rest' && flatOne.tipped).toBe(false);
  });

  it('bounces and slides to a stop along the floor', () => {
    const s = run(new Vector3(0, 0.05, 0), new Vector3(3, 0, 0), planesRaycast([floor(0)]), plate);
    expect(s.kind).toBe('rest');
    if (s.kind === 'rest') {
      expect(s.point.x).toBeGreaterThan(0.3);
      expect(s.point.x).toBeLessThan(1.2);
    }
  });

  it('comes off a wall and lands in front of it', () => {
    const s = run(new Vector3(0, 1, 0), new Vector3(6, 0, 0), planesRaycast([floor(0), wallX(1)]), glass);
    expect(s.kind).toBe('rest');
    if (s.kind === 'rest') expect(s.point.x).toBeLessThan(1);
  });

  it('slides off the edge of a table onto the floor', () => {
    const table = floor(0.7, (p) => p.x < 0.5);
    const s = run(new Vector3(0, 0.75, 0), new Vector3(3, 0, 0), planesRaycast([table, floor(0)]), plate);
    expect(s.kind).toBe('rest');
    if (s.kind === 'rest') {
      expect(s.point.y).toBeCloseTo(0, 3);
      expect(s.point.x).toBeGreaterThan(0.5);
    }
  });

  it('is lost when it falls out of the flat', () => {
    expect(run(new Vector3(0, 1, 0), new Vector3(), () => null, glass).kind).toBe('lost');
  });

  it('sets a flight down where it is after the longest flight', () => {
    const cfg = { ...CONFIG.props.physics, maxFlight: 0.2, gravity: 0, floorCatch: -1e9 };
    const s = run(new Vector3(0, 1, 0), new Vector3(1, 0, 0), planesRaycast([floor(0)]), glass, 2, cfg);
    expect(s.kind).toBe('rest');
    if (s.kind === 'rest') {
      expect(s.point.y).toBeCloseTo(0, 3);
      expect(s.point.x).toBeCloseTo(0.2, 1);
    }
  });

  it('steps a fast throw finely enough not to pass through a thin shelf', () => {
    const shelf = floor(0.5);
    const s = run(new Vector3(0, 0.6, 0), new Vector3(0, -12, 0), planesRaycast([shelf, floor(0)]), glass);
    expect(s.kind === 'rest' && s.point.y).toBeCloseTo(0.5, 3);
  });
});
