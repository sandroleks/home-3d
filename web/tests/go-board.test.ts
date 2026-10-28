import { describe, expect, it } from 'vitest';
import type { BoardView } from '../src/board-panel';
import { ChessGame } from '../src/chess-game';
import { canPass, goInfo, pointCell } from '../src/go-board';
import { GoGame, parsePoint } from '../src/go-game';

const game = (...entries: string[]) => {
  const g = new GoGame();
  for (const e of entries) expect(g.play(e), e).toBe(true);
  return g;
};
const view = (over: Partial<BoardView> = {}): BoardView => ({ game: null, you: 'black', live: false, end: null, ...over });

describe('the Go board in the panel', () => {
  it('puts your own side at the bottom: white sees A1 bottom left, black sees the board turned round', () => {
    expect(pointCell(parsePoint('A1')!, 'white')).toEqual([0, 8]);
    expect(pointCell(parsePoint('J9')!, 'white')).toEqual([8, 0]);
    expect(pointCell(parsePoint('A1')!, 'black')).toEqual([8, 0]);
    expect(pointCell(parsePoint('E5')!, 'black')).toEqual([4, 4]);
    expect(pointCell(parsePoint('C3')!, 'black')).toEqual([6, 2]);
  });
  it('lets you pass on your move only', () => {
    expect(canPass(view({ game: new GoGame(), live: true }))).toBe(true);
    expect(canPass(view({ game: new GoGame() }))).toBe(false);
    expect(canPass(view({ live: true }))).toBe(false);
    expect(canPass(view({ game: new ChessGame(), live: true }))).toBe(false);
  });
  it('shows the prisoners, and who just passed', () => {
    expect(goInfo(view())).toBe('');
    expect(goInfo(view({ game: new GoGame() }))).toBe('Prisoners: Black 0 · White 0');
    const g = game('B1', 'A1', 'J9', 'J8', 'A2', 'pass');
    expect(goInfo(view({ game: g }))).toBe('White passed. Prisoners: Black 1 · White 0');
    g.play('E5');
    expect(goInfo(view({ game: g }))).toBe('Prisoners: Black 1 · White 0');
  });
  it('shows the count once two passes end the game, and only the prisoners after any other end', () => {
    const g = game('E5', 'pass', 'pass');
    expect(goInfo(view({ game: g, end: g.end() }))).toBe('Black: stones 1 + area 80 = 81 · White: stones 0 + area 0 + komi 7 = 7');
    const left = game('E5', 'pass');
    expect(goInfo(view({ game: left, end: { winner: 'black', reason: 'left' } }))).toBe('Prisoners: Black 0 · White 0');
    const resigned = game('E5', 'resign');
    expect(goInfo(view({ game: resigned, end: resigned.end() }))).toBe('Prisoners: Black 0 · White 0');
  });
});
