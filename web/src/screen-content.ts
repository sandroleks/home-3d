import { type DrawTv, drawGameTv, gameMean } from './draw-tv';

/** Anything with a 2D context: an HTMLCanvasElement or OffscreenCanvas in the browser, a stub in tests. */
export interface Surface { width: number; height: number; getContext(type: '2d'): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null }
/** What the screens may show about the walkthrough's world: Lisbon local time of the simulated clock. */
export interface ScreenWorld { hour: number; minute: number; day: number; month: number; year: number; temperatureC?: number }

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Rgb = [number, number, number];
type Rand = () => number;
interface Scene {
  draw(t: number, world: ScreenWorld): void;
  /** Mean sRGB (0..1) of a frame at t, from the colours the scene paints and the share of the frame they cover. */
  mean(t: number, world: ScreenWorld): Rgb;
}
interface Rect { x: number; y: number; w: number; h: number }

const TAU = Math.PI * 2;
/** The TV scenes are drawn in this space and scaled to the surface. */
const TV_W = 512;
const TV_H = 288;
const BADGE_TIME = 2.5;
const NOISE_TIME = 0.25;
/** The light tint changes at most this often. */
const AVERAGE_EVERY = 0.25;
const SANS = 'system-ui, sans-serif';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const wrap = (v: number, m: number) => ((v % m) + m) % m;
const smooth = (v: number) => v * v * (3 - 2 * v);
const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** Seeded generator, so a scene's fish, clouds and stars are the same on every draw. */
function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function css(c: Rgb): string {
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}

/** Weighted mean of colours; the weights need not add up to 1. */
function blend(parts: [Rgb, number][]): Rgb {
  const out: Rgb = [0, 0, 0];
  let total = 0;
  for (const [c, w] of parts) {
    for (let i = 0; i < 3; i++) out[i] += c[i] * w;
    total += w;
  }
  return [out[0] / total, out[1] / total, out[2] / total];
}

/** Mean of a linear gradient with evenly spaced stops. */
function gradientMean(stops: string[]): Rgb {
  return blend(stops.map((s, i) => [rgb(s), i === 0 || i === stops.length - 1 ? 0.5 : 1]));
}

function linear(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: string[]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

/** Centred on the origin: translate before filling with it. */
function radial(ctx: Ctx, r: number, inner: string, outer: string): CanvasGradient {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  return g;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Adds an ellipse as its own subpath, so several fill as one shape. */
function blob(ctx: Ctx, x: number, y: number, rx: number, ry: number): void {
  ctx.moveTo(x + rx, y);
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
}

function cloud(ctx: Ctx, x: number, y: number, s: number, light: string, shade: string): void {
  ctx.fillStyle = shade;
  ctx.beginPath();
  blob(ctx, x + 2 * s, y + 5 * s, 34 * s, 6 * s);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  blob(ctx, x - 14 * s, y + 1 * s, 17 * s, 7 * s);
  blob(ctx, x + 4 * s, y - 3 * s, 19 * s, 10 * s);
  blob(ctx, x + 22 * s, y + 2 * s, 14 * s, 6 * s);
  ctx.fill();
}

function textWidth(ctx: Ctx, text: string, perChar: number): number {
  const w = ctx.measureText(text).width;
  return Number.isFinite(w) && w > 0 ? w : text.length * perChar;
}

/** "21:05". */
export function clockText(w: ScreenWorld): string {
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

let dateKey = '';
let dateCache = '';

/** "Sáb 24 Out". */
export function dateText(w: ScreenWorld): string {
  const key = `${w.year}-${w.month}-${w.day}`;
  if (key !== dateKey) {
    const weekday = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
    dateKey = key;
    dateCache = `${WEEKDAYS[weekday] ?? ''} ${w.day} ${MONTHS[w.month - 1] ?? ''}`;
  }
  return dateCache;
}

/** "Sáb 24 Out · 21:05". */
export function dateTimeText(w: ScreenWorld): string {
  return `${dateText(w)} · ${clockText(w)}`;
}

const isNight = (w: ScreenWorld) => w.hour >= 20 || w.hour < 7;

/** An Atlantic evening: low sun, rolling swell with glitter, clouds and a sailboat crossing. */
function coast(ctx: Ctx, rand: Rand): Scene {
  const horizon = 170;
  const skyStops = ['#26315e', '#6c4a78', '#c4687a', '#f3a865'];
  const seaStops = ['#5a6896', '#22335a', '#0d1830'];
  const sky = linear(ctx, 0, 0, 0, horizon, skyStops);
  const sea = linear(ctx, 0, horizon, 0, TV_H, seaStops);
  const glow = radial(ctx, 130, 'rgba(255,214,150,0.7)', 'rgba(255,170,110,0)');
  const sunX = 342;
  const clouds = Array.from({ length: 5 }, () => ({ x: rand() * 680, y: 24 + rand() * 80, s: 0.6 + rand() * 0.7, v: 2 + rand() * 4 }));
  const glints = Array.from({ length: 48 }, () => {
    const d = rand();
    return { x: (rand() - 0.5) * (30 + 220 * d), y: horizon + 3 + d * d * (TV_H - horizon - 6), f: 1.2 + rand() * 2.5, p: rand() * TAU };
  });
  const waves = Array.from({ length: 9 }, (_, r) => {
    const d = (r + 1) / 9;
    return {
      base: horizon + 3 + d * d * (TV_H - horizon - 4), amp: 0.5 + d * 3.2, k: TAU / (26 + d * 70), v: 0.5 + d * 0.5, p: r * 1.9,
      width: 0.7 + d * 1.3, colour: `rgba(178,196,236,${(0.12 + 0.16 * d).toFixed(3)})`,
    };
  });
  const mean = blend([[gradientMean(skyStops), 0.59], [gradientMean(seaStops), 0.41], [rgb('#ffd9a0'), 0.04]]);
  return {
    mean: () => mean,
    draw(t) {
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, TV_W, horizon);
      const sunY = horizon - 20 + 4 * Math.sin(t * 0.06);
      ctx.save();
      ctx.translate(sunX, sunY);
      ctx.fillStyle = glow;
      ctx.fillRect(-130, -130, 260, 260);
      ctx.restore();
      ctx.fillStyle = '#ffe3ae';
      ctx.beginPath();
      ctx.arc(sunX, sunY, 17, 0, TAU);
      ctx.fill();
      for (const c of clouds) cloud(ctx, wrap(c.x + c.v * t, 680) - 90, c.y, c.s, 'rgba(255,196,180,0.5)', 'rgba(120,80,120,0.3)');
      ctx.fillStyle = sea;
      ctx.fillRect(0, horizon, TV_W, TV_H - horizon);
      ctx.fillStyle = '#ffc98e';
      for (let i = 0; i < 16; i++) {
        const w = (8 + i * 4) * (0.6 + 0.4 * Math.sin(t * 1.6 + i * 1.3));
        ctx.globalAlpha = 0.6 - i * 0.032;
        ctx.fillRect(sunX - w / 2 + 3 * Math.sin(t * 0.8 + i), horizon + 2 + i * i * 0.42, w, 1.2 + i * 0.1);
      }
      ctx.globalAlpha = 1;
      for (const w of waves) {
        const phase = t * w.v + w.p;
        ctx.strokeStyle = w.colour;
        ctx.lineWidth = w.width;
        ctx.beginPath();
        for (let x = -8; x <= TV_W + 8; x += 12) {
          const y = w.base + w.amp * Math.sin(x * w.k + phase) + w.amp * 0.35 * Math.sin(x * w.k * 2.3 - phase * 1.4);
          if (x === -8) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#fff0d0';
      for (const g of glints) {
        const s = Math.sin(t * g.f + g.p);
        if (s < 0.55) continue;
        ctx.globalAlpha = (s - 0.55) / 0.45;
        ctx.fillRect(sunX + g.x, g.y, 2.5, 1);
      }
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(wrap(t * 6 + 120, 620) - 50, horizon + 20 + Math.sin(t * 1.3) * 1.2);
      ctx.rotate(Math.sin(t * 1.1) * 0.05);
      ctx.fillStyle = '#151a28';
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(12, 0);
      ctx.lineTo(8, 4);
      ctx.lineTo(-9, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-0.6, -24, 1.2, 24);
      ctx.fillStyle = '#f6e3cf';
      ctx.beginPath();
      ctx.moveTo(1, -23);
      ctx.lineTo(11, -2);
      ctx.lineTo(1, -2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e2bfae';
      ctx.beginPath();
      ctx.moveTo(-1, -20);
      ctx.lineTo(-1, -2);
      ctx.lineTo(-9, -2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}

/** A tank: light rays, swaying weed, fish with wagging tails and rising bubbles. */
function aquarium(ctx: Ctx, rand: Rand): Scene {
  const waterStops = ['#2a8fc0', '#13608f', '#07304f'];
  const water = linear(ctx, 0, 0, 0, TV_H, waterStops);
  const sand = linear(ctx, 0, 250, 0, TV_H, ['#d2b981', '#9b8256']);
  const greens = ['#2f8f5b', '#3fa86a', '#24764a', '#5cb85c'];
  const plants = Array.from({ length: 10 }, (_, i) => ({ x: 16 + i * 50 + rand() * 30, h: 45 + rand() * 75, w: 2.5 + rand() * 3, colour: greens[i % 4], p: rand() * TAU }));
  const fish = ['#ff8c42', '#ffd23f', '#ee4266', '#3bceac', '#9b5de5', '#f15bb5', '#00bbf9'].map((colour) => ({
    colour, size: 0.7 + rand() * 0.8, x: rand() * 600, y: 40 + rand() * 180, v: 10 + rand() * 22, dir: rand() < 0.5 ? -1 : 1, p: rand() * TAU,
  }));
  const sources = [70, 300, 436];
  const bubbles = Array.from({ length: 18 }, (_, i) => ({ x: sources[i % 3] + (rand() - 0.5) * 10, r: 0.8 + rand() * 2.2, v: 16 + rand() * 26, p: rand() }));
  const pebbles = Array.from({ length: 12 }, () => ({ x: rand() * TV_W, y: 266 + rand() * 18, rx: 2 + rand() * 5, ry: 1.5 + rand() * 2 }));
  const mean = blend([[gradientMean(waterStops), 0.88], [rgb('#b89e6c'), 0.1], [rgb('#3a9a62'), 0.04]]);
  return {
    mean: () => mean,
    draw(t) {
      ctx.fillStyle = water;
      ctx.fillRect(0, 0, TV_W, TV_H);
      ctx.fillStyle = '#c8f0ff';
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let x = 0; x <= TV_W; x += 16) ctx.lineTo(x, 5 + 2.5 * Math.sin(x * 0.05 + t * 1.4) + 1.5 * Math.sin(x * 0.11 - t));
      ctx.lineTo(TV_W, 0);
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        const x = 40 + i * 105 + Math.sin(t * 0.17 + i * 1.7) * 18;
        ctx.globalAlpha = 0.05 + 0.05 * (0.5 + 0.5 * Math.sin(t * 0.45 + i * 2.1));
        ctx.beginPath();
        ctx.moveTo(x - 9, 0);
        ctx.lineTo(x + 13, 0);
        ctx.lineTo(x + 60, TV_H);
        ctx.lineTo(x - 10, TV_H);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = sand;
      ctx.beginPath();
      ctx.moveTo(0, TV_H);
      for (let x = 0; x <= TV_W; x += 32) ctx.lineTo(x, 258 + 5 * Math.sin(x * 0.013 + 0.8) + 3 * Math.sin(x * 0.041));
      ctx.lineTo(TV_W, TV_H);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#8c7650';
      ctx.beginPath();
      for (const p of pebbles) blob(ctx, p.x, p.y, p.rx, p.ry);
      ctx.fill();
      ctx.lineCap = 'round';
      for (const p of plants) {
        ctx.strokeStyle = p.colour;
        ctx.lineWidth = p.w;
        ctx.beginPath();
        ctx.moveTo(p.x, 268);
        for (let k = 1; k <= 6; k++) {
          const f = k / 6;
          ctx.lineTo(p.x + Math.sin(t * 0.8 + p.p + f * 2) * 9 * f * f, 268 - p.h * f);
        }
        ctx.stroke();
      }
      for (const f of fish) {
        const wag = Math.sin(t * (5 + f.v * 0.12) + f.p);
        ctx.save();
        ctx.translate(wrap(f.x + f.dir * f.v * t, 600) - 44, f.y + Math.sin(t * 0.7 + f.p) * 7);
        ctx.scale(f.dir * f.size, f.size);
        ctx.rotate(Math.cos(t * 0.7 + f.p) * 0.08);
        ctx.fillStyle = f.colour;
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.lineTo(-17, 6 + wag * 2.5); // same winding as the body, so the overlap stays filled
        ctx.lineTo(-15, wag);
        ctx.lineTo(-17, -6 + wag * 2.5);
        ctx.closePath();
        ctx.moveTo(-2, -5);
        ctx.lineTo(3, -9);
        ctx.lineTo(5, -4);
        ctx.closePath();
        blob(ctx, 0, 0, 11, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        blob(ctx, 1, 0, 1.6, 5);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(6, -1.5, 1.8, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#10141f';
        ctx.beginPath();
        ctx.arc(6.4, -1.5, 0.9, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(225,246,255,0.65)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (const b of bubbles) {
        const y = 268 - wrap(t * b.v + b.p * 300, 290);
        const x = b.x + Math.sin(t * 2.1 + b.p * TAU) * 2.5;
        ctx.moveTo(x + b.r, y);
        ctx.arc(x, y, b.r, 0, TAU);
      }
      ctx.stroke();
    },
  };
}

/** A calm info screen: Porto, the simulated time and date, the temperature when known, a sun by day and a moon by night. */
function weather(ctx: Ctx, rand: Rand): Scene {
  const dayStops = ['#2c69b0', '#5f9fd6', '#a6d4ef'];
  const nightStops = ['#0a1230', '#18224a', '#2c3866'];
  const day = linear(ctx, 0, 0, 0, TV_H, dayStops);
  const night = linear(ctx, 0, 0, 0, TV_H, nightStops);
  const sunGlow = radial(ctx, 80, 'rgba(255,224,130,0.5)', 'rgba(255,224,130,0)');
  const moonGlow = radial(ctx, 80, 'rgba(220,230,255,0.28)', 'rgba(220,230,255,0)');
  const stars = Array.from({ length: 36 }, () => ({ x: rand() * TV_W, y: rand() * 180, r: 0.6 + rand() * 1.1, f: 0.5 + rand() * 1.5, p: rand() * TAU }));
  const dayMean = blend([[gradientMean(dayStops), 0.94], [rgb('#ffd35c'), 0.04], [rgb('#ffffff'), 0.02]]);
  const nightMean = blend([[gradientMean(nightStops), 0.96], [rgb('#f2ecd4'), 0.03], [rgb('#ffffff'), 0.01]]);
  return {
    mean: (_t, w) => (isNight(w) ? nightMean : dayMean),
    draw(t, w) {
      const dark = isNight(w);
      ctx.fillStyle = dark ? night : day;
      ctx.fillRect(0, 0, TV_W, TV_H);
      const cx = 136;
      const cy = 132 + Math.sin(t * 0.6) * 3;
      if (dark) {
        ctx.fillStyle = '#ffffff';
        for (const s of stars) {
          ctx.globalAlpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * s.f + s.p));
          ctx.fillRect(s.x, s.y, s.r, s.r);
        }
        ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = dark ? moonGlow : sunGlow;
      ctx.fillRect(-80, -80, 160, 160);
      if (dark) {
        ctx.rotate(-0.35 + Math.sin(t * 0.3) * 0.05);
        ctx.fillStyle = '#f2ecd4';
        ctx.beginPath();
        ctx.arc(0, 0, 34, Math.PI / 2, Math.PI * 1.5);
        ctx.ellipse(0, 0, 13, 34, 0, Math.PI * 1.5, Math.PI / 2, true);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#ffd35c';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i * TAU) / 12 + t * 0.12;
          const r = 52 + 3 * Math.sin(t * 1.8 + i * 1.1);
          ctx.moveTo(Math.cos(a) * 42, Math.sin(a) * 42);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.stroke();
        ctx.fillStyle = '#ffc93f';
        ctx.beginPath();
        ctx.arc(0, 0, 32, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#ffe07e';
        ctx.beginPath();
        ctx.arc(-6, -6, 20, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      if (!dark) cloud(ctx, cx + 30 + Math.sin(t * 0.2) * 10, cy + 32, 0.9, 'rgba(255,255,255,0.92)', 'rgba(196,214,236,0.9)');
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 0.75;
      ctx.font = `600 13px ${SANS}`;
      ctx.fillText('PORTO', 262, 84);
      ctx.globalAlpha = 1;
      ctx.font = `600 66px ${SANS}`;
      ctx.fillText(clockText(w), 258, 150);
      ctx.globalAlpha = 0.9;
      ctx.font = `20px ${SANS}`;
      ctx.fillText(dateText(w), 262, 180);
      if (w.temperatureC !== undefined && Number.isFinite(w.temperatureC)) {
        ctx.font = `500 24px ${SANS}`;
        ctx.fillText(`${Math.round(w.temperatureC)} °C`, 262, 216);
      }
      const x0 = 48;
      const len = 416;
      const k = clamp01((w.hour * 60 + w.minute) / 1440);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x0, 250, len, 2);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x0, 250, len * k, 2);
      ctx.beginPath();
      ctx.arc(x0 + len * k, 251, 3 + 0.8 * Math.sin(t * 2.4), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.font = `10px ${SANS}`;
      ctx.fillText('00:00', x0, 268);
      ctx.textAlign = 'center';
      ctx.fillText('12:00', x0 + len / 2, 268);
      ctx.textAlign = 'right';
      ctx.fillText('24:00', x0 + len, 268);
      ctx.globalAlpha = 1;
    },
  };
}

interface Hill { base: number; amp: number; f1: number; f2: number; v: number; p: number; colour: string; trees: number[]; treeColour: string }

function hillY(h: Hill, x: number, off: number): number {
  const u = x + off;
  return h.base - h.amp * (0.6 * Math.sin(u * h.f1 + h.p) + 0.4 * Math.sin(u * h.f2 + 2 * h.p));
}

/** Rolling hills in parallax under a slowly brightening sky, with trees and a flock of birds. */
function nature(ctx: Ctx, rand: Rand): Scene {
  const morning = { top: rgb('#7c94c9'), bottom: rgb('#f5cfa0'), sun: rgb('#ffd59a') };
  const noon = { top: rgb('#3f87d4'), bottom: rgb('#c3e4f5'), sun: rgb('#fff6dc') };
  const glow = radial(ctx, 90, 'rgba(255,240,200,0.55)', 'rgba(255,240,200,0)');
  const trees = (n: number) => Array.from({ length: n }, () => rand() * 900);
  const hills: Hill[] = [
    { base: 160, amp: 20, f1: 0.011, f2: 0.027, v: 3, p: rand() * TAU, colour: '#93b8b0', trees: [], treeColour: '' },
    { base: 186, amp: 18, f1: 0.014, f2: 0.035, v: 8, p: rand() * TAU, colour: '#6fa274', trees: [], treeColour: '' },
    { base: 216, amp: 16, f1: 0.017, f2: 0.043, v: 16, p: rand() * TAU, colour: '#4c8a4c', trees: trees(7), treeColour: '#336b36' },
    { base: 250, amp: 13, f1: 0.021, f2: 0.05, v: 30, p: rand() * TAU, colour: '#2f6a35', trees: trees(5), treeColour: '#1f4d25' },
  ];
  const clouds = Array.from({ length: 4 }, () => ({ x: rand() * 700, y: 26 + rand() * 60, s: 0.6 + rand() * 0.6, v: 3 + rand() * 4 }));
  const birds = Array.from({ length: 7 }, (_, i) => {
    const rank = Math.ceil(i / 2);
    return { dx: -rank * 13 + rand() * 3, dy: (i % 2 ? 1 : -1) * rank * 6 + rand() * 2, s: 0.8 + rand() * 0.4, p: rand() * TAU };
  });
  const land = blend(hills.map((h) => [rgb(h.colour), 1]));
  const light = (t: number) => 0.5 - 0.5 * Math.cos((t * TAU) / 120);
  return {
    mean(t) {
      const k = light(t);
      return blend([[mix(mix(morning.top, noon.top, k), mix(morning.bottom, noon.bottom, k), 0.5), 0.55], [land, 0.45]]);
    },
    draw(t) {
      const k = light(t);
      const sky = ctx.createLinearGradient(0, 0, 0, 200);
      sky.addColorStop(0, css(mix(morning.top, noon.top, k)));
      sky.addColorStop(1, css(mix(morning.bottom, noon.bottom, k)));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, TV_W, TV_H);
      const sunY = 128 - 72 * k;
      ctx.save();
      ctx.translate(396, sunY);
      ctx.fillStyle = glow;
      ctx.fillRect(-90, -90, 180, 180);
      ctx.restore();
      ctx.fillStyle = css(mix(morning.sun, noon.sun, k));
      ctx.beginPath();
      ctx.arc(396, sunY, 15, 0, TAU);
      ctx.fill();
      for (const c of clouds) cloud(ctx, wrap(c.x + c.v * t, 700) - 90, c.y, c.s, 'rgba(255,255,255,0.8)', 'rgba(210,220,236,0.6)');
      ctx.strokeStyle = '#2b2d38';
      ctx.lineWidth = 1.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const fx = wrap(t * 15 + 260, 720) - 100;
      const fy = 84 + Math.sin(t * 0.3) * 10;
      for (const b of birds) {
        const x = fx + b.dx;
        const y = fy + b.dy + Math.sin(t * 0.9 + b.p) * 2;
        const flap = Math.sin(t * 7 + b.p) * 3.2 * b.s;
        const s = 5 * b.s;
        ctx.moveTo(x - s, y - flap);
        ctx.quadraticCurveTo(x - s * 0.4, y - 1.5, x, y);
        ctx.quadraticCurveTo(x + s * 0.4, y - 1.5, x + s, y - flap);
      }
      ctx.stroke();
      for (const h of hills) {
        const off = t * h.v;
        ctx.fillStyle = h.colour;
        ctx.beginPath();
        ctx.moveTo(0, TV_H);
        for (let x = 0; x <= TV_W; x += 8) ctx.lineTo(x, hillY(h, x, off));
        ctx.lineTo(TV_W, TV_H);
        ctx.closePath();
        ctx.fill();
        if (!h.trees.length) continue;
        const s = h.v / 16;
        ctx.fillStyle = h.treeColour;
        ctx.beginPath();
        for (const tx of h.trees) {
          const x = wrap(tx - off, 900) - 40;
          if (x < -20 || x > TV_W + 20) continue;
          const y = hillY(h, x, off);
          ctx.rect(x - 0.8 * s, y - 6 * s, 1.6 * s, 6 * s);
          blob(ctx, x, y - 11 * s, 4.5 * s, 8 * s);
        }
        ctx.fill();
      }
    },
  };
}

const CHANNELS: { id: string; name: string; make: (ctx: Ctx, rand: Rand) => Scene }[] = [
  { id: 'coast', name: 'Costa', make: coast },
  { id: 'aquarium', name: 'Aquário', make: aquarium },
  { id: 'weather', name: 'Tempo', make: weather },
  { id: 'nature', name: 'Natureza', make: nature },
];

/** The TV's channels in the order the remote steps through them. */
export const TV_CHANNELS: readonly { id: string; name: string }[] = CHANNELS.map(({ id, name }) => ({ id, name }));

const GREYS = Array.from({ length: 8 }, (_, i) => css([0.12 + i * 0.11, 0.12 + i * 0.11, 0.13 + i * 0.11]));
const NOISE_MEAN: Rgb = [0.5, 0.5, 0.5];

function toLinear(c: Rgb): Rgb {
  return [clamp01(c[0]) ** 2.2, clamp01(c[1]) ** 2.2, clamp01(c[2]) ** 2.2];
}

/** The living-room TV: generated channels, a badge and a burst of static on every channel change. */
export class TvContent {
  channel = 0;
  private ctx: Ctx | null;
  private scenes: Scene[] = [];
  /** The next draw restarts the badge (and the static, when `noisy`). */
  private changed = true;
  private noisy = false;
  private changedAt = 0;
  private noiseUntil = -1;
  private avg: Rgb = [0, 0, 0];
  private avgAt = -Infinity;
  /** A game of draw and guess, shown instead of the channel (draw-tv.ts); null shows the channel. */
  private game: DrawTv | null = null;

  constructor(private surface: Surface) {
    const ctx = surface.getContext('2d');
    this.ctx = ctx;
    if (ctx) this.scenes = CHANNELS.map((c, i) => c.make(ctx, mulberry32(0x5eed + i * 7919)));
  }

  /** Next channel; returns false (and stays on the last channel) when already on the last one, so the caller can switch the TV off instead. */
  next(): boolean {
    if (this.channel >= TV_CHANNELS.length - 1) return false;
    this.channel++;
    this.changed = true;
    this.noisy = true;
    return true;
  }

  /** Straight to a channel (clamped), as another visitor's TV shows it. */
  setChannel(channel: number): void {
    const c = Math.max(0, Math.min(TV_CHANNELS.length - 1, Math.round(channel)));
    if (c === this.channel) return;
    this.channel = c;
    this.changed = true;
    this.noisy = true;
  }

  /** Shows a game instead of the channel, or (null) the channel again, its badge first. */
  setGame(view: DrawTv | null): void {
    if (!view && this.game) this.changed = true;
    this.game = view;
  }

  /** Back to the first channel, for switching the TV on again. */
  reset(): void {
    this.channel = 0;
    this.changed = true;
    this.noisy = false;
    this.noiseUntil = -1;
  }

  /** Draws one frame. t = seconds since the TV was switched on (monotonic), world = current simulated time. */
  draw(t: number, world: ScreenWorld): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const index = Math.min(TV_CHANNELS.length - 1, Math.max(0, Math.floor(this.channel) || 0));
    if (this.changed || t < this.changedAt) {
      this.changedAt = t;
      this.noiseUntil = this.noisy ? t + NOISE_TIME : -1;
      this.changed = this.noisy = false;
      this.avgAt = -Infinity;
    }
    ctx.setTransform(this.surface.width / TV_W, 0, 0, this.surface.height / TV_H, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.game) {
      drawGameTv(ctx, this.game);
      this.avg = toLinear(gameMean(this.game));
      return;
    }
    this.scenes[index].draw(t, world);
    const since = t - this.changedAt;
    if (since < BADGE_TIME) this.badge(ctx, index, since);
    let noise = 0;
    if (t < this.noiseUntil) {
      noise = since < NOISE_TIME * 0.6 ? 1 : clamp01((this.noiseUntil - t) / (NOISE_TIME * 0.4));
      ctx.globalAlpha = noise;
      this.noise(ctx, t, index);
      ctx.globalAlpha = 1;
    }
    if (t - this.avgAt >= AVERAGE_EVERY || t < this.avgAt) {
      this.avgAt = t;
      this.avg = toLinear(mix(this.scenes[index].mean(t, world), NOISE_MEAN, noise));
    }
  }

  /** Mean linear RGB (0..1) of the last drawn frame, refreshed at most every 0.25 s of t; tints the light the TV casts. */
  average(): [number, number, number] {
    return [this.avg[0], this.avg[1], this.avg[2]];
  }

  private badge(ctx: Ctx, index: number, since: number): void {
    const name = TV_CHANNELS[index].name;
    ctx.globalAlpha = since < BADGE_TIME - 0.5 ? 1 : clamp01((BADGE_TIME - since) / 0.5);
    ctx.font = `500 13px ${SANS}`;
    const w = textWidth(ctx, name, 7);
    ctx.fillStyle = 'rgba(12,14,22,0.6)';
    roundRect(ctx, 14, 14, 38 + w, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#f2c94c';
    roundRect(ctx, 18, 18, 18, 18, 4);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4f5fa';
    ctx.textAlign = 'left';
    ctx.fillText(name, 42, 27.5);
    ctx.fillStyle = '#14161f';
    ctx.textAlign = 'center';
    ctx.font = `700 12px ${SANS}`;
    ctx.fillText(String(index + 1), 27, 27.5);
    ctx.globalAlpha = 1;
  }

  /** Rows of grey streaks, new every 1/30 s but the same for the same t. */
  private noise(ctx: Ctx, t: number, index: number): void {
    const rand = mulberry32(Math.floor(t * 30) * 7919 + index * 104729 + 17);
    for (let y = 0; y < TV_H; y += 3) {
      for (let x = 0; x < TV_W;) {
        const len = 10 + rand() * 50;
        ctx.fillStyle = GREYS[(rand() * GREYS.length) | 0];
        ctx.fillRect(x, y, len, 3);
        x += len;
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, wrap(t * 900, TV_H + 20) - 20, TV_W, 14);
  }
}

interface Token { text: string; col: number; colour: string }
interface CodeLine { tokens: Token[]; length: number }

const SYNTAX = {
  comment: '#6a7394', string: '#a5d68b', number: '#f0a35e', keyword: '#c792ea', type: '#ffcb6b', call: '#82aaff', name: '#d6deeb', punct: '#89ddff',
};
const KEYWORDS = new Set([
  'const', 'let', 'import', 'from', 'export', 'function', 'return', 'class', 'extends', 'private', 'for', 'of', 'if', 'new', 'this',
  'true', 'false', 'void', 'number', 'string', 'boolean',
]);

/** Splits a line into coloured runs; neighbouring runs of one colour are merged so a line costs few fillText calls. */
function tokenize(src: string): CodeLine {
  const tokens: Token[] = [];
  for (const m of src.matchAll(/(\/\/.*)|('[^']*')|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g)) {
    const [text, comment, str, num, word, space] = m;
    if (space) continue;
    const col = m.index ?? 0;
    let colour = SYNTAX.punct;
    if (comment) colour = SYNTAX.comment;
    else if (str) colour = SYNTAX.string;
    else if (num) colour = SYNTAX.number;
    else if (word) colour = KEYWORDS.has(word) ? SYNTAX.keyword : /^[A-Z]/.test(word) ? SYNTAX.type : src[col + word.length] === '(' ? SYNTAX.call : SYNTAX.name;
    const last = tokens[tokens.length - 1];
    if (last && last.colour === colour) last.text = src.slice(last.col, col + text.length);
    else tokens.push({ text, col, colour });
  }
  return { tokens, length: src.length };
}

const CODE = [
  '// Lamps follow the evening, room by room',
  "import { Room, Lamp } from './house';",
  '',
  "const rooms = ['sala', 'cozinha', 'quarto'];",
  '',
  'export function dusk(hour: number): number {',
  '  const t = (hour - 18.5) / 2.5;',
  '  return Math.min(1, Math.max(0, t));',
  '}',
  '',
  'export class Hallway extends Room {',
  '  private lamps: Lamp[] = [];',
  '',
  '  update(dt: number): void {',
  '    for (const lamp of this.lamps) {',
  '      const gap = lamp.target - lamp.level;',
  '      lamp.level += gap * Math.min(1, dt * 4);',
  '    }',
  '  }',
  '',
  '  open(door: string): boolean {',
  '    if (!this.doors.has(door)) return false;',
  '    this.doors.get(door)?.swing(90);',
  '    return true;',
  '  }',
  '}',
  '',
  '// TODO: a softer ease for the kitchen blinds',
  'const tide = (t: number) => 0.5 + 0.5 * Math.sin(t / 3.2);',
  '',
  'export function glow(room: Room, k: number): string {',
  "  const warm = room.name === 'sala' ? 0.8 : 0.6;",
  '  return mixColour(room.wall, LAMP, warm * k);',
  '}',
  '',
].map(tokenize);

const CODE_FONT = '8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const LINE_H = 10.5;
/** Seconds per typed line, including the scroll that follows it. */
const TYPE_PERIOD = 2.4;
const DASH = [3, 3];
const SOLID: number[] = [];

const PLAN_ROOMS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: 'Sala', x: 0, y: 0, w: 0.55, h: 0.55 },
  { name: 'Cozinha', x: 0.55, y: 0, w: 0.25, h: 0.42 },
  { name: 'WC', x: 0.8, y: 0, w: 0.2, h: 0.42 },
  { name: 'Quarto', x: 0.55, y: 0.42, w: 0.45, h: 0.58 },
  { name: 'Escritório', x: 0, y: 0.55, w: 0.32, h: 0.45 },
  { name: 'Hall', x: 0.32, y: 0.55, w: 0.23, h: 0.45 },
];

const DESKTOP = {
  monitor: {
    w: 512, h: 288, bar: 14,
    editor: { x: 10, y: 22, w: 300, h: 258 }, music: { x: 318, y: 22, w: 184, h: 94 } as Rect | null, plan: { x: 318, y: 124, w: 184, h: 156 } as Rect | null,
  },
  laptop: { w: 384, h: 240, bar: 13, editor: { x: 14, y: 21, w: 356, h: 207 }, music: null, plan: null },
};

const EDITOR_BG = '#1d2130';
const MUSIC_BG = '#232738';
const PLAN_BG = '#eef2f7';
const WALL_STOPS = ['#33406e', '#6a5690', '#c98a86', '#efc19a'];

/** Draws a window's shadow, body and title bar and leaves the context clipped to it: restore when done. */
function openWindow(ctx: Ctx, r: Rect, title: string, body: string, bar: string, ink: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  roundRect(ctx, r.x + 1.5, r.y + 2.5, r.w, r.h, 5);
  ctx.fill();
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, 5);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = bar;
  ctx.fillRect(r.x, r.y, r.w, 13);
  ctx.fillStyle = 'rgba(150,156,176,0.8)';
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    ctx.moveTo(r.x + 10 + i * 8 + 2.3, r.y + 6.5);
    ctx.arc(r.x + 10 + i * 8, r.y + 6.5, 2.3, 0, TAU);
  }
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.font = `500 7.5px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, r.x + r.w / 2, r.y + 7);
}

function minutes(s: number): string {
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** The office monitor or the laptop: wallpaper, a menu bar with the simulated clock, a code editor and, on the monitor, a music player and a floor plan. */
export class DesktopContent {
  private ctx: Ctx | null;
  private layout: (typeof DESKTOP)['monitor'];
  private wall: CanvasGradient | null = null;
  private cover: CanvasGradient | null = null;
  private blobs: { g: CanvasGradient; x: number; y: number; r: number; p: number }[] = [];
  private cw = 4.8;
  private avg: Rgb = [0, 0, 0];
  private mean: Rgb;

  constructor(private surface: Surface, readonly variant: 'monitor' | 'laptop') {
    this.layout = DESKTOP[variant];
    const { w, h, bar, editor, music, plan } = this.layout;
    const ctx = surface.getContext('2d');
    this.ctx = ctx;
    if (ctx) {
      this.wall = linear(ctx, 0, 0, w, h, WALL_STOPS);
      if (music) this.cover = linear(ctx, music.x + 8, music.y + 20, music.x + 50, music.y + 62, ['#f28a6b', '#b25aa8', '#5b5bd6']);
      this.blobs = [
        { g: radial(ctx, 150, 'rgba(255,214,170,0.35)', 'rgba(255,214,170,0)'), x: w * 0.78, y: h * 0.75, r: 150, p: 0 },
        { g: radial(ctx, 130, 'rgba(140,170,255,0.3)', 'rgba(140,170,255,0)'), x: w * 0.2, y: h * 0.25, r: 130, p: 2 },
        { g: radial(ctx, 100, 'rgba(255,150,190,0.25)', 'rgba(255,150,190,0)'), x: w * 0.55, y: h * 0.4, r: 100, p: 4 },
      ];
      ctx.font = CODE_FONT;
      this.cw = textWidth(ctx, '0', 4.8);
    }
    const area = (r: Rect | null) => (r ? r.w * r.h : 0);
    const windows = area(editor) + area(music) + area(plan);
    const wall = gradientMean(WALL_STOPS);
    this.mean = blend([
      [wall, w * h - windows - w * bar], [mix(wall, rgb('#0e101a'), 0.6), w * bar],
      [rgb(EDITOR_BG), area(editor)], [rgb(MUSIC_BG), area(music)], [rgb(PLAN_BG), area(plan)],
    ]);
  }

  draw(t: number, world: ScreenWorld): void {
    const ctx = this.ctx;
    if (!ctx || !this.wall) return;
    const { w, h, editor, music, plan } = this.layout;
    ctx.setTransform(this.surface.width / w, 0, 0, this.surface.height / h, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.wall;
    ctx.fillRect(0, 0, w, h);
    for (const b of this.blobs) {
      ctx.save();
      ctx.translate(b.x + Math.sin(t * 0.05 + b.p) * 24, b.y + Math.cos(t * 0.04 + b.p) * 14);
      ctx.fillStyle = b.g;
      ctx.fillRect(-b.r, -b.r, 2 * b.r, 2 * b.r);
      ctx.restore();
    }
    this.editor(ctx, editor, t);
    if (music) this.music(ctx, music, t);
    if (plan) this.plan(ctx, plan, t);
    this.bar(ctx, world);
    this.avg = toLinear(this.mean);
  }

  /** Mean linear RGB (0..1) of the last drawn frame. */
  average(): [number, number, number] {
    return [this.avg[0], this.avg[1], this.avg[2]];
  }

  private bar(ctx: Ctx, world: ScreenWorld): void {
    const { w, bar } = this.layout;
    const mid = bar / 2;
    ctx.fillStyle = 'rgba(14,16,26,0.62)';
    ctx.fillRect(0, 0, w, bar);
    ctx.fillStyle = '#eceef6';
    ctx.beginPath();
    ctx.arc(10, mid, 3, 0, TAU);
    ctx.fill();
    ctx.font = `500 8px ${SANS}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('Ficheiro    Editar    Ver    Janela', 20, mid + 0.5);
    let right = w - 8;
    if (this.variant === 'laptop') {
      ctx.strokeStyle = '#eceef6';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(w - 22.5, mid - 3, 12, 6);
      ctx.fillRect(w - 21.5, mid - 2, 7.5, 4);
      ctx.fillRect(w - 10, mid - 1.5, 1.2, 3);
      right = w - 28;
    }
    ctx.textAlign = 'right';
    ctx.fillText(dateTimeText(world), right, mid + 0.5);
  }

  private editor(ctx: Ctx, r: Rect, t: number): void {
    openWindow(ctx, r, 'luzes.ts — casa', EDITOR_BG, '#272c3e', '#aab2cc');
    const gutter = 24;
    const top = r.y + 16;
    const bottom = r.y + r.h - 11;
    const rows = Math.floor((bottom - top) / LINE_H);
    const cursorRow = rows - 2;
    const n = Math.floor(t / TYPE_PERIOD);
    const phase = t / TYPE_PERIOD - n;
    const lift = smooth(clamp01((phase - 0.82) / 0.18));
    const typing = phase < 0.72;
    const typed = clamp01(phase / 0.72);
    ctx.fillStyle = '#191c29';
    ctx.fillRect(r.x, r.y + 13, gutter, r.h - 24);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fillRect(r.x + gutter, top + cursorRow * LINE_H, r.w - gutter, LINE_H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, top - 2, r.w, bottom - top + 2);
    ctx.clip();
    ctx.font = CODE_FONT;
    ctx.textBaseline = 'middle';
    const x0 = r.x + gutter + 5;
    let col = 0;
    for (let row = 0; row <= cursorRow; row++) {
      const i = n + row;
      const line = CODE[i % CODE.length];
      const y = top + (row - lift) * LINE_H + LINE_H / 2;
      const current = row === cursorRow;
      ctx.textAlign = 'right';
      ctx.fillStyle = current ? '#9aa3c0' : '#4b5370';
      ctx.fillText(String((i % 999) + 1), r.x + gutter - 4, y);
      ctx.textAlign = 'left';
      const limit = current ? Math.floor(typed * line.length) : line.length;
      for (const tok of line.tokens) {
        if (tok.col >= limit) break;
        ctx.fillStyle = tok.colour;
        ctx.fillText(tok.col + tok.text.length > limit ? tok.text.slice(0, limit - tok.col) : tok.text, x0 + tok.col * this.cw, y);
      }
      if (current) {
        col = limit + 1;
        if (lift === 0 && (typing || t % 1 < 0.55)) {
          ctx.fillStyle = '#e8e8f0';
          ctx.fillRect(x0 + limit * this.cw, y - LINE_H / 2 + 1.5, 1, LINE_H - 3);
        }
      }
    }
    ctx.restore();
    ctx.fillStyle = '#262b3e';
    ctx.fillRect(r.x, r.y + r.h - 11, r.w, 11);
    ctx.fillStyle = '#8f98b4';
    ctx.font = `7px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.fillText('TypeScript   UTF-8', r.x + 6, r.y + r.h - 5.5);
    ctx.textAlign = 'right';
    ctx.fillText(`Ln ${((n + cursorRow) % 999) + 1}, Col ${col}`, r.x + r.w - 6, r.y + r.h - 5.5);
    ctx.restore();
  }

  private music(ctx: Ctx, r: Rect, t: number): void {
    openWindow(ctx, r, 'Música', MUSIC_BG, '#2c3145', '#aab2cc');
    const x = r.x + 8;
    const y = r.y + 20;
    if (this.cover) ctx.fillStyle = this.cover;
    ctx.fillRect(x, y, 42, 42);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const rr of [6, 12, 18]) {
      ctx.moveTo(x + 21 + rr, y + 21);
      ctx.arc(x + 21, y + 21, rr, 0, TAU);
    }
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eef0f8';
    ctx.font = `600 8.5px ${SANS}`;
    ctx.fillText('Maré Lenta', x + 52, y + 5);
    ctx.fillStyle = '#9aa3bd';
    ctx.font = `7.5px ${SANS}`;
    ctx.fillText('Trio do Cais', x + 52, y + 15);
    const ex = x + 52;
    const bars = 14;
    const bw = (r.x + r.w - 8 - ex) / bars;
    ctx.fillStyle = '#7dd3c8';
    for (let i = 0; i < bars; i++) {
      const level = 0.15 + 0.85 * Math.abs(Math.sin(t * (2.1 + i * 0.37) + i * 1.3)) * (0.55 + 0.45 * Math.sin(t * 0.9 + i * 0.5) ** 2);
      ctx.fillRect(ex + i * bw, y + 42 - 18 * level, bw - 1.5, 18 * level);
    }
    const length = 214;
    const pos = Math.floor(wrap(t + 37, length));
    const px = r.x + 8;
    const pw = r.w - 16;
    const py = y + 54;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(px, py, pw, 2);
    ctx.fillStyle = '#7dd3c8';
    ctx.fillRect(px, py, (pw * wrap(t + 37, length)) / length, 2);
    ctx.beginPath();
    ctx.arc(px + (pw * wrap(t + 37, length)) / length, py + 1, 2.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#9aa3bd';
    ctx.font = `7px ${SANS}`;
    ctx.fillText(minutes(pos), px, py + 11);
    ctx.textAlign = 'right';
    ctx.fillText(minutes(length), px + pw, py + 11);
    ctx.restore();
  }

  private plan(ctx: Ctx, r: Rect, t: number): void {
    openWindow(ctx, r, 'planta — casa', PLAN_BG, '#d9dfe9', '#55607a');
    ctx.strokeStyle = '#dbe3ee';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let gx = r.x + 5; gx < r.x + r.w; gx += 10) {
      ctx.moveTo(gx, r.y + 13);
      ctx.lineTo(gx, r.y + r.h);
    }
    for (let gy = r.y + 18; gy < r.y + r.h; gy += 10) {
      ctx.moveTo(r.x, gy);
      ctx.lineTo(r.x + r.w, gy);
    }
    ctx.stroke();
    const px = r.x + 12;
    const py = r.y + 22;
    const pw = r.w - 24;
    const ph = r.h - 32;
    ctx.strokeStyle = '#3b4963';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const room of PLAN_ROOMS) ctx.rect(px + room.x * pw, py + room.y * ph, room.w * pw, room.h * ph);
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (const [dx, dy, a] of [[0.32, 0.62, 0], [0.55, 0.62, Math.PI / 2], [0.6, 0.42, Math.PI], [0.42, 0.55, -Math.PI / 2]]) {
      const cx = px + dx * pw;
      const cy = py + dy * ph;
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, 7, a, a + Math.PI / 2);
    }
    ctx.stroke();
    ctx.fillStyle = '#56637d';
    ctx.font = `7px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const room of PLAN_ROOMS) ctx.fillText(room.name, px + (room.x + room.w / 2) * pw, py + (room.y + room.h / 2) * ph + (room.name === 'Escritório' ? -8 : 0));
    const hx = px + 0.16 * pw;
    const hy = py + 0.82 * ph;
    ctx.strokeStyle = '#e07a5f';
    ctx.lineWidth = 1;
    ctx.setLineDash(DASH);
    ctx.lineDashOffset = -t * 8;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(px + 0.43 * pw, hy);
    ctx.lineTo(px + 0.43 * pw, py + 0.3 * ph);
    ctx.lineTo(px + 0.25 * pw, py + 0.3 * ph);
    ctx.stroke();
    ctx.setLineDash(SOLID);
    const pulse = wrap(t, 1.6) / 1.6;
    ctx.globalAlpha = 1 - pulse;
    ctx.beginPath();
    ctx.arc(hx, hy, 3 + pulse * 6, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e07a5f';
    ctx.beginPath();
    ctx.arc(hx, hy, 2.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
