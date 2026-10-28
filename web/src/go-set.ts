import { BoxGeometry, CanvasTexture, Group, Mesh, type MeshMatcapMaterial, PlaneGeometry, SphereGeometry, SRGBColorSpace, Vector3 } from 'three';
import { CONFIG } from './config';
import type { GameRules, Side } from './games';
import { GoGame, SIZE } from './go-game';
import { ease } from './player';
import type { CanvasFactory } from './screens';
import type { TableMaterials, TableSet } from './table-pieces';

type Cfg = typeof CONFIG.games.go;

/** The star points: C3, G3, E5, C7, G7. */
const STARS = [20, 24, 40, 56, 60];
const step = (cfg: Cfg) => (cfg.size - 2 * cfg.margin) / (SIZE - 1);

/** A point on the board (x, z from its middle): row 1 toward white at +z (the S chair), column A toward -x. */
export function pointPosition(point: number, cfg: Cfg = CONFIG.games.go): [number, number] {
  const s = step(cfg);
  return [(point % SIZE - 4) * s, (4 - Math.floor(point / SIZE)) * s];
}

/** Prisoners fill four rows of nine; further ones stack in layers on top, so they never leave the table. */
const PRISONER_LAYER = 4 * SIZE;

/** Where the `n`th stone `capturer` has taken lies: on the table in front of the capturer (white's by the S edge,
 * black's by the N edge), nine to a row along the lines, a row further out after nine, four rows in all (see
 * `prisonerLift` for the layers above). */
export function prisonerPosition(capturer: Side, n: number, cfg: Cfg = CONFIG.games.go): [number, number] {
  const toward = capturer === 'white' ? 1 : -1;
  return [(n % SIZE - 4) * step(cfg), toward * (cfg.size / 2 + (2 * cfg.stone + 0.002) * (0.7 + Math.floor((n % PRISONER_LAYER) / SIZE)))];
}

/** How far above the table the `n`th prisoner lies: a stone's height for each full block of 36 before it. */
export function prisonerLift(n: number, cfg: Cfg = CONFIG.games.go): number {
  return Math.floor(n / PRISONER_LAYER) * cfg.height;
}

/** The board's top: the wood, the 9 × 9 lines and the star points, as white sees it. */
function drawLines(ctx: CanvasRenderingContext2D, px: number, cfg: Cfg): void {
  ctx.fillStyle = cfg.wood;
  ctx.fillRect(0, 0, px, px);
  const at = (i: number) => ((cfg.margin + i * step(cfg)) / cfg.size) * px;
  ctx.strokeStyle = cfg.lines;
  ctx.lineWidth = Math.max(1, px / 400);
  ctx.beginPath();
  for (let i = 0; i < SIZE; i++) {
    ctx.moveTo(at(i), at(0));
    ctx.lineTo(at(i), at(SIZE - 1));
    ctx.moveTo(at(0), at(i));
    ctx.lineTo(at(SIZE - 1), at(i));
  }
  ctx.stroke();
  ctx.fillStyle = cfg.lines;
  for (const p of STARS) {
    ctx.beginPath();
    ctx.arc(at(p % SIZE), at(Math.floor(p / SIZE)), px / 110, 0, Math.PI * 2);
    ctx.fill();
  }
}

interface Placed { mesh: Mesh; key: string; from: Vector3; to: Vector3; t: number; lift: boolean }

/** The Go board on the table: stones drop onto their points as they are played; captured ones lift off to the side,
 * in front of the player who took them. */
export class GoSet implements TableSet {
  readonly root = new Group();
  /** Each stone on the table by its id (the entry that placed it). */
  readonly stones = new Map<number, Mesh>();
  private placed = new Map<number, Placed>();
  private geometry: SphereGeometry;
  private sides: Record<Side, MeshMatcapMaterial>;

  constructor(materials: TableMaterials, canvas: CanvasFactory | null) {
    const cfg = CONFIG.games.go;
    this.root.name = 'Go';
    const wood = materials.make('Go board', cfg.wood);
    const board = new Mesh(new BoxGeometry(cfg.size, cfg.thickness, cfg.size), wood);
    board.position.y = cfg.thickness / 2;
    let top: MeshMatcapMaterial = wood;
    const surface = canvas?.(512, 512);
    const ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (surface && ctx) {
      drawLines(ctx, 512, cfg);
      const map = new CanvasTexture(surface as unknown as HTMLCanvasElement);
      map.colorSpace = SRGBColorSpace;
      top = materials.make('Go lines', '#ffffff', map);
    }
    const lines = new Mesh(new PlaneGeometry(cfg.size, cfg.size).rotateX(-Math.PI / 2), top);
    lines.position.y = cfg.thickness + 0.0005;
    this.root.add(board, lines);
    // A slightly flattened sphere, resting on its underside
    this.geometry = new SphereGeometry(cfg.stone, 24, 12).scale(1, cfg.height / (2 * cfg.stone), 1).translate(0, cfg.height / 2, 0);
    this.sides = { black: materials.make('Go black', cfg.black, null, true), white: materials.make('Go white', cfg.white, null, true) };
  }

  show(game: GameRules | null): void {
    const cfg = CONFIG.games.go;
    const stones = game instanceof GoGame ? game.stones() : [];
    const ids = new Set(stones.map((s) => s.id));
    for (const id of [...this.placed.keys()]) if (!ids.has(id)) this.remove(id);
    for (const s of stones) {
      const key = `${s.side}${s.point}`;
      if (this.placed.get(s.id)?.key !== key) this.remove(s.id);
      const [x, z] = s.taken === null ? pointPosition(s.point) : prisonerPosition(s.side === 'white' ? 'black' : 'white', s.taken);
      const y = s.taken === null ? cfg.thickness : prisonerLift(s.taken);
      const item = this.placed.get(s.id);
      if (!item) {
        const mesh = new Mesh(this.geometry, this.sides[s.side]);
        mesh.name = `Go stone ${s.id}`;
        const to = new Vector3(x, y, z);
        const from = s.taken === null ? to.clone().setY(y + cfg.drop) : to.clone(); // a new stone drops onto its point
        mesh.position.copy(from);
        this.root.add(mesh);
        this.stones.set(s.id, mesh);
        this.placed.set(s.id, { mesh, key, from, to, t: s.taken === null ? 0 : 1, lift: false });
      } else if (item.to.x !== x || item.to.y !== y || item.to.z !== z) {
        item.from.copy(item.mesh.position);
        item.to.set(x, y, z);
        item.t = 0;
        item.lift = true;
      }
    }
  }

  update(dt: number): void {
    for (const item of this.placed.values()) {
      if (item.t >= 1) continue;
      item.t = Math.min(1, item.t + dt / CONFIG.games.slide);
      if (item.t === 1) {
        item.mesh.position.copy(item.to);
        continue;
      }
      item.mesh.position.lerpVectors(item.from, item.to, ease(item.t));
      if (item.lift) item.mesh.position.y += Math.sin(Math.PI * item.t) * 0.05;
    }
  }

  private remove(id: number): void {
    const item = this.placed.get(id);
    if (!item) return;
    this.root.remove(item.mesh);
    this.placed.delete(id);
    this.stones.delete(id);
  }
}
