import { BoxGeometry, type BufferGeometry, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Shape, TorusGeometry, Vector2 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The things in the drawers and cupboards that visitors can pick up (props.ts). */
export type PropKind = 'fork' | 'knife' | 'spoon' | 'teaspoon' | 'plate' | 'bowl' | 'tumbler' | 'wineglass' | 'mug'
  | 'spicejar' | 'container' | 'oilbottle' | 'winebottle' | 'book' | 'case' | 'screwdriver' | 'spool';

/** What a part is made of: its colour, and whether it shines or is see-through. */
export interface Look { colour: string; gloss?: boolean; opacity?: number }
export interface Part { geometry: BufferGeometry; look: Look }
export interface KindInfo {
  /** What the prompt calls it. */
  name: string;
  /** Its box (m) standing as it rests: width (x), height (y), length (z). The origin is the middle of its base, and
   * long things lie along z. */
  size: [number, number, number];
  /** Tall things fall over when they land hard. */
  tips: boolean;
  /** Its parts; `variant` picks among the looks where there are several (books, spools, lids). Geometry is shared. */
  parts(variant: number): Part[];
}

const STEEL: Look = { colour: '#c9cbcd', gloss: true };
const GLASS: Look = { colour: '#cfe0e4', gloss: true, opacity: 0.18 };
const STONEWARE: Look[] = [{ colour: '#ebe8e0', gloss: true }, { colour: '#4f6c8c', gloss: true }];
const BLACK: Look = { colour: '#1c1c1c', gloss: true };
const BOTTLE: Look = { colour: '#3e5c3e', gloss: true, opacity: 0.8 };
const OIL: Look = { colour: '#a8902e', gloss: true, opacity: 0.8 };
const LIDS: Look[] = [BLACK, { colour: '#9a6b42' }];
const CAPSULES: Look[] = [{ colour: '#6d1a24', gloss: true }, { colour: '#c9a227', gloss: true }];
const COVERS: Look[] = ['#7a3b2e', '#2f4a63', '#6b6b3a', '#8a6a3a', '#3d3d3d'].map((colour) => ({ colour }));
const PAGES: Look = { colour: '#efe6d0' };
const HANDLES: Look[] = [{ colour: '#b3261e', gloss: true }, { colour: '#d9a520', gloss: true }];
const FILAMENTS: Look[] = ['#e8e8e8', '#2a2a2a', '#c0392b', '#2e86c1', '#27ae60', '#f39c12'].map((colour) => ({ colour, gloss: true }));

type Profile = [number, number][];
const merge = (parts: BufferGeometry[]) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
/** Turned about y: radius and height (m) from the base up. */
const turned = (p: Profile) => new LatheGeometry(p.map(([r, y]) => new Vector2(r, y)), 24);
/** A flat outline (x across, z along) `thick` m thick, lying on y = 0. */
function flat(outline: Profile, thick: number): BufferGeometry {
  const shape = new Shape(outline.map(([x, z]) => new Vector2(x, -z)));
  return new ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false }).rotateX(-Math.PI / 2);
}
const box = (w: number, h: number, l: number, y: number, x = 0, z = 0) => new BoxGeometry(w, h, l).translate(x, y + h / 2, z);
const ellipse = (rx: number, rz: number, cz: number, n = 16): Profile =>
  Array.from({ length: n }, (_, i) => [rx * Math.cos((2 * Math.PI * i) / n), cz + rz * Math.sin((2 * Math.PI * i) / n)]);

/** Geometry made once, the first time it's asked for. */
function once<T>(make: () => T): () => T {
  let made: T | undefined;
  return () => (made ??= make());
}
/** A kind's parts: shared geometries, each with the look a variant gives it. */
function kind(name: string, size: [number, number, number], tips: boolean, geometry: () => BufferGeometry[], looks: (variant: number) => Look[]): KindInfo {
  const shared = once(geometry);
  return { name, size, tips, parts: (v) => shared().map((g, i) => ({ geometry: g, look: looks(v)[i] })) };
}
const pick = (looks: Look[], v: number) => looks[((v % looks.length) + looks.length) % looks.length];

const FORK: Profile = [
  [-0.006, -0.1], [0.006, -0.1], [0.006, 0.03], [0.004, 0.05], [0.0125, 0.065], [0.0125, 0.1], [0.009, 0.1], [0.009, 0.072],
  [0.0055, 0.072], [0.0055, 0.1], [0.0015, 0.1], [0.0015, 0.072], [-0.0015, 0.072], [-0.0015, 0.1], [-0.0055, 0.1],
  [-0.0055, 0.072], [-0.009, 0.072], [-0.009, 0.1], [-0.0125, 0.1], [-0.0125, 0.065], [-0.004, 0.05], [-0.006, 0.03],
];
const KNIFE: Profile = [[-0.006, -0.11], [0.006, -0.11], [0.007, 0], [0.01, 0.02], [0.009, 0.1], [0, 0.11], [-0.005, 0.1], [-0.006, 0.02]];
const spoon = (s: number) => merge([
  flat([[-0.005 * s, -0.1 * s], [0.005 * s, -0.1 * s], [0.004 * s, 0.04 * s], [-0.004 * s, 0.04 * s]], 0.003 * s),
  flat(ellipse(0.02 * s, 0.032 * s, 0.068 * s), 0.006 * s),
]);

export const KINDS: Record<PropKind, KindInfo> = {
  fork: kind('fork', [0.025, 0.003, 0.2], false, () => [flat(FORK, 0.003)], () => [STEEL]),
  knife: kind('knife', [0.02, 0.003, 0.22], false, () => [flat(KNIFE, 0.003)], () => [STEEL]),
  spoon: kind('spoon', [0.04, 0.006, 0.2], false, () => [spoon(1)], () => [STEEL]),
  teaspoon: kind('teaspoon', [0.028, 0.0042, 0.14], false, () => [spoon(0.7)], () => [STEEL]),
  plate: kind('plate', [0.27, 0.022, 0.27], false,
    () => [turned([[0, 0], [0.06, 0], [0.065, 0.004], [0.12, 0.014], [0.135, 0.022], [0.13, 0.022], [0.115, 0.016], [0.06, 0.007], [0, 0.007]])],
    (v) => [pick(STONEWARE, v)]),
  bowl: kind('bowl', [0.15, 0.065, 0.15], false,
    () => [turned([[0, 0], [0.035, 0], [0.038, 0.005], [0.07, 0.04], [0.075, 0.065], [0.07, 0.065], [0.065, 0.042], [0.034, 0.01], [0, 0.01]])],
    (v) => [pick(STONEWARE, v + 1)]),
  tumbler: kind('glass', [0.076, 0.1, 0.076], true,
    () => [turned([[0, 0], [0.036, 0], [0.038, 0.1], [0.035, 0.1], [0.033, 0.008], [0, 0.008]])], () => [GLASS]),
  wineglass: kind('wine glass', [0.084, 0.2, 0.084], true,
    () => [turned([[0, 0], [0.035, 0], [0.035, 0.003], [0.004, 0.006], [0.004, 0.09], [0.03, 0.11], [0.042, 0.15], [0.038, 0.2],
      [0.036, 0.2], [0.039, 0.15], [0.028, 0.113], [0, 0.1]])], () => [GLASS]),
  mug: kind('mug', [0.14, 0.095, 0.09], true,
    () => [merge([
      turned([[0, 0], [0.04, 0], [0.042, 0.095], [0.038, 0.095], [0.036, 0.006], [0, 0.006]]),
      new TorusGeometry(0.022, 0.005, 8, 16, Math.PI).rotateZ(-Math.PI / 2).translate(0.04, 0.05, 0),
    ])],
    (v) => [pick(STONEWARE, v)]),
  spicejar: kind('spice jar', [0.05, 0.105, 0.05], true,
    () => [turned([[0, 0], [0.022, 0], [0.022, 0.088], [0, 0.088]]), new CylinderGeometry(0.023, 0.023, 0.017, 16).translate(0, 0.0965, 0)],
    (v) => [GLASS, pick(LIDS, v)]),
  container: kind('container', [0.175, 0.075, 0.125], false,
    () => [box(0.17, 0.06, 0.12, 0), box(0.172, 0.012, 0.122, 0.06)], (v) => [GLASS, pick(STONEWARE, v)]),
  oilbottle: kind('oil bottle', [0.065, 0.28, 0.065], true,
    () => [turned([[0, 0], [0.032, 0], [0.032, 0.19], [0.014, 0.23], [0.012, 0.265], [0, 0.265]]),
      new CylinderGeometry(0.013, 0.013, 0.015, 12).translate(0, 0.2725, 0)],
    () => [OIL, BLACK]),
  winebottle: kind('bottle', [0.075, 0.3, 0.075], true,
    () => [turned([[0, 0], [0.037, 0], [0.037, 0.2], [0.034, 0.215], [0.015, 0.245], [0.013, 0.285], [0, 0.285]]),
      new CylinderGeometry(0.0145, 0.0145, 0.05, 12).translate(0, 0.275, 0)],
    (v) => [BOTTLE, pick(CAPSULES, v)]),
  book: kind('book', [0.15, 0.025, 0.22], false,
    () => [merge([box(0.15, 0.003, 0.22, 0), box(0.15, 0.003, 0.22, 0.022), box(0.003, 0.025, 0.22, 0, -0.0735)]),
      box(0.144, 0.019, 0.212, 0.003, 0.002)],
    (v) => [pick(COVERS, v), PAGES]),
  case: kind('glasses case', [0.06, 0.035, 0.16], false, () => [box(0.06, 0.035, 0.16, 0)], () => [BLACK]),
  screwdriver: kind('screwdriver', [0.03, 0.03, 0.2], false,
    () => [new CylinderGeometry(0.014, 0.014, 0.1, 12).rotateX(Math.PI / 2).translate(0, 0.014, -0.05),
      merge([new CylinderGeometry(0.003, 0.003, 0.095, 8).rotateX(Math.PI / 2).translate(0, 0.014, 0.0475), box(0.006, 0.002, 0.006, 0.013, 0, 0.097)])],
    (v) => [pick(HANDLES, v), STEEL]),
  spool: kind('filament spool', [0.2, 0.065, 0.2], false,
    () => [merge([
      turned([[0.02, 0], [0.1, 0], [0.1, 0.005], [0.02, 0.005], [0.02, 0]]),
      turned([[0.02, 0.06], [0.1, 0.06], [0.1, 0.065], [0.02, 0.065], [0.02, 0.06]]),
      turned([[0.02, 0.005], [0.03, 0.005], [0.03, 0.06], [0.02, 0.06], [0.02, 0.005]]),
    ]), turned([[0.03, 0.005], [0.07, 0.005], [0.07, 0.06], [0.03, 0.06], [0.03, 0.005]])],
    (v) => [BLACK, pick(FILAMENTS, v)]),
};
