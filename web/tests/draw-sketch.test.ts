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
