import type { Color as ChessColor, PieceSymbol } from 'chess.js';
import {
  BoxGeometry, type BufferGeometry, CanvasTexture, ExtrudeGeometry, Group, LatheGeometry, Mesh, type MeshMatcapMaterial,
  PlaneGeometry, Shape, SRGBColorSpace, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ChessGame } from './chess-game';
import { CONFIG } from './config';
import type { GameRules } from './games';
import { ease } from './player';
import type { CanvasFactory } from './screens';
import type { TableMaterials, TableSet } from './table-pieces';

type Profile = [number, number][];

/** Turned pieces: radius and height (m) from the foot up the axis, for a 4.5 cm square. */
const PROFILES: Record<Exclude<PieceSymbol, 'n'>, Profile> = {
  p: [[0, 0], [0.015, 0], [0.015, 0.004], [0.012, 0.007], [0.008, 0.012], [0.006, 0.022], [0.009, 0.025], [0.006, 0.027],
    [0.0075, 0.03], [0.008, 0.034], [0.0065, 0.038], [0.004, 0.04], [0, 0.041]],
  r: [[0, 0], [0.017, 0], [0.017, 0.005], [0.014, 0.008], [0.011, 0.012], [0.01, 0.036], [0.013, 0.04], [0.013, 0.05],
    [0.01, 0.05], [0.01, 0.046], [0, 0.046]],
  b: [[0, 0], [0.016, 0], [0.016, 0.005], [0.013, 0.008], [0.008, 0.014], [0.006, 0.034], [0.01, 0.037], [0.006, 0.04],
    [0.009, 0.046], [0.008, 0.052], [0.005, 0.057], [0.002, 0.059], [0.003, 0.061], [0, 0.063]],
  q: [[0, 0], [0.018, 0], [0.018, 0.005], [0.015, 0.008], [0.009, 0.016], [0.007, 0.044], [0.011, 0.048], [0.007, 0.051],
    [0.012, 0.062], [0.011, 0.066], [0.006, 0.066], [0.004, 0.069], [0, 0.071]],
  k: [[0, 0], [0.018, 0], [0.018, 0.005], [0.015, 0.008], [0.009, 0.016], [0.007, 0.048], [0.011, 0.052], [0.007, 0.055],
    [0.011, 0.066], [0.01, 0.069], [0, 0.069]],
};
const KNIGHT_FOOT: Profile = [[0, 0], [0.017, 0], [0.017, 0.005], [0.014, 0.008], [0.011, 0.012], [0, 0.012]];
/** The knight's head in profile, facing +x (m): chest, muzzle, ears. */
const KNIGHT_HEAD: [number, number][] = [
  [-0.01, 0.01], [0.01, 0.01], [0.008, 0.025], [0.004, 0.032], [0.016, 0.038], [0.018, 0.044], [0.012, 0.048],
  [0.004, 0.052], [-0.002, 0.058], [-0.004, 0.052], [-0.01, 0.046], [-0.012, 0.03],
];

const lathe = (p: Profile) => new LatheGeometry(p.map(([r, y]) => new Vector2(r, y)), 24);
const merge = (parts: BufferGeometry[]) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));

/** One geometry per kind of piece, shared by both sides; knights face -z (toward black, for white). */
export function pieceGeometries(): Record<PieceSymbol, BufferGeometry> {
  const head = new ExtrudeGeometry(new Shape(KNIGHT_HEAD.map(([x, y]) => new Vector2(x, y))), {
    depth: 0.01, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 2,
  }).translate(0, 0, -0.005).rotateY(Math.PI / 2);
  return {
    p: lathe(PROFILES.p),
    r: lathe(PROFILES.r),
    b: lathe(PROFILES.b),
    q: lathe(PROFILES.q),
    k: merge([lathe(PROFILES.k), new BoxGeometry(0.004, 0.014, 0.004).translate(0, 0.076, 0), new BoxGeometry(0.011, 0.004, 0.004).translate(0, 0.077, 0)]),
    n: merge([lathe(KNIGHT_FOOT), head]),
  };
}

/** A square's middle on the board (x, z from the board's centre): white's rank 1 toward +z (the S chair), file a
 * toward -x. */
export function squarePosition(square: string, cfg = CONFIG.games.chess): [number, number] {
  const step = (cfg.size - 2 * cfg.border) / 8;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return [(file - 3.5) * step, (3.5 - rank) * step];
}

/** Where the `n`th piece a side has lost stands: on the table in front of the player who took it (white's lost
 * pieces by black's edge of the board, black's by white's), from file a, a second row further out after eight. */
export function lostPosition(color: ChessColor, n: number, cfg = CONFIG.games.chess): [number, number] {
  const step = (cfg.size - 2 * cfg.border) / 8;
  const toward = color === 'w' ? -1 : 1;
  return [(n % 8 - 3.5) * step, toward * (cfg.size / 2 + step * (0.8 + Math.floor(n / 8) * 0.9))];
}

/** The board's top: a wooden border and the 64 squares, drawn as white sees them (rank 8 at the top). */
function drawBoard(ctx: CanvasRenderingContext2D, px: number, cfg = CONFIG.games.chess): void {
  ctx.fillStyle = cfg.wood;
  ctx.fillRect(0, 0, px, px);
  const edge = (cfg.border / cfg.size) * px;
  const step = (px - 2 * edge) / 8;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = 7 - row;
      ctx.fillStyle = (col + rank) % 2 === 0 ? cfg.dark : cfg.light; // a1 dark
      ctx.fillRect(edge + col * step, edge + row * step, step, step);
    }
  }
}

interface Placed { mesh: Mesh; type: PieceSymbol; from: Vector3; to: Vector3; t: number; lift: boolean }

/** The chessboard on the table: 32 turned pieces that slide to their squares; taken pieces lift off to the side. */
export class ChessSet implements TableSet {
  readonly root = new Group();
  /** Each piece by its starting square. */
  readonly pieces = new Map<string, Mesh>();
  private placed = new Map<string, Placed>();
  private geometry = pieceGeometries();

  constructor(materials: TableMaterials, canvas: CanvasFactory | null) {
    const cfg = CONFIG.games.chess;
    this.root.name = 'Chess';
    const wood = materials.make('Chess board', cfg.wood);
    const frame = new Mesh(new BoxGeometry(cfg.size, cfg.thickness, cfg.size), wood);
    frame.position.y = cfg.thickness / 2;
    let top: MeshMatcapMaterial = wood;
    const surface = canvas?.(512, 512);
    const ctx = surface?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (surface && ctx) {
      drawBoard(ctx, 512);
      const map = new CanvasTexture(surface as unknown as HTMLCanvasElement);
      map.colorSpace = SRGBColorSpace;
      top = materials.make('Chess squares', '#ffffff', map);
    }
    const squares = new Mesh(new PlaneGeometry(cfg.size, cfg.size).rotateX(-Math.PI / 2), top);
    squares.position.y = cfg.thickness + 0.0005;
    this.root.add(frame, squares);
    const sides = { w: materials.make('Chess white', cfg.white, null, true), b: materials.make('Chess black', cfg.black, null, true) };
    for (const p of new ChessGame().pieces()) {
      const mesh = new Mesh(this.geometry[p.type], sides[p.color]);
      mesh.name = `Chess ${p.id}`;
      if (p.color === 'b') mesh.rotation.y = Math.PI; // black's knights face white
      const [x, z] = squarePosition(p.square!);
      mesh.position.set(x, cfg.thickness, z);
      this.root.add(mesh);
      this.pieces.set(p.id, mesh);
      this.placed.set(p.id, { mesh, type: p.type, from: mesh.position.clone(), to: mesh.position.clone(), t: 1, lift: false });
    }
  }

  show(game: GameRules | null): void {
    const thickness = CONFIG.games.chess.thickness;
    const pieces = (game instanceof ChessGame ? game : new ChessGame()).pieces();
    for (const p of pieces) {
      const item = this.placed.get(p.id)!;
      if (item.type !== p.type) {
        item.type = p.type;
        item.mesh.geometry = this.geometry[p.type];
      }
      const [x, z] = p.square ? squarePosition(p.square) : lostPosition(p.color, p.lost);
      const y = p.square ? thickness : 0;
      if (item.to.x === x && item.to.y === y && item.to.z === z) continue;
      item.from.copy(item.mesh.position);
      item.to.set(x, y, z);
      item.t = 0;
      item.lift = !p.square;
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
}
