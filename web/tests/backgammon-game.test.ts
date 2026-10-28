import { describe, expect, it } from 'vitest';
import { BackgammonGame, BAR, OFF, rollEntry, type StartPosition } from '../src/backgammon-game';

const game = (...entries: string[]) => {
  const g = new BackgammonGame();
  for (const e of entries) expect(g.play(e), e).toBe(true);
  return g;
};
/** A game from a made-up position (tests only), then the entries. */
const from = (start: StartPosition, ...entries: string[]) => {
  const g = new BackgammonGame(start);
  for (const e of entries) expect(g.play(e), e).toBe(true);
  return g;
};
const texts = (g: BackgammonGame) => g.legal().map((m) => m.text).sort();
/** White has made the 7 point with its opening 6-1; black to roll. */
const OPENED = ['r61', '13/7', '8/7'];

describe('BackgammonGame: the start', () => {
  it('sets up both sides the same way, from their own side, white to roll first', () => {
    const g = new BackgammonGame();
    expect(g.kind).toBe('backgammon');
    for (const side of ['white', 'black'] as const) {
      expect([24, 13, 8, 6].map((p) => g.count(side, p))).toEqual([2, 5, 3, 5]);
      expect(g.pips(side)).toBe(167);
    }
    expect(g.phase()).toBe('opening');
    expect(g.turn()).toBe('white');
    expect(g.dice()).toEqual([]);
    expect(g.legal()).toEqual([]);
    expect(g.lastRoll()).toBeNull();
    expect(g.end()).toBeNull();
  });
  it('starts with the higher opening die, which plays both dice', () => {
    const black = game('r35');
    expect(black.lastRoll()).toEqual({ side: null, dice: [3, 5], index: 0 });
    expect(black.turn()).toBe('black');
    expect(black.phase()).toBe('move');
    expect(black.dice()).toEqual([3, 5]);
    const white = game('r53');
    expect(white.turn()).toBe('white');
    expect(white.dice()).toEqual([5, 3]);
  });
  it('rolls the opening again on a tie', () => {
    const g = game('r44');
    expect(g.phase()).toBe('opening');
    expect(g.turn()).toBe('white');
    expect(g.lastRoll()).toEqual({ side: null, dice: [4, 4], index: 0 });
    expect(g.play('r61')).toBe(true);
    expect(g.turn()).toBe('white');
    expect(g.dice()).toEqual([6, 1]);
    expect(g.moves).toEqual(['r44', 'r61']);
  });
});

describe('BackgammonGame: a turn', () => {
  it('moves one die at a time, then passes the turn to roll', () => {
    const g = game('r61', '13/7');
    expect(g.turn()).toBe('white');
    expect(g.dice()).toEqual([1]);
    expect(g.play('8/7')).toBe(true);
    expect(g.turn()).toBe('black');
    expect(g.phase()).toBe('roll');
    expect(g.dice()).toEqual([]);
    expect([g.count('white', 13), g.count('white', 8), g.count('white', 7)]).toEqual([4, 2, 2]);
    expect(g.pips('white')).toBe(160);
  });
  it('counts points from the mover\'s own side, and a point with two of the other side is blocked', () => {
    const g = game(...OPENED, 'r64');
    expect(g.play('24/18')).toBe(false); // black's 18 is white's 7, made
    expect(g.targets(24)).toEqual([20]);
    expect(g.play('24/20')).toBe(true);
    expect(g.play('13/7')).toBe(true);
    expect([g.count('black', 20), g.count('black', 7)]).toEqual([1, 1]);
    expect(g.turn()).toBe('white');
  });
  it('lists where a checker can go, and refuses a die that was not rolled', () => {
    const g = game('r61');
    expect(g.targets(24)).toEqual([18, 23]);
    expect(g.targets(13)).toEqual([7]); // white's 12 is black's 13, made
    expect(g.targets(3)).toEqual([]);
    expect(g.play('13/8')).toBe(false);
    expect(g.play('r61')).toBe(false); // moves first
  });
  it('gives four moves for a double', () => {
    const g = game(...OPENED, 'r33');
    expect(g.dice()).toEqual([3, 3, 3, 3]);
    for (const e of ['24/21', '24/21', '13/10']) expect(g.play(e), e).toBe(true);
    expect(g.turn()).toBe('black');
    expect(g.dice()).toEqual([3]);
    expect(g.play('13/10')).toBe(true);
    expect(g.turn()).toBe('white');
  });
  it('hits a single opposing checker to the bar', () => {
    const g = from({ white: { 13: 15 }, black: { 18: 1, 6: 14 }, turn: 'white' }, 'r61', '13/7');
    expect(g.count('black', BAR)).toBe(1);
    expect(g.count('black', 18)).toBe(0);
    expect(g.count('white', 7)).toBe(1);
    expect(g.legal().find((m) => m.text === '7/6')?.hit).toBe(false);
  });
  it('enters from the bar before anything else, and not onto a blocked point', () => {
    const g = from({ white: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 13: 5 }, black: { bar: 1, 6: 14 }, turn: 'black' }, 'r56');
    expect(texts(g)).toEqual(['bar/19']); // bar/20 is white's 5, made
    expect(g.play('6/1')).toBe(false);
    expect(g.play('bar/19')).toBe(true);
    expect(texts(g)).toEqual(['19/14', '6/1']);
  });
  it('passes the turn at once when the roll has no move', () => {
    const g = from({ white: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 13: 3 }, black: { bar: 1, 6: 14 }, turn: 'black' }, 'r34');
    expect(g.turn()).toBe('white');
    expect(g.phase()).toBe('roll');
    expect(g.blocked()).toBe('black');
    expect(g.lastRoll()).toEqual({ side: 'black', dice: [3, 4], index: 0 });
    expect(g.moves).toEqual(['r34']);
    g.play('r21');
    expect(g.blocked()).toBeNull();
  });
});

describe('BackgammonGame: using the dice', () => {
  it('must use both dice when it can', () => {
    // 3/1 is a move on its own, but after it the 6 can't be played (white's 6 is made); 12/10 then 10/4 uses both
    const g = from({ white: { 12: 1, 3: 1, 1: 13 }, black: { 19: 2, 6: 13 }, turn: 'white' }, 'r62');
    expect(texts(g)).toEqual(['12/10']);
    expect(g.play('3/1')).toBe(false);
    expect(g.play('12/10')).toBe(true);
    expect(texts(g)).toEqual(['10/4']);
  });
  it('must use the larger die when only one of them can be used', () => {
    // 12/6 or 12/8, and either blocks the other die (white's 2 is made)
    const g = from({ white: { 12: 1, 1: 14 }, black: { 23: 2, 6: 13 }, turn: 'white' }, 'r46');
    expect(texts(g)).toEqual(['12/6']);
    expect(g.play('12/8')).toBe(false);
    expect(g.play('12/6')).toBe(true);
    expect(g.turn()).toBe('black'); // the 4 has no move: the turn passes
    expect(g.blocked()).toBeNull(); // it moved
  });
});

describe('BackgammonGame: bearing off', () => {
  it('bears off only once all 15 are home', () => {
    const g = from({ white: { 7: 1, 3: 14 }, black: { 6: 15 }, turn: 'white' }, 'r34');
    expect(texts(g)).toEqual(['7/3', '7/4']);
    expect(g.play('7/4')).toBe(true);
    expect(texts(g)).toEqual(['4/off']);
    expect(g.play('4/off')).toBe(true);
    expect(g.count('white', OFF)).toBe(1);
  });
  it('bears off with the exact die, or a higher one from the furthest point only', () => {
    const exact = from({ white: { 6: 1, 5: 2, 2: 1 }, black: { 6: 15 }, turn: 'white' }, 'r63');
    expect(texts(exact)).toEqual(['5/2', '6/3', '6/off']);
    const higher = from({ white: { 4: 1, 2: 1 }, black: { 6: 15 }, turn: 'white' }, 'r65');
    expect(texts(higher)).toEqual(['4/off']); // either die; the 2 is not the furthest
    expect(higher.play('4/off')).toBe(true);
    expect(higher.dice()).toEqual([6]); // the lower die went
    expect(texts(higher)).toEqual(['2/off']);
  });
  it('lets the last checker off with one die, the other to spare', () => {
    const g = from({ white: { 2: 1 }, black: { 6: 15 }, turn: 'white' }, 'r21');
    expect(texts(g)).toEqual(['2/1', '2/off']);
    expect(g.play('2/off')).toBe(true);
    expect(g.end()).toEqual({ winner: 'white', reason: 'gammon' });
  });
});

describe('BackgammonGame: the end', () => {
  const last = (black: StartPosition['black']) => from({ white: { 1: 1 }, black, turn: 'white' }, 'r21', '1/off');
  it('is a single game when the loser has borne off a checker', () => {
    const g = last({ 6: 14 });
    expect(g.end()).toEqual({ winner: 'white', reason: 'single' });
    expect(g.legal()).toEqual([]);
    expect(g.play('r11')).toBe(false);
  });
  it('is a gammon when the loser has borne off none', () => {
    expect(last({ 6: 15 }).end()).toEqual({ winner: 'white', reason: 'gammon' });
  });
  it("is a backgammon when the loser still has a checker on the bar or in the winner's home board", () => {
    expect(last({ bar: 1, 6: 14 }).end()).toEqual({ winner: 'white', reason: 'backgammon' });
    expect(last({ 20: 1, 6: 14 }).end()).toEqual({ winner: 'white', reason: 'backgammon' }); // black's 20 is white's 5
  });
  it('resigns for the side to move, even before the opening roll', () => {
    expect(game(...OPENED, 'resign').end()).toEqual({ winner: 'white', reason: 'resigned' });
    expect(game('resign').end()).toEqual({ winner: 'black', reason: 'resigned' });
  });
});

describe('BackgammonGame: entries', () => {
  it('refuses malformed entries and anything over 8 characters, changing nothing', () => {
    const g = new BackgammonGame();
    for (const e of ['', 'r7', 'r06', 'r3', 'r356', 'R35', 'r35 ', 'r35r35r35', '24/18']) expect(g.play(e), e).toBe(false);
    expect(g.play('r61')).toBe(true);
    for (const e of ['13-7', '13/7/6', '013/7', '13/07', '25/19', 'bar/18', '13/off', 'off/13', '13/7     ', 'r61']) {
      expect(g.play(e), e).toBe(false);
    }
    expect(g.moves).toEqual(['r61']);
    expect(g.dice()).toEqual([6, 1]);
  });
  it('writes every entry in at most 8 characters', () => {
    const g = from({ white: { bar: 1, 6: 14 }, black: { 6: 15 }, turn: 'white' }, 'r33');
    for (const m of g.legal()) expect(m.text.length).toBeLessThanOrEqual(8);
    expect(g.legal().map((m) => m.text)).toEqual(['bar/22']);
  });
  it('replays to the same position', () => {
    const a = game(...OPENED, 'r64', '24/20', '13/7', 'r55', '13/8', '13/8');
    const b = game(...a.moves);
    expect(b.checkers()).toEqual(a.checkers());
    expect(b.turn()).toBe(a.turn());
    expect(b.dice()).toEqual(a.dice());
  });
  it('makes rolls from the random numbers it is given', () => {
    expect(rollEntry(() => 0)).toBe('r11');
    expect(rollEntry(() => 0.9999)).toBe('r66');
    const values = [0.2, 0.7];
    expect(rollEntry(() => values.shift()!)).toBe('r25');
  });
});

describe('BackgammonGame: the checkers', () => {
  it('follows each checker: the top of a stack moves, a hit one goes to the bar', () => {
    const start = new BackgammonGame().checkers();
    expect(start).toHaveLength(30);
    expect(start.filter((c) => c.side === 'white' && c.at === 13).map((c) => [c.id, c.height])).toEqual([[8, 0], [9, 1], [10, 2], [11, 3], [12, 4]]);
    const g = game(...OPENED);
    expect(g.checkers()[12]).toEqual({ id: 12, side: 'white', at: 7, height: 0 });
    expect(g.checkers()[7]).toEqual({ id: 7, side: 'white', at: 7, height: 1 });
    const hit = from({ white: { 13: 15 }, black: { 18: 1, 6: 14 }, turn: 'white' }, 'r61', '13/7');
    expect(hit.checkers().filter((c) => c.side === 'black' && c.at === BAR)).toEqual([{ id: 29, side: 'black', at: BAR, height: 0 }]);
  });
});
