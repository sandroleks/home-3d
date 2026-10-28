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
