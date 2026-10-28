import { describe, expect, it } from 'vitest';
import {
  endOf, endText, gameChairs, type GameMessage, Games, isGameMessage, leftEnd, replay, RULES, seatedAt, slotOf, type SlotSeats, SLOTS,
} from '../src/games';
import type { Seat } from '../src/seats';

describe('endText', () => {
  it('names the winner and why', () => {
    expect(endText({ winner: 'white', reason: 'checkmate' })).toBe('White wins: checkmate');
    expect(endText({ winner: 'black', reason: 'left' })).toBe('Black wins: White left the table');
    expect(endText({ winner: 'white', reason: 'resigned' })).toBe('White wins: Black resigned');
    expect(endText({ winner: null, reason: 'left' })).toBe('Game over: both players left the table');
  });
  it('names the draws', () => {
    expect(endText({ winner: null, reason: 'stalemate' })).toBe('Draw: stalemate');
    expect(endText({ winner: null, reason: 'repetition' })).toBe('Draw: threefold repetition');
    expect(endText({ winner: null, reason: 'fifty' })).toBe('Draw: 50-move rule');
    expect(endText({ winner: null, reason: 'material' })).toBe('Draw: insufficient material');
    expect(endText({ winner: null, reason: 'agreement' })).toBe('Draw: agreed');
  });
  it("names backgammon's three wins", () => {
    expect(endText({ winner: 'white', reason: 'single' })).toBe('White wins: single game');
    expect(endText({ winner: 'black', reason: 'gammon' })).toBe('Black wins: gammon');
    expect(endText({ winner: 'white', reason: 'backgammon' })).toBe('White wins: backgammon');
  });
  it("names Go's count, a win or an equal score", () => {
    expect(endText({ winner: 'black', reason: 'score' })).toBe('Black wins: on points');
    expect(endText({ winner: null, reason: 'score' })).toBe('Draw: equal score');
  });
});

const chair = (name: string, x: number, z: number): Seat => ({
  name, pose: 'sit', min: [x - 0.2, 0, z - 0.3], max: [x + 0.2, 0.97, z + 0.3], spots: [{ at: [x, 0.45, z], yaw: 0 }],
});
const SEATS: Seat[] = [
  chair('Dining chair N0', 1.2517, 2.5143), chair('Dining chair S0', 1.2483, 3.8857),
  chair('Dining chair N1', 1.8017, 2.5143), chair('Dining chair S1', 1.7983, 3.8857),
  chair('Sala desk chair', 0.9178, 8.2291),
];

describe('the chairs', () => {
  it('knows which slot plays which game', () => {
    expect([slotOf('chess'), slotOf('backgammon'), slotOf('go')]).toEqual([0, 1, 2]);
  });
  it('finds the game chairs: S plays white, N black', () => {
    expect(gameChairs(SEATS)).toEqual([
      { slot: 0, side: 'black', x: 1.2517, z: 2.5143 }, { slot: 0, side: 'white', x: 1.2483, z: 3.8857 },
      { slot: 1, side: 'black', x: 1.8017, z: 2.5143 }, { slot: 1, side: 'white', x: 1.7983, z: 3.8857 },
    ]);
  });
  it('seats a visitor on the chair whose spot they sit on, to the mm a pose is sent with', () => {
    const seats = seatedAt(gameChairs(SEATS), [{ id: 'ana', x: 1.248, z: 3.886 }, { id: 'rui', x: 1.8017, z: 2.5143 }, { id: 'ze', x: 0.92, z: 8.23 }]);
    expect(seats).toEqual([{ white: 'ana', black: null }, { white: null, black: 'rui' }, { white: null, black: null }]);
  });
  it('gives a chair two sat on at once to the lower id', () => {
    const seats = seatedAt(gameChairs(SEATS), [{ id: 'zz', x: 1.2483, z: 3.8857 }, { id: 'aa', x: 1.2483, z: 3.8857 }]);
    expect(seats[0].white).toBe('aa');
  });
});

describe('game messages', () => {
  const ok: GameMessage = { slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'] };
  it('takes a well-formed game, with or without an end', () => {
    expect(isGameMessage(ok)).toBe(true);
    expect(isGameMessage({ ...ok, end: { winner: 'black', reason: 'left' } })).toBe(true);
    expect(isGameMessage({ ...ok, end: { winner: null, reason: 'agreement' } })).toBe(true);
    expect(isGameMessage({ ...ok, end: { winner: 'black', reason: 'backgammon' } })).toBe(true);
    expect(isGameMessage({ ...ok, end: { winner: null, reason: 'score' } })).toBe(true);
  });
  it('drops junk', () => {
    expect(isGameMessage(null)).toBe(false);
    expect(isGameMessage('game')).toBe(false);
    expect(isGameMessage({ ...ok, slot: 3 })).toBe(false);
    expect(isGameMessage({ ...ok, slot: 0.5 })).toBe(false);
    expect(isGameMessage({ ...ok, id: '' })).toBe(false);
    expect(isGameMessage({ ...ok, black: 'ana' })).toBe(false);
    expect(isGameMessage({ ...ok, moves: 'e2e4' })).toBe(false);
    expect(isGameMessage({ ...ok, moves: [1] })).toBe(false);
    expect(isGameMessage({ ...ok, moves: ['x'.repeat(9)] })).toBe(false);
    expect(isGameMessage({ ...ok, end: { winner: 'grey', reason: 'left' } })).toBe(false);
    expect(isGameMessage({ ...ok, end: { winner: null, reason: 'boredom' } })).toBe(false);
  });
  it('replays a list of moves, or not when one is illegal or the kind has no rules yet', () => {
    expect(replay('chess', ['e2e4', 'e7e5'])?.moves).toEqual(['e2e4', 'e7e5']);
    expect(replay('chess', ['e2e4', 'e2e4'])).toBeNull();
    expect(replay('backgammon', ['r35', '24/21'])?.moves).toEqual(['r35', '24/21']);
    expect(replay('backgammon', ['r35', '24/18'])).toBeNull(); // no 6 was rolled
    expect(replay('go', ['E5', 'D4', 'pass'])?.moves).toEqual(['E5', 'D4', 'pass']);
    expect(replay('go', ['E5', 'E5'])).toBeNull(); // a taken point
    expect(replay('go', [], { chess: RULES.chess })).toBeNull(); // no rules for the kind
  });
  it('ends a game when a player is out of their chair', () => {
    expect(leftEnd(true, true)).toBeNull();
    expect(leftEnd(true, false)).toEqual({ winner: 'white', reason: 'left' });
    expect(leftEnd(false, true)).toEqual({ winner: 'black', reason: 'left' });
    expect(leftEnd(false, false)).toEqual({ winner: null, reason: 'left' });
  });
});

/** Slot 0's chairs, the others empty. */
const at0 = (white: string | null, black: string | null): SlotSeats[] =>
  SLOTS.map((_, i) => (i === 0 ? { white, black } : { white: null, black: null }));

function setup(self: string) {
  let n = 0;
  return new Games(() => self, () => `g${++n}`);
}

describe('Games', () => {
  it('only slots with rules are playable', () => {
    const g = setup('ana');
    expect([0, 1, 2].map((s) => g.playable(s))).toEqual([true, true, true]);
    const chessOnly = new Games(() => 'rui', () => 'g1', { chess: RULES.chess });
    expect([0, 1, 2].map((s) => chessOnly.playable(s))).toEqual([true, false, false]);
    chessOnly.update(SLOTS.map(() => ({ white: 'ana', black: 'rui' })), 0);
    expect(chessOnly.receive({ slot: 2, id: 'g6', white: 'ana', black: 'rui', moves: [] })).toBe(false); // no rules there
  });
  it("opens a game in the white player's browser once both chairs are taken", () => {
    const g = setup('ana');
    expect(g.update(at0('ana', null), 0)).toEqual([]);
    expect(g.at(0)).toBeNull();
    expect(g.seatOf('ana')).toEqual({ slot: 0, side: 'white' });
    expect(g.update(at0('ana', 'rui'), 1)).toEqual([{ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: [] }]);
    expect(g.update(at0('ana', 'rui'), 2)).toEqual([]); // once
    expect(g.at(0)?.rules.turn()).toBe('white');
  });
  it("plays backgammon at slot 1, white's browser rolling the opening", () => {
    const at1 = (white: string | null, black: string | null): SlotSeats[] =>
      SLOTS.map((_, i) => (i === 1 ? { white, black } : { white: null, black: null }));
    const ana = setup('ana');
    const rui = setup('rui');
    const [g1] = ana.update(at1('ana', 'rui'), 0);
    expect(g1).toEqual({ slot: 1, id: 'g1', white: 'ana', black: 'rui', moves: [] });
    expect(ana.at(1)?.rules.kind).toBe('backgammon');
    rui.update(at1('ana', 'rui'), 0);
    expect(rui.receive(g1)).toBe(true);
    expect(rui.play(1, 'r35')).toBeNull(); // the opening roll is white's to make
    const opened = ana.play(1, 'r35')!;
    expect(rui.receive(opened)).toBe(true);
    expect(rui.play(1, '24/21')?.moves).toEqual(['r35', '24/21']); // black's 5 beat white's 3
  });

  it('plays Go at slot 2, opened by white and started by black', () => {
    const at2 = (white: string | null, black: string | null): SlotSeats[] =>
      SLOTS.map((_, i) => (i === 2 ? { white, black } : { white: null, black: null }));
    const ana = setup('ana');
    const rui = setup('rui');
    const [g1] = ana.update(at2('ana', 'rui'), 0);
    expect(g1).toEqual({ slot: 2, id: 'g1', white: 'ana', black: 'rui', moves: [] });
    expect(ana.at(2)?.rules.kind).toBe('go');
    rui.update(at2('ana', 'rui'), 0);
    expect(rui.receive(g1)).toBe(true);
    expect(ana.play(2, 'E5')).toBeNull(); // black moves first
    const first = rui.play(2, 'E5')!;
    expect(ana.receive(first)).toBe(true);
    const passed = ana.play(2, 'pass')!;
    expect(rui.receive(passed)).toBe(true);
    const ended = rui.play(2, 'pass')!;
    expect(ended.end).toEqual({ winner: 'black', reason: 'score' });
    expect(ana.receive(ended)).toBe(true);
    expect(endOf(ana.at(2)!)).toEqual({ winner: 'black', reason: 'score' });
    expect(ana.at(2)?.rules.resultText?.()).toBe('Black wins by 74');
  });

  it("leaves opening to the white player's browser", () => {
    const g = setup('rui');
    expect(g.update(at0('ana', 'rui'), 0)).toEqual([]);
    expect(g.seatOf('rui')).toEqual({ slot: 0, side: 'black' });
  });
  it('lets only the seated player to move add entries', () => {
    const ana = setup('ana');
    ana.update(at0('ana', 'rui'), 0);
    const v = ana.version;
    expect(ana.play(0, 'e7e5')).toBeNull(); // illegal
    expect(ana.play(0, 'e2e4')).toEqual({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'] });
    expect(ana.version).toBeGreaterThan(v);
    expect(ana.play(0, 'e7e5')).toBeNull(); // rui's turn
    expect(ana.play(1, 'e2e4')).toBeNull(); // no game there
  });
  it('ends the game the same way everywhere when a player leaves their chair', () => {
    const ana = setup('ana');
    ana.update(at0('ana', 'rui'), 0);
    ana.play(0, 'e2e4');
    ana.update(at0('ana', null), 1);
    expect(endOf(ana.at(0)!)).toEqual({ winner: 'white', reason: 'left' });
    expect(ana.play(0, 'd2d4')).toBeNull();
    expect(ana.message(0)?.end).toEqual({ winner: 'white', reason: 'left' });
    ana.update(at0('ana', 'rui'), 2); // rui is back: the ended game stays, a new one opens
    expect(ana.at(0)?.id).toBe('g2');
  });
  it('waits for an empty chair before opening another game for the same two', () => {
    const ana = setup('ana');
    ana.update(at0('ana', 'rui'), 0);
    ana.play(0, 'resign');
    expect(endOf(ana.at(0)!)).toEqual({ winner: 'black', reason: 'resigned' });
    expect(ana.update(at0('ana', 'rui'), 1)).toEqual([]); // the result stays on the table
    ana.update(at0('ana', null), 2);
    expect(ana.update(at0('ana', 'rui'), 3).map((m) => m.id)).toEqual(['g2']);
  });
  it('takes a new game for the two it sees seated, then moves that extend it', () => {
    const rui = setup('rui');
    rui.update(at0('ana', 'rui'), 0);
    expect(rui.receive({ slot: 0, id: 'g9', white: 'ana', black: 'rui', moves: [] })).toBe(true);
    expect(rui.receive({ slot: 0, id: 'g9', white: 'ana', black: 'rui', moves: ['e2e4'] })).toBe(true);
    expect(rui.at(0)?.rules.moves).toEqual(['e2e4']);
    expect(rui.play(0, 'e7e5')?.moves).toEqual(['e2e4', 'e7e5']);
  });
  it('ignores what does not extend its game, replays illegally, or names others', () => {
    const rui = setup('rui');
    rui.update(at0('ana', 'rui'), 0);
    rui.receive({ slot: 0, id: 'g9', white: 'ana', black: 'rui', moves: ['e2e4'] });
    expect(rui.receive({ slot: 0, id: 'g9', white: 'ana', black: 'rui', moves: ['e2e4'] })).toBe(false); // nothing new
    expect(rui.receive({ slot: 0, id: 'g9', white: 'ana', black: 'rui', moves: ['d2d4', 'e7e5'] })).toBe(false); // another line
    expect(rui.receive({ slot: 0, id: 'g9', white: 'ana', black: 'rui', moves: ['e2e4', 'e2e4'] })).toBe(false); // illegal
    expect(rui.receive({ slot: 0, id: 'g8', white: 'ana', black: 'rui', moves: [] })).toBe(false); // one is running
    expect(rui.receive({ slot: 0, id: 'g7', white: 'ze', black: 'rui', moves: [] })).toBe(false); // ze isn't seated
    expect(rui.receive({ slot: 2, id: 'g6', white: 'ana', black: 'rui', moves: [] })).toBe(false); // not in those chairs
    expect(rui.at(0)?.id).toBe('g9');
    expect(rui.at(0)?.rules.moves).toEqual(['e2e4']);
  });
  it('holds a game whose players it has not seen sit yet, for a few seconds', () => {
    const ze = setup('ze');
    ze.update(at0('ana', null), 0);
    expect(ze.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'] })).toBe(false);
    ze.update(at0('ana', 'rui'), 1); // rui's pose arrives
    expect(ze.at(0)?.rules.moves).toEqual(['e2e4']);
    const late = setup('ze');
    late.update(at0('ana', null), 0);
    late.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: [] });
    late.update(at0('ana', null), 6);
    late.update(at0('ana', 'rui'), 7); // too late: dropped
    expect(late.at(0)).toBeNull();
  });
  it("shows a newcomer a finished game, and sends every slot's game", () => {
    const ze = setup('ze');
    ze.update(at0(null, null), 0);
    expect(ze.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'], end: { winner: 'white', reason: 'left' } })).toBe(true);
    expect(endOf(ze.at(0)!)).toEqual({ winner: 'white', reason: 'left' });
    expect(ze.messages()).toEqual([{ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'], end: { winner: 'white', reason: 'left' } }]);
  });
  it('takes no more moves for a game that ended by its rules', () => {
    const ze = setup('ze');
    ze.update(at0('ana', 'rui'), 0);
    ze.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['resign'] });
    expect(ze.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['resign', 'e2e4'] })).toBe(false);
  });
  it('takes a move that was on its way when a player left, and its checkmate', () => {
    const mate = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    const ana = setup('ana');
    const rui = setup('rui');
    const ze = setup('ze');
    const g1 = ana.update(at0('ana', 'rui'), 0)[0];
    for (const b of [rui, ze]) {
      b.update(at0('ana', 'rui'), 0);
      b.receive(g1);
    }
    for (const e of mate.slice(0, 3)) {
      const m = (e === 'e7e5' ? rui : ana).play(0, e)!;
      for (const b of [ana, rui, ze]) b.receive(m);
    }
    const last = rui.play(0, 'd8h4')!; // rui mates and stands up before it arrives
    rui.update(at0('ana', null), 1);
    for (const b of [ana, ze]) {
      b.update(at0('ana', null), 1);
      expect(endOf(b.at(0)!)).toEqual({ winner: 'white', reason: 'left' });
      expect(b.receive(last)).toBe(true);
    }
    for (const b of [ana, rui, ze]) {
      expect(b.at(0)?.rules.moves).toEqual(mate);
      expect(endOf(b.at(0)!)).toEqual({ winner: 'black', reason: 'checkmate' });
    }
  });
});

describe('Games: a player who timed out', () => {
  it("sends its own game once when a player leaves it, but not someone else's", () => {
    const ana = setup('ana');
    ana.update(at0('ana', 'rui'), 0);
    ana.play(0, 'e2e4');
    expect(ana.update(at0('ana', null), 1)).toEqual([
      { slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'], end: { winner: 'white', reason: 'left' } },
    ]);
    expect(ana.update(at0('ana', null), 2)).toEqual([]); // once
    const ze = setup('ze');
    ze.update(at0('ana', 'rui'), 0);
    ze.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: [] });
    expect(ze.update(at0('ana', null), 1)).toEqual([]);
    expect(endOf(ze.at(0)!)).toEqual({ winner: 'white', reason: 'left' });
  });
  it('learns its game ended by a leave from a copy with the same moves', () => {
    const rui = setup('rui');
    rui.update(at0('ana', 'rui'), 0);
    rui.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'] });
    const g1 = { slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'] };
    expect(rui.receive({ ...g1, end: { winner: 'white', reason: 'resigned' } })).toBe(false); // rules' ends come from the moves
    expect(endOf(rui.at(0)!)).toBeNull();
    expect(rui.receive({ ...g1, end: { winner: 'white', reason: 'left' } })).toBe(true);
    expect(endOf(rui.at(0)!)).toEqual({ winner: 'white', reason: 'left' });
    expect(rui.receive({ ...g1, end: { winner: 'black', reason: 'left' } })).toBe(false); // it has its end
    expect(rui.play(0, 'e7e5')).toBeNull();
  });
  it('ends its own game when it comes back after the others dropped it, then takes the new one', () => {
    const ana = setup('ana');
    const rui = setup('rui');
    const g1 = ana.update(at0('ana', 'rui'), 0)[0];
    rui.update(at0('ana', 'rui'), 0);
    rui.receive(g1);
    // rui's phone is locked: ana's browser drops rui, ends g1, and opens g2 when rui is back in the chair
    ana.update(at0('ana', null), 20);
    const [g2] = ana.update(at0('ana', 'rui'), 30);
    expect(g2.id).toBe('g2');
    expect(rui.update(at0('ana', 'rui'), 30)).toEqual([{ ...g1, end: { winner: 'white', reason: 'left' } }]);
    expect(rui.receive(g2)).toBe(true);
    expect(rui.at(0)?.id).toBe('g2');
    expect(rui.play(0, 'e7e5')).toBeNull(); // white's move
    expect(rui.receive({ ...g2, moves: ['e2e4'] })).toBe(true);
  });
  it('takes the new game held from before its first frame back', () => {
    const ana = setup('ana');
    const rui = setup('rui');
    const g1 = ana.update(at0('ana', 'rui'), 0)[0];
    rui.update(at0('ana', 'rui'), 0);
    rui.receive(g1);
    ana.update(at0('ana', null), 20);
    const [g2] = ana.update(at0('ana', 'rui'), 30);
    expect(rui.receive(g2)).toBe(false); // g1 still runs here: held
    rui.update(at0('ana', 'rui'), 30);
    expect(rui.at(0)?.id).toBe('g2');
  });
  it('opens the next game itself when it was the white player who timed out', () => {
    const ana = setup('ana');
    ana.update(at0('ana', 'rui'), 0);
    const sent = ana.update(at0('ana', 'rui'), 20);
    expect(sent.map((m) => [m.id, m.end])).toEqual([['g1', { winner: 'black', reason: 'left' }], ['g2', undefined]]);
  });
});

describe('Games: held games', () => {
  /** rui's browser: g0 played out (resigned), then g1 running. */
  function afterTwo() {
    const rui = setup('rui');
    rui.update(at0('ana', 'rui'), 0);
    rui.receive({ slot: 0, id: 'g0', white: 'ana', black: 'rui', moves: [] });
    rui.receive({ slot: 0, id: 'g0', white: 'ana', black: 'rui', moves: ['resign'] });
    rui.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: [] });
    return rui;
  }
  it('never goes back to a game it has shown in the slot', () => {
    const rui = afterTwo();
    expect(rui.at(0)?.id).toBe('g1');
    expect(rui.receive({ slot: 0, id: 'g0', white: 'ana', black: 'rui', moves: [] })).toBe(false); // a late copy
    rui.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'] });
    rui.play(0, 'resign');
    rui.update(at0('ana', 'rui'), 1);
    expect(rui.at(0)?.id).toBe('g1');
  });
  it('drops a held game once a game for the slot is taken', () => {
    const rui = setup('rui');
    rui.update(at0('ana', 'rui'), 0);
    rui.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: [] });
    expect(rui.receive({ slot: 0, id: 'gx', white: 'ana', black: 'rui', moves: [] })).toBe(false); // held
    rui.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'] });
    rui.play(0, 'resign');
    rui.update(at0('ana', 'rui'), 1);
    expect(rui.at(0)?.id).toBe('g1');
  });
  it('takes a held game when it can, even on a frame after it would have lapsed', () => {
    const ze = setup('ze');
    ze.update(at0('ana', null), 0);
    ze.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: [] });
    ze.update(at0('ana', 'rui'), 6);
    expect(ze.at(0)?.id).toBe('g1');
  });
  it("keeps only a leave from an adopted game's end", () => {
    const ze = setup('ze');
    ze.update(at0(null, null), 0);
    ze.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'], end: { winner: 'white', reason: 'agreement' } });
    expect(ze.at(0)?.left).toBeNull();
    ze.update(at0('ana', 'rui'), 1); // not ended: the seated players' game runs on
    expect(endOf(ze.at(0)!)).toBeNull();
  });
});
