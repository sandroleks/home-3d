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
