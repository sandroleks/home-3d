import type { Segment } from './collision';
import { CONFIG } from './config';
import type { DoorInfo } from './manifest';

/** Rotate a ground-plane vector (x, z) about +Y, same as geom.rot_y in the pipeline. */
export function rotY(v: readonly [number, number], phi: number): [number, number] {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c];
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class DoorState {
  progress = 0;
  target = 0;

  constructor(readonly info: DoorInfo, private duration = CONFIG.doorDuration) {}

  get angle(): number {
    return this.info.openAngle * easeInOut(this.progress);
  }

  get isOpen(): boolean {
    return this.target === 1;
  }

  toggle(): void {
    this.target = this.target === 1 ? 0 : 1;
  }

  update(dt: number): void {
    const step = dt / this.duration;
    this.progress = this.target > this.progress
      ? Math.min(1, this.progress + step)
      : Math.max(0, this.progress - step);
  }

  segment(): Segment {
    const [dx, dz] = rotY(this.info.dir, this.angle);
    const [hx, hz] = this.info.hinge;
    return { ax: hx, az: hz, bx: hx + dx * this.info.width, bz: hz + dz * this.info.width };
  }
}
