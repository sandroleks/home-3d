import { Color, Group, MeshMatcapMaterial, type Object3D, type Texture } from 'three';
import { ChessSet } from './chess-set';
import { CONFIG } from './config';
import { makeMatcaps, type Matcaps } from './creatures';
import { type GameKind, type GameRules, type SlotGame, SLOTS } from './games';
import { type CanvasFactory, domCanvas } from './screens';

/** One slot's board and pieces on the table. Each game adds its own to `SETS`. */
export interface TableSet {
  readonly root: Object3D;
  /** The game to show, when it changes; null shows the starting position. */
  show(game: GameRules | null): void;
  /** Every frame: pieces on their way slide on. */
  update(dt: number): void;
}

/**
 * The table sets' materials: matcaps like the visitors' animals (the room's light is baked, so it never reaches them),
 * dimmed together with the light where the table is.
 */
export class TableMaterials {
  private tints: { material: MeshMatcapMaterial; base: Color }[] = [];
  private level = 1;

  constructor(private matcaps: Matcaps) {}

  make(name: string, colour: string, map: Texture | null = null, gloss = false): MeshMatcapMaterial {
    const base = new Color(colour);
    const material = new MeshMatcapMaterial({ name, color: base.clone(), map, matcap: (gloss ? this.matcaps.gloss : this.matcaps.matte) ?? null });
    this.tints.push({ material, base });
    return material;
  }

  /** How lit the table is, 0..1 (`figureLight`). */
  setLight(level: number): void {
    if (Math.abs(level - this.level) < 1e-3) return;
    this.level = level;
    for (const t of this.tints) t.material.color.copy(t.base).multiplyScalar(level);
  }
}

/** Each game's set on the table, by kind, as `RULES` has each game's rules; a slot whose kind has none here stays a
 * bare table place. */
export const SETS: Partial<Record<GameKind, (materials: TableMaterials, canvas: CanvasFactory | null) => TableSet>> = {
  chess: (materials, canvas) => new ChessSet(materials, canvas),
};

/** The games on the dining table, as everyone sees them: each slot's set at its place on the table. */
export class TableGames {
  readonly root = new Group();
  private materials: TableMaterials;
  private sets: (TableSet | null)[];
  private shown: string[] = SLOTS.map(() => '');

  constructor(canvas: CanvasFactory | null = typeof document === 'undefined' ? null : domCanvas, sets = SETS) {
    this.root.name = 'Table games';
    this.materials = new TableMaterials(makeMatcaps(canvas));
    const { slots, tableTop } = CONFIG.games;
    this.sets = SLOTS.map((s, i) => {
      const set = sets[s.kind]?.(this.materials, canvas) ?? null;
      if (!set) return null;
      set.root.position.set(slots[i][0], tableTop, slots[i][1]);
      this.root.add(set.root);
      return set;
    });
  }

  /** Every frame: each slot's game (redrawn when it or its moves change), the slides, and the light at the table. */
  update(dt: number, gameAt: (slot: number) => SlotGame | null, light: number): void {
    this.materials.setLight(light);
    this.sets.forEach((set, slot) => {
      if (!set) return;
      const g = gameAt(slot);
      const key = g ? `${g.id}:${g.rules.moves.length}` : '';
      if (key !== this.shown[slot]) {
        this.shown[slot] = key;
        set.show(g?.rules ?? null);
      }
      set.update(dt);
    });
  }
}
