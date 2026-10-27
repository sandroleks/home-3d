import {
  BoxGeometry, type BufferGeometry, CanvasTexture, CapsuleGeometry, Color, ConeGeometry, CylinderGeometry, Group, Mesh,
  MeshMatcapMaterial, Object3D, SphereGeometry, SRGBColorSpace, type Texture, TorusGeometry,
} from 'three';
import { hashId } from './presence';
import type { CanvasFactory } from './screens';

/**
 * The visitors' figures: little pastel toy animals after the wooden reindeer on the sofa. One egg-shaped body that is
 * head and body at once, a cream face disc on its front with rosy cheeks, big googly eyes along the disc's top edge, four
 * dowel legs on round feet, and what makes each animal and its expression:
 *
 * - reindeer: antlers, a shiny red nose and a smile;
 * - bear: round ears, a button nose and its tongue out;
 * - bunny: long floppy ears, a pink nose, buck teeth and a pompom tail;
 * - fox: pointed ears, eyebrows up to something, a sly grin and a wagging brush tail.
 *
 * Built from primitives, so there is nothing to download, and each takes its visitor's colour. Front is -z (where the
 * camera looks at yaw 0); the root stands on the floor.
 */
export const SPECIES = ['reindeer', 'bear', 'bunny', 'fox'] as const;
export type Species = (typeof SPECIES)[number];

/** A material and the colour it shows fully lit: the avatars dim it with the room. */
export interface Tint { material: MeshMatcapMaterial; base: Color }
/** A googly eye: `lid` squashes to blink, `pupil` turns to roll the pupil around the eye. */
export interface Eye { lid: Object3D; pupil: Object3D }
/** A part that wags, flops or twitches: its rotation about `axis` swings around `base`, a little at rest and in step
 * with the walk. */
export interface Wag { node: Object3D; axis: 'x' | 'z'; base: number; idle: number; freq: number; walk: number; offset: number }

export interface Creature {
  species: Species;
  root: Group;
  /** Everything above the legs: it tilts with where the visitor looks, bobs and sways while walking. */
  body: Group;
  /** The body group's height at rest (m). */
  rest: number;
  /** Front left, front right, back left, back right; each pivots at its hip. */
  legs: Object3D[];
  /** Each leg's hip standing (x, y, z), and its splay (rotation about z): sitting and lying move them. */
  hips: { at: [number, number, number]; splay: number }[];
  eyes: Eye[];
  wags: Wag[];
  tints: Tint[];
  /** The open mouth: its `scale.y` runs from `rest` (0 for a closed smile, hidden) to `open` as its visitor talks. */
  mouth: { node: Object3D; rest: number; open: number };
  /** The highest point (m), for the name label. */
  top: number;
}

/** Colours shared by every creature, whatever its body colour. */
export const FACE_COLOURS = {
  cream: '#fff6ec',
  white: '#ffffff',
  pupil: '#231f24',
  ink: '#4a3a40',
  blush: '#ff9fb4',
  tongue: '#ff7a92',
  mouth: '#5a2630',
  rudolph: '#ff4a4a',
  bunnyNose: '#ff8fae',
};

/** The parts' colours from the visitor's colour, in sRGB terms: a cream face with a hint of it, and a deeper, duskier
 * shade of it for legs, feet and antlers. */
export function creaturePalette(colour: string): { body: Color; face: Color; dark: Color } {
  const body = new Color(colour);
  const hsl = { h: 0, s: 0, l: 0 };
  body.getHSL(hsl, SRGBColorSpace);
  const cream = new Color(FACE_COLOURS.cream);
  const face = new Color().setRGB(
    body.r + (cream.r - body.r) * 0.7, body.g + (cream.g - body.g) * 0.7, body.b + (cream.b - body.b) * 0.7,
  );
  const dark = new Color().setHSL(hsl.h, Math.min(0.45, hsl.s * 0.6), hsl.l * 0.58, SRGBColorSpace);
  return { body, face, dark };
}

/** Each visitor's animal, from their peer id: the same in every browser. */
export function speciesFor(id: string): Species {
  return SPECIES[hashId(`${id}#creature`) % SPECIES.length];
}

// The body: an egg, slightly narrower at the top. Metres.
const RX = 0.36;
export const RY = 0.42;
export const RZ = 0.38;
const TAPER = 0.08;
/** The body's centre above the floor; its underside clears the floor by about 0.38 m of leg. */
export const CENTRE = 0.8;
export const HIP = 0.5;
const FACE_Y = -0.03;
const FACE_R: [number, number, number] = [0.215, 0.19, 0.13];
/** The face disc tips up a little, like the original's. */
const FACE_TILT = 0.12;

/** The egg's front surface (negative z) at a body-local x, y, or 0 outside it. */
export function eggFront(x: number, y: number): number {
  const yn = y / RY;
  const k = 1 - TAPER * yn;
  const xn = x / (RX * k);
  return -RZ * k * Math.sqrt(Math.max(0, 1 - yn * yn - xn * xn));
}

/** The egg's top surface at a body-local x (on the z = 0 plane). */
export function eggTop(x: number): number {
  const xn = x / (RX * (1 - TAPER));
  return RY * Math.sqrt(Math.max(0, 1 - xn * xn));
}

/** The face disc's front surface, in the disc's own frame. */
function discFront(x: number, y: number): number {
  return -FACE_R[2] * Math.sqrt(Math.max(0, 1 - (x / FACE_R[0]) ** 2 - (y / FACE_R[1]) ** 2));
}

/** Turns `o` so its -z (its front) points along a normal. */
export function faceAlong(o: Object3D, nx: number, ny: number, nz: number): void {
  const len = Math.hypot(nx, ny, nz) || 1;
  o.rotation.order = 'YXZ';
  o.rotation.y = Math.atan2(-nx, -nz);
  o.rotation.x = Math.asin(Math.max(-1, Math.min(1, ny / len)));
}

/** Places `o` on the egg's front at x, y, `lift` out along its normal, facing out. */
function onEgg(o: Object3D, x: number, y: number, lift: number): Object3D {
  const z = eggFront(x, y);
  const k = 1 - TAPER * (y / RY);
  const n = [x / (RX * k) ** 2, y / RY ** 2, z / (RZ * k) ** 2];
  const len = Math.hypot(n[0], n[1], n[2]);
  o.position.set(x + (n[0] / len) * lift, y + (n[1] / len) * lift, z + (n[2] / len) * lift);
  faceAlong(o, n[0], n[1], n[2]);
  return o;
}

/** Places `o` on the face disc at x, y (disc frame), `lift` out along its normal, facing out. */
function onFace(o: Object3D, x: number, y: number, lift: number): Object3D {
  const z = discFront(x, y);
  const n = [x / FACE_R[0] ** 2, y / FACE_R[1] ** 2, z / FACE_R[2] ** 2];
  const len = Math.hypot(n[0], n[1], n[2]);
  o.position.set(x + (n[0] / len) * lift, y + (n[1] / len) * lift, z + (n[2] / len) * lift);
  faceAlong(o, n[0], n[1], n[2]);
  return o;
}

let shared: Record<string, BufferGeometry> | null = null;

/** Geometry is shared by every figure; only materials are per figure. */
function geometries(): Record<string, BufferGeometry> {
  if (shared) return shared;
  const egg = new SphereGeometry(1, 40, 28);
  const p = egg.attributes.position;
  const n = egg.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 - TAPER * y;
    p.setXYZ(i, x * RX * k, y * RY, z * RZ * k);
    // The ellipsoid's normal (the taper's slight lean left out): computed per vertex, so the sphere's seam stays smooth
    const nx = x / (RX * k);
    const ny = y / RY;
    const nz = z / (RZ * k);
    const len = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / len, ny / len, nz / len);
  }
  const leg = new CylinderGeometry(0.044, 0.04, HIP, 14);
  leg.translate(0, -HIP / 2, 0); // hangs from its hip
  shared = {
    egg,
    unit: new SphereGeometry(1, 24, 16),
    leg,
    stick: new CapsuleGeometry(0.032, 1, 4, 10), // scaled along y to each antler piece's length
    longEar: new CapsuleGeometry(0.055, 0.3, 6, 14),
    innerEar: new CapsuleGeometry(0.03, 0.22, 4, 10),
    pointEar: new ConeGeometry(0.1, 0.2, 18),
    innerPoint: new ConeGeometry(0.058, 0.12, 14),
    tail: new CapsuleGeometry(0.085, 0.24, 6, 14),
    brow: new CapsuleGeometry(0.012, 0.06, 4, 8),
    tooth: new BoxGeometry(0.021, 0.03, 0.01),
    smile: new TorusGeometry(0.05, 0.009, 8, 24, Math.PI),
    grin: new TorusGeometry(0.072, 0.01, 8, 28, Math.PI),
  };
  return shared;
}

/** A soft studio light baked into a matcap: lit from the upper left, darker toward the rim. `gloss` adds a sharp
 * highlight, for eyes and noses. White is the full colour: the material's colour multiplies it. */
export function drawMatcap(ctx: CanvasRenderingContext2D, size: number, gloss: boolean): void {
  const g = ctx.createRadialGradient(size * 0.4, size * 0.36, 0, size * 0.5, size * 0.5, size * 0.5);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, gloss ? '#d8d8d8' : '#e6e6e6');
  g.addColorStop(0.9, gloss ? '#8a8a8a' : '#b4b4b4');
  g.addColorStop(1, gloss ? '#5a5a5a' : '#949494');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  if (!gloss) return;
  const h = ctx.createRadialGradient(size * 0.36, size * 0.3, 0, size * 0.36, size * 0.3, size * 0.13);
  h.addColorStop(0, 'rgba(255,255,255,1)');
  h.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, size, size);
}

export interface Matcaps { matte: Texture | null; gloss: Texture | null }

export function makeMatcaps(canvas: CanvasFactory | null, size = 128): Matcaps {
  const one = (gloss: boolean): Texture | null => {
    if (!canvas) return null;
    const surface = canvas(size, size);
    const ctx = surface.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return null;
    drawMatcap(ctx, size, gloss);
    const t = new CanvasTexture(surface as unknown as HTMLCanvasElement);
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  return { matte: one(false), gloss: one(true) };
}

function mesh(geometry: BufferGeometry, material: MeshMatcapMaterial): Mesh {
  const m = new Mesh(geometry, material);
  m.castShadow = false; // the sun's shadow map isn't redrawn as figures move
  m.receiveShadow = false;
  return m;
}

/** A sphere scaled to an ellipsoid. */
function blob(material: MeshMatcapMaterial, r: [number, number, number], at: [number, number, number] = [0, 0, 0]): Mesh {
  const m = mesh(geometries().unit, material);
  m.scale.set(...r);
  m.position.set(...at);
  return m;
}

/** A capsule from the origin along +y, `length` long, as an antler piece. */
function stick(material: MeshMatcapMaterial, length: number): Group {
  const g = new Group();
  const m = mesh(geometries().stick, material);
  m.scale.set(1, length / 1.064, 1); // the capsule is 1 m of cylinder plus two 0.032 m caps
  m.position.y = length / 2;
  g.add(m);
  return g;
}

/** One antler: a stem out of the head that forks into a long outer tine and a shorter one turning up and forward. */
function antler(material: MeshMatcapMaterial, side: number): { node: Group; top: number } {
  const x = side * 0.12;
  const stem = stick(material, 0.2);
  stem.position.set(x, eggTop(x) - 0.02, 0.02);
  stem.rotation.set(0.12, 0, -side * 0.32);
  const outer = stick(material, 0.26);
  outer.position.y = 0.2;
  outer.rotation.z = -side * 0.55;
  const inner = stick(material, 0.2);
  inner.position.y = 0.2;
  inner.rotation.set(-0.3, 0, side * 0.3);
  stem.add(outer, inner);
  return { node: stem, top: eggTop(x) + 0.2 * Math.cos(0.32) + 0.26 * Math.cos(0.87) };
}

/** A googly eye on the egg: a white ball with a black pupil that rolls around it. Radius `r`. */
function googlyEye(white: MeshMatcapMaterial, pupil: MeshMatcapMaterial, x: number, y: number, r: number): { node: Object3D; eye: Eye } {
  const node = onEgg(new Object3D(), x, y, r * 0.45);
  const lid = new Object3D();
  node.add(lid);
  lid.add(blob(white, [r, r, r]));
  const pivot = new Object3D();
  pivot.add(blob(pupil, [r * 0.55, r * 0.55, r * 0.24], [0, 0, -r * 0.94]));
  lid.add(pivot);
  return { node, eye: { lid, pupil: pivot } };
}

/** A smile on the face: the lower half of a torus. */
function smile(face: Object3D, geometry: BufferGeometry, material: MeshMatcapMaterial, y: number): Mesh {
  const m = mesh(geometry, material);
  onFace(m, 0, y, 0);
  m.rotation.z = Math.PI; // the torus's arc runs over the top; turned over, it smiles
  face.add(m);
  return m;
}

/** A dark open mouth below a smile's line, flat and hidden until its visitor talks. */
function openMouth(face: Object3D, material: MeshMatcapMaterial, y: number, width: number, open: number): Creature['mouth'] {
  const m = onFace(blob(material, [width, open, 0.008]), 0, y, 0.001);
  m.scale.y = 0;
  m.visible = false;
  face.add(m);
  return { node: m, rest: 0, open };
}

export function buildCreature(species: Species, colour: string, matcaps: Matcaps = { matte: null, gloss: null }): Creature {
  const geo = geometries();
  const pal = creaturePalette(colour);
  const tints: Tint[] = [];
  const cache = new Map<string, MeshMatcapMaterial>();
  const material = (c: Color | string, gloss = false): MeshMatcapMaterial => {
    const colour = typeof c === 'string' ? new Color(c) : c;
    const key = `${colour.getHexString()}${gloss ? 'g' : ''}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const m = new MeshMatcapMaterial({ name: `Creature ${species}`, color: colour.clone(), matcap: (gloss ? matcaps.gloss : matcaps.matte) ?? null });
    m.toneMapped = false; // a toy's flat colours, not the scene's exposure; the avatars dim them with the room instead
    tints.push({ material: m, base: colour.clone() });
    cache.set(key, m);
    return m;
  };
  const bodyM = material(pal.body);
  const faceM = material(pal.face);
  const darkM = material(pal.dark);
  const whiteM = material(FACE_COLOURS.white, true);
  const pupilM = material(FACE_COLOURS.pupil, true);
  const inkM = material(FACE_COLOURS.ink);
  const blushM = material(FACE_COLOURS.blush);

  const root = new Group();
  root.rotation.order = 'YXZ';
  const body = new Group();
  body.position.y = CENTRE;
  root.add(body);
  body.add(mesh(geo.egg, bodyM));

  // The face: a disc set into the front, its back hidden in the body, with cheeks and a mouth on it
  const face = new Group();
  face.position.set(0, FACE_Y, eggFront(0, FACE_Y) + FACE_R[2] * 0.55);
  face.rotation.x = FACE_TILT;
  face.add(blob(faceM, FACE_R));
  body.add(face);
  for (const side of [-1, 1]) {
    const cheek = onFace(blob(blushM, [0.042, 0.028, 0.01]), side * 0.13, -0.04, 0.002);
    face.add(cheek);
  }

  // Googly eyes, one a little bigger than the other
  const eyes: Eye[] = [];
  for (const [side, r] of [[-1, 0.066], [1, 0.058]]) {
    const e = googlyEye(whiteM, pupilM, side * 0.095, FACE_Y + 0.175, r);
    body.add(e.node);
    eyes.push(e.eye);
  }

  // Legs: dowels hanging from hips inside the body, splayed a touch, on round feet
  const legs: Object3D[] = [];
  const hips: Creature['hips'] = [];
  for (const [x, z] of [[-0.14, -0.13], [0.14, -0.13], [-0.14, 0.13], [0.14, 0.13]]) {
    const hip = new Object3D();
    hip.position.set(x, HIP, z);
    hip.rotation.z = Math.sign(x) * 0.06;
    hips.push({ at: [x, HIP, z], splay: hip.rotation.z });
    hip.add(mesh(geo.leg, darkM), blob(darkM, [0.062, 0.036, 0.078], [0, -HIP + 0.036, -0.018]));
    root.add(hip);
    legs.push(hip);
  }

  const wags: Wag[] = [];
  let top = CENTRE + RY;
  const back = (y: number) => -eggFront(0, y);
  let mouth: Creature['mouth'];
  if (species === 'reindeer') {
    for (const side of [-1, 1]) {
      const a = antler(darkM, side);
      body.add(a.node);
      wags.push({ node: a.node, axis: 'z', base: a.node.rotation.z, idle: 0, freq: 0, walk: 0.07, offset: side });
      top = Math.max(top, CENTRE + a.top);
    }
    face.add(onFace(blob(material(FACE_COLOURS.rudolph, true), [0.056, 0.05, 0.05]), 0, 0.035, 0.03));
    smile(face, geo.smile, inkM, -0.05);
    mouth = openMouth(face, material(FACE_COLOURS.mouth), -0.077, 0.034, 0.026);
  } else if (species === 'bear') {
    for (const side of [-1, 1]) {
      const x = side * 0.21;
      const ear = new Group();
      ear.position.set(x, eggTop(x) - 0.03, 0.03);
      ear.rotation.z = -side * 0.3;
      ear.add(blob(bodyM, [0.1, 0.1, 0.05], [0, 0.04, 0]), blob(blushM, [0.058, 0.058, 0.03], [0, 0.04, -0.028]));
      body.add(ear);
      wags.push({ node: ear, axis: 'z', base: ear.rotation.z, idle: 0.08, freq: 0.9, walk: 0.1, offset: side * 2 });
      top = Math.max(top, CENTRE + eggTop(x) + 0.1);
    }
    face.add(onFace(blob(material(FACE_COLOURS.ink, true), [0.044, 0.031, 0.026]), 0, 0.04, 0.012));
    smile(face, geo.smile, inkM, -0.025);
    mouth = openMouth(face, material(FACE_COLOURS.mouth), -0.052, 0.034, 0.028);
    face.add(onFace(blob(material(FACE_COLOURS.tongue), [0.026, 0.034, 0.012]), 0.012, -0.088, 0.006)); // cheeky, a bit to one side
    body.add(blob(bodyM, [0.06, 0.06, 0.06], [0, -0.2, back(-0.2) + 0.03]));
  } else if (species === 'bunny') {
    for (const side of [-1, 1]) {
      const x = side * 0.11;
      const ear = new Group();
      ear.position.set(x, eggTop(x) - 0.04, 0.02);
      ear.rotation.set(0.18, 0, -side * 0.2);
      const outer = mesh(geo.longEar, bodyM);
      outer.scale.z = 0.55;
      outer.position.y = 0.2;
      const inner = mesh(geo.innerEar, blushM);
      inner.scale.z = 0.4;
      inner.position.set(0, 0.2, -0.02);
      ear.add(outer, inner);
      body.add(ear);
      // Floppy: one ear more than the other
      wags.push({ node: ear, axis: 'x', base: side < 0 ? 0.18 : 0.38, idle: 0.06, freq: 1.6, walk: 0.32, offset: side * 0.9 });
      top = Math.max(top, CENTRE + eggTop(x) + 0.42);
    }
    face.add(onFace(blob(material(FACE_COLOURS.bunnyNose, true), [0.03, 0.022, 0.018]), 0, 0.035, 0.008));
    // A little open mouth, so the buck teeth show against it
    const little = onFace(blob(inkM, [0.036, 0.03, 0.008]), 0, -0.068, 0.001);
    face.add(little);
    mouth = { node: little, rest: 0.03, open: 0.05 };
    for (const side of [-1, 1]) face.add(onFace(mesh(geo.tooth, whiteM), side * 0.0115, -0.062, 0.009));
    body.add(blob(material(FACE_COLOURS.white), [0.09, 0.09, 0.09], [0, -0.18, back(-0.18) + 0.04]));
  } else {
    for (const side of [-1, 1]) {
      const x = side * 0.17;
      const ear = new Group();
      ear.position.set(x, eggTop(x) - 0.03, 0.02);
      ear.rotation.z = -side * 0.3;
      const outer = mesh(geo.pointEar, bodyM);
      outer.scale.z = 0.5;
      outer.position.y = 0.09;
      const inner = mesh(geo.innerPoint, faceM);
      inner.scale.z = 0.4;
      inner.position.set(0, 0.06, -0.026);
      ear.add(outer, inner);
      body.add(ear);
      wags.push({ node: ear, axis: 'z', base: ear.rotation.z, idle: 0.05, freq: 1.3, walk: 0.06, offset: side });
      top = Math.max(top, CENTRE + eggTop(x) + 0.17);
      // Eyebrows up to something: the inner ends low
      const brow = onEgg(mesh(geo.brow, darkM), side * 0.1, FACE_Y + 0.29, 0.008);
      brow.rotation.z = Math.PI / 2 + side * 0.35;
      body.add(brow);
    }
    face.add(onFace(blob(material(FACE_COLOURS.ink, true), [0.036, 0.028, 0.022]), 0, 0.045, 0.01));
    smile(face, geo.grin, inkM, -0.015);
    mouth = openMouth(face, material(FACE_COLOURS.mouth), -0.05, 0.05, 0.032);
    const tail = new Group();
    tail.position.set(0, -0.14, back(-0.14) - 0.04);
    tail.rotation.x = 1.05; // swept back and up
    const brush = mesh(geo.tail, bodyM);
    brush.position.y = 0.16;
    tail.add(brush, blob(faceM, [0.08, 0.09, 0.08], [0, 0.33, 0]));
    body.add(tail);
    wags.push({ node: tail, axis: 'z', base: 0, idle: 0.35, freq: 5, walk: 0.3, offset: 0 });
  }
  return { species, root, body, rest: CENTRE, legs, hips, eyes, wags, tints, top, mouth: mouth! };
}
