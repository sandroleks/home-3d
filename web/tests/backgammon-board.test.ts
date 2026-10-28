import { describe, expect, it } from 'vitest';
import { backgammonInfo, BOARD_W, canRoll, pointCell } from '../src/backgammon-board';
import { BackgammonGame } from '../src/backgammon-game';
import type { BoardView } from '../src/board-panel';
import { ChessGame } from '../src/chess-game';

const game = (...entries: string[]) => {
  const g = new BackgammonGame();
  for (const e of entries) expect(g.play(e), e).toBe(true);
  return g;
};
const view = (over: Partial<BoardView> = {}): BoardView => ({ game: null, you: 'white', live: false, end: null, ...over });

describe('the backgammon board in the panel', () => {
  it("puts white's home board at the bottom right, its points running round to the top right", () => {
    expect(pointCell(1, 'white')).toEqual({ x: 12, top: false });
    expect(pointCell(6, 'white')).toEqual({ x: 7, top: false });
    expect(pointCell(7, 'white')).toEqual({ x: 5, top: false });
    expect(pointCell(12, 'white')).toEqual({ x: 0, top: false });
    expect(pointCell(13, 'white')).toEqual({ x: 0, top: true });
    expect(pointCell(24, 'white')).toEqual({ x: 12, top: true });
  });
  it('shows black the same board turned round, as it sits across the table', () => {
    for (let p = 1; p <= 24; p++) {
      const w = pointCell(p, 'white');
      expect(pointCell(25 - p, 'black')).toEqual({ x: BOARD_W - 1 - w.x, top: !w.top }); // the same point, black's number
    }
    const home = pointCell(1, 'black'); // black's home board: bottom left, by the tray
    expect(home.x).toBeCloseTo(1.2);
    expect(home.top).toBe(false);
  });
  it('gives every point its own column', () => {
    for (const you of ['white', 'black'] as const) {
      const cells = new Set(Array.from({ length: 24 }, (_, i) => JSON.stringify(pointCell(i + 1, you))));
      expect(cells.size).toBe(24);
    }
  });
  it('rolls only on your turn, before moving', () => {
    expect(canRoll(view({ game: new BackgammonGame(), live: true }))).toBe(true);
    expect(canRoll(view({ game: new BackgammonGame() }))).toBe(false);
    expect(canRoll(view({ game: game('r61'), live: true }))).toBe(false); // moving now
    expect(canRoll(view({ game: game('r61', '13/7', '8/7'), you: 'black', live: true }))).toBe(true);
    expect(canRoll(view({ game: new ChessGame(), live: true }))).toBe(false);
  });
  it('explains the opening roll, a tie and who starts, then shows the pip counts', () => {
    expect(backgammonInfo(view({ game: new BackgammonGame() }))).toBe('Opening roll: one die each, the higher starts');
    expect(backgammonInfo(view({ game: game('r44') }))).toBe('Both rolled 4: roll again');
    expect(backgammonInfo(view({ game: game('r35') }))).toBe('White 3, Black 5: Black starts');
    expect(backgammonInfo(view({ game: game('r35', '24/21') }))).toBe('Pips: White 167 · Black 164');
    expect(backgammonInfo(view())).toBe('');
  });
  it('says when a roll had no move', () => {
    const g = new BackgammonGame({ white: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 13: 3 }, black: { bar: 1, 6: 14 }, turn: 'black' });
    expect(g.play('r34')).toBe(true);
    expect(backgammonInfo(view({ game: g }))).toBe("Black can't move. Pips: White 81 · Black 109");
  });
});
