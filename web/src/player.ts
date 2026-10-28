import type { PerspectiveCamera } from 'three';
import type { Collision } from './collision';
import { CONFIG } from './config';
import { STEADY, type Wobble } from './drunk';
import type { Spawn } from './manifest';
import { eyeOf, type Seated, standPoint } from './seats';

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

/** Smoothstep: eases a 0..1 transition in and out. */
export function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
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
  /** At a game board: the movement keys and stick neither walk nor stand you up (standing is the board's button or C). */
  held = false;
  keys: MoveKeys = { forward: false, back: false, left: false, right: false, run: false };
  stick: Stick = STILL;
  /** Sitting or lying, and where; null standing. */
  seat: Seated | null = null;
  /** Drunk, the view is thrown off this much on top of where you stand and look (drunk.ts); it never moves you. */
  wobble: Wobble = STEADY;
  /** The camera easing from where it was when the visitor sat down or stood up: its start, and how far along (0..1). */
  private from: [number, number, number] | null = null;
  private eased = 1;
  /** Movement held while sitting down doesn't stand you straight back up: it has to be let go first. */
  private holdingMove = false;

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

  /** Any walking input, keys or stick. */
  get moving(): boolean {
    const k = this.keys;
    return k.forward || k.back || k.left || k.right || this.stick.forward !== 0 || this.stick.right !== 0;
  }

  /** Sits or lies down: on a seat the view turns the way it faces (lying, up toward the ceiling); on the floor it
   * stays where it was looking. */
  sit(s: Seated, turn = true): void {
    this.startEase();
    this.seat = s;
    this.x = s.x;
    this.z = s.z;
    if (turn) {
      this.yaw = s.yaw;
      this.pitch = s.posture === 'lie' ? CONFIG.seats.liePitch : 0;
    }
    this.holdingMove = this.moving;
  }

  /** Gets up, a step in front of the seat (or the nearest free spot to it). */
  stand(): void {
    if (!this.seat) return;
    const [x, z] = standPoint(this.seat);
    this.startEase();
    this.seat = null;
    [this.x, this.z] = this.collision.nearestFree(x, z);
  }

  private startEase(): void {
    const p = this.camera.position;
    this.from = [p.x, p.y, p.z];
    this.eased = 0;
  }

  update(dt: number): void {
    if (this.seat) {
      if (!this.moving) this.holdingMove = false;
      else if (!this.holdingMove && !this.frozen && !this.held) this.stand();
    }
    if (!this.frozen && !this.seat) {
      const [dx, dz] = moveDelta(this.keys, this.yaw, dt, CONFIG.walkSpeed, CONFIG.runSpeed, this.stick);
      [this.x, this.z] = this.collision.move(this.x, this.z, dx, dz);
    }
    const [x, y, z] = this.seat ? eyeOf(this.seat) : [this.x, this.eyeHeight, this.z];
    if (this.from) {
      this.eased = Math.min(1, this.eased + dt / CONFIG.seats.transition);
      const k = ease(this.eased);
      this.camera.position.set(this.from[0] + (x - this.from[0]) * k, this.from[1] + (y - this.from[1]) * k, this.from[2] + (z - this.from[2]) * k);
      if (this.eased >= 1) this.from = null;
    } else this.camera.position.set(x, y, z);
    const w = this.wobble;
    const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + w.pitch));
    this.camera.rotation.set(pitch, this.yaw + w.yaw, w.roll);
    // Sideways along the view's right (cos yaw, -sin yaw), and up and down
    this.camera.position.x += Math.cos(this.yaw) * w.side;
    this.camera.position.z -= Math.sin(this.yaw) * w.side;
    this.camera.position.y += w.bob;
  }

  resolve(): void {
    [this.x, this.z] = this.collision.nearestFree(this.x, this.z);
  }

  teleport(x: number, z: number, yaw: number, pitch: number, eyeHeight = this.eyeHeight): void {
    this.seat = null;
    this.from = null;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = pitch;
    this.eyeHeight = eyeHeight;
  }
}
