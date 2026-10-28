import { CONFIG } from './config';

type Cfg = typeof CONFIG.wine;

/** How the view is thrown off: radians of roll, yaw and pitch, and metres sideways and up. */
export interface Wobble { roll: number; yaw: number; pitch: number; side: number; bob: number }

export const STEADY: Wobble = { roll: 0, yaw: 0, pitch: 0, side: 0, bob: 0 };

/** Two sines at unrelated frequencies: a sway that wanders instead of ticking like a metronome. */
const wander = (t: number, a: number, b: number) => 0.6 * Math.sin(t * a) + 0.4 * Math.sin(t * b + 1.3);

/** The view's wobble at time `t` (s) for an effect `strength` 0..1; nothing when sober. */
export function wobbleAt(t: number, strength: number, cfg: Cfg['wobble'] = CONFIG.wine.wobble): Wobble {
  if (strength <= 0) return STEADY;
  const w = 2 * Math.PI * cfg.speed * t;
  return {
    roll: cfg.roll * strength * wander(w, 1, 2.31),
    yaw: cfg.yaw * strength * wander(w, 0.73, 1.87),
    pitch: cfg.pitch * strength * wander(w, 1.41, 0.57),
    side: cfg.side * strength * wander(w, 1, 2.31), // the head goes the way it rolls
    bob: cfg.bob * strength * wander(w, 1.9, 0.83),
  };
}

/** The canvas's CSS filter: blurred when drunk, pulsing a little, and darkened to black as you black out (`dark`
 * 0..1); empty (no filter at all) when sober and awake. */
export function viewFilter(t: number, strength: number, dark = 0, px = CONFIG.wine.blur): string {
  const parts: string[] = [];
  if (strength > 0.01) {
    const pulse = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.4 * t);
    parts.push(`blur(${(px * strength * pulse).toFixed(2)}px)`);
  }
  if (dark > 0.001) parts.push(`brightness(${(1 - dark).toFixed(3)})`);
  return parts.join(' ');
}

type DrunkCfg = Pick<Cfg, 'sip' | 'max' | 'soberRate'> & { blackout?: Cfg['blackout'] };

/** How drunk this visitor is: each sip adds to it, up to a most, and it wears off steadily. Too many sips too fast
 * black you out. */
export class Drunk {
  level = 0;
  /** Seconds since this started (for the sips' times), and since the blackout started (null awake). */
  private time = 0;
  private out: number | null = null;
  private sips: number[] = [];

  constructor(private cfg: DrunkCfg = CONFIG.wine) {}

  private get blackout(): Cfg['blackout'] {
    return this.cfg.blackout ?? CONFIG.wine.blackout;
  }

  /** A sip; true when it was one too many and blacks you out (you come to fully drunk, and the count starts over). */
  sip(): boolean {
    const b = this.blackout;
    this.level = Math.min(this.cfg.max, this.level + this.cfg.sip);
    this.sips = this.sips.filter((t) => this.time - t < b.window);
    this.sips.push(this.time);
    if (this.out !== null || this.sips.length <= b.sips) return false;
    this.out = 0;
    this.sips = [];
    this.level = this.cfg.max;
    return true;
  }

  update(dt: number): void {
    this.time += dt;
    this.level = Math.max(0, this.level - this.cfg.soberRate * dt);
    if (this.out === null) return;
    const b = this.blackout;
    this.out += dt;
    if (this.out >= b.fade + b.hold + b.wake) this.out = null;
  }

  /** How strong the effects are, 0..1: past fully drunk, more only lasts longer. */
  get strength(): number {
    return Math.min(1, this.level);
  }

  /** How black the view is, 0..1: fading out, out cold, then coming to. */
  get darkness(): number {
    if (this.out === null) return 0;
    const b = this.blackout;
    if (this.out < b.fade) return this.out / b.fade;
    if (this.out < b.fade + b.hold) return 1;
    return Math.max(0, 1 - (this.out - b.fade - b.hold) / b.wake);
  }

  /** Out cold, or going: you can't move, sit, stand or drink until you start to come to. */
  get passedOut(): boolean {
    const b = this.blackout;
    return this.out !== null && this.out < b.fade + b.hold;
  }
}
