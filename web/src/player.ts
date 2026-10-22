import type { PerspectiveCamera } from 'three';
import type { Collision } from './collision';
import { CONFIG } from './config';
import type { Spawn } from './manifest';

export interface MoveKeys { forward: boolean; back: boolean; left: boolean; right: boolean; run: boolean }

export const MAX_PITCH = Math.PI / 2 - 0.01;

const KEY_MAP: Record<string, keyof MoveKeys> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};

/** Forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw). */
export function moveDelta(
  keys: MoveKeys, yaw: number, dt: number, walk = CONFIG.walkSpeed, run = CONFIG.runSpeed,
): [number, number] {
  let f = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  let s = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const len = Math.hypot(f, s);
  if (len === 0) return [0, 0];
  f /= len;
  s /= len;
  const speed = (keys.run ? run : walk) * dt;
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

export class Player {
  x: number;
  z: number;
  yaw: number;
  pitch = 0;
  frozen = false;
  keys: MoveKeys = { forward: false, back: false, left: false, right: false, run: false };

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
      if (!lockElement()) return;
      [this.yaw, this.pitch] = applyLook(this.yaw, this.pitch, e.movementX, e.movementY, CONFIG.mouseSensitivity);
    });
  }

  update(dt: number): void {
    if (!this.frozen) {
      const [dx, dz] = moveDelta(this.keys, this.yaw, dt);
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
