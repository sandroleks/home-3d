import { BoxGeometry, type Camera, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Scene, SphereGeometry } from 'three';
import { CONFIG } from './config';
import { makeMatcaps } from './creatures';
import type { RangeStatus, Target } from './interactions';
import { type CanvasFactory, domCanvas } from './screens';
import { TableMaterials } from './table-pieces';

const defaultCanvas = (): CanvasFactory | null => (typeof document === 'undefined' ? null : domCanvas);

/** A rifle, its barrel along local −z: the stock's butt at z 0.25, the muzzle at z −0.75, the iron sights on top. */
export function makeRifle(m: TableMaterials): Group {
  const c = CONFIG.range.colours;
  const wood = m.make('Rifle stock', c.wood);
  const metal = m.make('Rifle metal', c.metal, null, true);
  const box = (w: number, h: number, d: number, material: typeof wood, x: number, y: number, z: number) => {
    const b = new Mesh(new BoxGeometry(w, h, d), material);
    b.position.set(x, y, z);
    return b;
  };
  const barrel = new Mesh(new CylinderGeometry(0.011, 0.011, 0.6, 12).rotateX(Math.PI / 2), metal);
  barrel.position.set(0, 0.035, -0.45);
  const rifle = new Group();
  rifle.name = 'Rifle';
  rifle.add(
    box(0.045, 0.11, 0.3, wood, 0, -0.03, 0.1), // the stock
    box(0.04, 0.05, 0.42, wood, 0, -0.005, -0.25), // the fore-end
    box(0.035, 0.05, 0.2, metal, 0, 0.035, -0.05), // the receiver
    box(0.006, 0.025, 0.012, metal, 0, 0.07, -0.12), // the rear sight
    box(0.004, 0.03, 0.006, metal, 0, 0.06, -0.73), // the front sight
    barrel,
  );
  return rifle;
}

/**
 * The range on the balcony: a wooden stand at the railing with a rifle lying across it, and a big red mushroom
 * button on a post beside it. Matcaps, as the wine and the table's games are, dimmed with the daylight there and a
 * little brighter under the crosshair; the button's cap glows while a round is on.
 */
export class RifleRack {
  readonly root = new Group();
  readonly rack = new Group();
  readonly button = new Group();
  readonly rackTarget: Target;
  readonly buttonTarget: Target;
  private rackMaterials: TableMaterials;
  private buttonMaterials: TableMaterials;
  private cap = new MeshBasicMaterial({ name: 'Button cap' });
  private colour = new Color();

  constructor(range: RangeStatus, canvas: CanvasFactory | null = defaultCanvas()) {
    const cfg = CONFIG.range;
    const c = cfg.colours;
    const matcaps = makeMatcaps(canvas);
    this.root.name = 'Shooting range';
    this.rackMaterials = new TableMaterials(matcaps);
    this.buttonMaterials = new TableMaterials(matcaps);
    const wood = this.rackMaterials.make('Rack wood', c.wood);
    const base = new Mesh(new BoxGeometry(0.5, 0.04, 0.22), wood);
    base.position.y = 0.02;
    const post = (x: number) => {
      const p = new Mesh(new BoxGeometry(0.04, 0.9, 0.04), wood);
      p.position.set(x, 0.45, 0);
      return p;
    };
    const rifle = makeRifle(this.rackMaterials);
    rifle.rotation.y = Math.PI / 2; // along the railing: its muzzle toward −x
    rifle.position.set(0.25, 0.93, 0); // centred over the stand
    this.rack.position.set(cfg.rack[0], cfg.floor, cfg.rack[1]);
    this.rack.add(base, post(-0.2), post(0.2), rifle);

    const b = this.buttonMaterials;
    const stem = new Mesh(new CylinderGeometry(0.035, 0.045, 0.95, 16), b.make('Button post', c.metal, null, true));
    stem.position.y = 0.475;
    const housing = new Mesh(new CylinderGeometry(0.075, 0.075, 0.06, 24), b.make('Button housing', c.housing));
    housing.position.y = 0.98;
    const cap = new Mesh(new CylinderGeometry(0.06, 0.065, 0.045, 24), this.cap);
    cap.position.y = 1.03;
    this.button.position.set(cfg.button[0], cfg.floor, cfg.button[1]);
    this.button.add(stem, housing, cap);

    this.root.add(this.rack, this.button);
    this.rackTarget = { kind: 'rack', range, node: this.rack };
    this.buttonTarget = { kind: 'range-button', range, node: this.button };
  }

  /** The button's cap colour now, as hex, for tests. */
  get capColour(): string {
    return this.cap.color.getHexString();
  }

  /** Every frame: how lit the balcony is (`figureLight`), what the crosshair is on, and whether a round is on. */
  update(light: number, highlight: 'rack' | 'range-button' | null, lit: boolean): void {
    const level = (on: boolean) => Math.min(1, light * (on ? 1.35 : 1) + (on ? 0.08 : 0));
    this.rackMaterials.setLight(level(highlight === 'rack'));
    this.buttonMaterials.setLight(level(highlight === 'range-button'));
    const c = CONFIG.range.colours;
    if (lit) this.cap.color.set(c.lit);
    else this.cap.color.copy(this.colour.set(c.button)).multiplyScalar(level(highlight === 'range-button'));
  }
}

/**
 * The rifle in hand, at the bottom right of the view: in a scene of its own that main.ts draws over the flat after
 * clearing the depth, so it never sinks into the railing. A shot kicks it back and up, easing back over `kickTime`,
 * with a flash at the muzzle for the first part of it.
 */
export class HeldRifle {
  readonly scene = new Scene();
  private holder = new Group();
  private gun: Group;
  private flash: Mesh;
  private materials: TableMaterials;
  private kick = 1;

  constructor(canvas: CanvasFactory | null = defaultCanvas()) {
    const cfg = CONFIG.range;
    this.materials = new TableMaterials(makeMatcaps(canvas));
    this.gun = makeRifle(this.materials);
    this.gun.position.set(...cfg.hold);
    this.gun.rotation.set(0.03, 0.04, 0); // the muzzle turned a little in, toward the crosshair
    this.flash = new Mesh(new SphereGeometry(0.035, 10, 8), new MeshBasicMaterial({ color: cfg.colours.flash, transparent: true, opacity: 0.9, depthWrite: false }));
    this.flash.position.set(0, 0.035, -0.8);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.holder.add(this.gun);
    this.holder.visible = false;
    this.scene.add(this.holder);
  }

  get shown(): boolean {
    return this.holder.visible;
  }

  set shown(on: boolean) {
    this.holder.visible = on;
  }

  get flashing(): boolean {
    return this.flash.visible;
  }

  fire(): void {
    this.kick = 0;
  }

  /** Every frame: where the camera is, the kick easing back, and the light where the visitor stands. */
  update(dt: number, camera: Camera, light: number): void {
    const cfg = CONFIG.range;
    camera.getWorldPosition(this.holder.position);
    camera.getWorldQuaternion(this.holder.quaternion);
    this.kick = Math.min(1, this.kick + dt / cfg.kickTime);
    const k = (1 - this.kick) ** 2;
    this.gun.position.z = cfg.hold[2] + 0.07 * k;
    this.gun.rotation.x = 0.03 + 0.2 * k;
    this.flash.visible = this.kick < 0.25;
    this.materials.setLight(light);
  }
}
