import {
  BoxGeometry, CanvasTexture, CylinderGeometry, Euler, Group, type Material, Mesh, type MeshMatcapMaterial, PlaneGeometry,
  SRGBColorSpace, Vector3,
} from 'three';
import { BackgammonGame, BAR, OFF } from './backgammon-game';
import { CONFIG } from './config';
import type { GameRules, Side } from './games';
import { ease } from './player';
import type { CanvasFactory } from './screens';
import type { TableMaterials, TableSet } from './table-pieces';

type Cfg = typeof CONFIG.games.backgammon;

/** The value on each face of a die, in three.js's box face order (+x, -x, +y, -y, +z, -z): opposite faces add to 7. */
export const DIE_FACES = [3, 4, 1, 6, 2, 5] as const;

/** The case's inside across (x; white's right is +x): the field from the left rim to the divider before the tray,
 * the bar in the field's middle, the point width, the tray's middle, and the inside's half depth (z). */
export function caseLayout(cfg: Cfg = CONFIG.games.backgammon) {
  const left = -cfg.width / 2 + cfg.rim;
  const right = cfg.width / 2 - 2 * cfg.rim - cfg.tray;
  return {
    left, right, bar: (left + right) / 2, point: (right - left - cfg.bar) / 12,
    tray: cfg.width / 2 - cfg.rim - cfg.tray / 2, edge: cfg.depth / 2 - cfg.rim,
  };
}

/** A point's middle across the case, by white's numbering: white's home (1..6) at the near right, round by the left
 * end to 24 at the far right. */
function pointX(a: number, cfg: Cfg): number {
  const { left, right, bar, point } = caseLayout(cfg);
  if (a <= 6) return right - (a - 0.5) * point;
  if (a <= 12) return bar - cfg.bar / 2 - (a - 6.5) * point;
  if (a <= 18) return left + (a - 12.5) * point;
  return bar + cfg.bar / 2 + (a - 18.5) * point;
}

/**
 * Where a checker lies in the case (x, y, z from the case's middle on the table; white at +z): on a point, five in a
 * row from the edge and the next ones on top; on the bar, each side's in its own half (on top of the bar); borne off,
 * in each side's half of the tray. `at` is its side's own numbering (0 off, 25 the bar), `height` its place in the
 * stack.
 */
export function checkerPosition(side: Side, at: number, height: number, cfg: Cfg = CONFIG.games.backgammon): [number, number, number] {
  const { bar, tray, edge } = caseLayout(cfg);
  const d = 2 * cfg.checker + 0.0005;
  const row = height % 5;
  const y = cfg.base + Math.floor(height / 5) * cfg.thickness;
  const toward = side === 'white' ? 1 : -1;
  if (at === BAR) return [bar, y + cfg.wall, toward * (0.01 + (row + 0.5) * d)];
  if (at === OFF) return [tray, y, toward * (edge - (row + 0.5) * d)];
  const a = side === 'white' ? at : 25 - at;
  return [pointX(a, cfg), y, (a <= 12 ? 1 : -1) * (edge - (row + 0.5) * d)];
}

/** The rotation (Euler, order YXZ) that shows `value` on top, turned `yaw` about the vertical. */
export function dieRotation(value: number, yaw: number): [number, number, number] {
  switch (value) {
    case 2: return [-Math.PI / 2, yaw, 0];
    case 3: return [0, yaw, Math.PI / 2];
    case 4: return [0, yaw, -Math.PI / 2];
    case 5: return [Math.PI / 2, yaw, 0];
    case 6: return [Math.PI, yaw, 0];
    default: return [0, yaw, 0];
  }
}

/** Where the two dice lie (x, z): the last roller's in their right-hand half (white's right is +x), the opening roll's
 * white die on white's side and black's on black's; before any roll, in the tray. */
function dicePlaces(roller: Side | null | undefined, cfg: Cfg): [number, number][] {
  const { bar, point, tray } = caseLayout(cfg);
  const half = cfg.bar / 2 + 3 * point;
  if (roller === undefined) return [[tray, -0.012], [tray, 0.012]];
  if (roller === null) return [[bar + half, 0.01], [bar - half, -0.01]];
  const x = roller === 'white' ? bar + half : bar - half;
  return [[x - 0.018, 0.004], [x + 0.018, -0.004]];
}

/** The points painted on the case's floor, white's side at the bottom (+z). */
function drawPoints(ctx: CanvasRenderingContext2D, w: number, h: number, cfg: Cfg): void {
  const { left, right, point, edge } = caseLayout(cfg);
  const inside = cfg.width - 2 * cfg.rim;
  const px = (x: number) => ((x - left) / inside) * w;
  const pz = (z: number) => ((z + edge) / (2 * edge)) * h;
  ctx.fillStyle = cfg.felt;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = cfg.wood;
  ctx.fillRect(px(right), 0, w - px(right), h);
  for (let a = 1; a <= 24; a++) {
    const x = pointX(a, cfg);
    const near = a <= 12;
    const base = near ? edge : -edge;
    const tip = base - (near ? 1 : -1) * edge * 0.85;
    ctx.fillStyle = a % 2 ? cfg.dark : cfg.light;
    ctx.beginPath();
    ctx.moveTo(px(x - point / 2), pz(base));
    ctx.lineTo(px(x + point / 2), pz(base));
    ctx.lineTo(px(x), pz(tip));
    ctx.closePath();
    ctx.fill();
  }
}

/** One face of a die: its pips on the die's colour. */
function drawFace(ctx: CanvasRenderingContext2D, px: number, value: number, cfg: Cfg): void {
  const spots: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]], 2: [[0.25, 0.25], [0.75, 0.75]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.25, 0.22], [0.75, 0.22], [0.25, 0.5], [0.75, 0.5], [0.25, 0.78], [0.75, 0.78]],
  };
  ctx.fillStyle = cfg.white;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = cfg.pips;
  for (const [x, y] of spots[value]) {
    ctx.beginPath();
    ctx.arc(x * px, y * px, px * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
}

interface Slide { mesh: Mesh; from: Vector3; to: Vector3; t: number }
interface Die extends Slide { turn: Euler }

/** The backgammon case on the table: 24 painted points, 15 checkers a side that slide from point to point, and two
 * dice that tumble to show the last roll. */
export class BackgammonSet implements TableSet {
  readonly root = new Group();
  /** Each checker by its id (white 0..14, black 15..29). */
  readonly checkers = new Map<number, Mesh>();
  readonly dice: Mesh[] = [];
  private slides = new Map<number, Slide>();
  private rolled = -2;
  private dieSlides: Die[] = [];

  constructor(materials: TableMaterials, canvas: CanvasFactory | null) {
    const cfg = CONFIG.games.backgammon;
    const { right, bar, edge } = caseLayout(cfg);
    this.root.name = 'Backgammon';
    const wood = materials.make('Backgammon case', cfg.wood);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new Mesh(new BoxGeometry(w, h, d), wood);
      m.position.set(x, y, z);
      this.root.add(m);
    };
    const wallY = cfg.base + cfg.wall / 2;
    box(cfg.width, cfg.base, cfg.depth, 0, cfg.base / 2, 0);
    box(cfg.rim, cfg.wall, cfg.depth, -(cfg.width - cfg.rim) / 2, wallY, 0);
    box(cfg.rim, cfg.wall, cfg.depth, (cfg.width - cfg.rim) / 2, wallY, 0);
    box(cfg.width, cfg.wall, cfg.rim, 0, wallY, (cfg.depth - cfg.rim) / 2);
    box(cfg.width, cfg.wall, cfg.rim, 0, wallY, -(cfg.depth - cfg.rim) / 2);
    box(cfg.rim, cfg.wall, 2 * edge, right + cfg.rim / 2, wallY, 0); // between the field and the tray
    box(cfg.bar, cfg.wall, 2 * edge, bar, wallY, 0);
    let floor: MeshMatcapMaterial = materials.make('Backgammon felt', cfg.felt);
    const w = 768;
    const h = Math.round((w * 2 * edge) / (cfg.width - 2 * cfg.rim));
    const surface = canvas?.(w, h);
    const ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (surface && ctx) {
      drawPoints(ctx, w, h, cfg);
      const map = new CanvasTexture(surface as unknown as HTMLCanvasElement);
      map.colorSpace = SRGBColorSpace;
      floor = materials.make('Backgammon points', '#ffffff', map);
    }
    const points = new Mesh(new PlaneGeometry(cfg.width - 2 * cfg.rim, 2 * edge).rotateX(-Math.PI / 2), floor);
    points.position.y = cfg.base + 0.0005;
    this.root.add(points);
    const geometry = new CylinderGeometry(cfg.checker, cfg.checker, cfg.thickness, 24).translate(0, cfg.thickness / 2, 0);
    const sides = { white: materials.make('Backgammon white', cfg.white, null, true), black: materials.make('Backgammon black', cfg.black, null, true) };
    for (const c of new BackgammonGame().checkers()) {
      const mesh = new Mesh(geometry, sides[c.side]);
      mesh.name = `Backgammon checker ${c.id}`;
      mesh.position.set(...checkerPosition(c.side, c.at, c.height));
      this.root.add(mesh);
      this.checkers.set(c.id, mesh);
      this.slides.set(c.id, { mesh, from: mesh.position.clone(), to: mesh.position.clone(), t: 1 });
    }
    const faces: Material[] = DIE_FACES.map((v) => {
      const s = canvas?.(64, 64);
      const c = s?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
      if (!s || !c) return materials.make(`Backgammon die ${v}`, cfg.white);
      drawFace(c, 64, v, cfg);
      const map = new CanvasTexture(s as unknown as HTMLCanvasElement);
      map.colorSpace = SRGBColorSpace;
      return materials.make(`Backgammon die ${v}`, '#ffffff', map);
    });
    const cube = new BoxGeometry(cfg.die, cfg.die, cfg.die);
    for (let i = 0; i < 2; i++) {
      const mesh = new Mesh(cube, faces);
      mesh.name = `Backgammon die ${i}`;
      mesh.rotation.order = 'YXZ';
      this.root.add(mesh);
      this.dice.push(mesh);
      this.dieSlides.push({ mesh, from: new Vector3(), to: new Vector3(), t: 1, turn: new Euler(0, 0, 0, 'YXZ') });
    }
    this.show(null);
  }

  show(game: GameRules | null): void {
    const g = game instanceof BackgammonGame ? game : new BackgammonGame();
    for (const c of g.checkers()) {
      const s = this.slides.get(c.id)!;
      const [x, y, z] = checkerPosition(c.side, c.at, c.height);
      if (s.to.x === x && s.to.y === y && s.to.z === z) continue;
      s.from.copy(s.mesh.position);
      s.to.set(x, y, z);
      s.t = 0;
    }
    const cfg = CONFIG.games.backgammon;
    const roll = g.lastRoll();
    const index = roll?.index ?? -1;
    if (index === this.rolled) return;
    const first = this.rolled === -2;
    this.rolled = index;
    const places = dicePlaces(roll ? roll.side : undefined, cfg);
    const values = roll?.dice ?? [5, 2];
    this.dieSlides.forEach((d, i) => {
      const yaw = ((index + 2) * 0.9 + i * 1.3) % (Math.PI * 2);
      d.turn.set(...dieRotation(values[i], yaw));
      d.to.set(places[i][0], cfg.base + cfg.die / 2, places[i][1]);
      d.from.copy(first ? d.to : d.mesh.position);
      d.t = first ? 1 : 0;
      if (first) {
        d.mesh.position.copy(d.to);
        d.mesh.rotation.copy(d.turn);
      }
    });
  }

  update(dt: number): void {
    for (const s of this.slides.values()) {
      if (s.t >= 1) continue;
      s.t = Math.min(1, s.t + dt / CONFIG.games.slide);
      if (s.t === 1) {
        s.mesh.position.copy(s.to);
        continue;
      }
      s.mesh.position.lerpVectors(s.from, s.to, ease(s.t));
      s.mesh.position.y += Math.sin(Math.PI * s.t) * 0.03; // a little hop over the stacks
    }
    for (const d of this.dieSlides) {
      if (d.t >= 1) continue;
      d.t = Math.min(1, d.t + dt / CONFIG.games.backgammon.tumble);
      if (d.t === 1) {
        d.mesh.position.copy(d.to);
        d.mesh.rotation.copy(d.turn);
        continue;
      }
      const e = ease(d.t);
      d.mesh.position.lerpVectors(d.from, d.to, e);
      d.mesh.position.y += Math.sin(Math.PI * d.t) * 0.04;
      const spin = (1 - e) * Math.PI * 4;
      d.mesh.rotation.set(d.turn.x + spin, d.turn.y + spin / 2, d.turn.z + spin * 0.75);
    }
  }
}
