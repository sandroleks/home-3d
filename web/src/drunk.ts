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

/** The canvas's CSS filter: blurred when drunk, pulsing a little; empty (no filter at all) when sober. */
export function blurFilter(t: number, strength: number, px = CONFIG.wine.blur): string {
  if (strength <= 0.01) return '';
  const pulse = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.4 * t);
  return `blur(${(px * strength * pulse).toFixed(2)}px)`;
}

/** How drunk this visitor is: each sip adds to it, up to a most, and it wears off steadily. */
export class Drunk {
  level = 0;

  constructor(private cfg: Pick<Cfg, 'sip' | 'max' | 'soberRate'> = CONFIG.wine) {}

  sip(): void {
    this.level = Math.min(this.cfg.max, this.level + this.cfg.sip);
  }

  update(dt: number): void {
    this.level = Math.max(0, this.level - this.cfg.soberRate * dt);
  }

  /** How strong the effects are, 0..1: past fully drunk, more only lasts longer. */
  get strength(): number {
    return Math.min(1, this.level);
  }
}
