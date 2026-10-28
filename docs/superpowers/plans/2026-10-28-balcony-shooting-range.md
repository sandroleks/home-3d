# Balcony Shooting Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shooting range on the Varanda (the office's balcony): pick up a rifle from a rack, press a big red Start button, and everyone holding a rifle competes in a shared 60 s round to shoot clay pigeons, gold clays and drones flying over the street.

**Architecture:** Three pure modules hold the logic. `range-flights.ts` turns a seed into the round's flights and gives each target's position at a round time. `range-rules.ts` has the hit test along a ray, earliest-claim-wins and the scores. `range-game.ts` holds the round as this browser sees it, plus the `range` messages. Every browser generates the same flights from the seed in `start`. Shooters judge their own hits and send claims, and all browsers resolve the claims the same way. The 3D parts are `range-rack.ts` (the rack, the button and the rifle in hand, drawn in an overlay scene) and `range-view.ts` (the targets, shards, floating points and others' tracers). `main.ts` wires them in, as it does the wine and draw and guess.

**Tech Stack:** TypeScript, three.js 0.170 (matcap materials via `TableMaterials`), Vitest 5, Trystero through the existing `Multiplayer` (`web/src/multiplayer.ts`), the Web Audio API through `Sound` (`web/src/sound.ts`).

**Design note:** `docs/superpowers/specs/2026-10-28-balcony-shooting-range-design.md`. Read it first.

## Global Constraints

- All commands run from `web/`: `npx vitest run tests/<file>` for one file, `npm test` for all, `npx tsc --noEmit` for types.
- Viewer coordinates: the Varanda's floor is x 0.33–3.135, z −9.08 to −7.51; the railing faces −z; the balcony door (Door_4b) is at x ≈ 0.96–1.58, z −7.27. Player yaw 0 looks toward −z.
- Every tunable number goes in `CONFIG.range` (and the shot sound in `CONFIG.audio.shot`), not inline.
- Message kind `range`; older visitors ignore it. Times travel as time left (ms); round times (s) in claims and shots are relative to the round's start, negative during the countdown.
- Target kinds and points: clay 10, gold 30, drone 50. Round: 3 s countdown, 60 s running, final scores 10 s. Bolt cycle 0.6 s.
- Hidden in `?autostart` reference views (no rack, no targets).
- Copy: "Click: pick up the rifle", "Click: put the rifle back", "Click: start a round", "A round is on", "Pick up a rifle to play", "Final scores"; "Tap" in place of "Click" on touch.
- Match the code around you: short doc comments on every export, the codebase's comment voice (plain present tense, British spelling), no new dependencies.
- Commit messages start with `Shooting range: ` and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

- Create `web/src/range-flights.ts`: seeded generator, `schedule(seed)`, `flightAt(flight, t)`, types `Vec3`, `TargetKind`, `Flight`.
- Create `web/src/range-rules.ts`: `rayHit`, `winners`, `standings`, types `Claim`, `Standing`.
- Create `web/src/range-game.ts`: `RangeGame`, `isRangeMessage`, `rangeHud`, message and event types.
- Create `web/src/range-rack.ts`: `makeRifle`, `RifleRack` (rack + button), `HeldRifle` (overlay scene).
- Create `web/src/range-view.ts`: `RangeView`.
- Modify `web/src/config.ts`: `CONFIG.range`, `CONFIG.audio.shot`.
- Modify `web/src/interactions.ts`: target kinds `rack`, `range-button`, `RangeStatus`, prompts.
- Modify `web/src/presence.ts`: `isShared` (personal targets share nothing).
- Modify `web/src/multiplayer.ts`: kind `range`, hook `onRange`, `sendRange`.
- Modify `web/src/sound.ts`: `shot(at)`.
- Modify `web/src/ui.ts`, `web/index.html`, `web/src/style.css`: the top strip, the touch Fire button.
- Modify `web/src/main.ts`: wiring.
- Modify `README.md` and the design note's status.
- Tests: create `web/tests/range-flights.test.ts`, `range-rules.test.ts`, `range-game.test.ts`, `range-rack.test.ts`, `range-view.test.ts`; extend `interactions.test.ts`, `presence.test.ts`, `multiplayer.test.ts`.

---

### Task 1: Config and the flights

**Files:**
- Modify: `web/src/config.ts` (add `range` after the `wine` block, which ends `colours: { glass: … },\n  },` around line 273; add `shot` inside `audio`)
- Create: `web/src/range-flights.ts`
- Test: `web/tests/range-flights.test.ts`

**Interfaces:**
- Produces: `type Vec3 = [number, number, number]`; `type TargetKind = 'clay' | 'gold' | 'drone'`; `interface Flight { i: number; kind: TargetKind; at: number; dur: number; from: Vec3; to: Vec3; vy: number; phase: number }`; `seeded(seed: number): () => number`; `schedule(seed: number, cfg = CONFIG.range): Flight[]` (sorted by `at`, `i` its index); `flightAt(f: Flight, t: number, gravity = CONFIG.range.gravity): Vec3 | null` (null before launch and after `at + dur`).

- [ ] **Step 1: Add `CONFIG.range` and `CONFIG.audio.shot`**

After the `wine: { … },` block in `web/src/config.ts`:

```ts
  /** The shooting range on the Varanda, the office's balcony (range-*.ts): the rack and the Start button, the round,
   * the targets and how they fly. Metres and seconds; the targets fly beyond the railing, toward −z. */
  range: {
    /** The room the rifle stays in: stepping out of it puts the rifle back. */
    room: 'varanda',
    /** Where the rack and the button stand on the balcony floor (x, z), at the railing's east end, clear of the
     * balcony door; and the floor's height. */
    rack: [2.85, -8.85] as [number, number],
    button: [2.85, -8.35] as [number, number],
    floor: 0,
    /** The countdown, the round, and how long its final scores show. */
    countdown: 3,
    length: 60,
    end: 10,
    /** The bolt cycle between shots; the kick's ease back (s); where the rifle is held in view (camera space, m). */
    cycle: 0.6,
    kickTime: 0.18,
    hold: [0.17, -0.2, -0.32] as [number, number, number],
    /** The railing's line (z) and the balcony's middle across (x). Targets fly `near`..`far` beyond the railing and
     * up to `across` to either side of the middle. */
    rail: -9.09,
    middle: 1.73,
    near: 15,
    far: 35,
    across: 14,
    /** Gravity on the clays, lighter than real so they hang a little, and the height they fall away to, below the
     * railing and out of sight. */
    gravity: 8,
    drop: -4,
    /** Each kind: its points, its size, its hit zone's radius (larger than it looks, for iron sights), how long it
     * flies, and the height it starts at (a drone's, give or take 3 m). */
    kinds: {
      clay: { points: 10, size: 0.35, hit: 0.6, time: [2.5, 4] as [number, number], launch: -3 },
      gold: { points: 30, size: 0.25, hit: 0.45, time: [1.8, 2.4] as [number, number], launch: 1 },
      drone: { points: 50, size: 0.5, hit: 0.7, time: [5, 7] as [number, number], launch: 7 },
    },
    /** The round's targets: one every `gap` s or so (±20 %) from `first` s until `last` s before the end, in pairs
     * from `pairsFrom` of the way through, `gold` of them gold; and `drones` drones spread across the round. */
    schedule: { first: 0.5, last: 4.5, gap: 1.6, pairsFrom: 0.5, gold: 0.125, drones: 3 },
    /** How long another's tracer shows, a hit's shards fall, and its points float up. */
    tracer: 0.12,
    shards: 1.6,
    float: 1.2,
    colours: {
      wood: '#6b4a2e', metal: '#2c2e31', clay: '#f06a1d', gold: '#f2c335', drone: '#3a3f46', rotor: '#9aa1a8',
      button: '#c8161d', lit: '#ff4a3d', housing: '#f2c335', flash: '#ffd88a', tracer: '#fff2c4',
    },
  },
```

Inside `audio: { … }`, after `firstStep: 0.25,`:

```ts
    /** The rifle's shot, made in code (sound.ts): a burst of noise this long (s), decaying with this time constant,
     * low-passed at `cutoff` Hz; its level, and the distance (m) it is heard at full level from another shooter. */
    shot: { length: 0.45, decay: 0.07, cutoff: 2400, level: 0.9, reach: 4 },
```

- [ ] **Step 2: Write the failing test**

`web/tests/range-flights.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { flightAt, schedule, seeded } from '../src/range-flights';

const cfg = CONFIG.range;

describe('the seeded generator', () => {
  it('repeats for a seed and stays in 0..1', () => {
    const a = seeded(7);
    const b = seeded(7);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seeded(8)()).not.toBe(seeded(7)());
  });
});

describe('a round of flights', () => {
  it('is the same for the same seed and different for another', () => {
    expect(schedule(123)).toEqual(schedule(123));
    expect(schedule(124)).not.toEqual(schedule(123));
  });

  it('is in launch order, each numbered by its place', () => {
    const fs = schedule(5);
    fs.forEach((f, i) => {
      expect(f.i).toBe(i);
      if (i > 0) expect(f.at).toBeGreaterThanOrEqual(fs[i - 1].at);
    });
  });

  it('has about the mix the design asks for', () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const fs = schedule(seed);
      const count = (k: string) => fs.filter((f) => f.kind === k).length;
      expect(count('drone')).toBe(cfg.schedule.drones);
      expect(count('gold')).toBeGreaterThanOrEqual(1);
      expect(count('gold')).toBeLessThanOrEqual(14);
      expect(count('clay') + count('gold')).toBeGreaterThanOrEqual(40);
      expect(count('clay') + count('gold')).toBeLessThanOrEqual(62);
    }
  });

  it('lands every flight before the round ends', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const f of schedule(seed)) {
        expect(f.at).toBeGreaterThanOrEqual(0);
        expect(f.at + f.dur).toBeLessThanOrEqual(cfg.length);
      }
    }
  });

  it('keeps every target beyond the railing, in its band, while it flies', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const f of schedule(seed)) {
        for (let u = 0; u <= f.dur; u += 0.05) {
          const p = flightAt(f, f.at + u)!;
          const beyond = cfg.rail - p[2];
          expect(beyond).toBeGreaterThanOrEqual(cfg.near - 1e-9);
          expect(beyond).toBeLessThanOrEqual(cfg.far + 1e-9);
          expect(Math.abs(p[0] - cfg.middle)).toBeLessThanOrEqual(cfg.across + 1e-9);
          expect(p[1]).toBeLessThanOrEqual(16);
        }
      }
    }
  });

  it('is nowhere before launch or after it lands, and a clay falls away below the railing', () => {
    const clay = schedule(9).find((f) => f.kind === 'clay')!;
    expect(flightAt(clay, clay.at - 0.01)).toBeNull();
    expect(flightAt(clay, clay.at + clay.dur + 0.01)).toBeNull();
    expect(flightAt(clay, clay.at)![1]).toBeCloseTo(cfg.kinds.clay.launch);
    expect(flightAt(clay, clay.at + clay.dur)![1]).toBeCloseTo(cfg.drop);
    const top = Math.max(...Array.from({ length: 41 }, (_, k) => flightAt(clay, clay.at + (clay.dur * k) / 40)![1]));
    expect(top).toBeGreaterThan(1);
  });

  it('sends a drone across from one side to the other', () => {
    const drone = schedule(9).find((f) => f.kind === 'drone')!;
    const start = flightAt(drone, drone.at)!;
    const end = flightAt(drone, drone.at + drone.dur)!;
    expect(Math.sign(start[0] - cfg.middle)).toBe(-Math.sign(end[0] - cfg.middle));
    expect(Math.abs(start[0] - end[0])).toBeCloseTo(2 * cfg.across);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/range-flights.test.ts`
Expected: FAIL, `Failed to resolve import "../src/range-flights"`.

- [ ] **Step 4: Write `web/src/range-flights.ts`**

```ts
import { CONFIG } from './config';

/** A point or a direction (x, y, z), as plain numbers so it travels as JSON. */
export type Vec3 = [number, number, number];
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
    const z = cfg.rail - between(cfg.near + 2, cfg.far - 2); // room for its zig-zag toward and away
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
export function flightAt(f: Flight, t: number, gravity = CONFIG.range.gravity): Vec3 | null {
  const u = t - f.at;
  if (u < 0 || u > f.dur) return null;
  const s = u / f.dur;
  const x = f.from[0] + (f.to[0] - f.from[0]) * s;
  const z = f.from[2] + (f.to[2] - f.from[2]) * s;
  if (f.kind === 'drone') return [x, f.from[1] + 1.2 * Math.sin(2.6 * u + f.phase), z + 2 * Math.sin(1.1 * u + 0.7 * f.phase)];
  return [x, f.from[1] + f.vy * u - (gravity * u * u) / 2, z];
}
```

- [ ] **Step 5: Run the test and make sure it passes**

Run: `npx vitest run tests/range-flights.test.ts`
Expected: PASS (8 tests). If the mix test fails on counts, check the loop bounds against `CONFIG.range.schedule`; don't widen the test bounds beyond the design's "about 45 clays, 6 gold, 3 drones".

- [ ] **Step 6: Commit**

```bash
git add web/src/config.ts web/src/range-flights.ts web/tests/range-flights.test.ts
git commit -m "Shooting range: the targets' flights from a seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Hits, claims and scores

**Files:**
- Create: `web/src/range-rules.ts`
- Test: `web/tests/range-rules.test.ts`

**Interfaces:**
- Consumes: `Flight`, `Vec3`, `flightAt` from Task 1.
- Produces: `interface Claim { target: number; t: number; by: string }`; `interface Standing { id: string; name: string; score: number; place: number }`; `rayHit(flights: readonly Flight[], broken: ReadonlySet<number>, t: number, o: Vec3, d: Vec3, cfg = CONFIG.range): number | null` (`d` is a unit vector); `winners(claims: readonly Claim[]): Map<number, Claim>`; `standings(players: ReadonlyMap<string, string>, claims: readonly Claim[], flights: readonly Flight[], cfg = CONFIG.range): Standing[]`.

- [ ] **Step 1: Write the failing test**

`web/tests/range-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import type { Flight, Vec3 } from '../src/range-flights';
import { type Claim, rayHit, standings, winners } from '../src/range-rules';

/** A target hanging still at `p` from t 0 to 10 (a drone with no width to its path, its zig-zag at a peak). */
const still = (i: number, kind: Flight['kind'], p: Vec3): Flight => ({ i, kind, at: 0, dur: 10, from: p, to: p, vy: 0, phase: 0 });
const clayAt = (i: number, p: Vec3): Flight => ({ i, kind: 'clay', at: 0, dur: 10, from: p, to: p, vy: 0, phase: 0 });
const o: Vec3 = [0, 0, 0];
const ahead: Vec3 = [0, 0, -1];
const none = new Set<number>();

describe('the hit test', () => {
  // A clay with no vertical speed and no gravity stays where it is: pass gravity 0 through cfg
  const cfg = { ...CONFIG.range, gravity: 0 };
  it('hits a target whose hit zone the line passes through, and misses just outside it', () => {
    const r = CONFIG.range.kinds.clay.hit;
    expect(rayHit([clayAt(0, [r - 0.01, 0, -20])], none, 1, o, ahead, cfg)).toBe(0);
    expect(rayHit([clayAt(0, [r + 0.01, 0, -20])], none, 1, o, ahead, cfg)).toBeNull();
  });
  it('hits the nearer of two targets on the line', () => {
    expect(rayHit([clayAt(0, [0, 0, -30]), clayAt(1, [0, 0, -18])], none, 1, o, ahead, cfg)).toBe(1);
  });
  it('never hits behind the shooter, a broken target, or one not in the air', () => {
    expect(rayHit([clayAt(0, [0, 0, 20])], none, 1, o, ahead, cfg)).toBeNull();
    expect(rayHit([clayAt(0, [0, 0, -20])], new Set([0]), 1, o, ahead, cfg)).toBeNull();
    expect(rayHit([clayAt(0, [0, 0, -20])], none, 11, o, ahead, cfg)).toBeNull();
  });
  it("uses each kind's own hit zone", () => {
    const r = CONFIG.range.kinds.drone.hit;
    const d = still(0, 'drone', [0, 0, -20]);
    d.phase = -Math.PI / 2 - 2.6; // at t 1 the zig-zag is at its lowest: y = −1.2
    expect(rayHit([d], none, 1, [0, -1.2, 0], ahead, cfg)).toBe(0);
    expect(rayHit([d], none, 1, [r + 0.05, -1.2, 0], ahead, cfg)).toBeNull();
  });
});

describe('claims', () => {
  it('gives each target to the earliest claim, ties to the lower id, in any order', () => {
    const claims: Claim[] = [{ target: 0, t: 5.2, by: 'b' }, { target: 0, t: 5.1, by: 'c' }, { target: 1, t: 3, by: 'b' }, { target: 1, t: 3, by: 'a' }];
    const w = winners(claims);
    expect(w.get(0)?.by).toBe('c');
    expect(w.get(1)?.by).toBe('a');
    const back = winners([...claims].reverse());
    expect([...back.entries()].sort()).toEqual([...w.entries()].sort());
  });

  it("adds up each shooter's points, lists shooters on 0, and shares places on a tie", () => {
    const flights = [clayAt(0, [0, 0, -20]), still(1, 'drone', [0, 0, -20]), { ...clayAt(2, [0, 0, -20]), kind: 'gold' as const }, clayAt(3, [0, 0, -20])];
    const players = new Map([['a', 'Ana'], ['b', 'Bo'], ['c', 'Cy']]);
    const claims: Claim[] = [{ target: 0, t: 1, by: 'a' }, { target: 1, t: 2, by: 'b' }, { target: 2, t: 2, by: 'a' }, { target: 3, t: 2, by: 'a' }];
    // a: 10 + 30 + 10 = 50; b: 50; c: 0
    expect(standings(players, claims, flights)).toEqual([
      { id: 'a', name: 'Ana', score: 50, place: 1 },
      { id: 'b', name: 'Bo', score: 50, place: 1 },
      { id: 'c', name: 'Cy', score: 0, place: 3 },
    ]);
  });

  it('lists a winner the board has no name for as a guest', () => {
    const s = standings(new Map(), [{ target: 0, t: 1, by: 'z' }], [clayAt(0, [0, 0, -20])]);
    expect(s).toEqual([{ id: 'z', name: CONFIG.multiplayer.defaultName, score: 10, place: 1 }]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/range-rules.test.ts`
Expected: FAIL, `Failed to resolve import "../src/range-rules"`.

- [ ] **Step 3: Write `web/src/range-rules.ts`**

```ts
import { CONFIG } from './config';
import { type Flight, flightAt, type Vec3 } from './range-flights';

/** A hit someone claims: which target (its place in the round's schedule), when in the round (s), and by whom. */
export interface Claim { target: number; t: number; by: string }
/** A shooter on the board: their place (ties share one), name and points. */
export interface Standing { id: string; name: string; score: number; place: number }

/** The target a shot from `o` along `d` (a unit vector) hits at round time `t`: the nearest along the line whose hit
 * zone the line passes through, among those in the air and not broken; null for a miss. */
export function rayHit(flights: readonly Flight[], broken: ReadonlySet<number>, t: number, o: Vec3, d: Vec3, cfg = CONFIG.range): number | null {
  let best: number | null = null;
  let nearest = Infinity;
  for (const f of flights) {
    if (broken.has(f.i)) continue;
    const p = flightAt(f, t, cfg.gravity);
    if (!p) continue;
    const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const along = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
    if (along <= 0) continue;
    const off = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] - along * along;
    const r = cfg.kinds[f.kind].hit;
    if (off <= r * r && along < nearest) {
      best = f.i;
      nearest = along;
    }
  }
  return best;
}

/** Each claimed target's winner: the earliest claim by round time, ties to the lower id, whatever order they came in. */
export function winners(claims: readonly Claim[]): Map<number, Claim> {
  const won = new Map<number, Claim>();
  for (const c of claims) {
    const w = won.get(c.target);
    if (!w || c.t < w.t || (c.t === w.t && c.by < w.by)) won.set(c.target, c);
  }
  return won;
}

/** The board: every player (on 0 too) and every winner, highest first, then by name; ties share a place. A winner
 * with no name here (they left before this browser heard it) is a guest. */
export function standings(players: ReadonlyMap<string, string>, claims: readonly Claim[], flights: readonly Flight[], cfg = CONFIG.range): Standing[] {
  const score = new Map<string, number>([...players.keys()].map((id) => [id, 0]));
  for (const c of winners(claims).values()) {
    const f = flights[c.target];
    if (f) score.set(c.by, (score.get(c.by) ?? 0) + cfg.kinds[f.kind].points);
  }
  const rows = [...score].map(([id, s]) => ({ id, name: players.get(id) ?? CONFIG.multiplayer.defaultName, score: s }));
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  return rows.map((r) => ({ ...r, place: 1 + rows.filter((x) => x.score > r.score).length }));
}
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `npx vitest run tests/range-rules.test.ts`
Expected: PASS (7 tests). The drone test relies on `flightAt`'s zig-zag, `y = from[1] + 1.2 sin(2.6u + phase)`: with `phase = −π/2 − 2.6` and `u = 1`, the sine is −1. If you change the zig-zag in Task 1, change this test with it.

- [ ] **Step 5: Commit**

```bash
git add web/src/range-rules.ts web/tests/range-rules.test.ts
git commit -m "Shooting range: hits along the crosshair, the earliest claim wins, and the board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The round as each browser sees it, and its messages

**Files:**
- Create: `web/src/range-game.ts`
- Test: `web/tests/range-game.test.ts`

**Interfaces:**
- Consumes: `schedule`, `flightAt`, `Flight`, `Vec3` (Task 1); `rayHit`, `standings`, `Claim`, `Standing` (Task 2); `byArrival`, `Arrival` from `web/src/presence.ts`.
- Produces:
  - `type RangeMessage = { k: 'arm'; on: boolean; name: string } | { k: 'start'; r: string; seed: number; left: number; players: Shooter[]; claims: Claim[] } | { k: 'shot'; r: string; t: number; o: Vec3; d: Vec3; hit: number }` (`hit` −1 for a miss; `r` '' outside a round).
  - `interface Shooter { id: string; name: string }`; `type RangeOut = { msg: RangeMessage; to?: string }`.
  - `type RangeEvent = { kind: 'shot'; by: string; o: Vec3; d: Vec3 } | { kind: 'break'; target: number; by: string; points: number; at: Vec3 }`.
  - `type Phase = 'countdown' | 'running' | 'end'`.
  - `isRangeMessage(v: unknown): v is RangeMessage`.
  - `class RangeGame` with `constructor(selfId: () => string, newId: () => string, rand?: () => number, cfg?)`, `round: { id: string; seed: number; endsAt: number; flights: Flight[]; players: Map<string, string> } | null`, `claims: Claim[]`, getters `armed: boolean` and `busy: boolean`, and methods `setArmed(on, name, now): RangeOut[]`, `start(now): RangeOut[]`, `shoot(o, d, now): RangeOut[]`, `receive(msg, from, now): RangeOut[]`, `greet(id, visitors: Arrival[], now): RangeOut[]`, `update(now): void`, `roundTime(now): number` (s), `phase(now): Phase | null`, `timeLeft(now): number` (s), `broken(): Set<number>`, `standings(): Standing[]`, `takeEvents(): RangeEvent[]`. `now` is always in ms (`performance.now()`).
  - `interface RangeHud { head: string; final: boolean; rows: (Standing & { you: boolean })[] }`; `rangeHud(game: RangeGame, now: number, me: string): RangeHud | null`.

- [ ] **Step 1: Write the failing test**

`web/tests/range-game.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { flightAt, type Vec3 } from '../src/range-flights';
import { isRangeMessage, RangeGame, rangeHud, type RangeMessage, type RangeOut } from '../src/range-game';

const cfg = CONFIG.range;
const EYE: Vec3 = [1.7, 1.6, -8.6];

/**
 * A few browsers on the balcony: each message goes through JSON and `isRangeMessage` as the network would, then to
 * its addressee or everyone else here. `hold` keeps messages back so a test can deliver them in its own order.
 */
function party(...ids: string[]) {
  let now = 1000;
  const browsers = ids.map((id, i) => ({ id, arrived: i + 1, game: new RangeGame(() => id, () => `${id}-round`, () => 0.5) }));
  const here = new Set(ids);
  const by = (id: string) => browsers.find((b) => b.id === id)!.game;
  const deliver = (from: string, outs: RangeOut[]) => {
    for (const o of outs) {
      const msg = JSON.parse(JSON.stringify(o.msg)) as unknown;
      expect(isRangeMessage(msg), JSON.stringify(msg)).toBe(true);
      for (const b of browsers) {
        if (b.id === from || !here.has(b.id) || (o.to && o.to !== b.id)) continue;
        deliver(b.id, b.game.receive(msg as RangeMessage, from, now));
      }
    }
  };
  return {
    browsers, by, deliver, here,
    get now() { return now; },
    advance(ms: number) {
      now += ms;
      for (const b of browsers) b.game.update(now);
    },
    visitors: () => browsers.filter((b) => here.has(b.id)).map((b) => ({ id: b.id, arrived: b.arrived, since: b.arrived })),
  };
}

/** From the eye straight at target `i` where it is at `now` in `game`'s round. */
function aimAt(game: RangeGame, i: number, now: number): { o: Vec3; d: Vec3 } {
  const p = flightAt(game.round!.flights[i], game.roundTime(now))!;
  const v = [p[0] - EYE[0], p[1] - EYE[1], p[2] - EYE[2]];
  const n = Math.hypot(v[0], v[1], v[2]);
  return { o: EYE, d: [v[0] / n, v[1] / n, v[2] / n] };
}

/** Into the round to just after its first target launched, when only it is in the air. */
function toFirstTarget(p: ReturnType<typeof party>, id: string) {
  const f = p.by(id).round!.flights[0];
  p.advance(cfg.countdown * 1000 + (f.at + 0.3) * 1000);
}

describe('starting a round', () => {
  it('starts only with a rifle in hand, and not while one runs', () => {
    const p = party('ana', 'bo');
    expect(p.by('ana').start(p.now)).toEqual([]);
    p.deliver('ana', p.by('ana').setArmed(true, 'Ana', p.now));
    const out = p.by('ana').start(p.now);
    expect(out).toHaveLength(1);
    p.deliver('ana', out);
    expect(p.by('bo').round?.id).toBe('ana-round');
    expect(p.by('bo').phase(p.now)).toBe('countdown');
    p.deliver('bo', p.by('bo').setArmed(true, 'Bo', p.now));
    expect(p.by('bo').start(p.now)).toEqual([]);
  });

  it('settles crossing starts on the lower round id everywhere', () => {
    const p = party('ana', 'bo');
    p.deliver('ana', p.by('ana').setArmed(true, 'Ana', p.now));
    p.deliver('bo', p.by('bo').setArmed(true, 'Bo', p.now));
    const a = p.by('ana').start(p.now);
    const b = p.by('bo').start(p.now);
    p.deliver('bo', b);
    p.deliver('ana', a);
    expect(p.by('ana').round?.id).toBe('ana-round');
    expect(p.by('bo').round?.id).toBe('ana-round');
    expect(p.by('bo').round?.seed).toBe(p.by('ana').round?.seed);
  });

  it('counts down, runs, shows the final scores, then ends', () => {
    const p = party('ana');
    const g = p.by('ana');
    g.setArmed(true, 'Ana', p.now);
    g.start(p.now);
    expect(rangeHud(g, p.now, 'ana')?.head).toBe('3');
    p.advance(cfg.countdown * 1000);
    expect(g.phase(p.now)).toBe('running');
    expect(rangeHud(g, p.now, 'ana')?.head).toBe('1:00');
    p.advance(15_500);
    expect(rangeHud(g, p.now, 'ana')?.head).toBe('0:45');
    p.advance((cfg.length - 15) * 1000);
    expect(g.phase(p.now)).toBe('end');
    expect(rangeHud(g, p.now, 'ana')).toMatchObject({ head: 'Final scores', final: true, rows: [{ id: 'ana', name: 'Ana', score: 0, place: 1, you: true }] });
    p.advance(cfg.end * 1000 + 1);
    expect(g.round).toBeNull();
    expect(rangeHud(g, p.now, 'ana')).toBeNull();
  });
});

describe('shooting', () => {
  it('scores a hit for the shooter in every browser, and sends a miss too, for its tracer', () => {
    const p = party('ana', 'bo');
    p.deliver('ana', p.by('ana').setArmed(true, 'Ana', p.now));
    p.deliver('bo', p.by('bo').setArmed(true, 'Bo', p.now));
    p.deliver('ana', p.by('ana').start(p.now));
    toFirstTarget(p, 'ana');
    const { o, d } = aimAt(p.by('ana'), 0, p.now);
    const shot = p.by('ana').shoot(o, d, p.now);
    expect(shot[0].msg).toMatchObject({ k: 'shot', r: 'ana-round', hit: 0 });
    p.deliver('ana', shot);
    const points = cfg.kinds[p.by('ana').round!.flights[0].kind].points;
    for (const id of ['ana', 'bo']) expect(p.by(id).standings()[0]).toMatchObject({ id: 'ana', score: points });
    expect(p.by('ana').takeEvents()).toMatchObject([{ kind: 'break', target: 0, by: 'ana', points }]);
    expect(p.by('bo').takeEvents()).toMatchObject([{ kind: 'shot', by: 'ana' }, { kind: 'break', target: 0, by: 'ana', points }]);
    const miss = p.by('bo').shoot(o, [0, 1, 0], p.now);
    expect(miss[0].msg).toMatchObject({ k: 'shot', hit: -1 });
    p.deliver('bo', miss);
    expect(p.by('ana').takeEvents()).toMatchObject([{ kind: 'shot', by: 'bo' }]);
  });

  it('gives a clay two hit to the earlier shot everywhere, whichever arrives first', () => {
    const p = party('ana', 'bo');
    p.deliver('ana', p.by('ana').setArmed(true, 'Ana', p.now));
    p.deliver('bo', p.by('bo').setArmed(true, 'Bo', p.now));
    p.deliver('ana', p.by('ana').start(p.now));
    toFirstTarget(p, 'ana');
    const a = p.by('ana').shoot(aimAt(p.by('ana'), 0, p.now).o, aimAt(p.by('ana'), 0, p.now).d, p.now);
    p.advance(10);
    const b = p.by('bo').shoot(aimAt(p.by('bo'), 0, p.now).o, aimAt(p.by('bo'), 0, p.now).d, p.now);
    expect(b[0].msg).toMatchObject({ hit: 0 }); // Bo hadn't heard of Ana's hit yet
    p.deliver('bo', b);
    p.deliver('ana', a);
    for (const id of ['ana', 'bo']) {
      const s = p.by(id).standings();
      expect(s.find((x) => x.id === 'ana')!.score).toBeGreaterThan(0);
      expect(s.find((x) => x.id === 'bo')!.score).toBe(0);
    }
  });

  it('counts nothing for a shot claiming a target not in the air, but shows its tracer', () => {
    const p = party('ana', 'bo');
    p.deliver('ana', p.by('ana').setArmed(true, 'Ana', p.now));
    p.deliver('ana', p.by('ana').start(p.now));
    toFirstTarget(p, 'ana');
    const late = p.by('ana').round!.flights.at(-1)!;
    p.by('bo').receive({ k: 'shot', r: 'ana-round', t: 1, o: EYE, d: [0, 0, -1], hit: late.i }, 'cy', p.now);
    expect(p.by('bo').claims).toEqual([]);
    expect(p.by('bo').takeEvents()).toMatchObject([{ kind: 'shot', by: 'cy' }]);
  });

  it('hits nothing during the countdown or outside a round', () => {
    const p = party('ana');
    const g = p.by('ana');
    g.setArmed(true, 'Ana', p.now);
    expect(g.shoot(EYE, [0, 0, -1], p.now)[0].msg).toMatchObject({ r: '', hit: -1 });
    g.start(p.now);
    expect(g.shoot(EYE, [0, 0, -1], p.now)[0].msg).toMatchObject({ r: '', hit: -1 });
  });
});

describe('who plays', () => {
  it('joins a rifle picked up mid-round on 0, and keeps the points of one put back', () => {
    const p = party('ana', 'bo');
    p.deliver('ana', p.by('ana').setArmed(true, 'Ana', p.now));
    p.deliver('ana', p.by('ana').start(p.now));
    toFirstTarget(p, 'ana');
    const { o, d } = aimAt(p.by('ana'), 0, p.now);
    p.deliver('ana', p.by('ana').shoot(o, d, p.now));
    p.deliver('bo', p.by('bo').setArmed(true, 'Bo', p.now));
    p.deliver('ana', p.by('ana').setArmed(false, 'Ana', p.now));
    for (const id of ['ana', 'bo']) {
      expect(p.by(id).standings().map((s) => [s.id, s.score > 0])).toEqual([['ana', true], ['bo', false]]);
    }
  });

  it('catches a newcomer up from the earliest-arrived visitor, with the same scores', () => {
    const p = party('ana', 'bo', 'cy');
    p.here.delete('cy');
    p.deliver('ana', p.by('ana').setArmed(true, 'Ana', p.now));
    p.deliver('ana', p.by('ana').start(p.now));
    toFirstTarget(p, 'ana');
    const { o, d } = aimAt(p.by('ana'), 0, p.now);
    p.deliver('ana', p.by('ana').shoot(o, d, p.now));
    p.here.add('cy');
    const fromBo = p.by('bo').greet('cy', p.visitors(), p.now);
    expect(fromBo).toEqual([]); // Bo isn't the earliest here, and holds no rifle
    const fromAna = p.by('ana').greet('cy', p.visitors(), p.now);
    expect(fromAna.map((o) => o.msg.k)).toEqual(['arm', 'start']);
    expect(fromAna.every((o) => o.to === 'cy')).toBe(true);
    p.deliver('ana', fromAna);
    expect(p.by('cy').standings()).toEqual(p.by('ana').standings());
    expect(p.by('cy').timeLeft(p.now)).toBeCloseTo(p.by('ana').timeLeft(p.now), 2);
    expect(p.by('cy').takeEvents()).toEqual([]); // old hits don't shatter again
  });
});

describe('range messages', () => {
  it('drops malformed ones', () => {
    const good: RangeMessage[] = [
      { k: 'arm', on: true, name: 'Ana' },
      { k: 'start', r: 'x1', seed: 42, left: 63000, players: [{ id: 'a', name: 'Ana' }], claims: [{ target: 3, t: 4.2, by: 'a' }] },
      { k: 'shot', r: '', t: 0, o: [1, 1.6, -8], d: [0, 0, -1], hit: -1 },
    ];
    for (const m of good) expect(isRangeMessage(m)).toBe(true);
    const bad: unknown[] = [
      null, { k: 'dance' }, { k: 'arm', on: 'yes', name: 'Ana' }, { k: 'arm', on: true, name: 'x'.repeat(99) },
      { k: 'start', r: 'x1', seed: -1, left: 1000, players: [], claims: [] },
      { k: 'start', r: 'x1', seed: 1, left: 1e9, players: [], claims: [] },
      { k: 'start', r: 'x1', seed: 1, left: 1000, players: [], claims: [{ target: 1.5, t: 1, by: 'a' }] },
      { k: 'shot', r: 'x1', t: 1, o: [1, 2], d: [0, 0, -1], hit: 0 },
      { k: 'shot', r: 'x1', t: 1, o: [1, 2, 3], d: [0, 0, -5], hit: 0 },
      { k: 'shot', r: 'x1', t: 1, o: [1, 2, 3], d: [0, 0, -1], hit: -2 },
      { k: 'shot', r: 'x1', t: Number.NaN, o: [1, 2, 3], d: [0, 0, -1], hit: 0 },
    ];
    for (const m of bad) expect(isRangeMessage(m), JSON.stringify(m)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/range-game.test.ts`
Expected: FAIL, `Failed to resolve import "../src/range-game"`.

- [ ] **Step 3: Write `web/src/range-game.ts`**

```ts
import { CONFIG } from './config';
import { type Arrival, byArrival } from './presence';
import { type Flight, flightAt, schedule, type Vec3 } from './range-flights';
import { type Claim, rayHit, type Standing, standings } from './range-rules';

/** A shooter on a round's board: their id and the name they had. */
export interface Shooter { id: string; name: string }

/**
 * What a `range` message carries: a visitor picking up a rifle or putting it back; a round starting (or, to a
 * newcomer, the round so far, with its shooters and claims); a shot, with the target it hit (−1 for a miss) and `r`
 * '' outside a round. `left` is ms until the round's end, `t` s into the round. Types, so they can be sent as JSON.
 */
export type RangeMessage =
  | { k: 'arm'; on: boolean; name: string }
  | { k: 'start'; r: string; seed: number; left: number; players: Shooter[]; claims: Claim[] }
  | { k: 'shot'; r: string; t: number; o: Vec3; d: Vec3; hit: number };

/** A message to send: to everyone, or to one visitor. */
export type RangeOut = { msg: RangeMessage; to?: string };

/** What the view shows and the sound plays: another's shot (its tracer), and a target breaking, with whose points. */
export type RangeEvent =
  | { kind: 'shot'; by: string; o: Vec3; d: Vec3 }
  | { kind: 'break'; target: number; by: string; points: number; at: Vec3 };

export type Phase = 'countdown' | 'running' | 'end';

interface Round { id: string; seed: number; endsAt: number; flights: Flight[]; players: Map<string, string> }

const MAX_PLAYERS = 16;
const MAX_TARGETS = 200;
const cfg = CONFIG.range;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isName = (v: unknown): v is string => typeof v === 'string' && v.length <= CONFIG.multiplayer.maxNameLength;
const isIndex = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -cfg.countdown && v <= cfg.length + cfg.end;
const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1000);
const isClaim = (v: unknown) => isObject(v) && isIndex(v.target, 0, MAX_TARGETS - 1) && isTime(v.t) && isText(v.by);
const isShooter = (v: unknown) => isObject(v) && isText(v.id) && isName(v.name);

/** A well-formed `range` message, every list bounded; anything else is dropped. */
export function isRangeMessage(v: unknown): v is RangeMessage {
  if (!isObject(v)) return false;
  switch (v.k) {
    case 'arm': return typeof v.on === 'boolean' && isName(v.name);
    case 'start':
      return isText(v.r) && isIndex(v.seed, 0, 2 ** 32 - 1)
        && typeof v.left === 'number' && Number.isFinite(v.left) && v.left >= 0 && v.left <= 1000 * (cfg.countdown + cfg.length)
        && Array.isArray(v.players) && v.players.length <= MAX_PLAYERS && v.players.every(isShooter)
        && Array.isArray(v.claims) && v.claims.length <= MAX_TARGETS && v.claims.every(isClaim);
    case 'shot': {
      if (typeof v.r !== 'string' || v.r.length > 64 || !isTime(v.t) || !isVec(v.o) || !isVec(v.d) || !isIndex(v.hit, -1, MAX_TARGETS - 1)) return false;
      const n = Math.hypot(...(v.d as Vec3));
      return n > 0.9 && n < 1.1;
    }
    default: return false;
  }
}

/**
 * The shooting range as this browser sees it: whether this visitor holds a rifle, who else does, and the round, if
 * one counts down, runs or shows its scores. Every browser makes the same flights from the round's seed; each
 * shooter judges their own shots and sends what they hit, and every browser gives each target to the earliest claim
 * (`winners`), so all agree on the scores. Two starts that cross settle on the lower round id. `now` is in ms; round
 * times are in s from the round's start, negative while it counts down.
 */
export class RangeGame {
  round: Round | null = null;
  claims: Claim[] = [];
  private mine = false;
  private myName = '';
  /** The others holding a rifle, and their names. */
  private others = new Map<string, string>();
  /** Rounds over or given up here, so a late copy never comes back. */
  private finished = new Set<string>();
  private events: RangeEvent[] = [];

  constructor(private selfId: () => string, private newId: () => string, private rand: () => number = Math.random, private config = CONFIG.range) {}

  /** This visitor holds a rifle. */
  get armed(): boolean {
    return this.mine;
  }

  /** A round is on: counting down, running, or showing its final scores. */
  get busy(): boolean {
    return this.round !== null;
  }

  /** Picks up a rifle (joining a round that runs, on 0) or puts it back (keeping the points). */
  setArmed(on: boolean, name: string, now: number): RangeOut[] {
    if (on === this.mine) return [];
    this.mine = on;
    this.myName = name;
    if (on) this.join(this.selfId(), name, now);
    return [{ msg: { k: 'arm', on, name } }];
  }

  /** The red button: a new round for everyone holding a rifle, if this visitor holds one and none is on. */
  start(now: number): RangeOut[] {
    if (!this.mine || this.round) return [];
    const players = new Map([[this.selfId(), this.myName], ...this.others]);
    this.begin(this.newId(), Math.floor(this.rand() * 2 ** 32), now + 1000 * (this.config.countdown + this.config.length), players, []);
    return [{ msg: this.startMessage(now) }];
  }

  /** A shot from `o` along `d` (a unit vector): what it hits is this browser's call, at once; the others hear it, hit
   * or miss. Outside a running round it hits nothing. */
  shoot(o: Vec3, d: Vec3, now: number): RangeOut[] {
    const r = this.round;
    const t = this.roundTime(now);
    const live = r !== null && this.phase(now) === 'running';
    const hit = live ? rayHit(r.flights, this.broken(), t, o, d, this.config) : null;
    if (live && hit !== null) {
      this.join(this.selfId(), this.myName, now);
      this.addClaim({ target: hit, t, by: this.selfId() }, true);
    }
    return [{ msg: { k: 'shot', r: live ? r.id : '', t: live ? t : 0, o, d, hit: hit ?? -1 } }];
  }

  /** A message from another visitor. */
  receive(msg: RangeMessage, from: string, now: number): RangeOut[] {
    switch (msg.k) {
      case 'arm':
        if (msg.on) {
          this.others.set(from, msg.name);
          this.join(from, msg.name, now);
        } else this.others.delete(from);
        return [];
      case 'start':
        this.take(msg, now);
        return [];
      case 'shot': {
        this.events.push({ kind: 'shot', by: from, o: msg.o, d: msg.d });
        const r = this.round;
        const f = r && msg.r === r.id && msg.hit >= 0 ? r.flights[msg.hit] : undefined;
        if (r && f && flightAt(f, msg.t, this.config.gravity)) { // a claim on a target that was in the air then
          if (!r.players.has(from)) r.players.set(from, this.others.get(from) ?? CONFIG.multiplayer.defaultName);
          this.addClaim({ target: f.i, t: msg.t, by: from }, true);
        }
        return [];
      }
    }
  }

  /** A visitor new here: this visitor's rifle, and from the earliest-arrived visitor (the others needn't), the round
   * so far. */
  greet(id: string, visitors: Arrival[], now: number): RangeOut[] {
    const out: RangeOut[] = [];
    if (this.mine) out.push({ msg: { k: 'arm', on: true, name: this.myName }, to: id });
    const first = visitors.filter((v) => v.id !== id).sort(byArrival)[0];
    if (this.round && this.phase(now) !== 'end' && first?.id === this.selfId()) out.push({ msg: this.startMessage(now), to: id });
    return out;
  }

  /** Every frame: a round whose final scores have shown is over. */
  update(now: number): void {
    if (!this.round || this.roundTime(now) <= this.config.length + this.config.end) return;
    this.finished.add(this.round.id);
    this.round = null;
    this.claims = [];
  }

  /** Seconds into the round (negative while it counts down); 0 with none. */
  roundTime(now: number): number {
    return this.round ? this.config.length - (this.round.endsAt - now) / 1000 : 0;
  }

  phase(now: number): Phase | null {
    if (!this.round) return null;
    const t = this.roundTime(now);
    return t < 0 ? 'countdown' : t <= this.config.length ? 'running' : 'end';
  }

  /** Seconds until the round stops running. */
  timeLeft(now: number): number {
    return this.round ? Math.max(0, (this.round.endsAt - now) / 1000) : 0;
  }

  /** The targets someone has hit, shattered for everyone whoever wins them. */
  broken(): Set<number> {
    return new Set(this.claims.map((c) => c.target));
  }

  standings(): Standing[] {
    return this.round ? standings(this.round.players, this.claims, this.round.flights, this.config) : [];
  }

  /** What happened since the last call, for the view and the sound. */
  takeEvents(): RangeEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** A start from another visitor: taken when no round is on (or the one here is showing its scores), merged into
   * the same round, and of two that crossed, the lower id kept. */
  private take(msg: Extract<RangeMessage, { k: 'start' }>, now: number): void {
    if (this.finished.has(msg.r)) return;
    const r = this.round;
    const players = new Map(msg.players.map((p) => [p.id, p.name]));
    if (r && r.id === msg.r) {
      for (const [id, name] of players) if (!r.players.has(id)) r.players.set(id, name);
      for (const c of msg.claims) this.addClaim(c, false);
      return;
    }
    if (r && this.phase(now) !== 'end' && r.id < msg.r) return;
    if (r) this.finished.add(r.id);
    if (this.mine) players.set(this.selfId(), this.myName);
    this.begin(msg.r, msg.seed, now + msg.left, players, msg.claims);
  }

  private begin(id: string, seed: number, endsAt: number, players: Map<string, string>, claims: readonly Claim[]): void {
    this.round = { id, seed, endsAt, flights: schedule(seed, this.config), players };
    this.claims = [];
    for (const c of claims) this.addClaim(c, false); // a newcomer's catch-up: those already broke, out of sight
  }

  private startMessage(now: number): RangeMessage {
    const r = this.round!;
    return {
      k: 'start', r: r.id, seed: r.seed, left: Math.round(Math.max(0, r.endsAt - now)),
      players: [...r.players].map(([id, name]) => ({ id, name })), claims: this.claims,
    };
  }

  /** Adds a shooter to a round that hasn't ended. */
  private join(id: string, name: string, now: number): void {
    if (this.round && this.phase(now) !== 'end') this.round.players.set(id, name);
  }

  /** Keeps a claim (one per shooter and target); the first on a target breaks it, `show` for everyone to see. */
  private addClaim(c: Claim, show: boolean): void {
    const r = this.round;
    if (!r || !r.flights[c.target] || this.claims.some((x) => x.target === c.target && x.by === c.by)) return;
    const first = !this.claims.some((x) => x.target === c.target);
    this.claims.push(c);
    const f = r.flights[c.target];
    const at = flightAt(f, c.t, this.config.gravity);
    if (show && first && at) this.events.push({ kind: 'break', target: f.i, by: c.by, points: this.config.kinds[f.kind].points, at });
  }
}

/** The top strip: the countdown, the time left or "Final scores", and the board. */
export interface RangeHud { head: string; final: boolean; rows: (Standing & { you: boolean })[] }

export function rangeHud(game: RangeGame, now: number, me: string): RangeHud | null {
  const phase = game.phase(now);
  if (!phase) return null;
  const rows = game.standings().map((s) => ({ ...s, you: s.id === me }));
  if (phase === 'countdown') return { head: String(Math.ceil(-game.roundTime(now))), final: false, rows };
  if (phase === 'end') return { head: 'Final scores', final: true, rows };
  const left = Math.ceil(game.timeLeft(now));
  return { head: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, final: false, rows };
}
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `npx vitest run tests/range-game.test.ts`
Expected: PASS (12 tests). Then `npx tsc --noEmit`. If `receive`'s switch trips "not all code paths return a value", add `default: return [];`.

- [ ] **Step 5: Commit**

```bash
git add web/src/range-game.ts web/tests/range-game.test.ts
git commit -m "Shooting range: one round across browsers, its shots and its board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `range` message kind, the rack's targets and their prompts

**Files:**
- Modify: `web/src/multiplayer.ts` (`MessageKind`, `KINDS`, `MultiplayerHooks`, a handler, `sendRange`)
- Modify: `web/src/interactions.ts` (the `Target` union, `RangeStatus`, `promptFor`, `activate`)
- Modify: `web/src/presence.ts:141` and `:170-172` (`SharedTarget`, `isShared`, `stateDelta`)
- Test: `web/tests/multiplayer.test.ts`, `web/tests/interactions.test.ts`, `web/tests/presence.test.ts`

**Interfaces:**
- Consumes: `RangeMessage`, `isRangeMessage` (Task 3).
- Produces: `MultiplayerHooks.onRange?: (msg: RangeMessage, from: string) => void`; `Multiplayer.sendRange(msg: RangeMessage, to?: string): void`; `interface RangeStatus { readonly armed: boolean; readonly busy: boolean }` exported from `interactions.ts`; target kinds `{ kind: 'rack'; range: RangeStatus; node: Object3D }` and `{ kind: 'range-button'; range: RangeStatus; node: Object3D }`; `isShared(t: Target): t is SharedTarget` from `presence.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `web/tests/interactions.test.ts`, inside `describe('interactions', …)` after the wine test:

```ts
  it('prompts the rifle rack and the Start button, which change nothing shared', () => {
    const lights = new LightGroups([]);
    const range = { armed: false, busy: false };
    const rack: Target = { kind: 'rack', range, node: new Object3D() };
    const button: Target = { kind: 'range-button', range, node: new Object3D() };
    expect(promptFor(rack, lights)).toBe('Click: pick up the rifle');
    expect(promptFor(button, lights, 'Tap')).toBe('Pick up a rifle to play');
    range.armed = true;
    expect(promptFor(rack, lights, 'Tap')).toBe('Tap: put the rifle back');
    expect(promptFor(button, lights)).toBe('Click: start a round');
    range.busy = true;
    expect(promptFor(button, lights)).toBe('A round is on');
    activate(rack, lights);
    activate(button, lights);
    expect(range).toEqual({ armed: true, busy: true });
  });
```

Add to `web/tests/presence.test.ts` (import `isShared` and `stateDelta` from `../src/presence` and `Object3D` from `three` if not already imported):

```ts
describe('personal targets', () => {
  it('shares nothing for a seat, the wine, the rifle rack or the Start button', () => {
    const lights = new LightGroups([]);
    const range = { armed: false, busy: false };
    for (const t of [{ kind: 'wine', node: new Object3D() }, { kind: 'rack', range, node: new Object3D() }, { kind: 'range-button', range, node: new Object3D() }] as const) {
      expect(isShared(t)).toBe(false);
      expect(stateDelta(t, lights)).toEqual({});
    }
  });
});
```

Add to `web/tests/multiplayer.test.ts`: in `setup()`, add `const ranges: [RangeMessage, string][] = [];`, the hook `onRange: (m, from) => void ranges.push([m, from]),` and `ranges` to the returned object; import `type RangeMessage` from `../src/range-game`. Then after the draw test:

```ts
  it('passes on well-formed range messages with their sender, and sends its own to everyone or to one', () => {
    const { fake, mp, ranges } = setup();
    fake.receive('range', { k: 'arm', on: true, name: 'Bo' }, 'p1');
    fake.receive('range', { k: 'arm', on: 'yes', name: 'Bo' }, 'p1');
    fake.receive('range', { k: 'shot', r: '', t: 0, o: [0, 0, 0], d: [0, 0, -3], hit: -1 }, 'p2');
    expect(ranges).toEqual([[{ k: 'arm', on: true, name: 'Bo' }, 'p1']]);
    mp.sendRange({ k: 'arm', on: true, name: 'Ana' });
    expect(fake.sent.at(-1)).toEqual({ kind: 'range', data: { k: 'arm', on: true, name: 'Ana' } });
    mp.sendRange({ k: 'arm', on: false, name: 'Ana' }, 'p1');
    expect(fake.sent.at(-1)).toEqual({ kind: 'range', data: { k: 'arm', on: false, name: 'Ana' }, to: 'p1' });
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/interactions.test.ts tests/presence.test.ts tests/multiplayer.test.ts`
Expected: FAIL. The rack prompts fall through to the light-switch text, `isShared` isn't exported, and `fake.receive('range', …)` throws because no `range` handler is registered.

- [ ] **Step 3: Implement**

`web/src/interactions.ts`: extend the union and add the status type.

```ts
  /** The bottle of red in the kitchen (wine.ts): a sip is the visitor's own, never shared. */
  | { kind: 'wine'; node: Object3D }
  /** The shooting range's rifle rack and Start button on the Varanda (range-rack.ts): this visitor's own to use. */
  | { kind: 'rack'; range: RangeStatus; node: Object3D }
  | { kind: 'range-button'; range: RangeStatus; node: Object3D };

/** What the rack's and the button's prompts need: whether this visitor holds a rifle, and whether a round is on
 * (range-game.ts). */
export interface RangeStatus { readonly armed: boolean; readonly busy: boolean }
```

In `promptFor`, after `case 'wine': …`:

```ts
    case 'rack': return `${verb}: ${t.range.armed ? 'put the rifle back' : 'pick up the rifle'}`;
    case 'range-button': return t.range.busy ? 'A round is on' : t.range.armed ? `${verb}: start a round` : 'Pick up a rifle to play';
```

In `activate`, after `case 'wine': return;`:

```ts
    case 'rack':
    case 'range-button': return; // the rifle and the round are the player's (main.ts)
```

Update the comment above `activate` to read: `/** \`now\`: seconds, for the screens' pictures. Sitting down, drinking, the rifle and the TV's panel are the player's (main.ts). */`

`web/src/presence.ts`, replacing line 141 and `stateDelta`:

```ts
/** Targets that are each visitor's own: nothing about them is shared. */
const PERSONAL: readonly Target['kind'][] = ['seat', 'wine', 'rack', 'range-button'];
export type SharedTarget = Exclude<Target, { kind: 'seat' | 'wine' | 'rack' | 'range-button' }>;
export const isShared = (t: Target): t is SharedTarget => !PERSONAL.includes(t.kind);
```

```ts
export function stateDelta(t: Target, lights: LightGroups): StateMap {
  return isShared(t) ? { [stateKey(t)]: stateValue(t, lights) } : {};
}
```

`web/src/multiplayer.ts`:
- Import: `import { isRangeMessage, type RangeMessage } from './range-game';`
- `export type MessageKind = 'hello' | 'pose' | 'state' | 'game' | 'draw' | 'range';` and `const KINDS: MessageKind[] = ['hello', 'pose', 'state', 'game', 'draw', 'range'];`
- In `MultiplayerHooks`, after `onArrive`:

```ts
  /** The shooting range: a message from another visitor (well-formed; what to do with it is the range's call). */
  onRange?: (msg: RangeMessage, from: string) => void;
```

- In the constructor after the `draw` handler:

```ts
    room.onMessage('range', (data, id) => {
      if (!isRangeMessage(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      hooks.onRange?.(data, id);
    });
```

- After `sendDraw`:

```ts
  /** The shooting range: to everyone, or (a newcomer's catch-up) to one visitor. */
  sendRange(msg: RangeMessage, to?: string): void {
    this.room.send('range', msg, to);
  }
```

`web/src/main.ts:282`: change the `byKey` line to use `isShared` (import it from `./presence`):

```ts
  const byKey = new Map([...world.targets.values()].flatMap((t) => (isShared(t) ? [[stateKey(t), t] as const] : [])));
```

- [ ] **Step 4: Run the tests and types**

Run: `npx vitest run tests/interactions.test.ts tests/presence.test.ts tests/multiplayer.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/interactions.ts web/src/presence.ts web/src/multiplayer.ts web/src/main.ts web/tests/interactions.test.ts web/tests/presence.test.ts web/tests/multiplayer.test.ts
git commit -m "Shooting range: the range message, and the rack's and button's prompts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The rack, the button and the rifle in hand

**Files:**
- Create: `web/src/range-rack.ts`
- Test: `web/tests/range-rack.test.ts`

**Interfaces:**
- Consumes: `CONFIG.range` (Task 1); `RangeStatus`, `Target` (Task 4); `TableMaterials` (`web/src/table-pieces.ts`), `makeMatcaps` (`web/src/creatures.ts`), `CanvasFactory`, `domCanvas` (`web/src/screens.ts`).
- Produces: `makeRifle(m: TableMaterials): Group` (barrel along local −z, muzzle at z −0.75, butt at z 0.25); `class RifleRack { root: Group; rack: Group; button: Group; rackTarget: Target; buttonTarget: Target; constructor(range: RangeStatus, canvas?); update(light: number, highlight: 'rack' | 'range-button' | null, lit: boolean): void }`; `class HeldRifle { scene: Scene; constructor(canvas?); shown: boolean (setter/getter); fire(): void; update(dt: number, camera: Camera, light: number): void }`; `HeldRifle.flashing: boolean` getter for tests.

- [ ] **Step 1: Write the failing test**

`web/tests/range-rack.test.ts`:

```ts
import { Color, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { HeldRifle, RifleRack } from '../src/range-rack';

describe('the rack and the button', () => {
  it('stand where the config says, and are the targets for the crosshair', () => {
    const range = { armed: false, busy: false };
    const r = new RifleRack(range, null);
    expect(r.rack.position.toArray()).toEqual([CONFIG.range.rack[0], CONFIG.range.floor, CONFIG.range.rack[1]]);
    expect(r.button.position.toArray()).toEqual([CONFIG.range.button[0], CONFIG.range.floor, CONFIG.range.button[1]]);
    expect(r.rackTarget).toMatchObject({ kind: 'rack', node: r.rack });
    expect(r.buttonTarget).toMatchObject({ kind: 'range-button', node: r.button });
    if (r.rackTarget.kind === 'rack') expect(r.rackTarget.range).toBe(range);
  });
  it('lights the button while a round is on', () => {
    const r = new RifleRack({ armed: false, busy: false }, null);
    r.update(0.5, null, false);
    const idle = r.capColour;
    r.update(0.5, null, true);
    expect(r.capColour).not.toBe(idle);
    expect(r.capColour).toBe(new Color(CONFIG.range.colours.lit).getHexString());
  });
});

describe('the rifle in hand', () => {
  it('follows the camera, kicks and flashes on a shot, and settles', () => {
    const held = new HeldRifle(null);
    const camera = new PerspectiveCamera();
    camera.position.set(1, 1.6, -8);
    camera.updateMatrixWorld();
    held.shown = true;
    held.update(0.016, camera, 1);
    const at = new Vector3();
    held.scene.children[0].getWorldPosition(at);
    expect(at.toArray()).toEqual([1, 1.6, -8]);
    held.fire();
    held.update(0.01, camera, 1);
    expect(held.flashing).toBe(true);
    held.update(CONFIG.range.kickTime, camera, 1);
    expect(held.flashing).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/range-rack.test.ts`
Expected: FAIL, `Failed to resolve import "../src/range-rack"`.

- [ ] **Step 3: Write `web/src/range-rack.ts`**

```ts
import { BoxGeometry, type Camera, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Scene, SphereGeometry } from 'three';
import { CONFIG } from './config';
import { makeMatcaps } from './creatures';
import type { RangeStatus, Target } from './interactions';
import { type CanvasFactory, domCanvas } from './screens';
import { TableMaterials } from './table-pieces';

const defaultCanvas = (): CanvasFactory | null => (typeof document === 'undefined' ? null : domCanvas);

/** A rifle, its barrel along local −z: the stock's butt at z 0.25, the muzzle at z −0.75, the iron sights on top. */
export function makeRifle(m: TableMaterials): Group {
  const c = CONFIG.range.colours;
  const wood = m.make('Rifle stock', c.wood);
  const metal = m.make('Rifle metal', c.metal, null, true);
  const box = (w: number, h: number, d: number, material: typeof wood, x: number, y: number, z: number) => {
    const b = new Mesh(new BoxGeometry(w, h, d), material);
    b.position.set(x, y, z);
    return b;
  };
  const barrel = new Mesh(new CylinderGeometry(0.011, 0.011, 0.6, 12).rotateX(Math.PI / 2), metal);
  barrel.position.set(0, 0.035, -0.45);
  const rifle = new Group();
  rifle.name = 'Rifle';
  rifle.add(
    box(0.045, 0.11, 0.3, wood, 0, -0.03, 0.1), // the stock
    box(0.04, 0.05, 0.42, wood, 0, -0.005, -0.25), // the fore-end
    box(0.035, 0.05, 0.2, metal, 0, 0.035, -0.05), // the receiver
    box(0.006, 0.025, 0.012, metal, 0, 0.07, -0.12), // the rear sight
    box(0.004, 0.03, 0.006, metal, 0, 0.06, -0.73), // the front sight
    barrel,
  );
  return rifle;
}

/**
 * The range on the balcony: a wooden stand at the railing with a rifle lying across it, and a big red mushroom
 * button on a post beside it. Matcaps, as the wine and the table's games are, dimmed with the daylight there and a
 * little brighter under the crosshair; the button's cap glows while a round is on.
 */
export class RifleRack {
  readonly root = new Group();
  readonly rack = new Group();
  readonly button = new Group();
  readonly rackTarget: Target;
  readonly buttonTarget: Target;
  private rackMaterials: TableMaterials;
  private buttonMaterials: TableMaterials;
  private cap = new MeshBasicMaterial({ name: 'Button cap' });
  private colour = new Color();

  constructor(range: RangeStatus, canvas: CanvasFactory | null = defaultCanvas()) {
    const cfg = CONFIG.range;
    const c = cfg.colours;
    const matcaps = makeMatcaps(canvas);
    this.root.name = 'Shooting range';
    this.rackMaterials = new TableMaterials(matcaps);
    this.buttonMaterials = new TableMaterials(matcaps);
    const wood = this.rackMaterials.make('Rack wood', c.wood);
    const base = new Mesh(new BoxGeometry(0.5, 0.04, 0.22), wood);
    base.position.y = 0.02;
    const post = (x: number) => {
      const p = new Mesh(new BoxGeometry(0.04, 0.9, 0.04), wood);
      p.position.set(x, 0.45, 0);
      return p;
    };
    const rifle = makeRifle(this.rackMaterials);
    rifle.rotation.y = Math.PI / 2; // along the railing: its muzzle toward −x
    rifle.position.set(0.25, 0.93, 0); // centred over the stand
    this.rack.position.set(cfg.rack[0], cfg.floor, cfg.rack[1]);
    this.rack.add(base, post(-0.2), post(0.2), rifle);

    const b = this.buttonMaterials;
    const stem = new Mesh(new CylinderGeometry(0.035, 0.045, 0.95, 16), b.make('Button post', c.metal, null, true));
    stem.position.y = 0.475;
    const housing = new Mesh(new CylinderGeometry(0.075, 0.075, 0.06, 24), b.make('Button housing', c.housing));
    housing.position.y = 0.98;
    const cap = new Mesh(new CylinderGeometry(0.06, 0.065, 0.045, 24), this.cap);
    cap.position.y = 1.03;
    this.button.position.set(cfg.button[0], cfg.floor, cfg.button[1]);
    this.button.add(stem, housing, cap);

    this.root.add(this.rack, this.button);
    this.rackTarget = { kind: 'rack', range, node: this.rack };
    this.buttonTarget = { kind: 'range-button', range, node: this.button };
  }

  /** The button's cap colour now, as hex, for tests. */
  get capColour(): string {
    return this.cap.color.getHexString();
  }

  /** Every frame: how lit the balcony is (`figureLight`), what the crosshair is on, and whether a round is on. */
  update(light: number, highlight: 'rack' | 'range-button' | null, lit: boolean): void {
    const level = (on: boolean) => Math.min(1, light * (on ? 1.35 : 1) + (on ? 0.08 : 0));
    this.rackMaterials.setLight(level(highlight === 'rack'));
    this.buttonMaterials.setLight(level(highlight === 'range-button'));
    const c = CONFIG.range.colours;
    if (lit) this.cap.color.set(c.lit);
    else this.cap.color.copy(this.colour.set(c.button)).multiplyScalar(level(highlight === 'range-button'));
  }
}

/**
 * The rifle in hand, at the bottom right of the view: in a scene of its own that main.ts draws over the flat after
 * clearing the depth, so it never sinks into the railing. A shot kicks it back and up, easing back over `kickTime`,
 * with a flash at the muzzle for the first part of it.
 */
export class HeldRifle {
  readonly scene = new Scene();
  private holder = new Group();
  private gun: Group;
  private flash: Mesh;
  private materials: TableMaterials;
  private kick = 1;

  constructor(canvas: CanvasFactory | null = defaultCanvas()) {
    const cfg = CONFIG.range;
    this.materials = new TableMaterials(makeMatcaps(canvas));
    this.gun = makeRifle(this.materials);
    this.gun.position.set(...cfg.hold);
    this.gun.rotation.set(0.03, 0.04, 0); // the muzzle turned a little in, toward the crosshair
    this.flash = new Mesh(new SphereGeometry(0.035, 10, 8), new MeshBasicMaterial({ color: cfg.colours.flash, transparent: true, opacity: 0.9, depthWrite: false }));
    this.flash.position.set(0, 0.035, -0.8);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.holder.add(this.gun);
    this.holder.visible = false;
    this.scene.add(this.holder);
  }

  get shown(): boolean {
    return this.holder.visible;
  }

  set shown(on: boolean) {
    this.holder.visible = on;
  }

  get flashing(): boolean {
    return this.flash.visible;
  }

  fire(): void {
    this.kick = 0;
  }

  /** Every frame: where the camera is, the kick easing back, and the light where the visitor stands. */
  update(dt: number, camera: Camera, light: number): void {
    const cfg = CONFIG.range;
    camera.getWorldPosition(this.holder.position);
    camera.getWorldQuaternion(this.holder.quaternion);
    this.kick = Math.min(1, this.kick + dt / cfg.kickTime);
    const k = (1 - this.kick) ** 2;
    this.gun.position.z = cfg.hold[2] + 0.07 * k;
    this.gun.rotation.x = 0.03 + 0.2 * k;
    this.flash.visible = this.kick < 0.25;
    this.materials.setLight(light);
  }
}
```

- [ ] **Step 4: Run the test and types**

Run: `npx vitest run tests/range-rack.test.ts && npx tsc --noEmit`
Expected: PASS (3 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/range-rack.ts web/tests/range-rack.test.ts
git commit -m "Shooting range: the rack, the red button and the rifle in hand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The targets, shards, points and tracers

**Files:**
- Create: `web/src/range-view.ts`
- Test: `web/tests/range-view.test.ts`

**Interfaces:**
- Consumes: `Flight`, `flightAt`, `TargetKind`, `Vec3` (Task 1); `RangeEvent` (Task 3); `TableMaterials`, `makeMatcaps`, `CanvasFactory`, `domCanvas`.
- Produces: `class RangeView { root: Group; constructor(canvas?); update(dt: number, round: { id: string; flights: readonly Flight[] } | null, t: number, broken: ReadonlySet<number>, events: readonly RangeEvent[], colourOf: (id: string) => string, light: number): void; objectFor(i: number): Object3D | undefined; shardCount: number; floatCount: number; tracerCount: number }`.

- [ ] **Step 1: Write the failing test**

`web/tests/range-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { flightAt, schedule } from '../src/range-flights';
import { RangeView } from '../src/range-view';

const flights = schedule(11);
const round = { id: 'r1', flights };
const colour = () => '#ff0000';
const none = new Set<number>();

describe('the range view', () => {
  it('shows each target where it flies, and none before launch, after landing or once hit', () => {
    const v = new RangeView(null);
    const f = flights[0];
    const t = f.at + f.dur / 2;
    v.update(0.016, round, t, none, [], colour, 1);
    const o = v.objectFor(0)!;
    expect(o.visible).toBe(true);
    expect(o.position.toArray()).toEqual(flightAt(f, t));
    expect(v.objectFor(flights.length - 1)!.visible).toBe(false);
    v.update(0.016, round, t, new Set([0]), [], colour, 1);
    expect(v.objectFor(0)!.visible).toBe(false);
    v.update(0.016, round, f.at + f.dur + 0.1, none, [], colour, 1);
    expect(v.objectFor(0)!.visible).toBe(false);
  });

  it('shatters a hit into shards and floats its points, both gone in time', () => {
    const v = new RangeView(null);
    v.update(0.016, round, 1, none, [{ kind: 'break', target: 0, by: 'a', points: 10, at: [1, 5, -30] }], colour, 1);
    expect(v.shardCount).toBeGreaterThan(0);
    expect(v.floatCount).toBe(1);
    for (let s = 0; s < Math.max(CONFIG.range.shards, CONFIG.range.float) + 0.1; s += 0.05) v.update(0.05, round, 1, none, [], colour, 1);
    expect(v.shardCount).toBe(0);
    expect(v.floatCount).toBe(0);
  });

  it("draws another's shot as a tracer for a moment", () => {
    const v = new RangeView(null);
    v.update(0.016, round, 1, none, [{ kind: 'shot', by: 'b', o: [1, 1.6, -8.5], d: [0, 0, -1] }], colour, 1);
    expect(v.tracerCount).toBe(1);
    v.update(CONFIG.range.tracer + 0.01, round, 1, none, [], colour, 1);
    expect(v.tracerCount).toBe(0);
  });

  it('rebuilds for a new round and shows nothing without one', () => {
    const v = new RangeView(null);
    v.update(0.016, round, flights[0].at + 0.1, none, [], colour, 1);
    const first = v.objectFor(0);
    v.update(0.016, { id: 'r2', flights: schedule(12) }, 0.6, none, [], colour, 1);
    expect(v.objectFor(0)).not.toBe(first);
    v.update(0.016, null, 0, none, [], colour, 1);
    expect(v.objectFor(0)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/range-view.test.ts`
Expected: FAIL, `Failed to resolve import "../src/range-view"`.

- [ ] **Step 3: Write `web/src/range-view.ts`**

```ts
import {
  BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial,
  Mesh, type MeshMatcapMaterial, type Object3D, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three';
import { CONFIG } from './config';
import { makeMatcaps } from './creatures';
import type { RangeEvent } from './range-game';
import { type Flight, flightAt, type TargetKind } from './range-flights';
import { type CanvasFactory, domCanvas } from './screens';
import { TableMaterials } from './table-pieces';

interface Shard { mesh: Mesh; v: Vector3; spin: Vector3; age: number }
interface Float { sprite: Sprite; age: number }
interface Tracer { line: Line; age: number }

/**
 * The round's targets as everyone in the flat sees them, out over the street: each where `flightAt` puts it, a clay
 * spinning as it goes, gone once hit. A hit shatters into shards that tumble down and its points float up in the
 * shooter's colour; another's shot shows as a tracer for a moment. Drawn with the flat, after the neighbourhood's
 * pass has cleared the depth, so no building hides a target.
 */
export class RangeView {
  readonly root = new Group();
  private materials: TableMaterials;
  private looks: Record<TargetKind, MeshMatcapMaterial>;
  private rotor: MeshMatcapMaterial;
  private shardGeometry = new BoxGeometry(0.07, 0.025, 0.06);
  private targets: Object3D[] = [];
  private shown = '';
  private shards: Shard[] = [];
  private floats: Float[] = [];
  private tracers: Tracer[] = [];
  private labels = new Map<number, CanvasTexture | null>();

  constructor(private canvas: CanvasFactory | null = typeof document === 'undefined' ? null : domCanvas) {
    const c = CONFIG.range.colours;
    this.root.name = 'Range targets';
    this.materials = new TableMaterials(makeMatcaps(canvas));
    this.looks = {
      clay: this.materials.make('Clay', c.clay),
      gold: this.materials.make('Gold clay', c.gold, null, true),
      drone: this.materials.make('Drone', c.drone, null, true),
    };
    this.rotor = this.materials.make('Drone rotor', c.rotor);
  }

  get shardCount(): number {
    return this.shards.length;
  }

  get floatCount(): number {
    return this.floats.length;
  }

  get tracerCount(): number {
    return this.tracers.length;
  }

  /** The object showing target `i` of the round shown, if any. */
  objectFor(i: number): Object3D | undefined {
    return this.targets[i];
  }

  /** Every frame: the round (null for none) at round time `t`, what has been hit, what just happened, each shooter's
   * colour, and how lit it is out there (`figureLight`). */
  update(dt: number, round: { id: string; flights: readonly Flight[] } | null, t: number, broken: ReadonlySet<number>, events: readonly RangeEvent[], colourOf: (id: string) => string, light: number): void {
    this.materials.setLight(light);
    const id = round?.id ?? '';
    if (id !== this.shown) this.rebuild(round);
    round?.flights.forEach((f, i) => {
      const o = this.targets[i];
      const p = broken.has(f.i) ? null : flightAt(f, t);
      o.visible = p !== null;
      if (!p) return;
      o.position.set(p[0], p[1], p[2]);
      if (f.kind !== 'drone') o.rotation.y = 12 * (t - f.at) + f.phase; // a clay spins as it flies
    });
    for (const e of events) {
      if (e.kind === 'shot') this.addTracer(e.o, e.d);
      else {
        const kind = round?.flights[e.target]?.kind ?? 'clay';
        this.addShards(e.at, kind);
        this.addFloat(e.at, e.points, colourOf(e.by));
      }
    }
    this.age(dt);
  }

  private rebuild(round: { id: string; flights: readonly Flight[] } | null): void {
    for (const o of this.targets) this.root.remove(o);
    this.targets = (round?.flights ?? []).map((f) => {
      const o = this.makeTarget(f.kind);
      o.visible = false;
      this.root.add(o);
      return o;
    });
    this.shown = round?.id ?? '';
  }

  /** A clay or gold clay: a shallow disc, tilted as it flies. A drone: a body with four rotors. */
  private makeTarget(kind: TargetKind): Object3D {
    const size = CONFIG.range.kinds[kind].size;
    if (kind !== 'drone') {
      const disc = new Mesh(new CylinderGeometry(size / 2, size * 0.4, 0.07, 20), this.looks[kind]);
      disc.rotation.x = 0.35;
      const g = new Group();
      g.add(disc);
      return g;
    }
    const g = new Group();
    g.add(new Mesh(new BoxGeometry(size * 0.45, size * 0.18, size * 0.45), this.looks.drone));
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arm = new Mesh(new BoxGeometry(size * 0.5, 0.02, 0.03), this.looks.drone);
      arm.position.set((x * size) / 4, 0, (z * size) / 4);
      arm.rotation.y = x * z > 0 ? -Math.PI / 4 : Math.PI / 4;
      const rotor = new Mesh(new CylinderGeometry(size * 0.18, size * 0.18, 0.01, 16), this.rotor);
      rotor.position.set((x * size) / 2, size * 0.1, (z * size) / 2);
      g.add(arm, rotor);
    }
    return g;
  }

  private addShards(at: readonly number[], kind: TargetKind): void {
    for (let k = 0; k < 7; k++) {
      const mesh = new Mesh(this.shardGeometry, this.looks[kind]);
      mesh.position.set(at[0], at[1], at[2]);
      const a = (k / 7) * Math.PI * 2 + Math.random();
      const v = new Vector3(Math.cos(a) * (1.5 + Math.random() * 2), 1 + Math.random() * 2.5, Math.sin(a) * (1.5 + Math.random() * 2));
      const spin = new Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      this.root.add(mesh);
      this.shards.push({ mesh, v, spin, age: 0 });
    }
  }

  /** "+10" (or 30, 50) in white, tinted with the shooter's colour; one texture per value. */
  private addFloat(at: readonly number[], points: number, colour: string): void {
    if (!this.labels.has(points)) this.labels.set(points, this.label(`+${points}`));
    const sprite = new Sprite(new SpriteMaterial({ map: this.labels.get(points) ?? null, color: colour, transparent: true, depthTest: false }));
    sprite.position.set(at[0], at[1] + 0.4, at[2]);
    sprite.scale.set(2.4, 1.2, 1);
    this.root.add(sprite);
    this.floats.push({ sprite, age: 0 });
  }

  private label(text: string): CanvasTexture | null {
    if (!this.canvas) return null;
    const surface = this.canvas(256, 128);
    const ctx = surface.getContext('2d') as CanvasRenderingContext2D | null; // as makeMatcaps does
    if (!ctx) return null;
    ctx.font = 'bold 88px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 128, 64);
    const texture = new CanvasTexture(surface as unknown as HTMLCanvasElement);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }

  private addTracer(o: readonly number[], d: readonly number[]): void {
    const from = [o[0] + d[0], o[1] + d[1], o[2] + d[2]]; // from a metre out, past the shooter's own animal
    const to = [o[0] + d[0] * 60, o[1] + d[1] * 60, o[2] + d[2] * 60];
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([...from, ...to], 3));
    const line = new Line(geometry, new LineBasicMaterial({ color: CONFIG.range.colours.tracer, transparent: true, opacity: 0.8 }));
    this.root.add(line);
    this.tracers.push({ line, age: 0 });
  }

  /** Shards fall and fade, points rise and fade, tracers fade; each goes once its time is up. */
  private age(dt: number): void {
    const cfg = CONFIG.range;
    this.shards = this.shards.filter((s) => {
      s.age += dt;
      if (s.age >= cfg.shards) {
        this.root.remove(s.mesh);
        return false;
      }
      s.v.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      return true;
    });
    this.floats = this.floats.filter((f) => {
      f.age += dt;
      if (f.age >= cfg.float) {
        this.root.remove(f.sprite);
        f.sprite.material.dispose();
        return false;
      }
      f.sprite.position.y += 1.2 * dt;
      f.sprite.material.opacity = 1 - f.age / cfg.float;
      return true;
    });
    this.tracers = this.tracers.filter((tr) => {
      tr.age += dt;
      if (tr.age >= cfg.tracer) {
        this.root.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as LineBasicMaterial).dispose();
        return false;
      }
      (tr.line.material as LineBasicMaterial).opacity = 0.8 * (1 - tr.age / cfg.tracer);
      return true;
    });
  }
}
```

- [ ] **Step 4: Run the test and types**

Run: `npx vitest run tests/range-view.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/range-view.ts web/tests/range-view.test.ts
git commit -m "Shooting range: the targets in flight, their shards and points, and the others' tracers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The shot's sound, the top strip and the Fire button

**Files:**
- Modify: `web/src/sound.ts` (a `pannerAt` helper used by `play` and the new `shot`)
- Modify: `web/index.html` (inside `#hud`, after `<div id="prompt" hidden></div>`)
- Modify: `web/src/style.css` (after the `#prompt` rule, around line 119; the touch rule near line 300)
- Modify: `web/src/ui.ts` (`setRange`, `setArmed`, `onFire`)

**Interfaces:**
- Consumes: `RangeHud` (Task 3); `CONFIG.audio.shot` (Task 1).
- Produces: `Sound.shot(at: Vector3 | null): void`; `UI.setRange(hud: RangeHud | null, colourOf: (id: string) => string): void`; `UI.setArmed(on: boolean): void`; `UI.onFire(fire: () => void): void`.

No unit tests here: these are thin DOM and Web Audio wrappers (the repo tests neither directly; `rangeHud` is tested in Task 3). They're checked in the browser in Task 9.

- [ ] **Step 1: The shot in `web/src/sound.ts`**

Add a field after `private position = new Vector3();`:

```ts
  /** The shot's burst of noise, made on first use. */
  private shotNoise: AudioBuffer | null = null;
```

In `play`, replace everything from `let out: AudioNode = gain;` to the end of the method with a call to a new helper, so `play` and `shot` share the panner:

```ts
    const out = at ? this.pannerAt(at.getWorldPosition(this.position), gain) : gain;
    out.connect(to);
    src.start();
```

and add:

```ts
  /** `from` placed at a point, through an HRTF panner heard at full level within `ref` metres. */
  private pannerAt(p: Vector3, from: AudioNode, ref = 1): AudioNode {
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.refDistance = ref;
    panner.positionX.value = p.x;
    panner.positionY.value = p.y;
    panner.positionZ.value = p.z;
    from.connect(panner);
    return panner;
  }

  /** A rifle shot, made here rather than loaded: a burst of noise with a fast decay, low-passed. From another
   * shooter's spot, or (null) this visitor's own. */
  shot(at: Vector3 | null): void {
    const s = CONFIG.audio.shot;
    if (!this.shotNoise) {
      const n = Math.round(this.ctx.sampleRate * s.length);
      this.shotNoise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const data = this.shotNoise.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * s.decay));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.shotNoise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = s.cutoff;
    const gain = this.ctx.createGain();
    gain.gain.value = s.level;
    src.connect(filter).connect(gain);
    (at ? this.pannerAt(at, gain, s.reach) : gain).connect(this.effects);
    src.start();
  }
```

Run `npx vitest run tests/audio.test.ts && npx tsc --noEmit` to make sure `play` still type-checks.

- [ ] **Step 2: The markup in `web/index.html`**

After `<div id="prompt" hidden></div>`:

```html
      <section id="range" aria-label="Shooting range" aria-live="polite" hidden>
        <p id="range-head"></p>
        <ol id="range-scores"></ol>
      </section>
      <button type="button" id="touch-fire" class="touch-only" aria-label="Fire" hidden>Fire</button>
```

- [ ] **Step 3: The styles in `web/src/style.css`**

After the `#prompt { … }` rule:

```css
/* The shooting range's strip (range-game.ts): the countdown or the time left, and the scores, top middle; bigger,
   and a list, for the final scores. */
#range {
  position: fixed; left: 50%; top: calc(14px + env(safe-area-inset-top)); transform: translateX(-50%); pointer-events: none;
  text-align: center; background: rgba(18, 17, 15, 0.6); padding: 6px 14px; border-radius: 8px; font-size: 14px;
  max-width: calc(100vw - 32px); box-sizing: border-box;
}
#range-head { margin: 0 0 2px; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
#range ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 12px; }
#range li { font-variant-numeric: tabular-nums; }
#range li i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; }
#range li.you { font-weight: 600; }
#range.final { top: 22%; padding: 14px 22px; font-size: 17px; }
#range.final #range-head { font-size: 24px; margin-bottom: 6px; }
#range.final ol { flex-direction: column; align-items: flex-start; }
/* The touch Fire button, under the right thumb while a rifle is in hand. */
#touch-fire {
  position: fixed; right: calc(28px + env(safe-area-inset-right)); bottom: calc(40px + env(safe-area-inset-bottom));
  width: 84px; height: 84px; border-radius: 50%; border: 2px solid rgba(244, 241, 234, 0.5);
  background: rgba(200, 22, 29, 0.55); color: #fff; font: inherit; font-weight: 600; touch-action: none;
}
#touch-fire[hidden] { display: none; }
```

Next to the other `body.touch` position rules (around line 300):

```css
body.touch #range { top: calc(140px + env(safe-area-inset-top)); }
```

- [ ] **Step 4: The UI methods in `web/src/ui.ts`**

Import the type: `import type { RangeHud } from './range-game';`. Add a field `private lastRange = '';` with the other `last…` fields, then after `setPrompt`:

```ts
  /** The shooting range's strip: the head and the board, each shooter in their colour; null hides it. Rebuilt only
   * when it changes. */
  setRange(hud: RangeHud | null, colourOf: (id: string) => string): void {
    const key = hud ? JSON.stringify(hud) : '';
    if (key === this.lastRange) return;
    this.lastRange = key;
    const box = this.el('range');
    box.hidden = !hud;
    if (!hud) return;
    box.classList.toggle('final', hud.final);
    this.el('range-head').textContent = hud.head;
    this.el('range-scores').replaceChildren(...hud.rows.map((r) => {
      const li = this.doc.createElement('li');
      li.classList.toggle('you', r.you);
      const dot = this.doc.createElement('i');
      dot.style.background = colourOf(r.id);
      li.append(dot, `${hud.final ? `${r.place}. ` : ''}${r.name} ${r.score}`);
      return li;
    }));
  }

  /** A rifle in hand: the touch Fire button shows. */
  setArmed(on: boolean): void {
    this.el('touch-fire').hidden = !on;
  }

  /** The touch Fire button fires on the press, not the release. */
  onFire(fire: () => void): void {
    this.el('touch-fire').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fire();
    });
  }
```

- [ ] **Step 5: Types and the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/sound.ts web/index.html web/src/style.css web/src/ui.ts
git commit -m "Shooting range: the shot's sound, the scores strip and the touch Fire button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Wiring it into the walkthrough

**Files:**
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: everything above. Existing `main.ts` names: `selfId`, `newId`, `visitors()`, `colourFor`, `cleanName`, `ui`, `sound`, `others`, `player`, `camera`, `interactions`, `world`, `avatarLight`, `currentRoom`, `paused`, `started`, `autostart`, `touch`, `renderer`, `scene`, `params`, `sendDraw`, `draw`.

- [ ] **Step 1: Imports**

```ts
import { HeldRifle, RifleRack } from './range-rack';
import { RangeGame, rangeHud, type RangeOut } from './range-game';
import { RangeView } from './range-view';
```

Add `isShared` to the `./presence` import if Task 4 didn't already.

- [ ] **Step 2: The range, after the draw-and-guess block (after `updateDraw`, before `ui.setName(...)`)**

```ts
  /** The shooting range on the Varanda (range-*.ts): the rack and the button, the rifle in hand, the targets for
   * everyone in the flat, and the round shared with whoever else holds a rifle. Not in reference views, as the
   * games aren't. */
  const range = new RangeGame(selfId, newId);
  const rack = new RifleRack(range);
  const rangeView = new RangeView();
  const held = new HeldRifle();
  if (!params.has('autostart')) {
    scene.add(rack.root, rangeView.root);
    world.pickables.push(rack.rack, rack.button);
    world.targets.set(rack.rack, rack.rackTarget);
    world.targets.set(rack.button, rack.buttonTarget);
  }
  const sendRange = (out: RangeOut[]) => {
    for (const o of out) others?.sendRange(o.msg, o.to);
  };
  /** Picks up the rifle or puts it back on the rack. */
  const arm = (on: boolean) => {
    if (on === range.armed) return;
    sendRange(range.setArmed(on, cleanName(ui.getName()), performance.now()));
    held.shown = on;
    ui.setArmed(on);
    sound?.click(rack.rack);
  };
  /** A click or tap on the rack picks up or puts back the rifle; on the button, starts a round. True when it was one
   * of them, so nothing else takes the click. */
  const useRange = (t: Target | null): boolean => {
    if (t?.kind === 'rack') {
      if (!player.frozen) arm(!range.armed);
      return true;
    }
    if (t?.kind !== 'range-button') return false;
    const out = range.start(performance.now());
    if (out.length) {
      sendRange(out);
      sound?.click(rack.button);
    }
    return true;
  };
  /** A shot along the crosshair (the drunk wobble included), once the bolt has cycled: it kicks, it sounds, and the
   * others hear it. */
  let nextShot = 0;
  const shotFrom = new Vector3();
  const shotDir = new Vector3();
  const fire = () => {
    const now = performance.now();
    if (!range.armed || player.frozen || paused || now < nextShot) return;
    nextShot = now + CONFIG.range.cycle * 1000;
    camera.getWorldPosition(shotFrom);
    camera.getWorldDirection(shotDir);
    sendRange(range.shoot([shotFrom.x, shotFrom.y, shotFrom.z], [shotDir.x, shotDir.y, shotDir.z], now));
    held.fire();
    sound?.shot(null);
  };
  ui.onFire(fire);
  const otherShot = new Vector3();
  /** From the frame loop (`now` in ms): off the balcony, sitting or blacked out the rifle goes back; the round's step,
   * the targets, the rack and the rifle in hand, and the strip. */
  const updateRange = (dt: number, now: number) => {
    if (range.armed && (currentRoom !== CONFIG.range.room || player.seat || player.frozen)) arm(false);
    range.update(now);
    const events = range.takeEvents();
    for (const e of events) if (e.kind === 'shot') sound?.shot(otherShot.fromArray(e.o));
    const outside = avatarLight(CONFIG.range.middle, CONFIG.range.rail - CONFIG.range.near); // the open air: daylight only
    rangeView.update(dt, range.round, range.roundTime(now), range.broken(), events, colourFor, outside);
    const on = interactions.current?.kind;
    rack.update(avatarLight(CONFIG.range.rack[0], CONFIG.range.rack[1]), on === 'rack' || on === 'range-button' ? on : null, range.busy);
    held.update(dt, camera, avatarLight(player.x, player.z));
    ui.setRange(started && !autostart ? rangeHud(range, now, selfId()) : null, colourFor);
  };
```

`paused`, `currentRoom`, `started` and `autostart` are declared further down with `let`/`const`; these closures only run after they are set, as `toggleSit` already relies on.

- [ ] **Step 3: The multiplayer hooks**

In the `new Multiplayer(…, { … })` hooks object, replace the `onArrive` line and add `onRange`:

```ts
        onDraw: (m, from) => sendDraw(draw.receive(m, from, performance.now())),
        onRange: (m, from) => sendRange(range.receive(m, from, performance.now())),
        onArrive: (id) => {
          sendDraw(draw.greet(id));
          sendRange(range.greet(id, visitors(), performance.now()));
        },
```

- [ ] **Step 4: Clicks and taps**

In the `mousedown` handler, replace:

```ts
    const t = interactions.click();
    if (t?.kind === 'screen' && t.screen.isTv) return openTv();
```

with:

```ts
    if (range.armed) { // with the rifle in hand a click fires, except on the rack and the button
      if (!useRange(interactions.current)) fire();
      return;
    }
    const t = interactions.click();
    if (t?.kind === 'screen' && t.screen.isTv) return openTv();
    if (useRange(t)) return;
```

In the touch `tap` handler, replace:

```ts
      const r = canvas.getBoundingClientRect();
      const t = interactions.tap(new Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2));
      if (t?.kind === 'screen' && t.screen.isTv) return openTv();
```

with:

```ts
      const r = canvas.getBoundingClientRect();
      const point = new Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2);
      if (range.armed) return void useRange(interactions.at(point)); // with the rifle in hand, only the rack and the button take a tap (Fire fires)
      const t = interactions.tap(point);
      if (t?.kind === 'screen' && t.screen.isTv) return openTv();
      if (useRange(t)) return;
```

- [ ] **Step 5: The frame loop and the render**

After `updateDraw(now);`:

```ts
    updateRange(dt, now);
```

Replace the prompt line:

```ts
    ui.setPrompt(boardPanel.isOpen || tvPanel.isOpen ? null : target ? promptFor(target, world.lights, touch ? 'Tap' : 'Click') : player.seat && started ? COPY.stand : null);
```

with:

```ts
    const prompted = range.armed && target?.kind !== 'rack' && target?.kind !== 'range-button' ? null : target; // with the rifle, a click fires
    ui.setPrompt(boardPanel.isOpen || tvPanel.isOpen ? null : prompted ? promptFor(prompted, world.lights, touch ? 'Tap' : 'Click') : player.seat && started ? COPY.stand : null);
```

After `renderer.render(scene, camera);`:

```ts
    if (held.shown) { // the rifle in hand over everything, so it never sinks into the railing
      renderer.clearDepth();
      renderer.render(held.scene, camera);
    }
```

- [ ] **Step 6: The debug handle**

In the `params.has('debug')` `Object.assign(window, { walkthrough: { … } })` line, add `get range() { return range; },` next to `get draw() { return draw; },`.

- [ ] **Step 7: Types and tests**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/main.ts
git commit -m "Shooting range: wired into the walkthrough

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: In the browser, then the README and the design note

**Files:**
- Possibly modify: `web/src/config.ts` (`CONFIG.range.rack`, `button`, `floor`, `hold`, sizes) from what the browser shows
- Modify: `README.md` (Controls, touch paragraph, a "Shooting range" section after "Visitors together" or before it)
- Modify: `docs/superpowers/specs/2026-10-28-balcony-shooting-range-design.md` (`**Status:** Implemented`)

- [ ] **Step 1: Start the dev server and open the balcony**

Start the `web` dev server with the preview tools (`preview_start`; add a `.claude/launch.json` entry running `npm run dev` in `web/` on port 5173 if there isn't one). Open `http://localhost:5173/?debug&solo`, click to start, then in the console move to the balcony facing the street:

```js
walkthrough.player.teleport(2.2, -8.4, 0, 0); walkthrough.player.resolve();
```

Check, with screenshots:
- The rack stands against the railing at the east end and the button stands beside it, neither inside a wall nor floating (adjust `CONFIG.range.rack`, `button` or `floor`); both kitchen variants (`?kitchen=wall` too).
- The crosshair on the rack shows "Click: pick up the rifle". Click it: the rifle shows at the bottom right, not clipped, and points toward the crosshair (adjust `CONFIG.range.hold`).
- The button reads "Click: start a round"; click it. The strip counts 3-2-1, then 1:00 counting down. Targets fly over the street, are visible against the neighbourhood and are big enough to hit with iron sights.
- Clicking fires: kick, flash, sound. A hit shatters the target and floats "+10" (or 30, 50); a miss does nothing; shots are 0.6 s apart.
- After 60 s, the final scores show for 10 s, then the strip goes.
- Walking back into the office puts the rifle back. C puts it back and sits.
- `read_console_messages` shows no errors.

- [ ] **Step 2: Two browsers competing**

Open a second tab on `http://localhost:5173/?debug&room=range-test` and the first on the same URL. Teleport both to the balcony and pick up both rifles. Start from one tab: both count down together and see the same targets. A hit in one shatters the target in the other, with the shooter's tracer and sound, and the strips agree on the scores. A tab opened mid-round catches up with the same board.

- [ ] **Step 3: Touch**

With `resize_window` preset `mobile` and a reload, the Fire button shows only with the rifle, fires on press, and the strip sits below the touch bar without overlapping the room name. Reset with preset `desktop` afterwards.

- [ ] **Step 4: README**

In the Controls paragraph, after the wine clause, add: "click the rifle rack on the office's balcony (the Varanda) to pick up a rifle and the red button beside it to start a round (see Shooting range, below); with the rifle in hand a click fires". In the touch paragraph, add: "Tap the rifle rack on the balcony for a rifle; a Fire button shows while you hold it." Then add a section:

```markdown
## Shooting range

On the Varanda, the office's balcony, a rifle rack stands at the railing with a big red button beside it (`web/src/range-*.ts`). Click the rack for a rifle of your own (click it again, or step off the balcony, to put it back); with the rifle in hand a click fires along the crosshair, iron sights, no zoom, a shot every 0.6 s. The red button starts a round for everyone holding a rifle: a 3-2-1 countdown, then 60 s of clay pigeons (10 points), gold clays (30) and drones (50) flying over the street, then the final scores for 10 s. Everyone competes for the same targets: each browser makes the same flights from the round's seed, each shooter's browser judges its own shots at once, and every browser gives a target to the earliest hit, so all agree on the scores. Anyone in the flat sees the targets, the shatters and the others' shots. Sizes, speeds, points and the mix are in `CONFIG.range`; the shot's sound (made in code, no file) is `CONFIG.audio.shot`. The design note is `docs/superpowers/specs/2026-10-28-balcony-shooting-range-design.md`.
```

- [ ] **Step 5: Mark the design note implemented**

Change `**Status:** Design` to `**Status:** Implemented` in the design note. If tuning in Step 1 changed any number the note states (sizes, the mix, positions), update the note to match.

- [ ] **Step 6: Full check and commit**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

```bash
git add README.md docs/superpowers/specs/2026-10-28-balcony-shooting-range-design.md web/src/config.ts
git commit -m "Shooting range: in the README, tuned on the balcony, and the design note done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
