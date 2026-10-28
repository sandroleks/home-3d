import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { fly, launch, meshRaycast, type Raycast, type Shape, type Step } from '../src/prop-physics';
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

describe('meshRaycast', () => {
  it('hits the top of a floor slab from above, and respects the segment length', () => {
    const slab = new Mesh(new BoxGeometry(4, 0.1, 4), new MeshBasicMaterial());
    slab.position.y = -0.05;
    slab.updateMatrixWorld(true);
    const ray = meshRaycast([slab]);
    const hit = ray(new Vector3(0.3, 1, 0.2), new Vector3(0.3, -1, 0.2));
    expect(hit).not.toBeNull();
    expect(hit!.point.y).toBeCloseTo(0, 5);
    expect(hit!.point.x).toBeCloseTo(0.3, 5);
    expect(hit!.normal.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
    expect(hit!.object).toBe(slab);
    expect(ray(new Vector3(0.3, 1, 0.2), new Vector3(0.3, 0.5, 0.2))).toBeNull();
  });

  it('stops a segment at a thin glass pane from either side, normal facing back', () => {
    const pane = new Mesh(new BoxGeometry(1, 1, 0.006), new MeshStandardMaterial({ transparent: true, opacity: 0.2 }));
    pane.updateMatrixWorld(true);
    const ray = meshRaycast([pane]);
    const front = ray(new Vector3(0, 0, 1), new Vector3(0, 0, -1));
    expect(front!.point.z).toBeCloseTo(0.003, 5);
    expect(front!.normal.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6);
    const back = ray(new Vector3(0, 0, -1), new Vector3(0, 0, 1));
    expect(back!.point.z).toBeCloseTo(-0.003, 5);
    expect(back!.normal.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-6);
  });

  it('gives a unit normal perpendicular to the surface under a rotated, non-uniformly scaled parent', () => {
    const parent = new Group();
    parent.scale.set(2, 1, 0.5);
    parent.rotation.set(0.4, 0.7, 0.2);
    // A slab whose top face (local +y) is tilted by the parent's rotation and sheared by its scale.
    const mesh = new Mesh(new BoxGeometry(3, 0.1, 3), new MeshBasicMaterial());
    mesh.rotation.z = 0.6; // tilted inside the scaled parent, so the scale really shears its normal
    parent.add(mesh);
    parent.updateMatrixWorld(true);
    // The top face's world plane: normal = Rp * S^-1 * Rm * up, normalised; centre at the mesh's top.
    const expected = new Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).divide(parent.scale).applyQuaternion(parent.quaternion).normalize();
    const top = new Vector3(0, 0.05, 0).applyMatrix4(mesh.matrixWorld);
    const from = top.clone().addScaledVector(expected, 1);
    const to = top.clone().addScaledVector(expected, -1);
    const hit = meshRaycast([parent])(from, to);
    expect(hit).not.toBeNull();
    expect(hit!.normal.length()).toBeCloseTo(1, 6);
    expect(hit!.normal.distanceTo(expected)).toBeLessThan(1e-5);
  });

  it('follows a mesh that moves between calls: hits its new place, not the old one', () => {
    const box = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial());
    box.updateMatrixWorld(true);
    const ray = meshRaycast([box]);
    const down = (x: number) => ray(new Vector3(x, 1, 0), new Vector3(x, -1, 0));
    expect(down(0)).not.toBeNull();
    expect(down(2)).toBeNull();
    box.position.x = 2;
    box.updateMatrixWorld(true);
    expect(down(2)!.point.y).toBeCloseTo(0.1, 5);
    expect(down(0)).toBeNull();
  });
});
