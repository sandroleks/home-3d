import { Box3, type Object3D, Vector3 } from 'three';
import { CONFIG } from './config';
import type { Raycast } from './prop-physics';

/** What placing needs from the flat: rays, the other loose things, and which drawer a surface is part of (and how tall
 * a thing may be in it, so it can still close). */
export interface PlaceProbe {
  raycast: Raycast;
  overlaps: (box: Box3) => boolean;
  drawerOf: (o: Object3D) => { node: Object3D; height: number | null } | null;
}
/** Where a thing would go: the surface point under its middle, its heading, and the drawer it would ride with. */
export interface Placement { point: Vector3; yaw: number; node: Object3D | null }
/** `wall`: not a surface facing up; `room`: a surface, but the thing doesn't fit there. */
export type PlaceResult = { ok: true; placement: Placement } | { ok: false; reason: 'wall' | 'room' };

const UP = new Vector3(0, 1, 0);
const to = new Vector3();
const a = new Vector3();
const b = new Vector3();

/**
 * Where a thing of `size` (width, height, length) goes when put down along a ray from `from`: on the first surface the
 * ray meets within reach, standing upright and turned to `yaw`, if the surface is under all of its footprint, nothing is
 * above it, and no other loose thing is in the way. Null when nothing is in reach.
 */
export function findPlacement(from: Vector3, dir: Vector3, yaw: number, size: [number, number, number], probe: PlaceProbe,
  cfg = CONFIG.props.place, reach = CONFIG.interactDistance): PlaceResult | null {
  const hit = probe.raycast(from, to.copy(from).addScaledVector(dir, reach));
  if (!hit) return null;
  if (hit.normal.y < cfg.upNormal) return { ok: false, reason: 'wall' };
  const point = hit.point;
  const [w, h, l] = size;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) =>
    new Vector3((i * w) / 2, 0, (j * l) / 2).applyAxisAngle(UP, yaw).add(point));
  const box = new Box3().setFromPoints([...corners, point.clone().addScaledVector(UP, h)]);
  for (const c of [point, ...corners.map((c) => c.clone().lerp(point, 0.1))]) { // nothing above it
    if (probe.raycast(a.copy(c).addScaledVector(UP, 0.01), b.copy(c).addScaledVector(UP, h + 0.01))) return { ok: false, reason: 'room' };
  }
  for (const c of corners) { // the surface under each corner
    const under = probe.raycast(a.copy(c).addScaledVector(UP, 0.05), b.copy(c).addScaledVector(UP, -0.03));
    if (!under || Math.abs(under.point.y - point.y) > cfg.support) return { ok: false, reason: 'room' };
  }
  if (probe.overlaps(box)) return { ok: false, reason: 'room' };
  const drawer = probe.drawerOf(hit.object);
  if (drawer && drawer.height !== null && h > drawer.height + 0.002) return { ok: false, reason: 'room' };
  return { ok: true, placement: { point: point.clone(), yaw, node: drawer?.node ?? null } };
}
