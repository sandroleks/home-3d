import { describe, expect, it } from 'vitest';
import { shownCount } from '../src/draw-match';
import { type DrawMessage, type DrawOut, DrawGame, isDrawMessage, isDrawState, ISOLATION_GRACE, TAKEOVER, type Visitor } from '../src/draw-game';
import { type DrawState, newGame } from '../src/draw-rules';

/**
 * A few browsers in one room: each message is sent through JSON and checked as the network would, then handed to its
 * addressee (or everyone else here), whose answers go out in turn. `tick` runs every browser's frame.
 */
function party(...names: string[]) {
  let now = 1000;
  let games = 0;
  const browsers = names.map((name, i) => {
    const id = name.toLowerCase();
    return { id, name, arrived: i + 1, game: new DrawGame(() => id, () => `g${++games}`, () => 0) };
  });
  const here = new Set(browsers.map((b) => b.id));
  const log: { from: string; to: string; msg: DrawMessage }[] = [];
  const visitors = (): Visitor[] => browsers.filter((b) => here.has(b.id)).map((b) => ({ id: b.id, name: b.name, arrived: b.arrived, since: b.arrived }));
  const send = (from: string, outs: DrawOut[]) => {
    for (const o of outs) {
      const msg = JSON.parse(JSON.stringify(o.msg)) as unknown;
      expect(isDrawMessage(msg), JSON.stringify(msg)).toBe(true);
      for (const b of browsers) {
        if (b.id === from || !here.has(b.id) || (o.to && o.to !== b.id)) continue;
        log.push({ from, to: b.id, msg: msg as DrawMessage });
        send(b.id, b.game.receive(msg as DrawMessage, from, now));
      }
    }
  };
  const game = (id: string) => browsers.find((b) => b.id === id)!.game;
  return {
    log, visitors, send, game,
    get now() { return now; },
    /** Every browser's frame, `ms` later. */
    tick(ms = 0) {
      now += ms;
      for (const b of browsers) if (here.has(b.id)) send(b.id, b.game.update(now, visitors()));
    },
    join(...ids: string[]) {
      for (const id of ids) send(id, game(id).setJoined(true));
    },
    /** A tab closes: gone for everyone. */
    leave(id: string) {
      here.delete(id);
    },
    /** A visitor comes in: everyone already here greets them. */
    arrive(id: string) {
      here.add(id);
      for (const b of browsers) if (b.id !== id && here.has(b.id)) send(b.id, b.game.greet(id));
    },
  };
}

/** Ana, Rui and Zé (in that arrival order) all joined, Rui pressed Start, and Ana's browser has its three words. */
function started() {
  const p = party('Ana', 'Rui', 'Ze', 'Mia');
  p.leave('mia');
  p.join('ana', 'rui', 'ze');
  p.send('rui', p.game('rui').start(p.visitors(), p.now));
  p.tick();
  return p;
}

const scores = (s: DrawState | null) => Object.fromEntries((s?.players ?? []).map((p) => [p.id, p.score]));

describe('the lobby', () => {
  it("shares each visitor's Join, and starts only with two or more joined, from a player", () => {
    const p = party('Ana', 'Rui', 'Ze');
    p.join('ana');
    expect(p.game('ze').playing(p.visitors()).map((v) => v.id)).toEqual(['ana']);
    expect(p.game('ana').start(p.visitors(), p.now)).toEqual([]); // alone
    p.join('rui');
    expect(p.game('ze').start(p.visitors(), p.now)).toEqual([]); // Zé hasn't joined
    p.send('rui', p.game('rui').setJoined(false));
    expect(p.game('ana').playing(p.visitors()).map((v) => v.id)).toEqual(['ana']);
    p.join('rui');
    p.send('rui', p.game('rui').start(p.visitors(), p.now));
    for (const id of ['ana', 'rui', 'ze']) expect(p.game(id).state).toMatchObject({ id: 'g1', drawer: 'ana', owner: 'ana', phase: 'choosing', queue: ['rui'] });
    expect(p.game('ana').start(p.visitors(), p.now)).toEqual([]); // one game at a time
  });
});

describe('a game', () => {
  it('lets the drawer choose one of three words, which never leaves their browser before the reveal', () => {
    const p = started();
    expect(p.game('ana').choices).toEqual(['cat', 'dog', 'horse']);
    expect(p.game('rui').choices).toEqual([]);
    expect(p.game('ana').role()).toBe('drawer');
    expect(p.game('rui').role()).toBe('guesser');
    p.send('ana', p.game('ana').choose('rabbit', p.now)); // not offered
    expect(p.game('rui').state?.phase).toBe('choosing');
    p.send('ana', p.game('ana').choose('horse', p.now));
    expect(p.game('rui').state).toMatchObject({ phase: 'drawing', mask: '_____', word: '' });
    expect(p.game('ana').secret).toBe('horse');
    expect(JSON.stringify(p.log)).not.toContain('horse');
  });
  it('picks a word for a drawer who takes longer than 15 s', () => {
    const p = started();
    p.tick(14999);
    expect(p.game('rui').state?.phase).toBe('choosing');
    p.tick(1);
    expect(p.game('ana').secret).toBe('cat');
    expect(p.game('rui').state).toMatchObject({ phase: 'drawing', mask: '___' });
  });
  it('judges guesses at the owner: the feed for all, close for the guesser alone, points by the time left', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.tick(20000); // 60 s left
    p.send('rui', p.game('rui').guess('cat'));
    p.send('ze', p.game('ze').guess(' Hors '));
    expect(p.log.filter((l) => l.msg.k === 'guess').map((l) => l.to)).toEqual(['ana', 'ana']);
    expect(p.game('ze').close).toBe('Hors');
    expect(p.game('rui').close).toBeNull();
    expect(p.game('rui').state?.feed).toEqual([{ id: 'rui', kind: 'guess', text: 'cat' }, { id: 'ze', kind: 'guess', text: 'Hors' }]);
    p.send('rui', p.game('rui').guess('HORSE'));
    expect(scores(p.game('ze').state)).toEqual({ ana: 50, rui: 250, ze: 0 });
    expect(p.game('rui').guess('horse')).toEqual([]); // has it already
    expect(p.game('ana').guess('horse')).toEqual([]); // the drawer
    expect(p.game('ze').state?.feed.at(-1)).toEqual({ id: 'rui', kind: 'hit', text: '' });
  });
  it('ends the turn when everyone has it, shows the word for 5 s, then the next drawer owns the game', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.send('rui', p.game('rui').guess('horse'));
    p.send('ze', p.game('ze').guess('horse'));
    p.tick();
    expect(p.game('ze').state).toMatchObject({ phase: 'reveal', word: 'horse', mask: 'horse', points: [{ id: 'rui', points: 300 }, { id: 'ana', points: 100 }, { id: 'ze', points: 300 }] });
    p.tick(5000);
    for (const id of ['ana', 'rui', 'ze']) expect(p.game(id).state).toMatchObject({ phase: 'choosing', drawer: 'rui', owner: 'rui', turn: 2 });
    expect(p.game('ana').secret).toBe('');
    p.tick();
    expect(p.game('rui').choices).toEqual(['cat', 'dog', 'cow']); // horse is used
  });
  it('gives a letter at half time and another at three quarters', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.tick(39999);
    expect(shownCount(p.game('rui').state!.mask)).toBe(0);
    p.tick(1);
    expect(shownCount(p.game('rui').state!.mask)).toBe(1);
    p.tick(20000);
    expect(shownCount(p.game('rui').state!.mask)).toBe(2);
    p.tick(5000);
    expect(shownCount(p.game('rui').state!.mask)).toBe(2); // never more than half
  });
  it('plays every turn, shows the final scores for 15 s, then is over everywhere', () => {
    const p = started();
    for (let turn = 0; turn < 3; turn++) {
      p.tick(15000); // the word is picked
      p.tick(80000); // nobody guesses
      p.tick(5000); // the reveal
    }
    for (const id of ['ana', 'rui', 'ze']) expect(p.game(id).state).toMatchObject({ phase: 'end', used: ['cat', 'dog', 'horse'] });
    expect(p.game('rui').running).toBe(false);
    p.tick(15000);
    for (const id of ['ana', 'rui', 'ze']) expect(p.game(id).state).toBeNull();
  });
});

describe('the drawing', () => {
  it("reaches everyone in batches, with the drawer's undo and clear", () => {
    const p = started();
    const ana = p.game('ana');
    ana.penDown(0, 0, 100, 100);
    p.game('rui').penDown(0, 0, 500, 500); // not the drawer
    p.send('ana', ana.choose('horse', p.now));
    ana.penDown(2, 1, 100, 100);
    ana.penMove(200, 100);
    p.tick(50);
    ana.penMove(300, 100);
    ana.penDown(6, 0, 500, 500);
    p.tick(50);
    expect(p.game('rui').sketch.strokes).toEqual([{ c: 2, w: 1, p: [100, 100, 200, 100, 300, 100] }, { c: 6, w: 0, p: [500, 500] }]);
    expect(p.game('ze').sketch.strokes).toEqual(ana.sketch.strokes);
    p.send('ana', ana.undo());
    expect(p.game('ze').sketch.strokes).toHaveLength(1);
    p.send('ana', ana.clear());
    expect(p.game('ze').sketch.strokes).toEqual([]);
    expect(p.game('rui').undo()).toEqual([]);
  });
  it('starts afresh each turn', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.game('ana').penDown(0, 0, 1, 1);
    p.tick(80000);
    p.tick(5000);
    expect(p.game('rui').sketch.strokes).toEqual([]);
    expect(p.game('ana').sketch.strokes).toEqual([]);
  });
});

describe('joining and leaving', () => {
  it('gives a newcomer the game and the whole drawing, and lets them play straight away', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.game('ana').penDown(3, 0, 10, 10);
    p.game('ana').penMove(90, 10);
    p.arrive('mia');
    expect(p.game('mia').state).toMatchObject({ id: 'g1', phase: 'drawing' });
    expect(p.game('mia').sketch.strokes).toEqual([{ c: 3, w: 0, p: [10, 10, 90, 10] }]);
    expect(p.game('mia').playing(p.visitors()).map((v) => v.id)).toEqual(['ana', 'rui', 'ze']);
    p.tick(50); // the same points as a batch: nothing doubles
    expect(p.game('mia').sketch.strokes).toEqual([{ c: 3, w: 0, p: [10, 10, 90, 10] }]);
    p.join('mia');
    p.tick();
    expect(p.game('mia').state?.queue).toEqual(['rui', 'ze', 'mia']);
    p.send('mia', p.game('mia').guess('horse'));
    expect(scores(p.game('rui').state).mia).toBe(300);
  });
  it('takes a leaver out of the order, keeping their score, and ends with fewer than two', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.send('rui', p.game('rui').guess('horse'));
    p.send('rui', p.game('rui').setJoined(false)); // Leave
    p.tick();
    expect(p.game('ze').state?.queue).toEqual(['ze']);
    expect(p.game('ze').state?.players.find((q) => q.id === 'rui')).toMatchObject({ here: false, score: 300 });
    expect(p.game('rui').role()).toBeNull();
    p.leave('ze'); // a tab closes
    p.tick();
    p.tick(ISOLATION_GRACE);
    expect(p.game('ana').state).toMatchObject({ phase: 'end' }); // Ana's own final scores, shown to her alone
    expect(p.game('rui').state).toBeNull(); // an onlooker sees one player: no game to show
    expect(p.log.filter((l) => l.msg.k === 'state' && l.msg.s.phase === 'end')).toEqual([]);
  });
  it("ends the drawer's turn early when they press Leave, keeping the points won, and the next drawer goes on", () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.send('rui', p.game('rui').guess('horse'));
    p.send('ana', p.game('ana').setJoined(false));
    p.tick();
    expect(p.game('ze').state).toMatchObject({ phase: 'choosing', drawer: 'rui', owner: 'rui', turn: 2 });
    expect(scores(p.game('ze').state)).toEqual({ ana: 50, rui: 300, ze: 0 });
  });
  it("lets the leader take over when the drawer's tab goes, and the next earliest when the leader goes too", () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.send('ze', p.game('ze').guess('horse'));
    const seq = p.game('rui').state!.seq;
    p.leave('ana');
    p.tick();
    const s = p.game('ze').state!;
    expect(s).toMatchObject({ drawer: 'rui', owner: 'rui', phase: 'choosing', turn: 2 });
    expect(s.seq).toBeGreaterThan(seq + TAKEOVER);
    expect(scores(s)).toEqual({ ana: 50, rui: 0, ze: 300 });
    expect(s.feed.at(-1)).toEqual({ id: 'ana', kind: 'left', text: '' });
    p.leave('rui');
    p.tick();
    p.tick(ISOLATION_GRACE);
    expect(p.game('ze').state).toMatchObject({ phase: 'end' }); // Zé alone: his own final scores
  });
  it("drops a game nobody playing it is left to run, on an onlooker's TV", () => {
    const p = party('Ana', 'Rui', 'Ze');
    p.join('ana', 'rui');
    p.send('ana', p.game('ana').start(p.visitors(), p.now));
    expect(p.game('ze').state).not.toBeNull();
    p.leave('ana');
    p.leave('rui');
    p.tick();
    p.tick(ISOLATION_GRACE);
    expect(p.game('ze').state).toBeNull();
  });
});

describe('accepting states', () => {
  const take = (g: DrawGame, s: DrawState, from = 'x') => g.receive({ k: 'state', s }, from, 0);
  it('takes a later state of the running game, and no older one', () => {
    const g = new DrawGame(() => 'ze', () => 'mine');
    const s = newGame('g5', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }]);
    take(g, { ...s, seq: 4 });
    take(g, { ...s, seq: 3, phase: 'drawing' });
    expect(g.state).toMatchObject({ seq: 4, phase: 'choosing' });
    take(g, { ...s, seq: 5, phase: 'drawing' });
    expect(g.state?.phase).toBe('drawing');
  });
  it('ignores another game while one runs, takes one after the end, and never one that is over', () => {
    const g = new DrawGame(() => 'ze', () => 'mine');
    const a = newGame('g5', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }]);
    take(g, { ...a, turn: 2 });
    take(g, newGame('g9', [{ id: 'rui', name: 'Rui' }, { id: 'ana', name: 'Ana' }]));
    expect(g.state?.id).toBe('g5');
    take(g, { ...a, turn: 2, seq: 9, phase: 'end' });
    take(g, newGame('g9', [{ id: 'rui', name: 'Rui' }, { id: 'ana', name: 'Ana' }]));
    expect(g.state?.id).toBe('g9');
    take(g, { ...a, seq: 99 });
    expect(g.state?.id).toBe('g9');
  });
  it('settles two Starts at once on the earlier game', () => {
    const g = new DrawGame(() => 'ze', () => 'mine');
    take(g, newGame('g7', [{ id: 'rui', name: 'Rui' }, { id: 'ana', name: 'Ana' }]));
    take(g, newGame('g6', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }]));
    expect(g.state?.id).toBe('g6');
    take(g, newGame('g7', [{ id: 'rui', name: 'Rui' }, { id: 'ana', name: 'Ana' }]));
    expect(g.state?.id).toBe('g6');
  });
  it("takes strokes only from this turn's drawer", () => {
    const g = new DrawGame(() => 'ze', () => 'mine');
    take(g, { ...newGame('g5', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }]), phase: 'drawing' });
    g.receive({ k: 'stroke', g: 'g5', t: 1, n: 0, at: 0, c: 0, w: 0, p: [1, 1] }, 'rui', 0);
    g.receive({ k: 'stroke', g: 'g5', t: 2, n: 0, at: 0, c: 0, w: 0, p: [1, 1] }, 'ana', 0);
    expect(g.sketch.strokes).toEqual([]);
    g.receive({ k: 'stroke', g: 'g5', t: 1, n: 0, at: 0, c: 0, w: 0, p: [1, 1] }, 'ana', 0);
    expect(g.sketch.strokes).toHaveLength(1);
  });
});

describe('draw messages', () => {
  const s = newGame('g1', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }]);
  it('takes well-formed messages', () => {
    expect(isDrawMessage({ k: 'join', on: true })).toBe(true);
    expect(isDrawMessage({ k: 'state', s })).toBe(true);
    expect(isDrawMessage({ k: 'guess', g: 'g1', t: 1, text: 'cat' })).toBe(true);
    expect(isDrawMessage({ k: 'stroke', g: 'g1', t: 1, n: 0, at: 4, c: 8, w: 1, p: [0, 1000] })).toBe(true);
    expect(isDrawMessage({ k: 'undo', g: 'g1', t: 1, n: 0 })).toBe(true);
    expect(isDrawMessage({ k: 'clear', g: 'g1', t: 1 })).toBe(true);
    expect(isDrawMessage({ k: 'sketch', g: 'g1', t: 1, strokes: [{ c: 0, w: 0, p: [1, 2] }] })).toBe(true);
  });
  it('drops junk and anything too big', () => {
    expect(isDrawMessage(null)).toBe(false);
    expect(isDrawMessage({ k: 'dance' })).toBe(false);
    expect(isDrawMessage({ k: 'join', on: 1 })).toBe(false);
    expect(isDrawMessage({ k: 'guess', g: 'g1', t: 1, text: 'x'.repeat(41) })).toBe(false);
    expect(isDrawMessage({ k: 'guess', g: 'g1', t: 1, text: '' })).toBe(false);
    expect(isDrawMessage({ k: 'stroke', g: 'g1', t: 1, n: 0, at: 1, c: 0, w: 0, p: [1, 1] })).toBe(false);
    expect(isDrawMessage({ k: 'stroke', g: 'g1', t: 1, n: 300, at: 0, c: 0, w: 0, p: [1, 1] })).toBe(false);
    expect(isDrawMessage({ k: 'sketch', g: 'g1', t: 1, strokes: [{ c: 0, w: 0, p: [] }] })).toBe(false);
    expect(isDrawState({ ...s, phase: 'dancing' })).toBe(false);
    expect(isDrawState({ ...s, word: 'Volcano' })).toBe(false);
    expect(isDrawState({ ...s, left: -1 })).toBe(false);
    expect(isDrawState({ ...s, players: [{ id: 'a', name: 'x'.repeat(25), score: 0, here: true, drew: false }] })).toBe(false);
    expect(isDrawState({ ...s, feed: Array.from({ length: 9 }, () => ({ id: 'a', kind: 'hit', text: '' })) })).toBe(false);
    expect(isDrawState({ ...s, queue: Array.from({ length: 33 }, (_, i) => `p${i}`) })).toBe(false);
  });
});

/** Browsers that can disagree about who is here: `sees[id]` is what each one's presence shows; messages reach only
 * the browsers in `reach[from]` (everyone by default). */
function room(...ids: string[]) {
  let now = 1000;
  let n = 0;
  const g: Record<string, DrawGame> = Object.fromEntries(ids.map((id) => [id, new DrawGame(() => id, () => `g${++n}`, () => 0)]));
  const sees: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, [...ids]]));
  const reach: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, ids.filter((o) => o !== id)]));
  const sent: { from: string; msg: DrawMessage }[] = [];
  const vis = (id: string): Visitor[] => sees[id].map((v) => ({ id: v, name: v, arrived: ids.indexOf(v) + 1, since: ids.indexOf(v) + 1 }));
  const send = (from: string, outs: DrawOut[]) => {
    for (const o of outs) {
      const msg = JSON.parse(JSON.stringify(o.msg)) as DrawMessage;
      expect(isDrawMessage(msg)).toBe(true);
      sent.push({ from, msg });
      for (const id of reach[from]) if (!o.to || o.to === id) send(id, g[id].receive(msg, from, now));
    }
  };
  return {
    g, sees, reach, send, vis, sent,
    get now() { return now; },
    tick(ms = 0) {
      now += ms;
      for (const id of ids) send(id, g[id].update(now, vis(id)));
    },
    /** `id` and the others lose sight and sound of each other, both ways. */
    cut(id: string) {
      reach[id] = [];
      sees[id] = [id];
      for (const o of ids) if (o !== id) { reach[o] = reach[o].filter((v) => v !== id); sees[o] = sees[o].filter((v) => v !== id); }
    },
    /** Everyone sees and hears everyone again, and each greets the others. */
    heal() {
      for (const id of ids) { sees[id] = [...ids]; reach[id] = ids.filter((o) => o !== id); }
      for (const a of ids) for (const b of ids) if (a !== b) send(a, g[a].greet(b));
    },
  };
}

/** Ana, Rui and Zé all joined; Ana owns the game. */
function trio(choose = false) {
  const r = room('ana', 'rui', 'ze');
  for (const id of ['ana', 'rui', 'ze']) r.send(id, r.g[id].setJoined(true));
  r.send('ana', r.g.ana.start(r.vis('ana'), r.now));
  r.tick();
  if (choose) r.send('ana', r.g.ana.choose('cat', r.now));
  return r;
}

describe('browsers that disagree about who is here', () => {
  it('lets a visitor who was cut off for a while come back and take its turn', () => {
    const r = room('ana', 'rui', 'ze');
    r.send('ana', r.g.ana.setJoined(true));
    r.send('rui', r.g.rui.setJoined(true));
    r.send('ana', r.g.ana.start(r.vis('ana'), r.now));
    r.tick();
    expect(r.g.ze.state?.id).toBe('g1');
    r.cut('ze');
    r.tick();
    r.tick(ISOLATION_GRACE);
    expect(r.g.ze.state).toBeNull();
    r.heal();
    expect(r.g.ze.state).toMatchObject({ id: 'g1', owner: 'ana' }); // the greeting is taken
    r.send('ze', r.g.ze.setJoined(true));
    r.tick();
    expect(r.g.ana.state?.queue).toEqual(['rui', 'ze']);
    for (let t = 0; t < 2; t++) { r.tick(15000); r.tick(80000); r.tick(5000); }
    expect(r.g.ana.state).toMatchObject({ phase: 'choosing', owner: 'ze', drawer: 'ze' });
    expect(r.g.ze.state).toMatchObject({ phase: 'choosing', owner: 'ze' });
    r.tick();
    expect(r.g.ze.choices).toHaveLength(3);
    r.tick(15000);
    expect(r.g.ana.state).toMatchObject({ phase: 'drawing', owner: 'ze' });
  });
  it('does not let a cut-off player end the game for the others when it comes back', () => {
    const r = trio(true);
    r.tick(1000);
    r.cut('ze');
    r.tick(1000);
    r.tick(ISOLATION_GRACE);
    expect(r.g.ze.state).toMatchObject({ phase: 'end' }); // its own scores, local
    expect(r.g.ana.state?.phase).toBe('drawing');
    r.heal();
    r.tick();
    for (const id of ['ana', 'rui', 'ze']) expect(r.g[id].state).toMatchObject({ id: 'g1', phase: 'drawing', owner: 'ana' });
  });
  it('keeps the game running when its cut-off owner comes back before the others noticed', () => {
    const r = trio(true);
    r.tick(1000);
    // Ana's view lost Rui and Zé (and nothing she says arrives), theirs still shows her.
    r.sees.ana = ['ana'];
    r.reach.ana = [];
    r.reach.rui = ['ze'];
    r.reach.ze = ['rui'];
    r.tick();
    r.tick(ISOLATION_GRACE);
    expect(r.g.ana.state).toMatchObject({ phase: 'end' });
    expect(r.g.rui.state?.phase).toBe('drawing');
    r.sent.length = 0;
    r.heal();
    expect(r.sent.filter((m) => m.from === 'ana' && m.msg.k === 'state' && m.msg.s.phase === 'end')).toEqual([]);
    expect(r.g.rui.state?.phase).toBe('drawing');
    expect(r.g.ze.state?.phase).toBe('drawing');
    expect(r.g.ana.state).toMatchObject({ phase: 'drawing', owner: 'ana' }); // the running state is hers again
    expect(r.g.ana.canDraw).toBe(true);
  });
  it('keeps the game and its drawing for a newcomer whose visitors have not shown up yet', () => {
    const r = trio(true);
    r.g.ana.penDown(3, 0, 10, 10);
    r.g.ana.penMove(90, 10);
    const mia = new DrawGame(() => 'mia', () => 'm1', () => 0);
    for (const o of r.g.ana.greet('mia')) mia.receive(JSON.parse(JSON.stringify(o.msg)), 'ana', r.now);
    expect(mia.sketch.strokes).toHaveLength(1);
    mia.update(r.now, []);
    mia.update(r.now + 1000, []);
    expect(mia.state).toMatchObject({ id: 'g1', phase: 'drawing' });
    expect(mia.sketch.strokes).toHaveLength(1);
    const all = [{ id: 'ana', name: 'ana', arrived: 1, since: 1 }, { id: 'rui', name: 'rui', arrived: 2, since: 2 }];
    mia.update(r.now + 1500, all);
    mia.update(r.now + 1500 + ISOLATION_GRACE, all);
    expect(mia.state).toMatchObject({ id: 'g1', phase: 'drawing' });
  });
  it('gives a lone survivor, owner or not, its own final scores and sends nothing of them', () => {
    for (const survivor of ['ana', 'rui']) {
      const r = room('ana', 'rui');
      for (const id of ['ana', 'rui']) r.send(id, r.g[id].setJoined(true));
      r.send('ana', r.g.ana.start(r.vis('ana'), r.now));
      r.tick();
      r.cut(survivor === 'ana' ? 'rui' : 'ana');
      r.tick();
      r.sent.length = 0;
      r.tick(ISOLATION_GRACE);
      expect(r.g[survivor].state, survivor).toMatchObject({ phase: 'end' });
      expect(r.g[survivor].running).toBe(false);
      expect(r.g[survivor].greet('mia')).toEqual([{ msg: { k: 'join', on: true }, to: 'mia' }]); // no state
      expect(r.sent.filter((m) => m.from === survivor && m.msg.k === 'state')).toEqual([]);
      r.tick(15000);
      expect(r.g[survivor].state).toBeNull();
    }
  });
  it('replaces a local end with the real state when the others come back', () => {
    const r = trio(true);
    r.cut('ze');
    r.tick();
    r.tick(ISOLATION_GRACE);
    expect(r.g.ze.state?.phase).toBe('end');
    r.heal();
    expect(r.g.ze.state).toMatchObject({ id: 'g1', phase: 'drawing', owner: 'ana' });
    r.tick(); // Ana takes Zé back into the game
    expect(r.g.ze.role()).toBe('guesser');
  });
  it('refuses a late state from the owner a takeover replaced', () => {
    const r = trio();
    const late = r.g.ana.state!;
    r.cut('ana');
    r.tick();
    expect(r.g.rui.state).toMatchObject({ owner: 'rui', drawer: 'rui', turn: 2 });
    r.g.ze.receive({ k: 'state', s: late }, 'ana', r.now);
    r.g.rui.receive({ k: 'state', s: { ...late, seq: late.seq + 1 } }, 'ana', r.now);
    expect(r.g.ze.state).toMatchObject({ owner: 'rui', turn: 2 });
    expect(r.g.rui.state).toMatchObject({ owner: 'rui', turn: 2 });
  });
  it('ignores a guess that arrives after the drawing time', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    const out = p.game('rui').guess('horse');
    expect(p.game('ana').receive(out[0].msg, 'rui', p.now + 80000)).toEqual([]); // Ana's clock is past the deadline
    expect(scores(p.game('ana').state).rui).toBe(0);
  });
});
