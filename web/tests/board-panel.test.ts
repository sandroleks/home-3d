import { describe, expect, it } from 'vitest';
import { type BoardView, panelState, type PanelInput } from '../src/board-panel';
import { cellSquare, drawAction, GLYPHS, squareCell } from '../src/chess-board';
import { ChessGame } from '../src/chess-game';
import type { GameRules } from '../src/games';

const chess = (...moves: string[]) => {
  const g = new ChessGame();
  for (const m of moves) expect(g.play(m), m).toBe(true);
  return g;
};
const input = (over: Partial<PanelInput> = {}): PanelInput => ({
  you: 'white', me: { name: 'Ana', colour: '#e2bc94' }, them: { name: 'Rui', colour: '#a9d4f5' }, game: null, end: null, ...over,
});

describe('panelState', () => {
  it('waits for an opponent, then for the board', () => {
    expect(panelState(input({ them: null }))).toEqual({ status: 'Waiting for an opponent', live: false, resign: false });
    expect(panelState(input()).status).toBe('Setting up the board…');
  });
  it('says whose move it is, and only lets you play on yours', () => {
    expect(panelState(input({ game: chess() }))).toEqual({ status: 'Your move', live: true, resign: true });
    expect(panelState(input({ game: chess('e2e4') }))).toEqual({ status: "Rui's move", live: false, resign: false });
    expect(panelState(input({ you: 'black', game: chess('e2e4') })).live).toBe(true);
  });
  it('says check', () => {
    expect(panelState(input({ you: 'black', game: chess('e2e4', 'f7f6', 'd1h5') })).status).toBe('Your move: check');
  });
  it("says when the other side offers a draw", () => {
    expect(panelState(input({ you: 'black', game: chess('e2e4', 'e7e5', 'draw?', 'g1f3') })).status).toBe('Rui offers a draw');
  });
  it("shows a game's own result line when its rules ended it, but not a leave", () => {
    const scored: GameRules = {
      kind: 'go', moves: ['pass', 'pass'], turn: () => 'black', play: () => false,
      end: () => ({ winner: 'white', reason: 'score' }), resultText: () => 'White wins by 7',
    };
    expect(panelState(input({ game: scored, end: scored.end() })).status).toBe('White wins by 7');
    const running: GameRules = { ...scored, moves: [], end: () => null, resultText: () => null };
    expect(panelState(input({ game: running, end: { winner: 'white', reason: 'left' } })).status).toBe('White wins: Black left the table');
    expect(panelState(input({ game: { ...scored, resultText: undefined }, end: scored.end() })).status).toBe('White wins: on points');
  });
  it('shows how it ended, with nothing left to press', () => {
    const g = chess('f2f3', 'e7e5', 'g2g4', 'd8h4');
    expect(panelState(input({ game: g, end: g.end() }))).toEqual({ status: 'Black wins: checkmate', live: false, resign: false });
    expect(panelState(input({ them: null, game: chess('e2e4'), end: { winner: 'white', reason: 'left' } })).status).toBe('White wins: Black left the table');
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

describe("chess's draw button", () => {
  const view = (over: Partial<BoardView> = {}): BoardView => ({ game: null, you: 'white', live: false, end: null, ...over });
  it('offers a draw on your move only', () => {
    expect(drawAction(view({ game: chess(), live: true }))).toEqual({ label: 'Offer draw', enabled: true, entry: 'draw?' });
    expect(drawAction(view({ game: chess('e2e4') }))).toEqual({ label: 'Offer draw', enabled: false, entry: 'draw?' });
    expect(drawAction(view())).toEqual({ label: 'Offer draw', enabled: false, entry: 'draw?' });
  });
  it('shows your own offer, and lets the other side accept it', () => {
    expect(drawAction(view({ game: chess('e2e4', 'e7e5', 'draw?'), live: true }))).toEqual({ label: 'Draw offered', enabled: false, entry: 'draw?' });
    const offered = chess('e2e4', 'e7e5', 'draw?', 'g1f3');
    expect(drawAction(view({ you: 'black', game: offered, live: true }))).toEqual({ label: 'Accept draw', enabled: true, entry: 'draw!' });
  });
  it('offers nothing once the game is over', () => {
    const offered = chess('e2e4', 'e7e5', 'draw?', 'g1f3');
    expect(drawAction(view({ you: 'black', game: offered, end: { winner: 'black', reason: 'left' } }))).toEqual({ label: 'Offer draw', enabled: false, entry: 'draw?' });
  });
});
