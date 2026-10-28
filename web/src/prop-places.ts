import { Matrix4, Quaternion, Vector3 } from 'three';
import data from './prop-frames.json';
import { KINDS, type PropKind } from './prop-models';

/** What a place holds: the model's own fills (blender/tools/model_details.py). */
export type Fill = 'cutlery' | 'plates' | 'spices' | 'containers' | 'oils' | 'nightstand' | 'tools' | 'spools' | 'glasses' | 'coffee-low' | 'bar';
/** A usable box inside a drawer or cupboard, three.js space with the drawers shut; its floor is at min[1]. */
export interface Level { min: [number, number, number]; max: [number, number, number] }
/** A drawer or cupboard whose things are loose (blender/tools/loose_contents.py writes them): `node` is the drawer they
 * ride with (null: a cupboard's, in the room), `front` the movable that opens it, `out` the way it faces. */
export interface PropFrame { source: string; fill: Fill; node: string | null; front: string; out: [number, number, number]; levels: Level[] }
/** One object in a level: `a` across from its left edge (facing it), `b` in from the front, `c` up from the floor (m);
 * `yaw` about up (0: its length runs inward); `on`: the slot it lies on, by its index in the level's list. */
export interface Slot { kind: PropKind; variant?: number; a: number; b: number; c?: number; yaw?: number; on?: number }
/** An object at home: its world pose with the drawers shut, the drawer node it rides with (null: the room), and what it
 * lies on (picking up takes the top of a stack). */
export interface PlacedProp { id: string; kind: PropKind; variant: number; node: string | null; position: Vector3; quaternion: Quaternion; on: string | null; place: string }

export const FRAMES = data.places as PropFrame[];
const UP = new Vector3(0, 1, 0);
const TOLERANCE = 0.003;

/** Like the export's slugify. */
export const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const count = (space: number, step: number, max: number) => Math.max(0, Math.min(max, Math.floor(space / step)));
/** `n` places `step` apart, centred across `w`. */
const centred = (n: number, w: number, step: number) => Array.from({ length: n }, (_, i) => (w - (n - 1) * step) / 2 + i * step);

/** Tumblers in front and, where it's tall enough, wine glasses behind. */
function glasses(w: number, h: number): Slot[] {
  const xs = centred(count(w - 0.04, 0.095, 4), w, 0.095);
  return [...xs.map((a): Slot => ({ kind: 'tumbler', a, b: 0.07 })), ...xs.map((a): Slot => ({ kind: h >= 0.21 ? 'wineglass' : 'tumbler', a, b: 0.18 }))];
}
/** `n` of a kind on top of each other, each `step` higher. */
function stack(out: Slot[], kind: PropKind, n: number, a: number, b: number, step: number, variant = 0): void {
  for (let k = 0; k < n; k++) out.push({ kind, variant, a, b, c: k * step, ...(k ? { on: out.length - 1 } : {}) });
}

/** Each fill's layout of a level `w` across, `d` deep and `h` high: the `level`th of `levels`, from the floor up. */
export const LAYOUTS: Record<Fill, (w: number, d: number, h: number, level: number, levels: number) => Slot[]> = {
  cutlery: (w) => { // forks, knives, spoons and teaspoons in the insert's first four columns, a few in each
    const out: Slot[] = [];
    const col = (w - 0.02) / 5;
    (['fork', 'knife', 'spoon', 'teaspoon'] as PropKind[]).forEach((kind, i) => {
      const [, t, len] = KINDS[kind].size;
      for (let k = 0; k < 4; k++) {
        out.push({ kind, a: 0.01 + col * (i + 0.5) + (k - 1.5) * 0.002, b: 0.03 + len / 2, c: 0.008 + k * t, ...(k ? { on: out.length - 1 } : {}) });
      }
    });
    return out;
  },
  plates: (w, d) => {
    const out: Slot[] = [];
    stack(out, 'plate', 5, 0.145, d / 2, 0.02);
    if (w >= 0.46) stack(out, 'bowl', 3, w - 0.085, d / 2, 0.03);
    return out;
  },
  spices: (w) => [0.05, 0.12].flatMap((b) => centred(count(w - 0.04, 0.065, 6), w, 0.065).map((a, i): Slot => ({ kind: 'spicejar', variant: i, a, b }))),
  containers: (w, d) => {
    const xs = centred(count(w - 0.02, 0.185, 3), w, 0.185);
    return Array.from({ length: count(d - 0.04, 0.135, 2) }, (_, j) => xs.map((a, i): Slot => ({ kind: 'container', variant: i + j, a, b: 0.09 + j * 0.135 }))).flat();
  },
  oils: (w, d) => [0.3, 0.7].map((f): Slot => ({ kind: 'oilbottle', a: w * f, b: d / 2 })),
  nightstand: (w) => {
    const out: Slot[] = [];
    stack(out, 'book', 1, 0.095, 0.13, 0, 1);
    out.push({ kind: 'book', variant: 3, a: 0.095, b: 0.13, c: 0.025, on: 0 });
    out.push({ kind: 'case', a: Math.min(0.25, w - 0.04), b: 0.1 });
    return out;
  },
  tools: (w) => Array.from({ length: 5 }, (_, i): Slot => ({ kind: 'screwdriver', variant: i, a: 0.05 + (i * (w - 0.1)) / 4, b: 0.13 })),
  spools: (w, d) => Array.from({ length: count(w - 0.02, 0.21, 6) }, (_, i): Slot => ({ kind: 'spool', variant: i, a: 0.11 + i * 0.21, b: d / 2 })),
  glasses: (w, _d, h, level) => (level < 2 ? glasses(w, h) : []),
  'coffee-low': (w) => centred(count(w - 0.04, 0.12, 5), w, 0.12).map((a, i): Slot => ({ kind: 'mug', variant: i, a, b: 0.08, yaw: Math.PI / 2 })),
  bar: (w, d, h, level) => (level === 0
    ? centred(count(w - 0.02, 0.09, 4), w, 0.09).map((a, i): Slot => ({ kind: 'winebottle', variant: i, a, b: d / 2 }))
    : level === 1 ? glasses(w, h) : []),
};

/** A level's front left corner (facing it), at its floor, and its axes: across to the right, and inward. */
export function levelFrame(out: [number, number, number], level: Level) {
  const o = new Vector3(...out);
  const inward = o.clone().negate();
  const across = new Vector3().crossVectors(UP, inward);
  const corner = new Vector3(0, level.min[1], 0);
  for (const [k, j] of [['x', 0], ['z', 2]] as const) {
    if (Math.abs(across[k]) > 0.5) corner[k] = across[k] > 0 ? level.min[j] : level.max[j];
    else corner[k] = o[k] > 0 ? level.max[j] : level.min[j];
  }
  const extent = (v: Vector3) => Math.abs(v.x) * (level.max[0] - level.min[0]) + Math.abs(v.z) * (level.max[2] - level.min[2]);
  return { corner, across, inward, w: extent(across), d: extent(inward), h: level.max[1] - level.min[1] };
}

/** Whether a slot's object is inside a level `w` across, `d` deep and `h` high. */
export function fits(s: Slot, w: number, d: number, h: number): boolean {
  const [x, y, z] = KINDS[s.kind].size;
  const c = Math.abs(Math.cos(s.yaw ?? 0));
  const n = Math.abs(Math.sin(s.yaw ?? 0));
  const ha = (x * c + z * n) / 2; // half its footprint across and inward, turned by its yaw
  const hb = (x * n + z * c) / 2;
  return s.a - ha >= -TOLERANCE && s.a + ha <= w + TOLERANCE && s.b - hb >= -TOLERANCE && s.b + hb <= d + TOLERANCE
    && (s.c ?? 0) + y <= h + TOLERANCE;
}

const basis = new Matrix4();
const turn = new Quaternion();

/** Every object's home in a layout: the places whose front it has, laid out level by level. What wouldn't fit is left
 * out, and so is anything that would have lain on it. */
export function placesFor(fronts: Set<string>, frames: PropFrame[] = FRAMES): PlacedProp[] {
  const out: PlacedProp[] = [];
  for (const f of frames) {
    if (!fronts.has(f.front)) continue;
    const counts = new Map<PropKind, number>();
    f.levels.forEach((level, li) => {
      const fr = levelFrame(f.out, level);
      const facing = new Quaternion().setFromRotationMatrix(basis.makeBasis(fr.across, UP, fr.inward));
      const ids: (string | null)[] = [];
      for (const s of LAYOUTS[f.fill](fr.w, fr.d, fr.h, li, f.levels.length)) {
        const on = s.on === undefined ? null : ids[s.on];
        if (!fits(s, fr.w, fr.d, fr.h) || on === undefined || (s.on !== undefined && on === null)) {
          ids.push(null);
          continue;
        }
        const n = counts.get(s.kind) ?? 0;
        counts.set(s.kind, n + 1);
        const id = `${slug(f.source)}/${s.kind}/${n}`;
        ids.push(id);
        out.push({
          id, kind: s.kind, variant: s.variant ?? 0, node: f.node, on, place: f.source,
          position: fr.corner.clone().addScaledVector(fr.across, s.a).addScaledVector(fr.inward, s.b).addScaledVector(UP, s.c ?? 0),
          quaternion: facing.clone().multiply(turn.setFromAxisAngle(UP, s.yaw ?? 0)),
        });
      }
    });
  }
  return out;
}

/** How tall a thing may be inside each drawer of a layout (its lowest level), by node. */
export function drawerHeights(fronts: Set<string>, frames: PropFrame[] = FRAMES): Map<string, number> {
  return new Map(frames.filter((f) => f.node && fronts.has(f.front)).map((f) => [f.node!, Math.min(...f.levels.map((l) => l.max[1] - l.min[1]))]));
}
