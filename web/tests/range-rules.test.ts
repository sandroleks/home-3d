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
