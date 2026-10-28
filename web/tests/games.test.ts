import { describe, expect, it } from 'vitest';
import { endText } from '../src/games';

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
});
