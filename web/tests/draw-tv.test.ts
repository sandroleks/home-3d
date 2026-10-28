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
  it('lights the room less during the reveal, whose dark band covers a fifth of the card', () => {
    const drawing = gameMean(view({}))[0];
    const reveal = gameMean(view({ phase: 'reveal', hint: 'cat', word: 'cat', gains: [] }))[0];
    expect(reveal).toBeLessThan(drawing - 0.1);
  });
  it('lights the room bright and neutral: mostly the white card', () => {
    const [r, , b] = gameMean(view({}));
    expect(r).toBeGreaterThan(0.6);
    expect(Math.abs(r - b)).toBeLessThan(0.05);
    expect(gameMean(view({ phase: 'end' }))[0]).toBeGreaterThan(r);
  });
});
