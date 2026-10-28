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
