import type { PerspectiveCamera } from 'three';
import type { Collision } from './collision';
import { CONFIG } from './config';
import type { Spawn } from './manifest';

export interface MoveKeys { forward: boolean; back: boolean; left: boolean; right: boolean; run: boolean }
/** The touch stick: forward and right in [-1, 1] with a length of at most 1, and whether it's pushed far enough to run. */
export interface Stick { forward: number; right: number; run: boolean }

export const STILL: Stick = { forward: 0, right: 0, run: false };

export const MAX_PITCH = Math.PI / 2 - 0.01;

const KEY_MAP: Record<string, keyof MoveKeys> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};

/** Forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw). Keys win over the stick when both are used. */
export function moveDelta(
  keys: MoveKeys, yaw: number, dt: number, walk = CONFIG.walkSpeed, run = CONFIG.runSpeed, stick = STILL,
): [number, number] {
  let f = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  let s = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const len = Math.hypot(f, s);
  if (len > 0) {
    f /= len;
    s /= len;
  } else {
    f = stick.forward; // the stick is analog: a partial push walks slower
    s = stick.right;
    if (f === 0 && s === 0) return [0, 0];
  }
  const speed = (keys.run || (len === 0 && stick.run) ? run : walk) * dt;
  return [
    (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed,
    (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed,
  ];
}

export function applyLook(yaw: number, pitch: number, mx: number, my: number, sens: number): [number, number] {
  return [yaw - mx * sens, Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch - my * sens))];
}

export function vfovFromHfov(hfov: number, aspect: number): number {
  return (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI;
}

/** The vertical field of view (degrees): `vfov`, widened on tall screens so at least `minHfov` degrees show across. */
export function screenFov(aspect: number, vfov = CONFIG.verticalFov, minHfov = CONFIG.minHorizontalFov): number {
  return Math.max(vfov, vfovFromHfov((minHfov * Math.PI) / 180, aspect));
}

export class Player {
  x: number;
  z: number;
  yaw: number;
  pitch = 0;
  frozen = false;
  keys: MoveKeys = { forward: false, back: false, left: false, right: false, run: false };
  stick: Stick = STILL;

  constructor(
    private camera: PerspectiveCamera,
    private collision: Collision,
    spawn: Spawn,
    public eyeHeight: number,
  ) {
    this.x = spawn.x;
    this.z = spawn.z;
    this.yaw = spawn.yaw;
    camera.rotation.order = 'YXZ';
  }

  attach(target: Window, lockElement: () => Element | null): void {
    target.addEventListener('keydown', (e) => {
      const k = KEY_MAP[e.code];
      if (k) this.keys[k] = true;
    });
    target.addEventListener('keyup', (e) => {
      const k = KEY_MAP[e.code];
      if (k) this.keys[k] = false;
    });
    target.addEventListener('blur', () => {
      for (const k of Object.keys(this.keys) as (keyof MoveKeys)[]) this.keys[k] = false;
    });
    target.addEventListener('mousemove', (e) => {
      if (lockElement()) this.look(e.movementX, e.movementY, CONFIG.mouseSensitivity);
    });
  }

  look(dx: number, dy: number, sensitivity: number): void {
    [this.yaw, this.pitch] = applyLook(this.yaw, this.pitch, dx, dy, sensitivity);
  }

  /** Walking fast, by Shift or by pushing the stick far: footsteps space out. */
  get running(): boolean {
    return this.keys.run || this.stick.run;
  }

  update(dt: number): void {
    if (!this.frozen) {
      const [dx, dz] = moveDelta(this.keys, this.yaw, dt, CONFIG.walkSpeed, CONFIG.runSpeed, this.stick);
      [this.x, this.z] = this.collision.move(this.x, this.z, dx, dz);
    }
    this.camera.position.set(this.x, this.eyeHeight, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  resolve(): void {
    [this.x, this.z] = this.collision.nearestFree(this.x, this.z);
  }

  teleport(x: number, z: number, yaw: number, pitch: number, eyeHeight = this.eyeHeight): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = pitch;
    this.eyeHeight = eyeHeight;
  }
}
