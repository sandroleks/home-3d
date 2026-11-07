import type { CollisionData } from './manifest';

/** `radius`: how close the player may come; the player's own radius when left out. */
export interface Segment { ax: number; az: number; bx: number; bz: number; radius?: number }

export function segmentDistance(px: number, pz: number, s: Segment): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / len2)) : 0;
  return Math.hypot(px - (s.ax + t * dx), pz - (s.az + t * dz));
}

export class Collision {
  /** Each free cell's area: cells you can walk between share a number (made on first use). */
  private regions: Int32Array | null = null;

  constructor(private grid: CollisionData, private segments: () => Segment[] = () => []) {}

  /** The free area a point is in, numbered (-1 when it is blocked or off the grid): two points share one when you
   * can walk from one to the other, doors aside (they open). */
  regionAt(x: number, z: number): number {
    const g = this.grid;
    const i = Math.floor((x - g.x0) / g.cell);
    const j = Math.floor((z - g.z0) / g.cell);
    if (i < 0 || j < 0 || i >= g.width || j >= g.height) return -1;
    return this.labels()[j * g.width + i];
  }

  private labels(): Int32Array {
    if (this.regions) return this.regions;
    const g = this.grid;
    const labels = new Int32Array(g.width * g.height).fill(-1);
    const queue = new Int32Array(g.width * g.height);
    let next = 0;
    for (let start = 0; start < labels.length; start++) {
      if (g.blocked[start] || labels[start] >= 0) continue;
      let head = 0;
      let tail = 0;
      labels[start] = next;
      queue[tail++] = start;
      while (head < tail) {
        const k = queue[head++];
        const i = k % g.width;
        for (const n of [k - g.width, k + g.width, i > 0 ? k - 1 : -1, i < g.width - 1 ? k + 1 : -1]) {
          if (n < 0 || n >= labels.length || g.blocked[n] || labels[n] >= 0) continue;
          labels[n] = next;
          queue[tail++] = n;
        }
      }
      next++;
    }
    this.regions = labels;
    return labels;
  }

  gridBlocked(x: number, z: number): boolean {
    const g = this.grid;
    const i = Math.floor((x - g.x0) / g.cell);
    const j = Math.floor((z - g.z0) / g.cell);
    if (i < 0 || j < 0 || i >= g.width || j >= g.height) return true;
    return g.blocked[j * g.width + i] === 1;
  }

  isBlocked(x: number, z: number): boolean {
    if (this.gridBlocked(x, z)) return true;
    for (const s of this.segments()) if (segmentDistance(x, z, s) < (s.radius ?? this.grid.radius)) return true;
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

  /** The nearest free point to x, z; within `region` (regionAt) when it is given, so someone getting up from a seat
   * lands where they can walk from, not in a pocket of floor boxed in by furniture. */
  nearestFree(x: number, z: number, region = -1): [number, number] {
    const ok = (px: number, pz: number) => !this.isBlocked(px, pz) && (region < 0 || this.regionAt(px, pz) === region);
    if (ok(x, z)) return [x, z];
    const g = this.grid;
    const i0 = Math.floor((x - g.x0) / g.cell);
    const j0 = Math.floor((z - g.z0) / g.cell);
    for (let r = 1; r <= g.width + g.height; r++) { // far enough from any start, even off the grid
      let best: [number, number] | null = null;
      let bestDist = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const cx = g.x0 + (i0 + di + 0.5) * g.cell;
          const cz = g.z0 + (j0 + dj + 0.5) * g.cell;
          const d = Math.hypot(cx - x, cz - z);
          if (d < bestDist && ok(cx, cz)) {
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
