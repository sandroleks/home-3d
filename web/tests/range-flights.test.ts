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
