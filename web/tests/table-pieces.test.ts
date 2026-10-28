import { Group, type Mesh, MeshMatcapMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { ChessGame } from '../src/chess-game';
import { ChessSet, lostPosition, pieceGeometries, squarePosition } from '../src/chess-set';
import { CONFIG } from '../src/config';
import type { GameRules, SlotGame } from '../src/games';
import { TableGames, TableMaterials, type TableSet } from '../src/table-pieces';

const step = (CONFIG.games.chess.size - 2 * CONFIG.games.chess.border) / 8;
const chess = (...moves: string[]) => {
  const g = new ChessGame();
  for (const m of moves) g.play(m);
  return g;
};

describe('the chessboard on the table', () => {
  it('puts white at the S chair (+z) with file a toward -x', () => {
    expect(squarePosition('a1')).toEqual([-3.5 * step, 3.5 * step]);
    expect(squarePosition('h8')).toEqual([3.5 * step, -3.5 * step]);
    expect(squarePosition('e4')[0]).toBeCloseTo(0.5 * step);
  });
  it("lines up lost pieces off the board in front of whoever took them: black's by white, white's by black", () => {
    const [bx, bz] = lostPosition('b', 0);
    expect(bx).toBeCloseTo(-3.5 * step);
    expect(bz).toBeGreaterThan(CONFIG.games.chess.size / 2);
    const [wx, wz] = lostPosition('w', 7);
    expect(wx).toBeCloseTo(3.5 * step);
    expect(wz).toBeLessThan(-CONFIG.games.chess.size / 2);
    expect(lostPosition('b', 8)[1]).toBeGreaterThan(bz); // the ninth starts a second row
  });
  it('shares one geometry per kind of piece', () => {
    const g = pieceGeometries();
    expect(Object.keys(g).sort()).toEqual(['b', 'k', 'n', 'p', 'q', 'r']);
    for (const geo of Object.values(g)) expect(geo.getAttribute('position').count).toBeGreaterThan(0);
  });
  it('slides a moved piece to its square and lifts a taken one off to the side', () => {
    const set = new ChessSet(new TableMaterials({ matte: null, gloss: null }), null);
    expect(set.pieces.size).toBe(32);
    const pawn = set.pieces.get('e2')!;
    expect([pawn.position.x, pawn.position.z]).toEqual(squarePosition('e2'));
    set.show(chess('e2e4', 'd7d5', 'e4d5'));
    set.update(0.15);
    expect(pawn.position.z).toBeLessThan(squarePosition('e2')[1]); // on its way
    expect(pawn.position.z).toBeGreaterThan(squarePosition('d5')[1]);
    set.update(1);
    expect([pawn.position.x, pawn.position.z]).toEqual(squarePosition('d5'));
    const taken = set.pieces.get('d7')!;
    const [lx, lz] = lostPosition('b', 0);
    expect(taken.position.toArray()).toEqual([lx, 0, lz]);
    set.show(null); // a new game: everything goes home
    set.update(1);
    expect([taken.position.x, taken.position.z]).toEqual(squarePosition('d7'));
  });
  it('swaps a promoted pawn for its new piece', () => {
    const set = new ChessSet(new TableMaterials({ matte: null, gloss: null }), null);
    const geometry = pieceGeometries();
    set.show(chess('a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5a6', 'c8b7', 'a6b7', 'h7h6', 'b7a8q'));
    const queen = set.pieces.get('a2')!;
    expect(queen.geometry.getAttribute('position').count).toBe(geometry.q.getAttribute('position').count);
  });
});

describe('TableGames', () => {
  it("puts the chessboard at slot 0's place on the table, the other slots empty for now", () => {
    const t = new TableGames(null);
    expect(t.root.children).toHaveLength(1);
    const [x, z] = CONFIG.games.slots[0];
    expect(t.root.children[0].position.toArray()).toEqual([x, CONFIG.games.tableTop, z]);
  });
  it("puts each kind's set at its slot's place, from the sets it is given", () => {
    const shown: (GameRules | null)[] = [];
    const fake = (): TableSet => ({ root: new Group(), show: (g) => void shown.push(g), update: () => {} });
    const t = new TableGames(null, { backgammon: fake });
    expect(t.root.children).toHaveLength(1);
    const [x, z] = CONFIG.games.slots[1];
    expect(t.root.children[0].position.toArray()).toEqual([x, CONFIG.games.tableTop, z]);
    const game: SlotGame = { id: 'g1', white: 'a', black: 'b', rules: chess('e2e4'), left: null };
    t.update(0.1, (slot) => (slot === 1 ? game : null), 1);
    expect(shown).toEqual([game.rules]);
  });

  it('shows each slot\'s game when it changes, and dims with the light', () => {
    const t = new TableGames(null);
    const game: SlotGame = { id: 'g1', white: 'a', black: 'b', rules: chess('e2e4'), left: null };
    t.update(1, (slot) => (slot === 0 ? game : null), 0.5);
    const set = t.root.children[0];
    const pawn = set.getObjectByName('Chess e2') as Mesh;
    expect(pawn.position.z).toBeCloseTo(squarePosition('e4')[1]);
    const m = pawn.material as MeshMatcapMaterial;
    expect(m.color.r).toBeCloseTo(new MeshMatcapMaterial({ color: CONFIG.games.chess.white }).color.r * 0.5);
  });
});
