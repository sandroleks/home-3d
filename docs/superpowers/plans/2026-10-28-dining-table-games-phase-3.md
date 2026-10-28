# Dining Table Games, Phase 3 (Go 9×9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two visitors who sit in the dining chairs N2 and S2 play Go on a 9×9 board in the on-screen panel, while everyone in the flat sees the stones go down on a wooden Go board at the table's rounded end.

**Architecture:** The frame from Phases 1 and 2 stays: a game is a `GameRules` object that replays a list of string entries, `Games` runs each slot's life and the network, `TableGames` shows each slot's set (from `SETS`) on the table, and `BoardPanel` is the player's overlay, with each game's `PanelBoard` bringing its own buttons (`actions`) and line (`info`). One small frame task comes first: a `score` end reason, and an optional `GameRules.resultText()` so a game can word its own result ("White wins by 5"), worked out locally from the entries; the margin is never sent. Then Go is purely additive: the rules (`go-game.ts`), the SVG board in the panel (`go-board.ts`), the board on the table (`go-set.ts`), and one line each in `RULES`, `SETS` and the panel boards in `main.ts`.

**Tech Stack:** TypeScript 5.6 (strict, `noUnusedLocals`, `noUnusedParameters`), Vite 8, Vitest 5 (node environment, no DOM), three.js 0.170, Trystero 0.26, chess.js 1.4.0 (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-28-dining-table-games-design.md` (its "Rules" section defines Go). Phase 2's plan: `docs/superpowers/plans/2026-10-28-dining-table-games-phase-2.md`.

**Written against** branch `claude/dining-table-backgammon` at `7603b82` (Phases 1 and 2). A whole-branch review of Phase 2 may still bring small fixes to the files this plan touches. If a name or a line quoted here has changed a little (a rename, a reworded comment), adapt to it; if something this plan relies on is gone or works differently (`SETS`, `PanelBoard.actions` / `info`, `panelState`, `endText`, `END_REASONS`, `Games.receive`), stop and report it instead of guessing.

## Global Constraints

- Run everything from `web/`: `npm test` (Vitest) and `npm run build` (`tsc --noEmit && vite build`). Both must pass at the end of every task. Before this plan: 43 test files, 414 tests.
- No new dependency. chess.js stays pinned at exactly `1.4.0`; Go is our own code.
- Slots: 0 = chess (chairs `Dining chair N0` / `S0`), 1 = backgammon (`N1` / `S1`), 2 = Go (`N2` / `S2`). The S chair plays white, the N chair black. **In Go black moves first**, so the N player places the first stone; white's browser still opens the game (the frame is unchanged). After this plan `RULES` and `SETS` have `chess`, `backgammon` and `go`.
- The frame task (1) changes no chess or backgammon behaviour: the same entries, results, copy and buttons.
- A game is a list of entries, always added by the side to move (`Games.play` also requires the seated player of that side). Go's entries, each at most 8 characters:
  - A point, GTP style: a column letter `A`..`J` without `I`, then a row `1`..`9`, e.g. `D4`. Upper case only, so every move has exactly one spelling (`Games` compares move lists entry by entry); `d4`, `I5`, `K1`, `A0`, `A10` are refused. Row 1 is white's side (the S chair, +z on the table), column A white's left (-x).
  - `pass`: two in a row end the game.
  - `resign`: "<Winner> wins: <Loser> resigned".
- Go rules: a stone goes on an empty point; it captures every opposing group it leaves without liberties; it may not leave its own group without liberties unless it captures (no suicide); it may not bring back the position from right before the opponent's last entry (simple ko). Prisoners (stones each side has captured) are counted for display only.
- The count, after two passes: area scoring. Each side's stones on the board plus the empty points (regions) bordered by its stones only; empty regions touching both colours, or none, count for no one. Komi 7 for white. Stones count as they stand ("play it out": capture dead stones before passing). The higher total wins; **an equal total is a draw** (dame make it possible even with komi 7).
- Results: `END_REASONS` (and so `EndReason`) gains `'score'`. `GameEnd` stays `{ winner, reason }`: **the margin is never sent.** `GoGame.resultText()` words the result from its own entries: "Black wins by <n>", "White wins by <n>", "Draw: equal score"; the panel shows it in place of `endText(end)` when the rules ended the game. `endText` still has a text for the reason (used only without `resultText`): "<Winner> wins: on points", "Draw: equal score". Adding a reason is safe: `Games` only ever takes an incoming `end` whose reason is `left` (`extend` returns false unless `m.end?.reason === 'left'`; `adopt` keeps `m.end` only when its reason is `left`); every other end is worked out from the entries. Phase 2 browsers drop a message carrying the new reason, and show no Go anyway.
- Panel: Resign and Stand up stay common; Go's own button is **Pass** (`PanelBoard.actions`), enabled on your move; its own line (`PanelBoard.info`) gives the prisoners and who just passed while the game runs, and the count once two passes end it. Names and anything else from other visitors go in by `textContent` only, never `innerHTML` (the Go board itself draws no visitor text). `PanelBoard.draw(game, you, live)` keeps its signature (passing a `BoardView` instead was considered: it would touch the chess and backgammon boards for no gain here).
- The board in the panel is seen from your chair, as in chess and backgammon: white sees A1 at the bottom left; black, across the table, sees the board turned 180°. The board has no coordinate labels, so the turn only shows in where the stones are, and the panel matches the board on the table in front of each player.
- Copy, verbatim (Phases 1 and 2 stay as they are): "Pass", "Prisoners: Black <b> · White <w>", "<Black|White> passed. " (followed by the prisoners), "Black: stones <s> + area <a> = <t> · White: stones <s> + area <a> + komi 7 = <t>". Results as above.
- `CONFIG.games` (final values): `slots: [[1.15, 3.2], [1.755, 3.2], [2.41, 3.2]]`; `go: { size: 0.28, margin: 0.02, thickness: 0.025, stone: 0.014, height: 0.009, drop: 0.03, wood: '#d8b077', lines: '#3b2c1e', white: '#f2eee4', black: '#2b2a28' }`. **Measured for this plan** by raycasting straight down onto the loaded model in the running app (`?debug`, the table sets hidden), every 2.5 mm: a 3 mm **table runner** lies across the table from x 1.85 to 2.25 (z 2.70..3.70, hanging over both long edges), under the mug (x 1.94..2.02, z 2.98..3.06) and the book stack (x 1.93..2.17, z 3.315..3.485); the table top is at y 0.760 (0.763 on the runner), z 2.735..3.665 at x 2.35, and its **end is rounded**: x 2.7475 at z 3.2, 2.725 at z 3.06 and 3.34, 2.68 at z 2.96 and 3.44, 2.525 at z 2.80 and 3.60. So slot 2 moves 6 cm toward the table's end (the chairs are at x 2.35): the 28 cm board spans x 2.27..2.55, 2 cm clear of the runner and 17.5 cm from the table's edge at its corners, and four rows of prisoners a side (z up to 0.265 from the middle) stay on the table and clear of the runner. A stand-in board of that size and place was checked by eye in the app. (Phase 2's backgammon case, x 1.605..1.905, overlaps the runner's left edge by 5.5 cm; that is out of this plan's scope.) Task 6 checks it in the browser.
- 3D: procedural geometry only (no Blender export). Matcap materials from `TableMaterials`, dimmed with the light at the table like the other sets. One shared geometry for all stones (a sphere flattened to `height`) and one material per colour; the board is a wooden box with a canvas texture of the lines and star points on top (plain wood without a canvas). Stones are made as they are played (keyed by the index of the entry that placed them); a new stone drops `drop` m onto its point in `CONFIG.games.slide` s; a captured one lifts off in an arc to a row on the table in front of the player who took it, nine to a row along the lines. The board is built through `SETS`, so it is in the scene before `warmUpShaders` runs; the stone materials (matcap, gloss, no map) use the same shader program as the chess pieces, which the warm-up compiles, so the first stone causes no stall.
- Files stay flat in `web/src/` (no subfolders), small and single-purpose. Match the code around you: short doc comments on exported things, the existing naming, `type` aliases (not interfaces) for anything sent as JSON.
- Commits end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Files

- Create `web/src/go-game.ts`: `GoGame` (the rules, replaying entries), `SIZE`, `COLUMNS`, `KOMI`, `pointName`, `parsePoint`, the types `GoStone`, `GoScore`.
- Create `web/src/go-board.ts`: the SVG board in the panel (`GoBoard`), `pointCell`, `canPass`, `goInfo`, `GO_COPY`.
- Create `web/src/go-set.ts`: the board on the table (`GoSet`), `pointPosition`, `prisonerPosition`.
- Modify `web/src/games.ts` (`END_REASONS`, `GameRules.resultText`, `endText`'s texts, `RULES`), `web/src/board-panel.ts` (`panelState`), `web/src/table-pieces.ts` (`SETS`), `web/src/config.ts` (`games.slots[2]`, `games.go`), `web/src/main.ts` (the Go board), `web/index.html` (the controls lists), `web/src/style.css`.
- Modify `README.md` (controls, Visitors together) and the design note (status line, the rules module's name, the draw, the board's size).
- Tests: create `web/tests/go-game.test.ts`, `web/tests/go-board.test.ts`, `web/tests/go-set.test.ts`; extend `web/tests/games.test.ts`, `web/tests/board-panel.test.ts`, `web/tests/table-pieces.test.ts`.

---

### Task 1: Frame: Go's count as an end, and a game's own result line

**Files:**
- Modify: `web/src/games.ts` (`END_REASONS`, `GameRules`, `DRAWN`, `WON`)
- Modify: `web/src/board-panel.ts` (`panelState`)
- Test: `web/tests/games.test.ts`, `web/tests/board-panel.test.ts`

**Interfaces:**
- Consumes (Phases 1 and 2): `END_REASONS`, `EndReason`, `GameEnd`, `GameRules`, `endText`, `isGameMessage` from `./games`; `panelState`, `PanelInput` from `./board-panel`.
- Produces:
  - `END_REASONS` gains `'score'`. `endText({ winner: 'black', reason: 'score' })` is `'Black wins: on points'`; `endText({ winner: null, reason: 'score' })` is `'Draw: equal score'`. Every earlier text is unchanged.
  - `GameRules.resultText?(): string | null`: a game's own wording of its result when its rules ended it (Go: "White wins by 5"); null while it runs or when it has nothing to add.
  - `panelState(input).status`, for an ended game, is `input.game.resultText()` when `input.game.end()` is set and that returns a string; otherwise `endText(input.end)` as before. A leave (`end` set, `game.end()` null) always reads as `endText`.

- [ ] **Step 1: Write the failing tests**

In `web/tests/games.test.ts`, in `describe('endText', …)`, add after the `it("names backgammon's three wins", …)` test (just before the `describe`'s closing `});`):

```ts
  it("names Go's count, a win or an equal score", () => {
    expect(endText({ winner: 'black', reason: 'score' })).toBe('Black wins: on points');
    expect(endText({ winner: null, reason: 'score' })).toBe('Draw: equal score');
  });
```

In the same file, in `it('takes a well-formed game, with or without an end', …)`, add after the line `expect(isGameMessage({ ...ok, end: { winner: 'black', reason: 'backgammon' } })).toBe(true);`:

```ts
    expect(isGameMessage({ ...ok, end: { winner: null, reason: 'score' } })).toBe(true);
```

In `web/tests/board-panel.test.ts`, add after `import { ChessGame } from '../src/chess-game';`:

```ts
import type { GameRules } from '../src/games';
```

and in `describe('panelState', …)`, insert before `it('shows how it ended, with nothing left to press', …)`:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/games.test.ts tests/board-panel.test.ts`
Expected: FAIL, 3 tests: `endText` gives `'Black wins: score'`, `isGameMessage` refuses the unknown reason `score`, and `panelState` says `'White wins: score'` instead of `'White wins by 7'`.

- [ ] **Step 3: The reason and the texts**

In `web/src/games.ts`, replace the `END_REASONS` constant with:

```ts
export const END_REASONS = [
  'checkmate', 'stalemate', 'repetition', 'fifty', 'material', 'agreement', 'resigned', 'left', 'single', 'gammon', 'backgammon',
  'score',
] as const;
```

In `interface GameRules`, add after the `inCheck?(): boolean;` member (and its doc comment):

```ts
  /** Games whose result says more than `endText` can (Go: "White wins by 7"), worked out here from the entries; null
   * while the game runs or when its end has nothing to add. */
  resultText?(): string | null;
```

Replace the `DRAWN` and `WON` constants (from `const DRAWN` down to and including the `const WON …` line) with:

```ts
const DRAWN: Partial<Record<EndReason, string>> = {
  stalemate: 'stalemate', repetition: 'threefold repetition', fifty: '50-move rule', material: 'insufficient material', agreement: 'agreed',
  score: 'equal score',
};
/** Wins whose reason reads differently from its name (backgammon's single game, Go's count). */
const WON: Partial<Record<EndReason, string>> = { single: 'single game', score: 'on points' };
```

- [ ] **Step 4: The panel takes the game's own result**

In `web/src/board-panel.ts`, in `panelState`, replace

```ts
  if (end) status = endText(end);
```

with:

```ts
  if (end) status = (game?.end() ? game.resultText?.() : null) ?? endText(end);
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/games.test.ts tests/board-panel.test.ts`
Expected: PASS (34 and 12 tests).

Run: `cd web && npm test && npm run build`
Expected: 43 test files, 416 tests pass; the build is clean (the existing chunk-size warning is fine).

- [ ] **Step 6: Commit**

```bash
git add web/src/games.ts web/src/board-panel.ts web/tests/games.test.ts web/tests/board-panel.test.ts
git commit -m "Games: Go's count as an end, and a game's own result line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The Go rules (`go-game.ts`)

**Files:**
- Create: `web/src/go-game.ts`
- Test: `web/tests/go-game.test.ts`

**Interfaces:**
- Consumes: the types `GameEnd`, `GameRules`, `Side` from `./games` (type-only, so `games.ts` can import `GoGame` in Task 5 without a runtime cycle; the module keeps its own one-line `otherSide`, as `chess-game.ts` and `backgammon-game.ts` do). Task 1: the `'score'` reason and `GameRules.resultText`.
- Produces:
  - `SIZE = 9`; `COLUMNS = 'ABCDEFGHJ'`; `KOMI = 7`. A point is a number `row * 9 + col` (col 0..8 = A..J, row 0..8 = 1..9).
  - `pointName(point: number): string` (`30` → `'D4'`); `parsePoint(entry: string): number | null` (upper case only).
  - `interface GoStone { id: number; side: Side; point: number; taken: number | null }` (`id`: the index of the entry that placed it; `taken`: null on the board, else its place among the stones its capturer has taken, 0 first)
  - `interface GoScore { stones: Record<Side, number>; area: Record<Side, number>; komi: number; total: Record<Side, number> }`
  - `class GoGame implements GameRules`: `kind = 'go'`, `moves`, `turn()` (`'black'` first), `play(entry)`, `end()` (`{ winner, reason: 'resigned' }` or, after two passes, `{ winner: Side | null, reason: 'score' }`), `resultText()`; `at(point): Side | null`; `canPlay(point): boolean` (the side to move may place there now); `lastPoint(): number | null` (when the last entry placed a stone); `passed(): Side | null` (the side whose entry, the last one, was a pass); `prisoners(side): number`; `stones(): GoStone[]` (copies, in the order placed); `score(): GoScore`.

How it works: the board is an array of 81 `Side | null`. A placement copies the board, puts the stone, removes each neighbouring opposing group left with no liberties (a flood fill along the lines), then refuses the move if the stone's own group has no liberties or if the new position (as an 81-character string) equals the one kept from before the opponent's last entry. Every entry pushes the position after it, so "before the opponent's last entry" is always the second-to-last kept. The count floods each empty region and gives it to the one colour that borders it, if only one does.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/go-game.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/go-game.test.ts`
Expected: FAIL: `Failed to resolve import "../src/go-game"`.

- [ ] **Step 3: Implement**

Create `web/src/go-game.ts`:

```ts
import type { GameEnd, GameRules, Side } from './games';

/** The board's lines a side: 9 × 9 points, each an index `row * 9 + col` (col 0..8 is A..J, row 0..8 is 1..9). */
export const SIZE = 9;
/** The columns' letters, as GTP writes them: A to J without I. */
export const COLUMNS = 'ABCDEFGHJ';
/** White's points for moving second. */
export const KOMI = 7;

/** A point's entry, e.g. `D4`. */
export const pointName = (point: number): string => `${COLUMNS[point % SIZE]}${Math.floor(point / SIZE) + 1}`;

/** The point an entry names, or null: an upper-case column A..J without I, then a row 1..9. */
export function parsePoint(entry: string): number | null {
  const m = /^([A-HJ])([1-9])$/.exec(entry);
  return m ? (Number(m[2]) - 1) * SIZE + COLUMNS.indexOf(m[1]) : null;
}

const otherSide = (s: Side): Side => (s === 'white' ? 'black' : 'white');
const NAME: Record<Side, string> = { white: 'White', black: 'Black' };
/** Each point's neighbours along the lines. */
const NEIGHBOURS: number[][] = Array.from({ length: SIZE * SIZE }, (_, p) => {
  const col = p % SIZE;
  const row = Math.floor(p / SIZE);
  return [col > 0 ? p - 1 : -1, col < SIZE - 1 ? p + 1 : -1, row > 0 ? p - SIZE : -1, row < SIZE - 1 ? p + SIZE : -1].filter((n) => n >= 0);
});

type Board = (Side | null)[];
const key = (b: Board) => b.map((s) => (s ? s[0] : '.')).join('');

/** The group of stones joined to `point` along the lines, and how many liberties (empty neighbours) it has. */
function group(b: Board, point: number): { stones: number[]; liberties: number } {
  const side = b[point];
  const stones = [point];
  const seen = new Set(stones);
  const liberties = new Set<number>();
  for (let i = 0; i < stones.length; i++) {
    for (const n of NEIGHBOURS[stones[i]]) {
      if (b[n] === null) liberties.add(n);
      else if (b[n] === side && !seen.has(n)) {
        seen.add(n);
        stones.push(n);
      }
    }
  }
  return { stones, liberties: liberties.size };
}

/** One stone, followed through the game: `id` is the index of the entry that placed it; `taken` is null while it is
 * on the board, else its place among the stones its capturer has taken (0 first). */
export interface GoStone { id: number; side: Side; point: number; taken: number | null }
/** The count by area: each side's stones on the board, the empty points only it surrounds, white's komi, and the
 * totals. */
export interface GoScore { stones: Record<Side, number>; area: Record<Side, number>; komi: number; total: Record<Side, number> }

/**
 * Go on a 9 × 9 board, as a list of entries replayed one by one, each by the side to move; black moves first:
 * - `D4`: a stone on an empty point (columns A..J without I, rows 1..9, upper case). It takes the opposing groups it
 *   leaves without liberties; it may not leave its own group without liberties (no suicide), nor bring back the
 *   position from before the opponent's last entry (simple ko).
 * - `pass`; two in a row end the game, counted by area (stones plus the empty points only one side surrounds) with
 *   komi 7 for white. Stones count as they stand: players capture dead stones before passing.
 * - `resign`.
 */
export class GoGame implements GameRules {
  readonly kind = 'go' as const;
  private list: string[] = [];
  private side: Side = 'black';
  private board: Board = Array<Side | null>(SIZE * SIZE).fill(null);
  /** The position after each entry so far, the empty board first, for ko. */
  private positions = [key(this.board)];
  private men: GoStone[] = [];
  private taken: Record<Side, number> = { white: 0, black: 0 };
  private result: GameEnd | null = null;

  get moves(): readonly string[] {
    return this.list;
  }

  turn(): Side {
    return this.side;
  }

  end(): GameEnd | null {
    return this.result;
  }

  /** "White wins by 7", or "Draw: equal score", once two passes ended it; null otherwise. */
  resultText(): string | null {
    if (this.result?.reason !== 'score') return null;
    const { total } = this.score();
    const by = Math.abs(total.white - total.black);
    return this.result.winner ? `${NAME[this.result.winner]} wins by ${by}` : 'Draw: equal score';
  }

  /** The stone on a point, if any. */
  at(point: number): Side | null {
    return this.board[point];
  }

  /** The side to move may place a stone on `point` now. */
  canPlay(point: number): boolean {
    return !this.result && this.place(point) !== null;
  }

  /** The point of the last stone placed, when the last entry placed one. */
  lastPoint(): number | null {
    return parsePoint(this.list[this.list.length - 1] ?? '');
  }

  /** The side whose last entry was a pass, if the last entry was one. */
  passed(): Side | null {
    return this.list[this.list.length - 1] === 'pass' ? otherSide(this.side) : null;
  }

  /** How many stones `side` has captured. */
  prisoners(side: Side): number {
    return this.taken[side];
  }

  /** Every stone placed so far, in order. */
  stones(): GoStone[] {
    return this.men.map((s) => ({ ...s }));
  }

  /** The count by area as the board stands. */
  score(): GoScore {
    const stones: Record<Side, number> = { white: 0, black: 0 };
    const area: Record<Side, number> = { white: 0, black: 0 };
    const seen = new Set<number>();
    for (let p = 0; p < SIZE * SIZE; p++) {
      const here = this.board[p];
      if (here) stones[here]++;
      if (here || seen.has(p)) continue;
      const region = [p];
      const borders = new Set<Side>();
      seen.add(p);
      for (let i = 0; i < region.length; i++) {
        for (const n of NEIGHBOURS[region[i]]) {
          const s = this.board[n];
          if (s) borders.add(s);
          else if (!seen.has(n)) {
            seen.add(n);
            region.push(n);
          }
        }
      }
      if (borders.size === 1) area[[...borders][0]] += region.length;
    }
    return { stones, area, komi: KOMI, total: { black: stones.black + area.black, white: stones.white + area.white + KOMI } };
  }

  play(entry: string): boolean {
    if (this.result) return false;
    if (entry === 'resign') this.result = { winner: otherSide(this.side), reason: 'resigned' };
    else if (entry === 'pass') {
      if (this.passed()) {
        const { total } = this.score();
        this.result = { winner: total.white === total.black ? null : total.white > total.black ? 'white' : 'black', reason: 'score' };
      }
    } else {
      const point = parsePoint(entry);
      const next = point === null ? null : this.place(point);
      if (point === null || !next) return false;
      for (const p of next.captured) {
        const stone = this.men.find((s) => s.point === p && s.taken === null)!;
        stone.taken = this.taken[this.side]++;
      }
      this.men.push({ id: this.list.length, side: this.side, point, taken: null });
      this.board = next.board;
    }
    this.list.push(entry);
    this.positions.push(key(this.board));
    this.side = otherSide(this.side);
    return true;
  }

  /** The board after the side to move places a stone on `point`, and the stones it captures; null when the point is
   * taken, the stone would have no liberties, or the position would repeat the one before the opponent's last
   * entry. */
  private place(point: number): { board: Board; captured: number[] } | null {
    if (point < 0 || point >= SIZE * SIZE || this.board[point]) return null;
    const board = [...this.board];
    board[point] = this.side;
    const captured: number[] = [];
    for (const n of NEIGHBOURS[point]) {
      if (board[n] !== otherSide(this.side)) continue;
      const g = group(board, n);
      if (g.liberties) continue;
      for (const s of g.stones) board[s] = null;
      captured.push(...g.stones);
    }
    if (!group(board, point).liberties) return null;
    if (key(board) === this.positions[this.positions.length - 2]) return null;
    return { board, captured };
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/go-game.test.ts`
Expected: PASS (18 tests).

Run: `cd web && npm test && npm run build`
Expected: 44 test files, 434 tests pass; the build is clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/go-game.ts web/tests/go-game.test.ts
git commit -m "Games: the Go rules, replayed from entries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Go board in the panel (`go-board.ts`)

**Files:**
- Create: `web/src/go-board.ts`
- Modify: `web/src/style.css` (two rules)
- Test: `web/tests/go-board.test.ts`

**Interfaces:**
- Consumes (Task 2): `GoGame` (`at`, `canPlay`, `lastPoint`, `passed`, `prisoners`, `score`, `end`), `pointName`, `parsePoint`, `SIZE`. (Phase 2): `BoardView`, `PanelAction`, `PanelBoard` from `./board-panel`. Phase 1: `GameRules`, `Side`.
- Produces:
  - `pointCell(point: number, you: Side): [number, number]` (the point's column and row on screen, 0..8 from the top left; white sees A1 at `[0, 8]`, black at `[8, 0]`)
  - `canPass(view: BoardView): boolean`; `goInfo(view: BoardView): string`; `GO_COPY`
  - `class GoBoard implements PanelBoard { constructor(doc: Document, onEntry: (entry: string) => void) }` with `actions(view)` (one **Pass** button, enabled when `canPass`), `info(view)` (`goInfo`), `draw(game, you, live)`
  - Its SVG's click targets are `circle.go-hint[data-point]` (e.g. `data-point="E5"`), one on each point the side to move may play, drawn only on your move. Task 6 clicks them.

The board, as seen from your chair: a 10 × 10 drawing with the nine lines from 1 to 9, the five star points (C3, G3, E5, C7, G7), the stones with a thin dark edge, and a ring on the last stone placed. On your move each legal point carries a transparent stone of your colour that shows faintly under the pointer (CSS `:hover`), so you see where you may play; a click places it. Phones have no hover: a tap places at once.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/go-board.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/go-board.test.ts`
Expected: FAIL: `Failed to resolve import "../src/go-board"`.

- [ ] **Step 3: Implement**

Create `web/src/go-board.ts`:

```ts
import type { BoardView, PanelAction, PanelBoard } from './board-panel';
import type { GameRules, Side } from './games';
import { GoGame, pointName, SIZE } from './go-game';

const SVG = 'http://www.w3.org/2000/svg';
/** The drawing is 10 × 10: the lines run from 1 to 9, a half point of board beyond them. */
const VIEW = SIZE + 1;
/** The star points: C3, G3, E5, C7, G7. */
const STARS = [20, 24, 40, 56, 60];
const COLOURS = { wood: '#d8b077', line: '#3b2c1e', white: '#f8f4ea', black: '#2a2622', edge: '#2a2622' };
export const GO_COPY = { pass: 'Pass', white: 'White', black: 'Black' };
const NAME: Record<Side, string> = { white: GO_COPY.white, black: GO_COPY.black };
const prisoners = (b: number, w: number) => `Prisoners: Black ${b} · White ${w}`;
const passed = (who: string) => `${who} passed. `;

/** A point's column and row on screen (0..8 from the top left), your own side at the bottom: white sees A1 at the
 * bottom left, as on the table from the S chair; black, across the table, sees the board turned round. */
export function pointCell(point: number, you: Side): [number, number] {
  const col = point % SIZE;
  const row = Math.floor(point / SIZE);
  return you === 'white' ? [col, SIZE - 1 - row] : [SIZE - 1 - col, row];
}

/** Go's Pass button: on your move. */
export function canPass({ game, live }: BoardView): boolean {
  return live && game instanceof GoGame;
}

/** The line under the status: who just passed and the prisoners while it runs; once two passes end it, the count. */
export function goInfo({ game, end }: BoardView): string {
  if (!(game instanceof GoGame)) return '';
  if (end?.reason === 'score' && game.end()) {
    const { stones, area, komi, total } = game.score();
    return `Black: stones ${stones.black} + area ${area.black} = ${total.black} · `
      + `White: stones ${stones.white} + area ${area.white} + komi ${komi} = ${total.white}`;
  }
  const who = !end ? game.passed() : null;
  return `${who ? passed(NAME[who]) : ''}${prisoners(game.prisoners('black'), game.prisoners('white'))}`;
}

/**
 * The Go board in the panel, drawn in SVG from your chair: on your move the points you may play show a faint stone
 * under the pointer; click one to place your stone there. The last stone placed is marked.
 */
export class GoBoard implements PanelBoard {
  readonly element: HTMLElement;
  private svg: SVGSVGElement;
  private game: GoGame | null = null;
  private you: Side = 'white';
  private live = false;

  /** `onEntry` takes the entries this board makes: points and `pass`. */
  constructor(private doc: Document, private onEntry: (entry: string) => void) {
    this.element = doc.createElement('div');
    this.element.className = 'go-board';
    this.svg = doc.createElementNS(SVG, 'svg') as SVGSVGElement;
    this.svg.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);
    this.svg.setAttribute('aria-label', 'Go board');
    this.svg.addEventListener('click', (e) => this.click(e));
    this.element.append(this.svg);
  }

  actions(view: BoardView): PanelAction[] {
    return [{ label: GO_COPY.pass, enabled: canPass(view), run: () => this.onEntry('pass') }];
  }

  info(view: BoardView): string {
    return goInfo(view);
  }

  draw(game: GameRules | null, you: Side, live: boolean): void {
    this.game = game instanceof GoGame ? game : null;
    this.you = you;
    this.live = live;
    this.render();
  }

  private click(e: MouseEvent): void {
    const point = (e.target as Element).closest('[data-point]')?.getAttribute('data-point');
    if (this.game && this.live && point) this.onEntry(point);
  }

  private render(): void {
    const g = this.game ?? new GoGame();
    const nodes: SVGElement[] = [];
    const node = (tag: string, attrs: Record<string, string | number>) => {
      const n = this.doc.createElementNS(SVG, tag) as SVGElement;
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      nodes.push(n);
      return n;
    };
    const centre = (point: number) => pointCell(point, this.you).map((c) => c + 1) as [number, number];
    node('rect', { x: 0, y: 0, width: VIEW, height: VIEW, fill: COLOURS.wood });
    for (let i = 1; i <= SIZE; i++) {
      node('line', { x1: 1, y1: i, x2: SIZE, y2: i, stroke: COLOURS.line, 'stroke-width': 0.04 });
      node('line', { x1: i, y1: 1, x2: i, y2: SIZE, stroke: COLOURS.line, 'stroke-width': 0.04 });
    }
    for (const p of STARS) {
      const [cx, cy] = centre(p);
      node('circle', { cx, cy, r: 0.1, fill: COLOURS.line });
    }
    const last = this.game?.lastPoint() ?? null;
    for (let p = 0; p < SIZE * SIZE; p++) {
      const [cx, cy] = centre(p);
      const side = g.at(p);
      if (side) {
        node('circle', { cx, cy, r: 0.47, fill: COLOURS[side], stroke: COLOURS.edge, 'stroke-width': 0.04 });
        if (p === last) node('circle', { cx, cy, r: 0.18, fill: 'none', stroke: COLOURS[side === 'white' ? 'black' : 'white'], 'stroke-width': 0.07 });
      } else if (this.live && g.canPlay(p)) {
        node('circle', { cx, cy, r: 0.47, fill: COLOURS[this.you], 'fill-opacity': 0, class: 'go-hint', 'data-point': pointName(p) });
      }
    }
    this.svg.replaceChildren(...nodes);
  }
}
```

- [ ] **Step 4: Styles**

In `web/src/style.css`, replace

```css
.chess-board svg, .backgammon-board svg { display: block; width: 100%; height: auto; user-select: none; -webkit-user-select: none; cursor: pointer; }
```

with:

```css
.chess-board svg, .backgammon-board svg, .go-board svg { display: block; width: 100%; height: auto; user-select: none; -webkit-user-select: none; cursor: pointer; }
```

and add this line right before the `#board-status { … }` rule:

```css
.go-board .go-hint:hover { fill-opacity: 0.45; }
```

(A CSS rule beats the SVG `fill-opacity` attribute, so the hint shows only under the pointer.)

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/go-board.test.ts`
Expected: PASS (4 tests).

Run: `cd web && npm test && npm run build`
Expected: 45 test files, 438 tests pass; the build is clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/go-board.ts web/src/style.css web/tests/go-board.test.ts
git commit -m "Games: the Go board in the panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Go board on the table (`go-set.ts`)

**Files:**
- Modify: `web/src/config.ts` (`games.slots[2]`, `games.slide`'s comment, `games.go`)
- Create: `web/src/go-set.ts`
- Modify: `web/src/table-pieces.ts` (`SETS` gains `go`)
- Test: `web/tests/go-set.test.ts`, `web/tests/table-pieces.test.ts`

**Interfaces:**
- Consumes (Task 2): `GoGame` (`stones`), `SIZE`, `parsePoint` (tests). Phase 2: `SETS`. Phase 1: `TableMaterials` (`make(name, colour, map?, gloss?)`), `TableSet`, `CanvasFactory`, `ease` from `./player`, `GameRules`, `Side`.
- Produces:
  - `CONFIG.games.slots[2]` = `[2.41, 3.2]`; `CONFIG.games.go` (values in Global Constraints)
  - `pointPosition(point: number, cfg?): [number, number]` (x, z from the board's middle; row 1 toward +z, column A toward -x; the lines `(size - 2 * margin) / 8` apart)
  - `prisonerPosition(capturer: Side, n: number, cfg?): [number, number]` (x, z from the board's middle, on the table in front of the capturer: white's at +z, black's at -z; nine to a row, a row further out after nine)
  - `class GoSet implements TableSet { readonly stones: Map<number, Mesh>; constructor(materials: TableMaterials, canvas: CanvasFactory | null) }`, root named `'Go'`, stones `'Go stone <id>'` (`id` as in `GoStone`)

- [ ] **Step 1: Write the failing tests**

Create `web/tests/go-set.test.ts`:

```ts
import type { MeshMatcapMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { GoGame, parsePoint } from '../src/go-game';
import { GoSet, pointPosition, prisonerPosition } from '../src/go-set';
import { TableMaterials } from '../src/table-pieces';

const cfg = CONFIG.games.go;
const step = (cfg.size - 2 * cfg.margin) / 8;
const game = (...entries: string[]) => {
  const g = new GoGame();
  for (const e of entries) expect(g.play(e), e).toBe(true);
  return g;
};
const set = () => new GoSet(new TableMaterials({ matte: null, gloss: null }), null);

describe('the Go board on the table', () => {
  it("fits right of the table runner (to x 2.25), clear of the table's rounded end (x 2.72 level with its corners)", () => {
    const [x, z] = CONFIG.games.slots[2];
    expect(x - cfg.size / 2).toBeGreaterThanOrEqual(2.265);
    expect(x + cfg.size / 2).toBeLessThanOrEqual(2.62);
    expect(Math.abs(z - 3.2)).toBeLessThan(0.01);
    expect(cfg.size).toBeGreaterThanOrEqual(0.26);
    // Four rows of prisoners a side stay clear of the runner and well inside the table's edges (z 2.735 and 3.665)
    for (const side of ['white', 'black'] as const) {
      for (let n = 0; n < 36; n++) {
        const [px, pz] = prisonerPosition(side, n);
        expect(x + px - cfg.stone).toBeGreaterThanOrEqual(2.265);
        expect(Math.abs(pz) + cfg.stone).toBeLessThanOrEqual(0.3);
      }
    }
  });
  it('puts row 1 at the S chair (+z) with column A toward -x, the lines a stone apart', () => {
    expect(pointPosition(parsePoint('A1')!)).toEqual([-4 * step, 4 * step]);
    expect(pointPosition(parsePoint('J9')!)).toEqual([4 * step, -4 * step]);
    expect(pointPosition(parsePoint('E5')!)).toEqual([0, 0]);
    expect(4 * step + cfg.stone).toBeLessThanOrEqual(cfg.size / 2);
    expect(step).toBeGreaterThan(2 * cfg.stone);
  });
  it('lines up prisoners in front of whoever took them, nine to a row', () => {
    const [wx, wz] = prisonerPosition('white', 0);
    expect(wx).toBeCloseTo(-4 * step);
    expect(wz - cfg.stone).toBeGreaterThan(cfg.size / 2);
    const [bx, bz] = prisonerPosition('black', 8);
    expect(bx).toBeCloseTo(4 * step);
    expect(bz + cfg.stone).toBeLessThan(-cfg.size / 2);
    expect(prisonerPosition('white', 9)[1]).toBeGreaterThan(wz); // the tenth starts a second row
  });
  it('drops a new stone onto its point', () => {
    const s = set();
    expect(s.root.name).toBe('Go');
    expect(s.stones.size).toBe(0);
    s.show(game('E5'));
    const stone = s.stones.get(0)!;
    expect(stone.name).toBe('Go stone 0');
    expect(stone.position.y).toBeCloseTo(cfg.thickness + cfg.drop);
    s.update(0.1);
    expect(stone.position.y).toBeGreaterThan(cfg.thickness);
    s.update(1);
    expect(stone.position.toArray()).toEqual([0, cfg.thickness, 0]);
  });
  it('lifts a captured stone off to the capturer, and clears the board for a new game', () => {
    const s = set();
    s.show(game('B1', 'A1', 'J9', 'J8'));
    s.update(1);
    s.show(game('B1', 'A1', 'J9', 'J8', 'A2'));
    const taken = s.stones.get(1)!;
    s.update(0.15);
    expect(taken.position.y).toBeGreaterThan(cfg.thickness); // on its way, lifted
    s.update(1);
    const [x, z] = prisonerPosition('black', 0);
    expect(taken.position.toArray()).toEqual([x, 0, z]);
    expect(s.stones.size).toBe(5);
    s.show(null);
    expect(s.stones.size).toBe(0);
    expect(s.root.children.filter((c) => c.name.startsWith('Go stone'))).toHaveLength(0);
  });
  it('shares one geometry, and one material a colour', () => {
    const s = set();
    s.show(game('E5', 'D4', 'C3'));
    const meshes = [...s.stones.values()];
    expect(new Set(meshes.map((m) => m.geometry)).size).toBe(1);
    const mats = meshes.map((m) => m.material as MeshMatcapMaterial);
    expect(mats[0]).toBe(mats[2]);
    expect(mats[0]).not.toBe(mats[1]);
  });
});
```

In `web/tests/table-pieces.test.ts`, replace the first test of `describe('TableGames', …)`, from its `it(` line down to its `expect(t.root.children.map …` line:

```ts
  it('puts the chessboard and the backgammon case at their slots\' places on the table, slot 2 empty for now', () => {
    const t = new TableGames(null);
    expect(t.root.children.map((c) => c.name)).toEqual(['Chess', 'Backgammon']);
```

with:

```ts
  it("puts the chessboard, the backgammon case and the Go board at their slots' places on the table", () => {
    const t = new TableGames(null);
    expect(t.root.children.map((c) => c.name)).toEqual(['Chess', 'Backgammon', 'Go']);
```

(The rest of that test, which checks each child's place against `CONFIG.games.slots`, stays.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/go-set.test.ts tests/table-pieces.test.ts`
Expected: FAIL: `../src/go-set` cannot be resolved, and the table has only the chessboard and the backgammon case.

- [ ] **Step 3: Config**

In `web/src/config.ts`, in the `games` block, replace the `slots` doc comment and line

```ts
    /** Each slot's middle (x, z): halfway between its two chairs' spots in seats.json (z 3.2), and level with them,
     * except slot 0, 10 cm toward the table's end to clear the fruit bowl, and slot 1, 4.5 cm toward it to sit
     * between the bowl (to x 1.58) and the mug and books (from x 1.93). */
    slots: [[1.15, 3.2], [1.755, 3.2], [2.35, 3.2]] as [number, number][],
```

with:

```ts
    /** Each slot's middle (x, z): halfway between its two chairs' spots in seats.json (z 3.2), and level with them,
     * except slot 0, 10 cm toward the table's end to clear the fruit bowl, slot 1, 4.5 cm toward it to sit between
     * the bowl (to x 1.58) and the mug and books (from x 1.93), and slot 2, 6 cm toward it to clear the table runner
     * under the mug and books (x 1.85 to 2.25). */
    slots: [[1.15, 3.2], [1.755, 3.2], [2.41, 3.2]] as [number, number][],
```

Replace `    /** Seconds a piece takes to slide to its square. */` with:

```ts
    /** Seconds a piece takes to slide to its square (and a Go stone to drop onto its point, or lift off). */
```

After the `backgammon: { … },` entry (its closing `},`, just before the `games` block's own closing `},`), add:

```ts
    /** The Go board (m): its size, the margin outside the outer lines, its thickness; the stones' radius and height,
     * how far a new stone drops onto its point, and the colours. 28 cm: the runner and the table's rounded end leave
     * x 2.25 to about 2.72 at slot 2. */
    go: {
      size: 0.28, margin: 0.02, thickness: 0.025, stone: 0.014, height: 0.009, drop: 0.03,
      wood: '#d8b077', lines: '#3b2c1e', white: '#f2eee4', black: '#2b2a28',
    },
```

(`main.ts` reads `CONFIG.games.slots[1]` as the table's middle for how lit the pieces are; slot 2's move changes nothing there.)

- [ ] **Step 4: The board**

Create `web/src/go-set.ts`:

```ts
import { BoxGeometry, CanvasTexture, Group, Mesh, type MeshMatcapMaterial, PlaneGeometry, SphereGeometry, SRGBColorSpace, Vector3 } from 'three';
import { CONFIG } from './config';
import type { GameRules, Side } from './games';
import { GoGame, SIZE } from './go-game';
import { ease } from './player';
import type { CanvasFactory } from './screens';
import type { TableMaterials, TableSet } from './table-pieces';

type Cfg = typeof CONFIG.games.go;

/** The star points: C3, G3, E5, C7, G7. */
const STARS = [20, 24, 40, 56, 60];
const step = (cfg: Cfg) => (cfg.size - 2 * cfg.margin) / (SIZE - 1);

/** A point on the board (x, z from its middle): row 1 toward white at +z (the S chair), column A toward -x. */
export function pointPosition(point: number, cfg: Cfg = CONFIG.games.go): [number, number] {
  const s = step(cfg);
  return [(point % SIZE - 4) * s, (4 - Math.floor(point / SIZE)) * s];
}

/** Where the `n`th stone `capturer` has taken lies: on the table in front of the capturer (white's by the S edge,
 * black's by the N edge), nine to a row along the lines, a row further out after nine. */
export function prisonerPosition(capturer: Side, n: number, cfg: Cfg = CONFIG.games.go): [number, number] {
  const toward = capturer === 'white' ? 1 : -1;
  return [(n % SIZE - 4) * step(cfg), toward * (cfg.size / 2 + (2 * cfg.stone + 0.002) * (0.7 + Math.floor(n / SIZE)))];
}

/** The board's top: the wood, the 9 × 9 lines and the star points, as white sees it. */
function drawLines(ctx: CanvasRenderingContext2D, px: number, cfg: Cfg): void {
  ctx.fillStyle = cfg.wood;
  ctx.fillRect(0, 0, px, px);
  const at = (i: number) => ((cfg.margin + i * step(cfg)) / cfg.size) * px;
  ctx.strokeStyle = cfg.lines;
  ctx.lineWidth = Math.max(1, px / 400);
  ctx.beginPath();
  for (let i = 0; i < SIZE; i++) {
    ctx.moveTo(at(i), at(0));
    ctx.lineTo(at(i), at(SIZE - 1));
    ctx.moveTo(at(0), at(i));
    ctx.lineTo(at(SIZE - 1), at(i));
  }
  ctx.stroke();
  ctx.fillStyle = cfg.lines;
  for (const p of STARS) {
    ctx.beginPath();
    ctx.arc(at(p % SIZE), at(Math.floor(p / SIZE)), px / 110, 0, Math.PI * 2);
    ctx.fill();
  }
}

interface Placed { mesh: Mesh; key: string; from: Vector3; to: Vector3; t: number; lift: boolean }

/** The Go board on the table: stones drop onto their points as they are played; captured ones lift off to the side,
 * in front of the player who took them. */
export class GoSet implements TableSet {
  readonly root = new Group();
  /** Each stone on the table by its id (the entry that placed it). */
  readonly stones = new Map<number, Mesh>();
  private placed = new Map<number, Placed>();
  private geometry: SphereGeometry;
  private sides: Record<Side, MeshMatcapMaterial>;

  constructor(materials: TableMaterials, canvas: CanvasFactory | null) {
    const cfg = CONFIG.games.go;
    this.root.name = 'Go';
    const wood = materials.make('Go board', cfg.wood);
    const board = new Mesh(new BoxGeometry(cfg.size, cfg.thickness, cfg.size), wood);
    board.position.y = cfg.thickness / 2;
    let top: MeshMatcapMaterial = wood;
    const surface = canvas?.(512, 512);
    const ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (surface && ctx) {
      drawLines(ctx, 512, cfg);
      const map = new CanvasTexture(surface as unknown as HTMLCanvasElement);
      map.colorSpace = SRGBColorSpace;
      top = materials.make('Go lines', '#ffffff', map);
    }
    const lines = new Mesh(new PlaneGeometry(cfg.size, cfg.size).rotateX(-Math.PI / 2), top);
    lines.position.y = cfg.thickness + 0.0005;
    this.root.add(board, lines);
    // A slightly flattened sphere, resting on its underside
    this.geometry = new SphereGeometry(cfg.stone, 24, 12).scale(1, cfg.height / (2 * cfg.stone), 1).translate(0, cfg.height / 2, 0);
    this.sides = { black: materials.make('Go black', cfg.black, null, true), white: materials.make('Go white', cfg.white, null, true) };
  }

  show(game: GameRules | null): void {
    const cfg = CONFIG.games.go;
    const stones = game instanceof GoGame ? game.stones() : [];
    const ids = new Set(stones.map((s) => s.id));
    for (const id of [...this.placed.keys()]) if (!ids.has(id)) this.remove(id);
    for (const s of stones) {
      const key = `${s.side}${s.point}`;
      if (this.placed.get(s.id)?.key !== key) this.remove(s.id);
      const [x, z] = s.taken === null ? pointPosition(s.point) : prisonerPosition(s.side === 'white' ? 'black' : 'white', s.taken);
      const y = s.taken === null ? cfg.thickness : 0;
      const item = this.placed.get(s.id);
      if (!item) {
        const mesh = new Mesh(this.geometry, this.sides[s.side]);
        mesh.name = `Go stone ${s.id}`;
        const to = new Vector3(x, y, z);
        const from = s.taken === null ? to.clone().setY(y + cfg.drop) : to.clone(); // a new stone drops onto its point
        mesh.position.copy(from);
        this.root.add(mesh);
        this.stones.set(s.id, mesh);
        this.placed.set(s.id, { mesh, key, from, to, t: s.taken === null ? 0 : 1, lift: false });
      } else if (item.to.x !== x || item.to.y !== y || item.to.z !== z) {
        item.from.copy(item.mesh.position);
        item.to.set(x, y, z);
        item.t = 0;
        item.lift = true;
      }
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

  private remove(id: number): void {
    const item = this.placed.get(id);
    if (!item) return;
    this.root.remove(item.mesh);
    this.placed.delete(id);
    this.stones.delete(id);
  }
}
```

- [ ] **Step 5: On the table**

In `web/src/table-pieces.ts`, add after `import { type GameKind, type GameRules, type SlotGame, SLOTS } from './games';`:

```ts
import { GoSet } from './go-set';
```

and add a line to `SETS` so it reads:

```ts
export const SETS: Partial<Record<GameKind, (materials: TableMaterials, canvas: CanvasFactory | null) => TableSet>> = {
  chess: (materials, canvas) => new ChessSet(materials, canvas),
  backgammon: (materials, canvas) => new BackgammonSet(materials, canvas),
  go: (materials, canvas) => new GoSet(materials, canvas),
};
```

`go-set.ts` imports only types from `table-pieces.ts`, as the other sets do, so there is no runtime cycle. The empty board now shows at slot 2 in every browser, before its rules are wired (Task 5).

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/go-set.test.ts tests/table-pieces.test.ts`
Expected: PASS (6 and 8 tests).

Run: `cd web && npm test && npm run build`
Expected: 46 test files, 444 tests pass; the build is clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/config.ts web/src/go-set.ts web/src/table-pieces.ts web/tests/go-set.test.ts web/tests/table-pieces.test.ts
git commit -m "Games: the Go board on the table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wiring Go in (`RULES`, the panel board, controls)

**Files:**
- Modify: `web/src/games.ts` (`RULES`)
- Modify: `web/src/main.ts` (the Go board)
- Modify: `web/index.html` (both controls lists)
- Test: `web/tests/games.test.ts`

**Interfaces:**
- Consumes: `GoGame` (Task 2), `GoBoard` (Task 3), `slotOf` and `playEntry(slot, entry)` (Phase 2, in `main.ts`).
- Produces: `RULES` = `{ chess, backgammon, go }`, so slot 2 is playable: sitting there opens the panel with the Go board, the white player's browser opens the game, black places the first stone, and the network carries it like the others. `window.walkthrough.games` (under `?debug`, from Phase 2) gives Task 6 the games.

- [ ] **Step 1: Write the failing tests**

In `web/tests/games.test.ts`:

Add `RULES` to the import from `'../src/games'`, after `replay`:

```ts
  endOf, endText, gameChairs, type GameMessage, Games, isGameMessage, leftEnd, replay, RULES, seatedAt, slotOf, type SlotSeats, SLOTS,
```

In `it('replays a list of moves, or not when one is illegal or the kind has no rules yet', …)`, replace `expect(replay('go', [])).toBeNull();` with:

```ts
    expect(replay('go', ['E5', 'D4', 'pass'])?.moves).toEqual(['E5', 'D4', 'pass']);
    expect(replay('go', ['E5', 'E5'])).toBeNull(); // a taken point
    expect(replay('go', [], { chess: RULES.chess })).toBeNull(); // no rules for the kind
```

Replace the whole `it('only slots with rules are playable', …)` test with:

```ts
  it('only slots with rules are playable', () => {
    const g = setup('ana');
    expect([0, 1, 2].map((s) => g.playable(s))).toEqual([true, true, true]);
    const chessOnly = new Games(() => 'rui', () => 'g1', { chess: RULES.chess });
    expect([0, 1, 2].map((s) => chessOnly.playable(s))).toEqual([true, false, false]);
    chessOnly.update(SLOTS.map(() => ({ white: 'ana', black: 'rui' })), 0);
    expect(chessOnly.receive({ slot: 2, id: 'g6', white: 'ana', black: 'rui', moves: [] })).toBe(false); // no rules there
  });
```

In `it('ignores what does not extend its game, replays illegally, or names others', …)`, slot 2 has rules now, so change the slot-2 line's comment (the message is still refused: nobody sits at slot 2 in that test):

```ts
    expect(rui.receive({ slot: 2, id: 'g6', white: 'ana', black: 'rui', moves: [] })).toBe(false); // not in those chairs
```

Insert before `it("leaves opening to the white player's browser", …)`:

```ts
  it('plays Go at slot 2, opened by white and started by black', () => {
    const at2 = (white: string | null, black: string | null): SlotSeats[] =>
      SLOTS.map((_, i) => (i === 2 ? { white, black } : { white: null, black: null }));
    const ana = setup('ana');
    const rui = setup('rui');
    const [g1] = ana.update(at2('ana', 'rui'), 0);
    expect(g1).toEqual({ slot: 2, id: 'g1', white: 'ana', black: 'rui', moves: [] });
    expect(ana.at(2)?.rules.kind).toBe('go');
    rui.update(at2('ana', 'rui'), 0);
    expect(rui.receive(g1)).toBe(true);
    expect(ana.play(2, 'E5')).toBeNull(); // black moves first
    const first = rui.play(2, 'E5')!;
    expect(ana.receive(first)).toBe(true);
    const passed = ana.play(2, 'pass')!;
    expect(rui.receive(passed)).toBe(true);
    const ended = rui.play(2, 'pass')!;
    expect(ended.end).toEqual({ winner: 'black', reason: 'score' });
    expect(ana.receive(ended)).toBe(true);
    expect(endOf(ana.at(2)!)).toEqual({ winner: 'black', reason: 'score' });
    expect(ana.at(2)?.rules.resultText?.()).toBe('Black wins by 74');
  });

```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/games.test.ts`
Expected: FAIL, 3 tests: `replay('go', …)` is null, slot 2 is not playable, and no game opens there.

- [ ] **Step 3: The rules**

In `web/src/games.ts`, add after `import { CONFIG } from './config';`:

```ts
import { GoGame } from './go-game';
```

and replace the `RULES` constant with:

```ts
export const RULES: Partial<Record<GameKind, () => GameRules>> = {
  chess: () => new ChessGame(),
  backgammon: () => new BackgammonGame(),
  go: () => new GoGame(),
};
```

- [ ] **Step 4: `main.ts`**

Add after `import { endOf, gameChairs, type GameKind, Games, otherSide, seatedAt, type Side, slotOf, SLOTS } from './games';`:

```ts
import { GoBoard } from './go-board';
```

Add the Go board to `boards`, so it reads:

```ts
  const boards: Partial<Record<GameKind, PanelBoard>> = {
    chess: new ChessBoard(document, (entry) => playEntry(slotOf('chess'), entry)),
    backgammon: new BackgammonBoard(document, (entry) => playEntry(slotOf('backgammon'), entry)),
    go: new GoBoard(document, (entry) => playEntry(slotOf('go'), entry)),
  };
```

- [ ] **Step 5: Controls on the start screen**

In `web/index.html`, replace

```html
              <li><span><kbd>Click</kbd></span> a chair at the chessboard or the backgammon case on the dining table to play; <kbd>C</kbd> stands up</li>
```

with:

```html
              <li><span><kbd>Click</kbd></span> a chair at the chessboard, the backgammon case or the Go board on the dining table to play; <kbd>C</kbd> stands up</li>
```

and replace

```html
              <li><span><kbd>Tap</kbd></span> a chair at the chessboard or the backgammon case on the dining table to play</li>
```

with:

```html
              <li><span><kbd>Tap</kbd></span> a chair at the chessboard, the backgammon case or the Go board on the dining table to play</li>
```

- [ ] **Step 6: Run the tests and the build**

Run: `cd web && npx vitest run tests/games.test.ts`
Expected: PASS (35 tests).

Run: `cd web && npm test && npm run build`
Expected: 46 test files, 445 tests pass; the build is clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/games.ts web/src/main.ts web/index.html web/tests/games.test.ts
git commit -m "Games: Go at the dining table, wired into the walkthrough

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Check it in the browser, README and the design note (run by the controller)

**Files:**
- Modify: `web/src/config.ts` and `web/tests/go-set.test.ts` (only if a value needs tuning)
- Modify: `README.md`, `docs/superpowers/specs/2026-10-28-dining-table-games-design.md`
- Any file at fault if a check fails (fix it, re-run `npm test && npm run build`, and commit the fix on its own).

Automated clicks can't take the pointer lock, so these checks use `?debug` (it exposes `window.walkthrough` with `player`, `scene`, `others` and `games`) to seat visitors, and dispatch clicks on the panel. The chair spots (from `web/public/assets/seats.json`): S2 `{ posture: 'sit', x: 2.3483, y: 0.4502, z: 3.8857, yaw: 0 }` (white), N2 `{ posture: 'sit', x: 2.3517, y: 0.4502, z: 2.5143, yaw: 3.1416 }` (black).

**Keep it fast.** Background tabs in one Browser pane are throttled, and the others drop a visitor whose tab has been silent for 15 s, which ends a running game as "left". So while a game runs, bring each player's tab to the front (`tabs_select`) at least every 10 s, do each step in one `browser_batch` where you can (select the mover's tab, run its entry with `javascript_tool`, select the other tab, read its state), read state with `javascript_tool` rather than screenshots, and take screenshots only once the game is over. If a game ends as "left" by accident, stand both players up and sit them again (a new game starts) and carry on.

- [ ] **Step 1: Start the dev server**

Use the preview tool with the `walkthrough` configuration in `.claude/launch.json` (it runs `npm --prefix web run dev` on port 5173). Do not start it from Bash.

- [ ] **Step 2: The board on the table**

Open `http://localhost:5173/?room=go-check-<random>&debug`, untick "Talk with your voice", name "Ana", start. Then run:

```js
walkthrough.player.teleport(2.4, 4.25, 0, -0.75)
```

Expected: a light wooden board with nine by nine dark lines and five star points lies flat at the table's rounded end, right of the white table runner under the mug and the books, touching neither the runner nor the table's edge; it neither floats above the wood nor sinks into it. The backgammon case and the chessboard are unchanged. `walkthrough.scene.getObjectByName('Go').position` is `{ x: 2.41, y: 0.76, z: 3.2 }`. No console errors (`read_console_messages`). Press L to switch the Sala light off and on: the board dims and brightens like the other sets.

If the board touches the runner or reaches the table's edge, move `CONFIG.games.slots[2][0]` or make `CONFIG.games.go.size` smaller, and set the bounds in `go-set.test.ts`'s first test to the gap you measured; reload and look again.

- [ ] **Step 3: Two players**

In the same tab: `walkthrough.player.sit({ posture: 'sit', x: 2.3483, y: 0.4502, z: 3.8857, yaw: 0 })`.
Expected: the panel opens: "Go", "Empty chair" above the board, "Ana (you) · White" below, "Waiting for an opponent", buttons Resign, Pass, Stand up (Resign and Pass disabled). No line under the status yet (no game).

Open a second tab on the same URL (`tabs_create`, then `navigate`), name "Rui", start, and seat Rui on N2: `walkthrough.player.sit({ posture: 'sit', x: 2.3517, y: 0.4502, z: 2.5143, yaw: 3.1416 })`.
Expected within a second or two: Rui's panel (black) says "Your move", Pass enabled, the line "Prisoners: Black 0 · White 0", and every point carries a hint (`document.querySelectorAll('#board-area circle.go-hint').length` is 81). Ana's panel says "Rui's move", Pass disabled, and has no hints.

In each tab, define the helpers:

```js
window.go = () => walkthrough.games.at(2).rules;
window.place = (p) => document.querySelector(`#board-area circle[data-point="${p}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
window.pass = () => [...document.querySelectorAll('#board-actions button')].find((b) => b.textContent === 'Pass').click();
window.state = () => ({ moves: go().moves.join(' '), turn: go().turn(), status: document.getElementById('board-status').textContent, info: document.getElementById('board-info').textContent });
```

- [ ] **Step 4: A few stones and a capture**

Play, each entry in the tab of the side to move, checking `state()` in the other tab after each (about a second later): Rui `place('B1')`, Ana `place('A1')`, Rui `place('J9')`, Ana `place('J8')`, Rui `place('A2')`.
Expected:
- After each stone, both tabs show the same `moves`, and the turn passes. A placed stone shows in both panels with a ring on the last one; on the table it drops onto its point (about 0.3 s).
- Black's board is white's turned round: in Rui's tab `document.querySelector('#board-area circle[data-point="C1"]').getAttribute('cx')` is `'7'` (white sees C1 at `cx` 3), checked while it is Rui's move.
- After `A2`: white's A1 is gone from both panels; Ana's line says "Prisoners: Black 1 · White 0"; on the table `walkthrough.scene.getObjectByName('Go stone 1').position` ends at about `{ x: 2.29, y: 0.76, z: 3.039 }` (lifted off in front of black, the capturer).
- It is Ana's move, and A1 is not offered to her: a white stone there would have no liberties (B1 and A2 are black) and capture nothing. In Ana's tab `document.querySelector('#board-area circle[data-point="A1"]')` is null and `document.querySelectorAll('#board-area circle.go-hint').length` is 76 (77 empty points, less A1).
- No console errors.

- [ ] **Step 5: Pass, pass, and the count**

Ana `pass()`. Expected: Rui's line reads "White passed. Prisoners: Black 1 · White 0" and Rui's status "Your move". Rui `pass()`. Expected in both tabs within a second: status "White wins by 4", line "Black: stones 3 + area 1 = 4 · White: stones 1 + area 0 + komi 7 = 8", Resign and Pass disabled, no hints; `go().moves` is `B1 A1 J9 J8 A2 pass pass` in both; the stones stay on the table. (A1 is black's area, surrounded by B1 and A2; every other empty point touches both colours, so it counts for no one.)

Open a third tab, name "Zé", start, don't sit. Expected: `walkthrough.games.at(2).rules.moves.join(' ')` is the same, and `walkthrough.scene.getObjectByName('Go stone 4').position` equals Ana's: Zé got the finished game with the flat's state.

- [ ] **Step 6: Resigning, standing up, and the phone layout**

In Rui's tab press C (`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }))`): the game is over, so Rui stands at once; Ana's panel keeps the result and shows "Empty chair". Seat Rui on N2 again: a new game starts, the stones leave the board in all three tabs, and Rui's panel says "Your move". Rui `place('E5')`, then Ana clicks Resign; it asks "Resign this game?" with Resign and Keep playing; click Resign (`document.getElementById('board-confirm-yes').click()`). Expected: both panels say "Black wins: White resigned"; the line shows "Prisoners: Black 0 · White 0".

Mid-game leave: Ana stands (C) and sits again so a new game starts, Rui places one stone, then Ana presses C. Expected: "Stand up and resign?" with Stand up and Keep playing; Keep playing returns to the game; Stand up stands Ana and closes her panel; Rui's panel says "Black wins: White resigned" if it was Ana's move, else "Black wins: White left the table".

Resize Rui's tab to the mobile preset and reload it, seat Rui on N2 again (no game needs to run). Expected: the panel is nearly full width and the Go board fills it. Reset the viewport to desktop afterwards.

- [ ] **Step 7: Tuning, README and the design note**

If Steps 2–6 changed any `CONFIG.games` value, run `cd web && npm test && npm run build` and commit it:

```bash
git add web/src/config.ts web/tests/go-set.test.ts
git commit -m "Games: tune the Go board's place on the table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

In `README.md`:

In the Controls paragraph under "Run and test", replace `click a chair at the chessboard or the backgammon case on the dining table to play, ` with `click a chair at the chessboard, the backgammon case or the Go board on the dining table to play, `.

In the touch paragraph, replace `Tap a chair at the chessboard or the backgammon case on the dining table to play.` with `Tap a chair at the chessboard, the backgammon case or the Go board on the dining table to play.`

In "Visitors together", in the chess paragraph (it starts "Two visitors can play chess at the dining table."), delete its last sentence ` Go is to come at the table's third place.` (with the space before it). Leave the backgammon paragraph as it is (it says "White presses Roll for the opening"), and add this paragraph right after it:

```markdown
Go is played on a 9×9 board at the third pair of chairs, on the table's rounded end right of the runner; the window side plays white, so black, across the table, moves first. The panel shows the board from your chair: on your move the points you may play show a faint stone under the pointer, and a click places yours there; Pass gives up your move. Stones left without liberties are captured, a stone may not take its own last liberty unless it captures, and a ko can't be retaken straight away. The line under the board counts the prisoners each side has taken and says when the other player passed. Two passes in a row end the game, counted by area: each side's stones plus the empty points only its stones surround, and 7 komi for white. Stones count as they stand, so capture dead stones before you pass. The result reads like "White wins by 4", with the count under it; an equal score is a draw. Resigning, standing up and leaving work as in chess. The rules are our own (`web/src/go-game.ts`); a game's moves are written as points, `D4`, with the columns A to J skipping I.
```

In `docs/superpowers/specs/2026-10-28-dining-table-games-design.md`:

Replace `**Status:** Approved. Phase 1 (the frame and chess) and Phase 2 (backgammon) implemented; Go to come.` with:

```markdown
**Status:** Approved. All three phases implemented: Phase 1 (the frame and chess), Phase 2 (backgammon) and Phase 3 (Go 9×9).
```

In the Rules section, replace `**Go 9×9** — our own \`go.ts\`:` with `**Go 9×9** — our own \`go-game.ts\`:`, and in the same bullet replace `with komi 7;` with `with komi 7 (an equal score is a draw: empty points between the two sides count for no one);`. In "On the table", replace `a wooden 9×9 Go board with drawn lines and slightly flattened stones;` with `a wooden 9×9 Go board (28 cm, at the table's rounded end, right of the table runner under the mug and books) with drawn lines and slightly flattened stones;`.

```bash
git add README.md docs/superpowers/specs/2026-10-28-dining-table-games-design.md
git commit -m "Games: Go in the README, all three phases done in the design note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Screenshot**

Once no game needs keeping alive, take a screenshot of a player's Go panel showing the count and one of the board on the table with stones and a prisoner, for the PR.
