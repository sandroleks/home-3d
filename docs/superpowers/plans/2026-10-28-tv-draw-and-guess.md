# TV Draw and Guess Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visitors play draw and guess on the Sala's TV: one player draws a secret word in a panel, the others type guesses, and the drawing shows live on the TV for everyone in the flat.

**Architecture:** Pure modules carry the game: the word list (`draw-words.ts`), guess matching and the blanks (`draw-match.ts`), the drawing as strokes in a 0–1000 grid (`draw-sketch.ts`), and the game's rules as pure state transitions (`draw-rules.ts`). `DrawGame` (`draw-game.ts`) is the game as one browser sees it: the lobby's Join flags, the state it holds or was sent, the turn's drawing and, in the drawer's browser, the secret word; the owner (the drawer's browser) runs the clock and judges guesses, the leader takes over when the owner is gone, and every input returns the messages to send. `multiplayer.ts` carries the new `draw` message kind and tells of each arriving visitor; the TV draws the game on its existing canvas through a new mode of `TvContent` (`draw-tv.ts`); the TV's panel (`draw-panel.ts`) is the remote, the lobby and the game; `main.ts` wires it into clicks, keys, the frame loop and the network.

**Tech Stack:** TypeScript 5.6 (strict, `noUnusedLocals`, `noUnusedParameters`), Vite 8, Vitest 5 (node environment, no DOM), three.js 0.170, Trystero 0.26. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-28-tv-draw-and-guess-design.md`

## Global Constraints

- Run everything from `web/`: `npm test` (Vitest) and `npm run build` (`tsc --noEmit && vite build`). Both must pass at the end of every task (the existing chunk-size warning is fine). Before this plan: 46 test files, 447 tests, about 1 s. `tsc` also checks `web/tests`, so test code must type-check too.
- No new dependency. Files stay flat in `web/src/` and `web/tests/`, small and single-purpose. Match the code around you: short doc comments on exported things, the existing naming, `type` aliases (not interfaces) for anything sent as JSON (they must be assignable to `Json` in `multiplayer.ts`: no `readonly` arrays in them).
- `CONFIG.draw` (final values): `choose: 15`, `drawing: 80`, `reveal: 5`, `end: 15` (seconds); `most: 300`, `least: 100`, `step: 10`, `drawer: 50` (points); `hints: [0.5, 0.75]`; `choices: 3`; `feed: 8`; `strokeEvery: 0.05` (seconds).
- Scoring: a right guess scores `Math.round((100 + 200 × left / 80000) / 10) × 10` (300 at the start of the drawing time, 100 at its end); the drawer scores 50 for each right guess. All guessers right ends the turn. Hints: one letter at 50 % of the drawing time, another at 75 %, never more than `floor(letters / 2)`.
- Guess matching: case, accents, spaces and hyphens are all ignored (`"Ice-Cream "`, `"ice cream"` and `"icecream"` are all right for `ice cream`); "close" is exactly one edit away (Levenshtein 1) for words of 4 letters or more (letters counted without spaces); guesses are trimmed, spaces squeezed, at most 40 characters.
- Drawing: points are whole numbers in a 0..1000 grid on both axes (the canvas is 4:3); eight pen colours `PALETTE[0..7]` and the eraser `ERASER = 8` (white); widths `WIDTHS = [8, 24]` grid units; at most 300 strokes, 500 points a stroke, 20 000 points in all; a point is kept only 4 grid units or more from the stroke's last.
- Network: a new Trystero message kind `draw` carrying `DrawMessage`, by its `k`: `join` (`{ on }`, a visitor's own flag, to everyone, and to each newcomer), `state` (`{ s: DrawState }`, from the owner), `guess` (to the owner only), `close` (to the guesser only), `stroke` (`{ g, t, n, at, c, w, p }`), `undo` (`{ n }`), `clear`, `sketch` (the whole drawing, to a newcomer). `g` and `t` name the game and its turn. The secret word appears in no message before the reveal. A newcomer (or a visitor back after a timeout) is greeted through a new `onArrive` hook of `Multiplayer`: every visitor sends its Join flag, and the owner the state and the drawing.
- Accepting a state (`DrawGame.accept`): never a game that is over here; the running game's state only with a higher `seq`; another game only when none shows, when the one showing is at its final scores, or when both are in their first turn and the new id sorts lower (two Starts at once: the earlier wins). Times travel as `left` (ms left in the phase); each browser keeps its own deadline. Game ids: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` (the same factory as the table games).
- Ownership: the owner is the drawer's browser in `choosing`, `drawing` and `reveal`; at the turn's end it sends the state with the next drawer as owner. When the owner is no longer among the visitors here, the game's leader (the earliest arrival by `byArrival` from `presence.ts`, among the game's players still here other than the owner) ends that turn (its points taken back), drops the owner from the game, and passes the turn on; its state jumps the sequence by `TAKEOVER = 1000`, so a late state from the old owner (a hidden tab still answering) never wins. With no player of the game left here, every browser drops the game.
- Copy, verbatim: prompts `Click: TV` / `Tap: TV`; panel `TV`, `Draw and guess`, `Turn on`, `Turn off`, `Next channel`, `A game is on`, `Join`, `Leave`, `Start`, `Close`, `Two or more players to start`, `Join to play`, `A game is on. Join to guess, and draw later.`, `Choose a word to draw`, `<name> is choosing a word`, `Your turn to draw`, `Guess the word`, `You guessed it!`, `Final scores`, `The word was <word>. <name> +<points>, <name> +<points>` (most first) or `The word was <word>. Nobody got it`, `"<guess>" is close!`, feed lines `<name>: <guess>`, `<name> guessed it!`, `<name> left`; tools `Eraser`, `Fine`, `Broad`, `Undo`, `Clear`; the guess box `Type your guess` and `Guess`; the lobby's ` (you)`. On the TV: `<name> is choosing a word`, `The word was` over the word and `<name> +<points>   <name> +<points>` (or `Nobody got it`), `Final scores`, the time as `m:ss`.
- Names come from other visitors: render them with `textContent` (or `fillText` on a canvas) only, never `innerHTML`.
- Commits end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Gaps in the design, filled here

The design is approved; where it leaves something open or meets the code differently, this plan decides as follows (each is built and tested in the task named):

1. **Next channel at the last channel** goes round to the first (clicking used to switch the TV off there; On/Off does that now). Task 5.
2. **"The drawer's turn ends with no points"** is taken literally: the points that turn gave (guessers' and drawer's) are taken back, the word is not revealed, and the next turn starts at once; the feed says "<name> left". The same when the drawer presses Leave. Task 3/4.
3. **A close guess** also shows in the feed for everyone, as the wrong guess it is; only the guesser sees "close!". A new guess clears the guesser's "close!". Task 4.
4. **Two Starts at once** settle on the game with the lower id (the earlier) while both are in their first turn. Task 4.
5. **The final scores count as the game showing:** the remote stays disabled for those 15 s, but Start works (a new game replaces the scores). Task 4/7.
6. **A player whose panel reopens** needs no message: every browser keeps the game and the whole drawing anyway, for its TV. Only newcomers (and visitors back after a timeout) are sent the state and drawing. Task 4/6.
7. **The Join flag** travels as a `draw` `join` message, and reaches newcomers through the new `onArrive` hook (not the hello, which older visitors validate). Task 6.
8. **`Player.held`** only kept a seated player seated; the TV panel can be open standing, so `held` now also stops walking. `main.ts` used `player.held` to mean "at a board" (`toggleSit`) and reset it to `false` every frame (`updateGames`); both change to work with either panel. Task 6/8.
9. **One panel at a time:** T does nothing at a game board, and sitting at a game chair closes the TV panel. While the TV panel is open the sun panel and the guest list are hidden (they would cover its lists), taps on the 3D view are ignored on touch, and Esc closes the panel and leaves the mouse free (Close and T go back to looking around). Task 7/8.
10. **Bounds** for validation: at most 32 players in a game, 64 turns and 64 used words, 8 feed lines, names of at most 24 characters, words and masks of at most 32 characters, and the drawing limits above.
11. **A drawer whose browser lost the word** (it can't normally happen; the owner always has it) ends the turn with no points and passes it on, rather than stalling. Task 4.

---

## Files

- Create `web/src/draw-words.ts`: `DRAW_WORDS` (352 words), `pickChoices`.
- Create `web/src/draw-match.ts`: `MAX_GUESS`, `cleanGuess`, `normalize`, `oneEdit`, `judgeGuess`, `maskOf`, `letterCount`, `revealLetter`, `shownCount`, `hintsDue`, `spaced`.
- Create `web/src/draw-sketch.ts`: `GRID`, `PALETTE`, `COLOUR_NAMES`, `ERASER`, `WIDTHS`, the limits, `Stroke`, `isPoints`, `isStroke`, `gridPoint`, `StrokePart`, `Sketch`, `paintSketch`.
- Create `web/src/draw-rules.ts`: `DrawPhase`, `PHASES`, `DrawPlayer`, `FeedKind`, `FEED_KINDS`, `FeedLine`, `TurnPoints`, `DrawState`, `MAX_PLAYERS`, and the transitions (`newGame`, `beginDrawing`, `guessPoints`, `rightGuess`, `wrongGuess`, `giveHint`, `herePlayers`, `allGuessed`, `endTurn`, `voidTurn`, `finish`, `nextTurn`, `addPlayer`, `removePlayer`, `standings`).
- Create `web/src/draw-game.ts`: `DrawMessage`, `DrawOut`, `Visitor`, `TAKEOVER`, `isDrawState`, `isDrawMessage`, `DrawGame`.
- Create `web/src/draw-tv.ts`: `TvRow`, `DrawTv`, `tvView`, `turnGains`, `gainsText`, `clock`, `clip`, `TV_CARD`, `PENCIL`, `TICK`, `drawGameTv`, `gameMean`.
- Create `web/src/draw-panel.ts`: `DRAW_COPY`, `LobbyPlayer`, `TvPanelInput`, `TvPanelGame`, `TvPanelView`, `tvPanelView`, `TvPanelHandlers`, `TvPanel`.
- Modify `web/src/config.ts` (`draw`), `web/src/screen-content.ts` (`TvContent.setGame`), `web/src/screens.ts` (`lit`, `power`, `nextChannel`, `setGame`), `web/src/interactions.ts` (the TV's prompt, no click), `web/src/multiplayer.ts` (the `draw` kind, `sendDraw`, `onDraw`, `onArrive`), `web/src/player.ts` (`held` stops walking), `web/src/main.ts` (wiring), `web/index.html` (the panel, the controls lists), `web/src/style.css` (the panel).
- `web/src/ui.ts` needs no change: the panel's DOM is driven by `TvPanel`, as the board's is by `BoardPanel`.
- Modify `README.md` (controls, the TV's bias light, Visitors together) and the design note's status line.
- Tests: create `web/tests/draw-words.test.ts`, `draw-sketch.test.ts`, `draw-rules.test.ts`, `draw-game.test.ts`, `draw-tv.test.ts`, `draw-panel.test.ts`; extend `web/tests/screen-content.test.ts`, `screens.test.ts`, `interactions.test.ts`, `multiplayer.test.ts`, `seats.test.ts` (the `Player` tests live there).

| Task | Kind | Test files / tests after |
|---|---|---|
| 1. Words and guesses | mechanical (complete code) | 47 / 457 |
| 2. The drawing | mechanical | 48 / 465 |
| 3. The rules | mechanical | 49 / 479 |
| 4. One game across browsers | mechanical | 50 / 499 |
| 5. The game on the TV | mechanical | 51 / 511 |
| 6. Sharing draw messages, a held player stays put | mechanical | 51 / 514 |
| 7. The TV's panel | mechanical (its DOM is checked in Task 9) | 52 / 522 |
| 8. Wiring it up, controls and README | integration | 52 / 522 |
| 9. Check it in the browser, the design note | integration (by hand) | 52 / 522 |

---

### Task 1: Words and guesses (`draw-words.ts`, `draw-match.ts`)

Mechanical: the code below is complete.

**Files:**
- Create: `web/src/draw-words.ts`
- Create: `web/src/draw-match.ts`
- Test: `web/tests/draw-words.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`draw-words.ts`): `DRAW_WORDS: readonly string[]`; `pickChoices(rand: () => number, used: readonly string[], n = 3, words = DRAW_WORDS): string[]`.
- Produces (`draw-match.ts`): `MAX_GUESS = 40`; `cleanGuess(text: string): string`; `normalize(text: string): string`; `oneEdit(a: string, b: string): boolean`; `type Verdict = 'right' | 'close' | 'wrong'`; `judgeGuess(guess: string, word: string): Verdict`; `maskOf(word: string): string`; `letterCount(word: string): number`; `revealLetter(mask: string, word: string, rand: () => number): string`; `shownCount(mask: string): number`; `hintsDue(share: number, letters: number, at: readonly number[]): number`; `spaced(mask: string): string`.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/draw-words.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  cleanGuess, hintsDue, judgeGuess, letterCount, maskOf, normalize, oneEdit, revealLetter, shownCount, spaced,
} from '../src/draw-match';
import { DRAW_WORDS, pickChoices } from '../src/draw-words';

/** A fixed sequence of "random" numbers, repeating. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('the word list', () => {
  it('has a few hundred words, no duplicates', () => {
    expect(DRAW_WORDS.length).toBeGreaterThanOrEqual(300);
    expect(new Set(DRAW_WORDS).size).toBe(DRAW_WORDS.length);
  });
  it('is lowercase, one or two words of plain letters, short enough to draw and to show as blanks', () => {
    for (const w of DRAW_WORDS) {
      expect(w, w).toMatch(/^[a-z]+( [a-z]+)?$/);
      expect(w.length, w).toBeGreaterThanOrEqual(2);
      expect(w.length, w).toBeLessThanOrEqual(16);
    }
  });
  it('offers three different words, none used before', () => {
    const words = ['cat', 'dog', 'owl', 'bee', 'ant'];
    expect(pickChoices(seq(0), [], 3, words)).toEqual(['cat', 'dog', 'owl']);
    expect(pickChoices(seq(0.99), ['ant'], 3, words)).toEqual(['bee', 'owl', 'dog']);
    expect(pickChoices(seq(0), ['cat', 'dog', 'owl'], 3, words)).toEqual(['bee', 'ant']);
    const three = pickChoices(Math.random, []);
    expect(new Set(three).size).toBe(3);
    for (const w of three) expect(DRAW_WORDS).toContain(w);
  });
});

describe('guessing', () => {
  it('cleans a guess: spaces squeezed and trimmed, at most 40 characters', () => {
    expect(cleanGuess('  ice   cream ')).toBe('ice cream');
    expect(cleanGuess('   ')).toBe('');
    expect(cleanGuess('x'.repeat(50))).toHaveLength(40);
  });
  it('ignores case, accents, spaces and hyphens', () => {
    expect(normalize(' Ice-Cream ')).toBe('icecream');
    expect(normalize('Crème Brûlée')).toBe('cremebrulee');
    expect(judgeGuess('VOLCANO', 'volcano')).toBe('right');
    expect(judgeGuess(' volcanó ', 'volcano')).toBe('right');
    expect(judgeGuess('ice-cream', 'ice cream')).toBe('right');
    expect(judgeGuess('icecream', 'ice cream')).toBe('right');
  });
  it('says close one edit away, for words of four letters or more', () => {
    expect(judgeGuess('volcan', 'volcano')).toBe('close');
    expect(judgeGuess('volcanos', 'volcano')).toBe('close');
    expect(judgeGuess('vulcano', 'volcano')).toBe('close');
    expect(judgeGuess('vulcan', 'volcano')).toBe('wrong');
    expect(judgeGuess('bat', 'cat')).toBe('wrong'); // three letters: no "close"
    expect(judgeGuess('bear', 'pear')).toBe('close');
    expect(judgeGuess('', 'cat')).toBe('wrong');
  });
  it('counts one edit exactly', () => {
    expect(oneEdit('abc', 'abc')).toBe(false);
    expect(oneEdit('abc', 'abd')).toBe(true);
    expect(oneEdit('abc', 'ab')).toBe(true);
    expect(oneEdit('ab', 'xab')).toBe(true);
    expect(oneEdit('abc', 'bca')).toBe(false);
    expect(oneEdit('abcd', 'ab')).toBe(false);
  });
});

describe('the blanks', () => {
  it('hides the letters and keeps the spaces', () => {
    expect(maskOf('ice cream')).toBe('___ _____');
    expect(spaced('___ _____')).toBe('_ _ _   _ _ _ _ _');
    expect(letterCount('ice cream')).toBe(8);
  });
  it('shows one hidden letter at a time', () => {
    const once = revealLetter('___', 'cat', seq(0.5));
    expect(once).toBe('_a_');
    expect(shownCount(once)).toBe(1);
    expect(revealLetter(once, 'cat', seq(0))).toBe('ca_');
    expect(revealLetter('cat', 'cat', seq(0))).toBe('cat');
    expect(revealLetter('___ __', 'ice ox', seq(0.99))).toBe('___ _x');
  });
  it('gives a letter at half time and another at three quarters, never more than half the letters', () => {
    const at = [0.5, 0.75];
    expect(hintsDue(0.49, 7, at)).toBe(0);
    expect(hintsDue(0.5, 7, at)).toBe(1);
    expect(hintsDue(0.8, 7, at)).toBe(2);
    expect(hintsDue(0.8, 3, at)).toBe(1);
    expect(hintsDue(1, 1, at)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/draw-words.test.ts`
Expected: FAIL: `../src/draw-match` and `../src/draw-words` cannot be resolved.

- [ ] **Step 3: The word list**

Create `web/src/draw-words.ts` (352 words, grouped by kind; keep the list exactly as here so the tests' expectations of the first words hold):

```ts
/** The words to draw (draw and guess, the Sala TV): simple, drawable English nouns, lowercase, one or two words. */
export const DRAW_WORDS: readonly string[] = [
  // animals
  'cat', 'dog', 'horse', 'cow', 'pig', 'sheep', 'goat', 'chicken', 'duck', 'rabbit', 'mouse', 'frog', 'snake',
  'turtle', 'fish', 'shark', 'whale', 'dolphin', 'octopus', 'crab', 'lobster', 'jellyfish', 'starfish', 'snail',
  'bee', 'butterfly', 'spider', 'ant', 'ladybug', 'owl', 'eagle', 'parrot', 'penguin', 'flamingo', 'swan', 'peacock',
  'bat', 'bear', 'panda', 'lion', 'tiger', 'zebra', 'giraffe', 'elephant', 'monkey', 'gorilla', 'kangaroo', 'koala',
  'camel', 'hippo', 'rhino', 'crocodile', 'fox', 'wolf', 'deer', 'squirrel', 'hedgehog', 'seal', 'polar bear',
  'dinosaur', 'unicorn', 'dragon', 'mermaid', 'worm', 'caterpillar', 'dragonfly', 'mosquito', 'llama',
  // food
  'apple', 'banana', 'cherry', 'grapes', 'lemon', 'orange', 'pear', 'pineapple', 'strawberry', 'watermelon',
  'carrot', 'corn', 'mushroom', 'potato', 'tomato', 'broccoli', 'pumpkin', 'onion', 'bread', 'cheese', 'egg',
  'pizza', 'hamburger', 'hot dog', 'sandwich', 'taco', 'sushi', 'pancake', 'cake', 'cupcake', 'cookie', 'donut',
  'ice cream', 'popcorn', 'candy', 'lollipop', 'chocolate', 'pie', 'spaghetti', 'soup', 'sausage', 'pretzel',
  'croissant', 'avocado', 'coconut', 'peanut', 'milkshake', 'birthday cake', 'fried egg',
  // at home
  'chair', 'table', 'bed', 'sofa', 'lamp', 'clock', 'door', 'window', 'stairs', 'bathtub', 'toilet', 'shower',
  'sink', 'mirror', 'toothbrush', 'toothpaste', 'comb', 'towel', 'pillow', 'blanket', 'candle', 'vase', 'bookshelf',
  'fridge', 'oven', 'kettle', 'teapot', 'cup', 'mug', 'plate', 'fork', 'knife', 'spoon', 'bowl', 'frying pan',
  'bottle', 'key', 'lock', 'broom', 'bucket', 'ladder', 'hammer', 'saw', 'screwdriver', 'nail', 'scissors',
  'umbrella', 'wallet', 'backpack', 'suitcase', 'basket', 'calendar', 'alarm clock', 'television', 'remote control',
  'telephone', 'computer', 'laptop', 'keyboard', 'headphones', 'camera', 'light bulb', 'battery', 'washing machine',
  'vacuum cleaner', 'iron', 'sponge', 'soap', 'hanger', 'curtain', 'fan', 'doorbell', 'chimney', 'mailbox',
  // clothes
  'hat', 'crown', 'glasses', 'sunglasses', 'shirt', 'dress', 'skirt', 'trousers', 'sock', 'shoe', 'boot', 'glove',
  'scarf', 'tie', 'belt', 'jacket', 'ring', 'necklace', 'watch', 'bow tie', 'button',
  // getting about
  'car', 'bus', 'train', 'bicycle', 'motorcycle', 'scooter', 'truck', 'tractor', 'fire truck', 'ambulance', 'taxi',
  'airplane', 'helicopter', 'rocket', 'boat', 'ship', 'sailboat', 'submarine', 'canoe', 'airship', 'skateboard',
  'roller skate', 'traffic light', 'parachute',
  // outdoors
  'sun', 'moon', 'star', 'cloud', 'rainbow', 'lightning', 'tornado', 'volcano', 'mountain', 'island', 'beach',
  'wave', 'river', 'waterfall', 'desert', 'cactus', 'tree', 'palm tree', 'flower', 'rose', 'sunflower', 'tulip',
  'leaf', 'cave', 'iceberg', 'planet', 'comet', 'fire', 'campfire', 'snowflake',
  // buildings
  'house', 'castle', 'tent', 'igloo', 'lighthouse', 'bridge', 'windmill', 'barn', 'pyramid', 'skyscraper',
  'fountain', 'treehouse',
  // play and music
  'ball', 'football', 'basketball', 'tennis racket', 'baseball bat', 'hockey stick', 'trophy', 'medal', 'kite',
  'balloon', 'puzzle', 'dice', 'teddy bear', 'doll', 'robot', 'drum', 'guitar', 'piano', 'violin', 'trumpet', 'harp',
  'microphone', 'whistle', 'snowman', 'sandcastle', 'swing',
  // things
  'book', 'pencil', 'crayon', 'paintbrush', 'envelope', 'map', 'globe', 'compass', 'magnet', 'magnifying glass',
  'telescope', 'microscope', 'flashlight', 'anchor', 'sword', 'shield', 'arrow', 'axe', 'shovel', 'rake',
  'wheelbarrow', 'watering can', 'bell', 'flag', 'gift', 'heart', 'diamond', 'coin', 'piggy bank', 'treasure chest',
  'ghost', 'skeleton', 'skull', 'witch', 'pirate', 'alien', 'angel', 'vampire', 'mummy',
  // the body
  'eye', 'ear', 'nose', 'mouth', 'hand', 'foot', 'tooth', 'brain', 'bone',
];

/** `n` different words to choose from, none of them `used` already in the game; fewer if the list runs out. `rand`
 * returns [0, 1). */
export function pickChoices(rand: () => number, used: readonly string[], n = 3, words: readonly string[] = DRAW_WORDS): string[] {
  const free = words.filter((w) => !used.includes(w));
  const out: string[] = [];
  while (out.length < n && free.length) out.push(...free.splice(Math.min(free.length - 1, Math.floor(rand() * free.length)), 1));
  return out;
}
```

- [ ] **Step 4: Matching and the blanks**

Create `web/src/draw-match.ts`:

```ts
/** The longest guess, in characters. */
export const MAX_GUESS = 40;

/** A guess as sent: spaces squeezed, trimmed, cut to `MAX_GUESS`; '' when nothing is left. */
export function cleanGuess(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_GUESS).trim();
}

/** A guess or a word as compared: lowercase, without accents, spaces or hyphens ("Ice-Cream " → "icecream"). */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s-]+/g, '');
}

/** Whether two strings are exactly one edit apart: one letter added, dropped or changed. */
export function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export type Verdict = 'right' | 'close' | 'wrong';

/** A guess against the word: right, close (one edit away, for words of 4 letters or more), or wrong. */
export function judgeGuess(guess: string, word: string): Verdict {
  const g = normalize(guess);
  const w = normalize(word);
  if (!g) return 'wrong';
  if (g === w) return 'right';
  return w.length >= 4 && oneEdit(g, w) ? 'close' : 'wrong';
}

/** The word as the guessers see it: `_` for each letter, spaces kept ("ice cream" → "___ _____"). */
export function maskOf(word: string): string {
  return word.replace(/[^ ]/g, '_');
}

/** The letters a word has (its spaces don't count). */
export function letterCount(word: string): number {
  return word.replace(/ /g, '').length;
}

/** The mask with one more letter of the word shown, picked by `rand` among the hidden ones; the same mask when none is
 * hidden. */
export function revealLetter(mask: string, word: string, rand: () => number): string {
  const hidden = [...mask].flatMap((c, i) => (c === '_' ? [i] : []));
  if (!hidden.length) return mask;
  const i = hidden[Math.min(hidden.length - 1, Math.floor(rand() * hidden.length))];
  return mask.slice(0, i) + word[i] + mask.slice(i + 1);
}

/** How many letters show in a mask. */
export function shownCount(mask: string): number {
  return mask.replace(/[_ ]/g, '').length;
}

/** Letters to show once `share` (0..1) of the drawing time has gone: one per hint time passed, never more than half
 * the word's letters. */
export function hintsDue(share: number, letters: number, at: readonly number[]): number {
  return Math.min(Math.floor(letters / 2), at.filter((a) => share >= a).length);
}

/** Blanks to read: a space between letters, three between words ("___ _____" → "_ _ _   _ _ _ _ _"). */
export function spaced(mask: string): string {
  return [...mask].join(' ');
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/draw-words.test.ts`
Expected: PASS (10 tests).

Run: `cd web && npm test && npm run build`
Expected: 47 test files, 457 tests pass; the build is clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/draw-words.ts web/src/draw-match.ts web/tests/draw-words.test.ts
git commit -m "TV draw and guess: the words, and matching guesses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The drawing (`draw-sketch.ts`)

Mechanical: the code below is complete.

**Files:**
- Create: `web/src/draw-sketch.ts`
- Test: `web/tests/draw-sketch.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GRID = 1000`; `PALETTE: readonly string[]` (8 pens, then white); `COLOUR_NAMES: readonly string[]` (the 8 pens); `ERASER = 8`; `WIDTHS: readonly number[]` (`[8, 24]`); `MAX_STROKES = 300`, `MAX_POINTS = 500`, `MAX_TOTAL = 20000`, `MIN_STEP = 4`; `type Stroke = { c: number; w: number; p: number[] }`; `isPoints(v: unknown, max?: number): v is number[]`; `isStroke(v: unknown): v is Stroke`; `gridPoint(clientX, clientY, rect: { left; top; width; height }): [number, number]`; `interface StrokePart { n; at; c; w; p: number[] }`; `class Sketch` with `strokes: Stroke[]`, `version: number`, `begin(c, w, x, y): boolean`, `extend(x, y): boolean`, `undo(): boolean`, `clear(): void`, `add(n, at, c, w, p): boolean`, `truncate(n): void`, `replace(strokes: Stroke[]): void`, `since(from: { n; at }): { parts: StrokePart[]; next: { n; at } }`; `paintSketch(ctx, strokes: readonly Stroke[], x, y, w, h): void`.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/draw-sketch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ERASER, gridPoint, isStroke, MAX_POINTS, MAX_STROKES, MIN_STEP, paintSketch, PALETTE, Sketch, WIDTHS,
} from '../src/draw-sketch';

/** A 2D context that records the calls made on it and the properties set. */
function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const props: Record<string, unknown>[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      return (...args: unknown[]) => void calls.push({ name: String(prop), args });
    },
    set(_t, prop, value) {
      props.push({ [String(prop)]: value });
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, props };
}

describe('Sketch', () => {
  it("draws strokes in the grid, keeping points at least a few units apart, clamped to the grid", () => {
    const s = new Sketch();
    expect(s.begin(0, 1, 100, 100)).toBe(true);
    expect(s.extend(101, 101)).toBe(false); // too close
    expect(s.extend(100 + MIN_STEP, 100)).toBe(true);
    expect(s.extend(1200, -5)).toBe(true);
    expect(s.strokes).toEqual([{ c: 0, w: 1, p: [100, 100, 104, 100, 1000, 0] }]);
    expect(s.version).toBe(3);
    expect(s.begin(9, 0, 0, 0)).toBe(false); // no such colour
    expect(s.begin(0, 2, 0, 0)).toBe(false); // no such width
  });
  it('undoes the last stroke and clears', () => {
    const s = new Sketch();
    s.begin(2, 0, 10, 10);
    s.begin(ERASER, 1, 500, 500);
    expect(s.undo()).toBe(true);
    expect(s.strokes.map((t) => t.c)).toEqual([2]);
    s.clear();
    expect(s.strokes).toEqual([]);
    expect(s.undo()).toBe(false);
  });
  it('stops at its limits', () => {
    const s = new Sketch();
    for (let i = 0; i < MAX_STROKES; i++) expect(s.begin(0, 0, 0, 0)).toBe(true);
    expect(s.begin(0, 0, 0, 0)).toBe(false);
    const long = new Sketch();
    long.begin(0, 0, 0, 0);
    for (let i = 1; i < MAX_POINTS + 10; i++) long.extend(i % 2 ? 500 : 0, 0);
    expect(long.strokes[0].p).toHaveLength(MAX_POINTS * 2);
  });
  it("hands out what was drawn since the last send, across strokes", () => {
    const s = new Sketch();
    s.begin(0, 0, 0, 0);
    s.extend(10, 0);
    const first = s.since({ n: 0, at: 0 });
    expect(first.parts).toEqual([{ n: 0, at: 0, c: 0, w: 0, p: [0, 0, 10, 0] }]);
    expect(first.next).toEqual({ n: 0, at: 4 });
    s.extend(20, 0);
    s.begin(3, 1, 500, 500);
    const second = s.since(first.next);
    expect(second.parts).toEqual([{ n: 0, at: 4, c: 0, w: 0, p: [20, 0] }, { n: 1, at: 0, c: 3, w: 1, p: [500, 500] }]);
    expect(s.since(second.next).parts).toEqual([]);
    expect(new Sketch().since({ n: 0, at: 0 })).toEqual({ parts: [], next: { n: 0, at: 0 } });
  });
  it("takes the drawer's parts in order, skips what it has, and refuses what doesn't follow on", () => {
    const s = new Sketch();
    expect(s.add(0, 0, 2, 1, [0, 0, 10, 0])).toBe(true);
    expect(s.add(0, 4, 2, 1, [20, 0])).toBe(true);
    expect(s.add(0, 2, 2, 1, [10, 0, 20, 0, 30, 0])).toBe(true); // overlaps: only 30, 0 is new
    expect(s.strokes).toEqual([{ c: 2, w: 1, p: [0, 0, 10, 0, 20, 0, 30, 0] }]);
    expect(s.add(0, 20, 2, 1, [1, 1])).toBe(false); // a gap
    expect(s.add(2, 0, 2, 1, [1, 1])).toBe(false); // a stroke missing
    expect(s.add(1, 2, 2, 1, [1, 1])).toBe(false); // a new stroke from its middle
    expect(s.add(1, 0, 4, 0, [5, 5])).toBe(true);
    s.truncate(1);
    expect(s.strokes).toHaveLength(1);
    s.replace([{ c: 1, w: 0, p: [1, 2] }]);
    expect(s.strokes).toEqual([{ c: 1, w: 0, p: [1, 2] }]);
  });
});

describe('strokes as sent', () => {
  it('takes well-formed strokes only', () => {
    expect(isStroke({ c: 0, w: 1, p: [0, 0, 1000, 1000] })).toBe(true);
    expect(isStroke({ c: ERASER, w: 0, p: [5, 5] })).toBe(true);
    expect(isStroke({ c: PALETTE.length, w: 0, p: [5, 5] })).toBe(false);
    expect(isStroke({ c: 0, w: WIDTHS.length, p: [5, 5] })).toBe(false);
    expect(isStroke({ c: 0, w: 0, p: [5] })).toBe(false);
    expect(isStroke({ c: 0, w: 0, p: [] })).toBe(false);
    expect(isStroke({ c: 0, w: 0, p: [5, 1001] })).toBe(false);
    expect(isStroke({ c: 0, w: 0, p: [5, 0.5] })).toBe(false);
    expect(isStroke({ c: 0, w: 0, p: new Array(MAX_POINTS * 2 + 2).fill(0) })).toBe(false);
    expect(isStroke(null)).toBe(false);
  });
});

describe('the drawing on a canvas', () => {
  it('finds the grid point under a pointer', () => {
    const rect = { left: 100, top: 50, width: 400, height: 300 };
    expect(gridPoint(100, 50, rect)).toEqual([0, 0]);
    expect(gridPoint(300, 200, rect)).toEqual([500, 500]);
    expect(gridPoint(600, 400, rect)).toEqual([1000, 1000]);
  });
  it('stretches the grid to the rectangle, a dot for a single point, clipped to the card', () => {
    const { ctx, calls, props } = recorder();
    paintSketch(ctx, [{ c: 2, w: 0, p: [0, 0, 1000, 1000] }, { c: 6, w: 1, p: [500, 500] }], 10, 20, 500, 300);
    const names = calls.map((c) => c.name);
    expect(names.slice(0, 4)).toEqual(['save', 'beginPath', 'rect', 'clip']);
    expect(calls.find((c) => c.name === 'moveTo')?.args).toEqual([10, 20]);
    expect(calls.find((c) => c.name === 'lineTo')?.args).toEqual([510, 320]);
    expect(calls.find((c) => c.name === 'arc')?.args).toEqual([260, 170, 6, 0, Math.PI * 2]);
    expect(props).toContainEqual({ strokeStyle: PALETTE[2] });
    expect(props).toContainEqual({ lineWidth: 4 });
    expect(names.at(-1)).toBe('restore');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/draw-sketch.test.ts`
Expected: FAIL: `../src/draw-sketch` cannot be resolved.

- [ ] **Step 3: Implement**

Create `web/src/draw-sketch.ts`:

```ts
/** A drawing's points run 0..GRID on both axes, whatever the size of the canvas it is drawn on (4:3). */
export const GRID = 1000;
/** The pens' eight colours, then the eraser's white. */
export const PALETTE: readonly string[] = ['#1f1f24', '#7a4a26', '#e0393e', '#f28c28', '#f2c81f', '#3a9d4a', '#2f6fd6', '#8a4fc9', '#ffffff'];
export const COLOUR_NAMES: readonly string[] = ['Black', 'Brown', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple'];
/** The eraser paints with this colour (white, like the card). */
export const ERASER = 8;
/** The two pen widths, in grid units: fine and broad. */
export const WIDTHS: readonly number[] = [8, 24];
/** Limits, so a drawing stays a message of a reasonable size: strokes, points in a stroke, points in all. */
export const MAX_STROKES = 300;
export const MAX_POINTS = 500;
export const MAX_TOTAL = 20000;
/** A new point is kept only this far (grid units) from the stroke's last one. */
export const MIN_STEP = 4;

/** A stroke: its colour and width (indices into `PALETTE` and `WIDTHS`) and its points as flat x, y pairs in the grid.
 * A type, not an interface, so it can be sent as JSON. */
export type Stroke = { c: number; w: number; p: number[] };

const toGrid = (v: number) => Math.max(0, Math.min(GRID, Math.round(v)));
const isIndex = (v: unknown, below: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < below;

/** Grid points, as a stroke's or a stroke message's: an even number of whole numbers in 0..GRID, at most `max`. */
export function isPoints(v: unknown, max = MAX_POINTS * 2): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.length <= max && v.length % 2 === 0
    && v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= GRID);
}

export function isStroke(v: unknown): v is Stroke {
  const s = v as Stroke | null;
  return !!s && typeof s === 'object' && isIndex(s.c, PALETTE.length) && isIndex(s.w, WIDTHS.length) && isPoints(s.p);
}

/** Where a pointer is on a canvas, in grid units: `rect` is the canvas's place on screen. */
export function gridPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): [number, number] {
  return [toGrid(((clientX - rect.left) / rect.width) * GRID), toGrid(((clientY - rect.top) / rect.height) * GRID)];
}

/** The part of a stroke not sent yet, as a stroke message carries it: stroke `n`, from number `at` of its flat list. */
export interface StrokePart { n: number; at: number; c: number; w: number; p: number[] }

/**
 * A turn's drawing. The drawer adds to it with `begin`, `extend`, `undo` and `clear`; everyone else with what the
 * drawer sends (`add`, `truncate`, `clear`, `replace`), which may overlap what is here already.
 */
export class Sketch {
  strokes: Stroke[] = [];
  /** Goes up with every change, for redrawing. */
  version = 0;
  private total = 0;

  /** Starts a stroke at x, y (grid units); false at the limits. */
  begin(c: number, w: number, x: number, y: number): boolean {
    if (this.strokes.length >= MAX_STROKES || this.total >= MAX_TOTAL || !isIndex(c, PALETTE.length) || !isIndex(w, WIDTHS.length)) return false;
    this.strokes.push({ c, w, p: [toGrid(x), toGrid(y)] });
    this.total++;
    this.version++;
    return true;
  }

  /** Adds a point to the last stroke when it is far enough from the stroke's last point; false otherwise. */
  extend(x: number, y: number): boolean {
    const s = this.strokes.at(-1);
    if (!s || s.p.length >= MAX_POINTS * 2 || this.total >= MAX_TOTAL) return false;
    const gx = toGrid(x);
    const gy = toGrid(y);
    if (Math.hypot(gx - s.p[s.p.length - 2], gy - s.p[s.p.length - 1]) < MIN_STEP) return false;
    s.p.push(gx, gy);
    this.total++;
    this.version++;
    return true;
  }

  /** Takes the last stroke away; false when there is none. */
  undo(): boolean {
    const s = this.strokes.pop();
    if (!s) return false;
    this.total -= s.p.length / 2;
    this.version++;
    return true;
  }

  clear(): void {
    if (!this.strokes.length) return;
    this.strokes = [];
    this.total = 0;
    this.version++;
  }

  /** The drawer's points for stroke `n` from number `at` of its flat list (a new stroke when `n` is the next one and
   * `at` 0). Points already here are skipped; false when they don't follow on from what is here. */
  add(n: number, at: number, c: number, w: number, p: number[]): boolean {
    if (n > this.strokes.length || n >= MAX_STROKES) return false;
    if (n === this.strokes.length) {
      if (at !== 0) return false;
      this.strokes.push({ c, w, p: [] });
    }
    const s = this.strokes[n];
    if (at > s.p.length) return false;
    const room = Math.min(MAX_POINTS * 2 - s.p.length, (MAX_TOTAL - this.total) * 2);
    const fresh = p.slice(s.p.length - at, s.p.length - at + Math.max(0, room));
    if (!fresh.length) return true;
    s.p.push(...fresh);
    this.total += fresh.length / 2;
    this.version++;
    return true;
  }

  /** Back to the first `n` strokes (the drawer's Undo). */
  truncate(n: number): void {
    if (n >= this.strokes.length) return;
    for (const s of this.strokes.splice(n)) this.total -= s.p.length / 2;
    this.version++;
  }

  /** The whole drawing at once, as a newcomer gets it. */
  replace(strokes: Stroke[]): void {
    this.strokes = strokes.slice(0, MAX_STROKES).map((s) => ({ c: s.c, w: s.w, p: [...s.p] }));
    this.total = this.strokes.reduce((a, s) => a + s.p.length / 2, 0);
    this.version++;
  }

  /** What has been drawn since `from` (stroke `n`, number `at`), as parts to send, and where the next send starts. */
  since(from: { n: number; at: number }): { parts: StrokePart[]; next: { n: number; at: number } } {
    const parts: StrokePart[] = [];
    for (let n = from.n; n < this.strokes.length; n++) {
      const s = this.strokes[n];
      const at = n === from.n ? from.at : 0;
      if (at < s.p.length) parts.push({ n, at, c: s.c, w: s.w, p: s.p.slice(at) });
    }
    const last = this.strokes.length - 1;
    return { parts, next: last < 0 ? { n: 0, at: 0 } : { n: last, at: this.strokes[last].p.length } };
  }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draws the strokes into the rectangle x, y, w, h (the grid stretched to it, clipped to it); the card under them is
 * the caller's. Pens are as wide as their share of the rectangle's width. */
export function paintSketch(ctx: Ctx, strokes: readonly Stroke[], x: number, y: number, w: number, h: number): void {
  const sx = w / GRID;
  const sy = h / GRID;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    const colour = PALETTE[s.c] ?? PALETTE[0];
    const width = (WIDTHS[s.w] ?? WIDTHS[0]) * sx;
    const p = s.p;
    if (p.length < 2) continue;
    if (p.length === 2) {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x + p[0] * sx, y + p[1] * sy, width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x + p[0] * sx, y + p[1] * sy);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(x + p[i] * sx, y + p[i + 1] * sy);
    ctx.stroke();
  }
  ctx.restore();
}
```

Notes for the implementer: `add` is how every other browser takes the drawer's points; it tolerates overlap because a newcomer gets the whole drawing (`replace`) and then batches that may repeat points it already has. `since` is how the drawer's browser finds what to send next.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/draw-sketch.test.ts`
Expected: PASS (8 tests).

Run: `cd web && npm test && npm run build`
Expected: 48 test files, 465 tests pass; the build is clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/draw-sketch.ts web/tests/draw-sketch.test.ts
git commit -m "TV draw and guess: the drawing as strokes in a grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The rules (`draw-rules.ts`, `CONFIG.draw`)

Mechanical: the code below is complete. Every transition is pure: it returns a new state with `seq` one up, or the same object when nothing changes.

**Files:**
- Modify: `web/src/config.ts` (a `draw` section)
- Create: `web/src/draw-rules.ts`
- Test: `web/tests/draw-rules.test.ts`

**Interfaces:**
- Consumes (Task 1): `hintsDue`, `letterCount`, `maskOf`, `revealLetter`, `shownCount` from `./draw-match`.
- Produces: `CONFIG.draw` (see Global Constraints); `type DrawPhase = 'choosing' | 'drawing' | 'reveal' | 'end'`, `PHASES`; `type DrawPlayer = { id; name; score; here: boolean; drew: boolean }`; `type FeedKind = 'guess' | 'hit' | 'left'`, `FEED_KINDS`; `type FeedLine = { id; kind: FeedKind; text }`; `type TurnPoints = { id; points }`; `type DrawState = { id; seq; owner; drawer; players: DrawPlayer[]; queue: string[]; turn; phase: DrawPhase; left; mask; word; guessed: string[]; points: TurnPoints[]; used: string[]; feed: FeedLine[] }`; `MAX_PLAYERS = 32`; `newGame(id, players: { id; name }[]): DrawState`; `beginDrawing(s, word)`; `guessPoints(left, total?)`; `rightGuess(s, id, left)`; `wrongGuess(s, id, text)`; `giveHint(s, word, share, rand)`; `herePlayers(s): DrawPlayer[]`; `allGuessed(s): boolean`; `endTurn(s, word)`; `voidTurn(s)`; `finish(s)`; `nextTurn(s)`; `addPlayer(s, id, name)`; `removePlayer(s, id)`; `standings(players): (DrawPlayer & { place: number })[]` (all transitions take and return `DrawState`).

- [ ] **Step 1: Write the failing tests**

Create `web/tests/draw-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addPlayer, allGuessed, beginDrawing, type DrawState, endTurn, finish, giveHint, guessPoints, herePlayers, MAX_PLAYERS,
  newGame, nextTurn, removePlayer, rightGuess, standings, voidTurn, wrongGuess,
} from '../src/draw-rules';

const ANA = { id: 'ana', name: 'Ana' };
const RUI = { id: 'rui', name: 'Rui' };
const ZE = { id: 'ze', name: 'Zé' };
const scores = (s: DrawState) => Object.fromEntries(s.players.map((p) => [p.id, p.score]));

describe('a turn', () => {
  it('starts with the first player choosing, the others queued in order', () => {
    const s = newGame('g1', [ANA, RUI, ZE]);
    expect(s).toMatchObject({ id: 'g1', seq: 1, owner: 'ana', drawer: 'ana', queue: ['rui', 'ze'], turn: 1, phase: 'choosing', left: 15000 });
    expect(s.players.map((p) => [p.id, p.score, p.here, p.drew])).toEqual([['ana', 0, true, true], ['rui', 0, true, false], ['ze', 0, true, false]]);
  });
  it('draws for 80 s with the word as blanks', () => {
    const s = beginDrawing(newGame('g1', [ANA, RUI]), 'ice cream');
    expect(s).toMatchObject({ seq: 2, phase: 'drawing', left: 80000, mask: '___ _____', word: '' });
  });
  it('scores a right guess 300 at the start down to 100 at the end, rounded to 10', () => {
    expect(guessPoints(80000)).toBe(300);
    expect(guessPoints(40000)).toBe(200);
    expect(guessPoints(0)).toBe(100);
    expect(guessPoints(30000)).toBe(180); // 175 rounds up
    expect(guessPoints(90000)).toBe(300);
  });
  it('gives the guesser their points and the drawer 50 for each right guess, once per guesser', () => {
    let s = beginDrawing(newGame('g1', [ANA, RUI, ZE]), 'cat');
    s = rightGuess(s, 'rui', 80000);
    s = rightGuess(s, 'rui', 70000); // already has it
    s = rightGuess(s, 'ana', 70000); // the drawer can't guess
    s = rightGuess(s, 'ze', 40000);
    expect(scores(s)).toEqual({ ana: 100, rui: 300, ze: 200 });
    expect(s.points).toEqual([{ id: 'rui', points: 300 }, { id: 'ana', points: 100 }, { id: 'ze', points: 200 }]);
    expect(s.guessed).toEqual(['rui', 'ze']);
    expect(s.feed).toEqual([{ id: 'rui', kind: 'hit', text: '' }, { id: 'ze', kind: 'hit', text: '' }]);
    expect(allGuessed(s)).toBe(true);
  });
  it('puts wrong guesses in the feed, keeping the last eight lines', () => {
    let s = beginDrawing(newGame('g1', [ANA, RUI]), 'cat');
    for (let i = 0; i < 10; i++) s = wrongGuess(s, 'rui', `dog ${i}`);
    expect(s.feed).toHaveLength(8);
    expect(s.feed[0]).toEqual({ id: 'rui', kind: 'guess', text: 'dog 2' });
    expect(allGuessed(s)).toBe(false);
  });
  it('shows a letter at half time and another at three quarters, at most half the letters', () => {
    const rand = () => 0;
    let s = beginDrawing(newGame('g1', [ANA, RUI]), 'volcano');
    s = giveHint(s, 'volcano', 0.4, rand);
    expect(s.mask).toBe('_______');
    s = giveHint(s, 'volcano', 0.5, rand);
    expect(s.mask).toBe('v______');
    expect(giveHint(s, 'volcano', 0.6, rand)).toBe(s); // nothing more due: the same state
    s = giveHint(s, 'volcano', 0.75, rand);
    expect(s.mask).toBe('vo_____');
    let cat = beginDrawing(newGame('g2', [ANA, RUI]), 'cat');
    cat = giveHint(giveHint(cat, 'cat', 0.5, rand), 'cat', 0.9, rand);
    expect(cat.mask).toBe('c__'); // half of three letters is one
  });
  it('reveals the word with the turn over, and the next player draws', () => {
    let s = rightGuess(beginDrawing(newGame('g1', [ANA, RUI, ZE]), 'cat'), 'rui', 80000);
    s = endTurn(s, 'cat');
    expect(s).toMatchObject({ phase: 'reveal', left: 5000, word: 'cat', mask: 'cat', used: ['cat'] });
    s = nextTurn(s);
    expect(s).toMatchObject({ owner: 'rui', drawer: 'rui', queue: ['ze'], turn: 2, phase: 'choosing', left: 15000, mask: '', word: '', guessed: [], points: [] });
    expect(s.players.find((p) => p.id === 'rui')?.drew).toBe(true);
    expect(scores(s)).toEqual({ ana: 50, rui: 300, ze: 0 });
  });
  it('ends after everyone has drawn once, with the final scores for 15 s', () => {
    let s = newGame('g1', [ANA, RUI]);
    s = nextTurn(endTurn(beginDrawing(s, 'cat'), 'cat'));
    expect(s.drawer).toBe('rui');
    s = nextTurn(endTurn(beginDrawing(s, 'dog'), 'dog'));
    expect(s).toMatchObject({ phase: 'end', left: 15000, used: ['cat', 'dog'] });
    expect(finish(s).phase).toBe('end');
  });
});

describe('joining and leaving', () => {
  it('adds a newcomer to the end of the queue, and a returning player only if they have not drawn', () => {
    let s = newGame('g1', [ANA, RUI]);
    s = addPlayer(s, 'ze', 'Zé');
    expect(s.queue).toEqual(['rui', 'ze']);
    expect(addPlayer(s, 'ze', 'Zé')).toBe(s); // already in
    s = removePlayer(s, 'ana');
    s = addPlayer(s, 'ana', 'Ana');
    expect(s.queue).toEqual(['rui', 'ze']); // Ana drew already
    expect(herePlayers(s).map((p) => p.id)).toEqual(['ana', 'rui', 'ze']);
  });
  it('takes a leaver out of the queue, keeps their score on the board, and says so in the feed', () => {
    let s = rightGuess(beginDrawing(newGame('g1', [ANA, RUI, ZE]), 'cat'), 'rui', 80000);
    s = removePlayer(s, 'rui');
    expect(s.queue).toEqual(['ze']);
    expect(s.players.find((p) => p.id === 'rui')).toMatchObject({ here: false, score: 300 });
    expect(s.feed.at(-1)).toEqual({ id: 'rui', kind: 'left', text: '' });
    expect(removePlayer(s, 'rui')).toBe(s);
  });
  it('ends the game when fewer than two are left to play', () => {
    const s = nextTurn(removePlayer(endTurn(beginDrawing(newGame('g1', [ANA, RUI, ZE]), 'cat'), 'cat'), 'ze'));
    expect(s.drawer).toBe('rui');
    expect(nextTurn(removePlayer(s, 'ana')).phase).toBe('end');
  });
  it("takes back a turn's points when its drawer leaves", () => {
    let s = rightGuess(beginDrawing(newGame('g1', [ANA, RUI, ZE]), 'cat'), 'rui', 80000);
    s = nextTurn(removePlayer(voidTurn(s), 'ana'));
    expect(scores(s)).toEqual({ ana: 0, rui: 0, ze: 0 });
    expect(s).toMatchObject({ drawer: 'rui', turn: 2, phase: 'choosing' });
  });
  it('takes no more than the most players a game holds', () => {
    let s = newGame('g1', Array.from({ length: MAX_PLAYERS }, (_, i) => ({ id: `p${i}`, name: `P${i}` })));
    expect(addPlayer(s, 'late', 'Late')).toBe(s);
    s = removePlayer(s, 'p3');
    expect(addPlayer(s, 'p3', 'P3').players.find((p) => p.id === 'p3')?.here).toBe(true);
  });
});

describe('standings', () => {
  it('ranks by score, ties sharing a place', () => {
    const players = [
      { id: 'a', name: 'A', score: 300, here: true, drew: true }, { id: 'b', name: 'B', score: 500, here: false, drew: true },
      { id: 'c', name: 'C', score: 300, here: true, drew: true }, { id: 'd', name: 'D', score: 0, here: true, drew: false },
    ];
    expect(standings(players).map((p) => [p.id, p.place])).toEqual([['b', 1], ['a', 2], ['c', 2], ['d', 4]]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/draw-rules.test.ts`
Expected: FAIL: `../src/draw-rules` cannot be resolved.

- [ ] **Step 3: The config**

In `web/src/config.ts`, insert just before the line `  /** The office's Nanoleaf panels (nanoleaf.ts): a gradient between two hues (0..1: teal to magenta, through blue)`:

```ts
  /** Draw and guess on the Sala TV (draw-rules.ts, draw-game.ts): the phases' times, the points, the hints, sharing. */
  draw: {
    /** Seconds to choose a word, to draw it, to see it revealed, and to see the final scores. */
    choose: 15,
    drawing: 80,
    reveal: 5,
    end: 15,
    /** A right guess scores `most` at the start of the drawing time, falling to `least` at its end, rounded to
     * `step`; the drawer scores `drawer` for each. */
    most: 300,
    least: 100,
    step: 10,
    drawer: 50,
    /** Shares of the drawing time at which a letter of the word shows (never more than half its letters). */
    hints: [0.5, 0.75] as number[],
    /** Words to choose from, and the lines the feed keeps. */
    choices: 3,
    feed: 8,
    /** Seconds between the drawer's batches of stroke points. */
    strokeEvery: 0.05,
  },
```

- [ ] **Step 4: Implement the rules**

Create `web/src/draw-rules.ts`:

```ts
import { CONFIG } from './config';
import { hintsDue, letterCount, maskOf, revealLetter, shownCount } from './draw-match';

/** A turn's phases, then the final scores. */
export type DrawPhase = 'choosing' | 'drawing' | 'reveal' | 'end';
export const PHASES: readonly DrawPhase[] = ['choosing', 'drawing', 'reveal', 'end'];
/** Someone who has played in this game: `here` while still in it (a player who left keeps their score on the board),
 * `drew` once they have had their turn. */
export type DrawPlayer = { id: string; name: string; score: number; here: boolean; drew: boolean };
/** A line of the guess feed: a wrong guess, "guessed it!", or "left". */
export type FeedKind = 'guess' | 'hit' | 'left';
export const FEED_KINDS: readonly FeedKind[] = ['guess', 'hit', 'left'];
export type FeedLine = { id: string; kind: FeedKind; text: string };
/** Points won this turn, by player. */
export type TurnPoints = { id: string; points: number };

/**
 * A game of draw and guess, as its owner (the drawer's browser) holds and sends it. The secret word is never in it
 * until the reveal: `mask` is what the guessers see. A type, not an interface, so it can be sent as JSON.
 */
export type DrawState = {
  /** The game's id (made by the browser that pressed Start), and its sequence number: each change counts one up. */
  id: string;
  seq: number;
  /** Whose browser holds and sends the game now (the drawer's while a turn is played), and who draws this turn. */
  owner: string;
  drawer: string;
  /** Everyone who has played, in the order they came into the game. */
  players: DrawPlayer[];
  /** Who draws after this turn, in order. */
  queue: string[];
  /** 1 for the first turn, then up by one each turn. */
  turn: number;
  phase: DrawPhase;
  /** Milliseconds left in the phase when it was made or sent: each browser keeps its own deadline from it. */
  left: number;
  /** The word as blanks (`_`), with the hints' letters and its spaces; the whole word at the reveal. */
  mask: string;
  /** The word, from the reveal on; '' before. */
  word: string;
  /** Who has the word this turn. */
  guessed: string[];
  points: TurnPoints[];
  /** The words drawn so far, never offered again. */
  used: string[];
  /** The last lines of the guess feed. */
  feed: FeedLine[];
};

/** At most this many players in a game. */
export const MAX_PLAYERS = 32;

const ms = (s: number) => Math.round(s * 1000);
/** A change: a new state, one up in sequence. */
const bump = (s: DrawState, change: Partial<DrawState>): DrawState => ({ ...s, ...change, seq: s.seq + 1 });
const pushFeed = (feed: FeedLine[], line: FeedLine): FeedLine[] => [...feed, line].slice(-CONFIG.draw.feed);

/** A new game: `players` in drawing order (arrival order), the first choosing a word. */
export function newGame(id: string, players: { id: string; name: string }[]): DrawState {
  const first = players[0].id;
  return {
    id, seq: 1, owner: first, drawer: first,
    players: players.slice(0, MAX_PLAYERS).map((p) => ({ id: p.id, name: p.name, score: 0, here: true, drew: p.id === first })),
    queue: players.slice(1, MAX_PLAYERS).map((p) => p.id),
    turn: 1, phase: 'choosing', left: ms(CONFIG.draw.choose), mask: '', word: '', guessed: [], points: [], used: [], feed: [],
  };
}

/** The drawer has chosen: the drawing time starts, the word shows as blanks. */
export function beginDrawing(s: DrawState, word: string): DrawState {
  return bump(s, { phase: 'drawing', left: ms(CONFIG.draw.drawing), mask: maskOf(word) });
}

/** A right guess's points with `left` ms of the drawing time to go: `most` at the start, `least` at the end, linear,
 * rounded to `step`. */
export function guessPoints(left: number, total = ms(CONFIG.draw.drawing)): number {
  const { most, least, step } = CONFIG.draw;
  const share = Math.max(0, Math.min(1, left / total));
  return Math.round((least + (most - least) * share) / step) * step;
}

function award(s: DrawState, id: string, points: number): Pick<DrawState, 'players' | 'points'> {
  const players = s.players.map((p) => (p.id === id ? { ...p, score: p.score + points } : p));
  const had = s.points.find((p) => p.id === id);
  const turn = had ? s.points.map((p) => (p.id === id ? { id, points: p.points + points } : p)) : [...s.points, { id, points }];
  return { players, points: turn };
}

/** A player has the word with `left` ms to go: points for them and for the drawer, "guessed it!" in the feed. */
export function rightGuess(s: DrawState, id: string, left: number): DrawState {
  if (s.phase !== 'drawing' || id === s.drawer || s.guessed.includes(id)) return s;
  const withGuesser = { ...s, ...award(s, id, guessPoints(left)) };
  return bump(s, { ...award(withGuesser, s.drawer, CONFIG.draw.drawer), guessed: [...s.guessed, id], feed: pushFeed(s.feed, { id, kind: 'hit', text: '' }) });
}

/** A wrong guess, for the feed. */
export function wrongGuess(s: DrawState, id: string, text: string): DrawState {
  return bump(s, { feed: pushFeed(s.feed, { id, kind: 'guess', text }) });
}

/** One more letter of `word` when one is due with `share` (0..1) of the drawing time gone. */
export function giveHint(s: DrawState, word: string, share: number, rand: () => number): DrawState {
  if (s.phase !== 'drawing' || shownCount(s.mask) >= hintsDue(share, letterCount(word), CONFIG.draw.hints)) return s;
  return bump(s, { mask: revealLetter(s.mask, word, rand) });
}

/** The players still in the game. */
export function herePlayers(s: DrawState): DrawPlayer[] {
  return s.players.filter((p) => p.here);
}

/** Every player here but the drawer has the word (and there is at least one). */
export function allGuessed(s: DrawState): boolean {
  const guessers = herePlayers(s).filter((p) => p.id !== s.drawer);
  return guessers.length > 0 && guessers.every((p) => s.guessed.includes(p.id));
}

/** The turn is over: the word shows to all, with the turn's points. */
export function endTurn(s: DrawState, word: string): DrawState {
  return bump(s, { phase: 'reveal', left: ms(CONFIG.draw.reveal), word, mask: word, used: [...s.used, word] });
}

/** The turn counts for nothing (its drawer left): the points it gave are taken back. */
export function voidTurn(s: DrawState): DrawState {
  const players = s.players.map((p) => ({ ...p, score: p.score - (s.points.find((q) => q.id === p.id)?.points ?? 0) }));
  return bump(s, { players, points: [] });
}

/** The final scores, for `CONFIG.draw.end` seconds. */
export function finish(s: DrawState): DrawState {
  return bump(s, { phase: 'end', left: ms(CONFIG.draw.end), queue: [] });
}

/** The next player in the queue draws, and their browser owns the game; with nobody left to draw, or fewer than two
 * players, the game ends. */
export function nextTurn(s: DrawState): DrawState {
  const here = new Set(herePlayers(s).map((p) => p.id));
  const queue = s.queue.filter((id) => here.has(id));
  if (here.size < 2 || !queue.length) return finish(s);
  const [drawer, ...rest] = queue;
  return bump(s, {
    owner: drawer, drawer, queue: rest, turn: s.turn + 1, phase: 'choosing', left: ms(CONFIG.draw.choose),
    mask: '', word: '', guessed: [], points: [], players: s.players.map((p) => (p.id === drawer ? { ...p, drew: true } : p)),
  });
}

/** A player joins: new, or back after leaving. Someone who hasn't drawn yet goes to the end of the queue. */
export function addPlayer(s: DrawState, id: string, name: string): DrawState {
  const p = s.players.find((q) => q.id === id);
  if (p?.here || (!p && s.players.length >= MAX_PLAYERS)) return s;
  const players = p ? s.players.map((q) => (q.id === id ? { ...q, here: true } : q)) : [...s.players, { id, name, score: 0, here: true, drew: false }];
  const queue = p?.drew || s.queue.includes(id) || s.drawer === id ? s.queue : [...s.queue, id];
  return bump(s, { players, queue });
}

/** A player leaves: out of the queue, their score stays on the board, "left" in the feed. */
export function removePlayer(s: DrawState, id: string): DrawState {
  if (!s.players.some((p) => p.id === id && p.here)) return s;
  return bump(s, {
    players: s.players.map((p) => (p.id === id ? { ...p, here: false } : p)),
    queue: s.queue.filter((q) => q !== id),
    feed: pushFeed(s.feed, { id, kind: 'left', text: '' }),
  });
}

/** Highest score first; ties share a place (1, 1, 3), in the order they came into the game. */
export function standings(players: readonly DrawPlayer[]): (DrawPlayer & { place: number })[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted.map((p) => ({ ...p, place: sorted.findIndex((q) => q.score === p.score) + 1 }));
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/draw-rules.test.ts`
Expected: PASS (14 tests).

Run: `cd web && npm test && npm run build`
Expected: 49 test files, 479 tests pass; the build is clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/config.ts web/src/draw-rules.ts web/tests/draw-rules.test.ts
git commit -m "TV draw and guess: the rules, turn by turn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: One game across browsers (`draw-game.ts`)

Mechanical: the code below is complete. This is the heart of the feature: read the class's doc comment and the tests' `party` helper first. Every input returns `DrawOut[]`, the messages to send; nothing here touches the network or the DOM.

**Files:**
- Create: `web/src/draw-game.ts`
- Test: `web/tests/draw-game.test.ts`

**Interfaces:**
- Consumes: Task 1 (`cleanGuess`, `judgeGuess`, `MAX_GUESS`, `pickChoices`), Task 2 (`isStroke`, `MAX_POINTS`, `MAX_STROKES`, `MAX_TOTAL`, `Sketch`, `Stroke`), Task 3 (the transitions and types, `FEED_KINDS`, `PHASES`, `MAX_PLAYERS`), `Arrival`, `byArrival`, `cleanName` from `./presence`, `CONFIG.draw`, `CONFIG.multiplayer.maxNameLength`.
- Produces:
  - `type DrawMessage` (the union in Global Constraints), `type DrawOut = { msg: DrawMessage; to?: string }`, `interface Visitor extends Arrival { name: string }`, `TAKEOVER = 1000`
  - `isDrawState(v: unknown): v is DrawState`, `isDrawMessage(v: unknown): v is DrawMessage`
  - `class DrawGame` — `constructor(selfId: () => string, newId: () => string, rand = Math.random)`; fields `state: DrawState | null`, `readonly sketch: Sketch`, `secret: string`, `choices: string[]`, `close: string | null`, `version: number`; getters `joined`, `running`, `canDraw`; methods `isJoined(id)`, `timeLeft(): number` (ms), `role(): 'drawer' | 'guesser' | null`, `playing(visitors: Visitor[]): Visitor[]` (joined, arrival order), `setJoined(on): DrawOut[]`, `start(visitors, now): DrawOut[]`, `choose(word, now): DrawOut[]`, `guess(text): DrawOut[]`, `penDown(c, w, x, y): void`, `penMove(x, y): void`, `undo(): DrawOut[]`, `clear(): DrawOut[]`, `greet(id): DrawOut[]`, `receive(m: DrawMessage, from: string, now): DrawOut[]`, `update(now, visitors: Visitor[]): DrawOut[]`. `now` is in ms (`performance.now()`).

- [ ] **Step 1: Write the failing tests**

Create `web/tests/draw-game.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shownCount } from '../src/draw-match';
import { type DrawMessage, type DrawOut, DrawGame, isDrawMessage, isDrawState, TAKEOVER, type Visitor } from '../src/draw-game';
import { type DrawState, newGame } from '../src/draw-rules';

/**
 * A few browsers in one room: each message is sent through JSON and checked as the network would, then handed to its
 * addressee (or everyone else here), whose answers go out in turn. `tick` runs every browser's frame.
 */
function party(...names: string[]) {
  let now = 1000;
  let games = 0;
  const browsers = names.map((name, i) => {
    const id = name.toLowerCase();
    return { id, name, arrived: i + 1, game: new DrawGame(() => id, () => `g${++games}`, () => 0) };
  });
  const here = new Set(browsers.map((b) => b.id));
  const log: { from: string; to: string; msg: DrawMessage }[] = [];
  const visitors = (): Visitor[] => browsers.filter((b) => here.has(b.id)).map((b) => ({ id: b.id, name: b.name, arrived: b.arrived, since: b.arrived }));
  const send = (from: string, outs: DrawOut[]) => {
    for (const o of outs) {
      const msg = JSON.parse(JSON.stringify(o.msg)) as unknown;
      expect(isDrawMessage(msg), JSON.stringify(msg)).toBe(true);
      for (const b of browsers) {
        if (b.id === from || !here.has(b.id) || (o.to && o.to !== b.id)) continue;
        log.push({ from, to: b.id, msg: msg as DrawMessage });
        send(b.id, b.game.receive(msg as DrawMessage, from, now));
      }
    }
  };
  const game = (id: string) => browsers.find((b) => b.id === id)!.game;
  return {
    log, visitors, send, game,
    get now() { return now; },
    /** Every browser's frame, `ms` later. */
    tick(ms = 0) {
      now += ms;
      for (const b of browsers) if (here.has(b.id)) send(b.id, b.game.update(now, visitors()));
    },
    join(...ids: string[]) {
      for (const id of ids) send(id, game(id).setJoined(true));
    },
    /** A tab closes: gone for everyone. */
    leave(id: string) {
      here.delete(id);
    },
    /** A visitor comes in: everyone already here greets them. */
    arrive(id: string) {
      here.add(id);
      for (const b of browsers) if (b.id !== id && here.has(b.id)) send(b.id, b.game.greet(id));
    },
  };
}

/** Ana, Rui and Zé (in that arrival order) all joined, Rui pressed Start, and Ana's browser has its three words. */
function started() {
  const p = party('Ana', 'Rui', 'Ze', 'Mia');
  p.leave('mia');
  p.join('ana', 'rui', 'ze');
  p.send('rui', p.game('rui').start(p.visitors(), p.now));
  p.tick();
  return p;
}

const scores = (s: DrawState | null) => Object.fromEntries((s?.players ?? []).map((p) => [p.id, p.score]));

describe('the lobby', () => {
  it("shares each visitor's Join, and starts only with two or more joined, from a player", () => {
    const p = party('Ana', 'Rui', 'Ze');
    p.join('ana');
    expect(p.game('ze').playing(p.visitors()).map((v) => v.id)).toEqual(['ana']);
    expect(p.game('ana').start(p.visitors(), p.now)).toEqual([]); // alone
    p.join('rui');
    expect(p.game('ze').start(p.visitors(), p.now)).toEqual([]); // Zé hasn't joined
    p.send('rui', p.game('rui').setJoined(false));
    expect(p.game('ana').playing(p.visitors()).map((v) => v.id)).toEqual(['ana']);
    p.join('rui');
    p.send('rui', p.game('rui').start(p.visitors(), p.now));
    for (const id of ['ana', 'rui', 'ze']) expect(p.game(id).state).toMatchObject({ id: 'g1', drawer: 'ana', owner: 'ana', phase: 'choosing', queue: ['rui'] });
    expect(p.game('ana').start(p.visitors(), p.now)).toEqual([]); // one game at a time
  });
});

describe('a game', () => {
  it('lets the drawer choose one of three words, which never leaves their browser before the reveal', () => {
    const p = started();
    expect(p.game('ana').choices).toEqual(['cat', 'dog', 'horse']);
    expect(p.game('rui').choices).toEqual([]);
    expect(p.game('ana').role()).toBe('drawer');
    expect(p.game('rui').role()).toBe('guesser');
    p.send('ana', p.game('ana').choose('rabbit', p.now)); // not offered
    expect(p.game('rui').state?.phase).toBe('choosing');
    p.send('ana', p.game('ana').choose('horse', p.now));
    expect(p.game('rui').state).toMatchObject({ phase: 'drawing', mask: '_____', word: '' });
    expect(p.game('ana').secret).toBe('horse');
    expect(JSON.stringify(p.log)).not.toContain('horse');
  });
  it('picks a word for a drawer who takes longer than 15 s', () => {
    const p = started();
    p.tick(14999);
    expect(p.game('rui').state?.phase).toBe('choosing');
    p.tick(1);
    expect(p.game('ana').secret).toBe('cat');
    expect(p.game('rui').state).toMatchObject({ phase: 'drawing', mask: '___' });
  });
  it('judges guesses at the owner: the feed for all, close for the guesser alone, points by the time left', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.tick(20000); // 60 s left
    p.send('rui', p.game('rui').guess('cat'));
    p.send('ze', p.game('ze').guess(' Hors '));
    expect(p.log.filter((l) => l.msg.k === 'guess').map((l) => l.to)).toEqual(['ana', 'ana']);
    expect(p.game('ze').close).toBe('Hors');
    expect(p.game('rui').close).toBeNull();
    expect(p.game('rui').state?.feed).toEqual([{ id: 'rui', kind: 'guess', text: 'cat' }, { id: 'ze', kind: 'guess', text: 'Hors' }]);
    p.send('rui', p.game('rui').guess('HORSE'));
    expect(scores(p.game('ze').state)).toEqual({ ana: 50, rui: 250, ze: 0 });
    expect(p.game('rui').guess('horse')).toEqual([]); // has it already
    expect(p.game('ana').guess('horse')).toEqual([]); // the drawer
    expect(p.game('ze').state?.feed.at(-1)).toEqual({ id: 'rui', kind: 'hit', text: '' });
  });
  it('ends the turn when everyone has it, shows the word for 5 s, then the next drawer owns the game', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.send('rui', p.game('rui').guess('horse'));
    p.send('ze', p.game('ze').guess('horse'));
    p.tick();
    expect(p.game('ze').state).toMatchObject({ phase: 'reveal', word: 'horse', mask: 'horse', points: [{ id: 'rui', points: 300 }, { id: 'ana', points: 100 }, { id: 'ze', points: 300 }] });
    p.tick(5000);
    for (const id of ['ana', 'rui', 'ze']) expect(p.game(id).state).toMatchObject({ phase: 'choosing', drawer: 'rui', owner: 'rui', turn: 2 });
    expect(p.game('ana').secret).toBe('');
    p.tick();
    expect(p.game('rui').choices).toEqual(['cat', 'dog', 'cow']); // horse is used
  });
  it('gives a letter at half time and another at three quarters', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.tick(39999);
    expect(shownCount(p.game('rui').state!.mask)).toBe(0);
    p.tick(1);
    expect(shownCount(p.game('rui').state!.mask)).toBe(1);
    p.tick(20000);
    expect(shownCount(p.game('rui').state!.mask)).toBe(2);
    p.tick(5000);
    expect(shownCount(p.game('rui').state!.mask)).toBe(2); // never more than half
  });
  it('plays every turn, shows the final scores for 15 s, then is over everywhere', () => {
    const p = started();
    for (let turn = 0; turn < 3; turn++) {
      p.tick(15000); // the word is picked
      p.tick(80000); // nobody guesses
      p.tick(5000); // the reveal
    }
    for (const id of ['ana', 'rui', 'ze']) expect(p.game(id).state).toMatchObject({ phase: 'end', used: ['cat', 'dog', 'horse'] });
    expect(p.game('rui').running).toBe(false);
    p.tick(15000);
    for (const id of ['ana', 'rui', 'ze']) expect(p.game(id).state).toBeNull();
  });
});

describe('the drawing', () => {
  it("reaches everyone in batches, with the drawer's undo and clear", () => {
    const p = started();
    const ana = p.game('ana');
    ana.penDown(0, 0, 100, 100);
    p.game('rui').penDown(0, 0, 500, 500); // not the drawer
    p.send('ana', ana.choose('horse', p.now));
    ana.penDown(2, 1, 100, 100);
    ana.penMove(200, 100);
    p.tick(50);
    ana.penMove(300, 100);
    ana.penDown(6, 0, 500, 500);
    p.tick(50);
    expect(p.game('rui').sketch.strokes).toEqual([{ c: 2, w: 1, p: [100, 100, 200, 100, 300, 100] }, { c: 6, w: 0, p: [500, 500] }]);
    expect(p.game('ze').sketch.strokes).toEqual(ana.sketch.strokes);
    p.send('ana', ana.undo());
    expect(p.game('ze').sketch.strokes).toHaveLength(1);
    p.send('ana', ana.clear());
    expect(p.game('ze').sketch.strokes).toEqual([]);
    expect(p.game('rui').undo()).toEqual([]);
  });
  it('starts afresh each turn', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.game('ana').penDown(0, 0, 1, 1);
    p.tick(80000);
    p.tick(5000);
    expect(p.game('rui').sketch.strokes).toEqual([]);
    expect(p.game('ana').sketch.strokes).toEqual([]);
  });
});

describe('joining and leaving', () => {
  it('gives a newcomer the game and the whole drawing, and lets them play straight away', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.game('ana').penDown(3, 0, 10, 10);
    p.game('ana').penMove(90, 10);
    p.arrive('mia');
    expect(p.game('mia').state).toMatchObject({ id: 'g1', phase: 'drawing' });
    expect(p.game('mia').sketch.strokes).toEqual([{ c: 3, w: 0, p: [10, 10, 90, 10] }]);
    expect(p.game('mia').playing(p.visitors()).map((v) => v.id)).toEqual(['ana', 'rui', 'ze']);
    p.tick(50); // the same points as a batch: nothing doubles
    expect(p.game('mia').sketch.strokes).toEqual([{ c: 3, w: 0, p: [10, 10, 90, 10] }]);
    p.join('mia');
    p.tick();
    expect(p.game('mia').state?.queue).toEqual(['rui', 'ze', 'mia']);
    p.send('mia', p.game('mia').guess('horse'));
    expect(scores(p.game('rui').state).mia).toBe(300);
  });
  it('takes a leaver out of the order, keeping their score, and ends with fewer than two', () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.send('rui', p.game('rui').guess('horse'));
    p.send('rui', p.game('rui').setJoined(false)); // Leave
    p.tick();
    expect(p.game('ze').state?.queue).toEqual(['ze']);
    expect(p.game('ze').state?.players.find((q) => q.id === 'rui')).toMatchObject({ here: false, score: 300 });
    expect(p.game('rui').role()).toBeNull();
    p.leave('ze'); // a tab closes
    p.tick();
    expect(p.game('rui').state).toMatchObject({ phase: 'end' });
    expect(p.game('ana').state).toMatchObject({ phase: 'end' });
  });
  it("ends the drawer's turn with no points when they press Leave, and the next drawer goes on", () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.send('rui', p.game('rui').guess('horse'));
    p.send('ana', p.game('ana').setJoined(false));
    p.tick();
    expect(p.game('ze').state).toMatchObject({ phase: 'choosing', drawer: 'rui', owner: 'rui', turn: 2 });
    expect(scores(p.game('ze').state)).toEqual({ ana: 0, rui: 0, ze: 0 });
  });
  it("lets the leader take over when the drawer's tab goes, and the next earliest when the leader goes too", () => {
    const p = started();
    p.send('ana', p.game('ana').choose('horse', p.now));
    p.send('ze', p.game('ze').guess('horse'));
    const seq = p.game('rui').state!.seq;
    p.leave('ana');
    p.tick();
    const s = p.game('ze').state!;
    expect(s).toMatchObject({ drawer: 'rui', owner: 'rui', phase: 'choosing', turn: 2 });
    expect(s.seq).toBeGreaterThan(seq + TAKEOVER);
    expect(scores(s)).toEqual({ ana: 0, rui: 0, ze: 0 });
    expect(s.feed.at(-1)).toEqual({ id: 'ana', kind: 'left', text: '' });
    p.leave('rui');
    p.tick();
    expect(p.game('ze').state).toMatchObject({ phase: 'end' }); // Zé alone: the game is over
  });
  it("drops a game nobody playing it is left to run, on an onlooker's TV", () => {
    const p = party('Ana', 'Rui', 'Ze');
    p.join('ana', 'rui');
    p.send('ana', p.game('ana').start(p.visitors(), p.now));
    expect(p.game('ze').state).not.toBeNull();
    p.leave('ana');
    p.leave('rui');
    p.tick();
    expect(p.game('ze').state).toBeNull();
  });
});

describe('accepting states', () => {
  const take = (g: DrawGame, s: DrawState, from = 'x') => g.receive({ k: 'state', s }, from, 0);
  it('takes a later state of the running game, and no older one', () => {
    const g = new DrawGame(() => 'ze', () => 'mine');
    const s = newGame('g5', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }]);
    take(g, { ...s, seq: 4 });
    take(g, { ...s, seq: 3, phase: 'drawing' });
    expect(g.state).toMatchObject({ seq: 4, phase: 'choosing' });
    take(g, { ...s, seq: 5, phase: 'drawing' });
    expect(g.state?.phase).toBe('drawing');
  });
  it('ignores another game while one runs, takes one after the end, and never one that is over', () => {
    const g = new DrawGame(() => 'ze', () => 'mine');
    const a = newGame('g5', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }]);
    take(g, { ...a, turn: 2 });
    take(g, newGame('g9', [{ id: 'rui', name: 'Rui' }, { id: 'ana', name: 'Ana' }]));
    expect(g.state?.id).toBe('g5');
    take(g, { ...a, turn: 2, seq: 9, phase: 'end' });
    take(g, newGame('g9', [{ id: 'rui', name: 'Rui' }, { id: 'ana', name: 'Ana' }]));
    expect(g.state?.id).toBe('g9');
    take(g, { ...a, seq: 99 });
    expect(g.state?.id).toBe('g9');
  });
  it('settles two Starts at once on the earlier game', () => {
    const g = new DrawGame(() => 'ze', () => 'mine');
    take(g, newGame('g7', [{ id: 'rui', name: 'Rui' }, { id: 'ana', name: 'Ana' }]));
    take(g, newGame('g6', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }]));
    expect(g.state?.id).toBe('g6');
    take(g, newGame('g7', [{ id: 'rui', name: 'Rui' }, { id: 'ana', name: 'Ana' }]));
    expect(g.state?.id).toBe('g6');
  });
  it("takes strokes only from this turn's drawer", () => {
    const g = new DrawGame(() => 'ze', () => 'mine');
    take(g, { ...newGame('g5', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }]), phase: 'drawing' });
    g.receive({ k: 'stroke', g: 'g5', t: 1, n: 0, at: 0, c: 0, w: 0, p: [1, 1] }, 'rui', 0);
    g.receive({ k: 'stroke', g: 'g5', t: 2, n: 0, at: 0, c: 0, w: 0, p: [1, 1] }, 'ana', 0);
    expect(g.sketch.strokes).toEqual([]);
    g.receive({ k: 'stroke', g: 'g5', t: 1, n: 0, at: 0, c: 0, w: 0, p: [1, 1] }, 'ana', 0);
    expect(g.sketch.strokes).toHaveLength(1);
  });
});

describe('draw messages', () => {
  const s = newGame('g1', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }]);
  it('takes well-formed messages', () => {
    expect(isDrawMessage({ k: 'join', on: true })).toBe(true);
    expect(isDrawMessage({ k: 'state', s })).toBe(true);
    expect(isDrawMessage({ k: 'guess', g: 'g1', t: 1, text: 'cat' })).toBe(true);
    expect(isDrawMessage({ k: 'stroke', g: 'g1', t: 1, n: 0, at: 4, c: 8, w: 1, p: [0, 1000] })).toBe(true);
    expect(isDrawMessage({ k: 'undo', g: 'g1', t: 1, n: 0 })).toBe(true);
    expect(isDrawMessage({ k: 'clear', g: 'g1', t: 1 })).toBe(true);
    expect(isDrawMessage({ k: 'sketch', g: 'g1', t: 1, strokes: [{ c: 0, w: 0, p: [1, 2] }] })).toBe(true);
  });
  it('drops junk and anything too big', () => {
    expect(isDrawMessage(null)).toBe(false);
    expect(isDrawMessage({ k: 'dance' })).toBe(false);
    expect(isDrawMessage({ k: 'join', on: 1 })).toBe(false);
    expect(isDrawMessage({ k: 'guess', g: 'g1', t: 1, text: 'x'.repeat(41) })).toBe(false);
    expect(isDrawMessage({ k: 'guess', g: 'g1', t: 1, text: '' })).toBe(false);
    expect(isDrawMessage({ k: 'stroke', g: 'g1', t: 1, n: 0, at: 1, c: 0, w: 0, p: [1, 1] })).toBe(false);
    expect(isDrawMessage({ k: 'stroke', g: 'g1', t: 1, n: 300, at: 0, c: 0, w: 0, p: [1, 1] })).toBe(false);
    expect(isDrawMessage({ k: 'sketch', g: 'g1', t: 1, strokes: [{ c: 0, w: 0, p: [] }] })).toBe(false);
    expect(isDrawState({ ...s, phase: 'dancing' })).toBe(false);
    expect(isDrawState({ ...s, word: 'Volcano' })).toBe(false);
    expect(isDrawState({ ...s, left: -1 })).toBe(false);
    expect(isDrawState({ ...s, players: [{ id: 'a', name: 'x'.repeat(25), score: 0, here: true, drew: false }] })).toBe(false);
    expect(isDrawState({ ...s, feed: Array.from({ length: 9 }, () => ({ id: 'a', kind: 'hit', text: '' })) })).toBe(false);
    expect(isDrawState({ ...s, queue: Array.from({ length: 33 }, (_, i) => `p${i}`) })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/draw-game.test.ts`
Expected: FAIL: `../src/draw-game` cannot be resolved.

- [ ] **Step 3: Implement**

Create `web/src/draw-game.ts`:

```ts
import { CONFIG } from './config';
import { cleanGuess, judgeGuess, MAX_GUESS } from './draw-match';
import {
  addPlayer, allGuessed, beginDrawing, type DrawPlayer, type DrawState, endTurn, FEED_KINDS, type FeedLine, finish,
  giveHint, herePlayers, MAX_PLAYERS, newGame, nextTurn, PHASES, removePlayer, rightGuess, type TurnPoints, voidTurn,
  wrongGuess,
} from './draw-rules';
import { isStroke, MAX_POINTS, MAX_STROKES, MAX_TOTAL, Sketch, type Stroke } from './draw-sketch';
import { pickChoices } from './draw-words';
import { type Arrival, byArrival, cleanName } from './presence';

/**
 * What a `draw` message carries: a visitor's Join flag; the owner's state; a guess (to the owner only) and its
 * "close!" (to the guesser only); the drawer's strokes, undo, clear, and the whole drawing for a newcomer. `g` and
 * `t` name the game and its turn. Types, not interfaces, so they can be sent as JSON.
 */
export type DrawMessage =
  | { k: 'join'; on: boolean }
  | { k: 'state'; s: DrawState }
  | { k: 'guess'; g: string; t: number; text: string }
  | { k: 'close'; g: string; t: number; text: string }
  | { k: 'stroke'; g: string; t: number; n: number; at: number; c: number; w: number; p: number[] }
  | { k: 'undo'; g: string; t: number; n: number }
  | { k: 'clear'; g: string; t: number }
  | { k: 'sketch'; g: string; t: number; strokes: Stroke[] };

/** A message to send: to everyone, or to one visitor. */
export type DrawOut = { msg: DrawMessage; to?: string };

/** A visitor here (this one included): their name and when they arrived, which orders the players. */
export interface Visitor extends Arrival { name: string }

/** A game's turns are at most this many (every player draws once). */
const MAX_TURNS = MAX_PLAYERS * 2;
/** A takeover jumps the sequence by this much, so a late state from the owner it replaced (a hidden tab still
 * answering) never wins. */
export const TAKEOVER = 1000;

const isText = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isCount = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const isList = (v: unknown, max: number, item: (x: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.length <= max && v.every(item);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isPlayer = (v: unknown) => {
  const p = v as DrawPlayer;
  return isObject(v) && isText(p.id) && typeof p.name === 'string' && p.name.length <= CONFIG.multiplayer.maxNameLength
    && isCount(p.score, 1e6) && typeof p.here === 'boolean' && typeof p.drew === 'boolean';
};
const isLine = (v: unknown) => {
  const l = v as FeedLine;
  return isObject(v) && isText(l.id) && FEED_KINDS.includes(l.kind) && typeof l.text === 'string' && l.text.length <= MAX_GUESS;
};
const isPoints = (v: unknown) => isObject(v) && isText((v as TurnPoints).id) && isCount((v as TurnPoints).points, 1e6);
const isWord = (v: unknown) => typeof v === 'string' && /^[a-z ]{1,32}$/.test(v);
const longest = Math.round(1000 * Math.max(CONFIG.draw.choose, CONFIG.draw.drawing, CONFIG.draw.reveal, CONFIG.draw.end));

/** A well-formed game state, every list bounded. */
export function isDrawState(v: unknown): v is DrawState {
  if (!isObject(v)) return false;
  const s = v as DrawState;
  return isText(s.id) && isCount(s.seq, 1e9) && isText(s.owner) && isText(s.drawer)
    && isList(s.players, MAX_PLAYERS, isPlayer) && isList(s.queue, MAX_PLAYERS, (x) => isText(x))
    && isCount(s.turn, MAX_TURNS) && s.turn >= 1 && PHASES.includes(s.phase)
    && typeof s.left === 'number' && Number.isFinite(s.left) && s.left >= 0 && s.left <= longest
    && typeof s.mask === 'string' && /^[a-z _]{0,32}$/.test(s.mask) && typeof s.word === 'string' && /^[a-z ]{0,32}$/.test(s.word)
    && isList(s.guessed, MAX_PLAYERS, (x) => isText(x)) && isList(s.points, MAX_PLAYERS, isPoints)
    && isList(s.used, MAX_TURNS, isWord) && isList(s.feed, CONFIG.draw.feed, isLine);
}

/** A well-formed `draw` message; anything else is dropped. */
export function isDrawMessage(v: unknown): v is DrawMessage {
  if (!isObject(v)) return false;
  const m = v as Record<string, unknown>;
  if (m.k === 'join') return typeof m.on === 'boolean';
  if (m.k === 'state') return isDrawState(m.s);
  if (!isText(m.g) || !isCount(m.t, MAX_TURNS)) return false;
  switch (m.k) {
    case 'guess':
    case 'close': return isText(m.text, MAX_GUESS);
    case 'stroke': return isCount(m.n, MAX_STROKES - 1) && isCount(m.at, MAX_POINTS * 2) && (m.at as number) % 2 === 0 && isStroke({ c: m.c, w: m.w, p: m.p });
    case 'undo': return isCount(m.n, MAX_STROKES);
    case 'clear': return true;
    case 'sketch': return isList(m.strokes, MAX_STROKES, isStroke) && (m.strokes as Stroke[]).reduce((a, s) => a + s.p.length, 0) <= MAX_TOTAL * 2;
    default: return false;
  }
}

/**
 * Draw and guess as this browser sees it: who said they play (the lobby), the game (`state`), the turn's drawing, and,
 * in the drawer's browser, the secret word. The game is owned by one browser at a time, the drawer's: it runs the
 * clock, gives the hints, judges the guesses, takes in players who join and leave, and sends the state on every
 * change; at the turn's end it sends the state with the next drawer as owner. When the owner is gone, the game's
 * leader (the earliest-arrived player still here) ends that turn with no points and passes the turn on. Everyone
 * else shows what they are sent. `now` is in ms, and times travel as the time left, so clocks needn't agree.
 */
export class DrawGame {
  /** The game shown here: running, or its final scores; null when there is none. */
  state: DrawState | null = null;
  /** The turn's drawing. */
  readonly sketch = new Sketch();
  /** The word, in the drawer's browser only, and the words it may choose from while choosing. */
  secret = '';
  choices: string[] = [];
  /** "close!" for this visitor's last guess this turn (the guess). */
  close: string | null = null;
  /** Goes up whenever the lobby or the game changes, for the panel. */
  version = 0;
  /** This visitor's own Join flag, and the others' who have said they play. */
  private mine = false;
  private others = new Set<string>();
  private deadline = 0;
  private now = 0;
  /** Games shown here that are over, so a late copy never comes back. */
  private finished = new Set<string>();
  /** Where the drawer's next batch of points starts, and when the last went. */
  private cursor = { n: 0, at: 0 };
  private flushed = -Infinity;

  constructor(private selfId: () => string, private newId: () => string, private rand: () => number = Math.random) {}

  /** This visitor has pressed Join. */
  get joined(): boolean {
    return this.mine;
  }

  isJoined(id: string): boolean {
    return id === this.selfId() ? this.mine : this.others.has(id);
  }

  /** A game is being played (not just its final scores showing). */
  get running(): boolean {
    return !!this.state && this.state.phase !== 'end';
  }

  /** Milliseconds left in the phase. */
  timeLeft(): number {
    return this.state ? Math.max(0, this.deadline - this.now) : 0;
  }

  /** This visitor in the game: drawing this turn, guessing, or null when not playing. */
  role(): 'drawer' | 'guesser' | null {
    const s = this.state;
    const me = this.selfId();
    if (!s || s.phase === 'end' || !s.players.some((p) => p.id === me && p.here)) return null;
    return s.drawer === me ? 'drawer' : 'guesser';
  }

  /** The visitors who have pressed Join, in arrival order. */
  playing(visitors: Visitor[]): Visitor[] {
    return visitors.filter((v) => this.isJoined(v.id)).sort(byArrival);
  }

  /** Join or Leave: this visitor's flag, sent to everyone. */
  setJoined(on: boolean): DrawOut[] {
    if (on === this.mine) return [];
    this.mine = on;
    this.version++;
    return [{ msg: { k: 'join', on } }];
  }

  /** Start: with two or more joined (this visitor among them) and no game running, a new game in arrival order. */
  start(visitors: Visitor[], now: number): DrawOut[] {
    this.now = now;
    const players = this.playing(visitors);
    if (this.running || !this.mine || players.length < 2) return [];
    this.set(newGame(this.newId(), players.map((v) => ({ id: v.id, name: cleanName(v.name) }))), now);
    return [this.stateOut()];
  }

  /** The drawer picks one of the three words. */
  choose(word: string, now: number): DrawOut[] {
    this.now = now;
    const s = this.state;
    if (!s || s.owner !== this.selfId() || s.phase !== 'choosing' || !this.choices.includes(word)) return [];
    this.secret = word;
    this.choices = [];
    this.set(beginDrawing(s, word), now);
    return [this.stateOut()];
  }

  /** A guess, sent to the owner alone; it can't be this visitor's own drawing, or a word they already have. */
  guess(text: string): DrawOut[] {
    const s = this.state;
    const me = this.selfId();
    const clean = cleanGuess(text);
    if (!clean || this.role() !== 'guesser' || s!.phase !== 'drawing' || s!.guessed.includes(me)) return [];
    this.close = null;
    return [{ msg: { k: 'guess', g: s!.id, t: s!.turn, text: clean }, to: s!.owner }];
  }

  /** The drawer can draw: their turn's drawing time, in their own browser. */
  get canDraw(): boolean {
    const s = this.state;
    return !!s && s.phase === 'drawing' && s.owner === this.selfId() && s.drawer === this.selfId();
  }

  /** The drawer's pen, in grid units: down starts a stroke, move adds to it. Sent in batches by `update`. */
  penDown(c: number, w: number, x: number, y: number): void {
    if (this.canDraw) this.sketch.begin(c, w, x, y);
  }

  penMove(x: number, y: number): void {
    if (this.canDraw) this.sketch.extend(x, y);
  }

  undo(): DrawOut[] {
    const s = this.state;
    if (!s || !this.canDraw || !this.sketch.undo()) return [];
    const n = this.sketch.strokes.length;
    if (this.cursor.n >= n) this.cursor = { n, at: 0 };
    return [{ msg: { k: 'undo', g: s.id, t: s.turn, n } }];
  }

  clear(): DrawOut[] {
    const s = this.state;
    if (!s || !this.canDraw || !this.sketch.strokes.length) return [];
    this.sketch.clear();
    this.cursor = { n: 0, at: 0 };
    return [{ msg: { k: 'clear', g: s.id, t: s.turn } }];
  }

  /** What a newcomer (or a visitor back after a timeout) needs from here: this visitor's Join, and from the owner the
   * game and the whole drawing. */
  greet(id: string): DrawOut[] {
    const out: DrawOut[] = this.mine ? [{ msg: { k: 'join', on: true }, to: id }] : [];
    const s = this.state;
    if (!s || s.owner !== this.selfId()) return out;
    out.push({ ...this.stateOut(), to: id });
    const strokes = this.sketch.strokes.map((st) => ({ c: st.c, w: st.w, p: [...st.p] }));
    if (strokes.length) out.push({ msg: { k: 'sketch', g: s.id, t: s.turn, strokes }, to: id });
    return out;
  }

  /** A message from visitor `from`. Returns what to send back. */
  receive(m: DrawMessage, from: string, now: number): DrawOut[] {
    this.now = now;
    const s = this.state;
    switch (m.k) {
      case 'join':
        if (m.on) this.others.add(from);
        else this.others.delete(from);
        this.version++;
        return [];
      case 'state':
        this.accept(m.s, now);
        return [];
      case 'guess':
        return this.judge(from, m.g, m.t, m.text, now);
      case 'close':
        if (s && m.g === s.id && m.t === s.turn && from === s.owner) {
          this.close = m.text;
          this.version++;
        }
        return [];
      default:
        if (!s || m.g !== s.id || m.t !== s.turn || from !== s.drawer || from === this.selfId()) return [];
        if (m.k === 'stroke') this.sketch.add(m.n, m.at, m.c, m.w, m.p);
        else if (m.k === 'undo') this.sketch.truncate(m.n);
        else if (m.k === 'clear') this.sketch.clear();
        else this.sketch.replace(m.strokes);
        return [];
    }
  }

  /** Every frame, with everyone here (this visitor included). The owner runs the game; the leader takes over from an
   * owner who has gone; everyone drops the final scores when their time is up. Returns what to send. */
  update(now: number, visitors: Visitor[]): DrawOut[] {
    this.now = now;
    const present = new Set(visitors.map((v) => v.id));
    for (const id of this.others) {
      if (present.has(id)) continue;
      this.others.delete(id);
      this.version++;
    }
    const s = this.state;
    if (!s) return [];
    if (s.phase === 'end') {
      if (now >= this.deadline) this.drop();
      return [];
    }
    const me = this.selfId();
    if (s.owner === me) return this.own(now, visitors);
    if (present.has(s.owner)) return [];
    const leader = this.leader(visitors);
    if (leader === me) return this.takeOver(now);
    if (leader === null) this.drop(); // no player of the game is left here
    return [];
  }

  /** The owner's step: players in and out, the clock, the hints, the end of the turn, and the drawer's points. */
  private own(now: number, visitors: Visitor[]): DrawOut[] {
    const me = this.selfId();
    const out = this.flush(now);
    const before = this.state!;
    let s = before;
    const playing = this.playing(visitors);
    for (const v of playing) s = addPlayer(s, v.id, cleanName(v.name));
    const ids = new Set(playing.map((v) => v.id));
    for (const p of s.players) {
      if (!p.here || ids.has(p.id)) continue;
      if (p.id === s.drawer && (s.phase === 'choosing' || s.phase === 'drawing')) s = voidTurn(s);
      s = removePlayer(s, p.id);
    }
    if (herePlayers(s).length < 2) s = finish(s);
    else if (!ids.has(s.drawer)) s = nextTurn(s); // the drawer, this visitor, left
    if (s.owner === me && s.phase === 'choosing') {
      if (!this.choices.length && !this.secret) this.choices = pickChoices(this.rand, s.used, CONFIG.draw.choices);
      if (now >= this.deadline && this.choices.length) {
        this.secret = this.choices[Math.min(this.choices.length - 1, Math.floor(this.rand() * this.choices.length))];
        this.choices = [];
        s = beginDrawing(s, this.secret);
      }
    } else if (s.owner === me && s.phase === 'drawing') {
      if (!this.secret) s = nextTurn(voidTurn(s)); // the word is lost: no turn to play
      else {
        s = giveHint(s, this.secret, 1 - this.timeLeft() / (CONFIG.draw.drawing * 1000), this.rand);
        if (allGuessed(s) || now >= this.deadline) s = endTurn(s, this.secret);
      }
    } else if (s.owner === me && s.phase === 'reveal' && now >= this.deadline) s = nextTurn(s);
    if (s !== before) {
      this.set(s, now);
      out.push(this.stateOut());
    }
    return out;
  }

  /** The owner has gone: the leader ends the turn with no points and passes it on (or ends the game). */
  private takeOver(now: number): DrawOut[] {
    let s = this.state!;
    if (s.phase === 'choosing' || s.phase === 'drawing') s = voidTurn(s);
    s = removePlayer(s, s.owner);
    s = { ...s, owner: this.selfId(), seq: s.seq + TAKEOVER };
    s = herePlayers(s).length < 2 ? finish(s) : nextTurn(s);
    this.set(s, now);
    return [this.stateOut()];
  }

  /** The earliest-arrived player still here, other than the owner; null when there is none. */
  private leader(visitors: Visitor[]): string | null {
    const s = this.state!;
    const byId = new Map(visitors.map((v) => [v.id, v]));
    const here = s.players.filter((p) => p.here && p.id !== s.owner && byId.has(p.id)).map((p) => byId.get(p.id)!);
    return here.sort(byArrival)[0]?.id ?? null;
  }

  /** The owner judges a guess: "guessed it!" or the feed for everyone, and "close!" to the guesser alone. */
  private judge(from: string, g: string, t: number, text: string, now: number): DrawOut[] {
    const s = this.state;
    if (!s || s.owner !== this.selfId() || s.phase !== 'drawing' || g !== s.id || t !== s.turn || !this.secret) return [];
    if (from === s.drawer || s.guessed.includes(from) || !s.players.some((p) => p.id === from && p.here)) return [];
    const clean = cleanGuess(text);
    if (!clean) return [];
    const verdict = judgeGuess(clean, this.secret);
    this.set(verdict === 'right' ? rightGuess(s, from, this.timeLeft()) : wrongGuess(s, from, clean), now);
    const out = [this.stateOut()];
    if (verdict === 'close') out.push({ msg: { k: 'close', g: s.id, t: s.turn, text: clean }, to: from });
    return out;
  }

  /** The drawer's points since the last batch, every `strokeEvery` seconds. */
  private flush(now: number): DrawOut[] {
    const s = this.state!;
    if (!this.canDraw || now - this.flushed < CONFIG.draw.strokeEvery * 1000) return [];
    this.flushed = now;
    const { parts, next } = this.sketch.since(this.cursor);
    this.cursor = next;
    return parts.map((p) => ({ msg: { k: 'stroke', g: s.id, t: s.turn, ...p } }));
  }

  /** A state from another visitor: the running game's with a higher number, or another game when none runs (a Start,
   * or a newcomer's first), or when both are in their first turn and it was started earlier (two Starts at once). */
  private accept(next: DrawState, now: number): void {
    const cur = this.state;
    if (this.finished.has(next.id)) return;
    const ok = !cur || (cur.id === next.id ? next.seq > cur.seq : cur.phase === 'end' || (cur.turn === 1 && next.turn === 1 && next.id < cur.id));
    if (!ok) return;
    this.set(next, now, true);
  }

  /** Puts a state here. A new turn (or game) starts a new drawing; the deadline follows the state's time left when it
   * came from elsewhere, or when the phase changed. */
  private set(next: DrawState, now: number, sent = false): void {
    const cur = this.state;
    const newTurn = !cur || cur.id !== next.id || cur.turn !== next.turn;
    if (newTurn) {
      if (cur && cur.id !== next.id) this.finished.add(cur.id);
      this.sketch.clear();
      this.cursor = { n: 0, at: 0 };
      this.secret = '';
      this.choices = [];
      this.close = null;
    }
    if (sent || newTurn || cur!.phase !== next.phase) this.deadline = now + next.left;
    this.state = next;
    this.version++;
  }

  /** The game is over here. */
  private drop(): void {
    this.finished.add(this.state!.id);
    this.state = null;
    this.sketch.clear();
    this.secret = '';
    this.choices = [];
    this.close = null;
    this.version++;
  }

  /** The state to send, with the time left now. */
  private stateOut(): DrawOut {
    return { msg: { k: 'state', s: { ...this.state!, left: Math.round(this.timeLeft()) } } };
  }
}
```

Notes for the implementer:
- `set(next, now, sent)` is the one place a state lands. A new turn (or game) clears the drawing, the secret, the choices and "close!"; the deadline is reset from `left` when the state came from elsewhere, or when the phase or turn changed here. Within a phase, local changes (a guess, a hint, a joiner) keep the deadline: their `left` is stale by design, and `stateOut` always sends the time left now.
- The owner's `own` step flushes the drawer's points first, so the last batch of a turn goes out before the reveal.
- In the tests, `rand` is `() => 0`, so the drawer is offered the first three unused words of `DRAW_WORDS` (`cat`, `dog`, `horse`, then `cow` once `horse` is used) and the auto-pick takes the first.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/draw-game.test.ts`
Expected: PASS (20 tests).

Run: `cd web && npm test && npm run build`
Expected: 50 test files, 499 tests pass; the build is clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/draw-game.ts web/tests/draw-game.test.ts
git commit -m "TV draw and guess: one game across browsers, its owner and its leader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The game on the TV (`draw-tv.ts`, `TvContent`, `Screen`, the TV's prompt)

Mechanical: the code below is complete. The TV keeps its 512 × 288 canvas; a game is drawn on it in place of the channel, and the picture's mean colour (which tints and scales the TV's baked light) comes from the game's layout.

**Files:**
- Create: `web/src/draw-tv.ts`
- Modify: `web/src/screen-content.ts` (`TvContent`: a game mode)
- Modify: `web/src/screens.ts` (`Screen`: `lit`, `power`, `nextChannel`, `setGame`)
- Modify: `web/src/interactions.ts` (the TV's prompt; a click on it changes nothing)
- Test: create `web/tests/draw-tv.test.ts`; extend `web/tests/screen-content.test.ts`, `web/tests/screens.test.ts`, `web/tests/interactions.test.ts`

**Interfaces:**
- Consumes: `spaced` (Task 1), `paintSketch`, `Stroke` (Task 2), `DrawPhase`, `DrawState`, `standings` (Task 3).
- Produces:
  - `draw-tv.ts`: `type TvRow = { name; score; place; drawer: boolean; guessed: boolean; here: boolean }`; `interface DrawTv { phase; drawer: string; hint: string; word: string; seconds: number; rows: TvRow[]; gains: { name; points }[]; strokes: readonly Stroke[] }`; `tvView(s: DrawState, strokes: readonly Stroke[], leftMs: number): DrawTv`; `turnGains(s: DrawState): { name; points }[]` (the turn's points, most first); `gainsText(gains, gap = '   '): string` (`"Rui +300   Ana +100"`, or `"Nobody got it"`); `clock(seconds): string` (`"1:20"`); `clip(text, max): string`; `TV_CARD`; `PENCIL`, `TICK` (each followed by a space); `drawGameTv(ctx, v: DrawTv): void`; `gameMean(v: DrawTv): [number, number, number]` (sRGB).
  - `TvContent.setGame(view: DrawTv | null): void`.
  - `Screen.lit: boolean` (on, or showing a game), `Screen.power(t: number): void` (the remote's On/Off), `Screen.nextChannel(): void` (round to the first after the last; nothing while off), `Screen.setGame(view: DrawTv | null, t: number): void` (the TV only).
  - `promptFor` gives `Click: TV` / `Tap: TV` for the TV; `activate` leaves the TV alone (main.ts opens the panel).

- [ ] **Step 1: Write the failing tests**

Create `web/tests/draw-tv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { beginDrawing, endTurn, finish, newGame, rightGuess } from '../src/draw-rules';
import { clip, clock, drawGameTv, type DrawTv, gainsText, gameMean, PENCIL, TICK, tvView } from '../src/draw-tv';

/** A 2D context that records the text drawn. */
function recorder() {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'measureText') return () => ({ width: 50 });
      return (...args: unknown[]) => void (prop === 'fillText' && texts.push(String(args[0])));
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

const PLAYERS = [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }, { id: 'ze', name: 'Zé' }];

describe("the TV's view of a game", () => {
  it('shows the blanks spaced, the time in whole seconds, and the players by score', () => {
    const s = rightGuess(beginDrawing(newGame('g1', PLAYERS), 'ice cream'), 'ze', 80000);
    const v = tvView(s, [{ c: 0, w: 0, p: [1, 1] }], 41200);
    expect(v).toMatchObject({ phase: 'drawing', drawer: 'Ana', hint: '_ _ _   _ _ _ _ _', seconds: 42 });
    expect(v.rows.map((r) => [r.name, r.score, r.place, r.drawer, r.guessed])).toEqual([
      ['Zé', 300, 1, false, true], ['Ana', 50, 2, true, false], ['Rui', 0, 3, false, false],
    ]);
    expect(v.strokes).toHaveLength(1);
  });
  it("shows the word and the turn's points at the reveal, and no drawer at the end", () => {
    const s = endTurn(rightGuess(rightGuess(beginDrawing(newGame('g1', PLAYERS), 'cat'), 'rui', 40000), 'ze', 80000), 'cat');
    expect(tvView(s, [], 5000)).toMatchObject({
      phase: 'reveal', hint: 'cat', word: 'cat', gains: [{ name: 'Zé', points: 300 }, { name: 'Rui', points: 200 }, { name: 'Ana', points: 100 }],
    });
    expect(tvView(finish(s), [], 0).rows.every((r) => !r.drawer)).toBe(true);
    expect(tvView(finish(s), [], 0).gains).toEqual([]);
    expect(gainsText([{ name: 'Zé', points: 300 }, { name: 'Ana', points: 50 }])).toBe('Zé +300   Ana +50');
    expect(gainsText([])).toBe('Nobody got it');
  });
  it('writes the time and cuts long names', () => {
    expect(clock(80)).toBe('1:20');
    expect(clock(9)).toBe('0:09');
    expect(clock(-1)).toBe('0:00');
    expect(clip('Maximiliano', 8)).toBe('Maximil…');
    expect(clip('Ana', 8)).toBe('Ana');
  });
});

describe('the game on the TV', () => {
  const view = (over: Partial<DrawTv>): DrawTv => ({
    phase: 'drawing', drawer: 'Ana', hint: '_ _ _', word: '', seconds: 61, strokes: [], gains: [],
    rows: [{ name: 'Ana', score: 50, place: 1, drawer: true, guessed: false, here: true }, { name: 'Rui', score: 0, place: 2, drawer: false, guessed: true, here: true }],
    ...over,
  });
  it('shows who is choosing', () => {
    const { ctx, texts } = recorder();
    drawGameTv(ctx, view({ phase: 'choosing', seconds: 15 }));
    expect(texts).toContain('Ana is choosing a word');
    expect(texts).toContain('0:15');
    expect(texts).not.toContain('_ _ _');
  });
  it('shows the time, the blanks, and the scores with the pencil and the tick', () => {
    const { ctx, texts } = recorder();
    drawGameTv(ctx, view({}));
    expect(texts).toEqual(expect.arrayContaining(['1:01', '_ _ _', `${PENCIL}Ana`, '50', `${TICK}Rui`, '0']));
  });
  it("shows the word at the reveal, with the turn's points", () => {
    const { ctx, texts } = recorder();
    drawGameTv(ctx, view({ phase: 'reveal', hint: 'cat', word: 'cat', gains: [{ name: 'Rui', points: 280 }, { name: 'Ana', points: 50 }] }));
    expect(texts).toEqual(expect.arrayContaining(['The word was', 'cat', 'Rui +280   Ana +50']));
  });
  it('shows the final scores big, ties sharing a place', () => {
    const { ctx, texts } = recorder();
    drawGameTv(ctx, view({
      phase: 'end',
      rows: [
        { name: 'Ana', score: 300, place: 1, drawer: false, guessed: false, here: true },
        { name: 'Rui', score: 300, place: 1, drawer: false, guessed: false, here: false },
        { name: 'Zé', score: 0, place: 3, drawer: false, guessed: false, here: true },
      ],
    }));
    expect(texts).toEqual(['Final scores', '1.', '300', 'Ana', '1.', '300', 'Rui', '3.', '0', 'Zé']);
  });
  it('lights the room bright and neutral: mostly the white card', () => {
    const [r, , b] = gameMean(view({}));
    expect(r).toBeGreaterThan(0.6);
    expect(Math.abs(r - b)).toBeLessThan(0.05);
    expect(gameMean(view({ phase: 'end' }))[0]).toBeGreaterThan(r);
  });
});
```

In `web/tests/screen-content.test.ts`, replace the import block at the top:

```ts
import {
  clockText, dateText, dateTimeText, DesktopContent, type ScreenWorld, type Surface, TV_CHANNELS, TvContent,
} from '../src/screen-content';
```

with:

```ts
import type { DrawTv } from '../src/draw-tv';
import {
  clockText, dateText, dateTimeText, DesktopContent, type ScreenWorld, type Surface, TV_CHANNELS, TvContent,
} from '../src/screen-content';
```

and insert, just before `  it('is harmless without a 2D context', () => {` in the `TvContent` block (the first of the two tests with that name):

```ts
  it('shows a game instead of the channel, lit like its white card, then the channel again with its badge', () => {
    const r = recorder();
    const tv = new TvContent(r.surface);
    tv.draw(10, EVENING);
    const game: DrawTv = {
      phase: 'choosing', drawer: 'Ana', hint: '', word: '', seconds: 15, strokes: [], gains: [],
      rows: [{ name: 'Ana', score: 0, place: 1, drawer: true, guessed: false, here: true }],
    };
    tv.setGame(game);
    r.clear();
    tv.draw(11, EVENING);
    expect(r.texts()).toContain('Ana is choosing a word');
    expect(r.texts()).not.toContain(TV_CHANNELS[0].name);
    expect(tv.average()[0]).toBeGreaterThan(0.3);
    tv.setGame(null);
    r.clear();
    tv.draw(12, EVENING);
    expect(r.texts()).toContain(TV_CHANNELS[0].name);
  });

```

In `web/tests/screens.test.ts`, replace `import { TV_CHANNELS } from '../src/screen-content';` with:

```ts
import type { DrawTv } from '../src/draw-tv';
import { TV_CHANNELS } from '../src/screen-content';
```

and insert, just before `  it('starts dark and white-tinted, for its baked light', () => {`:

```ts
  it('turns the TV on and off from the remote, and steps its channels round', () => {
    const { s } = screen('tv');
    s.nextChannel(); // off: nothing
    expect(s.on).toBe(false);
    s.power(0);
    expect([s.on, s.channel]).toEqual([true, 0]);
    for (let i = 1; i < TV_CHANNELS.length; i++) s.nextChannel();
    expect(s.channel).toBe(TV_CHANNELS.length - 1);
    s.nextChannel();
    expect([s.on, s.channel]).toEqual([true, 0]); // round to the first, still on
    s.power(1);
    expect(s.on).toBe(false);
  });

  it('shows a game on the TV even while it is off, and goes dark again after', () => {
    const { s, mesh } = screen('tv');
    const off = mesh.material;
    const game: DrawTv = { phase: 'choosing', drawer: 'Ana', hint: '', word: '', seconds: 15, strokes: [], rows: [], gains: [] };
    s.setGame(game, 0);
    expect([s.on, s.lit]).toEqual([false, true]);
    s.update(0, 1, world, false);
    expect(s.level).toBe(1);
    expect(mesh.material).not.toBe(off);
    s.setGame(null, 1);
    s.update(1, 1, world, false);
    expect(s.lit).toBe(false);
    expect(mesh.material).toBe(off);
    const monitor = screen('monitor').s;
    monitor.setGame(game, 0);
    expect(monitor.lit).toBe(false); // games are the TV's
  });

```

In `web/tests/interactions.test.ts`, replace `import type { MovableInfo } from '../src/manifest';` with:

```ts
import type { MovableInfo, ScreenInfo } from '../src/manifest';
import { Screen } from '../src/screens';
```

and insert, just before `  it('prompts and activates switches', () => {`:

```ts
  it('prompts the TV for its panel and leaves it as it is; a monitor still switches on and off', () => {
    const lights = new LightGroups([]);
    const stub = (width: number, height: number) => ({ width, height, getContext: () => null });
    const info = (kind: ScreenInfo['kind']): ScreenInfo => ({ node: `Screen_${kind}`, room: 'sala', kind, group: null, center: [0, 1, 0], normal: [0, 0, 1], width: 1, height: 0.5 });
    const tv = new Screen(info('tv'), new Object3D(), stub);
    const t: Target = { kind: 'screen', screen: tv, node: new Object3D() };
    expect(promptFor(t, lights)).toBe('Click: TV');
    expect(promptFor(t, lights, 'Tap')).toBe('Tap: TV');
    activate(t, lights);
    expect(tv.on).toBe(false);
    const monitor = new Screen(info('monitor'), new Object3D(), stub);
    const m: Target = { kind: 'screen', screen: monitor, node: new Object3D() };
    expect(promptFor(m, lights)).toBe('Click: turn screen on');
    activate(m, lights);
    expect(promptFor(m, lights)).toBe('Click: turn screen off');
  });

```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/draw-tv.test.ts tests/screen-content.test.ts tests/screens.test.ts tests/interactions.test.ts`
Expected: FAIL: `../src/draw-tv` cannot be resolved (`draw-tv.test.ts`); `tv.setGame is not a function` (`screen-content.test.ts`); `s.nextChannel is not a function` and `s.setGame is not a function` (`screens.test.ts`); the TV's prompt is still `Click: turn TV on` (`interactions.test.ts`). The `DrawTv` imports in the other test files are type-only, so Vitest erases them.

- [ ] **Step 3: The game on the TV's canvas**

Create `web/src/draw-tv.ts`:

```ts
import { spaced } from './draw-match';
import { type DrawPhase, type DrawState, standings } from './draw-rules';
import { paintSketch, type Stroke } from './draw-sketch';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Rgb = [number, number, number];

/** A player's line on the board: in score order, the drawer marked with a pencil, a tick on those who have the word. */
export type TvRow = { name: string; score: number; place: number; drawer: boolean; guessed: boolean; here: boolean };

/** What the TV (and the panels) show of a game. */
export interface DrawTv {
  phase: DrawPhase;
  /** The drawer's name. */
  drawer: string;
  /** The blanks, spaced to read ("_ _ _   _ _ _ _"); the word at the reveal. */
  hint: string;
  word: string;
  /** Whole seconds left in the phase. */
  seconds: number;
  rows: TvRow[];
  /** At the reveal: the points the turn gave, most first. */
  gains: { name: string; points: number }[];
  strokes: readonly Stroke[];
}

/** The TV's view of a game: `leftMs` is the time left here. */
export function tvView(s: DrawState, strokes: readonly Stroke[], leftMs: number): DrawTv {
  return {
    phase: s.phase,
    drawer: s.players.find((p) => p.id === s.drawer)?.name ?? '',
    hint: s.phase === 'reveal' ? s.word : spaced(s.mask),
    word: s.word,
    seconds: Math.ceil(leftMs / 1000),
    rows: standings(s.players).map((p) => ({
      name: p.name, score: p.score, place: p.place, drawer: p.id === s.drawer && s.phase !== 'end', guessed: s.guessed.includes(p.id), here: p.here,
    })),
    gains: s.phase === 'reveal' ? turnGains(s) : [],
    strokes,
  };
}

/** The points this turn gave, most first, by name. */
export function turnGains(s: DrawState): { name: string; points: number }[] {
  return [...s.points].sort((a, b) => b.points - a.points)
    .map((p) => ({ name: s.players.find((q) => q.id === p.id)?.name ?? '', points: p.points }));
}

/** "Rui +300   Ana +100", or "Nobody got it". */
export function gainsText(gains: readonly { name: string; points: number }[], gap = '   '): string {
  return gains.length ? gains.map((g) => `${g.name} +${g.points}`).join(gap) : 'Nobody got it';
}

/** "1:20", "0:09". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A name cut to `max` characters, with an ellipsis. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The TV's drawing space (the surface is scaled to it). */
const W = 512;
const H = 288;
/** The white card the drawing is on, 4:3 like the panel's canvas, and the column of scores right of it. */
export const TV_CARD = { x: 12, y: 12, w: 352, h: 264 };
const END_CARD = { x: 12, y: 12, w: 488, h: 264 };
const SIDE = 378;
const SIDE_W = 122;
const SANS = 'system-ui, sans-serif';
const BG: Rgb = [0x1d / 255, 0x20 / 255, 0x30 / 255];
const INK = '#f4f1ea';
const GOLD = '#f2c94c';
const DARK = '#1f1f24';
const GREY = '#6b6f7a';
/** The pencil and the tick as text, never emoji (U+FE0E asks for the text form). */
export const PENCIL = '\u270E\uFE0E ';
export const TICK = '\u2713\uFE0E ';

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Sets a font no bigger than `size` px at which `text` fits in `width`. */
function fitFont(ctx: Ctx, text: string, width: number, size: number, weight: number, family = SANS): void {
  ctx.font = `${weight} ${size}px ${family}`;
  const measured = ctx.measureText(text).width;
  if (Number.isFinite(measured) && measured > width) ctx.font = `${weight} ${Math.max(8, Math.floor((size * width) / measured))}px ${family}`;
}

/** Draws a game on the TV: the drawing on a white card, the time, the blanks and the scores beside it; the final
 * scores big at the end. */
export function drawGameTv(ctx: Ctx, v: DrawTv): void {
  ctx.fillStyle = `rgb(${BG.map((c) => Math.round(c * 255)).join(',')})`;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  if (v.phase === 'end') return finalScores(ctx, v);
  const { x, y, w, h } = TV_CARD;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  paintSketch(ctx, v.strokes, x, y, w, h);
  ctx.textAlign = 'center';
  if (v.phase === 'choosing') {
    ctx.fillStyle = GREY;
    fitFont(ctx, `${v.drawer} is choosing a word`, w - 32, 18, 500);
    ctx.fillText(`${v.drawer} is choosing a word`, x + w / 2, y + h / 2);
  } else if (v.phase === 'reveal') {
    ctx.fillStyle = 'rgba(29,32,48,0.85)';
    ctx.fillRect(x, y + h / 2 - 44, w, 88);
    ctx.fillStyle = INK;
    ctx.font = `500 14px ${SANS}`;
    ctx.fillText('The word was', x + w / 2, y + h / 2 - 25);
    ctx.fillStyle = GOLD;
    fitFont(ctx, v.word, w - 32, 24, 700);
    ctx.fillText(v.word, x + w / 2, y + h / 2);
    ctx.fillStyle = INK;
    const gains = gainsText(v.gains);
    fitFont(ctx, gains, w - 32, 13, 500);
    ctx.fillText(gains, x + w / 2, y + h / 2 + 26);
  }
  ctx.fillStyle = GOLD;
  ctx.font = `700 26px ${SANS}`;
  ctx.fillText(clock(v.seconds), SIDE + SIDE_W / 2, 34);
  if (v.phase !== 'choosing') {
    ctx.fillStyle = INK;
    fitFont(ctx, v.hint, SIDE_W, 16, 600, 'ui-monospace, monospace');
    ctx.fillText(v.hint, SIDE + SIDE_W / 2, 66);
  }
  v.rows.slice(0, 8).forEach((r, i) => {
    const ry = 98 + i * 22;
    ctx.globalAlpha = r.here ? 1 : 0.45;
    ctx.fillStyle = r.drawer ? GOLD : INK;
    ctx.font = `500 12px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${r.drawer ? PENCIL : r.guessed ? TICK : ''}${clip(r.name, 12)}`, SIDE, ry);
    ctx.textAlign = 'right';
    ctx.fillText(String(r.score), SIDE + SIDE_W, ry);
  });
  ctx.globalAlpha = 1;
}

function finalScores(ctx: Ctx, v: DrawTv): void {
  const { x, y, w, h } = END_CARD;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = DARK;
  ctx.font = `700 22px ${SANS}`;
  ctx.fillText('Final scores', W / 2, 42);
  v.rows.slice(0, 8).forEach((r, i) => {
    const ry = 78 + i * 25;
    ctx.fillStyle = r.place === 1 ? '#b7860b' : DARK;
    ctx.font = `${r.place === 1 ? 700 : 500} 18px ${SANS}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${r.place}.`, 150, ry);
    ctx.fillText(String(r.score), 380, ry);
    ctx.textAlign = 'left';
    ctx.fillText(clip(r.name, 16), 164, ry);
  });
}

/** The picture's mean sRGB colour: the white card's share of the screen over the dark background (the strokes are
 * thin enough to leave out), so the TV's light goes bright and neutral during a game. */
export function gameMean(v: DrawTv): Rgb {
  const card = v.phase === 'end' ? END_CARD : TV_CARD;
  const white = (card.w * card.h) / (W * H);
  return [white + BG[0] * (1 - white), white + BG[1] * (1 - white), white + BG[2] * (1 - white)];
}
```

- [ ] **Step 4: `TvContent` shows a game**

In `web/src/screen-content.ts`, insert at the very top of the file, before `/** Anything with a 2D context`:

```ts
import { type DrawTv, drawGameTv, gameMean } from './draw-tv';

```

In `class TvContent`, replace

```ts
  private avg: Rgb = [0, 0, 0];
  private avgAt = -Infinity;

  constructor(private surface: Surface) {
```

with:

```ts
  private avg: Rgb = [0, 0, 0];
  private avgAt = -Infinity;
  /** A game of draw and guess, shown instead of the channel (draw-tv.ts); null shows the channel. */
  private game: DrawTv | null = null;

  constructor(private surface: Surface) {
```

Insert just before `  /** Back to the first channel, for switching the TV on again. */`:

```ts
  /** Shows a game instead of the channel, or (null) the channel again, its badge first. */
  setGame(view: DrawTv | null): void {
    if (!view && this.game) this.changed = true;
    this.game = view;
  }

```

In `draw`, replace

```ts
    ctx.setTransform(this.surface.width / TV_W, 0, 0, this.surface.height / TV_H, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.scenes[index].draw(t, world);
```

with:

```ts
    ctx.setTransform(this.surface.width / TV_W, 0, 0, this.surface.height / TV_H, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.game) {
      drawGameTv(ctx, this.game);
      this.avg = toLinear(gameMean(this.game));
      return;
    }
    this.scenes[index].draw(t, world);
```

- [ ] **Step 5: `Screen`: lit by a game, and the remote's buttons**

In `web/src/screens.ts`, replace `import { DesktopContent, type ScreenWorld, type Surface, TV_CHANNELS, TvContent } from './screen-content';` with:

```ts
import type { DrawTv } from './draw-tv';
import { DesktopContent, type ScreenWorld, type Surface, TV_CHANNELS, TvContent } from './screen-content';
```

Replace

```ts
  private lastDraw = -Infinity;
  private average = new Color();
```

with:

```ts
  private lastDraw = -Infinity;
  private average = new Color();
  /** The TV shows a game of draw and guess, on or off (draw-tv.ts). */
  private showing = false;
```

Replace the whole of `set` and `click`:

```ts
  /** Puts the screen in a given state, as another visitor left it: on with a channel, or off. */
  set(on: boolean, channel: number, t: number): void {
    if (on && !this.on) {
      this.on = true;
      this.started = t;
      this.lastDraw = -Infinity;
      if (this.isTv) (this.content as TvContent).reset();
    }
    if (on && this.isTv) (this.content as TvContent).setChannel(channel);
    if (!on) this.on = false;
  }

  /** The TV: on, then each channel in turn, then off. The monitor and laptop: on and off. */
  click(t: number): void {
    if (!this.on) {
      this.on = true;
      this.started = t;
      this.lastDraw = -Infinity;
      if (this.isTv) (this.content as TvContent).reset();
    } else if (!this.isTv || !(this.content as TvContent).next()) {
      this.on = false;
    }
  }
```

with:

```ts
  /** On, or showing a game: the picture and the light it casts are up. */
  get lit(): boolean {
    return this.on || this.showing;
  }

  /** Puts the screen in a given state, as another visitor left it: on with a channel, or off. */
  set(on: boolean, channel: number, t: number): void {
    if (on && !this.on) this.switchOn(t);
    if (on && this.isTv) (this.content as TvContent).setChannel(channel);
    if (!on) this.on = false;
  }

  /** The TV: on, then each channel in turn, then off. The monitor and laptop: on and off. */
  click(t: number): void {
    if (!this.on) this.switchOn(t);
    else if (!this.isTv || !(this.content as TvContent).next()) this.on = false;
  }

  /** The remote's On/Off. */
  power(t: number): void {
    if (this.on) this.on = false;
    else this.switchOn(t);
  }

  /** The remote's Next channel: after the last, the first again. Nothing while off. */
  nextChannel(): void {
    if (!this.on || !this.isTv) return;
    const tv = this.content as TvContent;
    if (!tv.next()) tv.setChannel(0);
  }

  /** The TV shows a game instead of its channel, even while off (null: its channel again, or dark if off). */
  setGame(view: DrawTv | null, t: number): void {
    if (!this.isTv) return;
    const showing = view !== null;
    if (showing !== this.showing) {
      if (showing && !this.on) this.started = t;
      this.lastDraw = -Infinity; // redraw at once, near or far
      this.showing = showing;
    }
    (this.content as TvContent).setGame(view);
  }

  private switchOn(t: number): void {
    this.on = true;
    this.started = t;
    this.lastDraw = -Infinity;
    if (this.isTv) (this.content as TvContent).reset();
  }
```

In `update`, replace `    this.level = fadeToward(this.level, this.on ? 1 : 0, dt, CONFIG.screens.fade);` with:

```ts
    this.level = fadeToward(this.level, this.lit ? 1 : 0, dt, CONFIG.screens.fade);
```

(`lastChannel` stays: the screens tests use it.)

- [ ] **Step 6: The TV's prompt**

In `web/src/interactions.ts`, in `promptFor`'s `case 'screen'`, replace

```ts
      if (!s.isTv) return `${verb}: turn screen ${s.on ? 'off' : 'on'}`;
      return !s.on ? `${verb}: turn TV on` : s.lastChannel ? `${verb}: turn TV off` : `${verb}: next channel`;
```

with:

```ts
      return s.isTv ? `${verb}: TV` : `${verb}: turn screen ${s.on ? 'off' : 'on'}`;
```

Replace the doc comment just above `export function activate`:

```ts
/** `now`: seconds, for the screens' pictures. Sitting down is the player's (main.ts). */
```

with:

```ts
/** `now`: seconds, for the screens' pictures. Sitting down, and the TV's panel, are the player's (main.ts). */
```

and in `activate`, replace `    case 'screen': return t.screen.click(now);` with:

```ts
    case 'screen':
      if (!t.screen.isTv) t.screen.click(now); // a click on the TV opens its panel instead (main.ts)
      return;
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/draw-tv.test.ts tests/screen-content.test.ts tests/screens.test.ts tests/interactions.test.ts`
Expected: PASS (8, 15, 5 and 12 tests).

Run: `cd web && npm test && npm run build`
Expected: 51 test files, 511 tests pass; the build is clean. (Until Task 8 a click on the TV in the running walkthrough does nothing: the panel isn't wired yet.)

- [ ] **Step 8: Commit**

```bash
git add web/src/draw-tv.ts web/src/screen-content.ts web/src/screens.ts web/src/interactions.ts web/tests/draw-tv.test.ts web/tests/screen-content.test.ts web/tests/screens.test.ts web/tests/interactions.test.ts
git commit -m "TV draw and guess: the game on the TV, its remote's buttons, and its prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sharing draw messages, and a held player stays put (`multiplayer.ts`, `player.ts`)

Mechanical: the code below is complete.

**Files:**
- Modify: `web/src/multiplayer.ts`
- Modify: `web/src/player.ts`
- Test: `web/tests/multiplayer.test.ts`, `web/tests/seats.test.ts` (the `Player` tests live there)

**Interfaces:**
- Consumes (Task 4): `DrawMessage`, `isDrawMessage` from `./draw-game`.
- Produces:
  - `MessageKind` gains `'draw'`
  - `MultiplayerHooks.onDraw?: (msg: DrawMessage, from: string) => void` (well-formed messages only), `MultiplayerHooks.onArrive?: (id: string) => void` (a visitor new here, or back after timing out; called once per arrival)
  - `Multiplayer.sendDraw(msg: DrawMessage, to?: string): void`
  - `Player.held` now also stops walking (it already kept a seated player seated)

- [ ] **Step 1: Write the failing tests**

In `web/tests/multiplayer.test.ts`, add before `import type { GameMessage } from '../src/games';`:

```ts
import type { DrawMessage } from '../src/draw-game';
```

In `setup`, replace

```ts
  const games: GameMessage[] = [];
  let running: GameMessage[] = [];
  const mp = new Multiplayer(fake.room, world, avatars, 'Ana', {
    now: () => now, onChanged: (k) => void changed.push(k), onPeers: (n) => void peers.push(n), onHost: (h) => void hosts.push(h),
    onGame: (g) => void games.push(g), games: () => running,
  }, joinedAt, arrived);
  return {
    fake, world, avatars, mp, changed, peers, hosts, games, setNow: (t: number) => { now = t; }, setGames: (g: GameMessage[]) => { running = g; },
```

with:

```ts
  const games: GameMessage[] = [];
  let running: GameMessage[] = [];
  const draws: [DrawMessage, string][] = [];
  const arrivals: string[] = [];
  const mp = new Multiplayer(fake.room, world, avatars, 'Ana', {
    now: () => now, onChanged: (k) => void changed.push(k), onPeers: (n) => void peers.push(n), onHost: (h) => void hosts.push(h),
    onGame: (g) => void games.push(g), games: () => running,
    onDraw: (m, from) => void draws.push([m, from]), onArrive: (id) => void arrivals.push(id),
  }, joinedAt, arrived);
  return {
    fake, world, avatars, mp, changed, peers, hosts, games, draws, arrivals,
    setNow: (t: number) => { now = t; }, setGames: (g: GameMessage[]) => { running = g; },
```

Insert just before `  it('asks a peer that comes back after timing out who it is, and answers when asked', () => {`:

```ts
  it('passes on well-formed draw messages with their sender, and sends its own to everyone or to one', () => {
    const { fake, mp, draws, avatars } = setup();
    fake.receive('draw', { k: 'join', on: true }, 'p1');
    fake.receive('draw', { k: 'dance' }, 'p1');
    fake.receive('draw', { k: 'guess', g: 'g1', t: 1, text: 'x'.repeat(41) }, 'p2');
    expect(draws).toEqual([[{ k: 'join', on: true }, 'p1']]);
    expect(avatars.has('p1')).toBe(true);
    expect(avatars.has('p2')).toBe(false);
    mp.sendDraw({ k: 'join', on: true });
    expect(fake.sent.at(-1)).toEqual({ kind: 'draw', data: { k: 'join', on: true } });
    mp.sendDraw({ k: 'guess', g: 'g1', t: 1, text: 'cat' }, 'p1');
    expect(fake.sent.at(-1)).toEqual({ kind: 'draw', data: { k: 'guess', g: 'g1', t: 1, text: 'cat' }, to: 'p1' });
  });
  it('tells of each visitor who arrives, once, and again when one comes back after timing out', () => {
    const { fake, mp, arrivals, setNow } = setup();
    fake.join('p1');
    fake.receive('pose', [0, 0, 0, 0], 'p1');
    fake.receive('draw', { k: 'join', on: false }, 'p2');
    expect(arrivals).toEqual(['p1', 'p2']);
    setNow(20);
    fake.receive('pose', [0, 0, 0, 0], 'p2');
    mp.tick(); // p1 silent for 20 s
    fake.receive('pose', [0, 0, 0, 0], 'p1');
    expect(arrivals).toEqual(['p1', 'p2', 'p1']);
  });
```

In `web/tests/seats.test.ts`, insert just before `  it('stands up from the stick too, and teleporting gets up', () => {`:

```ts
  it("doesn't walk while held (the TV's panel is open), and walks again after", () => {
    const { p } = make();
    const [x, z] = [p.x, p.z];
    p.held = true;
    p.keys.forward = true;
    p.update(0.1);
    p.keys.forward = false;
    p.stick = { forward: 1, right: 0, run: true };
    p.update(0.1);
    expect([p.x, p.z]).toEqual([x, z]);
    p.held = false;
    p.update(0.1);
    expect([p.x, p.z]).not.toEqual([x, z]);
  });

```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/multiplayer.test.ts tests/seats.test.ts`
Expected: FAIL: no `draw` handler (`handlers.get('draw')` is undefined, a TypeError), `mp.sendDraw is not a function`, no arrivals told, and the held player walking.

- [ ] **Step 3: `multiplayer.ts`**

Replace `import { type GameMessage, isGameMessage } from './games';` with:

```ts
import { type DrawMessage, isDrawMessage } from './draw-game';
import { type GameMessage, isGameMessage } from './games';
```

Replace the two lines that define the message kinds:

```ts
export type MessageKind = 'hello' | 'pose' | 'state' | 'game' | 'draw';
const KINDS: MessageKind[] = ['hello', 'pose', 'state', 'game', 'draw'];
```

In `MultiplayerHooks`, after `games?: () => GameMessage[];`, add:

```ts
  /** Draw and guess: a message from another visitor (well-formed; what to do with it is the game's call). */
  onDraw?: (msg: DrawMessage, from: string) => void;
  /** A visitor new here (or back after timing out), to greet with this visitor's part of draw and guess. */
  onArrive?: (id: string) => void;
```

At the end of the constructor, after the `'game'` handler's closing `});`, add:

```ts
    room.onMessage('draw', (data, id) => {
      if (!isDrawMessage(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      hooks.onDraw?.(data, id);
    });
```

In `arrive`, replace

```ts
    this.hooks.onPeers(this.peers.names());
    return true;
```

with:

```ts
    this.hooks.onPeers(this.peers.names());
    this.hooks.onArrive?.(id);
    return true;
```

Add this method just before `  /** Every frame: drop the silent. */`:

```ts
  /** Draw and guess: to everyone, or (a guess, a "close!", a newcomer's state) to one visitor. */
  sendDraw(msg: DrawMessage, to?: string): void {
    this.room.send('draw', msg, to);
  }

```

`DrawMessage` is a union of `type` aliases with no `readonly` arrays, so it is assignable to the `Json` that `Room.send` takes. `draw-game.ts` imports only `presence.ts`, never `multiplayer.ts`: no import cycle.

- [ ] **Step 4: `player.ts`**

Replace the `held` field's doc comment and declaration:

```ts
  /** At a game board: the movement keys and stick neither walk nor stand you up (standing is the board's button or C). */
  held = false;
```

with:

```ts
  /** At a game board or with the TV's panel open: the movement keys and stick neither walk nor stand you up
   * (standing is the board's button or C). */
  held = false;
```

In `update`, replace `    if (!this.frozen && !this.seat) {` with:

```ts
    if (!this.frozen && !this.seat && !this.held) {
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd web && npx vitest run tests/multiplayer.test.ts tests/seats.test.ts`
Expected: PASS (26 and 13 tests).

Run: `cd web && npm test && npm run build`
Expected: 51 test files, 514 tests pass; the build is clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/multiplayer.ts web/src/player.ts web/tests/multiplayer.test.ts web/tests/seats.test.ts
git commit -m "TV draw and guess: the draw message, greeting arrivals, and a held player stays put

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The TV's panel (`draw-panel.ts`, markup, styles)

Mechanical: the code below is complete. What the panel shows is worked out by the pure `tvPanelView` (tested here); the `TvPanel` class only puts it on screen and passes on clicks, keys and the pen, and is checked in the browser in Task 9 (Vitest runs without a DOM).

**Files:**
- Create: `web/src/draw-panel.ts`
- Modify: `web/index.html` (the panel's markup)
- Modify: `web/src/style.css` (the panel's styles)
- Test: `web/tests/draw-panel.test.ts`

**Interfaces:**
- Consumes: `spaced` (Task 1); `COLOUR_NAMES`, `ERASER`, `gridPoint`, `paintSketch`, `PALETTE`, `Stroke` (Task 2); `DrawState`, `standings` (Task 3); `clock`, `gainsText`, `PENCIL`, `TICK`, `turnGains` (Task 5).
- Produces: `DRAW_COPY`; `interface LobbyPlayer { name; colour; you: boolean }`; `interface TvPanelInput { me; tvOn; game: DrawState | null; leftMs; joined: LobbyPlayer[]; youJoined; secret; choices: string[]; close: string | null }`; `interface TvPanelGame`; `interface TvPanelView`; `tvPanelView(i: TvPanelInput): TvPanelView`; `interface TvPanelHandlers { power(); next(); join(); start(); close(); choose(word); guess(text); penDown(colour, width, x, y); penMove(x, y); undo(); clear() }`; `class TvPanel` with `constructor(doc: Document, h: TvPanelHandlers)`, `colour`, `width`, `isOpen`, `open()`, `close()`, `render(view: TvPanelView, strokes: readonly Stroke[], version: number)`.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/draw-panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DRAW_COPY, type TvPanelInput, tvPanelView } from '../src/draw-panel';
import { beginDrawing, endTurn, finish, newGame, removePlayer, rightGuess, wrongGuess } from '../src/draw-rules';
import { PENCIL, TICK } from '../src/draw-tv';

const ANA = { name: 'Ana', colour: '#e2bc94', you: false };
const RUI = { name: 'Rui', colour: '#a9d4f5', you: true };
const game = () => newGame('g1', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }, { id: 'ze', name: 'Zé' }]);
const input = (over: Partial<TvPanelInput> = {}): TvPanelInput => ({
  me: 'rui', tvOn: false, game: null, leftMs: 0, joined: [], youJoined: false, secret: '', choices: [], close: null, ...over,
});

describe('the TV panel', () => {
  it('works the remote while no game shows', () => {
    expect(tvPanelView(input())).toMatchObject({ title: 'TV', power: 'Turn on', remote: true, nextChannel: false, remoteNote: '', game: null });
    expect(tvPanelView(input({ tvOn: true }))).toMatchObject({ power: 'Turn off', remote: true, nextChannel: true });
  });
  it("disables the remote while a game shows, its final scores too", () => {
    expect(tvPanelView(input({ tvOn: true, game: game() }))).toMatchObject({ remote: false, nextChannel: false, remoteNote: 'A game is on' });
    expect(tvPanelView(input({ game: finish(game()) })).remote).toBe(false);
  });
  it('lets two or more who joined start, when no game runs', () => {
    expect(tvPanelView(input())).toMatchObject({ join: 'Join', start: false, lobbyNote: DRAW_COPY.needTwo });
    expect(tvPanelView(input({ joined: [ANA, RUI], youJoined: true }))).toMatchObject({ join: 'Leave', start: true, lobbyNote: '', players: [ANA, RUI] });
    expect(tvPanelView(input({ joined: [ANA, { ...RUI, you: false }] }))).toMatchObject({ start: false, lobbyNote: 'Join to play' });
    expect(tvPanelView(input({ joined: [ANA, RUI], youJoined: true, game: { ...game(), players: [] } }))).toMatchObject({ start: false, lobbyNote: 'A game is on' });
    expect(tvPanelView(input({ joined: [ANA, RUI], youJoined: true, game: finish(game()), me: 'mia' })).start).toBe(true);
  });
  it('shows onlookers the lobby, and players the game', () => {
    expect(tvPanelView(input({ me: 'mia', game: game() }))).toMatchObject({ title: 'TV', game: null, lobbyNote: DRAW_COPY.gameOnJoin });
    expect(tvPanelView(input({ game: game() }))).toMatchObject({ title: 'Draw and guess' });
    expect(tvPanelView(input({ game: removePlayer(game(), 'rui') })).game).toBeNull(); // left the game
  });
});

describe('the game panel', () => {
  it('gives the drawer three words while the others wait', () => {
    const drawer = tvPanelView(input({ me: 'ana', game: game(), leftMs: 14200, choices: ['cat', 'dog', 'horse'] })).game!;
    expect(drawer).toMatchObject({ status: 'Choose a word to draw', choices: ['cat', 'dog', 'horse'], time: '0:15', tools: false, guess: false, word: '' });
    const guesser = tvPanelView(input({ game: game(), choices: ['cat'] })).game!;
    expect(guesser).toMatchObject({ status: 'Ana is choosing a word', choices: [], guess: false });
  });
  it('spells the word out for the drawer, with the tools; blanks and the guess box for the guessers', () => {
    const s = beginDrawing(game(), 'ice cream');
    expect(tvPanelView(input({ me: 'ana', game: s, secret: 'ice cream', leftMs: 80000 })).game).toMatchObject({ word: 'ice cream', status: 'Your turn to draw', tools: true, guess: false, time: '1:20' });
    expect(tvPanelView(input({ game: s, leftMs: 80000 })).game).toMatchObject({ word: '_ _ _   _ _ _ _ _', status: 'Guess the word', tools: false, guess: true });
  });
  it('shows the scores with the pencil and the ticks, the feed with names, and "close!" to its guesser', () => {
    let s = beginDrawing(game(), 'horse');
    s = wrongGuess(s, 'ze', 'cow');
    s = rightGuess(s, 'ze', 80000);
    s = removePlayer(s, 'ze');
    const g = tvPanelView(input({ game: s, close: 'hors' })).game!;
    expect(g.rows).toEqual([
      { name: `${TICK}Zé`, score: 300, drawer: false, here: false },
      { name: `${PENCIL}Ana`, score: 50, drawer: true, here: true },
      { name: 'Rui', score: 0, drawer: false, here: true },
    ]);
    expect(g.feed).toEqual(['Zé: cow', 'Zé guessed it!', 'Zé left']);
    expect(g.close).toBe('"hors" is close!');
    expect(tvPanelView(input({ me: 'ze', game: rightGuess(beginDrawing(game(), 'horse'), 'ze', 1), close: 'hors' })).game).toMatchObject({ close: '', guess: false, status: 'You guessed it!' });
  });
  it('shows the word at the reveal, and the final places at the end', () => {
    const s = endTurn(rightGuess(beginDrawing(game(), 'cat'), 'rui', 80000), 'cat');
    expect(tvPanelView(input({ game: s })).game).toMatchObject({ word: 'cat', status: 'The word was cat. Rui +300, Ana +50', guess: false });
    expect(tvPanelView(input({ game: endTurn(beginDrawing(game(), 'dog'), 'dog') })).game?.status).toBe('The word was dog. Nobody got it');
    const end = tvPanelView(input({ game: finish(s) })).game!;
    expect(end).toMatchObject({ status: 'Final scores', time: '' });
    expect(end.rows.map((r) => r.name)).toEqual(['1. Rui', '2. Ana', '3. Zé']);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npx vitest run tests/draw-panel.test.ts`
Expected: FAIL: `../src/draw-panel` cannot be resolved.

- [ ] **Step 3: The panel**

Create `web/src/draw-panel.ts`:

```ts
import { spaced } from './draw-match';
import { type DrawState, standings } from './draw-rules';
import { COLOUR_NAMES, ERASER, gridPoint, paintSketch, PALETTE, type Stroke } from './draw-sketch';
import { clock, gainsText, PENCIL, TICK, turnGains } from './draw-tv';

export const DRAW_COPY = {
  tv: 'TV',
  game: 'Draw and guess',
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  gameOn: 'A game is on',
  join: 'Join',
  leave: 'Leave',
  needTwo: 'Two or more players to start',
  joinToPlay: 'Join to play',
  gameOnJoin: 'A game is on. Join to guess, and draw later.',
  chooseWord: 'Choose a word to draw',
  yourTurn: 'Your turn to draw',
  guessIt: 'Guess the word',
  youHaveIt: 'You guessed it!',
  finalScores: 'Final scores',
};
const isChoosing = (name: string) => `${name} is choosing a word`;
const wordWas = (word: string, gains: string) => `The word was ${word}. ${gains}`;
const isClose = (text: string) => `"${text}" is close!`;

/** A visitor in the lobby's list. */
export interface LobbyPlayer { name: string; colour: string; you: boolean }

/** What the TV panel shows, worked out from the game; the panel only puts it on screen. */
export interface TvPanelInput {
  /** This visitor's id. */
  me: string;
  tvOn: boolean;
  /** The game shown on the TV (running, or its final scores), and the time left in its phase. */
  game: DrawState | null;
  leftMs: number;
  /** Who has pressed Join, in arrival order. */
  joined: LobbyPlayer[];
  youJoined: boolean;
  /** In the drawer's browser: the word, and the words to choose from. */
  secret: string;
  choices: string[];
  /** This visitor's last guess, when it was close. */
  close: string | null;
}

export interface TvPanelGame {
  /** The word spelled out for the drawer, blanks for the guessers, the word at the reveal. */
  word: string;
  time: string;
  status: string;
  /** The drawer's three words while choosing. */
  choices: string[];
  /** The canvas takes the drawer's pen, and the tools show. */
  tools: boolean;
  /** The guess box shows. */
  guess: boolean;
  rows: { name: string; score: number; drawer: boolean; here: boolean }[];
  feed: string[];
  close: string;
}

export interface TvPanelView {
  title: string;
  /** The remote: the On/Off button's label, whether its buttons work, and why not. */
  power: string;
  remote: boolean;
  nextChannel: boolean;
  remoteNote: string;
  /** The lobby: who has joined, Join or Leave, Start, and a line on what's next. */
  players: LobbyPlayer[];
  join: string;
  start: boolean;
  lobbyNote: string;
  /** For a player while the game shows: the game panel instead of the remote and the lobby. */
  game: TvPanelGame | null;
}

/** Works out the TV panel: the remote and the lobby for everyone, the game for its players while it shows. */
export function tvPanelView(i: TvPanelInput): TvPanelView {
  const s = i.game;
  const showing = !!s;
  const running = !!s && s.phase !== 'end';
  const playing = !!s && s.players.some((p) => p.id === i.me && p.here);
  let lobbyNote: string;
  if (running) lobbyNote = i.youJoined ? DRAW_COPY.gameOn : DRAW_COPY.gameOnJoin;
  else if (i.joined.length < 2) lobbyNote = DRAW_COPY.needTwo;
  else lobbyNote = i.youJoined ? '' : DRAW_COPY.joinToPlay;
  return {
    title: playing ? DRAW_COPY.game : DRAW_COPY.tv,
    power: i.tvOn ? DRAW_COPY.turnOff : DRAW_COPY.turnOn,
    remote: !showing,
    nextChannel: !showing && i.tvOn,
    remoteNote: showing ? DRAW_COPY.gameOn : '',
    players: i.joined,
    join: i.youJoined ? DRAW_COPY.leave : DRAW_COPY.join,
    start: !running && i.youJoined && i.joined.length >= 2,
    lobbyNote,
    game: s && playing ? gamePanel(i, s) : null,
  };
}

function gamePanel(i: TvPanelInput, s: DrawState): TvPanelGame {
  const drawer = s.drawer === i.me && s.phase !== 'end';
  const has = s.guessed.includes(i.me);
  const names = new Map(s.players.map((p) => [p.id, p.name]));
  const drawerName = names.get(s.drawer) ?? '';
  let word = '';
  let status: string;
  if (s.phase === 'choosing') status = drawer ? DRAW_COPY.chooseWord : isChoosing(drawerName);
  else if (s.phase === 'drawing') {
    word = drawer ? i.secret : spaced(s.mask);
    status = drawer ? DRAW_COPY.yourTurn : has ? DRAW_COPY.youHaveIt : DRAW_COPY.guessIt;
  } else if (s.phase === 'reveal') {
    word = s.word;
    status = wordWas(s.word, gainsText(turnGains(s), ', '));
  } else status = DRAW_COPY.finalScores;
  return {
    word,
    time: s.phase === 'end' ? '' : clock(Math.ceil(i.leftMs / 1000)),
    status,
    choices: drawer && s.phase === 'choosing' ? i.choices : [],
    tools: drawer && s.phase === 'drawing',
    guess: !drawer && s.phase === 'drawing' && !has,
    rows: standings(s.players).map((p) => ({
      name: `${s.phase === 'end' ? `${p.place}. ` : p.id === s.drawer ? PENCIL : s.guessed.includes(p.id) ? TICK : ''}${p.name}`,
      score: p.score, drawer: p.id === s.drawer && s.phase !== 'end', here: p.here,
    })),
    feed: s.feed.map((l) => {
      const name = names.get(l.id) ?? '';
      return l.kind === 'hit' ? `${name} guessed it!` : l.kind === 'left' ? `${name} left` : `${name}: ${l.text}`;
    }),
    close: s.phase === 'drawing' && i.close && !has ? isClose(i.close) : '',
  };
}

export interface TvPanelHandlers {
  power(): void;
  next(): void;
  /** Join, or Leave. */
  join(): void;
  start(): void;
  close(): void;
  choose(word: string): void;
  guess(text: string): void;
  /** The drawer's pen on the canvas, in grid units. */
  penDown(colour: number, width: number, x: number, y: number): void;
  penMove(x: number, y: number): void;
  undo(): void;
  clear(): void;
}

/**
 * The TV's panel: the remote and the draw-and-guess lobby, and for a player while a game shows, the game: the drawing
 * (the drawer's pen on it), the word or its blanks, the time, the scores, the feed and the guess box. Names come from
 * other visitors: they are set as text only. Keys typed in the guess box stay there: none reaches the walkthrough.
 */
export class TvPanel {
  /** The pen: a colour of `PALETTE` (`ERASER` for the eraser) and a width of `WIDTHS`. */
  colour = 0;
  width = 0;
  private last = '';
  private painted = { version: -1, w: 0, h: 0 };
  private pen = false;
  private tools = false;

  constructor(private doc: Document, h: TvPanelHandlers) {
    this.el('tv-power').addEventListener('click', () => h.power());
    this.el('tv-next').addEventListener('click', () => h.next());
    this.el('tv-join').addEventListener('click', () => h.join());
    this.el('tv-leave').addEventListener('click', () => h.join());
    this.el('tv-start').addEventListener('click', () => h.start());
    this.el('tv-close').addEventListener('click', () => h.close());
    this.el('draw-undo').addEventListener('click', () => h.undo());
    this.el('draw-clear').addEventListener('click', () => h.clear());
    this.el('draw-eraser').addEventListener('click', () => this.pick(ERASER));
    this.el('draw-fine').addEventListener('click', () => this.size(0));
    this.el('draw-broad').addEventListener('click', () => this.size(1));
    this.el('draw-colours').replaceChildren(...PALETTE.slice(0, ERASER).map((colour, i) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'draw-colour';
      b.style.background = colour;
      b.setAttribute('aria-label', COLOUR_NAMES[i]);
      b.addEventListener('click', () => this.pick(i));
      return b;
    }));
    this.el('draw-choices').addEventListener('click', (e) => {
      const word = (e.target as HTMLElement).closest('button')?.dataset.word;
      if (word) h.choose(word);
    });
    const input = this.el<HTMLInputElement>('draw-guess-text');
    this.el('draw-guess').addEventListener('submit', (e) => {
      e.preventDefault();
      h.guess(input.value);
      input.value = '';
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing never walks, toggles lights or closes the panel by its letter
      if (e.key === 'Escape') h.close();
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    const canvas = this.el<HTMLCanvasElement>('draw-canvas');
    const at = (e: PointerEvent) => gridPoint(e.clientX, e.clientY, canvas.getBoundingClientRect());
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.tools || e.button > 0) return;
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      this.pen = true;
      h.penDown(this.colour, this.width, ...at(e));
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.pen) return;
      const all = e.getCoalescedEvents?.() ?? []; // every point the pointer passed since the last event (none for a synthetic one)
      for (const p of all.length ? all : [e]) h.penMove(...at(p));
    });
    const up = () => { this.pen = false; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    this.pick(0);
    this.size(0);
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.doc.getElementById(id) as T;
  }

  get isOpen(): boolean {
    return !this.el('tv-panel').hidden;
  }

  open(): void {
    this.last = '';
    this.painted.version = -1;
    this.el('tv-panel').hidden = false;
    this.doc.body.classList.add('tv-open');
  }

  close(): void {
    this.pen = false;
    this.el<HTMLInputElement>('draw-guess-text').blur();
    this.el('tv-panel').hidden = true;
    this.doc.body.classList.remove('tv-open');
  }

  /** Puts the view on screen when it changed, and the drawing when it or the canvas's size changed. */
  render(view: TvPanelView, strokes: readonly Stroke[], version: number): void {
    const key = JSON.stringify(view);
    if (key !== this.last) {
      this.last = key;
      this.fill(view);
    }
    if (view.game) this.paint(strokes, version);
  }

  private pick(colour: number): void {
    this.colour = colour;
    this.el('draw-colours').querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === colour)));
    this.el('draw-eraser').setAttribute('aria-pressed', String(colour === ERASER));
  }

  private size(width: number): void {
    this.width = width;
    this.el('draw-fine').setAttribute('aria-pressed', String(width === 0));
    this.el('draw-broad').setAttribute('aria-pressed', String(width === 1));
  }

  private fill(v: TvPanelView): void {
    this.el('tv-title').textContent = v.title;
    this.el('tv-lobby').hidden = !!v.game;
    this.el('draw-game').hidden = !v.game;
    this.el('tv-leave').hidden = !v.game;
    const power = this.el<HTMLButtonElement>('tv-power');
    power.textContent = v.power;
    power.disabled = !v.remote;
    this.el<HTMLButtonElement>('tv-next').disabled = !v.nextChannel;
    this.el('tv-remote-note').textContent = v.remoteNote;
    this.el('tv-players').replaceChildren(...v.players.map((p) => {
      const li = this.doc.createElement('li');
      const dot = this.doc.createElement('i');
      dot.style.background = p.colour;
      const name = this.doc.createElement('span');
      name.textContent = p.you ? `${p.name} (you)` : p.name;
      li.append(dot, name);
      return li;
    }));
    this.el('tv-join').textContent = v.join;
    this.el('tv-leave').textContent = v.join;
    this.el<HTMLButtonElement>('tv-start').disabled = !v.start;
    this.el('tv-lobby-note').textContent = v.lobbyNote;
    const g = v.game;
    this.tools = !!g?.tools;
    if (!this.tools) this.pen = false;
    if (!g) return;
    this.el('draw-word').textContent = g.word;
    this.el('draw-time').textContent = g.time;
    this.el('draw-status').textContent = g.status;
    const choices = this.el('draw-choices');
    choices.hidden = !g.choices.length;
    choices.replaceChildren(...g.choices.map((word) => {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.dataset.word = word;
      b.textContent = word;
      return b;
    }));
    this.el('draw-tools').hidden = !g.tools;
    this.el('draw-canvas').classList.toggle('drawing', g.tools);
    const form = this.el('draw-guess');
    const wasHidden = form.hidden;
    form.hidden = !g.guess;
    const touch = this.doc.body.classList.contains('touch'); // on a phone, focusing would pop the keyboard up
    if (wasHidden && g.guess && !touch && this.doc.activeElement === this.doc.body) this.el<HTMLInputElement>('draw-guess-text').focus();
    this.el('draw-scores').replaceChildren(...g.rows.map((r) => {
      const li = this.doc.createElement('li');
      const name = this.doc.createElement('span');
      name.textContent = r.name;
      const score = this.doc.createElement('span');
      score.textContent = String(r.score);
      li.append(name, score);
      li.classList.toggle('drawer', r.drawer);
      li.classList.toggle('gone', !r.here);
      return li;
    }));
    this.el('draw-feed').replaceChildren(...g.feed.map((line) => {
      const li = this.doc.createElement('li');
      li.textContent = line;
      return li;
    }));
    this.el('draw-close').textContent = g.close;
    this.el('draw-close').hidden = !g.close;
  }

  /** Draws the strokes on a white canvas at the screen's resolution. */
  private paint(strokes: readonly Stroke[], version: number): void {
    const canvas = this.el<HTMLCanvasElement>('draw-canvas');
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * ratio);
    const h = Math.round(canvas.clientHeight * ratio);
    if (!w || !h) return;
    if (w === this.painted.w && h === this.painted.h && version === this.painted.version) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.painted = { version, w, h };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    paintSketch(ctx, strokes, 0, 0, w, h);
  }
}
```

Notes for the implementer:
- The guess box's `keydown` and `keyup` stop propagating: the walkthrough's key handlers (`Player.attach` and the one in `main.ts`) listen on `window` in the bubbling phase, so no letter typed there walks, toggles a light or closes the panel. Esc in the box closes the panel.
- `getCoalescedEvents()` returns an empty list for synthetic pointer events (the browser checks in Task 9 use them), hence the fallback to the event itself.
- The `tv-open` class on `<body>` hides the sun panel and the guest list while the panel is open (Step 5).

- [ ] **Step 4: Markup**

In `web/index.html`, insert just before `      <div id="stick" hidden><i id="stick-knob"></i></div>`:

```html
      <section id="tv-panel" aria-labelledby="tv-title" hidden>
        <div class="tv-head">
          <h2 id="tv-title">TV</h2>
          <button type="button" id="tv-leave" hidden>Leave</button>
          <button type="button" id="tv-close">Close</button>
        </div>
        <div id="tv-lobby">
          <div class="tv-row">
            <button type="button" id="tv-power">Turn on</button>
            <button type="button" id="tv-next">Next channel</button>
            <span id="tv-remote-note"></span>
          </div>
          <h3>Draw and guess</h3>
          <ul id="tv-players"></ul>
          <p id="tv-lobby-note"></p>
          <div class="tv-row">
            <button type="button" id="tv-join">Join</button>
            <button type="button" id="tv-start" disabled>Start</button>
          </div>
        </div>
        <div id="draw-game" hidden>
          <p id="draw-head"><span id="draw-word"></span><span id="draw-time"></span></p>
          <div id="draw-board">
            <canvas id="draw-canvas"></canvas>
            <div id="draw-choices" hidden></div>
          </div>
          <div id="draw-tools" hidden>
            <span id="draw-colours"></span>
            <button type="button" id="draw-eraser">Eraser</button>
            <button type="button" id="draw-fine">Fine</button>
            <button type="button" id="draw-broad">Broad</button>
            <button type="button" id="draw-undo">Undo</button>
            <button type="button" id="draw-clear">Clear</button>
          </div>
          <p id="draw-status" aria-live="polite"></p>
          <div id="draw-lists">
            <ol id="draw-scores" aria-label="Scores"></ol>
            <ul id="draw-feed" aria-label="Guesses"></ul>
          </div>
          <form id="draw-guess" hidden>
            <input id="draw-guess-text" type="text" maxlength="40" autocomplete="off" autocapitalize="off" enterkeyhint="send" placeholder="Type your guess" aria-label="Your guess" />
            <button type="submit">Guess</button>
          </form>
          <p id="draw-close" aria-live="polite" hidden></p>
        </div>
      </section>
```

- [ ] **Step 5: Styles**

In `web/src/style.css`, insert just after the line `body.touch #board-panel { width: calc(100vw - 16px); padding: 10px 10px 12px; }`:

```css

/* The TV's panel (draw-panel.ts): the remote and the draw-and-guess lobby, and the game for its players, the mouse
   free. Like the board panel it sits under the pause veil. On a phone it is nearly full width, the canvas fills it,
   and the scores, the feed and the guess box follow below. */
#tv-panel {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); box-sizing: border-box;
  width: min(560px, calc(100vw - 32px)); max-height: calc(100% - 32px); overflow-y: auto; padding: 12px 16px 14px;
  border-radius: 14px; background: rgba(30, 28, 25, 0.92); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  display: flex; flex-direction: column; gap: 8px; font-size: 14px; text-align: left;
}
#tv-panel h2, #tv-panel h3 { margin: 0; font-size: 12px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
#tv-panel h3 { margin-top: 6px; color: var(--muted); }
#tv-panel button { padding: 6px 14px; font-size: 13px; background: rgba(255, 255, 255, 0.12); color: var(--ink); }
.tv-head { display: flex; align-items: center; gap: 6px; }
.tv-head h2 { flex: 1; }
#tv-lobby { display: flex; flex-direction: column; gap: 8px; }
.tv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
#tv-panel #tv-start:not(:disabled) { background: var(--accent); color: #121110; }
#tv-remote-note, #tv-lobby-note { color: var(--muted); font-size: 13px; }
#tv-lobby-note { margin: 0; min-height: 1.2em; }
#tv-players { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; }
#tv-players li { display: flex; align-items: center; gap: 6px; }
#tv-players i { width: 10px; height: 10px; border-radius: 50%; }
#draw-game { display: flex; flex-direction: column; gap: 8px; }
#draw-head { margin: 0; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; min-height: 1.4em; }
#draw-word { font: 600 18px ui-monospace, monospace; letter-spacing: 0.04em; white-space: pre; overflow: hidden; text-overflow: ellipsis; }
#draw-time { color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; }
#draw-board { position: relative; }
#draw-canvas { display: block; width: 100%; aspect-ratio: 4 / 3; background: #fff; border-radius: 8px; touch-action: none; }
#draw-canvas.drawing { cursor: crosshair; }
#draw-choices { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
#tv-panel #draw-choices button { min-width: 50%; padding: 10px 18px; font-size: 16px; background: var(--accent); color: #121110; }
#draw-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
#draw-colours { display: contents; }
#tv-panel .draw-colour { width: 26px; height: 26px; padding: 0; border: 2px solid rgba(255, 255, 255, 0.25); }
#tv-panel .draw-colour[aria-pressed='true'] { border-color: var(--ink); box-shadow: 0 0 0 2px var(--accent); }
#tv-panel #draw-tools button[aria-pressed='true']:not(.draw-colour) { background: var(--accent); color: #121110; }
#draw-status { margin: 0; min-height: 1.4em; }
#draw-lists { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px; }
#draw-scores, #draw-feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
#draw-scores li { display: flex; justify-content: space-between; gap: 8px; }
#draw-scores li span:first-child, #draw-feed li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#draw-scores .drawer { color: var(--accent); }
#draw-scores .gone { opacity: 0.5; }
#draw-feed { color: var(--muted); }
#draw-guess { display: flex; gap: 6px; }
#draw-guess input {
  flex: 1; min-width: 0; font: inherit; font-size: 15px; color: var(--ink); background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 8px; padding: 7px 10px;
}
#draw-guess input:focus { outline: none; border-color: var(--accent); }
#draw-close { margin: 0; color: var(--accent); }
body.tv-open #sun-panel, body.tv-open #guests { display: none; } /* they would sit over the panel's lists */
body.touch #tv-panel { width: calc(100vw - 16px); padding: 10px 10px 12px; }
body.touch #draw-guess input { font-size: 16px; -webkit-user-select: text; user-select: text; } /* iPhones zoom into smaller text */
```

- [ ] **Step 6: Run the tests and the build**

Run: `cd web && npx vitest run tests/draw-panel.test.ts`
Expected: PASS (8 tests).

Run: `cd web && npm test && npm run build`
Expected: 52 test files, 522 tests pass; the build is clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/draw-panel.ts web/index.html web/src/style.css web/tests/draw-panel.test.ts
git commit -m "TV draw and guess: the TV's panel, with the remote, the lobby and the game

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Wiring it up (`main.ts`), controls and README

Integration: the edits below are exact, but they land in the 720-line `run()` of `main.ts`, between code that must keep working (the table games' panel, the pointer lock, touch). Read the surrounding code at each anchor before editing.

**Files:**
- Modify: `web/src/main.ts`
- Modify: `web/index.html` (both controls lists)
- Modify: `README.md`

**Interfaces:**
- Consumes: `DrawGame`, `DrawOut`, `Visitor` (Task 4); `tvView` (Task 5); `Screen.lit`, `Screen.power`, `Screen.nextChannel`, `Screen.setGame` (Task 5); `Multiplayer.sendDraw`, the `onDraw` and `onArrive` hooks, `Player.held` (Task 6); `TvPanel`, `tvPanelView` (Task 7); `colourFor`, `cleanName` (already imported from `./presence`).
- Produces: nothing new for other tasks; `window.walkthrough.draw` (the `DrawGame`) under `?debug`, for Task 9.

No unit tests: this is DOM, pointer-lock and frame-loop wiring. It is checked by `npm run build` and by hand in Task 9.

Names used below that already exist in `run()`: `world`, `ui`, `player`, `others`, `selfId`, `arrived`, `joinedAt`, `used`, `share`, `atBoard`, `boardPanel`, `freeMouse`, `started`, `autostart`, `cursor`, `touch`, `lockPointer`, `interactions`, `paused`. `cursor`, `lockPointer`, `started` and `autostart` are declared further down than the new code; they are only used inside callbacks that run later, which TypeScript allows. `closeTv` is used in `updateGames` before its declaration, the same way.

- [ ] **Step 1: Imports**

After `import { TableGames } from './table-pieces';`, add:

```ts
import { DrawGame, type DrawOut, type Visitor } from './draw-game';
import { TvPanel, tvPanelView } from './draw-panel';
import { tvView } from './draw-tv';
```

- [ ] **Step 2: The game under `?debug`**

In the `if (params.has('debug')) Object.assign(window, { walkthrough: { … } });` line, replace `get games() { return games; } } });` with:

```ts
get games() { return games; }, get draw() { return draw; } } });
```

- [ ] **Step 3: One id factory for both kinds of game**

Replace

```ts
  const games = new Games(selfId, () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
```

with:

```ts
  /** Ids for new games: not `crypto.randomUUID`, which phones on a LAN address don't have. */
  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const games = new Games(selfId, newId);
```

- [ ] **Step 4: `held` belongs to both panels now**

In `toggleSit`, replace `    if (player.held) return standFromBoard(); // at a game board: asks first while a game runs` with:

```ts
    if (atBoard) return standFromBoard(); // at a game board: asks first while a game runs
```

In `updateGames`, replace

```ts
      if (boardPanel.isOpen) boardPanel.close();
      atBoard = null;
      player.held = false;
      return;
    }
    if (!boardPanel.isOpen || atBoard?.slot !== seat.slot) {
      boardPanel.open(SLOTS[seat.slot].title, board);
```

with:

```ts
      if (boardPanel.isOpen) boardPanel.close();
      atBoard = null;
      player.held = tvPanel.isOpen;
      return;
    }
    if (!boardPanel.isOpen || atBoard?.slot !== seat.slot) {
      closeTv(false); // one panel at a time: the board's
      boardPanel.open(SLOTS[seat.slot].title, board);
```

- [ ] **Step 5: The game, the TV and its panel**

Insert just before `  ui.setName(loadName(() => localStorage));`:

```ts
  /** Draw and guess on the Sala TV (draw-game.ts): the game, the TV showing it, and the TV's panel. */
  const tv = world.screens.find((s) => s.isTv) ?? null;
  const draw = new DrawGame(selfId, newId);
  const sendDraw = (out: DrawOut[]) => {
    for (const o of out) others?.sendDraw(o.msg, o.to);
  };
  /** Everyone here, this visitor first, with when they arrived: the players' order and the game's leader come from it. */
  const visitors = (): Visitor[] => [{ id: selfId(), name: cleanName(ui.getName()), arrived, since: joinedAt }, ...(others?.people ?? [])];
  /** The remote's buttons do what a click on the TV did, shared the same way; not while a game shows. */
  const remote = (press: () => void) => {
    if (!tv || draw.state) return;
    press();
    const t: Target = { kind: 'screen', screen: tv, node: tv.node };
    used(t);
    share(t);
  };
  const tvPanel = new TvPanel(document, {
    power: () => remote(() => tv?.power(performance.now() / 1000)),
    next: () => remote(() => tv?.nextChannel()),
    join: () => sendDraw(draw.setJoined(!draw.joined)),
    start: () => sendDraw(draw.start(visitors(), performance.now())),
    close: () => closeTv(true),
    choose: (word) => sendDraw(draw.choose(word, performance.now())),
    guess: (text) => sendDraw(draw.guess(text)),
    penDown: (colour, width, x, y) => draw.penDown(colour, width, x, y),
    penMove: (x, y) => draw.penMove(x, y),
    undo: () => sendDraw(draw.undo()),
    clear: () => sendDraw(draw.clear()),
  });
  /** A click or tap on the TV, or T: the mouse is freed for the panel, and the movement keys don't move you. */
  const openTv = () => {
    if (!started || autostart || atBoard || tvPanel.isOpen) return;
    tvPanel.open();
    freeMouse();
    player.held = true;
  };
  /** Close, Esc or T; `look`: the view looks around again (not after Esc, which only frees the mouse). */
  const closeTv = (look: boolean) => {
    if (!tvPanel.isOpen) return;
    tvPanel.close();
    player.held = atBoard !== null;
    if (look && cursor && !touch) lockPointer();
  };
  /** From the frame loop (`now` in ms): the game's step, the TV showing it, and the panel while it's open. */
  const updateDraw = (now: number) => {
    sendDraw(draw.update(now, visitors()));
    const s = draw.state;
    tv?.setGame(s ? tvView(s, draw.sketch.strokes, draw.timeLeft()) : null, now / 1000);
    if (!tvPanel.isOpen) return;
    const me = selfId();
    tvPanel.render(tvPanelView({
      me, tvOn: tv?.on ?? false, game: s, leftMs: draw.timeLeft(),
      joined: draw.playing(visitors()).map((v) => ({ name: v.name, colour: colourFor(v.id), you: v.id === me })),
      youJoined: draw.joined, secret: draw.secret, choices: draw.choices, close: draw.close,
    }), draw.sketch.strokes, draw.sketch.version);
  };
```

`now` in the frame loop is the `requestAnimationFrame` timestamp, on the same clock as `performance.now()`, which the handlers and the network hooks use.

- [ ] **Step 6: Over the network**

In `joinOthers`, in the hooks passed to `new Multiplayer(…)`, after `games: () => games.messages(),`, add:

```ts
        onDraw: (m, from) => sendDraw(draw.receive(m, from, performance.now())),
        onArrive: (id) => sendDraw(draw.greet(id)),
```

- [ ] **Step 7: Clicks, taps and keys**

In `ui.onResume(…)`, replace `    } else if (boardPanel.isOpen) { // at a game board the mouse stays free for the panel` with:

```ts
    } else if (boardPanel.isOpen || tvPanel.isOpen) { // with a panel open the mouse stays free for it
```

In the touch controls' `tap` handler, replace

```ts
      if (!started || paused) return;
      const r = canvas.getBoundingClientRect();
      const t = interactions.tap(new Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2));
      sitOn(t);
```

with:

```ts
      if (!started || paused || tvPanel.isOpen) return;
      const r = canvas.getBoundingClientRect();
      const t = interactions.tap(new Vector2(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2));
      if (t?.kind === 'screen' && t.screen.isTv) return openTv();
      sitOn(t);
```

In the `mousedown` listener, replace

```ts
    if (cursor && e.button === 0 && e.target === canvas) { // a click on the view looks around again, but not at a board
      if (!boardPanel.isOpen) lockPointer();
      return;
    }
    if (e.button !== 0 || !(autostart || document.pointerLockElement === canvas)) return;
    const t = interactions.click();
    sitOn(t);
```

with:

```ts
    if (cursor && e.button === 0 && e.target === canvas) { // a click on the view looks around again, but not in a panel
      if (!boardPanel.isOpen && !tvPanel.isOpen) lockPointer();
      return;
    }
    if (e.button !== 0 || !(autostart || document.pointerLockElement === canvas)) return;
    const t = interactions.click();
    if (t?.kind === 'screen' && t.screen.isTv) return openTv();
    sitOn(t);
```

In the `keydown` listener's Tab branch, replace `      if (touch || !started || paused || autostart || e.repeat || boardPanel.isOpen) return;` with:

```ts
      if (touch || !started || paused || autostart || e.repeat || boardPanel.isOpen || tvPanel.isOpen) return;
```

Replace `    if (touch && e.code === 'Escape' && started && !autostart) return setPausedState(true); // a tablet's keyboard` with:

```ts
    if (e.code === 'Escape' && tvPanel.isOpen) return closeTv(false); // the panel first; Esc again pauses
    if (touch && e.code === 'Escape' && started && !autostart) return setPausedState(true); // a tablet's keyboard
```

After the `KeyG` line (`    if (e.code === 'KeyG' && started && … return toggleGuests(); // paused too`), add:

```ts
    if (e.code === 'KeyT' && started && !paused && !autostart && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) return tvPanel.isOpen ? closeTv(true) : openTv();
```

- [ ] **Step 8: The frame loop**

After `    updateGames(dt, now / 1000);`, add:

```ts
    updateDraw(now);
```

Replace the start of the `ui.setPrompt(` line, `    ui.setPrompt(boardPanel.isOpen ? null : target`, with:

```ts
    ui.setPrompt(boardPanel.isOpen || tvPanel.isOpen ? null : target
```

(the rest of that line stays as it is). In the screens loop, replace `      if (s.info.group) world.lights.set(s.info.group, s.on); // the TV's bias light` with:

```ts
      if (s.info.group) world.lights.set(s.info.group, s.lit); // the TV's bias light, on with a game too
```

- [ ] **Step 9: Controls on the start screen**

In `web/index.html`, in the keys-only "Using things" list, after the `<li>` that starts `<li><span><kbd>Click</kbd></span> a chair at the chessboard`, add:

```html
              <li><span><kbd>T</kbd></span> the TV: its remote, and draw and guess with the others (or click the TV)</li>
```

In the touch-only controls list, after the `<li>` that starts `<li><span><kbd>Tap</kbd></span> a chair at the chessboard`, add:

```html
              <li><span><kbd>Tap</kbd></span> the TV for its remote, and to draw and guess with the others</li>
```

- [ ] **Step 10: README**

In `README.md`:

- In "Naming the pipeline relies on", at the end of the `web_screen = "tv" | "monitor" | "laptop"` item, replace `and follows the TV.` with `and follows the TV (on, or showing a game).`
- In the Controls paragraph, replace `(the TV steps through its channels, then switches off)` with `(a click on the TV opens its panel: the remote, and draw and guess)`, and replace `G shows who's here, ` with `G shows who's here, T opens or closes the TV's panel, `.
- In the touch paragraph, after `Tap a chair at the chessboard, the backgammon case or the Go board on the dining table to play.` add ` Tap the TV for its remote and to draw and guess.`
- In "Visitors together", after the paragraph that starts `Go is played on a 9×9 board`, add:

```markdown
Visitors can play draw and guess on the Sala's TV, best with three to six. A click on the TV (or T, from anywhere) opens its panel, with the mouse freed: the remote (On/Off and Next channel, shared with everyone as before) and the game's lobby. Press Join to play; with two or more joined, any player presses Start. Each player draws once, in the order they arrived: the drawer picks one of three words (one is picked for them after 15 s) and has 80 seconds to draw it on the panel's canvas, with eight colours, two pen sizes, an eraser, Undo and Clear (mouse, pen or touch). Everyone in the flat sees the drawing live on the TV, with the time, the blanks and the scores beside it; the players also see it in their panel, with the word as blanks (one letter shows at half time and another at three quarters, never more than half the word) and a box for guesses (Enter sends). Case, accents, spaces and hyphens don't matter. A right guess scores 300 points at the start of the drawing time down to 100 at its end, and the drawer 50; a guess one letter off tells only its guesser it's close; wrong guesses show in the feed. The turn ends when the time is up or everyone has the word, the word shows for 5 s with the turn's points, and the next player draws; after the last turn the final scores show for 15 s, ties sharing a place. You can join during a game (you guess straight away and draw at the end), and leave with Leave or by closing the tab: your score stays on the board, and with fewer than two players left the game ends. While a game runs the TV shows it whatever its channel, even switched off, and the remote waits ("A game is on"). The panel closes with Close, Esc or T and opens again any time; the game goes on. While it's open the movement keys don't move you, and typing a guess never triggers the walkthrough's keys. There is still no server: the drawer's browser holds the game (the word never leaves it before the reveal), judges the guesses sent to it alone, and hands the game to the next drawer; if the drawer's tab goes (or is hidden for 15 s), the player who arrived first ends that turn with no points and passes it on. It all travels in a `draw` message, and visitors on an older version see the TV's channel. The words are in `web/src/draw-words.ts`, the timing and points in `CONFIG.draw`; the design note is `docs/superpowers/specs/2026-10-28-tv-draw-and-guess-design.md`.
```

- [ ] **Step 11: Build and test**

Run: `cd web && npm test && npm run build`
Expected: 52 test files, 522 tests pass; the build finishes with no TypeScript errors (the existing chunk-size warning is fine).

- [ ] **Step 12: Commit**

```bash
git add web/src/main.ts web/index.html README.md
git commit -m "TV draw and guess: wired into the walkthrough, the controls and the README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Check it in the browser, update the design note

Integration, by hand. Fix anything at fault in the file responsible, re-run `npm test && npm run build`, and commit each fix on its own.

**Files:**
- Any file at fault if a check fails.
- Modify: `docs/superpowers/specs/2026-10-28-tv-draw-and-guess-design.md` (the status line)

Automated clicks can't take the pointer lock, so these checks use `?debug` (`window.walkthrough` has `player`, `world`, `others`, `draw`) and dispatch events on the panel. Read state with `javascript_tool`, which works on background tabs too. Background tabs in the Browser pane keep running their frame loop, slowly (about once a second): an owner's clock still runs there, but give it a second or two. A background tab's panel may not have rendered its latest state, so front a tab (`tabs_select`) before clicking its buttons. Synthetic pointer events need `pointerId`, `clientX`, `clientY`, `bubbles: true` and `button: 0`.

- [ ] **Step 1: Start the dev server**

Use the preview tool with the `walkthrough` configuration in `.claude/launch.json` (it runs `npm --prefix web run dev` on port 5173). Do not start it from Bash.

- [ ] **Step 2: Three visitors, the lobby**

Open three tabs on `http://localhost:5173/?room=draw-check-<random>&debug`, a few seconds apart, named "Ana", "Rui" and "Zé" (in each: untick `#voice`, set `#name`, click `#start-button`). Wait until `walkthrough.others.people.length === 2` in each.

In Ana's tab: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }))`.
Expected: the panel opens with "TV", Turn on / Next channel (disabled while off), "Draw and guess", no players, "Two or more players to start", Join, Start disabled; `walkthrough.player.held` is true; the sun panel is hidden. Holding W (`keydown` `KeyW` on `window`) does not move Ana. T again closes it; T opens it again.

Click Turn on (`#tv-power`): every tab's TV is on (`walkthrough.world.screens.find((s) => s.isTv).on`), and Next channel steps the channel in every tab, round to the first after the last.

Click Join in Ana's and Rui's panels (front each tab first). Expected: both lobbies list "Ana" and "Rui" (with " (you)" on your own), and Start is enabled in both; Zé's lobby (not joined) says "Join to play".

- [ ] **Step 3: A whole game**

Zé joins; Rui clicks Start. Expected in all three: the panels become "Draw and guess"; Ana (first to arrive) sees three word buttons over the canvas and "Choose a word to draw"; the others "Ana is choosing a word"; the TV shows "Ana is choosing a word" on a white card, the time and the scores beside it, even though it was on a channel; Turn on / Next channel are disabled with "A game is on" (check in an onlooker's lobby later).

In Ana's tab (in front), click a word, then draw:

```js
const c = document.getElementById('draw-canvas'); const r = c.getBoundingClientRect();
const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { clientX: r.left + x * r.width, clientY: r.top + y * r.height, pointerId: 1, bubbles: true, button: 0 }));
ev('pointerdown', 0.2, 0.3); for (let i = 1; i <= 10; i++) ev('pointermove', 0.2 + i * 0.05, 0.3 + i * 0.03); ev('pointerup', 0.7, 0.6);
document.querySelectorAll('.draw-colour')[2].click(); document.getElementById('draw-broad').click();
ev('pointerdown', 0.5, 0.8); ev('pointermove', 0.8, 0.8); ev('pointerup', 0.8, 0.8);
```

Expected: Ana's head shows the word spelled out, the tools show; within a second `walkthrough.draw.sketch.strokes` in Rui's and Zé's tabs equals Ana's (a black line of 11 points and a broad red one); their panels show the word as blanks and the guess box. Undo (`#draw-undo`) removes the red line everywhere, Clear the rest. Draw again.

Teleport Zé in front of the TV to look at it:

```js
const tv = walkthrough.world.screens.find((s) => s.isTv); const [cx, , cz] = tv.info.center; const [nx, , nz] = tv.info.normal;
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); walkthrough.player.teleport(cx + nx * 3, cz + nz * 3, Math.atan2(nx, nz), -0.1);
```

Expected: the drawing on the white card on the left two thirds, the time, the blanks and the scores (Ana with a pencil) down the right; the Sala brightens with the TV's light. (The card on the TV is the drawing's 4:3, so a circle drawn in the panel is a circle on the TV.) No console errors (`read_console_messages`).

In Rui's tab, type into the guess box and send, in turn: a word one letter off the real one (if it has 4 letters or more), a wrong word, then the word in capitals:

```js
const i = document.getElementById('draw-guess-text'); const f = document.getElementById('draw-guess');
i.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true })); // must not walk
i.value = '<one letter off>'; f.requestSubmit();
```

Expected: `walkthrough.player.keys.forward` stays false; only Rui's panel shows `"<guess>" is close!`; every panel's feed shows "Rui: <guess>" for the close and the wrong one, then "Rui guessed it!"; Rui's box goes away with "You guessed it!"; Rui's score is 100–300 by the time left, Ana's 50; Rui's row has a tick on the TV. When Zé guesses it too, the turn ends at once: "The word was …" with the turn's points ("Zé +…   Rui +…   Ana +…") on the TV and in the panels for 5 s, then Rui chooses (Rui's browser now owns the game: `walkthrough.draw.state.owner === walkthrough.others.selfId` in Rui's tab).

Let Rui's 15 s run out: a word is picked for Rui. Let the hints come: at 40 s one letter shows in the blanks, at 20 s left another (never more than half the letters). Play Zé's turn the same way. After the last turn: "Final scores" on the TV and in the panels, highest first, ties sharing a place; 15 s later the TV is back on its channel (or dark if it was off), and the panels show the lobby with Start enabled.

- [ ] **Step 4: Joining and leaving mid-game**

Start another game (Ana, Rui, Zé joined). During Ana's drawing, open a fourth tab "Mia" on the same room. Expected: Mia's TV shows the game and the drawing so far at once; her panel shows the lobby with "A game is on. Join to guess, and draw later."; after Join, her panel turns into the game with the guess box, and `walkthrough.draw.state.queue` (any tab) ends with Mia's id.

Rui presses Leave (`#tv-leave`). Expected: "Rui left" in the feed, Rui's score dimmed but kept, Rui out of the queue, Rui's panel back to the lobby.

Close Ana's tab while she draws (`tabs_close`). Expected within a second or two (the leave event; at most 15 s): Zé (the earliest arrival still playing) takes over: "Ana left" in the feed, the points of that turn taken back, and the next player in the queue chooses a word; `state.seq` jumped by over 1000.

Close tabs until one player is left. Expected: the final scores, then nothing.

- [ ] **Step 5: A phone**

Resize one tab to the mobile preset and reload it (the touch controls need the reload), rejoin, start a game where that tab draws. Expected: a tap on the TV (aim at it first with `walkthrough.player.teleport` as in Step 3, then `tap` the screen's middle with the computer tool) opens the panel, nearly full width; the canvas fills the width, the tools wrap below it, then the scores, the feed and the guess box. Drawing with the computer tool's `left_click_drag` on the canvas draws and does not turn the view or walk; the guess box doesn't pop the keyboard up by itself. Reset the viewport to desktop afterwards.

- [ ] **Step 6: The design note**

In `docs/superpowers/specs/2026-10-28-tv-draw-and-guess-design.md`, replace `**Status:** Approved` with:

```markdown
**Status:** Implemented
```

```bash
git add docs/superpowers/specs/2026-10-28-tv-draw-and-guess-design.md
git commit -m "TV draw and guess: implemented, in the design note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Screenshot**

Take a screenshot of the TV during a drawing (Step 3's view) and of a player's panel, for the pull request.
