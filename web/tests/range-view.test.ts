import { describe, expect, it } from 'vitest';
import { type Group, type Mesh, Vector3 } from 'three';
import { CONFIG } from '../src/config';
import { type Flight, flightAt, schedule } from '../src/range-flights';
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

  it('keeps a clay\'s face toward the balcony all through its flight', () => {
    const v = new RangeView(null);
    const i = flights.findIndex((f) => f.kind === 'clay');
    const f = flights[i];
    const normal = new Vector3();
    for (const k of [0.15, 0.35, 0.5, 0.65, 0.85]) {
      v.update(0.016, round, f.at + f.dur * k, none, [], colour, 1);
      const o = v.objectFor(i)!;
      o.updateMatrixWorld(true);
      const disc = o.children[0];
      normal.set(0, 1, 0).transformDirection(disc.matrixWorld);
      expect(normal.z, `at ${k}`).toBeGreaterThan(0.5);
    }
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

  it('shares one geometry per kind, within a round and across a rebuild', () => {
    const v = new RangeView(null);
    const clayAt = (fs: readonly Flight[]) => fs.filter((f) => f.kind === 'clay').map((f) => f.i);
    const droneAt = (fs: readonly Flight[]) => fs.filter((f) => f.kind === 'drone').map((f) => f.i);
    const discGeo = (i: number) => ((v.objectFor(i) as Group).children[0] as Mesh).geometry;
    const bodyGeo = (i: number) => ((v.objectFor(i) as Group).children[0] as Mesh).geometry;
    const armGeo = (i: number) => ((v.objectFor(i) as Group).children[1] as Mesh).geometry;
    v.update(0.016, round, 1, none, [], colour, 1);
    const [c0, c1] = clayAt(flights);
    const [d0, d1] = droneAt(flights);
    expect(discGeo(c0)).toBe(discGeo(c1));
    expect(bodyGeo(d0)).toBe(bodyGeo(d1));
    expect(armGeo(d0)).toBe(armGeo(d1));
    const [disc, body, arm] = [discGeo(c0), bodyGeo(d0), armGeo(d0)]; // read before the rebuild replaces the targets
    const second = schedule(12);
    v.update(0.016, { id: 'r2', flights: second }, 0.6, none, [], colour, 1);
    const [e0] = clayAt(second);
    const [f0] = droneAt(second);
    expect(discGeo(e0)).toBe(disc);
    expect(bodyGeo(f0)).toBe(body);
    expect(armGeo(f0)).toBe(arm);
  });

  it('leaves only the round\'s targets on the root once its effects have expired', () => {
    const v = new RangeView(null);
    v.update(0.016, round, 1, none, [
      { kind: 'break', target: 0, by: 'a', points: 10, at: [1, 5, -30] },
      { kind: 'shot', by: 'b', o: [1, 1.6, -8.5], d: [0, 0, -1] },
    ], colour, 1);
    expect(v.root.children.length).toBeGreaterThan(flights.length);
    for (let s = 0; s < Math.max(CONFIG.range.shards, CONFIG.range.float, CONFIG.range.tracer) + 0.1; s += 0.05) v.update(0.05, round, 1, none, [], colour, 1);
    expect(v.root.children.length).toBe(flights.length);
    const second = schedule(12);
    v.update(0.016, { id: 'r2', flights: second }, 0.6, none, [], colour, 1);
    expect(v.root.children.length).toBe(second.length);
  });
});
