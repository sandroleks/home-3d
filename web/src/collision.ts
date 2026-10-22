import type { CollisionData } from './manifest';

export interface Segment { ax: number; az: number; bx: number; bz: number }

export function segmentDistance(px: number, pz: number, s: Segment): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / len2)) : 0;
  return Math.hypot(px - (s.ax + t * dx), pz - (s.az + t * dz));
}

export class Collision {
  constructor(private grid: CollisionData, private segments: () => Segment[] = () => []) {}

  gridBlocked(x: number, z: number): boolean {
    const g = this.grid;
    const i = Math.floor((x - g.x0) / g.cell);
    const j = Math.floor((z - g.z0) / g.cell);
    if (i < 0 || j < 0 || i >= g.width || j >= g.height) return true;
    return g.blocked[j * g.width + i] === 1;
  }

  isBlocked(x: number, z: number): boolean {
    if (this.gridBlocked(x, z)) return true;
    for (const s of this.segments()) if (segmentDistance(x, z, s) < this.grid.radius) return true;
    return false;
  }

  /** Axis-separated sliding, in sub-steps no longer than half a cell. */
  move(x: number, z: number, dx: number, dz: number): [number, number] {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (this.grid.cell / 2)));
    const sx = dx / steps;
    const sz = dz / steps;
    for (let k = 0; k < steps; k++) {
      if (!this.isBlocked(x + sx, z)) x += sx;
      if (!this.isBlocked(x, z + sz)) z += sz;
    }
    return [x, z];
  }

  nearestFree(x: number, z: number): [number, number] {
    if (!this.isBlocked(x, z)) return [x, z];
    const g = this.grid;
    const i0 = Math.floor((x - g.x0) / g.cell);
    const j0 = Math.floor((z - g.z0) / g.cell);
    for (let r = 1; r < Math.max(g.width, g.height); r++) {
      let best: [number, number] | null = null;
      let bestDist = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const cx = g.x0 + (i0 + di + 0.5) * g.cell;
          const cz = g.z0 + (j0 + dj + 0.5) * g.cell;
          const d = Math.hypot(cx - x, cz - z);
          if (d < bestDist && !this.isBlocked(cx, cz)) {
            best = [cx, cz];
            bestDist = d;
          }
        }
      }
      if (best) return best;
    }
    return [x, z];
  }
}
