import { CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, Vector2 } from 'three';
import { CONFIG } from './config';
import { ContactShadow } from './contact-shadow';
import { makeMatcaps } from './creatures';
import type { Target } from './interactions';
import { type CanvasFactory, domCanvas } from './screens';
import { TableMaterials } from './table-pieces';

const lathe = (points: [number, number][], segments = 32) => new LatheGeometry(points.map(([r, y]) => new Vector2(r, y)), segments);

/** A 75 cl bottle's outline (radius, height in m): the punt, the body, the shoulder, the neck and its lip. */
const BOTTLE: [number, number][] = [
  [0, 0.012], [0.03, 0.004], [0.035, 0], [0.037, 0.005], [0.037, 0.2], [0.033, 0.218], [0.024, 0.236], [0.017, 0.25],
  [0.0145, 0.262], [0.0145, 0.29], [0.016, 0.293], [0.016, 0.3], [0, 0.3],
];
/** A wine glass's outline: the foot, the stem and the bowl, open at the top. */
const GLASS: [number, number][] = [
  [0, 0.003], [0.033, 0.002], [0.034, 0], [0.004, 0.006], [0.0035, 0.09], [0.012, 0.096], [0.03, 0.11], [0.039, 0.135],
  [0.039, 0.16], [0.034, 0.19],
];
/** The wine in the glass, a finger's depth. */
const POUR: [number, number][] = [[0, 0.097], [0.012, 0.099], [0.029, 0.111], [0.035, 0.124], [0, 0.124]];

/** The bottle's lift (m) and tip toward the drinker (radians) along a sip, `t` 0..1: up, tipped, and back down. */
export function sipPose(t: number): { lift: number; tip: number } {
  if (t <= 0 || t >= 1) return { lift: 0, tip: 0 };
  const s = Math.sin(Math.PI * t);
  return { lift: 0.1 * s, tip: 0.9 * s * s };
}

/**
 * The bottle of red on the kitchen's back counter, with a glass beside it. Matcaps, as the table's games are, dimmed
 * with the light where it stands. A sip lifts the bottle and tips it toward whoever drinks; the bottle never empties.
 */
export class WineBottle {
  readonly root = new Group();
  /** What the crosshair finds: the bottle and the glass both. */
  readonly target: Target;
  /** Turns toward the drinker, so the bottle tips their way. */
  private facing = new Group();
  private bottle = new Group();
  private materials: TableMaterials;
  private t = 1;

  constructor(canvas: CanvasFactory | null = typeof document === 'undefined' ? null : domCanvas) {
    const cfg = CONFIG.wine;
    const c = cfg.colours;
    this.root.name = 'Wine';
    this.root.position.set(cfg.at[0], cfg.counterTop, cfg.at[1]);
    this.materials = new TableMaterials(makeMatcaps(canvas));
    const m = this.materials;
    const body = new Mesh(lathe(BOTTLE), m.make('Wine bottle', c.glass, null, true));
    const label = new Mesh(new CylinderGeometry(0.0375, 0.0375, 0.09, 32, 1, true).translate(0, 0.1, 0), m.make('Wine label', c.label));
    const capsule = new Mesh(new CylinderGeometry(0.0158, 0.0158, 0.046, 24).translate(0, 0.278, 0), m.make('Wine capsule', c.capsule, null, true));
    this.bottle.add(body, label, capsule);
    this.facing.add(this.bottle);
    const stemware = m.make('Wine glass', c.stemware, null, true);
    stemware.transparent = true;
    stemware.opacity = 0.45;
    stemware.side = DoubleSide;
    stemware.depthWrite = false;
    const glass = new Mesh(lathe(GLASS), stemware);
    const pour = new Mesh(lathe(POUR, 24), m.make('Wine', c.wine, null, true));
    glass.renderOrder = 1; // after the wine inside it
    const glassAt = new Group();
    glassAt.position.set(cfg.glass[0], 0, cfg.glass[1]);
    glassAt.add(pour, glass);
    this.root.add(this.facing, glassAt);
    new ContactShadow().place(this.bottle, this.root);
    new ContactShadow().place(glassAt, this.root);
    this.target = { kind: 'wine', node: this.root };
  }

  /** Takes a sip: the bottle tips toward (x, z), where the drinker stands. */
  sip(x: number, z: number): void {
    this.facing.rotation.y = Math.atan2(x - this.root.position.x, z - this.root.position.z);
    this.t = 0;
  }

  /** Every frame: the sip, and how lit the counter is (`figureLight`), a little brighter under the crosshair. */
  update(dt: number, light: number, highlighted: boolean): void {
    this.materials.setLight(Math.min(1, light * (highlighted ? 1.35 : 1) + (highlighted ? 0.08 : 0)));
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / CONFIG.wine.sipTime);
    const { lift, tip } = sipPose(this.t);
    this.bottle.position.y = lift;
    this.bottle.rotation.x = tip; // +x tips the neck toward local +z, which faces the drinker
  }
}
