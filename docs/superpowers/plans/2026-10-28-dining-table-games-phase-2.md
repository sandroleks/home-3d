# Dining Table Games, Phase 2 (backgammon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two visitors who sit in the dining chairs N1 and S1 play backgammon against each other in the on-screen panel, while everyone in the flat sees the game live in a backgammon case on the table.

**Architecture:** Phase 1's frame stays: a game is a `GameRules` object that replays a list of string entries, `Games` runs each slot's life and the network, `TableGames` shows each slot's set on the table, and `BoardPanel` is the player's overlay. Two frame tasks come first, without changing chess: the table sets become a per-kind `SETS` map (like `RULES`), and the panel's game-specific button and line come from each game's `PanelBoard` (`actions`, `info`), so `panelState` and `SLOTS` lose the chess-only `draws`; backgammon's three results become end reasons. Then backgammon is purely additive: the rules (`backgammon-game.ts`), the SVG board in the panel (`backgammon-board.ts`), the case on the table (`backgammon-set.ts`), and one line each in `RULES`, `SETS` and the panel boards in `main.ts`.

**Tech Stack:** TypeScript 5.6 (strict, `noUnusedLocals`, `noUnusedParameters`), Vite 8, Vitest 5 (node environment, no DOM), three.js 0.170, Trystero 0.26, chess.js 1.4.0 (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-28-dining-table-games-design.md` (its "Rules" section defines backgammon). Phase 1's plan: `docs/superpowers/plans/2026-10-28-dining-table-games-phase-1.md`.

## Global Constraints

- Run everything from `web/`: `npm test` (Vitest) and `npm run build` (`tsc --noEmit && vite build`). Both must pass at the end of every task. Before this plan: 40 test files, 369 tests.
- No new dependency. chess.js stays pinned at exactly `1.4.0`; backgammon is our own code.
- Slots: 0 = chess (chairs `Dining chair N0` / `S0`), 1 = backgammon (`N1` / `S1`), 2 = Go (`N2` / `S2`). The S chair plays white, the N chair black. After this plan `RULES` and `SETS` have `chess` and `backgammon`; slot 2 stays a plain chair place, with no set on the table and no panel.
- The frame tasks (1 and 2) change no chess behaviour: the same entries, the same copy, the same buttons in the same order (Resign, Offer draw / Accept draw / Draw offered, Stand up), enabled in the same cases.
- A game is a list of entries, always added by the side to move (`Games.play` also requires the seated player of that side). Backgammon's entries, each at most 8 characters, point numbers always from the mover's own side (24 the furthest, 1..6 home, `bar` = 25, `off` = 0, no leading zeros):
  - `rXY` (X, Y in 1..6): a roll. The first is the **opening roll**: X is white's die, Y black's, made by white's browser while it is white's turn by definition (`turn()` is `'white'` until a side starts). A tie is a legal entry that leaves the game in the opening, so white rolls again. The higher die starts and plays both dice. Later rolls are the mover's two dice; a double gives four moves.
  - `24/18`, `bar/22`, `6/off`: one checker moved by one die.
  - `resign`: "<Winner> wins: <Loser> resigned" (a resignation is not scored as a gammon).
  - There is no "end turn" entry: the turn passes by itself once the dice are used up or none can be used, including straight after a roll with no move at all.
- Backgammon rules: the standard start (2 on 24, 5 on 13, 3 on 8, 5 on 6, each from its own side); checkers on the bar enter first; a point with 2 or more opposing checkers is blocked; a single opposing checker there is hit to the bar; bearing off only with all 15 home, a higher die bearing off only from the furthest point; a player must use as many dice as possible (both if possible) and, if only one of two different dice can be used, the larger; bearing off the last checker counts as using every die left. The game ends when a side has borne off all 15: `single` (the loser has borne off any), `gammon` (none), `backgammon` (none, and a checker on the bar or in the winner's home board). No doubling cube.
- Rolls are random in the roller's browser (`rollEntry(Math.random)`); the replay accepts any well-formed roll from the side to roll.
- `new BackgammonGame(start)` (a custom position) is for unit tests only: `RULES` always makes `new BackgammonGame()`, so a custom position is never sent over the network.
- Network: unchanged. The `game` message still carries at most 1000 entries of at most 8 characters (a real backgammon game is about 150 to 400 entries; random play averaged 300). `END_REASONS` gains `'single' | 'gammon' | 'backgammon'`. That is safe: `Games` only ever takes an incoming `end` whose reason is `left` (`extend` checks `m.end?.reason !== 'left'`, `adopt` keeps `m.end` only when its reason is `left`); every other end is worked out from the entries. Phase 1 browsers drop a backgammon message carrying a new reason, and they show no backgammon anyway.
- Panel: Resign and Stand up stay common to every game; a game's own buttons come from `PanelBoard.actions` (chess: the draw button; backgammon: **Roll**) and its own line under the status from `PanelBoard.info` (backgammon: the opening roll, a turn lost, the pip counts). Names and anything else from other visitors go in by `textContent` only, never `innerHTML`.
- Copy, verbatim (Phase 1's stays as it is): "Roll", "Opening roll: one die each, the higher starts", "Both rolled <n>: roll again", "White <w>, Black <b>: <White|Black> starts", "<White|Black> can't move. " (followed by the pips), "Pips: White <w> · Black <b>". Results: "<Winner> wins: single game", "<Winner> wins: gammon", "<Winner> wins: backgammon".
- `CONFIG.games` (final values): `slots: [[1.15, 3.2], [1.755, 3.2], [2.35, 3.2]]`; `backgammon: { width: 0.3, depth: 0.28, rim: 0.012, bar: 0.018, tray: 0.03, base: 0.01, wall: 0.018, checker: 0.0085, thickness: 0.005, die: 0.012, tumble: 0.6, wood: '#6b4630', felt: '#33493b', light: '#e8d5b0', dark: '#9c6b4a', white: '#efe6d2', black: '#4a3b33', pips: '#2a2622' }`. **The case is a 30 × 28 cm travel case, not 50 × 40:** the table's decorations, measured by raycasting the loaded model, leave only x 1.58..1.93 free across the slot: the fruit bowl reaches x 1.58 (z 3.02..3.28), the mug starts at x 1.94 (z 2.98..3.06) and the book stack at x 1.93 (z 3.32..3.48). Slot 1 moves 4.5 cm toward the table's end so the case spans x 1.605..1.905, clear of both, and 25 cm clear of the chessboard (x 0.95..1.35). (Slot 2's Go board will have to fit right of the books, from x 2.18, in Phase 3.) Task 7 checks it in the browser.
- 3D: procedural geometry only (no Blender export). Matcap materials from `TableMaterials`, dimmed by the light at the table like the chess set. One shared geometry for all 30 checkers and one material per side; the two dice share one cube geometry and six face materials (pips drawn on a canvas, plain without one). Orientation as chess: white is the S chair (+z), facing north (-z), so white's right hand is +x; white's home board is at the near right, the bear-off tray at the +x end. The set is built through `SETS`, so it is in the scene before `warmUpShaders` runs. Checkers slide in `CONFIG.games.slide` seconds with a small hop; the dice tumble in `CONFIG.games.backgammon.tumble` seconds when a new roll shows.
- Files stay flat in `web/src/` (no subfolders), small and single-purpose. Match the code around you: short doc comments on exported things, the existing naming, `type` aliases (not interfaces) for anything sent as JSON.
- Commits end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Files

- Create `web/src/backgammon-game.ts`: `BackgammonGame` (the rules, replaying entries), `rollEntry`, `OFF`, `BAR`, the types `Layout`, `StartPosition`, `BgMove`, `BgChecker`, `BgPhase`, `BgRoll`.
- Create `web/src/backgammon-board.ts`: the SVG board in the panel (`BackgammonBoard`), `pointCell`, `canRoll`, `backgammonInfo`, `BOARD_W`, `BG_COPY`.
- Create `web/src/backgammon-set.ts`: the case on the table (`BackgammonSet`), `caseLayout`, `checkerPosition`, `dieRotation`, `DIE_FACES`.
- Modify `web/src/games.ts` (end reasons, `endText`, `SLOTS` without `draws`, `slotOf`, `RULES`), `web/src/table-pieces.ts` (`SETS`), `web/src/board-panel.ts` (`BoardView`, `PanelAction`, `PanelBoard.actions` / `info`, `panelState` without draws), `web/src/chess-board.ts` (`drawAction`, `actions`), `web/src/config.ts` (`games.slots[1]`, `games.backgammon`), `web/src/main.ts` (explicit slot, the backgammon board, `walkthrough.games`), `web/index.html` (the panel's action and info slots, the controls lists), `web/src/style.css`.
- Modify `README.md` (controls, Visitors together) and the design note (status line, the rules module's name).
- Tests: create `web/tests/backgammon-game.test.ts`, `web/tests/backgammon-board.test.ts`, `web/tests/backgammon-set.test.ts`; replace `web/tests/board-panel.test.ts`; extend `web/tests/games.test.ts`, `web/tests/table-pieces.test.ts`.

---

### Task 1: Frame: table sets by kind, and backgammon's results

**Files:**
- Modify: `web/src/games.ts` (`END_REASONS`, `endText`)
- Modify: `web/src/table-pieces.ts` (`SETS`, `TableGames`)
- Test: `web/tests/games.test.ts`, `web/tests/table-pieces.test.ts`

**Interfaces:**
- Consumes (Phase 1): `GameKind`, `GameRules`, `SlotGame`, `SLOTS` from `./games`; `ChessSet` from `./chess-set`; `TableMaterials`, `TableSet`, `TableGames` from `./table-pieces`; `CanvasFactory` from `./screens`.
- Produces:
  - `END_REASONS` (and so `EndReason`) gains `'single'`, `'gammon'`, `'backgammon'`; `endText({ winner: 'white', reason: 'single' })` is `'White wins: single game'`, `gammon` and `backgammon` read as their names. Every Phase 1 text is unchanged.
  - `SETS: Partial<Record<GameKind, (materials: TableMaterials, canvas: CanvasFactory | null) => TableSet>>` in `table-pieces.ts` (`{ chess }` for now). It lives in `table-pieces.ts`, not next to `RULES` in `games.ts`, so `games.ts` stays free of three.js.
  - `new TableGames(canvas?, sets = SETS)`: each slot whose kind is in `sets` gets that set at its place.

- [ ] **Step 1: Write the failing tests**

In `web/tests/games.test.ts`, in `describe('endText', …)`, add after the `it('names the draws', …)` test (just before the `describe`'s closing `});`):

```ts
  it("names backgammon's three wins", () => {
    expect(endText({ winner: 'white', reason: 'single' })).toBe('White wins: single game');
    expect(endText({ winner: 'black', reason: 'gammon' })).toBe('Black wins: gammon');
    expect(endText({ winner: 'white', reason: 'backgammon' })).toBe('White wins: backgammon');
  });
```

In the same file, in `it('takes a well-formed game, with or without an end', …)`, add after the line `expect(isGameMessage({ ...ok, end: { winner: null, reason: 'agreement' } })).toBe(true);`:

```ts
    expect(isGameMessage({ ...ok, end: { winner: 'black', reason: 'backgammon' } })).toBe(true);
```

In `web/tests/table-pieces.test.ts`, change the imports to:

```ts
import { Group, type Mesh, MeshMatcapMaterial } from 'three';
```

```ts
import type { GameRules, SlotGame } from '../src/games';
import { TableGames, TableMaterials, type TableSet } from '../src/table-pieces';
```

(the first replaces `import { type Mesh, MeshMatcapMaterial } from 'three';`; the other two replace the `../src/games` and `../src/table-pieces` imports). In `describe('TableGames', …)`, insert before `it('shows each slot\'s game when it changes, and dims with the light', …)`:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/games.test.ts tests/table-pieces.test.ts`
Expected: FAIL, 3 tests: `endText` gives `'White wins: single'`, `isGameMessage` refuses the unknown reason `backgammon`, and `TableGames` ignores its second argument (its one child is the chessboard at slot 0).

- [ ] **Step 3: The end reasons**

In `web/src/games.ts`, replace the `END_REASONS` line with:

```ts
export const END_REASONS = [
  'checkmate', 'stalemate', 'repetition', 'fifty', 'material', 'agreement', 'resigned', 'left', 'single', 'gammon', 'backgammon',
] as const;
```

After the `DRAWN` constant (the line `};` that closes it), add:

```ts
/** Wins whose reason reads differently from its name (backgammon's single game). */
const WON: Partial<Record<EndReason, string>> = { single: 'single game' };
```

Replace the doc comment and first three lines of `endText` (from `/** The result line:` to the `const why = …` line) with:

```ts
/** The result line: "White wins: checkmate", "Black wins: White left the table", "White wins: gammon",
 * "Draw: stalemate". */
export function endText(end: GameEnd): string {
  if (end.winner) {
    const loser = SIDE_NAME[otherSide(end.winner)];
    const why = end.reason === 'resigned' ? `${loser} resigned` : end.reason === 'left' ? `${loser} left the table` : WON[end.reason] ?? end.reason;
```

- [ ] **Step 4: The sets by kind**

In `web/src/table-pieces.ts`:

Replace `import { type GameRules, type SlotGame, SLOTS } from './games';` with:

```ts
import { type GameKind, type GameRules, type SlotGame, SLOTS } from './games';
```

Replace the doc comment `/** One slot's board and pieces on the table. Each game adds its own: chess now, backgammon and Go later. */` with:

```ts
/** One slot's board and pieces on the table. Each game adds its own to `SETS`. */
```

Replace everything from `/** The games on the dining table, as everyone sees them: each playable slot's board at its place on the table. */` down to and including the line `      if (!set) return null;` with:

```ts
/** Each game's set on the table, by kind, as `RULES` has each game's rules; a slot whose kind has none here stays a
 * bare table place. */
export const SETS: Partial<Record<GameKind, (materials: TableMaterials, canvas: CanvasFactory | null) => TableSet>> = {
  chess: (materials, canvas) => new ChessSet(materials, canvas),
};

/** The games on the dining table, as everyone sees them: each slot's set at its place on the table. */
export class TableGames {
  readonly root = new Group();
  private materials: TableMaterials;
  private sets: (TableSet | null)[];
  private shown: string[] = SLOTS.map(() => '');

  constructor(canvas: CanvasFactory | null = typeof document === 'undefined' ? null : domCanvas, sets = SETS) {
    this.root.name = 'Table games';
    this.materials = new TableMaterials(makeMatcaps(canvas));
    const { slots, tableTop } = CONFIG.games;
    this.sets = SLOTS.map((s, i) => {
      const set = sets[s.kind]?.(this.materials, canvas) ?? null;
      if (!set) return null;
```

(The rest of the constructor and `update` stay as they are.)

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/games.test.ts tests/table-pieces.test.ts`
Expected: PASS (31 and 8 tests).

Run: `cd web && npm test && npm run build`
Expected: 40 test files, 371 tests pass; the build is clean (the existing chunk-size warning is fine).

- [ ] **Step 6: Commit**

```bash
git add web/src/games.ts web/src/table-pieces.ts web/tests/games.test.ts web/tests/table-pieces.test.ts
git commit -m "Games: table sets by kind, and backgammon's three results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Frame: each game's own buttons and line in the panel, and an explicit slot

**Files:**
- Modify: `web/src/board-panel.ts` (replace with the full version below)
- Modify: `web/src/chess-board.ts` (`drawAction`, `actions`)
- Modify: `web/src/games.ts` (`SLOTS` without `draws`, `slotOf`)
- Modify: `web/src/main.ts`, `web/index.html` (the panel), `web/src/style.css`
- Test: `web/tests/board-panel.test.ts` (replace), `web/tests/games.test.ts`

**Interfaces:**
- Consumes (Phase 1): `endText`, `GameEnd`, `GameRules`, `otherSide`, `Side`, `SLOTS`, `GameKind` from `./games`; `ChessGame`; in `main.ts` the names `games`, `others`, `boardPanel`, `myGame`, `resignIfDue`, `standFromBoard`, `atBoard`, `selfId`.
- Produces (`board-panel.ts`):
  - `interface BoardView { game: GameRules | null; you: Side; live: boolean; end: GameEnd | null }`
  - `interface PanelAction { label: string; enabled: boolean; run(): void }`
  - `interface PanelBoard { readonly element: HTMLElement; draw(game, you, live): void; actions?(view: BoardView): PanelAction[]; info?(view: BoardView): string }`
  - `PanelInput` without `draws`: `{ you; me; them; game; end }`; `PanelState` is `{ status: string; live: boolean; resign: boolean }`; `PanelHandlers` is `{ resign(): void; stand(): void }`
  - The panel's DOM gains `#board-info` (a `<p>`, hidden when empty) and `#board-actions` (a `<span>` between Resign and Stand up whose buttons `BoardPanel.render` makes from `board.actions`); `#board-draw` is gone.
- Produces (`chess-board.ts`): `drawAction(view: BoardView): { label: string; enabled: boolean; entry: 'draw?' | 'draw!' }`; `ChessBoard.actions(view)` returns that one button; the constructor's callback is `(entry: string) => void`.
- Produces (`games.ts`): `SLOTS: readonly { kind: GameKind; title: string }[]`; `slotOf(kind: GameKind): number`.
- Produces (`main.ts`): `playEntry(slot: number, entry: string)`.

- [ ] **Step 1: Write the failing tests**

Replace `web/tests/board-panel.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { type BoardView, panelState, type PanelInput } from '../src/board-panel';
import { cellSquare, drawAction, GLYPHS, squareCell } from '../src/chess-board';
import { ChessGame } from '../src/chess-game';

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
```

In `web/tests/games.test.ts`, add `slotOf` to the import from `'../src/games'`, after `seatedAt`:

```ts
  endOf, endText, gameChairs, type GameMessage, Games, isGameMessage, leftEnd, replay, seatedAt, slotOf, type SlotSeats, SLOTS,
```

and add as the first test in `describe('the chairs', …)`:

```ts
  it('knows which slot plays which game', () => {
    expect([slotOf('chess'), slotOf('backgammon'), slotOf('go')]).toEqual([0, 1, 2]);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/board-panel.test.ts tests/games.test.ts`
Expected: FAIL: `drawAction` and `slotOf` are not exported (`… is not a function`), and `panelState` still returns `draw` and `drawEnabled`, so its `toEqual` checks fail.

- [ ] **Step 3: The panel shell**

Replace `web/src/board-panel.ts` with:

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

/** What a board's own buttons and line go by: the game as `you` see it, whether it's your move, and how it ended. */
export interface BoardView { game: GameRules | null; you: Side; live: boolean; end: GameEnd | null }

/** A game's own button, between Resign and Stand up: chess's Offer draw, backgammon's Roll. */
export interface PanelAction { label: string; enabled: boolean; run(): void }

/** A game's own board in the panel; each game brings its own, with its own buttons and line. */
export interface PanelBoard {
  readonly element: HTMLElement;
  /** Draws the game as `you` sit (your side at the bottom); `live`: your move, so clicks play. */
  draw(game: GameRules | null, you: Side, live: boolean): void;
  /** The game's own buttons now. */
  actions?(view: BoardView): PanelAction[];
  /** A line of the game's own under the status (backgammon: the opening roll, the pip counts); '' for none. */
  info?(view: BoardView): string;
}

export interface PanelPlayer { name: string; colour: string }

export interface PanelInput {
  you: Side;
  me: PanelPlayer;
  /** Whoever sits opposite; null for an empty chair. */
  them: PanelPlayer | null;
  /** The slot's game if this visitor plays in it (running or ended); null before one starts. */
  game: GameRules | null;
  end: GameEnd | null;
}

/** What the panel says, and whether it's your move and you may resign. */
export interface PanelState { status: string; live: boolean; resign: boolean }

export function panelState({ you, them, game, end }: PanelInput): PanelState {
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
  return { status, live, resign: live };
}

export interface PanelHandlers {
  resign(): void;
  stand(): void;
}

/**
 * The overlay a player gets at a game chair: the board in the middle, your opponent above it and you below, whose
 * move it is or how it ended, the game's own line, and the buttons: Resign, the game's own, Stand up. Names come from
 * other visitors: they are set as text only.
 */
export class BoardPanel {
  private board: PanelBoard | null = null;
  private last = '';
  private onYes: (() => void) | null = null;

  constructor(private doc: Document, handlers: PanelHandlers) {
    this.el('board-resign').addEventListener('click', () => handlers.resign());
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
    const view: BoardView = { game: input.game, you: input.you, live: s.live, end: input.end };
    const info = this.board?.info?.(view) ?? '';
    this.el('board-info').textContent = info;
    this.el('board-info').hidden = !info;
    this.el('board-actions').replaceChildren(...(this.board?.actions?.(view) ?? []).map((a) => {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      b.disabled = !a.enabled;
      b.addEventListener('click', () => a.run());
      return b;
    }));
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

- [ ] **Step 4: Chess's draw button moves into the chessboard**

In `web/src/chess-board.ts`, replace the two imports

```ts
import type { PanelBoard } from './board-panel';
import { ChessGame } from './chess-game';
import type { GameRules, Side } from './games';
```

with:

```ts
import { type BoardView, GAME_COPY, type PanelAction, type PanelBoard } from './board-panel';
import { ChessGame } from './chess-game';
import { type GameRules, otherSide, type Side } from './games';
```

Insert just before `/** A square's column and row on screen (0..7 from the top left), your own side at the bottom. */`:

```ts
/** Chess's draw button: Offer draw, Accept draw when the other side's offer stands, or Draw offered (disabled) while
 * your own does; it works only on your move. */
export function drawAction({ game, you, live, end }: BoardView): { label: string; enabled: boolean; entry: 'draw?' | 'draw!' } {
  const offer = game && !end ? game.drawOffer?.() ?? null : null;
  if (offer === otherSide(you)) return { label: GAME_COPY.acceptDraw, enabled: live, entry: 'draw!' };
  if (offer === you) return { label: GAME_COPY.drawOffered, enabled: false, entry: 'draw?' };
  return { label: GAME_COPY.offerDraw, enabled: live, entry: 'draw?' };
}

```

Replace the constructor's first line `  constructor(private doc: Document, private onMove: (uci: string) => void) {` with:

```ts
  /** `onMove` takes the entries this board makes: moves in UCI, `draw?` and `draw!`. */
  constructor(private doc: Document, private onMove: (entry: string) => void) {
```

Insert just before `  draw(game: GameRules | null, you: Side, live: boolean): void {`:

```ts
  actions(view: BoardView): PanelAction[] {
    const { label, enabled, entry } = drawAction(view);
    return [{ label, enabled, run: () => this.onMove(entry) }];
  }

```

This is the same logic Phase 1 had in `panelState` (`draw`, `drawEnabled`) and in `main.ts`'s `draw` handler (`drawOffer() ? 'draw!' : 'draw?'`), so chess plays exactly as before.

- [ ] **Step 5: `SLOTS` and `slotOf`**

In `web/src/games.ts`, replace the `SLOTS` constant (from its doc comment to its closing `];`) with:

```ts
/** The table's three places, by slot number: the chairs `Dining chair N<slot>` and `S<slot>`. */
export const SLOTS: readonly { kind: GameKind; title: string }[] = [
  { kind: 'chess', title: 'Chess' },
  { kind: 'backgammon', title: 'Backgammon' },
  { kind: 'go', title: 'Go' },
];

/** The slot a game is played at. */
export const slotOf = (kind: GameKind): number => SLOTS.findIndex((s) => s.kind === kind);
```

- [ ] **Step 6: `main.ts`**

Replace the `'./games'` import with:

```ts
import { endOf, gameChairs, type GameKind, Games, otherSide, seatedAt, type Side, slotOf, SLOTS } from './games';
```

Replace these lines (the boards, `atBoard` and `playEntry`):

```ts
  const boards: Partial<Record<GameKind, PanelBoard>> = { chess: new ChessBoard(document, (uci) => playEntry(uci)) };
  /** Where this visitor plays while the panel is open: the slot and the side. */
  let atBoard: { slot: number; side: Side } | null = null;
  const playEntry = (entry: string) => {
    const m = atBoard && games.play(atBoard.slot, entry);
    if (m) others?.sendGame(m);
  };
```

with:

```ts
  /** Each game's board in the panel; each plays its entries at its own slot. */
  const boards: Partial<Record<GameKind, PanelBoard>> = {
    chess: new ChessBoard(document, (entry) => playEntry(slotOf('chess'), entry)),
  };
  /** Where this visitor plays while the panel is open: the slot and the side. */
  let atBoard: { slot: number; side: Side } | null = null;
  /** An entry by this visitor at a slot (the games check it is their move there), sent when taken. */
  const playEntry = (slot: number, entry: string) => {
    const m = games.play(slot, entry);
    if (m) others?.sendGame(m);
  };
```

In `resignIfDue`, replace `playEntry('resign');` with `playEntry(slot, 'resign');` (the destructured `slot` is already in scope).

In `new BoardPanel(document, { … })`, delete the `draw` handler (these four lines):

```ts
    draw: () => {
      const g = atBoard && games.at(atBoard.slot);
      playEntry(g?.rules.drawOffer?.() ? 'draw!' : 'draw?');
    },
```

In `updateGames`, in the object passed to `boardPanel.render`, delete the line `      draws: SLOTS[seat.slot].draws,`.

- [ ] **Step 7: Markup and styles**

In `web/index.html`, replace

```html
        <p id="board-status" aria-live="polite"></p>
        <div id="board-buttons">
          <button type="button" id="board-resign">Resign</button>
          <button type="button" id="board-draw">Offer draw</button>
          <button type="button" id="board-stand">Stand up</button>
```

with:

```html
        <p id="board-status" aria-live="polite"></p>
        <p id="board-info" hidden></p>
        <div id="board-buttons">
          <button type="button" id="board-resign">Resign</button>
          <span id="board-actions"></span>
          <button type="button" id="board-stand">Stand up</button>
```

In `web/src/style.css`, after the line `#board-status { margin: 0; min-height: 1.4em; }`, add (`display: contents` keeps the game's buttons in the row's flex layout, styled by the existing `#board-buttons button` rule):

```css
#board-info { margin: 0; color: var(--muted); font-size: 13px; }
#board-actions { display: contents; }
```

- [ ] **Step 8: Run the tests and the build**

Run: `cd web && npx vitest run tests/board-panel.test.ts tests/games.test.ts`
Expected: PASS (11 and 32 tests).

Run: `cd web && npm test && npm run build`
Expected: 40 test files, 374 tests pass; the build is clean (TypeScript finds no other user of `draws`, `PanelHandlers.draw` or `#board-draw`).

- [ ] **Step 9: Commit**

```bash
git add web/src/board-panel.ts web/src/chess-board.ts web/src/games.ts web/src/main.ts web/index.html web/src/style.css web/tests/board-panel.test.ts web/tests/games.test.ts
git commit -m "Games: each game brings its own panel buttons and line; entries name their slot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The backgammon rules (`backgammon-game.ts`)

**Files:**
- Create: `web/src/backgammon-game.ts`
- Test: `web/tests/backgammon-game.test.ts`

**Interfaces:**
- Consumes: the types `GameEnd`, `GameRules`, `Side` from `./games` (type-only, so `games.ts` can import `BackgammonGame` in Task 6 without a runtime cycle; the module keeps its own one-line `otherSide`, as `chess-game.ts` does).
- Produces:
  - `OFF = 0`, `BAR = 25`
  - `type Layout = Partial<Record<number | 'bar', number>>`; `interface StartPosition { white: Layout; black: Layout; turn: Side }`
  - `interface BgMove { from: number; to: number; die: number; hit: boolean; text: string }` (from the mover's side; `from` 25 = bar, `to` 0 = off)
  - `interface BgChecker { id: number; side: Side; at: number; height: number }` (ids: white 0..14, black 15..29, handed out by the layout's points from low to high, then the bar, then those borne off)
  - `type BgPhase = 'opening' | 'roll' | 'move'`; `interface BgRoll { side: Side | null; dice: [number, number]; index: number }` (`side` null: the opening roll)
  - `rollEntry(random?: () => number): string`
  - `class BackgammonGame implements GameRules`: `constructor(start?: StartPosition)` (tests only); `kind = 'backgammon'`, `moves`, `turn()`, `play(entry)`, `end()`; `phase(): BgPhase`; `dice(): readonly number[]` (left to use); `lastRoll(): BgRoll | null`; `blocked(): Side | null` (the side whose last roll had no move, until the next roll); `count(side, at): number`; `pips(side): number`; `legal(): BgMove[]` (one per entry text, lowest die first); `targets(from): number[]` (ascending); `checkers(): BgChecker[]` (index = id)

The legal-move rule in one sentence: list every single-die move legal on its own (`steps`), work out the most dice the player can use from here (`most`, a depth-first search over the dice left that stops as soon as it finds a way to use them all, and counts bearing off the last checker as using them all), keep the moves that still reach that most, and if the most is one of two different dice, keep only the larger die's moves when there are any. Random play over 300 games found no stuck state and replays a 265-entry game in about 3 ms.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/backgammon-game.test.ts`:

```ts
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
```

Positions in these tests are each side's own numbering: black's point p is white's point 25 - p (so `black: { 19: 2 }` makes white's 6 point, and `black: { 23: 2 }` white's 2 point).

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/backgammon-game.test.ts`
Expected: FAIL: `../src/backgammon-game` cannot be resolved.

- [ ] **Step 3: Implement**

Create `web/src/backgammon-game.ts`:

```ts
import type { GameEnd, GameRules, Side } from './games';

/**
 * Backgammon's places, each side counting from its own side: 0 is borne off, 1..24 are its points (1..6 its home
 * board, 24 the furthest from home), 25 is the bar. A side's point p is the other side's point 25 - p.
 */
export const OFF = 0;
export const BAR = 25;

/** A roll: `r` and two dice, e.g. `r35`. The opening roll is white's die, then black's. */
const ROLL = /^r([1-6])([1-6])$/;
const otherSide = (s: Side): Side => (s === 'white' ? 'black' : 'white');
/** Each side's 15 checkers at the start, from its own side. */
const START: Layout = { 24: 2, 13: 5, 8: 3, 6: 5 };

/** A side's checkers by its own point numbers (1..24) and `bar`; the rest of its 15 are borne off. */
export type Layout = Partial<Record<number | 'bar', number>>;
/** A position to start from, with `turn` to roll: for tests only. A game on the network always starts from the
 * opening (`new BackgammonGame()`), so this is never sent. */
export interface StartPosition { white: Layout; black: Layout; turn: Side }
/** One checker moved by one die, from the mover's side: `from` 25 is the bar, `to` 0 bears off; `text` is its entry. */
export interface BgMove { from: number; to: number; die: number; hit: boolean; text: string }
/** One of the 30 checkers (white 0..14, black 15..29), followed through the game: its place, from its own side, and
 * how many checkers lie under it there. */
export interface BgChecker { id: number; side: Side; at: number; height: number }
/** The game's stage: the opening roll, a side to roll, or a side moving with dice left. */
export type BgPhase = 'opening' | 'roll' | 'move';
/** The last roll: who rolled (null: the opening roll, white's die first), the two dice, and its entry's index. */
export interface BgRoll { side: Side | null; dice: [number, number]; index: number }

type Counts = Record<Side, number[]>;

/** A roll entry made in the roller's browser. */
export function rollEntry(random: () => number = Math.random): string {
  const die = () => 1 + Math.min(5, Math.floor(random() * 6));
  return `r${die()}${die()}`;
}

const without = (dice: readonly number[], die: number): number[] => {
  const i = dice.indexOf(die);
  return [...dice.slice(0, i), ...dice.slice(i + 1)];
};

/** Every single-die move for `side`, legal on its own: the bar first, no landing on two or more opposing checkers,
 * bearing off only with all 15 home, and a higher die only from the furthest point. */
function steps(c: Counts, side: Side, dice: readonly number[]): BgMove[] {
  const own = c[side];
  const opp = c[otherSide(side)];
  const home = own.slice(7).every((n) => n === 0);
  let furthest = 0;
  for (let p = 6; p >= 1 && !furthest; p--) if (own[p]) furthest = p;
  const out: BgMove[] = [];
  for (const die of new Set(dice)) {
    for (let from = BAR; from >= 1; from--) {
      if (!own[from] || (own[BAR] && from !== BAR)) continue;
      const to = from - die;
      if (to >= 1) {
        const there = opp[25 - to];
        if (there < 2) out.push({ from, to, die, hit: there === 1, text: `${from === BAR ? 'bar' : from}/${to}` });
      } else if (home && (to === 0 || from === furthest)) out.push({ from, to: OFF, die, hit: false, text: `${from}/off` });
    }
  }
  return out;
}

function apply(c: Counts, side: Side, m: BgMove): Counts {
  const next: Counts = { white: [...c.white], black: [...c.black] };
  next[side][m.from]--;
  next[side][m.to]++;
  if (m.hit) {
    const o = otherSide(side);
    next[o][25 - m.to]--;
    next[o][BAR]++;
  }
  return next;
}

/** The most dice `side` can use from here. Bearing off the last checker wins: it counts as using them all. */
function most(c: Counts, side: Side, dice: readonly number[]): number {
  let best = 0;
  for (const m of steps(c, side, dice)) {
    best = Math.max(best, reach(c, side, m, dice));
    if (best === dice.length) break;
  }
  return best;
}

/** The most dice used in all, playing `m` first. */
function reach(c: Counts, side: Side, m: BgMove, dice: readonly number[]): number {
  const next = apply(c, side, m);
  return next[side][OFF] === 15 ? dice.length : 1 + most(next, side, without(dice, m.die));
}

/** The moves allowed now: each must keep the most dice usable (both if possible), and when only one of two
 * different dice can be used, the larger if it can. One per entry (a bear-off two dice could make uses the lower). */
function legalMoves(c: Counts, side: Side, dice: readonly number[]): BgMove[] {
  const all = steps(c, side, dice);
  if (!all.length) return [];
  const need = most(c, side, dice);
  let ok = all.filter((m) => reach(c, side, m, dice) === need);
  if (need === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const big = Math.max(...dice);
    if (ok.some((m) => m.die === big)) ok = ok.filter((m) => m.die === big);
  }
  ok.sort((a, b) => a.die - b.die);
  return ok.filter((m, i) => ok.findIndex((o) => o.text === m.text) === i);
}

/**
 * Backgammon without the doubling cube, as a list of entries replayed one by one, each by the side to move. Point
 * numbers are always the mover's own (24 down to 1, then off):
 * - `r35`: a roll. The first is the opening roll, white's die then black's, made by white's browser (it is white's
 *   turn until then); a tie is rolled again, and the higher die starts, playing both dice. Later rolls are the
 *   mover's two dice; a double gives four moves.
 * - `24/18`, `bar/22`, `6/off`: one checker moved by one die (the bar enters first).
 * - `resign`.
 * The turn passes by itself once the dice are used up or none can be used, so there is no "end turn" entry.
 */
export class BackgammonGame implements GameRules {
  readonly kind = 'backgammon' as const;
  private list: string[] = [];
  private side: Side = 'white';
  private stage: BgPhase = 'opening';
  private left: number[] = [];
  private counts: Counts = { white: Array<number>(26).fill(0), black: Array<number>(26).fill(0) };
  /** Each checker's side, place and when it got there (the latest is on top). */
  private men: { side: Side; at: number; seq: number }[] = [];
  private seq = 0;
  private roll: BgRoll | null = null;
  private stuck: Side | null = null;
  private result: GameEnd | null = null;
  private cached: BgMove[] | null = null;

  /** `start` is for tests only: a position with `turn` to roll. */
  constructor(start?: StartPosition) {
    for (const side of ['white', 'black'] as const) {
      let placed = 0;
      for (const [key, n = 0] of Object.entries(start ? start[side] : START)) {
        this.place(side, key === 'bar' ? BAR : Number(key), n);
        placed += n;
      }
      this.place(side, OFF, 15 - placed);
    }
    if (start) {
      this.side = start.turn;
      this.stage = 'roll';
    }
  }

  private place(side: Side, at: number, n: number): void {
    this.counts[side][at] += n;
    for (let i = 0; i < n; i++) this.men.push({ side, at, seq: this.seq++ });
  }

  get moves(): readonly string[] {
    return this.list;
  }

  turn(): Side {
    return this.side;
  }

  end(): GameEnd | null {
    return this.result;
  }

  phase(): BgPhase {
    return this.stage;
  }

  /** The dice still to use this turn. */
  dice(): readonly number[] {
    return this.left;
  }

  lastRoll(): BgRoll | null {
    return this.roll;
  }

  /** The side whose last roll had no move at all (its turn passed at once), until the next roll. */
  blocked(): Side | null {
    return this.stuck;
  }

  /** How many of a side's checkers are at a place, from its own side (0 borne off, 25 the bar). */
  count(side: Side, at: number): number {
    return this.counts[side][at];
  }

  /** A side's pip count: how far its checkers still have to go (the bar counts 25). */
  pips(side: Side): number {
    return this.counts[side].reduce((sum, n, at) => sum + n * at, 0);
  }

  /** The moves the side to move may make now (none unless it is moving). */
  legal(): BgMove[] {
    if (this.stage !== 'move' || this.result) return [];
    return (this.cached ??= legalMoves(this.counts, this.side, this.left));
  }

  /** Where a checker on `from` may go now (0: off), lowest first. */
  targets(from: number): number[] {
    return [...new Set(this.legal().filter((m) => m.from === from).map((m) => m.to))].sort((a, b) => a - b);
  }

  /** Every checker, followed from the start: a moved checker comes off the top of its stack, a hit one goes to the
   * bar. */
  checkers(): BgChecker[] {
    const heights = new Map<string, number>();
    const out: BgChecker[] = [];
    [...this.men.entries()].sort(([, a], [, b]) => a.seq - b.seq).forEach(([id, m]) => {
      const key = `${m.side}${m.at}`;
      const height = heights.get(key) ?? 0;
      heights.set(key, height + 1);
      out[id] = { id, side: m.side, at: m.at, height };
    });
    return out;
  }

  play(entry: string): boolean {
    if (this.result) return false;
    if (entry === 'resign') this.result = { winner: otherSide(this.side), reason: 'resigned' };
    else if (this.stage === 'move') {
      const m = this.legal().find((l) => l.text === entry);
      if (!m) return false;
      this.follow(m);
      this.counts = apply(this.counts, this.side, m);
      this.left = without(this.left, m.die);
      this.cached = null;
      this.result = this.won();
      if (!this.result && !this.legal().length) this.pass();
    } else {
      const r = ROLL.exec(entry);
      if (!r) return false;
      const [a, b] = [Number(r[1]), Number(r[2])];
      const index = this.list.length;
      if (this.stage === 'opening') {
        this.roll = { side: null, dice: [a, b], index };
        if (a !== b) {
          this.side = a > b ? 'white' : 'black';
          this.startTurn([a, b]);
        }
      } else {
        this.roll = { side: this.side, dice: [a, b], index };
        this.startTurn(a === b ? [a, a, a, a] : [a, b]);
      }
    }
    this.list.push(entry);
    return true;
  }

  private startTurn(dice: number[]): void {
    this.stage = 'move';
    this.left = dice;
    this.cached = null;
    this.stuck = null;
    if (!this.legal().length) {
      this.stuck = this.side;
      this.pass();
    }
  }

  private pass(): void {
    this.side = otherSide(this.side);
    this.stage = 'roll';
    this.left = [];
    this.cached = null;
  }

  /** Moves the top checker of `from` and, on a hit, the opposing checker to the bar. */
  private follow(m: BgMove): void {
    const top = (side: Side, at: number) =>
      this.men.filter((c) => c.side === side && c.at === at).reduce((a, b) => (b.seq > a.seq ? b : a));
    if (m.hit) {
      const hit = top(otherSide(this.side), 25 - m.to);
      hit.at = BAR;
      hit.seq = this.seq++;
    }
    const moved = top(this.side, m.from);
    moved.at = m.to;
    moved.seq = this.seq++;
  }

  /** The side to move has borne off all 15: a single game if the loser has borne off any, else a gammon, or a
   * backgammon with a checker still on the bar or in the winner's home board. */
  private won(): GameEnd | null {
    if (this.counts[this.side][OFF] < 15) return null;
    const loser = this.counts[otherSide(this.side)];
    const reason = loser[OFF] > 0 ? 'single' : loser.slice(19).some((n) => n > 0) ? 'backgammon' : 'gammon';
    return { winner: this.side, reason };
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/backgammon-game.test.ts`
Expected: PASS (24 tests).

Run: `cd web && npm test && npm run build`
Expected: 41 test files, 398 tests pass; the build is clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/backgammon-game.ts web/tests/backgammon-game.test.ts
git commit -m "Games: the backgammon rules, replayed from entries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The backgammon board in the panel (`backgammon-board.ts`)

**Files:**
- Create: `web/src/backgammon-board.ts`
- Modify: `web/src/style.css` (one selector)
- Test: `web/tests/backgammon-board.test.ts`

**Interfaces:**
- Consumes (Task 3): `BackgammonGame` (`phase`, `dice`, `lastRoll`, `blocked`, `count`, `pips`, `legal`, `targets`, `turn`, `moves`), `BAR`, `OFF`, `rollEntry`. (Task 2): `BoardView`, `PanelAction`, `PanelBoard`. Phase 1: `GameRules`, `Side`.
- Produces:
  - `BOARD_W = 14.2` (the drawing's width in checker widths; its height is 12)
  - `pointCell(at: number, you: Side): { x: number; top: boolean }` (your point `at`, 1..24, as drawn from your chair: its column's left edge, and whether it hangs from the top)
  - `canRoll(view: BoardView): boolean`; `backgammonInfo(view: BoardView): string`; `BG_COPY`
  - `class BackgammonBoard implements PanelBoard { constructor(doc: Document, onEntry: (entry: string) => void, random?: () => number) }` with `actions(view)` (one **Roll** button, enabled when `canRoll`), `info(view)` (`backgammonInfo`), `draw(game, you, live)`
  - Its SVG's click targets are `rect[data-at]`: `1..24` your points, `25` the bar (your half, the lower half of the bar column), `0` the tray (your half). Task 7 clicks them.

The board, as seen from your chair: white sees its home board at the bottom right and the tray at the right; black sits across the table, so its drawing is white's turned round (its home board at the bottom left, the tray on the left), matching the case on the table. Your checkers on the bar and in the tray are always in the half nearer you (the bottom). Five checkers show per point; the fifth carries the count when there are more. Click one of your points (or the bar) to select it, then a highlighted target (a dot on a point, or the lit lower half of the tray) to move; when only the bar can move, it is selected already. The last roll's dice lie between the rows in your right-hand half (four for a double), the used ones faded; the opening roll shows both dice.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/backgammon-board.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/backgammon-board.test.ts`
Expected: FAIL: `../src/backgammon-board` cannot be resolved.

- [ ] **Step 3: Implement**

Create `web/src/backgammon-board.ts`:

```ts
import { BackgammonGame, BAR, OFF, rollEntry } from './backgammon-game';
import type { BoardView, PanelAction, PanelBoard } from './board-panel';
import type { GameRules, Side } from './games';

const SVG = 'http://www.w3.org/2000/svg';
/** The drawing, in checker widths: 12 point columns, the bar (column 6) and the bear-off tray on the right (as white
 * sees it); the top row of points from 0 to 5, the bottom row from 12 up to 7, the dice between. */
export const BOARD_W = 14.2;
const BOARD_H = 12;
const TRAY = 13;
const R = 0.45;
const COLOURS = {
  felt: '#33493b', wood: '#6b4630', tray: '#4e3322', light: '#e8d5b0', dark: '#9c6b4a', white: '#f8f4ea', black: '#2a2622',
  selected: 'rgba(232, 194, 122, 0.55)', target: 'rgba(232, 194, 122, 0.9)', die: '#f8f4ea', pip: '#2a2622',
};
export const BG_COPY = {
  roll: 'Roll',
  opening: 'Opening roll: one die each, the higher starts',
  white: 'White',
  black: 'Black',
};
const tie = (d: number) => `Both rolled ${d}: roll again`;
const starts = (w: number, b: number, who: string) => `White ${w}, Black ${b}: ${who} starts`;
const cantMove = (who: string) => `${who} can't move. `;
const pips = (w: number, b: number) => `Pips: White ${w} · Black ${b}`;
const NAME: Record<Side, string> = { white: BG_COPY.white, black: BG_COPY.black };
/** A die's pips, as (x, y) in a unit square. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]], 2: [[0.27, 0.27], [0.73, 0.73]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]],
};

/** Where one of your points is drawn, seen from your chair: its column's left edge and whether it hangs from the
 * top. White's home board is at the bottom right; black sits across the table, so black sees it all turned round. */
export function pointCell(at: number, you: Side): { x: number; top: boolean } {
  const a = you === 'white' ? at : 25 - at; // white's numbering
  const x = a <= 6 ? 13 - a : a <= 12 ? 12 - a : a <= 18 ? a - 13 : a - 12;
  const top = a > 12;
  return you === 'white' ? { x, top } : { x: BOARD_W - 1 - x, top: !top };
}

/** Backgammon's Roll button: on your turn, before you move. */
export function canRoll({ game, live }: BoardView): boolean {
  return live && game instanceof BackgammonGame && game.phase() !== 'move';
}

/** The line under the status: how to start, a tie, who starts, a turn lost to a roll with no move, the pip counts. */
export function backgammonInfo({ game }: BoardView): string {
  if (!(game instanceof BackgammonGame)) return '';
  const roll = game.lastRoll();
  if (game.phase() === 'opening') return roll ? tie(roll.dice[0]) : BG_COPY.opening;
  if (roll?.side === null && game.dice().length === 2) return starts(roll.dice[0], roll.dice[1], NAME[game.turn()]);
  const stuck = game.blocked();
  return `${stuck ? cantMove(NAME[stuck]) : ''}${pips(game.pips('white'), game.pips('black'))}`;
}

/**
 * The backgammon board in the panel, drawn in SVG as you see it from your chair: Roll, then click one of your
 * checkers (or the bar) to see where it can go with the dice left, and a highlighted point (or the tray) to move it
 * there, one die at a time. The dice of the last roll show between the rows, the used ones faded.
 */
export class BackgammonBoard implements PanelBoard {
  readonly element: HTMLElement;
  private svg: SVGSVGElement;
  private game: BackgammonGame | null = null;
  private drawn = -1;
  private you: Side = 'white';
  private live = false;
  private selected: number | null = null;

  /** `onEntry` takes the entries this board makes: rolls and moves. */
  constructor(private doc: Document, private onEntry: (entry: string) => void, private random: () => number = Math.random) {
    this.element = doc.createElement('div');
    this.element.className = 'backgammon-board';
    this.svg = doc.createElementNS(SVG, 'svg') as SVGSVGElement;
    this.svg.setAttribute('viewBox', `0 0 ${BOARD_W} ${BOARD_H}`);
    this.svg.setAttribute('aria-label', 'Backgammon board');
    this.svg.addEventListener('click', (e) => this.click(e));
    this.element.append(this.svg);
  }

  actions(view: BoardView): PanelAction[] {
    return [{ label: BG_COPY.roll, enabled: canRoll(view), run: () => this.onEntry(rollEntry(this.random)) }];
  }

  info(view: BoardView): string {
    return backgammonInfo(view);
  }

  draw(game: GameRules | null, you: Side, live: boolean): void {
    const g = game instanceof BackgammonGame ? game : null;
    const moves = g?.moves.length ?? -1;
    if (g !== this.game || moves !== this.drawn || !live) this.selected = null;
    this.game = g;
    this.drawn = moves;
    this.you = you;
    this.live = live;
    const from = new Set(live && g ? g.legal().map((m) => m.from) : []);
    if (from.size === 1 && from.has(BAR)) this.selected = BAR; // only the bar can move: it's picked already
    this.render();
  }

  private click(e: MouseEvent): void {
    const at = Number((e.target as Element).closest('[data-at]')?.getAttribute('data-at') ?? NaN);
    const g = this.game;
    if (!g || !this.live || Number.isNaN(at)) return;
    const move = this.selected === null ? undefined : g.legal().find((m) => m.from === this.selected && m.to === at);
    if (move) {
      this.selected = null;
      this.onEntry(move.text);
      return;
    }
    this.selected = at !== this.selected && g.targets(at).length ? at : null;
    this.render();
  }

  private render(): void {
    const g = this.game ?? new BackgammonGame();
    const you = this.you;
    const them: Side = you === 'white' ? 'black' : 'white';
    const targets = this.selected === null ? [] : g.targets(this.selected);
    const flip = (x: number) => (you === 'white' ? x : BOARD_W - x);
    const nodes: SVGElement[] = [];
    const node = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const n = this.doc.createElementNS(SVG, tag) as SVGElement;
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text !== undefined) n.textContent = text;
      nodes.push(n);
      return n;
    };
    const checker = (side: Side, cx: number, cy: number, label?: number) => {
      node('circle', { cx, cy, r: R, fill: COLOURS[side], stroke: COLOURS[side === 'white' ? 'black' : 'white'], 'stroke-width': 0.06 });
      if (label) node('text', { x: cx, y: cy, 'font-size': 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: COLOURS[side === 'white' ? 'black' : 'white'] }, String(label));
    };
    node('rect', { x: 0, y: 0, width: BOARD_W, height: BOARD_H, fill: COLOURS.felt });
    node('rect', { x: flip(6) - (you === 'white' ? 0 : 1), y: 0, width: 1, height: BOARD_H, fill: COLOURS.wood });
    node('rect', { x: you === 'white' ? TRAY : 0, y: 0, width: BOARD_W - TRAY, height: BOARD_H, fill: COLOURS.tray });
    // The 24 points, your own numbering, and the checkers on them (five drawn, the fifth numbered if more)
    for (let at = 1; at <= 24; at++) {
      const { x, top } = pointCell(at, you);
      const tip = top ? 4.8 : BOARD_H - 4.8;
      const base = top ? 0 : BOARD_H;
      node('polygon', { points: `${x},${base} ${x + 1},${base} ${x + 0.5},${tip}`, fill: at % 2 ? COLOURS.dark : COLOURS.light });
      if (at === this.selected) node('rect', { x, y: top ? 0 : BOARD_H - 5.5, width: 1, height: 5.5, fill: COLOURS.selected });
      const step = top ? 0.9 : -0.9;
      const first = top ? R + 0.05 : BOARD_H - R - 0.05;
      for (const side of [you, them]) {
        const n = g.count(side, side === you ? at : 25 - at);
        for (let k = 0; k < Math.min(n, 5); k++) checker(side, x + 0.5, first + k * step, k === 4 && n > 5 ? n : undefined);
      }
      if (targets.includes(at)) node('circle', { cx: x + 0.5, cy: first + Math.min(g.count(you, at), 4) * step, r: 0.18, fill: COLOURS.target });
    }
    // The bar and the tray: your checkers in the half nearer you
    const barX = flip(6.5);
    if (this.selected === BAR) node('rect', { x: barX - 0.5, y: BOARD_H / 2, width: 1, height: BOARD_H / 2, fill: COLOURS.selected });
    for (const side of [you, them]) {
      const n = g.count(side, BAR);
      const dir = side === you ? 1 : -1;
      for (let k = 0; k < Math.min(n, 5); k++) checker(side, barX, BOARD_H / 2 + dir * (0.7 + k * 0.9), k === 4 && n > 5 ? n : undefined);
      const off = g.count(side, OFF);
      const trayX = you === 'white' ? TRAY + 0.1 : 0.1;
      for (let k = 0; k < off; k++) {
        const y = side === you ? BOARD_H - 0.3 * (k + 1) : 0.3 * k + 0.05;
        node('rect', { x: trayX, y, width: BOARD_W - TRAY - 0.2, height: 0.25, rx: 0.05, fill: COLOURS[side], stroke: COLOURS[side === 'white' ? 'black' : 'white'], 'stroke-width': 0.03 });
      }
    }
    if (targets.includes(OFF)) node('rect', { x: you === 'white' ? TRAY : 0, y: BOARD_H / 2, width: BOARD_W - TRAY, height: BOARD_H / 2, fill: COLOURS.selected });
    this.dice(g, node);
    // What a click means: a point, the bar or the tray, in your numbering
    for (let at = 1; at <= 24; at++) {
      const { x, top } = pointCell(at, you);
      node('rect', { x, y: top ? 0 : BOARD_H / 2, width: 1, height: BOARD_H / 2, fill: '#000', 'fill-opacity': 0, 'data-at': at });
    }
    node('rect', { x: barX - 0.5, y: BOARD_H / 2, width: 1, height: BOARD_H / 2, fill: '#000', 'fill-opacity': 0, 'data-at': BAR });
    node('rect', { x: you === 'white' ? TRAY : 0, y: BOARD_H / 2, width: BOARD_W - TRAY, height: BOARD_H / 2, fill: '#000', 'fill-opacity': 0, 'data-at': OFF });
    this.svg.replaceChildren(...nodes);
  }

  /** The last roll's dice in the middle of your right-hand half, the used ones faded (four for a double). */
  private dice(g: BackgammonGame, node: (tag: string, attrs: Record<string, string | number>) => SVGElement): void {
    const roll = g.lastRoll();
    if (!roll) return;
    const [a, b] = roll.dice;
    const all = roll.side !== null && a === b ? [a, a, a, a] : [a, b];
    const left = g.phase() === 'move' ? [...g.dice()] : [];
    const opening = roll.side === null && g.phase() === 'opening';
    all.forEach((d, i) => {
      const unused = opening || left.includes(d);
      if (unused) left.splice(left.indexOf(d), 1);
      const x = 8 + i * 1.2 + (all.length === 2 ? 0.6 : 0);
      const y = BOARD_H / 2 - 0.45;
      node('rect', { x, y, width: 0.9, height: 0.9, rx: 0.15, fill: COLOURS.die, opacity: unused ? 1 : 0.35 });
      for (const [px, py] of PIPS[d]) node('circle', { cx: x + px * 0.9, cy: y + py * 0.9, r: 0.08, fill: COLOURS.pip, opacity: unused ? 1 : 0.35 });
    });
  }
}
```

- [ ] **Step 4: Styles**

In `web/src/style.css`, replace the selector at the start of the line `.chess-board svg { display: block; width: 100%; height: auto; user-select: none; -webkit-user-select: none; cursor: pointer; }` so the line reads:

```css
.chess-board svg, .backgammon-board svg { display: block; width: 100%; height: auto; user-select: none; -webkit-user-select: none; cursor: pointer; }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/backgammon-board.test.ts`
Expected: PASS (6 tests).

Run: `cd web && npm test && npm run build`
Expected: 42 test files, 404 tests pass; the build is clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/backgammon-board.ts web/src/style.css web/tests/backgammon-board.test.ts
git commit -m "Games: the backgammon board in the panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The backgammon case on the table (`backgammon-set.ts`)

**Files:**
- Modify: `web/src/config.ts` (`games.slots[1]`, `games.backgammon`)
- Create: `web/src/backgammon-set.ts`
- Modify: `web/src/table-pieces.ts` (`SETS` gains `backgammon`)
- Test: `web/tests/backgammon-set.test.ts`, `web/tests/table-pieces.test.ts`

**Interfaces:**
- Consumes (Task 3): `BackgammonGame` (`checkers`, `lastRoll`), `BAR`, `OFF`. (Task 1): `SETS`. Phase 1: `TableMaterials` (`make(name, colour, map?, gloss?)`), `TableSet`, `CanvasFactory`, `ease` from `./player`, `GameRules`, `Side`.
- Produces:
  - `CONFIG.games.slots[1]` = `[1.755, 3.2]`; `CONFIG.games.backgammon` (values in Global Constraints)
  - `caseLayout(cfg?)`: `{ left, right, bar, point, tray, edge }` (the field's left and right x, the bar's middle x, the point width, the tray's middle x, the inside's half depth)
  - `checkerPosition(side: Side, at: number, height: number, cfg?): [x, y, z]` (in the case, from its middle on the table top)
  - `DIE_FACES = [3, 4, 1, 6, 2, 5]` (the value on each `BoxGeometry` face: +x, -x, +y, -y, +z, -z); `dieRotation(value: number, yaw: number): [x, y, z]` (Euler, order `YXZ`)
  - `class BackgammonSet implements TableSet { readonly checkers: Map<number, Mesh>; readonly dice: Mesh[]; constructor(materials: TableMaterials, canvas: CanvasFactory | null) }`, root named `'Backgammon'`, checkers `'Backgammon checker <id>'`, dice `'Backgammon die 0'` / `'1'`

The case, from its middle (white at +z, white's right +x): a wooden floor and rim, a field of 24 points painted on a canvas texture (white's 1..6 at the near right, round by the left end to 24 at the far right), a raised bar in the field's middle, and the bear-off tray at the +x end behind a divider. On a point, checkers lie five in a row from the edge, then on top; on the bar, each side's in its own half on top of the bar; borne off, in its own half of the tray. Before any roll the dice rest in the tray's middle; a roll puts them in the roller's right-hand half (white: +x, black: -x), the opening roll's white die on white's side and black's on black's.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/backgammon-set.test.ts`:

```ts
import { Euler, type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BackgammonGame, BAR, OFF } from '../src/backgammon-game';
import { BackgammonSet, caseLayout, checkerPosition, DIE_FACES, dieRotation } from '../src/backgammon-set';
import { CONFIG } from '../src/config';
import { TableMaterials } from '../src/table-pieces';

const cfg = CONFIG.games.backgammon;
const game = (...entries: string[]) => {
  const g = new BackgammonGame();
  for (const e of entries) expect(g.play(e), e).toBe(true);
  return g;
};
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => new Vector3(x, y, z));
/** The value on a die's top face. */
const top = (rotation: Euler) => DIE_FACES[NORMALS.findIndex((n) => n.clone().applyEuler(rotation).y > 0.9)];
const at = (m: Mesh) => m.position.toArray();

describe('the backgammon case on the table', () => {
  it("fits between the table's fruit bowl (to x 1.58) and its mug and books (from x 1.93), clear of the chessboard", () => {
    const [chess, backgammon] = CONFIG.games.slots.map(([x]) => x);
    expect(backgammon - cfg.width / 2).toBeGreaterThanOrEqual(1.6);
    expect(backgammon + cfg.width / 2).toBeLessThanOrEqual(1.91);
    expect(backgammon - cfg.width / 2).toBeGreaterThan(chess + CONFIG.games.chess.size / 2);
    expect(Math.abs(CONFIG.games.slots[1][1] - 3.2)).toBeLessThan(0.01);
    expect(cfg.depth).toBeLessThanOrEqual(0.4);
  });
  it("lays white's home at the near right (+x, +z) and black's at the far right, each from its own side", () => {
    const [x1, , z1] = checkerPosition('white', 1, 0);
    expect(x1).toBeGreaterThan(0);
    expect(z1).toBeGreaterThan(0);
    const [x24, , z24] = checkerPosition('white', 24, 0);
    expect(x24).toBeCloseTo(x1);
    expect(z24).toBeCloseTo(-z1);
    expect(checkerPosition('black', 1, 0)).toEqual(checkerPosition('white', 24, 0));
    expect(checkerPosition('white', 12, 0)[0]).toBeLessThan(checkerPosition('white', 7, 0)[0]); // 7..12 run left
  });
  it('keeps every point inside the case, a checker apart', () => {
    const { left, right } = caseLayout();
    const xs = Array.from({ length: 12 }, (_, i) => checkerPosition('white', i + 1, 0)[0]).sort((a, b) => a - b);
    expect(xs[0] - cfg.checker).toBeGreaterThanOrEqual(left);
    expect(xs[11] + cfg.checker).toBeLessThanOrEqual(right);
    for (let i = 1; i < 12; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(2 * cfg.checker);
  });
  it('stacks five in a row from the edge, then on top', () => {
    const first = checkerPosition('white', 6, 0);
    const fifth = checkerPosition('white', 6, 4);
    const sixth = checkerPosition('white', 6, 5);
    expect(fifth[2]).toBeLessThan(first[2]); // toward the middle
    expect([sixth[0], sixth[2]]).toEqual([first[0], first[2]]);
    expect(sixth[1]).toBeCloseTo(first[1] + cfg.thickness);
  });
  it("puts each side's bar checkers on the bar in its own half, and borne-off ones in its half of the tray", () => {
    const { bar, tray } = caseLayout();
    const w = checkerPosition('white', BAR, 0);
    const b = checkerPosition('black', BAR, 0);
    expect([w[0], b[0]]).toEqual([bar, bar]);
    expect(w[2]).toBeGreaterThan(0);
    expect(b[2]).toBeLessThan(0);
    expect(w[1]).toBeCloseTo(cfg.base + cfg.wall);
    expect(checkerPosition('white', OFF, 0)[0]).toBe(tray);
    expect(checkerPosition('black', OFF, 3)[2]).toBeLessThan(0);
  });
  it('turns a die to show each value on top', () => {
    for (let v = 1; v <= 6; v++) expect(top(new Euler(...dieRotation(v, 0.7), 'YXZ'))).toBe(v);
  });
});

describe('BackgammonSet', () => {
  const make = () => new BackgammonSet(new TableMaterials({ matte: null, gloss: null }), null);
  it('sets out 30 checkers and two dice, resting in the tray', () => {
    const set = make();
    expect(set.checkers.size).toBe(30);
    expect(at(set.checkers.get(0)!)).toEqual(checkerPosition('white', 6, 0));
    expect(set.dice).toHaveLength(2);
    expect(set.dice[0].position.x).toBeCloseTo(caseLayout().tray);
  });
  it('slides a moved checker to its point', () => {
    const set = make();
    const moved = set.checkers.get(12)!;
    set.show(game('r61', '13/7', '8/7'));
    set.update(0.15);
    expect(moved.position.x).not.toBeCloseTo(checkerPosition('white', 13, 4)[0]); // on its way
    set.update(1);
    expect(at(moved)).toEqual(checkerPosition('white', 7, 0));
    expect(at(set.checkers.get(7)!)).toEqual(checkerPosition('white', 7, 1));
    set.show(null); // a new game: everything goes home
    set.update(1);
    expect(at(moved)).toEqual(checkerPosition('white', 13, 4));
  });
  it("tumbles the dice to the roller's half, showing the roll", () => {
    const set = make();
    set.show(game('r35', '24/21', '13/8', 'r62'));
    set.update(0.2);
    expect(top(set.dice[0].rotation)).toBeUndefined(); // still tumbling
    set.update(1);
    expect(set.dice.map((d) => top(d.rotation))).toEqual([6, 2]);
    for (const d of set.dice) expect(d.position.x).toBeGreaterThan(caseLayout().bar); // white's right
    set.show(game('r35'));
    set.update(1);
    expect(set.dice.map((d) => top(d.rotation))).toEqual([3, 5]);
    expect(set.dice[0].position.x).toBeGreaterThan(caseLayout().bar); // the opening: white's die on white's side
    expect(set.dice[1].position.x).toBeLessThan(caseLayout().bar);
  });
});
```

In `web/tests/table-pieces.test.ts`, replace the test `it("puts the chessboard at slot 0's place on the table, the other slots empty for now", …)` (all six lines) with:

```ts
  it('puts the chessboard and the backgammon case at their slots\' places on the table, slot 2 empty for now', () => {
    const t = new TableGames(null);
    expect(t.root.children.map((c) => c.name)).toEqual(['Chess', 'Backgammon']);
    t.root.children.forEach((c, slot) => {
      const [x, z] = CONFIG.games.slots[slot];
      expect(c.position.toArray()).toEqual([x, CONFIG.games.tableTop, z]);
    });
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/backgammon-set.test.ts tests/table-pieces.test.ts`
Expected: FAIL: `../src/backgammon-set` cannot be resolved, and the table has only the chessboard.

- [ ] **Step 3: Config**

In `web/src/config.ts`, in the `games` block, replace the `slots` doc comment and line

```ts
    /** Each slot's middle (x, z): halfway between its two chairs' spots in seats.json (z 3.2), and level with them,
     * except slot 0, 10 cm toward the table's end to clear the fruit bowl. */
    slots: [[1.15, 3.2], [1.8, 3.2], [2.35, 3.2]] as [number, number][],
```

with:

```ts
    /** Each slot's middle (x, z): halfway between its two chairs' spots in seats.json (z 3.2), and level with them,
     * except slot 0, 10 cm toward the table's end to clear the fruit bowl, and slot 1, 4.5 cm toward it to sit
     * between the bowl (to x 1.58) and the mug and books (from x 1.93). */
    slots: [[1.15, 3.2], [1.755, 3.2], [2.35, 3.2]] as [number, number][],
```

After the `chess: { … },` entry (its closing `},`, just before the `games` block's own closing `},`), add:

```ts
    /** The backgammon case (m): its size across (x) and deep (z), the rim, bar and tray widths, the floor's thickness
     * and the walls' height above it; the checkers' radius and thickness, the dice's size, how long a roll tumbles
     * (s), and the colours. A travel case: the fruit bowl, the mug and the books leave 34 cm across at slot 1. */
    backgammon: {
      width: 0.3, depth: 0.28, rim: 0.012, bar: 0.018, tray: 0.03, base: 0.01, wall: 0.018,
      checker: 0.0085, thickness: 0.005, die: 0.012, tumble: 0.6,
      wood: '#6b4630', felt: '#33493b', light: '#e8d5b0', dark: '#9c6b4a', white: '#efe6d2', black: '#4a3b33', pips: '#2a2622',
    },
```

(`main.ts` reads `CONFIG.games.slots[1]` as the table's middle for how lit the pieces are; 4.5 cm makes no difference there.)

- [ ] **Step 4: The case**

Create `web/src/backgammon-set.ts`:

```ts
import {
  BoxGeometry, CanvasTexture, CylinderGeometry, Euler, Group, type Material, Mesh, type MeshMatcapMaterial, PlaneGeometry,
  SRGBColorSpace, Vector3,
} from 'three';
import { BackgammonGame, BAR, OFF } from './backgammon-game';
import { CONFIG } from './config';
import type { GameRules, Side } from './games';
import { ease } from './player';
import type { CanvasFactory } from './screens';
import type { TableMaterials, TableSet } from './table-pieces';

type Cfg = typeof CONFIG.games.backgammon;

/** The value on each face of a die, in three.js's box face order (+x, -x, +y, -y, +z, -z): opposite faces add to 7. */
export const DIE_FACES = [3, 4, 1, 6, 2, 5] as const;

/** The case's inside across (x; white's right is +x): the field from the left rim to the divider before the tray,
 * the bar in the field's middle, the point width, the tray's middle, and the inside's half depth (z). */
export function caseLayout(cfg: Cfg = CONFIG.games.backgammon) {
  const left = -cfg.width / 2 + cfg.rim;
  const right = cfg.width / 2 - 2 * cfg.rim - cfg.tray;
  return {
    left, right, bar: (left + right) / 2, point: (right - left - cfg.bar) / 12,
    tray: cfg.width / 2 - cfg.rim - cfg.tray / 2, edge: cfg.depth / 2 - cfg.rim,
  };
}

/** A point's middle across the case, by white's numbering: white's home (1..6) at the near right, round by the left
 * end to 24 at the far right. */
function pointX(a: number, cfg: Cfg): number {
  const { left, right, bar, point } = caseLayout(cfg);
  if (a <= 6) return right - (a - 0.5) * point;
  if (a <= 12) return bar - cfg.bar / 2 - (a - 6.5) * point;
  if (a <= 18) return left + (a - 12.5) * point;
  return bar + cfg.bar / 2 + (a - 18.5) * point;
}

/**
 * Where a checker lies in the case (x, y, z from the case's middle on the table; white at +z): on a point, five in a
 * row from the edge and the next ones on top; on the bar, each side's in its own half (on top of the bar); borne off,
 * in each side's half of the tray. `at` is its side's own numbering (0 off, 25 the bar), `height` its place in the
 * stack.
 */
export function checkerPosition(side: Side, at: number, height: number, cfg: Cfg = CONFIG.games.backgammon): [number, number, number] {
  const { bar, tray, edge } = caseLayout(cfg);
  const d = 2 * cfg.checker + 0.0005;
  const row = height % 5;
  const y = cfg.base + Math.floor(height / 5) * cfg.thickness;
  const toward = side === 'white' ? 1 : -1;
  if (at === BAR) return [bar, y + cfg.wall, toward * (0.01 + (row + 0.5) * d)];
  if (at === OFF) return [tray, y, toward * (edge - (row + 0.5) * d)];
  const a = side === 'white' ? at : 25 - at;
  return [pointX(a, cfg), y, (a <= 12 ? 1 : -1) * (edge - (row + 0.5) * d)];
}

/** The rotation (Euler, order YXZ) that shows `value` on top, turned `yaw` about the vertical. */
export function dieRotation(value: number, yaw: number): [number, number, number] {
  switch (value) {
    case 2: return [-Math.PI / 2, yaw, 0];
    case 3: return [0, yaw, Math.PI / 2];
    case 4: return [0, yaw, -Math.PI / 2];
    case 5: return [Math.PI / 2, yaw, 0];
    case 6: return [Math.PI, yaw, 0];
    default: return [0, yaw, 0];
  }
}

/** Where the two dice lie (x, z): the last roller's in their right-hand half (white's right is +x), the opening roll's
 * white die on white's side and black's on black's; before any roll, in the tray. */
function dicePlaces(roller: Side | null | undefined, cfg: Cfg): [number, number][] {
  const { bar, point, tray } = caseLayout(cfg);
  const half = cfg.bar / 2 + 3 * point;
  if (roller === undefined) return [[tray, -0.012], [tray, 0.012]];
  if (roller === null) return [[bar + half, 0.01], [bar - half, -0.01]];
  const x = roller === 'white' ? bar + half : bar - half;
  return [[x - 0.018, 0.004], [x + 0.018, -0.004]];
}

/** The points painted on the case's floor, white's side at the bottom (+z). */
function drawPoints(ctx: CanvasRenderingContext2D, w: number, h: number, cfg: Cfg): void {
  const { left, right, point, edge } = caseLayout(cfg);
  const inside = cfg.width - 2 * cfg.rim;
  const px = (x: number) => ((x - left) / inside) * w;
  const pz = (z: number) => ((z + edge) / (2 * edge)) * h;
  ctx.fillStyle = cfg.felt;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = cfg.wood;
  ctx.fillRect(px(right), 0, w - px(right), h);
  for (let a = 1; a <= 24; a++) {
    const x = pointX(a, cfg);
    const near = a <= 12;
    const base = near ? edge : -edge;
    const tip = base - (near ? 1 : -1) * edge * 0.85;
    ctx.fillStyle = a % 2 ? cfg.dark : cfg.light;
    ctx.beginPath();
    ctx.moveTo(px(x - point / 2), pz(base));
    ctx.lineTo(px(x + point / 2), pz(base));
    ctx.lineTo(px(x), pz(tip));
    ctx.closePath();
    ctx.fill();
  }
}

/** One face of a die: its pips on the die's colour. */
function drawFace(ctx: CanvasRenderingContext2D, px: number, value: number, cfg: Cfg): void {
  const spots: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]], 2: [[0.25, 0.25], [0.75, 0.75]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.25, 0.22], [0.75, 0.22], [0.25, 0.5], [0.75, 0.5], [0.25, 0.78], [0.75, 0.78]],
  };
  ctx.fillStyle = cfg.white;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = cfg.pips;
  for (const [x, y] of spots[value]) {
    ctx.beginPath();
    ctx.arc(x * px, y * px, px * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
}

interface Slide { mesh: Mesh; from: Vector3; to: Vector3; t: number }
interface Die extends Slide { turn: Euler }

/** The backgammon case on the table: 24 painted points, 15 checkers a side that slide from point to point, and two
 * dice that tumble to show the last roll. */
export class BackgammonSet implements TableSet {
  readonly root = new Group();
  /** Each checker by its id (white 0..14, black 15..29). */
  readonly checkers = new Map<number, Mesh>();
  readonly dice: Mesh[] = [];
  private slides = new Map<number, Slide>();
  private rolled = -2;
  private dieSlides: Die[] = [];

  constructor(materials: TableMaterials, canvas: CanvasFactory | null) {
    const cfg = CONFIG.games.backgammon;
    const { right, bar, edge } = caseLayout(cfg);
    this.root.name = 'Backgammon';
    const wood = materials.make('Backgammon case', cfg.wood);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new Mesh(new BoxGeometry(w, h, d), wood);
      m.position.set(x, y, z);
      this.root.add(m);
    };
    const wallY = cfg.base + cfg.wall / 2;
    box(cfg.width, cfg.base, cfg.depth, 0, cfg.base / 2, 0);
    box(cfg.rim, cfg.wall, cfg.depth, -(cfg.width - cfg.rim) / 2, wallY, 0);
    box(cfg.rim, cfg.wall, cfg.depth, (cfg.width - cfg.rim) / 2, wallY, 0);
    box(cfg.width, cfg.wall, cfg.rim, 0, wallY, (cfg.depth - cfg.rim) / 2);
    box(cfg.width, cfg.wall, cfg.rim, 0, wallY, -(cfg.depth - cfg.rim) / 2);
    box(cfg.rim, cfg.wall, 2 * edge, right + cfg.rim / 2, wallY, 0); // between the field and the tray
    box(cfg.bar, cfg.wall, 2 * edge, bar, wallY, 0);
    let floor: MeshMatcapMaterial = materials.make('Backgammon felt', cfg.felt);
    const w = 768;
    const h = Math.round((w * 2 * edge) / (cfg.width - 2 * cfg.rim));
    const surface = canvas?.(w, h);
    const ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (surface && ctx) {
      drawPoints(ctx, w, h, cfg);
      const map = new CanvasTexture(surface as unknown as HTMLCanvasElement);
      map.colorSpace = SRGBColorSpace;
      floor = materials.make('Backgammon points', '#ffffff', map);
    }
    const points = new Mesh(new PlaneGeometry(cfg.width - 2 * cfg.rim, 2 * edge).rotateX(-Math.PI / 2), floor);
    points.position.y = cfg.base + 0.0005;
    this.root.add(points);
    const geometry = new CylinderGeometry(cfg.checker, cfg.checker, cfg.thickness, 24).translate(0, cfg.thickness / 2, 0);
    const sides = { white: materials.make('Backgammon white', cfg.white, null, true), black: materials.make('Backgammon black', cfg.black, null, true) };
    for (const c of new BackgammonGame().checkers()) {
      const mesh = new Mesh(geometry, sides[c.side]);
      mesh.name = `Backgammon checker ${c.id}`;
      mesh.position.set(...checkerPosition(c.side, c.at, c.height));
      this.root.add(mesh);
      this.checkers.set(c.id, mesh);
      this.slides.set(c.id, { mesh, from: mesh.position.clone(), to: mesh.position.clone(), t: 1 });
    }
    const faces: Material[] = DIE_FACES.map((v) => {
      const s = canvas?.(64, 64);
      const c = s?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
      if (!s || !c) return materials.make(`Backgammon die ${v}`, cfg.white);
      drawFace(c, 64, v, cfg);
      const map = new CanvasTexture(s as unknown as HTMLCanvasElement);
      map.colorSpace = SRGBColorSpace;
      return materials.make(`Backgammon die ${v}`, '#ffffff', map);
    });
    const cube = new BoxGeometry(cfg.die, cfg.die, cfg.die);
    for (let i = 0; i < 2; i++) {
      const mesh = new Mesh(cube, faces);
      mesh.name = `Backgammon die ${i}`;
      mesh.rotation.order = 'YXZ';
      this.root.add(mesh);
      this.dice.push(mesh);
      this.dieSlides.push({ mesh, from: new Vector3(), to: new Vector3(), t: 1, turn: new Euler(0, 0, 0, 'YXZ') });
    }
    this.show(null);
  }

  show(game: GameRules | null): void {
    const g = game instanceof BackgammonGame ? game : new BackgammonGame();
    for (const c of g.checkers()) {
      const s = this.slides.get(c.id)!;
      const [x, y, z] = checkerPosition(c.side, c.at, c.height);
      if (s.to.x === x && s.to.y === y && s.to.z === z) continue;
      s.from.copy(s.mesh.position);
      s.to.set(x, y, z);
      s.t = 0;
    }
    const cfg = CONFIG.games.backgammon;
    const roll = g.lastRoll();
    const index = roll?.index ?? -1;
    if (index === this.rolled) return;
    const first = this.rolled === -2;
    this.rolled = index;
    const places = dicePlaces(roll ? roll.side : undefined, cfg);
    const values = roll?.dice ?? [5, 2];
    this.dieSlides.forEach((d, i) => {
      const yaw = ((index + 2) * 0.9 + i * 1.3) % (Math.PI * 2);
      d.turn.set(...dieRotation(values[i], yaw));
      d.to.set(places[i][0], cfg.base + cfg.die / 2, places[i][1]);
      d.from.copy(first ? d.to : d.mesh.position);
      d.t = first ? 1 : 0;
      if (first) {
        d.mesh.position.copy(d.to);
        d.mesh.rotation.copy(d.turn);
      }
    });
  }

  update(dt: number): void {
    for (const s of this.slides.values()) {
      if (s.t >= 1) continue;
      s.t = Math.min(1, s.t + dt / CONFIG.games.slide);
      if (s.t === 1) {
        s.mesh.position.copy(s.to);
        continue;
      }
      s.mesh.position.lerpVectors(s.from, s.to, ease(s.t));
      s.mesh.position.y += Math.sin(Math.PI * s.t) * 0.03; // a little hop over the stacks
    }
    for (const d of this.dieSlides) {
      if (d.t >= 1) continue;
      d.t = Math.min(1, d.t + dt / CONFIG.games.backgammon.tumble);
      if (d.t === 1) {
        d.mesh.position.copy(d.to);
        d.mesh.rotation.copy(d.turn);
        continue;
      }
      const e = ease(d.t);
      d.mesh.position.lerpVectors(d.from, d.to, e);
      d.mesh.position.y += Math.sin(Math.PI * d.t) * 0.04;
      const spin = (1 - e) * Math.PI * 4;
      d.mesh.rotation.set(d.turn.x + spin, d.turn.y + spin / 2, d.turn.z + spin * 0.75);
    }
  }
}
```

- [ ] **Step 5: On the table**

In `web/src/table-pieces.ts`, add after `import { Color, Group, MeshMatcapMaterial, type Object3D, type Texture } from 'three';`:

```ts
import { BackgammonSet } from './backgammon-set';
```

and add a line to `SETS` so it reads:

```ts
export const SETS: Partial<Record<GameKind, (materials: TableMaterials, canvas: CanvasFactory | null) => TableSet>> = {
  chess: (materials, canvas) => new ChessSet(materials, canvas),
  backgammon: (materials, canvas) => new BackgammonSet(materials, canvas),
};
```

`backgammon-set.ts` imports only types from `table-pieces.ts`, as `chess-set.ts` does, so there is no runtime cycle. The case now shows its starting position at slot 1 in every browser, before its rules are wired (Task 6); `TableGames` is added to the scene before `warmUpShaders`, so the new materials compile at load.

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/backgammon-set.test.ts tests/table-pieces.test.ts`
Expected: PASS (9 and 8 tests).

Run: `cd web && npm test && npm run build`
Expected: 43 test files, 413 tests pass; the build is clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/config.ts web/src/backgammon-set.ts web/src/table-pieces.ts web/tests/backgammon-set.test.ts web/tests/table-pieces.test.ts
git commit -m "Games: the backgammon case on the table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wiring backgammon in (`RULES`, the panel board, controls)

**Files:**
- Modify: `web/src/games.ts` (`RULES`)
- Modify: `web/src/main.ts` (the backgammon board, `walkthrough.games`)
- Modify: `web/index.html` (both controls lists)
- Test: `web/tests/games.test.ts`

**Interfaces:**
- Consumes: `BackgammonGame` (Task 3), `BackgammonBoard` (Task 4), `slotOf` and `playEntry(slot, entry)` (Task 2).
- Produces: `RULES` = `{ chess, backgammon }`, so slot 1 is playable: sitting there opens the panel with the backgammon board, the white player's browser opens the game, and the network carries it like chess. Under `?debug`, `window.walkthrough.games` is the `Games` (for Task 7's console checks).

- [ ] **Step 1: Write the failing tests**

In `web/tests/games.test.ts`:

In `it('replays a list of moves, or not when one is illegal or the kind has no rules yet', …)`, add after `expect(replay('chess', ['e2e4', 'e2e4'])).toBeNull();`:

```ts
    expect(replay('backgammon', ['r35', '24/21'])?.moves).toEqual(['r35', '24/21']);
    expect(replay('backgammon', ['r35', '24/18'])).toBeNull(); // no 6 was rolled
```

In `it('only slots with rules are playable', …)`, change the expectation to:

```ts
    expect([0, 1, 2].map((s) => g.playable(s))).toEqual([true, true, false]);
```

In `it('ignores what does not extend its game, replays illegally, or names others', …)`, change the slot-1 line to slot 2 (slot 1 has rules now):

```ts
    expect(rui.receive({ slot: 2, id: 'g6', white: 'ana', black: 'rui', moves: [] })).toBe(false); // no rules there yet
```

Insert before `it("leaves opening to the white player's browser", …)`:

```ts
  it("plays backgammon at slot 1, white's browser rolling the opening", () => {
    const at1 = (white: string | null, black: string | null): SlotSeats[] =>
      SLOTS.map((_, i) => (i === 1 ? { white, black } : { white: null, black: null }));
    const ana = setup('ana');
    const rui = setup('rui');
    const [g1] = ana.update(at1('ana', 'rui'), 0);
    expect(g1).toEqual({ slot: 1, id: 'g1', white: 'ana', black: 'rui', moves: [] });
    expect(ana.at(1)?.rules.kind).toBe('backgammon');
    rui.update(at1('ana', 'rui'), 0);
    expect(rui.receive(g1)).toBe(true);
    expect(rui.play(1, 'r35')).toBeNull(); // the opening roll is white's to make
    const opened = ana.play(1, 'r35')!;
    expect(rui.receive(opened)).toBe(true);
    expect(rui.play(1, '24/21')?.moves).toEqual(['r35', '24/21']); // black's 5 beat white's 3
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/games.test.ts`
Expected: FAIL: `replay('backgammon', …)` is null, slot 1 is not playable, and no game opens there.

- [ ] **Step 3: The rules**

In `web/src/games.ts`, add before `import { ChessGame } from './chess-game';`:

```ts
import { BackgammonGame } from './backgammon-game';
```

and replace the `RULES` line with:

```ts
export const RULES: Partial<Record<GameKind, () => GameRules>> = {
  chess: () => new ChessGame(),
  backgammon: () => new BackgammonGame(),
};
```

- [ ] **Step 4: `main.ts`**

Add before `import { BoardPanel, GAME_COPY, type PanelBoard } from './board-panel';`:

```ts
import { BackgammonBoard } from './backgammon-board';
```

Add the backgammon board to `boards`, so it reads:

```ts
  const boards: Partial<Record<GameKind, PanelBoard>> = {
    chess: new ChessBoard(document, (entry) => playEntry(slotOf('chess'), entry)),
    backgammon: new BackgammonBoard(document, (entry) => playEntry(slotOf('backgammon'), entry)),
  };
```

In the `?debug` line (`if (params.has('debug')) Object.assign(window, { walkthrough: { … } });`), replace `get others() { return others; } } });` with:

```ts
get others() { return others; }, get games() { return games; } } });
```

(`games` is declared further down in `run()`; the getter only reads it later, from the console, which TypeScript allows.)

- [ ] **Step 5: Controls on the start screen**

In `web/index.html`, replace

```html
              <li><span><kbd>Click</kbd></span> a chair at the chessboard on the dining table to play chess; <kbd>C</kbd> stands up</li>
```

with:

```html
              <li><span><kbd>Click</kbd></span> a chair at the chessboard or the backgammon case on the dining table to play; <kbd>C</kbd> stands up</li>
```

and replace

```html
              <li><span><kbd>Tap</kbd></span> a chair at the chessboard on the dining table to play chess</li>
```

with:

```html
              <li><span><kbd>Tap</kbd></span> a chair at the chessboard or the backgammon case on the dining table to play</li>
```

- [ ] **Step 6: Run the tests and the build**

Run: `cd web && npx vitest run tests/games.test.ts`
Expected: PASS (33 tests).

Run: `cd web && npm test && npm run build`
Expected: 43 test files, 414 tests pass; the build is clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/games.ts web/src/main.ts web/index.html web/tests/games.test.ts
git commit -m "Games: backgammon at the dining table, wired into the walkthrough

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Check it in the browser, README and the design note (run by the controller)

**Files:**
- Modify: `web/src/config.ts` (only if a value needs tuning)
- Modify: `README.md`, `docs/superpowers/specs/2026-10-28-dining-table-games-design.md`
- Any file at fault if a check fails (fix it, re-run `npm test && npm run build`, and commit the fix on its own).

Automated clicks can't take the pointer lock, so these checks use `?debug` (it exposes `window.walkthrough` with `player`, `scene`, `others` and, since Task 6, `games`) to seat visitors, and dispatch clicks on the panel. In a hidden Browser pane screenshots can lag and the frame loop slows; read state with `javascript_tool` when in doubt, and wait about a second after each entry before the next. The chair spots (from `web/public/assets/seats.json`): S1 `{ posture: 'sit', x: 1.7983, y: 0.4502, z: 3.8857, yaw: 0 }` (white), N1 `{ posture: 'sit', x: 1.8017, y: 0.4502, z: 2.5143, yaw: 3.1416 }` (black). For the chess check, S0 `{ posture: 'sit', x: 1.2483, y: 0.4502, z: 3.8857, yaw: 0 }`, N0 `{ posture: 'sit', x: 1.2517, y: 0.4502, z: 2.5143, yaw: 3.1416 }`.

The rare endings (gammon, backgammon, bearing off with a higher die, a roll with no move) are covered by the unit tests from custom positions (`new BackgammonGame(start)`, tests only); in the browser a few turns of a real game and a resignation are enough.

- [ ] **Step 1: Start the dev server**

Use the preview tool with the `walkthrough` configuration in `.claude/launch.json` (it runs `npm --prefix web run dev` on port 5173). Do not start it from Bash.

- [ ] **Step 2: The case on the table**

Open `http://localhost:5173/?room=bg-check-<random>&debug`, untick "Talk with your voice", name "Ana", start. Then run:

```js
walkthrough.player.teleport(1.755, 4.4, 0, -0.5)
```

Expected: a small open wooden case lies flat on the table between the fruit bowl (on its left) and the mug and books (on its right), touching none of them and clear of the chessboard; it neither floats above the wood nor sinks into it. 24 painted points; white's checkers in the starting position from your side (near side: five on your 6 point just right of the bar, three on your 8 point, the second left of the bar; far side: five on your 13 point at the left end, two on your 24 point at the right end), black's mirrored on the far side; the two dice in the tray at the right-hand end. `walkthrough.scene.getObjectByName('Backgammon').position` is `{ x: 1.755, y: 0.76, z: 3.2 }`. No console errors (`read_console_messages`). Press L to switch the Sala light off and on: the case and checkers dim and brighten like the chess set.

If the case touches the bowl, the mug or the books, move `CONFIG.games.slots[1][0]` or make `CONFIG.games.backgammon.width` smaller, and set the bounds in `backgammon-set.test.ts`'s first test to the gap you measured; if it floats or sinks, the table top is wrong for chess too (check `CONFIG.games.tableTop`). Reload and look again.

- [ ] **Step 3: Two players and the opening roll**

In the same tab: `walkthrough.player.sit({ posture: 'sit', x: 1.7983, y: 0.4502, z: 3.8857, yaw: 0 })`.
Expected: the panel opens: "Backgammon", "Empty chair" above the board, "Ana (you) · White" below, "Waiting for an opponent", buttons Resign, Roll, Stand up (Resign and Roll disabled). The board shows your home board at the bottom right and the tray at the right. Holding W does not stand Ana up.

Open a second tab on the same URL, name "Rui", start, and seat Rui on N1: `walkthrough.player.sit({ posture: 'sit', x: 1.8017, y: 0.4502, z: 2.5143, yaw: 3.1416 })`.
Expected within a second or two: Ana's panel says "Your move" with the line "Opening roll: one die each, the higher starts" and Roll enabled; Rui's panel says "Ana's move", Roll disabled, and Rui's board is the same board turned round (Rui's home board at the bottom left, the tray on the left).

In each tab, define the helpers:

```js
window.bg = () => walkthrough.games.at(1).rules;
window.roll = () => [...document.querySelectorAll('#board-actions button')].find((b) => b.textContent === 'Roll').click();
window.clickAt = (n) => document.querySelector(`#board-area rect[data-at="${n}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
// One legal move by clicks: the checker (unless only the bar can move: it is selected already), then its target
window.playOne = () => { const l = bg().legal(); const m = l[0]; if (!l.every((x) => x.from === 25)) clickAt(m.from); clickAt(m.to); return m.text; };
```

In Ana's tab: `roll()`. Expected: in both tabs the panel and the table show two dice (on the table, white's die tumbles into the +x half and black's into the -x half). On a tie the line says "Both rolled <n>: roll again" and Ana's Roll stays enabled: roll again. Otherwise the line says "White <w>, Black <b>: <White|Black> starts", and the starter's panel says "Your move" with Roll disabled.

- [ ] **Step 4: A few turns**

Play three turns each. In the tab of the side to move (`bg().turn()`): if Roll is enabled, `roll()`; then `playOne()` once per second until `bg().turn()` changes.
Expected each time:
- Clicking a checker by hand (instead of `playOne`) puts a dot on each target point (or lights the tray); clicking a dot moves it.
- The other tab's panel and the table follow within a second: the checker slides (about 0.3 s, with a small hop), a hit checker goes to the bar on the table and in both panels.
- Used dice fade; with doubles four dice show. The turn passes by itself when the dice are used or none fits, and the line returns to "Pips: White <w> · Black <b>", with the pips going down as the checkers move (167 each at the start). If a roll has no move at all, the line starts "<Side> can't move."
- `bg().moves` is the same list in both tabs; every entry is 8 characters or fewer.
- No console errors.

- [ ] **Step 5: A newcomer, resigning, standing up**

Open a third tab, name "Zé", start, don't sit. Compare `walkthrough.scene.getObjectByName('Backgammon checker 12').position` and the two `Backgammon die` objects' positions with Ana's tab. Expected: the same: Zé got the game with the flat's state, and the case shows the current position and the last roll.

On whoever's turn it is, click Resign; it asks "Resign this game?" with Resign and Keep playing; click Resign. Expected: both panels say "<Winner> wins: <Loser> resigned"; Roll and Resign are disabled; the final position stays on the table.

In Rui's tab press C (`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }))`): the game is over, so Rui stands at once; Ana's panel keeps the result and shows "Empty chair". Seat Rui again: a new game starts, the checkers slide home and the dice go back to the tray in all three tabs, and Ana's panel says "Opening roll: one die each, the higher starts".

Mid-game leave: Ana rolls the opening (again until it's not a tie) and the starter plays one checker. Then Ana presses C. Expected: "Stand up and resign?" with Stand up and Keep playing; Keep playing returns to the game; Stand up stands Ana and closes her panel; Rui's panel says "Black wins: White resigned" if it was Ana's turn, else "Black wins: White left the table".

- [ ] **Step 6: Chess is unchanged, and the phone layout**

Seat Ana on S0 and Rui on N0 (spots above). Expected: the chess panel's buttons are Resign, Offer draw, Stand up, as before. Ana plays e2e4 and Rui e7e5 (`document.querySelector('#board-area rect[data-square="e2"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`, then e4; likewise e7, e5 in Rui's tab); Ana clicks Offer draw (it reads "Draw offered", disabled) and plays g1f3; Rui's panel says "Ana offers a draw" with Accept draw; Rui accepts: both say "Draw: agreed". No line under the status in chess.

Resize to the mobile preset and reload Rui's tab, seat Rui on N1 again (Ana back on S1). Expected: the panel is nearly full width, the backgammon board fills it, Roll and the points are reachable by tap. Reset the viewport to desktop afterwards.

- [ ] **Step 7: Tuning, README and the design note**

If Steps 2–6 changed any `CONFIG.games` value, run `cd web && npm test && npm run build` and commit it:

```bash
git add web/src/config.ts web/tests/backgammon-set.test.ts
git commit -m "Games: tune the backgammon case's place on the table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

In `README.md`:

In the Controls paragraph under "Run and test", replace `C sits on the floor or gets you up (or, at the chessboard, asks first), click a chair at the chessboard on the dining table to play chess, ` with `C sits on the floor or gets you up (or, at a game board, asks first), click a chair at the chessboard or the backgammon case on the dining table to play, `.

In the touch paragraph, replace `Tap a chair at the chessboard on the dining table to play chess.` with `Tap a chair at the chessboard or the backgammon case on the dining table to play.`

In "Visitors together", in the chess paragraph (it starts "Two visitors can play chess at the dining table."), replace its last sentence `Backgammon and Go are to come at the table's other places.` with `Go is to come at the table's third place.`, and add this paragraph right after it:

```markdown
Backgammon is played at the middle pair of chairs, in a small travel case between the fruit bowl and the books; the window side plays white again. The panel shows the board from your chair, with a Roll button, the dice (used ones faded) and both pip counts. White's browser rolls the opening, one die each (a tie is rolled again), and the higher die starts, playing both dice. On your turn press Roll, then click a checker (or the bar) and one of the marked points (or the tray, to bear off), one die at a time: doubles give four moves, checkers on the bar enter first, a point with two of the other side's checkers is blocked and a single one is hit, you must use both dice if you can (the larger if only one fits), and the turn passes by itself when the dice are used up or none can be. A game ends when a side has borne off all 15, as a single game, a gammon (the loser has borne off none) or a backgammon (the loser still has a checker on the bar or in the winner's home board); there is no doubling cube. Resigning, standing up and leaving work as in chess. The rules are our own (`web/src/backgammon-game.ts`); dice are rolled in the roller's browser, which is fine among friends.
```

In `docs/superpowers/specs/2026-10-28-dining-table-games-design.md`:

Replace `**Status:** Approved. Phase 1 (the frame and chess) implemented; backgammon and Go to come.` with:

```markdown
**Status:** Approved. Phase 1 (the frame and chess) and Phase 2 (backgammon) implemented; Go to come.
```

In the Rules section, replace `**Backgammon** — our own \`backgammon.ts\`:` with `**Backgammon** — our own \`backgammon-game.ts\`:`. In "On the table", replace `an open backgammon case with 24 painted points, 30 checkers and two dice with pips.` with `an open backgammon travel case (30 × 28 cm: the table's fruit bowl, mug and books leave 34 cm at slot 1) with 24 painted points, 30 checkers and two dice with pips.`

```bash
git add README.md docs/superpowers/specs/2026-10-28-dining-table-games-design.md
git commit -m "Games: backgammon in the README, phase 2 done in the design note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Screenshot**

Take a screenshot of a player's backgammon panel mid-game and one of the case on the table with the dice, for the PR.
