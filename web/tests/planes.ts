import { Object3D, Vector3 } from 'three';
import type { Hit, Raycast } from '../src/prop-physics';

/** An infinite plane n·p = d, cut to where `within` says, standing in for the flat's meshes. */
export interface Plane { normal: Vector3; d: number; within?: (p: Vector3) => boolean; object?: Object3D }
export const SURFACE = new Object3D();

export function planesRaycast(planes: Plane[]): Raycast {
  return (from, to) => {
    const dir = to.clone().sub(from);
    let best: Hit | null = null;
    let bestT = Infinity;
    for (const pl of planes) {
      const denom = pl.normal.dot(dir);
      if (Math.abs(denom) < 1e-12) continue;
      const t = (pl.d - pl.normal.dot(from)) / denom;
      if (t < 1e-9 || t > 1 || t >= bestT) continue;
      const point = from.clone().addScaledVector(dir, t);
      if (pl.within && !pl.within(point)) continue;
      bestT = t;
      best = { point, normal: denom > 0 ? pl.normal.clone().negate() : pl.normal.clone(), object: pl.object ?? SURFACE };
    }
    return best;
  };
}
export const floor = (y = 0, within?: (p: Vector3) => boolean, object?: Object3D): Plane => ({ normal: new Vector3(0, 1, 0), d: y, within, object });
export const ceiling = (y: number, within?: (p: Vector3) => boolean): Plane => ({ normal: new Vector3(0, -1, 0), d: -y, within });
export const wallX = (x: number): Plane => ({ normal: new Vector3(-1, 0, 0), d: -x });
