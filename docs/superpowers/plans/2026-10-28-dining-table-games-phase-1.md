# Dining Table Games, Phase 1 (the frame and chess) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two visitors who sit in the dining chairs N0 and S0 play chess against each other in an on-screen panel, while everyone in the flat sees the game live on the table in 3D.

**Architecture:** Every game is a rules object that replays a list of string entries (`GameRules`, `games.ts`); chess wraps chess.js (`chess-game.ts`). A pure `Games` class keeps each slot's game: from who sits in which game chair (worked out every frame from the local seat and the others' poses) it ends a game whose player left, opens a new game in the white player's browser, and accepts or ignores `game` messages from others. `multiplayer.ts` carries the new `game` message kind and adds the games to the full-state answer. The table's 3D boards (`table-pieces.ts`, `chess-set.ts`) and the player's panel (`board-panel.ts`, `chess-board.ts`) only read that state; `main.ts` wires it into the frame loop, the keys and the pointer lock. Backgammon and Go plug in later as another `RULES` entry, another `TableSet` and another `PanelBoard`, without changing the frame.

**Tech Stack:** TypeScript 5.6 (strict, `noUnusedLocals`, `noUnusedParameters`), Vite 8, Vitest 5 (node environment, no DOM), three.js 0.170, Trystero 0.26, chess.js 1.4.0.

**Spec:** `docs/superpowers/specs/2026-10-28-dining-table-games-design.md`

## Global Constraints

- Run everything from `web/`: `npm test` (Vitest) and `npm run build` (`tsc --noEmit && vite build`). Both must pass at the end of every task. Before this plan: 36 test files, 308 tests.
- Chess rules come from `chess.js` pinned at exactly `1.4.0` (BSD-2-Clause): `npm install chess.js@1.4.0 --save-exact`; commit `web/package.json` and `web/package-lock.json`. No other new dependency.
- Slots: 0 = chess (chairs `Dining chair N0` / `S0`), 1 = backgammon (`N1` / `S1`), 2 = Go (`N2` / `S2`). The S chair plays white, the N chair black. In Phase 1 only slot 0 has rules (`RULES` has only `chess`); slots 1 and 2 stay plain chairs, with no board on the table and no panel.
- A game is a list of entries, always added by the side to move: a chess move in UCI in its one canonical spelling (`e2e4`, `e7e8q`; a promotion letter on a non-promoting move is refused), `resign`, `draw?` (offer), `draw!` (accept the other side's standing offer). An offer lapses when the offerer's opponent moves instead. Resign and draw buttons therefore work only on your own move; standing up on the opponent's move simply leaves the chair, which loses the game the same way.
- Network: a new Trystero message kind `game` carrying `{ slot, id, white, black, moves, end? }` (`GameMessage`). Each change sends the whole game to everyone (`Multiplayer.sendGame`). The full-state answer (`want` → `full`) is followed by one `game` message per slot that has a game, to the same peer. Validation: `slot` an integer 0..2; `id`, `white`, `black` non-empty strings of at most 64 characters, `white !== black`; `moves` an array of at most 1000 strings of at most 8 characters; `end`, if present, `{ winner: 'white' | 'black' | null, reason }` with a known reason.
- Accept rules (`Games.receive`): same id as the slot's game → taken only if that game hasn't ended here and the new list extends ours and replays legally. Another id → taken if its white and black are the visitors seen in that slot's S and N chairs now and no game is running there, or if it carries an `end` and the slot has no game at all (a newcomer). Otherwise it is held as the slot's pending game and retried every frame for `CONFIG.games.pendingFor` = 5 seconds (the players' poses may arrive after the game), then dropped.
- Opening: only the browser of the visitor in the S (white) chair opens a game, when both chairs are taken, no game is running there, and the slot has had an empty chair since the last game opened in this browser (so a finished game's result stays on the table until one of the two stands up and sits back down). Game ids: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` (not `crypto.randomUUID`, which phones on a LAN address don't have).
- In a chair: a visitor is in a game chair when seated within `CONFIG.games.chairRadius` = 0.05 m of the chair's spot (the local player by `player.seat`, the others by the seating in their last pose, which is rounded to the mm). Two on one chair: the lower peer id. A running game whose white or black is not in their chair ends locally with reason `left` (the one still seated wins; both gone: no winner). No message is sent for that.
- While the panel is open, `player.held` is true: movement keys and the touch stick neither walk nor stand the player up. Standing is the panel's Stand up button or C (the touch bar's sit button), which asks "Stand up and resign?" while your game runs; on your move, confirming adds `resign` first. Clicks on the view don't re-lock the pointer and Tab does nothing while the panel is open.
- Names come from other visitors: render them with `textContent` only, never `innerHTML`.
- Copy, verbatim: "Waiting for an opponent", "Setting up the board…", "Your move", "Your move: check", "<name>'s move", "<name> offers a draw", "Empty chair", " (you)", "White", "Black", "Resign", "Offer draw", "Accept draw", "Draw offered", "Stand up", "Stand up and resign?", "Resign this game?", "Keep playing". Results: "White wins: checkmate", "<Winner> wins: <Loser> resigned", "<Winner> wins: <Loser> left the table", "Game over: both players left the table", "Draw: stalemate", "Draw: threefold repetition", "Draw: 50-move rule", "Draw: insufficient material", "Draw: agreed".
- `CONFIG.games` (final values): `slots: [[1.15, 3.2], [1.8, 3.2], [2.35, 3.2]]` (z 3.2 is halfway between the N and S chair spots at z 2.5143 and 3.8857; slot 0 sits 10 cm toward the table's end from the chairs' x 1.25 because the model's fruit bowl stands at about x 1.37 to 1.6), `tableTop: 0.76` (the model's `Oak [Dining table]` top), `chairRadius: 0.05`, `pendingFor: 5`, `slide: 0.3`, `chess: { size: 0.4, border: 0.02, thickness: 0.015, white: '#efe6d2', black: '#4a3b33', light: '#e8d5b0', dark: '#9c6b4a', wood: '#6b4630' }`. Task 7 checks them in the browser.
- 3D: procedural geometry only (no Blender export): `LatheGeometry` pieces, an extruded knight head, a board box with a canvas-drawn checker texture on a plane. Matcap materials (`makeMatcaps` from `creatures.ts`) dimmed by `figureLight` at the table, like the avatars. One geometry per kind of piece and one material per side. The table root is added to the scene before `warmUpShaders` runs, so its shaders compile at load. Pieces slide in `CONFIG.games.slide` seconds; taken pieces lift off and line up beside the board in front of the player who took them.
- Files stay flat in `web/src/` (no subfolders), small and single-purpose. Match the code around you: short doc comments on exported things, the existing naming, `type` aliases (not interfaces) for anything sent as JSON.
- Commits end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Files

- Create `web/src/games.ts`: the common game interface (`GameRules`), `SLOTS`, `RULES`, `endText`, the chairs (`gameChairs`, `seatedAt`), the `game` message (`GameMessage`, `isGameMessage`), and the life cycle (`Games`).
- Create `web/src/chess-game.ts`: `ChessGame`, the chess.js wrapper (entries, draw offers, the end, targets, pieces followed through the game).
- Create `web/src/chess-set.ts`: the 3D chessboard and pieces (`ChessSet`, `squarePosition`, `lostPosition`, `pieceGeometries`).
- Create `web/src/table-pieces.ts`: the 3D frame (`TableSet`, `TableMaterials`, `TableGames`).
- Create `web/src/board-panel.ts`: the panel shell (`BoardPanel`, `PanelBoard`, `panelState`, `GAME_COPY`).
- Create `web/src/chess-board.ts`: the SVG chessboard in the panel (`ChessBoard`, `squareCell`, `cellSquare`, `GLYPHS`).
- Modify `web/src/multiplayer.ts` (the `game` kind, `sendGame`, the `onGame` and `games` hooks), `web/src/avatars.ts` (`seated()`), `web/src/player.ts` (`held`), `web/src/config.ts` (`games`), `web/src/main.ts` (wiring), `web/index.html` (the panel, the controls lists), `web/src/style.css` (the panel).
- `web/src/ui.ts` needs no change: the panel's DOM is driven by `BoardPanel`, as the guest list is by `UI`.
- Modify `README.md` (controls, Visitors together) and the design note's status line.
- Tests: create `web/tests/chess-game.test.ts`, `web/tests/games.test.ts`, `web/tests/table-pieces.test.ts`, `web/tests/board-panel.test.ts`; extend `web/tests/multiplayer.test.ts`, `web/tests/avatars.test.ts`, `web/tests/seats.test.ts`.

---

### Task 1: chess.js and the chess rules (`chess-game.ts`, the game interface)

**Files:**
- Modify: `web/package.json`, `web/package-lock.json` (by npm)
- Create: `web/src/games.ts` (the interface part only; Task 2 completes it)
- Create: `web/src/chess-game.ts`
- Test: `web/tests/chess-game.test.ts`, `web/tests/games.test.ts`

**Interfaces:**
- Produces (`games.ts`):
  - `type GameKind = 'chess' | 'backgammon' | 'go'`, `type Side = 'white' | 'black'`, `otherSide(s: Side): Side`
  - `END_REASONS` (`'checkmate' | 'stalemate' | 'repetition' | 'fifty' | 'material' | 'agreement' | 'resigned' | 'left'`), `type EndReason`, `type GameEnd = { winner: Side | null; reason: EndReason }`
  - `interface GameRules { readonly kind: GameKind; readonly moves: readonly string[]; turn(): Side; play(entry: string): boolean; end(): GameEnd | null; drawOffer?(): Side | null; inCheck?(): boolean }`
  - `SLOTS: readonly { kind: GameKind; title: string; draws: boolean }[]` (index = slot)
  - `endText(end: GameEnd): string`
- Produces (`chess-game.ts`):
  - `interface ChessPiece { id: string; color: 'w' | 'b'; type: PieceSymbol; square: Square | null; lost: number }` (`id` = starting square)
  - `class ChessGame implements GameRules` with `kind = 'chess'`, `moves`, `turn()`, `play(entry)`, `end()`, `drawOffer()`, `inCheck()`, plus `pieceAt(square: Square): { color: 'w' | 'b'; type: PieceSymbol } | null`, `targets(from: Square): { to: Square; promotion: boolean }[]`, `lastMove(): { from: Square; to: Square } | null`, `pieces(): ChessPiece[]`

- [ ] **Step 1: Install chess.js**

Run: `cd web && npm install chess.js@1.4.0 --save-exact`
Then: `cd web && npm ls chess.js`
Expected: `chess.js@1.4.0` listed directly under `apartment-walkthrough`, and `web/package.json`'s `dependencies` has `"chess.js": "1.4.0"` (no caret).

- [ ] **Step 2: Write the failing tests**

Create `web/tests/chess-game.test.ts`:

```ts
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
```

Create `web/tests/games.test.ts` (Task 2 replaces it with a longer version):

```ts
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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/chess-game.test.ts tests/games.test.ts`
Expected: FAIL: `../src/chess-game` and `../src/games` cannot be resolved.

- [ ] **Step 4: Write the game interface**

Create `web/src/games.ts`:

```ts
/** The games on the dining table. */
export type GameKind = 'chess' | 'backgammon' | 'go';
/** The S chair (the Sala window's side) plays white, the N chair black. */
export type Side = 'white' | 'black';

export const otherSide = (s: Side): Side => (s === 'white' ? 'black' : 'white');

export const END_REASONS = ['checkmate', 'stalemate', 'repetition', 'fifty', 'material', 'agreement', 'resigned', 'left'] as const;
export type EndReason = (typeof END_REASONS)[number];
/** How a game ended: who won (null: a draw, or both players gone) and why. A type, not an interface, so it can be
 * sent as JSON. */
export type GameEnd = { winner: Side | null; reason: EndReason };

/**
 * What every game's rules offer the table, the overlay and the network: a list of entries replayed one by one, whose
 * turn it is, and how it ended. An entry is always by the side to move.
 */
export interface GameRules {
  readonly kind: GameKind;
  /** The entries so far: moves, and `resign` (and the game's own, like chess's draw offers). */
  readonly moves: readonly string[];
  turn(): Side;
  /** Adds an entry for the side to move; false, with nothing changed, when it isn't legal now or the game is over. */
  play(entry: string): boolean;
  /** How it ended by its rules, a resignation or an agreement; null while it runs. */
  end(): GameEnd | null;
  /** Games with draw offers: the side whose offer stands, or null. */
  drawOffer?(): Side | null;
  /** Games with check: the side to move is in check. */
  inCheck?(): boolean;
}

/** The table's three places, by slot number: the chairs `Dining chair N<slot>` and `S<slot>`. */
export const SLOTS: readonly { kind: GameKind; title: string; draws: boolean }[] = [
  { kind: 'chess', title: 'Chess', draws: true },
  { kind: 'backgammon', title: 'Backgammon', draws: false },
  { kind: 'go', title: 'Go', draws: false },
];

const SIDE_NAME: Record<Side, string> = { white: 'White', black: 'Black' };
const DRAWN: Partial<Record<EndReason, string>> = {
  stalemate: 'stalemate', repetition: 'threefold repetition', fifty: '50-move rule', material: 'insufficient material', agreement: 'agreed',
};

/** The result line: "White wins: checkmate", "Black wins: White left the table", "Draw: stalemate". */
export function endText(end: GameEnd): string {
  if (end.winner) {
    const loser = SIDE_NAME[otherSide(end.winner)];
    const why = end.reason === 'resigned' ? `${loser} resigned` : end.reason === 'left' ? `${loser} left the table` : end.reason;
    return `${SIDE_NAME[end.winner]} wins: ${why}`;
  }
  if (end.reason === 'left') return 'Game over: both players left the table';
  return `Draw: ${DRAWN[end.reason] ?? end.reason}`;
}
```

- [ ] **Step 5: Write the chess wrapper**

Create `web/src/chess-game.ts`. It imports only types from `games.ts` and keeps its own one-line `otherSide`, so `games.ts` can import `ChessGame` in Task 2 without a runtime import cycle. chess.js throws on an illegal move; `move()` catches that.

```ts
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { GameEnd, GameRules, Side } from './games';

/** A move as stored: from, to and the promotion piece, e.g. `e2e4`, `e7e8q`. */
const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn]?)$/;
const sideOf = (c: Color): Side => (c === 'w' ? 'white' : 'black');
const otherSide = (s: Side): Side => (s === 'white' ? 'black' : 'white');
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const BACK_RANK: PieceSymbol[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

/** One of the 32 pieces, followed through the game: `id` is its starting square; `square` is null once it is taken,
 * and `lost` then says how many of its side's pieces went before it (-1 while it is on the board). */
export interface ChessPiece { id: string; color: Color; type: PieceSymbol; square: Square | null; lost: number }

/**
 * Chess by chess.js: a list of entries replayed one by one. An entry is a move in UCI (`e2e4`, `e7e8q`), `resign`,
 * `draw?` (an offer) or `draw!` (accepting the other side's offer), always by the side to move. An offer lapses when
 * the offerer's opponent moves instead.
 */
export class ChessGame implements GameRules {
  readonly kind = 'chess' as const;
  private chess = new Chess();
  private list: string[] = [];
  private played: Move[] = [];
  private offer: Side | null = null;
  private over: GameEnd | null = null;
  private result: GameEnd | null = null;

  get moves(): readonly string[] {
    return this.list;
  }

  turn(): Side {
    return sideOf(this.chess.turn());
  }

  drawOffer(): Side | null {
    return this.offer;
  }

  inCheck(): boolean {
    return this.chess.inCheck();
  }

  end(): GameEnd | null {
    return this.result;
  }

  play(entry: string): boolean {
    if (this.result) return false;
    const side = this.turn();
    if (entry === 'resign') this.over = { winner: otherSide(side), reason: 'resigned' };
    else if (entry === 'draw?') {
      if (this.offer) return false;
      this.offer = side;
    } else if (entry === 'draw!') {
      if (!this.offer || this.offer === side) return false;
      this.over = { winner: null, reason: 'agreement' };
    } else {
      if (!this.move(entry)) return false;
      if (this.offer && this.offer !== side) this.offer = null;
    }
    this.list.push(entry);
    this.result = this.over ?? this.byRules();
    return true;
  }

  /** A legal move in its one canonical spelling (no promotion letter on a move that doesn't promote). */
  private move(uci: string): boolean {
    const m = UCI.exec(uci);
    if (!m) return false;
    let done: Move;
    try {
      done = this.chess.move({ from: m[1], to: m[2], ...(m[3] ? { promotion: m[3] } : {}) });
    } catch {
      return false; // chess.js throws on an illegal move
    }
    if (done.lan !== uci) {
      this.chess.undo();
      return false;
    }
    this.played.push(done);
    return true;
  }

  private byRules(): GameEnd | null {
    const c = this.chess;
    if (c.isCheckmate()) return { winner: otherSide(this.turn()), reason: 'checkmate' };
    if (c.isStalemate()) return { winner: null, reason: 'stalemate' };
    if (c.isInsufficientMaterial()) return { winner: null, reason: 'material' };
    if (c.isThreefoldRepetition()) return { winner: null, reason: 'repetition' };
    if (c.isDrawByFiftyMoves()) return { winner: null, reason: 'fifty' };
    return null;
  }

  /** The piece on a square, if any. */
  pieceAt(square: Square): { color: Color; type: PieceSymbol } | null {
    return this.chess.get(square) ?? null;
  }

  /** Where the piece on `from` can move now, and whether it promotes there (one entry per square). */
  targets(from: Square): { to: Square; promotion: boolean }[] {
    if (this.result) return [];
    const seen = new Map<Square, boolean>();
    for (const m of this.chess.moves({ square: from, verbose: true })) seen.set(m.to, m.isPromotion());
    return [...seen].map(([to, promotion]) => ({ to, promotion }));
  }

  lastMove(): { from: Square; to: Square } | null {
    const m = this.played.at(-1);
    return m ? { from: m.from, to: m.to } : null;
  }

  /** Every piece, followed from the start: castling moves the rook, en passant takes the pawn beside, promotion
   * changes the type. */
  pieces(): ChessPiece[] {
    const all: ChessPiece[] = [];
    FILES.forEach((f, i) => {
      for (const [color, back, pawns] of [['w', '1', '2'], ['b', '8', '7']] as const) {
        all.push({ id: `${f}${back}`, color, type: BACK_RANK[i], square: `${f}${back}` as Square, lost: -1 });
        all.push({ id: `${f}${pawns}`, color, type: 'p', square: `${f}${pawns}` as Square, lost: -1 });
      }
    });
    const on = new Map<string, ChessPiece>(all.map((p) => [p.id, p]));
    const lost = { w: 0, b: 0 };
    const shift = (from: string, to: Square) => {
      const p = on.get(from)!;
      on.delete(from);
      p.square = to;
      on.set(to, p);
      return p;
    };
    for (const m of this.played) {
      const takenAt = m.isEnPassant() ? `${m.to[0]}${m.from[1]}` : m.to;
      const taken = m.captured ? on.get(takenAt) : undefined;
      if (taken) {
        on.delete(takenAt);
        taken.square = null;
        taken.lost = lost[taken.color]++;
      }
      const p = shift(m.from, m.to);
      if (m.promotion) p.type = m.promotion;
      const rank = m.from[1];
      if (m.isKingsideCastle()) shift(`h${rank}`, `f${rank}` as Square);
      if (m.isQueensideCastle()) shift(`a${rank}`, `d${rank}` as Square);
    }
    return all;
  }
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/chess-game.test.ts tests/games.test.ts`
Expected: PASS (11 and 2 tests).

Run: `cd web && npm test && npm run build`
Expected: 38 test files, 321 tests pass; the build finishes without TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/src/games.ts web/src/chess-game.ts web/tests/chess-game.test.ts web/tests/games.test.ts
git commit -m "Games: the game interface and chess rules (chess.js 1.4.0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A game's life (`Games`, chairs, messages)

**Files:**
- Modify: `web/src/games.ts` (replace with the full version below)
- Modify: `web/src/config.ts` (a new `games` block)
- Test: `web/tests/games.test.ts` (replace with the full version below)

**Interfaces:**
- Consumes (Task 1): everything in `games.ts`, `ChessGame`.
- Consumes (existing): `Seat` from `./seats` (`{ name; pose; min; max; spots: { at: [x, y, z]; yaw }[] }`).
- Produces:
  - `CONFIG.games.chairRadius: number` (0.05), `CONFIG.games.pendingFor: number` (5, seconds)
  - `RULES: Partial<Record<GameKind, () => GameRules>>` (`{ chess }`), `replay(kind, moves, rules = RULES): GameRules | null`
  - `interface Chair { slot: number; side: Side; x: number; z: number }`, `gameChairs(seats: Seat[]): Chair[]`
  - `interface SlotSeats { white: string | null; black: string | null }`, `interface Sitter { id: string; x: number; z: number }`, `seatedAt(chairs: Chair[], sitters: Sitter[], radius?): SlotSeats[]` (one per slot)
  - `type GameMessage = { slot: number; id: string; white: string; black: string; moves: string[]; end?: GameEnd }`, `isGameMessage(v: unknown): v is GameMessage`
  - `interface SlotGame { id: string; white: string; black: string; rules: GameRules; left: GameEnd | null }`, `endOf(g: SlotGame): GameEnd | null`, `leftEnd(whiteHere: boolean, blackHere: boolean): GameEnd | null`
  - `class Games`: `constructor(selfId: () => string, newId: () => string, rules = RULES)`; `version: number`; `at(slot): SlotGame | null`; `seatsAt(slot): SlotSeats`; `playable(slot): boolean`; `seatOf(id): { slot: number; side: Side } | null`; `update(seats: SlotSeats[], now: number /* s */): GameMessage[]` (games this browser opened, to send); `receive(m: GameMessage): boolean`; `play(slot, entry): GameMessage | null` (to send); `message(slot): GameMessage | null`; `messages(): GameMessage[]`

- [ ] **Step 1: Write the failing tests**

Replace `web/tests/games.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  endOf, endText, gameChairs, type GameMessage, Games, isGameMessage, leftEnd, replay, seatedAt, type SlotSeats, SLOTS,
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
    expect(replay('go', [])).toBeNull();
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
    expect([0, 1, 2].map((s) => g.playable(s))).toEqual([true, false, false]);
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
    expect(rui.receive({ slot: 1, id: 'g6', white: 'ana', black: 'rui', moves: [] })).toBe(false); // no rules there yet
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
  it('takes no more moves for a game that ended here', () => {
    const ze = setup('ze');
    ze.update(at0('ana', 'rui'), 0);
    ze.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: [] });
    ze.update(at0(null, 'rui'), 1);
    expect(ze.receive({ slot: 0, id: 'g1', white: 'ana', black: 'rui', moves: ['e2e4'] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/games.test.ts`
Expected: FAIL: `endOf`, `gameChairs`, `Games`, `isGameMessage`, `leftEnd`, `replay` and `seatedAt` are not exported.

- [ ] **Step 3: Add the config**

In `web/src/config.ts`, insert this block just before the line `  /** The office's Nanoleaf panels (nanoleaf.ts): a gradient between two hues …` (after the closing `},` of `multiplayer`):

```ts
  /** The games on the dining table (games.ts): chess at N0/S0, backgammon at N1/S1, Go at N2/S2; the S chair plays white. */
  games: {
    /** A visitor is in a game chair when seated within this many metres of its spot (poses are sent to the mm). */
    chairRadius: 0.05,
    /** Seconds a game sent by another visitor waits for its two players to show in their chairs here. */
    pendingFor: 5,
  },
```

- [ ] **Step 4: Implement**

Replace `web/src/games.ts` with the full version (the Task 1 part is unchanged; imports and everything from `RULES` on are new):

```ts
import { ChessGame } from './chess-game';
import { CONFIG } from './config';
import type { Seat } from './seats';

/** The games on the dining table. */
export type GameKind = 'chess' | 'backgammon' | 'go';
/** The S chair (the Sala window's side) plays white, the N chair black. */
export type Side = 'white' | 'black';

export const otherSide = (s: Side): Side => (s === 'white' ? 'black' : 'white');

export const END_REASONS = ['checkmate', 'stalemate', 'repetition', 'fifty', 'material', 'agreement', 'resigned', 'left'] as const;
export type EndReason = (typeof END_REASONS)[number];
/** How a game ended: who won (null: a draw, or both players gone) and why. A type, not an interface, so it can be
 * sent as JSON. */
export type GameEnd = { winner: Side | null; reason: EndReason };

/**
 * What every game's rules offer the table, the overlay and the network: a list of entries replayed one by one, whose
 * turn it is, and how it ended. An entry is always by the side to move.
 */
export interface GameRules {
  readonly kind: GameKind;
  /** The entries so far: moves, and `resign` (and the game's own, like chess's draw offers). */
  readonly moves: readonly string[];
  turn(): Side;
  /** Adds an entry for the side to move; false, with nothing changed, when it isn't legal now or the game is over. */
  play(entry: string): boolean;
  /** How it ended by its rules, a resignation or an agreement; null while it runs. */
  end(): GameEnd | null;
  /** Games with draw offers: the side whose offer stands, or null. */
  drawOffer?(): Side | null;
  /** Games with check: the side to move is in check. */
  inCheck?(): boolean;
}

/** The table's three places, by slot number: the chairs `Dining chair N<slot>` and `S<slot>`. */
export const SLOTS: readonly { kind: GameKind; title: string; draws: boolean }[] = [
  { kind: 'chess', title: 'Chess', draws: true },
  { kind: 'backgammon', title: 'Backgammon', draws: false },
  { kind: 'go', title: 'Go', draws: false },
];

const SIDE_NAME: Record<Side, string> = { white: 'White', black: 'Black' };
const DRAWN: Partial<Record<EndReason, string>> = {
  stalemate: 'stalemate', repetition: 'threefold repetition', fifty: '50-move rule', material: 'insufficient material', agreement: 'agreed',
};

/** The result line: "White wins: checkmate", "Black wins: White left the table", "Draw: stalemate". */
export function endText(end: GameEnd): string {
  if (end.winner) {
    const loser = SIDE_NAME[otherSide(end.winner)];
    const why = end.reason === 'resigned' ? `${loser} resigned` : end.reason === 'left' ? `${loser} left the table` : end.reason;
    return `${SIDE_NAME[end.winner]} wins: ${why}`;
  }
  if (end.reason === 'left') return 'Game over: both players left the table';
  return `Draw: ${DRAWN[end.reason] ?? end.reason}`;
}

/** The games built so far; a slot whose kind has no rules here is just a table place. */
export const RULES: Partial<Record<GameKind, () => GameRules>> = { chess: () => new ChessGame() };

/** A game replayed from its entries; null when the kind has no rules or an entry isn't legal. */
export function replay(kind: GameKind, moves: readonly string[], rules = RULES): GameRules | null {
  const make = rules[kind];
  if (!make) return null;
  const game = make();
  return moves.every((m) => game.play(m)) ? game : null;
}

/** A game chair: its slot, the side it plays, and its spot (x, z). */
export interface Chair { slot: number; side: Side; x: number; z: number }

/** The game chairs among the seats: `Dining chair S<slot>` plays white, `N<slot>` black. */
export function gameChairs(seats: Seat[]): Chair[] {
  return seats.flatMap((s): Chair[] => {
    const m = /^Dining chair ([NS])(\d)$/.exec(s.name);
    if (!m || Number(m[2]) >= SLOTS.length) return [];
    const [x, , z] = s.spots[0].at;
    return [{ slot: Number(m[2]), side: m[1] === 'S' ? 'white' : 'black', x, z }];
  });
}

/** Who sits in a slot's two chairs (peer ids). */
export interface SlotSeats { white: string | null; black: string | null }
/** A seated visitor and where: the local one by `player.seat`, the others by the seating in their poses. */
export interface Sitter { id: string; x: number; z: number }

/** Who sits in each slot's chairs: whoever is seated within `radius` m of the chair's spot. Two on one chair (a race)
 * gives it to the lower id, the same in every browser. */
export function seatedAt(chairs: Chair[], sitters: Sitter[], radius = CONFIG.games.chairRadius): SlotSeats[] {
  const out: SlotSeats[] = SLOTS.map(() => ({ white: null, black: null }));
  for (const c of chairs) {
    const here = sitters.filter((s) => Math.hypot(s.x - c.x, s.z - c.z) < radius).map((s) => s.id).sort();
    out[c.slot][c.side] = here[0] ?? null;
  }
  return out;
}

/** One slot's whole game, as sent: its id (made by the white player's browser), the two players' peer ids, the
 * entries, and how it ended, once it has. */
export type GameMessage = { slot: number; id: string; white: string; black: string; moves: string[]; end?: GameEnd };

const MAX_ENTRIES = 1000;
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isEnd = (v: unknown): v is GameEnd => {
  const e = v as GameEnd | null;
  return !!e && typeof e === 'object' && (e.winner === 'white' || e.winner === 'black' || e.winner === null)
    && (END_REASONS as readonly unknown[]).includes(e.reason);
};

export function isGameMessage(v: unknown): v is GameMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.slot === 'number' && Number.isInteger(m.slot) && m.slot >= 0 && m.slot < SLOTS.length
    && isText(m.id) && isText(m.white) && isText(m.black) && m.white !== m.black
    && Array.isArray(m.moves) && m.moves.length <= MAX_ENTRIES && m.moves.every((e) => typeof e === 'string' && e.length <= 8)
    && (m.end === undefined || isEnd(m.end));
}

/** A slot's game here: the rules replayed so far, and `left` once a player left their chair (worked out here). */
export interface SlotGame { id: string; white: string; black: string; rules: GameRules; left: GameEnd | null }

/** How a slot's game ended: by its rules, a resignation or an agreement, else by a player leaving. */
export function endOf(g: SlotGame): GameEnd | null {
  return g.rules.end() ?? g.left;
}

/** The end when a player is out of their chair: the one still seated wins. */
export function leftEnd(whiteHere: boolean, blackHere: boolean): GameEnd | null {
  if (whiteHere && blackHere) return null;
  return { winner: whiteHere ? 'white' : blackHere ? 'black' : null, reason: 'left' };
}

/**
 * The table's games as this browser sees them. Every frame `update` takes who sits where: a running game whose player
 * left their chair ends; the white player's browser opens a new game when both chairs are taken and none is running.
 * A game from another visitor is taken (`receive`) when it is this slot's game and its entries extend ours and replay
 * legally, when it is a new game for the two visitors in the chairs now, or, ended, to show in a slot with no game yet
 * (a newcomer's). One that names players not seen in the chairs yet waits a few seconds for their poses.
 */
export class Games {
  /** Goes up on every change, for the overlay to redraw. */
  version = 0;
  private games: (SlotGame | null)[] = SLOTS.map(() => null);
  private pending: ({ message: GameMessage; at: number } | null)[] = SLOTS.map(() => null);
  /** A new game may open: the slot has had an empty chair since its last game opened here. */
  private armed: boolean[] = SLOTS.map(() => true);
  private seats: SlotSeats[] = SLOTS.map(() => ({ white: null, black: null }));
  private now = 0;

  constructor(private selfId: () => string, private newId: () => string, private rules = RULES) {}

  at(slot: number): SlotGame | null {
    return this.games[slot] ?? null;
  }

  /** Who sat in the slot's chairs at the last update. */
  seatsAt(slot: number): SlotSeats {
    return this.seats[slot];
  }

  /** A slot with rules: sitting there makes you a player. */
  playable(slot: number): boolean {
    return !!this.rules[SLOTS[slot].kind];
  }

  /** Where a visitor sits at a playable slot, at the last update. */
  seatOf(id: string): { slot: number; side: Side } | null {
    for (let slot = 0; slot < SLOTS.length; slot++) {
      if (!this.playable(slot)) continue;
      const s = this.seats[slot];
      if (s.white === id) return { slot, side: 'white' };
      if (s.black === id) return { slot, side: 'black' };
    }
    return null;
  }

  /** Every frame, with who sits where and the time (s). Returns the games this browser opened, to send. */
  update(seats: SlotSeats[], now: number): GameMessage[] {
    this.seats = seats;
    this.now = now;
    const opened: GameMessage[] = [];
    seats.forEach((s, slot) => {
      const make = this.rules[SLOTS[slot].kind];
      if (!make) return;
      const g = this.games[slot];
      if (g && !endOf(g)) {
        const left = leftEnd(s.white === g.white, s.black === g.black);
        if (left) {
          g.left = left;
          this.version++;
        }
      }
      const p = this.pending[slot];
      if (p && (now - p.at > CONFIG.games.pendingFor || this.adopt(p.message))) this.pending[slot] = null;
      if (!s.white || !s.black) this.armed[slot] = true;
      else if (this.armed[slot] && s.white === this.selfId() && !this.running(slot)) {
        this.games[slot] = { id: this.newId(), white: s.white, black: s.black, rules: make(), left: null };
        this.armed[slot] = false;
        this.version++;
        opened.push(this.message(slot)!);
      }
    });
    return opened;
  }

  /** A game from another visitor; returns whether it was taken. */
  receive(m: GameMessage): boolean {
    if (!this.playable(m.slot)) return false;
    const g = this.games[m.slot];
    if (g?.id === m.id) return this.extend(g, m);
    if (this.adopt(m)) return true;
    this.pending[m.slot] = { message: m, at: this.now };
    return false;
  }

  /** An entry by this visitor, who must be the slot's player to move. Returns the game to send, or null. */
  play(slot: number, entry: string): GameMessage | null {
    const g = this.games[slot];
    if (!g || endOf(g)) return null;
    const side = g.rules.turn();
    const me = this.selfId();
    if (g[side] !== me || this.seats[slot][side] !== me || !g.rules.play(entry)) return null;
    this.version++;
    return this.message(slot);
  }

  /** A slot's game as sent. */
  message(slot: number): GameMessage | null {
    const g = this.games[slot];
    if (!g) return null;
    const end = endOf(g);
    return { slot, id: g.id, white: g.white, black: g.black, moves: [...g.rules.moves], ...(end ? { end } : {}) };
  }

  /** Every slot's game, for a newcomer (with the flat's state). */
  messages(): GameMessage[] {
    return SLOTS.flatMap((_, slot) => this.message(slot) ?? []);
  }

  private running(slot: number): boolean {
    const g = this.games[slot];
    return !!g && !endOf(g);
  }

  /** More entries for this slot's game. A game that has ended here takes no more. */
  private extend(g: SlotGame, m: GameMessage): boolean {
    const have = g.rules.moves;
    if (endOf(g) || m.moves.length <= have.length || have.some((e, i) => m.moves[i] !== e)) return false;
    const rules = replay(g.rules.kind, m.moves, this.rules);
    if (!rules) return false;
    g.rules = rules;
    this.version++;
    return true;
  }

  /** Another game in this slot: a new one for the two in its chairs now (unless one is running), or a finished one
   * where there's no game yet. */
  private adopt(m: GameMessage): boolean {
    const g = this.games[m.slot];
    const s = this.seats[m.slot];
    const forSeated = s.white === m.white && s.black === m.black && !this.running(m.slot);
    if (!forSeated && !(!g && m.end)) return false;
    const rules = replay(SLOTS[m.slot].kind, m.moves, this.rules);
    if (!rules) return false;
    this.games[m.slot] = { id: m.id, white: m.white, black: m.black, rules, left: rules.end() ? null : m.end ?? null };
    this.version++;
    return true;
  }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/games.test.ts`
Expected: PASS (20 tests).

Run: `cd web && npm test && npm run build`
Expected: 38 test files, 339 tests pass; the build is clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/games.ts web/src/config.ts web/tests/games.test.ts
git commit -m "Games: who sits where, opening and ending games, accepting others' games

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sharing games, seeing who sits, holding a seated player

**Files:**
- Modify: `web/src/multiplayer.ts`
- Modify: `web/src/avatars.ts` (a `seated()` method before `remove`)
- Modify: `web/src/player.ts` (a `held` field and one condition in `update`)
- Test: `web/tests/multiplayer.test.ts`, `web/tests/avatars.test.ts`, `web/tests/seats.test.ts` (the `Player` tests live there)

**Interfaces:**
- Consumes (Task 2): `GameMessage`, `isGameMessage` from `./games`.
- Produces:
  - `MessageKind` gains `'game'`
  - `MultiplayerHooks.onGame?: (game: GameMessage) => void` (well-formed games only), `MultiplayerHooks.games?: () => GameMessage[]` (sent after the full state to a peer that asked)
  - `Multiplayer.sendGame(game: GameMessage): void` (to everyone)
  - `Avatars.seated(): { id: string; x: number; z: number }[]` (visible figures with a seating, at their pose's target x, z)
  - `Player.held: boolean` (default false): while true, moving doesn't stand a seated player up

- [ ] **Step 1: Write the failing tests**

In `web/tests/multiplayer.test.ts`, add after the `DoorState` import:

```ts
import type { GameMessage } from '../src/games';
```

Replace the body of `setup` from `const hosts: string[] = [];` to its `return` so it reads:

```ts
  const hosts: string[] = [];
  const games: GameMessage[] = [];
  let running: GameMessage[] = [];
  const mp = new Multiplayer(fake.room, world, avatars, 'Ana', {
    now: () => now, onChanged: (k) => void changed.push(k), onPeers: (n) => void peers.push(n), onHost: (h) => void hosts.push(h),
    onGame: (g) => void games.push(g), games: () => running,
  }, joinedAt, arrived);
  return {
    fake, world, avatars, mp, changed, peers, hosts, games, setNow: (t: number) => { now = t; }, setGames: (g: GameMessage[]) => { running = g; },
    node: new Object3D(),
  };
```

Insert these tests just before `it('asks a peer that comes back after timing out who it is, and answers when asked', …)`:

```ts
  it("sends the table's games after the flat's state to a newcomer who asks", () => {
    const { fake, setGames } = setup();
    const chess: GameMessage = { slot: 0, id: 'g1', white: 'me', black: 'p2', moves: ['e2e4'] };
    setGames([chess]);
    fake.receive('state', { want: 1 }, 'p1');
    expect(fake.sent.slice(-2).map((s) => [s.kind, s.to])).toEqual([['state', 'p1'], ['game', 'p1']]);
    expect(fake.sent.at(-1)?.data).toEqual(chess);
  });
  it('passes on well-formed games and broadcasts its own', () => {
    const { fake, mp, games, avatars } = setup();
    const chess: GameMessage = { slot: 0, id: 'g1', white: 'p1', black: 'me', moves: [] };
    fake.receive('game', chess, 'p1');
    fake.receive('game', { slot: 7 }, 'p1');
    expect(games).toEqual([chess]);
    expect(avatars.has('p1')).toBe(true); // a sign of life, like any message
    mp.sendGame({ ...chess, moves: ['e2e4'] });
    expect(fake.sent.at(-1)).toEqual({ kind: 'game', data: { ...chess, moves: ['e2e4'] } });
  });
```

In `web/tests/avatars.test.ts`, insert just before `it('removes figures', …)`:

```ts
  it('lists the seated, at the spot their pose named, not those standing or without a pose', () => {
    const a = new Avatars(null);
    a.add('p1', '#ff0000', 'Ana');
    a.add('p2', '#00ff00', 'Rui');
    a.add('p3', '#0000ff', 'Zé');
    a.setPose('p1', [1.248, 3.886, 0, 0, 1, 0.45, 0]);
    a.setPose('p2', [5, 5, 0, 0]);
    expect(a.seated()).toEqual([{ id: 'p1', x: 1.248, z: 3.886 }]);
  });

```

In `web/tests/seats.test.ts`, insert just before `it('stands up from the stick too, and teleporting gets up', …)`:

```ts
  it('stays seated at a game board whatever the keys and the stick say', () => {
    const { p } = make();
    p.sit(seatedOn(sofa.spots[0], 'sit'));
    p.held = true;
    p.keys.forward = true;
    p.update(0.05);
    p.stick = { forward: 1, right: 0, run: true };
    p.update(0.05);
    expect(p.seat).not.toBeNull();
    expect([p.x, p.z]).toEqual([0.9, 6.6]);
    p.held = false;
    p.update(0.05);
    expect(p.seat).toBeNull();
  });

```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/multiplayer.test.ts tests/avatars.test.ts tests/seats.test.ts`
Expected: FAIL. TypeScript-level errors are not checked by Vitest, so the failures are: no `game` handler (`handlers.get('game')` is undefined, a TypeError), `mp.sendGame is not a function`, `a.seated is not a function`, and the held player standing up.

- [ ] **Step 3: `multiplayer.ts`**

Add after `import { CONFIG } from './config';`:

```ts
import { type GameMessage, isGameMessage } from './games';
```

Replace the two lines that define the message kinds:

```ts
export type MessageKind = 'hello' | 'pose' | 'state' | 'game';
const KINDS: MessageKind[] = ['hello', 'pose', 'state', 'game'];
```

In `MultiplayerHooks`, after `onHost?: (hostId: string) => void;`, add:

```ts
  /** A dining-table game another visitor sent (well-formed; whether to take it is the games' call). */
  onGame?: (game: GameMessage) => void;
  /** The table's games, sent to a newcomer with the flat's state. */
  games?: () => GameMessage[];
```

In the constructor's `'state'` handler, replace the line `if ('want' in data) return room.send('state', { ...collectState(world), full: 1 }, id);` with:

```ts
      if ('want' in data) {
        room.send('state', { ...collectState(world), full: 1 }, id);
        for (const game of hooks.games?.() ?? []) room.send('game', game, id);
        return;
      }
```

At the end of the constructor, after the `'state'` handler's closing `});`, add:

```ts
    room.onMessage('game', (data, id) => {
      if (!isGameMessage(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      hooks.onGame?.(data);
    });
```

Add this method just before `/** Every frame: drop the silent. */`:

```ts
  /** Tells the others about a game this visitor opened or moved in. */
  sendGame(game: GameMessage): void {
    this.room.send('game', game);
  }

```

`GameMessage` is a `type` alias, so it is assignable to the `Json` that `Room.send` takes.

- [ ] **Step 4: `avatars.ts`**

Insert just before `  remove(id: string): void {`:

```ts
  /** The visitors sitting or lying, at the spot their last pose named (for the dining table's games). */
  seated(): { id: string; x: number; z: number }[] {
    const out: { id: string; x: number; z: number }[] = [];
    for (const [id, f] of this.figures) if (f.root.visible && f.seating) out.push({ id, x: f.target[0], z: f.target[1] });
    return out;
  }

```

- [ ] **Step 5: `player.ts`**

After the field `  frozen = false;` in `Player`, add:

```ts
  /** At a game board: the movement keys and stick neither walk nor stand you up (standing is the board's button or C). */
  held = false;
```

In `update`, replace `      else if (!this.holdingMove && !this.frozen) this.stand();` with:

```ts
      else if (!this.holdingMove && !this.frozen && !this.held) this.stand();
```

(Seated, the player never walks anyway: the walking branch is `if (!this.frozen && !this.seat)`.)

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/multiplayer.test.ts tests/avatars.test.ts tests/seats.test.ts`
Expected: PASS (24, 17 and 12 tests).

Run: `cd web && npm test && npm run build`
Expected: 38 test files, 343 tests pass; the build is clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/multiplayer.ts web/src/avatars.ts web/src/player.ts web/tests/multiplayer.test.ts web/tests/avatars.test.ts web/tests/seats.test.ts
git commit -m "Games: the game message, who sits where, and a player held at the board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The boards on the table (`table-pieces.ts`, `chess-set.ts`)

**Files:**
- Modify: `web/src/config.ts` (the `games` block)
- Create: `web/src/table-pieces.ts`
- Create: `web/src/chess-set.ts`
- Test: `web/tests/table-pieces.test.ts`

**Interfaces:**
- Consumes (Task 1): `ChessGame` (`pieces()`), `GameRules`, `SLOTS`. (Task 2): `SlotGame`. Existing: `makeMatcaps`, `Matcaps` from `./creatures`; `CanvasFactory`, `domCanvas` from `./screens`; `ease` from `./player`.
- Produces:
  - `CONFIG.games.slots: [number, number][]`, `CONFIG.games.tableTop: number`, `CONFIG.games.slide: number`, `CONFIG.games.chess: { size; border; thickness; white; black; light; dark; wood }`
  - `interface TableSet { readonly root: Object3D; show(game: GameRules | null): void; update(dt: number): void }`
  - `class TableMaterials { constructor(matcaps: Matcaps); make(name: string, colour: string, map?: Texture | null, gloss?: boolean): MeshMatcapMaterial; setLight(level: number): void }`
  - `class TableGames { readonly root: Group; constructor(canvas?: CanvasFactory | null); update(dt: number, gameAt: (slot: number) => SlotGame | null, light: number): void }`
  - `squarePosition(square: string, cfg?): [x, z]`, `lostPosition(color: 'w' | 'b', n: number, cfg?): [x, z]`, `pieceGeometries(): Record<PieceSymbol, BufferGeometry>`, `class ChessSet implements TableSet { readonly pieces: Map<string, Mesh> /* by starting square */; constructor(materials: TableMaterials, canvas: CanvasFactory | null) }`

The board's orientation: white's rank 1 is toward +z (the S chairs are at z 3.8857, the N chairs at z 2.5143), file a toward -x. Checked: an S chair's yaw 0 looks along -z, and its right hand is +x.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/table-pieces.test.ts`:

```ts
import { type Mesh, MeshMatcapMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { ChessGame } from '../src/chess-game';
import { ChessSet, lostPosition, pieceGeometries, squarePosition } from '../src/chess-set';
import { CONFIG } from '../src/config';
import type { SlotGame } from '../src/games';
import { TableGames, TableMaterials } from '../src/table-pieces';

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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/table-pieces.test.ts`
Expected: FAIL: `../src/chess-set` and `../src/table-pieces` cannot be resolved.

- [ ] **Step 3: Config**

In `web/src/config.ts`'s `games` block, insert before the `chairRadius` doc comment:

```ts
    /** Each slot's middle (x, z): halfway between its two chairs' spots in seats.json (z 3.2), and level with them,
     * except slot 0, 10 cm toward the table's end to clear the fruit bowl. */
    slots: [[1.15, 3.2], [1.8, 3.2], [2.35, 3.2]] as [number, number][],
    /** The table top's height (m): the model's dining table. */
    tableTop: 0.76,
```

and after `pendingFor: 5,`:

```ts
    /** Seconds a piece takes to slide to its square. */
    slide: 0.3,
    /** The chessboard: its size, the wooden border and its thickness (m), and the colours. */
    chess: {
      size: 0.4, border: 0.02, thickness: 0.015,
      white: '#efe6d2', black: '#4a3b33', light: '#e8d5b0', dark: '#9c6b4a', wood: '#6b4630',
    },
```

- [ ] **Step 4: The frame**

Create `web/src/table-pieces.ts`. It imports `ChessSet` at runtime; `chess-set.ts` imports only types back, so there is no runtime cycle. A slot whose kind has no set yet (backgammon, Go) gets `null` and nothing on the table.

```ts
import { Color, Group, MeshMatcapMaterial, type Object3D, type Texture } from 'three';
import { ChessSet } from './chess-set';
import { CONFIG } from './config';
import { makeMatcaps, type Matcaps } from './creatures';
import { type GameRules, type SlotGame, SLOTS } from './games';
import { type CanvasFactory, domCanvas } from './screens';

/** One slot's board and pieces on the table. Each game adds its own: chess now, backgammon and Go later. */
export interface TableSet {
  readonly root: Object3D;
  /** The game to show, when it changes; null shows the starting position. */
  show(game: GameRules | null): void;
  /** Every frame: pieces on their way slide on. */
  update(dt: number): void;
}

/**
 * The table sets' materials: matcaps like the visitors' animals (the room's light is baked, so it never reaches them),
 * dimmed together with the light where the table is.
 */
export class TableMaterials {
  private tints: { material: MeshMatcapMaterial; base: Color }[] = [];
  private level = 1;

  constructor(private matcaps: Matcaps) {}

  make(name: string, colour: string, map: Texture | null = null, gloss = false): MeshMatcapMaterial {
    const base = new Color(colour);
    const material = new MeshMatcapMaterial({ name, color: base.clone(), map, matcap: (gloss ? this.matcaps.gloss : this.matcaps.matte) ?? null });
    this.tints.push({ material, base });
    return material;
  }

  /** How lit the table is, 0..1 (`figureLight`). */
  setLight(level: number): void {
    if (Math.abs(level - this.level) < 1e-3) return;
    this.level = level;
    for (const t of this.tints) t.material.color.copy(t.base).multiplyScalar(level);
  }
}

/** The games on the dining table, as everyone sees them: each playable slot's board at its place on the table. */
export class TableGames {
  readonly root = new Group();
  private materials: TableMaterials;
  private sets: (TableSet | null)[];
  private shown: string[] = SLOTS.map(() => '');

  constructor(canvas: CanvasFactory | null = typeof document === 'undefined' ? null : domCanvas) {
    this.root.name = 'Table games';
    this.materials = new TableMaterials(makeMatcaps(canvas));
    const { slots, tableTop } = CONFIG.games;
    this.sets = SLOTS.map((s, i) => {
      const set = s.kind === 'chess' ? new ChessSet(this.materials, canvas) : null;
      if (!set) return null;
      set.root.position.set(slots[i][0], tableTop, slots[i][1]);
      this.root.add(set.root);
      return set;
    });
  }

  /** Every frame: each slot's game (redrawn when it or its moves change), the slides, and the light at the table. */
  update(dt: number, gameAt: (slot: number) => SlotGame | null, light: number): void {
    this.materials.setLight(light);
    this.sets.forEach((set, slot) => {
      if (!set) return;
      const g = gameAt(slot);
      const key = g ? `${g.id}:${g.rules.moves.length}` : '';
      if (key !== this.shown[slot]) {
        this.shown[slot] = key;
        set.show(g?.rules ?? null);
      }
      set.update(dt);
    });
  }
}
```

- [ ] **Step 5: The chess set**

Create `web/src/chess-set.ts`. The checker texture is drawn as white sees the board (canvas row 0 = rank 8, column 0 = file a); a `PlaneGeometry` rotated by -π/2 about x puts the texture's top at -z, so rank 8 lands at black's end and a1 is dark. Without a canvas (tests) the top is plain wood. The ExtrudeGeometry knight head is drawn facing +x and turned by `rotateY(π/2)` to face -z; black's pieces are turned by π.

```ts
import type { Color as ChessColor, PieceSymbol } from 'chess.js';
import {
  BoxGeometry, type BufferGeometry, CanvasTexture, ExtrudeGeometry, Group, LatheGeometry, Mesh, type MeshMatcapMaterial,
  PlaneGeometry, Shape, SRGBColorSpace, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ChessGame } from './chess-game';
import { CONFIG } from './config';
import type { GameRules } from './games';
import { ease } from './player';
import type { CanvasFactory } from './screens';
import type { TableMaterials, TableSet } from './table-pieces';

type Profile = [number, number][];

/** Turned pieces: radius and height (m) from the foot up the axis, for a 4.5 cm square. */
const PROFILES: Record<Exclude<PieceSymbol, 'n'>, Profile> = {
  p: [[0, 0], [0.015, 0], [0.015, 0.004], [0.012, 0.007], [0.008, 0.012], [0.006, 0.022], [0.009, 0.025], [0.006, 0.027],
    [0.0075, 0.03], [0.008, 0.034], [0.0065, 0.038], [0.004, 0.04], [0, 0.041]],
  r: [[0, 0], [0.017, 0], [0.017, 0.005], [0.014, 0.008], [0.011, 0.012], [0.01, 0.036], [0.013, 0.04], [0.013, 0.05],
    [0.01, 0.05], [0.01, 0.046], [0, 0.046]],
  b: [[0, 0], [0.016, 0], [0.016, 0.005], [0.013, 0.008], [0.008, 0.014], [0.006, 0.034], [0.01, 0.037], [0.006, 0.04],
    [0.009, 0.046], [0.008, 0.052], [0.005, 0.057], [0.002, 0.059], [0.003, 0.061], [0, 0.063]],
  q: [[0, 0], [0.018, 0], [0.018, 0.005], [0.015, 0.008], [0.009, 0.016], [0.007, 0.044], [0.011, 0.048], [0.007, 0.051],
    [0.012, 0.062], [0.011, 0.066], [0.006, 0.066], [0.004, 0.069], [0, 0.071]],
  k: [[0, 0], [0.018, 0], [0.018, 0.005], [0.015, 0.008], [0.009, 0.016], [0.007, 0.048], [0.011, 0.052], [0.007, 0.055],
    [0.011, 0.066], [0.01, 0.069], [0, 0.069]],
};
const KNIGHT_FOOT: Profile = [[0, 0], [0.017, 0], [0.017, 0.005], [0.014, 0.008], [0.011, 0.012], [0, 0.012]];
/** The knight's head in profile, facing +x (m): chest, muzzle, ears. */
const KNIGHT_HEAD: [number, number][] = [
  [-0.01, 0.01], [0.01, 0.01], [0.008, 0.025], [0.004, 0.032], [0.016, 0.038], [0.018, 0.044], [0.012, 0.048],
  [0.004, 0.052], [-0.002, 0.058], [-0.004, 0.052], [-0.01, 0.046], [-0.012, 0.03],
];

const lathe = (p: Profile) => new LatheGeometry(p.map(([r, y]) => new Vector2(r, y)), 24);
const merge = (parts: BufferGeometry[]) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));

/** One geometry per kind of piece, shared by both sides; knights face -z (toward black, for white). */
export function pieceGeometries(): Record<PieceSymbol, BufferGeometry> {
  const head = new ExtrudeGeometry(new Shape(KNIGHT_HEAD.map(([x, y]) => new Vector2(x, y))), {
    depth: 0.01, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 2,
  }).translate(0, 0, -0.005).rotateY(Math.PI / 2);
  return {
    p: lathe(PROFILES.p),
    r: lathe(PROFILES.r),
    b: lathe(PROFILES.b),
    q: lathe(PROFILES.q),
    k: merge([lathe(PROFILES.k), new BoxGeometry(0.004, 0.014, 0.004).translate(0, 0.076, 0), new BoxGeometry(0.011, 0.004, 0.004).translate(0, 0.077, 0)]),
    n: merge([lathe(KNIGHT_FOOT), head]),
  };
}

/** A square's middle on the board (x, z from the board's centre): white's rank 1 toward +z (the S chair), file a
 * toward -x. */
export function squarePosition(square: string, cfg = CONFIG.games.chess): [number, number] {
  const step = (cfg.size - 2 * cfg.border) / 8;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return [(file - 3.5) * step, (3.5 - rank) * step];
}

/** Where the `n`th piece a side has lost stands: on the table in front of the player who took it (white's lost
 * pieces by black's edge of the board, black's by white's), from file a, a second row further out after eight. */
export function lostPosition(color: ChessColor, n: number, cfg = CONFIG.games.chess): [number, number] {
  const step = (cfg.size - 2 * cfg.border) / 8;
  const toward = color === 'w' ? -1 : 1;
  return [(n % 8 - 3.5) * step, toward * (cfg.size / 2 + step * (0.8 + Math.floor(n / 8) * 0.9))];
}

/** The board's top: a wooden border and the 64 squares, drawn as white sees them (rank 8 at the top). */
function drawBoard(ctx: CanvasRenderingContext2D, px: number, cfg = CONFIG.games.chess): void {
  ctx.fillStyle = cfg.wood;
  ctx.fillRect(0, 0, px, px);
  const edge = (cfg.border / cfg.size) * px;
  const step = (px - 2 * edge) / 8;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = 7 - row;
      ctx.fillStyle = (col + rank) % 2 === 0 ? cfg.dark : cfg.light; // a1 dark
      ctx.fillRect(edge + col * step, edge + row * step, step, step);
    }
  }
}

interface Placed { mesh: Mesh; type: PieceSymbol; from: Vector3; to: Vector3; t: number; lift: boolean }

/** The chessboard on the table: 32 turned pieces that slide to their squares; taken pieces lift off to the side. */
export class ChessSet implements TableSet {
  readonly root = new Group();
  /** Each piece by its starting square. */
  readonly pieces = new Map<string, Mesh>();
  private placed = new Map<string, Placed>();
  private geometry = pieceGeometries();

  constructor(materials: TableMaterials, canvas: CanvasFactory | null) {
    const cfg = CONFIG.games.chess;
    this.root.name = 'Chess';
    const wood = materials.make('Chess board', cfg.wood);
    const frame = new Mesh(new BoxGeometry(cfg.size, cfg.thickness, cfg.size), wood);
    frame.position.y = cfg.thickness / 2;
    let top: MeshMatcapMaterial = wood;
    const surface = canvas?.(512, 512);
    const ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (surface && ctx) {
      drawBoard(ctx, 512);
      const map = new CanvasTexture(surface as unknown as HTMLCanvasElement);
      map.colorSpace = SRGBColorSpace;
      top = materials.make('Chess squares', '#ffffff', map);
    }
    const squares = new Mesh(new PlaneGeometry(cfg.size, cfg.size).rotateX(-Math.PI / 2), top);
    squares.position.y = cfg.thickness + 0.0005;
    this.root.add(frame, squares);
    const sides = { w: materials.make('Chess white', cfg.white, null, true), b: materials.make('Chess black', cfg.black, null, true) };
    for (const p of new ChessGame().pieces()) {
      const mesh = new Mesh(this.geometry[p.type], sides[p.color]);
      mesh.name = `Chess ${p.id}`;
      if (p.color === 'b') mesh.rotation.y = Math.PI; // black's knights face white
      const [x, z] = squarePosition(p.square!);
      mesh.position.set(x, cfg.thickness, z);
      this.root.add(mesh);
      this.pieces.set(p.id, mesh);
      this.placed.set(p.id, { mesh, type: p.type, from: mesh.position.clone(), to: mesh.position.clone(), t: 1, lift: false });
    }
  }

  show(game: GameRules | null): void {
    const thickness = CONFIG.games.chess.thickness;
    const pieces = (game instanceof ChessGame ? game : new ChessGame()).pieces();
    for (const p of pieces) {
      const item = this.placed.get(p.id)!;
      if (item.type !== p.type) {
        item.type = p.type;
        item.mesh.geometry = this.geometry[p.type];
      }
      const [x, z] = p.square ? squarePosition(p.square) : lostPosition(p.color, p.lost);
      const y = p.square ? thickness : 0;
      if (item.to.x === x && item.to.y === y && item.to.z === z) continue;
      item.from.copy(item.mesh.position);
      item.to.set(x, y, z);
      item.t = 0;
      item.lift = !p.square;
    }
  }

  update(dt: number): void {
    for (const item of this.placed.values()) {
      if (item.t >= 1) continue;
      item.t = Math.min(1, item.t + dt / CONFIG.games.slide);
      if (item.t === 1) {
        item.mesh.position.copy(item.to);
        continue;
      }
      item.mesh.position.lerpVectors(item.from, item.to, ease(item.t));
      if (item.lift) item.mesh.position.y += Math.sin(Math.PI * item.t) * 0.05;
    }
  }
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/table-pieces.test.ts`
Expected: PASS (7 tests).

Run: `cd web && npm test && npm run build`
Expected: 39 test files, 350 tests pass; the build is clean. (Nothing shows in the walkthrough yet: `main.ts` adds the table in Task 6.)

- [ ] **Step 7: Commit**

```bash
git add web/src/config.ts web/src/table-pieces.ts web/src/chess-set.ts web/tests/table-pieces.test.ts
git commit -m "Games: the chessboard and pieces on the dining table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The player's panel (`board-panel.ts`, `chess-board.ts`)

**Files:**
- Create: `web/src/board-panel.ts`
- Create: `web/src/chess-board.ts`
- Modify: `web/index.html` (the panel's markup in `#hud`)
- Modify: `web/src/style.css`
- Test: `web/tests/board-panel.test.ts`

**Interfaces:**
- Consumes (Task 1): `ChessGame` (`pieceAt`, `targets`, `lastMove`, `pieces`, `turn`, `inCheck`, `moves`), `endText`, `otherSide`, `GameEnd`, `GameRules`, `Side`.
- Produces:
  - `GAME_COPY` (the copy in Global Constraints, as `waiting`, `settingUp`, `yourMove`, `yourMoveCheck`, `emptyChair`, `you`, `white`, `black`, `resign`, `offerDraw`, `acceptDraw`, `drawOffered`, `standUp`, `standAndResign`, `resignGame`, `keepPlaying`)
  - `interface PanelBoard { readonly element: HTMLElement; draw(game: GameRules | null, you: Side, live: boolean): void }`
  - `interface PanelPlayer { name: string; colour: string }`
  - `interface PanelInput { you: Side; draws: boolean; me: PanelPlayer; them: PanelPlayer | null; game: GameRules | null; end: GameEnd | null }`
  - `type DrawButton = 'offer' | 'accept' | 'offered' | null`, `interface PanelState { status: string; live: boolean; resign: boolean; draw: DrawButton; drawEnabled: boolean }`, `panelState(input: PanelInput): PanelState`
  - `interface PanelHandlers { resign(): void; draw(): void; stand(): void }`
  - `class BoardPanel { constructor(doc: Document, handlers: PanelHandlers); readonly isOpen: boolean; open(title: string, board: PanelBoard): void; close(): void; confirm(question: string, yes: string, onYes: () => void): void; render(input: PanelInput, version: number): void }`
  - `class ChessBoard implements PanelBoard { constructor(doc: Document, onMove: (uci: string) => void) }`, `squareCell(square: string, you: Side): [col, row]`, `cellSquare(col: number, row: number, you: Side): Square`, `GLYPHS: Record<PieceSymbol, string>`, `PROMOTIONS`
  - DOM ids: `board-panel`, `board-title`, `board-them`, `board-area`, `board-me`, `board-status`, `board-buttons`, `board-resign`, `board-draw`, `board-stand`, `board-confirm`, `board-confirm-text`, `board-confirm-yes`, `board-confirm-no`

The tests run in Node without a DOM, so they cover the pure parts (`panelState`, the square mapping, the glyphs). The DOM classes are checked by `npm run build` here and by hand in Task 7.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/board-panel.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/board-panel.test.ts`
Expected: FAIL: `../src/board-panel` and `../src/chess-board` cannot be resolved.

- [ ] **Step 3: The panel shell**

Create `web/src/board-panel.ts`:

```ts
import { endText, type GameEnd, type GameRules, otherSide, type Side } from './games';

export const GAME_COPY = {
  waiting: 'Waiting for an opponent',
  settingUp: 'Setting up the board…',
  yourMove: 'Your move',
  yourMoveCheck: 'Your move: check',
  emptyChair: 'Empty chair',
  you: ' (you)',
  white: 'White',
  black: 'Black',
  resign: 'Resign',
  offerDraw: 'Offer draw',
  acceptDraw: 'Accept draw',
  drawOffered: 'Draw offered',
  standUp: 'Stand up',
  standAndResign: 'Stand up and resign?',
  resignGame: 'Resign this game?',
  keepPlaying: 'Keep playing',
};
const theirMove = (name: string) => `${name}'s move`;
const offersDraw = (name: string) => `${name} offers a draw`;

/** A game's own board in the panel: chess now, backgammon and Go later. */
export interface PanelBoard {
  readonly element: HTMLElement;
  /** Draws the game as `you` sit (your side at the bottom); `live`: your move, so clicks play. */
  draw(game: GameRules | null, you: Side, live: boolean): void;
}

export interface PanelPlayer { name: string; colour: string }

export interface PanelInput {
  you: Side;
  /** The slot's game has draw offers (chess). */
  draws: boolean;
  me: PanelPlayer;
  /** Whoever sits opposite; null for an empty chair. */
  them: PanelPlayer | null;
  /** The slot's game if this visitor plays in it (running or ended); null before one starts. */
  game: GameRules | null;
  end: GameEnd | null;
}

export type DrawButton = 'offer' | 'accept' | 'offered' | null;

/** What the panel says and which buttons work. */
export interface PanelState { status: string; live: boolean; resign: boolean; draw: DrawButton; drawEnabled: boolean }

export function panelState({ you, draws, them, game, end }: PanelInput): PanelState {
  const running = !!game && !end;
  const live = running && game.turn() === you;
  const offer = running ? game.drawOffer?.() ?? null : null;
  const name = them?.name ?? GAME_COPY.emptyChair;
  let status: string;
  if (end) status = endText(end);
  else if (!game) status = them ? GAME_COPY.settingUp : GAME_COPY.waiting;
  else if (!live) status = theirMove(name);
  else if (offer === otherSide(you)) status = offersDraw(name);
  else status = game.inCheck?.() ? GAME_COPY.yourMoveCheck : GAME_COPY.yourMove;
  let draw: DrawButton = null;
  let drawEnabled = false;
  if (draws) {
    draw = offer === otherSide(you) ? 'accept' : offer === you ? 'offered' : 'offer';
    drawEnabled = live && draw !== 'offered';
  }
  return { status, live, resign: live, draw, drawEnabled };
}

export interface PanelHandlers {
  resign(): void;
  draw(): void;
  stand(): void;
}

/**
 * The overlay a player gets at a game chair: the board in the middle, your opponent above it and you below, whose
 * move it is or how it ended, and the buttons. Names come from other visitors: they are set as text only.
 */
export class BoardPanel {
  private board: PanelBoard | null = null;
  private last = '';
  private onYes: (() => void) | null = null;

  constructor(private doc: Document, handlers: PanelHandlers) {
    this.el('board-resign').addEventListener('click', () => handlers.resign());
    this.el('board-draw').addEventListener('click', () => handlers.draw());
    this.el('board-stand').addEventListener('click', () => handlers.stand());
    this.el('board-confirm-yes').addEventListener('click', () => {
      const yes = this.onYes;
      this.cancel();
      yes?.();
    });
    this.el('board-confirm-no').addEventListener('click', () => this.cancel());
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.doc.getElementById(id) as T;
  }

  get isOpen(): boolean {
    return !this.el('board-panel').hidden;
  }

  open(title: string, board: PanelBoard): void {
    this.board = board;
    this.last = '';
    this.el('board-title').textContent = title;
    this.el('board-area').replaceChildren(board.element);
    this.el('board-panel').hidden = false;
  }

  close(): void {
    this.cancel();
    this.board = null;
    this.el('board-panel').hidden = true;
  }

  /** Asks before something that can't be undone: `yes` names the button that does it. */
  confirm(question: string, yes: string, onYes: () => void): void {
    this.onYes = onYes;
    this.el('board-confirm-text').textContent = question;
    this.el('board-confirm-yes').textContent = yes;
    this.el('board-confirm').hidden = false;
    this.el('board-buttons').hidden = true;
  }

  private cancel(): void {
    this.onYes = null;
    this.el('board-confirm').hidden = true;
    this.el('board-buttons').hidden = false;
  }

  /** Redraws when something changed: `version` is the games' (it goes up with every move). */
  render(input: PanelInput, version: number): void {
    const key = JSON.stringify([input.you, input.me, input.them, input.end, input.game?.moves.length ?? -1, version]);
    if (key === this.last) return;
    this.last = key;
    const s = panelState(input);
    this.player('board-them', input.them, otherSide(input.you), false);
    this.player('board-me', input.me, input.you, true);
    this.el('board-status').textContent = s.status;
    this.el<HTMLButtonElement>('board-resign').disabled = !s.resign;
    const draw = this.el<HTMLButtonElement>('board-draw');
    draw.hidden = s.draw === null;
    draw.disabled = !s.drawEnabled;
    draw.textContent = s.draw === 'accept' ? GAME_COPY.acceptDraw : s.draw === 'offered' ? GAME_COPY.drawOffered : GAME_COPY.offerDraw;
    this.board?.draw(input.game, input.you, s.live);
  }

  private player(id: string, p: PanelPlayer | null, side: Side, you: boolean): void {
    const row = this.el(id);
    const dot = row.querySelector('i')!;
    const [name, colour] = row.querySelectorAll('span');
    dot.style.background = p?.colour ?? 'transparent';
    name.textContent = p ? `${p.name}${you ? GAME_COPY.you : ''}` : GAME_COPY.emptyChair;
    colour.textContent = side === 'white' ? GAME_COPY.white : GAME_COPY.black;
  }
}
```

- [ ] **Step 4: The chessboard in the panel**

Create `web/src/chess-board.ts`. The board is redrawn whole on each change (64 squares and at most 32 pieces); clicks land on the squares' `rect`s (`data-square`), everything drawn over them has `pointer-events: none`. Glyphs are text, never names, so `textContent` with fixed strings is safe.

```ts
import type { PieceSymbol, Square } from 'chess.js';
import type { PanelBoard } from './board-panel';
import { ChessGame } from './chess-game';
import type { GameRules, Side } from './games';

const SVG = 'http://www.w3.org/2000/svg';
/** The filled glyphs for both sides (the fill tells them apart); U+FE0E keeps phones from drawing emoji. */
export const GLYPHS: Record<PieceSymbol, string> = {
  k: '♚︎', q: '♛︎', r: '♜︎', b: '♝︎', n: '♞︎', p: '♟︎',
};
export const PROMOTIONS: readonly [PieceSymbol, string][] = [['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']];
/** The board's squares start this far down the drawing, under a row for the pieces your opponent has taken. */
const TOP = 0.7;
const COLOURS = {
  light: '#e8d5b0', dark: '#9c6b4a', last: 'rgba(232, 194, 122, 0.55)', selected: 'rgba(232, 194, 122, 0.85)',
  check: 'rgba(226, 92, 80, 0.75)', target: 'rgba(18, 17, 15, 0.35)', white: '#f8f4ea', black: '#2a2622',
};

/** A square's column and row on screen (0..7 from the top left), your own side at the bottom. */
export function squareCell(square: string, you: Side): [number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return you === 'white' ? [file, 7 - rank] : [7 - file, rank];
}

export function cellSquare(col: number, row: number, you: Side): Square {
  const [file, rank] = you === 'white' ? [col, 7 - row] : [7 - col, row];
  return `${'abcdefgh'[file]}${rank + 1}` as Square;
}

/**
 * The chessboard in the panel, drawn in SVG: click one of your pieces to see where it can go, then a target to move
 * there; a pawn reaching the last rank asks which piece it becomes. The last move is marked, and the pieces each side
 * has taken line up above (your opponent's) and below (yours) the board.
 */
export class ChessBoard implements PanelBoard {
  readonly element: HTMLElement;
  private svg: SVGSVGElement;
  private picker: HTMLElement;
  private game: ChessGame | null = null;
  private drawn = -1;
  private you: Side = 'white';
  private live = false;
  private selected: Square | null = null;
  private promoting: string | null = null;

  constructor(private doc: Document, private onMove: (uci: string) => void) {
    this.element = doc.createElement('div');
    this.element.className = 'chess-board';
    this.svg = doc.createElementNS(SVG, 'svg') as SVGSVGElement;
    this.svg.setAttribute('viewBox', `0 0 8 ${8 + 2 * TOP}`);
    this.svg.setAttribute('aria-label', 'Chessboard');
    this.svg.addEventListener('click', (e) => this.click(e));
    this.picker = doc.createElement('div');
    this.picker.className = 'promotion';
    this.picker.hidden = true;
    for (const [piece, name] of PROMOTIONS) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = GLYPHS[piece];
      b.setAttribute('aria-label', name);
      b.addEventListener('click', () => {
        const uci = this.promoting;
        this.promoting = null;
        this.picker.hidden = true;
        if (uci) this.onMove(uci + piece);
      });
      this.picker.append(b);
    }
    this.element.append(this.svg, this.picker);
  }

  draw(game: GameRules | null, you: Side, live: boolean): void {
    const g = game instanceof ChessGame ? game : null;
    const moves = g?.moves.length ?? -1;
    if (g !== this.game || moves !== this.drawn || !live) {
      this.selected = null;
      this.promoting = null;
      this.picker.hidden = true;
    }
    this.game = g;
    this.drawn = moves;
    this.you = you;
    this.live = live;
    this.render();
  }

  private click(e: MouseEvent): void {
    const square = (e.target as Element).closest('[data-square]')?.getAttribute('data-square') as Square | null | undefined;
    const g = this.game;
    if (!g || !this.live || !square || this.promoting) return;
    const target = this.selected ? g.targets(this.selected).find((t) => t.to === square) : undefined;
    if (this.selected && target) {
      const uci = `${this.selected}${square}`;
      this.selected = null;
      if (target.promotion) {
        this.promoting = uci;
        this.picker.hidden = false;
        this.render();
      } else this.onMove(uci);
      return;
    }
    const piece = g.pieceAt(square);
    const mine = piece && (piece.color === 'w') === (this.you === 'white');
    this.selected = mine && square !== this.selected ? square : null;
    this.render();
  }

  private render(): void {
    const g = this.game ?? new ChessGame();
    const last = this.game?.lastMove();
    const targets = this.selected ? g.targets(this.selected) : [];
    const turn = g.turn() === 'white' ? 'w' : 'b';
    const nodes: SVGElement[] = [];
    const node = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const n = this.doc.createElementNS(SVG, tag) as SVGElement;
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text !== undefined) n.textContent = text;
      nodes.push(n);
      return n;
    };
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const square = cellSquare(col, row, this.you);
        const rank = Number(square[1]) - 1;
        const file = square.charCodeAt(0) - 97;
        node('rect', { x: col, y: TOP + row, width: 1, height: 1, fill: (file + rank) % 2 === 0 ? COLOURS.dark : COLOURS.light, 'data-square': square });
        const piece = g.pieceAt(square);
        const mark = square === this.selected ? COLOURS.selected
          : square === last?.from || square === last?.to ? COLOURS.last
          : piece?.type === 'k' && piece.color === turn && g.inCheck() ? COLOURS.check : null;
        if (mark) node('rect', { x: col, y: TOP + row, width: 1, height: 1, fill: mark, 'pointer-events': 'none' });
      }
    }
    for (const p of g.pieces()) {
      if (!p.square) continue;
      const [col, row] = squareCell(p.square, this.you);
      this.glyph(node, p.type, p.color, col + 0.5, TOP + row + 0.54, 0.82);
    }
    for (const t of targets) {
      const [col, row] = squareCell(t.to, this.you);
      const full = !!g.pieceAt(t.to);
      node('circle', {
        cx: col + 0.5, cy: TOP + row + 0.5, r: full ? 0.44 : 0.16, fill: full ? 'none' : COLOURS.target,
        stroke: full ? COLOURS.target : 'none', 'stroke-width': 0.08, 'pointer-events': 'none',
      });
    }
    // Taken pieces: your own lost ones by your opponent (above), theirs by you (below)
    const mine = this.you === 'white' ? 'w' : 'b';
    const lost = g.pieces().filter((p) => !p.square).sort((a, b) => a.lost - b.lost);
    for (const [color, y] of [[mine, TOP / 2], [mine === 'w' ? 'b' : 'w', TOP + 8 + TOP / 2]] as const) {
      lost.filter((p) => p.color === color).forEach((p, i) => this.glyph(node, p.type, color, 0.3 + i * 0.45, y + 0.04, 0.5));
    }
    this.svg.replaceChildren(...nodes);
  }

  private glyph(node: (tag: string, attrs: Record<string, string | number>, text?: string) => SVGElement, type: PieceSymbol, color: 'w' | 'b', x: number, y: number, size: number): void {
    node('text', {
      x, y, 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none',
      fill: color === 'w' ? COLOURS.white : COLOURS.black, stroke: color === 'w' ? COLOURS.black : COLOURS.white,
      'stroke-width': size * 0.03, 'paint-order': 'stroke',
    }, GLYPHS[type]);
  }
}
```

- [ ] **Step 5: Markup**

In `web/index.html`, after `      <div id="prompt" hidden></div>` (inside `#hud`), add:

```html
      <section id="board-panel" aria-labelledby="board-title" hidden>
        <h2 id="board-title"></h2>
        <p class="board-player" id="board-them"><i></i><span></span><span class="board-side"></span></p>
        <div id="board-area"></div>
        <p class="board-player" id="board-me"><i></i><span></span><span class="board-side"></span></p>
        <p id="board-status" aria-live="polite"></p>
        <div id="board-buttons">
          <button type="button" id="board-resign">Resign</button>
          <button type="button" id="board-draw">Offer draw</button>
          <button type="button" id="board-stand">Stand up</button>
        </div>
        <div id="board-confirm" hidden>
          <p id="board-confirm-text"></p>
          <button type="button" id="board-confirm-yes"></button>
          <button type="button" id="board-confirm-no">Keep playing</button>
        </div>
      </section>
```

- [ ] **Step 6: Styles**

In `web/src/style.css`, insert just before the comment `/* The sun panel stays on screen, bottom left. …`:

```css
/* A game at the dining table (board-panel.ts): a panel in the middle while a player sits at the board, the mouse
   free. Your opponent above the board, you below it. It sits under the pause veil. */
#board-panel {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); box-sizing: border-box;
  width: min(440px, calc(100vw - 32px)); max-height: calc(100% - 32px); overflow-y: auto; padding: 12px 16px 14px;
  border-radius: 14px; background: rgba(30, 28, 25, 0.9); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  display: flex; flex-direction: column; gap: 8px; font-size: 14px; text-align: left;
}
#board-panel h2 { margin: 0; font-size: 12px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
.board-player { margin: 0; display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; }
.board-player i { width: 10px; height: 10px; border-radius: 50%; }
.board-player span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-side { color: var(--muted); font-size: 12px; }
#board-area { position: relative; }
.chess-board svg { display: block; width: 100%; height: auto; user-select: none; -webkit-user-select: none; cursor: pointer; }
.chess-board text { font-family: 'Segoe UI Symbol', 'Apple Symbols', 'DejaVu Sans', 'Noto Sans Symbols 2', sans-serif; }
.promotion {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; gap: 6px; padding: 8px;
  border-radius: 10px; background: rgba(30, 28, 25, 0.95); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.promotion button { width: 48px; height: 48px; padding: 0; font-size: 30px; line-height: 1; background: #f8f4ea; color: #2a2622; border-radius: 8px; }
#board-status { margin: 0; min-height: 1.4em; }
#board-buttons, #board-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
#board-buttons button, #board-confirm button { padding: 6px 14px; font-size: 13px; background: rgba(255, 255, 255, 0.12); color: var(--ink); }
#board-stand { margin-left: auto; }
#board-confirm p { margin: 0; flex-basis: 100%; }
#board-confirm #board-confirm-yes { margin-left: auto; background: var(--accent); color: #121110; }
body.touch #board-panel { width: calc(100vw - 16px); padding: 10px 10px 12px; }
```

(`[hidden] { display: none !important; }` at the top of the file keeps `#board-confirm` and `#board-buttons` hidden despite their `display: flex`. The panel has no `z-index`, so the pause veil covers it.)

- [ ] **Step 7: Run the tests and the build**

Run: `cd web && npx vitest run tests/board-panel.test.ts`
Expected: PASS (9 tests).

Run: `cd web && npm test && npm run build`
Expected: 40 test files, 359 tests pass; the build is clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/board-panel.ts web/src/chess-board.ts web/index.html web/src/style.css web/tests/board-panel.test.ts
git commit -m "Games: the player's panel with an SVG chessboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wiring it up (`main.ts`), controls and README

**Files:**
- Modify: `web/src/main.ts`
- Modify: `web/index.html` (both controls lists)
- Modify: `README.md`

**Interfaces:**
- Consumes: `Games`, `gameChairs`, `seatedAt`, `endOf`, `otherSide`, `SLOTS`, `GameKind`, `Side` (Tasks 1–2); `Multiplayer.sendGame`, the `onGame` and `games` hooks, `Avatars.seated()`, `Player.held` (Task 3); `TableGames` (Task 4); `BoardPanel`, `GAME_COPY`, `PanelBoard`, `ChessBoard` (Task 5); `colourFor` from `./presence`.
- Produces: nothing new for other tasks.

No unit tests: this is DOM, pointer-lock and frame-loop wiring. It is checked by `npm run build` and by hand in Task 7.

Names used below that already exist in `run()` in `main.ts`: `avatars`, `scene`, `avatarLight` (defined right after the avatars), `player`, `assets.seats`, `others`, `ui`, `canvas`, `touch`, `autostart`, `started`, `cursor`, `freeing`, `paused`, `lockPointer`, `setPausedState`, `sitOn`, `toggleSit`, `share`. `cursor`, `freeing`, `lockPointer` and `setPausedState` are declared further down than the new code; they are only used inside callbacks that run later, which TypeScript allows.

- [ ] **Step 1: Imports**

After `import { guestList } from './guests';`, add:

```ts
import { BoardPanel, GAME_COPY, type PanelBoard } from './board-panel';
import { ChessBoard } from './chess-board';
import { endOf, gameChairs, type GameKind, Games, otherSide, seatedAt, type Side, SLOTS } from './games';
import { TableGames } from './table-pieces';
```

In the `'./presence'` import, add `colourFor` after `collectState`.

- [ ] **Step 2: The table in the scene, before the shader warm-up**

After `  scene.add(avatars.root);`, add:

```ts
  const tables = new TableGames(); // the dining table's games, in the scene now so the warm-up compiles them too
  scene.add(tables.root);
  const [tableX, tableZ] = CONFIG.games.slots[1]; // the table's middle, for how lit the pieces are
```

- [ ] **Step 3: Seats at the board**

In `sitOn`, replace `if (t?.kind === 'seat' && t.spot && !player.frozen) player.sit(seatedOn(t.spot, t.seat.pose));` with:

```ts
    if (t?.kind === 'seat' && t.spot && !player.frozen && !player.held) player.sit(seatedOn(t.spot, t.seat.pose));
```

In `toggleSit`, after `if (player.frozen) return;`, add:

```ts
    if (player.held) return standFromBoard(); // at a game board: asks first while a game runs
```

- [ ] **Step 4: The games, the panel, and the per-frame update**

After the `share` function (`const share = (t: Target | null) => { … };`), add:

```ts
  /** The dining table's games (games.ts): who sits in the game chairs, the games, and the panel a player gets. */
  const selfId = () => others?.selfId ?? 'self';
  const chairs = gameChairs(assets.seats);
  const games = new Games(selfId, () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const boards: Partial<Record<GameKind, PanelBoard>> = { chess: new ChessBoard(document, (uci) => playEntry(uci)) };
  /** Where this visitor plays while the panel is open: the slot and the side. */
  let atBoard: { slot: number; side: Side } | null = null;
  const playEntry = (entry: string) => {
    const m = atBoard && games.play(atBoard.slot, entry);
    if (m) others?.sendGame(m);
  };
  /** Gets up from the board; the frame loop closes the panel, and the view looks around again. */
  const standUp = () => {
    player.stand();
    if (cursor && !touch) lockPointer();
  };
  /** The panel's Stand up, or C: while your game runs it asks first, and on your move standing resigns it. */
  const standFromBoard = () => {
    const g = atBoard && games.at(atBoard.slot);
    if (!atBoard || !g || g[atBoard.side] !== selfId() || endOf(g)) return standUp();
    const side = atBoard.side;
    boardPanel.confirm(GAME_COPY.standAndResign, GAME_COPY.standUp, () => {
      if (g.rules.turn() === side) playEntry('resign');
      standUp();
    });
  };
  const boardPanel = new BoardPanel(document, {
    resign: () => boardPanel.confirm(GAME_COPY.resignGame, GAME_COPY.resign, () => playEntry('resign')),
    draw: () => {
      const g = atBoard && games.at(atBoard.slot);
      playEntry(g?.rules.drawOffer?.() ? 'draw!' : 'draw?');
    },
    stand: () => standFromBoard(),
  });
  const nameOf = (id: string) =>
    id === selfId() ? cleanName(ui.getName()) : others?.people.find((p) => p.id === id)?.name ?? CONFIG.multiplayer.defaultName;
  /** Frees the mouse for the panel, as Tab does. */
  const freeMouse = () => {
    if (touch || autostart || document.pointerLockElement !== canvas) return;
    freeing = true;
    document.exitPointerLock();
  };
  /** From the frame loop (`now` in seconds): who sits at the table, the games, the boards on it, and the panel. */
  const updateGames = (dt: number, now: number) => {
    const sitters = avatars.seated();
    if (player.seat) sitters.push({ id: selfId(), x: player.seat.x, z: player.seat.z });
    for (const m of games.update(seatedAt(chairs, sitters), now)) others?.sendGame(m);
    tables.update(dt, (slot) => games.at(slot), avatarLight(tableX, tableZ));
    const seat = started && !autostart ? games.seatOf(selfId()) : null;
    const board = seat && boards[SLOTS[seat.slot].kind];
    if (!seat || !board) {
      if (boardPanel.isOpen) boardPanel.close();
      atBoard = null;
      player.held = false;
      return;
    }
    if (!boardPanel.isOpen || atBoard?.slot !== seat.slot) {
      boardPanel.open(SLOTS[seat.slot].title, board);
      freeMouse();
    }
    atBoard = seat;
    player.held = true;
    const g = games.at(seat.slot);
    const mine = g && g[seat.side] === selfId() ? g : null;
    const theirs = games.seatsAt(seat.slot)[otherSide(seat.side)];
    boardPanel.render({
      you: seat.side,
      draws: SLOTS[seat.slot].draws,
      me: { name: nameOf(selfId()), colour: colourFor(selfId()) },
      them: theirs ? { name: nameOf(theirs), colour: colourFor(theirs) } : null,
      game: mine?.rules ?? null,
      end: mine ? endOf(mine) : null,
    }, games.version);
  };
```

Notes for the implementer: `mine` is the slot's game only if you play in it in this chair, so a stranger's finished game doesn't show in your panel, but your own result stays after your opponent leaves. Before the network joins, `selfId()` is `'self'`; with `?solo` nobody else can sit, so the panel just waits.

- [ ] **Step 5: Games over the network**

In `joinOthers`, in the hooks passed to `new Multiplayer(…)`, after `onHost: () => { guestsDue = 0; },`, add:

```ts
        onGame: (g) => { games.receive(g); },
        games: () => games.messages(),
```

- [ ] **Step 6: The mouse stays free at the board**

In `ui.onResume(…)`, replace

```ts
    } else lockPointer();
```

with:

```ts
    } else if (boardPanel.isOpen) { // at a game board the mouse stays free for the panel
      cursor = true;
      ui.setCursor(true);
      setPausedState(false);
    } else lockPointer();
```

In the `mousedown` listener, replace `    if (cursor && e.button === 0 && e.target === canvas) return lockPointer(); // a click on the view looks around again` with:

```ts
    if (cursor && e.button === 0 && e.target === canvas) { // a click on the view looks around again, but not at a board
      if (!boardPanel.isOpen) lockPointer();
      return;
    }
```

In the `keydown` listener's Tab branch, replace `      if (touch || !started || paused || autostart || e.repeat) return;` with:

```ts
      if (touch || !started || paused || autostart || e.repeat || boardPanel.isOpen) return;
```

- [ ] **Step 7: The frame loop**

After `    avatars.update(dt, avatarLight);`, add:

```ts
    updateGames(dt, now / 1000);
```

Replace the `ui.setPrompt(…)` line with (no "Move to stand up" while the panel is open):

```ts
    ui.setPrompt(boardPanel.isOpen ? null : target ? promptFor(target, world.lights, touch ? 'Tap' : 'Click') : player.seat && started ? COPY.stand : null);
```

- [ ] **Step 8: Controls on the start screen**

In `web/index.html`, in the keys-only "Using things" list, after `<li><span><kbd>L</kbd></span> toggle this room's light</li>`, add:

```html
              <li><span><kbd>Click</kbd></span> a chair at the chessboard on the dining table to play chess; <kbd>C</kbd> stands up</li>
```

In the touch-only controls list, after the `<li><span><kbd>Tap</kbd></span> open doors, flip light switches, …</li>` line, add:

```html
              <li><span><kbd>Tap</kbd></span> a chair at the chessboard on the dining table to play chess</li>
```

- [ ] **Step 9: README**

In `README.md`, in the Controls paragraph under "Run and test", change `C sits on the floor or gets you up, ` to `C sits on the floor or gets you up (or, at the chessboard, asks first), click a chair at the chessboard on the dining table to play chess, `.

In the touch paragraph, after "tap doors, switches, lamps, screens, the turntable, seats and the bed." add ` Tap a chair at the chessboard on the dining table to play chess.`

In "Visitors together", after the paragraph that starts "Visitors sit and lie down where the others can see it", add:

```markdown
Two visitors can play chess at the dining table. The board stands between the two chairs at the table's end; the chair on the window side plays white. Sitting in one opens a panel with the board, your side at the bottom (the mouse is freed, as with Tab): click a piece to see where it can go, then a square to move it there; a pawn reaching the last rank asks what it becomes. Resign and Offer draw work on your move (an offer lapses when the other player moves instead of accepting). A game starts when both chairs are taken and ends by its rules (checkmate, stalemate, threefold repetition, the 50-move rule, insufficient material), by a resignation or an agreed draw, or when a player leaves the chair, which loses it; a closed or timed-out tab leaves it too. While the panel is open the movement keys don't move you: Stand up (or C) asks "Stand up and resign?" during a game. The final position stays on the table until the next game; to play the same person again, one of you stands up and sits back down. Everyone else sees the game on the table in 3D as it's played, and whoever arrives later gets it with the flat's state. There is still no server: every browser checks the moves with [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause), each change sends the whole game in a `game` message, and every browser works out a player leaving from the empty chair. Visitors on an older version see the players sitting but no board. Tuning (where the boards stand, the table's height, the slide, the colours) is in `CONFIG.games`; the design note is `docs/superpowers/specs/2026-10-28-dining-table-games-design.md`. Backgammon and Go are to come at the table's other places.
```

- [ ] **Step 10: Build and test**

Run: `cd web && npm test && npm run build`
Expected: 40 test files, 359 tests pass; the build finishes with no TypeScript errors (the existing chunk-size warning is fine).

- [ ] **Step 11: Commit**

```bash
git add web/src/main.ts web/index.html README.md
git commit -m "Games: chess at the dining table, wired into the walkthrough

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Check it in the browser, tune `CONFIG.games`, update the design note

**Files:**
- Modify: `web/src/config.ts` (only if a value needs tuning)
- Modify: `docs/superpowers/specs/2026-10-28-dining-table-games-design.md` (the status line)
- Any file at fault if a check fails (fix it, re-run `npm test && npm run build`, and commit the fix on its own).

Automated clicks can't take the pointer lock, so these checks use `?debug` (it exposes `window.walkthrough` with `player`, `scene`, `others`) to seat visitors, and dispatch clicks on the panel's squares. In a hidden Browser pane screenshots can lag; read state with `javascript_tool` when in doubt. The chair spots: S0 `{ posture: 'sit', x: 1.2483, y: 0.4502, z: 3.8857, yaw: 0 }` (white), N0 `{ posture: 'sit', x: 1.2517, y: 0.4502, z: 2.5143, yaw: 3.1416 }` (black).

- [ ] **Step 1: Start the dev server**

Use the preview tool with the `walkthrough` configuration in `.claude/launch.json` (it runs `npm --prefix web run dev` on port 5173). Do not start it from Bash.

- [ ] **Step 2: The board on the table**

Open `http://localhost:5173/?room=chess-check-<random>&debug`, untick "Talk with your voice", name "Ana", start. Then run:

```js
walkthrough.player.teleport(1.25, 4.5, 0, -0.4)
```

Expected: the chessboard lies flat on the table top near the table's rounded end (x ≈ 1.15), white's pieces toward you, file a on your left, a dark square at your bottom left; it neither floats above the wood nor sinks into it, and it doesn't overlap the fruit bowl. No console errors (`read_console_messages`). Press L to switch the Sala light off and on: the pieces dim and brighten with the room, like the animals.

If the board floats or sinks, change `CONFIG.games.tableTop`; if it touches the bowl or hangs over the table's rounded end, change `CONFIG.games.slots[0][0]` (between 1.10 and 1.20). Reload and look again.

- [ ] **Step 3: Two players**

In the same tab: `walkthrough.player.sit({ posture: 'sit', x: 1.2483, y: 0.4502, z: 3.8857, yaw: 0 })`.
Expected: the panel opens, "Chess", "Empty chair" above the board, "Ana (you) · White" below, "Waiting for an opponent". Holding W does not stand Ana up.

Open a second tab on the same URL, name "Rui", start, and seat Rui on N0: `walkthrough.player.sit({ posture: 'sit', x: 1.2517, y: 0.4502, z: 2.5143, yaw: 3.1416 })`.
Expected within a second or two: Ana's panel says "Your move" with Rui above the board; Rui's panel shows black at the bottom and "Ana's move".

In each tab, define a click helper and play the fool's mate (f2f3, e7e5, g2g4, d8h4), waiting a second between moves:

```js
window.clickSq = (s) => document.querySelector(`#board-area rect[data-square="${s}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
clickSq('f2'); clickSq('f3'); // in Ana's tab; then e7/e5 in Rui's, g2/g4 in Ana's, d8/h4 in Rui's
```

Expected: after selecting a piece its targets show as dots; each move appears in the other tab and on the table in 3D (the piece slides, about 0.3 s); after d8h4 both panels say "Black wins: checkmate" and Resign and Offer draw are disabled.

- [ ] **Step 4: A newcomer, a draw, standing up**

Open a third tab, name "Zé", start, don't sit. Read `walkthrough.scene.getObjectByName('Chess d8').position`.
Expected: the black queen stands on h4 (x ≈ 0.1575, z ≈ 0.0225 relative to the board): Zé got the game with the flat's state.

In Rui's tab press C (`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }))`): the game is over, so Rui stands at once; Ana's panel keeps "Black wins: checkmate" and shows "Empty chair". Seat Rui again: a new game starts and the pieces slide home in all three tabs.

Draw: Ana plays e2e4, Rui e7e5, Ana clicks Offer draw (it reads "Draw offered") and plays g1f3; Rui's panel says "Ana offers a draw" with Accept draw. Rui accepts: both say "Draw: agreed".

Mid-game leave: start another game (Rui stands up and sits again), Ana plays e2e4, then Ana presses C. Expected: "Stand up and resign?" with Stand up and Keep playing; Keep playing returns to the game; Stand up stands Ana and closes her panel; Rui's panel says "Black wins: White left the table".

Close a player's tab mid-game. Expected: within the leave event (or at most 15 s) the other tabs end it the same way ("… left the table").

- [ ] **Step 5: Promotion and the phone layout**

Play `a2a4 b7b5 a4b5 a7a6 b5a6 c8b7 a6b7 h7h6` and then click b7 and a8 in Ana's tab. Expected: the picker shows queen, rook, bishop, knight; choosing the knight puts a white knight on a8 in the panel and on the table.

Resize to the mobile preset and reload one player's tab, seat it again. Expected: the panel is nearly full width, the board fills it, the buttons are reachable. Reset the viewport to desktop afterwards.

- [ ] **Step 6: Tuning and the design note**

If Steps 2–5 changed any `CONFIG.games` value, run `cd web && npm test && npm run build` and commit it:

```bash
git add web/src/config.ts
git commit -m "Games: tune the chessboard's place on the table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

In `docs/superpowers/specs/2026-10-28-dining-table-games-design.md`, replace `**Status:** Approved, not yet implemented` with:

```markdown
**Status:** Approved. Phase 1 (the frame and chess) implemented; backgammon and Go to come.
```

```bash
git add docs/superpowers/specs/2026-10-28-dining-table-games-design.md
git commit -m "Games: phase 1 done in the design note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Screenshot**

Take a screenshot of a player's panel mid-game and one of the table with the pieces, for the PR.
