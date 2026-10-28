import { describe, expect, it } from 'vitest';
import { panelState, type PanelInput } from '../src/board-panel';
import { cellSquare, GLYPHS, squareCell } from '../src/chess-board';
import { ChessGame } from '../src/chess-game';

const chess = (...moves: string[]) => {
  const g = new ChessGame();
  for (const m of moves) expect(g.play(m), m).toBe(true);
  return g;
};
const input = (over: Partial<PanelInput> = {}): PanelInput => ({
  you: 'white', draws: true, me: { name: 'Ana', colour: '#e2bc94' }, them: { name: 'Rui', colour: '#a9d4f5' }, game: null, end: null, ...over,
});

describe('panelState', () => {
  it('waits for an opponent, then for the board', () => {
    expect(panelState(input({ them: null }))).toEqual({ status: 'Waiting for an opponent', live: false, resign: false, draw: 'offer', drawEnabled: false });
    expect(panelState(input()).status).toBe('Setting up the board…');
  });
  it('says whose move it is, and only lets you play on yours', () => {
    expect(panelState(input({ game: chess() }))).toEqual({ status: 'Your move', live: true, resign: true, draw: 'offer', drawEnabled: true });
    expect(panelState(input({ game: chess('e2e4') }))).toEqual({ status: "Rui's move", live: false, resign: false, draw: 'offer', drawEnabled: false });
    expect(panelState(input({ you: 'black', game: chess('e2e4') })).live).toBe(true);
  });
  it('says check', () => {
    expect(panelState(input({ you: 'black', game: chess('e2e4', 'f7f6', 'd1h5') })).status).toBe('Your move: check');
  });
  it('offers, shows the offer made, and lets the other side accept', () => {
    expect(panelState(input({ game: chess('e2e4', 'e7e5', 'draw?') }))).toMatchObject({ draw: 'offered', drawEnabled: false });
    const offered = chess('e2e4', 'e7e5', 'draw?', 'g1f3');
    expect(panelState(input({ you: 'black', game: offered }))).toMatchObject({ status: 'Rui offers a draw', draw: 'accept', drawEnabled: true });
  });
  it('shows how it ended, with nothing left to press', () => {
    const g = chess('f2f3', 'e7e5', 'g2g4', 'd8h4');
    expect(panelState(input({ game: g, end: g.end() }))).toEqual({ status: 'Black wins: checkmate', live: false, resign: false, draw: 'offer', drawEnabled: false });
    expect(panelState(input({ them: null, game: chess('e2e4'), end: { winner: 'white', reason: 'left' } })).status).toBe('White wins: Black left the table');
  });
  it('has no draw button in games without draws', () => {
    expect(panelState(input({ draws: false, game: chess() })).draw).toBeNull();
  });
});

describe('the chessboard in the panel', () => {
  it('puts your own side at the bottom', () => {
    expect(squareCell('a1', 'white')).toEqual([0, 7]);
    expect(squareCell('a1', 'black')).toEqual([7, 0]);
    expect(squareCell('e4', 'white')).toEqual([4, 4]);
    expect(squareCell('e4', 'black')).toEqual([3, 3]);
  });
  it('finds the square back from where it is drawn', () => {
    for (const you of ['white', 'black'] as const) {
      for (const sq of ['a1', 'h8', 'e4', 'c7']) expect(cellSquare(...squareCell(sq, you), you)).toBe(sq);
    }
  });
  it('draws text glyphs, never emoji', () => {
    for (const g of Object.values(GLYPHS)) expect(g.endsWith('︎')).toBe(true);
  });
});
