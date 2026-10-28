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
