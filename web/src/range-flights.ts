import { CONFIG } from './config';

/** A point or a direction (x, y, z), as plain numbers so it travels as JSON. */
export type Vec3 = [number, number, number];
/** The kinds of target: a clay, a gold clay (worth more, smaller and faster), and a drone (a slow, zig-zagging one). */
export type TargetKind = 'clay' | 'gold' | 'drone';
type RangeConfig = typeof CONFIG.range;

/**
 * One target's flight in a round: what it is, when it launches (s into the round) and how long it flies, where it
 * starts and ends, a clay's upward speed (m/s) at launch, and the phase of a drone's zig-zag. `i` is its place in the
 * round's schedule, which names it in a hit.
 */
export interface Flight { i: number; kind: TargetKind; at: number; dur: number; from: Vec3; to: Vec3; vy: number; phase: number }

/** A small seeded generator (mulberry32), 0..1: the same seed gives the same numbers in every browser. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One flight launching at `at`. A clay or gold clay rises from below the railing or from a side and arcs down to
 * `drop` as it ends; a drone crosses from one side to the other, zig-zagging. */
function flight(kind: TargetKind, at: number, rand: () => number, cfg: RangeConfig): Omit<Flight, 'i'> {
  const between = (a: number, b: number) => a + (b - a) * rand();
  const k = cfg.kinds[kind];
  const dur = between(k.time[0], k.time[1]);
  const side = rand() < 0.5 ? -1 : 1;
  const phase = rand() * Math.PI * 2;
  if (kind === 'drone') {
    const z = cfg.rail - between(cfg.near + cfg.zigzag.swing, cfg.far - cfg.zigzag.swing); // room for its zig-zag toward and away
    const y = k.launch + between(-3, 3);
    return { kind, at, dur, from: [cfg.middle + side * cfg.across, y, z], to: [cfg.middle - side * cfg.across, y, z], vy: 0, phase };
  }
  const z0 = cfg.rail - between(cfg.near, cfg.far);
  const z1 = Math.min(cfg.rail - cfg.near, Math.max(cfg.rail - cfg.far, z0 + between(-3, 3)));
  const x0 = rand() < 0.4 ? cfg.middle + between(-6, 6) : cfg.middle + side * between(8, cfg.across); // from below, or a side
  const x1 = cfg.middle - side * between(2, 12);
  const vy = (cfg.drop - k.launch) / dur + (cfg.gravity * dur) / 2; // so it reaches `drop` as it ends
  return { kind, at, dur, from: [x0, k.launch, z0], to: [x1, cfg.drop, z1], vy, phase };
}

/** The round's flights from its seed, in launch order: single targets at first, pairs from `pairsFrom` on, some of
 * them gold, and the drones spread across the round. */
export function schedule(seed: number, cfg: RangeConfig = CONFIG.range): Flight[] {
  const rand = seeded(seed);
  const s = cfg.schedule;
  const list: Omit<Flight, 'i'>[] = [];
  for (let t = s.first; t < cfg.length - s.last; t += s.gap * (0.8 + 0.4 * rand())) {
    const n = t >= cfg.length * s.pairsFrom ? 2 : 1;
    for (let k = 0; k < n; k++) list.push(flight(rand() < s.gold ? 'gold' : 'clay', t + k * 0.2, rand, cfg));
  }
  for (let k = 0; k < s.drones; k++) list.push(flight('drone', (cfg.length * (k + 0.5)) / s.drones + 4 * rand() - 2, rand, cfg));
  return list.sort((a, b) => a.at - b.at).map((f, i) => ({ ...f, i }));
}

/** Where a target is at round time `t`, or null before it launches and after it lands. */
export function flightAt(f: Flight, t: number, cfg: RangeConfig = CONFIG.range): Vec3 | null {
  const u = t - f.at;
  if (u < 0 || u > f.dur) return null;
  const s = u / f.dur;
  const x = f.from[0] + (f.to[0] - f.from[0]) * s;
  const z = f.from[2] + (f.to[2] - f.from[2]) * s;
  const zz = cfg.zigzag;
  if (f.kind === 'drone') {
    return [x, f.from[1] + zz.rise * Math.sin(zz.riseRate * u + f.phase), z + zz.swing * Math.sin(zz.swingRate * u + zz.skew * f.phase)];
  }
  return [x, f.from[1] + f.vy * u - (cfg.gravity * u * u) / 2, z];
}
