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
