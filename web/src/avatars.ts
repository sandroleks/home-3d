import { CanvasTexture, Group, LinearFilter, type Material, Sprite, SpriteMaterial, SRGBColorSpace, type Vector3 } from 'three';
import { CONFIG } from './config';
import { buildCreature, type Creature, makeMatcaps, type Matcaps, RY, RZ, type Species, speciesFor } from './creatures';
import { hashId, type PoseMessage, type Seating, shortestTurn, smoothPose, splitPose, type Pose } from './presence';
import { type CanvasFactory, domCanvas } from './screens';

const LABEL_PX: [number, number] = [384, 68];

/** A googly pupil: where it has rolled to (radians across, up) and how fast it is rolling. */
export interface Googly { at: [number, number]; vel: [number, number] }

export interface Figure {
  root: Group;
  creature: Creature;
  label: Sprite | null;
  /** Where the figure is drawn, easing toward `target`, the last pose received. */
  pose: Pose;
  target: Pose;
  /** Smoothed ground speed (m/s), for the walk. */
  speed: number;
  /** The walk cycle (radians): one cycle is a step with each pair of legs. */
  phase: number;
  /** How lit it is, eased: 0 the darkest, 1 full colour. */
  light: number;
  /** Desynchronises idle motion between figures. */
  seed: number;
  /** One per eye. */
  pupils: Googly[];
  /** Where both eyes are glancing while it stands still, and when it next looks somewhere else. */
  glance: [number, number];
  nextGlance: number;
  /** When the next blink starts. */
  nextBlink: number;
  /** How loud its visitor is talking, 0..1 (voice.ts): opens the mouth and nods the body. */
  talk: number;
  /** Sitting or lying, as last sent; null standing. */
  seating: Seating | null;
  /** The last seat's height and facing, kept as it stands up so it rises from where it sat. */
  seatY: number;
  seatYaw: number;
  /** How far it has sat down and lain down, eased: 0 standing, 1 all the way. */
  sit: number;
  lie: number;
  /** How drunk its visitor is, as last sent (0..1), and the sway it shows, eased toward that. */
  drunk: number;
  sway: number;
}

/** Sitting and lying, in the figure's own metres: the body's height, lean and offset back, and how far its head turns
 * with where its visitor looks (a share of the turn, at most `turn` radians). */
const SIT = { y: RY * 0.92, lean: 0.12, back: 0.04, turn: 0.6, share: 0.5 };
const LIE = { y: RZ * 0.95, share: 0.2 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Draws a name on a canvas: white on a soft dark pill, so it reads against anything. */
export function drawLabel(ctx: CanvasRenderingContext2D, name: string, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  ctx.font = `500 ${Math.round(height * 0.5)}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.min(width, ctx.measureText(name).width + height * 0.8);
  ctx.fillStyle = 'rgba(18, 17, 15, 0.6)';
  ctx.beginPath();
  ctx.roundRect((width - w) / 2, height * 0.1, w, height * 0.8, height * 0.4);
  ctx.fill();
  ctx.fillStyle = '#f4f1ea';
  ctx.fillText(name, width / 2, height / 2 + 1, width - height * 0.8);
}

/**
 * How lit a figure is, 0..1: the room's lights where it stands (a lamp counts for less than the ceiling light) or the
 * daylight, whichever is more. The rooms' light is baked, so it never reaches a moving figure on its own.
 */
export function figureLight(lamps: number, sky: number, cfg: { darkest: number; daylight: number } = CONFIG.multiplayer.creature): number {
  const lit = Math.min(1, Math.max(lamps, sky / cfg.daylight));
  return cfg.darkest + (1 - cfg.darkest) * Math.max(0, lit);
}

/**
 * One step of a googly pupil: a loose spring toward `aim` that `kick` (an acceleration, rad/s²) shoves about. At the
 * edge of the eye it bounces back. Each eye gets its own stiffness, so the two never quite agree.
 */
export function stepGoogly(g: Googly, aim: [number, number], kick: [number, number], dt: number, stiffness: number, damping: number, range: number): void {
  for (const i of [0, 1]) {
    const a = stiffness * (aim[i] - g.at[i]) - damping * g.vel[i] + kick[i];
    g.vel[i] += a * dt;
    g.at[i] += g.vel[i] * dt;
    if (Math.abs(g.at[i]) > range) {
      g.at[i] = Math.sign(g.at[i]) * range;
      g.vel[i] *= -0.5;
    }
  }
}

/** How shut the eyes are `t` seconds into a blink of `length` seconds: 0 open, 1 shut, and back. */
export function blinkAmount(t: number, length: number): number {
  return t >= 0 && t <= length ? Math.sin((Math.PI * t) / length) : 0;
}

/**
 * The other visitors, as little pastel toy animals (`creatures.ts`) in their colours with their names above. Each eases
 * between the poses its visitor sends; its legs walk at the speed it moves and it bounces, squashes and sways as it goes;
 * standing still it breathes and glances about. Its googly pupils roll with every step and turn, it blinks now and then,
 * ears flop and tails wag, and its body tilts toward where its visitor looks. A hidden spare is there from the start so
 * the shader warm-up compiles its materials.
 */
export class Avatars {
  readonly root = new Group();
  private figures = new Map<string, Figure>();
  private matcaps: Matcaps;
  private spare: Figure;
  private time = 0;

  constructor(
    private canvas: CanvasFactory | null = typeof document === 'undefined' ? null : domCanvas,
    private random: () => number = Math.random,
  ) {
    this.matcaps = makeMatcaps(canvas);
    this.root.name = 'Avatars';
    this.spare = this.build('spare', '#888888', CONFIG.multiplayer.defaultName, 'reindeer');
    this.spare.root.visible = false;
    this.root.add(this.spare.root);
  }

  get count(): number {
    return this.figures.size;
  }

  has(id: string): boolean {
    return this.figures.has(id);
  }

  get(id: string): Figure | undefined {
    return this.figures.get(id);
  }

  /** Materials to compile ahead of the first visitor (the hidden spare's are compiled with the scene). */
  materials(): Material[] {
    return [this.spare.creature.tints[0].material, ...(this.spare.label ? [this.spare.label.material] : [])];
  }

  private build(id: string, colour: string, name: string, species: Species): Figure {
    const { labelGap, label, blink } = CONFIG.multiplayer.creature;
    const creature = buildCreature(species, colour, this.matcaps);
    const root = creature.root;
    root.scale.setScalar(CONFIG.multiplayer.creature.scale);
    let sprite: Sprite | null = null;
    if (this.canvas) {
      const surface = this.canvas(LABEL_PX[0], LABEL_PX[1]);
      const ctx = surface.getContext('2d') as CanvasRenderingContext2D | null;
      if (ctx) {
        drawLabel(ctx, name, LABEL_PX[0], LABEL_PX[1]);
        const texture = new CanvasTexture(surface as unknown as HTMLCanvasElement);
        texture.colorSpace = SRGBColorSpace;
        texture.minFilter = LinearFilter;
        texture.generateMipmaps = false;
        sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
        sprite.scale.set(label[0], label[1], 1);
        sprite.position.y = creature.top + labelGap;
        sprite.renderOrder = 10; // after everything, so the name reads through a doorway
        root.add(sprite);
      }
    }
    const pose: Pose = [0, 0, 0, 0];
    const f: Figure = {
      root, creature, label: sprite, pose, target: [...pose] as Pose, speed: 0, phase: 0, light: 1, seed: (hashId(id) % 1000) / 159,
      pupils: creature.eyes.map(() => ({ at: [0, 0], vel: [0, 0] })), glance: [0, 0], nextGlance: 0,
      nextBlink: this.time + blink[0] + this.random() * (blink[1] - blink[0]), talk: 0,
      seating: null, seatY: 0, seatYaw: 0, sit: 0, lie: 0, drunk: 0, sway: 0,
    };
    this.place(f);
    return f;
  }

  /**
   * Puts the figure where its pose says, and moves its parts for the walk, the breathing, the eyes and the look. Sitting,
   * it rests on the seat leaning back a little, legs out in front (the front ones swinging); lying, it is on its back,
   * face up and feet in the air. In between, the poses blend.
   */
  private place(f: Figure): void {
    const { root, creature } = f;
    const cfg = CONFIG.multiplayer.creature;
    const seated = Math.min(1, f.sit + f.lie);
    const stand = 1 - seated;
    root.position.set(f.pose[0], f.seatY * seated, f.pose[1]);
    const look = f.pose[2];
    const share = seated > 0 ? (SIT.share * f.sit + LIE.share * f.lie) / (f.sit + f.lie) : 0;
    const body = f.seatYaw + clamp(shortestTurn(f.seatYaw, look) * share, -SIT.turn, SIT.turn);
    root.rotation.y = look + shortestTurn(look, body) * seated;
    // Drunk, it sways from its feet (or its seat, half as far): side to side, and a little forward and back
    const sway = f.sway * (1 - seated * 0.5);
    const swayAt = this.time * 2 * Math.PI * CONFIG.wine.wobble.speed + f.seed;
    root.rotation.z = sway * CONFIG.wine.sway.roll * (0.6 * Math.sin(swayAt) + 0.4 * Math.sin(swayAt * 2.31 + 1.3));
    root.rotation.x = sway * CONFIG.wine.sway.pitch * Math.sin(swayAt * 0.73 + 0.5);
    const walk = Math.min(1, f.speed / CONFIG.walkSpeed) * stand;
    const s = Math.sin(f.phase);
    const swing = s * 0.55 * walk;
    const hop = Math.abs(s); // 0 as a foot lands, 1 mid-step
    const dangle = Math.sin(this.time * 1.7 + f.seed) * 0.12; // a seated toy swings its front legs
    creature.legs.forEach((leg, i) => {
      const [x, y, z] = creature.hips[i].at;
      const front = i < 2;
      const walkSwing = (i === 0 || i === 3 ? swing : -swing); // diagonal pairs, like a trotting toy
      // Sitting: hips low in the body, legs out forward; lying, the standing hips turned with the body onto its back
      const sx = x * (front ? 1.1 : 1.45);
      const sy = front ? 0.17 : 0.1;
      const sz = front ? -0.1 : 0;
      const sitRot = front ? 1.1 + dangle * (i === 0 ? 1 : -1) : 1.5;
      const lieRot = Math.PI / 2 + 0.35 + dangle * 0.5 * (i % 2 ? 1 : -1);
      leg.position.set(
        x * stand + sx * f.sit + x * f.lie,
        y * stand + sy * f.sit + (LIE.y - z) * f.lie,
        z * stand + sz * f.sit + (y - creature.rest) * f.lie,
      );
      leg.rotation.x = walkSwing * stand + sitRot * f.sit + lieRot * f.lie;
      leg.rotation.z = creature.hips[i].splay * (1 + seated);
    });
    const breathe = (1 - walk) * 0.014 * Math.sin(this.time * 2.4 + f.seed);
    const squash = walk * 0.06 * (hop - 0.5); // stretched mid-step, squashed on landing
    const tilt = clamp(f.pose[3] * 0.35, -0.3, 0.3);
    const nod = f.talk * CONFIG.multiplayer.voice.nod;
    creature.body.position.y = (creature.rest + hop * cfg.bounce * walk) * stand + SIT.y * f.sit + LIE.y * f.lie;
    creature.body.position.z = SIT.back * f.sit;
    creature.body.scale.set(1 - (breathe + squash) * 0.5, 1 + breathe + squash, 1 - (breathe + squash) * 0.5);
    creature.body.rotation.x = tilt * stand + (SIT.lean + tilt * 0.6) * f.sit + (Math.PI / 2) * f.lie + nod;
    const mouth = creature.mouth;
    mouth.node.scale.y = mouth.rest + (mouth.open - mouth.rest) * f.talk;
    mouth.node.visible = mouth.node.scale.y > 1e-3;
    creature.body.rotation.z = s * 0.08 * walk;
    for (const w of creature.wags) {
      w.node.rotation[w.axis] = w.base
        + Math.sin(this.time * w.freq + f.seed + w.offset) * w.idle * (1 - walk * 0.5)
        + Math.sin(f.phase * 2 + w.offset) * w.walk * walk;
    }
    const shut = blinkAmount(this.time - f.nextBlink, cfg.blinkTime);
    creature.eyes.forEach((e, i) => {
      e.lid.scale.y = 1 - 0.88 * shut;
      e.pupil.rotation.set(f.pupils[i].at[1], f.pupils[i].at[0], 0);
    });
    if (f.label) {
      const top = creature.top + cfg.labelGap;
      f.label.position.y = top * stand + (top - creature.rest + SIT.y) * f.sit + (LIE.y + RZ + 0.2 + cfg.labelGap) * f.lie;
    }
  }

  add(id: string, colour: string, name: string, species: Species = speciesFor(id)): Figure {
    const existing = this.figures.get(id);
    if (existing) return existing;
    const f = this.build(id, colour, name, species);
    f.root.visible = false; // until its first pose: nobody should appear at the origin
    f.root.name = `Avatar ${id}`;
    this.figures.set(id, f);
    this.root.add(f.root);
    return f;
  }

  /** How loud a visitor is talking, 0..1; the figure shows it from the next update. */
  setTalk(id: string, level: number): void {
    const f = this.figures.get(id);
    if (f) f.talk = Math.max(0, Math.min(1, level));
  }

  /** Where a visitor's voice comes from: their animal's mouth, in world space; null until it has a pose. */
  mouth(id: string, out: Vector3): Vector3 | null {
    const f = this.figures.get(id);
    return f?.root.visible ? f.creature.mouth.node.getWorldPosition(out) : null;
  }

  setName(id: string, name: string): void {
    const f = this.figures.get(id);
    if (!f?.label) return;
    const texture = f.label.material.map as CanvasTexture;
    const ctx = (texture.image as HTMLCanvasElement).getContext('2d');
    if (!ctx) return;
    drawLabel(ctx, name, LABEL_PX[0], LABEL_PX[1]);
    texture.needsUpdate = true;
  }

  /** A new pose to ease toward, sitting or lying or not; the first one places the figure outright. */
  setPose(id: string, message: PoseMessage): void {
    const f = this.figures.get(id);
    if (!f) return;
    const { pose, seating, drunk } = splitPose(message);
    f.target = pose;
    f.seating = seating;
    f.drunk = drunk;
    if (seating) [, f.seatY, f.seatYaw] = seating;
    if (!f.root.visible) {
      f.pose = [...pose] as Pose;
      f.sit = seating?.[0] === 1 ? 1 : 0;
      f.lie = seating?.[0] === 2 ? 1 : 0;
      f.root.visible = true;
      this.place(f);
    }
  }

  /** Whether another visitor sits or lies within `radius` m of x, z: that spot is taken. */
  occupied(x: number, z: number, radius = CONFIG.seats.takenRadius): boolean {
    for (const f of this.figures.values()) {
      if (f.root.visible && f.seating && Math.hypot(f.target[0] - x, f.target[1] - z) < radius) return true;
    }
    return false;
  }

  /** The visitors sitting or lying, at the spot their last pose named (for the dining table's games). */
  seated(): { id: string; x: number; z: number }[] {
    const out: { id: string; x: number; z: number }[] = [];
    for (const [id, f] of this.figures) if (f.root.visible && f.seating) out.push({ id, x: f.target[0], z: f.target[1] });
    return out;
  }

  remove(id: string): void {
    const f = this.figures.get(id);
    if (!f) return;
    this.figures.delete(id);
    this.root.remove(f.root);
    for (const t of f.creature.tints) t.material.dispose(); // geometry and matcaps are shared
    if (f.label) {
      f.label.material.map?.dispose();
      f.label.material.dispose();
    }
  }

  /** The eyes: glance about while still, look ahead while walking, and let every step and turn shake the pupils. */
  private moveEyes(f: Figure, dt: number, turnRate: number, walk: number): void {
    const { googly, blink, blinkTime } = CONFIG.multiplayer.creature;
    if (this.time >= f.nextGlance) {
      f.glance = walk > 0.2 ? [0, 0] : [(this.random() - 0.5) * 0.7, (this.random() - 0.4) * 0.45];
      f.nextGlance = this.time + 1.2 + this.random() * 2.8;
    }
    if (this.time > f.nextBlink + blinkTime) {
      // Now and then a double blink
      f.nextBlink = this.time + (this.random() < 0.2 ? 0.25 : blink[0] + this.random() * (blink[1] - blink[0]));
    }
    const step = Math.cos(f.phase * 2); // each footfall shakes the pupils up and down
    const kick: [number, number] = [-turnRate * 6 + Math.sin(f.phase) * 18 * walk, -step * 26 * walk];
    f.pupils.forEach((g, i) => stepGoogly(g, f.glance, kick, dt, googly.stiffness * (1 + i * 0.35), googly.damping, googly.range));
  }

  /** `light(x, z)`: how lit the spot is, 0..1 (see figureLight). */
  update(dt: number, light: (x: number, z: number) => number = () => 1): void {
    this.time += dt;
    const k = 1 - Math.exp(-dt / 0.2);
    for (const f of this.figures.values()) {
      if (!f.root.visible) continue;
      const [x, z, yaw] = f.pose;
      f.pose = smoothPose(f.pose, f.target, dt);
      const v = dt > 0 ? Math.min(4, Math.hypot(f.pose[0] - x, f.pose[1] - z) / dt) : 0;
      const turnRate = dt > 0 ? shortestTurn(yaw, f.pose[2]) / dt : 0;
      f.speed += (v - f.speed) * k;
      const settle = 1 - Math.exp(-dt / CONFIG.multiplayer.creature.settle);
      f.sit += ((f.seating?.[0] === 1 ? 1 : 0) - f.sit) * settle;
      f.lie += ((f.seating?.[0] === 2 ? 1 : 0) - f.lie) * settle;
      f.sway += (f.drunk - f.sway) * settle;
      f.phase = (f.phase + (f.speed * dt / CONFIG.multiplayer.creature.stride) * 2 * Math.PI) % (2 * Math.PI);
      if (dt > 0) this.moveEyes(f, dt, turnRate, Math.min(1, f.speed / CONFIG.walkSpeed));
      const l = light(f.pose[0], f.pose[1]);
      if (Math.abs(l - f.light) > 1e-3) {
        f.light += (l - f.light) * k;
        for (const t of f.creature.tints) t.material.color.copy(t.base).multiplyScalar(f.light);
      }
      this.place(f);
    }
  }
}
