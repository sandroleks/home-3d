import { describe, expect, it } from 'vitest';
import { COLUMNS, GoGame, KOMI, parsePoint, pointName } from '../src/go-game';

const game = (...entries: string[]) => {
  const g = new GoGame();
  for (const e of entries) expect(g.play(e), e).toBe(true);
  return g;
};
const at = (g: GoGame, name: string) => g.at(parsePoint(name)!);
/** Black's wall on column E and white's on column F, rows 1 to 9 (black moves first). */
const WALLS = Array.from({ length: 9 }, (_, i) => [`E${i + 1}`, `F${i + 1}`]).flat();
/** A ko in the middle: white's D5 has one liberty, at E5, where black's stone would have one, at D5. */
const KO = ['C5', 'E6', 'D6', 'E4', 'D4', 'F5', 'A9', 'D5'];

describe('GoGame: points and entries', () => {
  it('names points GTP style: columns A to J without I, rows 1 to 9', () => {
    expect(COLUMNS).toBe('ABCDEFGHJ');
    expect([parsePoint('A1'), parsePoint('J1'), parsePoint('A9'), parsePoint('J9'), parsePoint('D4')]).toEqual([0, 8, 72, 80, 30]);
    for (let p = 0; p < 81; p++) expect(parsePoint(pointName(p))).toBe(p);
  });
  it('refuses anything else: I, K, row 0 or 10, lower case, spaces', () => {
    for (const bad of ['I5', 'K1', 'A0', 'A10', 'd4', ' D4', 'D4 ', '', 'Pass', 'PASS', 'resign!', 'D4D4D4D4D']) {
      expect(parsePoint(bad), bad).toBeNull();
      expect(new GoGame().play(bad), bad).toBe(false);
    }
  });
});

describe('GoGame: playing stones', () => {
  it('starts empty, black to move', () => {
    const g = new GoGame();
    expect(g.kind).toBe('go');
    expect(g.turn()).toBe('black');
    expect(g.moves).toEqual([]);
    expect(g.end()).toBeNull();
    expect(g.lastPoint()).toBeNull();
    expect([g.prisoners('black'), g.prisoners('white')]).toEqual([0, 0]);
  });
  it('places a stone on an empty point, and the turn passes', () => {
    const g = game('E5');
    expect(at(g, 'E5')).toBe('black');
    expect(g.turn()).toBe('white');
    expect(g.lastPoint()).toBe(parsePoint('E5'));
    expect(g.stones()).toEqual([{ id: 0, side: 'black', point: parsePoint('E5'), taken: null }]);
  });
  it('refuses a taken point, with nothing changed', () => {
    const g = game('E5');
    expect(g.canPlay(parsePoint('E5')!)).toBe(false);
    expect(g.play('E5')).toBe(false);
    expect(g.moves).toEqual(['E5']);
    expect(g.turn()).toBe('white');
  });
  it('captures a single stone without liberties', () => {
    const g = game('B1', 'A1', 'J9', 'J8', 'A2');
    expect(at(g, 'A1')).toBeNull();
    expect(g.prisoners('black')).toBe(1);
    expect(g.stones()[1]).toEqual({ id: 1, side: 'white', point: parsePoint('A1'), taken: 0 });
  });
  it('captures a whole group at once', () => {
    const g = game('D4', 'D5', 'E4', 'E5', 'D6', 'J9', 'E6', 'J8', 'C5', 'J7', 'F5');
    expect([at(g, 'D5'), at(g, 'E5')]).toEqual([null, null]);
    expect(g.prisoners('black')).toBe(2);
    expect(g.prisoners('white')).toBe(0);
    const taken = g.stones().filter((s) => s.taken !== null);
    expect(taken.map((s) => s.side)).toEqual(['white', 'white']);
    expect(taken.map((s) => s.taken).sort()).toEqual([0, 1]);
  });
  it('refuses suicide, of a single stone or a group', () => {
    const single = game('A2', 'J9', 'B1');
    expect(single.canPlay(parsePoint('A1')!)).toBe(false);
    expect(single.play('A1')).toBe(false);
    const both = game('B1', 'A1', 'B2', 'J9', 'A3');
    expect(both.play('A2')).toBe(false);
    expect(both.turn()).toBe('white');
  });
  it('allows a stone without liberties of its own when it captures', () => {
    const g = game('B2', 'A2', 'A3', 'B1', 'C1', 'J9');
    expect(g.canPlay(parsePoint('A1')!)).toBe(true);
    expect(g.play('A1')).toBe(true);
    expect([at(g, 'A1'), at(g, 'A2'), at(g, 'B1')]).toEqual(['black', null, null]);
    expect(g.prisoners('black')).toBe(2);
  });
});

describe('GoGame: ko', () => {
  it('refuses the immediate retake that would bring back the position', () => {
    const g = game(...KO, 'E5');
    expect(at(g, 'D5')).toBeNull();
    expect(g.prisoners('black')).toBe(1);
    expect(g.canPlay(parsePoint('D5')!)).toBe(false);
    expect(g.play('D5')).toBe(false);
  });
  it('allows the retake once both sides have played elsewhere', () => {
    const g = game(...KO, 'E5', 'A1', 'J9');
    expect(g.play('D5')).toBe(true);
    expect(at(g, 'E5')).toBeNull();
    expect(g.prisoners('white')).toBe(1);
    expect(g.play('E5')).toBe(false); // and now black can't retake at once
  });
});

describe('GoGame: passing and the count', () => {
  it('goes on after one pass, and says who passed', () => {
    const g = game('E5', 'pass');
    expect(g.passed()).toBe('white');
    expect(g.end()).toBeNull();
    expect(g.lastPoint()).toBeNull();
    expect(g.turn()).toBe('black');
    g.play('D4');
    expect(g.passed()).toBeNull();
    expect(g.play('pass')).toBe(true);
    expect(g.end()).toBeNull(); // not two in a row
  });
  it('ends on two passes in a row: an empty board is komi for white', () => {
    const g = game('pass', 'pass');
    expect(g.end()).toEqual({ winner: 'white', reason: 'score' });
    expect(g.passed()).toBe('white');
    expect(g.score()).toEqual({ stones: { black: 0, white: 0 }, area: { black: 0, white: 0 }, komi: KOMI, total: { black: 0, white: 7 } });
    expect(g.resultText()).toBe('White wins by 7');
    expect(g.play('E5')).toBe(false);
  });
  it('counts stones and the empty points only one side surrounds', () => {
    const lone = game('E5', 'pass', 'pass');
    expect(lone.score().total).toEqual({ black: 81, white: 7 });
    expect(lone.resultText()).toBe('Black wins by 74');
    const walls = game(...WALLS, 'pass', 'pass');
    expect(walls.score()).toEqual({ stones: { black: 9, white: 9 }, area: { black: 36, white: 27 }, komi: 7, total: { black: 45, white: 43 } });
    expect(walls.end()).toEqual({ winner: 'black', reason: 'score' });
    expect(walls.resultText()).toBe('Black wins by 2');
  });
  it('counts stones as they stand: a stone left in the other side\'s area spoils it', () => {
    const g = game(...WALLS, 'pass', 'B2', 'pass', 'pass');
    expect(g.score().area).toEqual({ black: 0, white: 27 });
    expect(g.resultText()).toBe('White wins by 35');
  });
  it('leaves points between the two sides to no one, and calls an equal score a draw', () => {
    // Rows 1..7: black on E, white on F; rows 8 and 9: black on D, white on F, E8 and E9 between them
    const rows = Array.from({ length: 9 }, (_, i) => [`${i < 7 ? 'E' : 'D'}${i + 1}`, `F${i + 1}`]).flat();
    const g = game(...rows, 'pass', 'pass');
    expect(g.score()).toEqual({ stones: { black: 9, white: 9 }, area: { black: 34, white: 27 }, komi: 7, total: { black: 43, white: 43 } });
    expect(g.end()).toEqual({ winner: null, reason: 'score' });
    expect(g.resultText()).toBe('Draw: equal score');
  });
  it('does not count prisoners: area scoring', () => {
    const g = game('B1', 'A1', 'J9', 'J8', 'A2', 'pass', 'pass');
    expect(g.prisoners('black')).toBe(1);
    expect(g.score().total.black).toBe(g.score().stones.black + g.score().area.black);
  });
});

describe('GoGame: resigning', () => {
  it('ends with the other side winning, and takes nothing more', () => {
    const g = game('E5', 'resign');
    expect(g.end()).toEqual({ winner: 'black', reason: 'resigned' });
    expect(g.resultText()).toBeNull();
    expect(g.play('D4')).toBe(false);
    expect(g.play('pass')).toBe(false);
    expect(g.canPlay(parsePoint('D4')!)).toBe(false);
    expect(game('resign').end()).toEqual({ winner: 'white', reason: 'resigned' });
  });
});
