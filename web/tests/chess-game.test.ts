import { describe, expect, it } from 'vitest';
import { ChessGame } from '../src/chess-game';

const game = (...entries: string[]) => {
  const g = new ChessGame();
  for (const e of entries) expect(g.play(e), e).toBe(true);
  return g;
};

describe('ChessGame', () => {
  it('starts with white to move and keeps the moves it is given', () => {
    const g = game('e2e4', 'e7e5');
    expect(g.kind).toBe('chess');
    expect(g.turn()).toBe('white');
    expect(g.moves).toEqual(['e2e4', 'e7e5']);
    expect(g.end()).toBeNull();
  });
  it('refuses illegal moves, junk, and a promotion letter on a move that does not promote', () => {
    const g = new ChessGame();
    expect(g.play('e2e5')).toBe(false);
    expect(g.play('e7e5')).toBe(false); // black's pawn, white's turn
    expect(g.play('hello')).toBe(false);
    expect(g.play('e2e4q')).toBe(false);
    expect(g.moves).toEqual([]);
    expect(g.turn()).toBe('white');
  });
  it("ends in checkmate (the fool's mate)", () => {
    const g = game('f2f3', 'e7e5', 'g2g4', 'd8h4');
    expect(g.end()).toEqual({ winner: 'black', reason: 'checkmate' });
    expect(g.play('a2a3')).toBe(false); // over: nothing more
    expect(g.targets('a2')).toEqual([]);
  });
  it('knows check, stalemate, repetition and insufficient material', () => {
    expect(game('e2e4', 'f7f6', 'd2d4', 'g7g5', 'd1h5').inCheck()).toBe(true);
    // Sam Loyd's ten-move stalemate
    const stale = game('e2e3', 'a7a5', 'd1h5', 'a8a6', 'h5a5', 'h7h5', 'h2h4', 'a6h6', 'a5c7', 'f7f6', 'c7d7', 'e8f7', 'd7b7', 'd8d3', 'b7b8', 'd3h7', 'b8c8', 'f7g6', 'c8e6');
    expect(stale.end()).toEqual({ winner: null, reason: 'stalemate' });
    const knights = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    expect(game(...knights, ...knights).end()).toEqual({ winner: null, reason: 'repetition' });
  });
  it('promotes to the piece asked for, and needs one to promote', () => {
    const g = game('a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5a6', 'c8b7', 'a6b7', 'h7h6');
    expect(g.targets('b7')).toContainEqual({ to: 'a8', promotion: true });
    expect(g.play('b7a8')).toBe(false);
    expect(g.play('b7a8n')).toBe(true);
    expect(g.pieceAt('a8')).toEqual({ color: 'w', type: 'n' });
  });
  it('lists the targets of a piece once each', () => {
    expect(new ChessGame().targets('e2')).toEqual([{ to: 'e3', promotion: false }, { to: 'e4', promotion: false }]);
    expect(new ChessGame().targets('e4')).toEqual([]);
  });
  it('resigns for the side to move', () => {
    const g = game('e2e4', 'resign');
    expect(g.end()).toEqual({ winner: 'white', reason: 'resigned' });
    expect(g.moves).toEqual(['e2e4', 'resign']);
  });
  it('draws by agreement: an offer, a move, then the other side accepts', () => {
    const g = game('e2e4', 'e7e5', 'draw?');
    expect(g.drawOffer()).toBe('white');
    expect(g.play('draw?')).toBe(false); // one offer at a time
    expect(g.play('draw!')).toBe(false); // not your own
    expect(g.play('g1f3')).toBe(true); // white still moves after offering
    expect(g.drawOffer()).toBe('white');
    expect(g.play('draw!')).toBe(true);
    expect(g.end()).toEqual({ winner: null, reason: 'agreement' });
  });
  it('lets an offer lapse when the other side moves instead', () => {
    const g = game('e2e4', 'e7e5', 'draw?', 'g1f3', 'b8c6');
    expect(g.drawOffer()).toBeNull();
    expect(g.play('draw!')).toBe(false);
  });
  it('replays to the same state', () => {
    const a = game('e2e4', 'd7d5', 'e4d5', 'draw?', 'd8d5');
    const b = game(...a.moves);
    expect(b.moves).toEqual(a.moves);
    expect(b.drawOffer()).toBe('black');
    expect(b.lastMove()).toEqual({ from: 'd8', to: 'd5' });
  });
  it('follows every piece: captures in order, en passant, castling and promotion', () => {
    const pieces = (g: ChessGame) => new Map(g.pieces().map((p) => [p.id, p]));
    expect(new ChessGame().pieces()).toHaveLength(32);
    expect(new ChessGame().lastMove()).toBeNull();
    const ep = pieces(game('e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6'));
    expect(ep.get('e2')).toMatchObject({ square: 'd6', lost: -1 });
    expect(ep.get('d7')).toMatchObject({ square: null, lost: 0, color: 'b' });
    const castled = pieces(game('g1f3', 'g8f6', 'g2g3', 'g7g6', 'f1g2', 'f8g7', 'e1g1'));
    expect(castled.get('e1')?.square).toBe('g1');
    expect(castled.get('h1')?.square).toBe('f1');
    const promoted = pieces(game('a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5a6', 'c8b7', 'a6b7', 'h7h6', 'b7a8q'));
    expect(promoted.get('a2')).toMatchObject({ square: 'a8', type: 'q' });
    expect(promoted.get('a8')).toMatchObject({ square: null, lost: 3 });
    expect(['b7', 'a7', 'c8', 'a8'].map((id) => promoted.get(id)?.lost)).toEqual([0, 1, 2, 3]);
  });
});
