import {
  BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial,
  Mesh, type MeshMatcapMaterial, type Object3D, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three';
import { CONFIG } from './config';
import { makeMatcaps } from './creatures';
import type { RangeEvent } from './range-game';
import { type Flight, flightAt, type TargetKind } from './range-flights';
import { type CanvasFactory, domCanvas } from './screens';
import { TableMaterials } from './table-pieces';

interface Shard { mesh: Mesh; v: Vector3; spin: Vector3; age: number }
interface Float { sprite: Sprite; age: number }
interface Tracer { line: Line; age: number }

/**
 * The round's targets as everyone in the flat sees them, out over the street: each where `flightAt` puts it, a clay
 * spinning as it goes, gone once hit. A hit shatters into shards that tumble down and its points float up in the
 * shooter's colour; another's shot shows as a tracer for a moment. Drawn with the flat, after the neighbourhood's
 * pass has cleared the depth, so no building hides a target.
 */
export class RangeView {
  readonly root = new Group();
  private materials: TableMaterials;
  private looks: Record<TargetKind, MeshMatcapMaterial>;
  private rotor: MeshMatcapMaterial;
  private shardGeometry = new BoxGeometry(0.07, 0.025, 0.06);
  /** Built once and shared by every target of its kind, so a new round frees nothing on the GPU. */
  private geo: { clay: CylinderGeometry; gold: CylinderGeometry; body: BoxGeometry; arm: BoxGeometry; rotor: CylinderGeometry };
  private targets: Object3D[] = [];
  private shown = '';
  private shards: Shard[] = [];
  private floats: Float[] = [];
  private tracers: Tracer[] = [];
  private labels = new Map<number, CanvasTexture | null>();

  constructor(private canvas: CanvasFactory | null = typeof document === 'undefined' ? null : domCanvas) {
    const c = CONFIG.range.colours;
    this.root.name = 'Range targets';
    this.materials = new TableMaterials(makeMatcaps(canvas));
    this.looks = {
      clay: this.materials.make('Clay', c.clay),
      gold: this.materials.make('Gold clay', c.gold, null, true),
      drone: this.materials.make('Drone', c.drone, null, true),
    };
    this.rotor = this.materials.make('Drone rotor', c.rotor);
    const k = CONFIG.range.kinds;
    const disc = (size: number) => new CylinderGeometry(size / 2, size * 0.4, 0.07, 20);
    const d = k.drone.size;
    this.geo = {
      clay: disc(k.clay.size),
      gold: disc(k.gold.size),
      body: new BoxGeometry(d * 0.45, d * 0.18, d * 0.45),
      arm: new BoxGeometry(d * 0.5, 0.02, 0.03),
      rotor: new CylinderGeometry(d * 0.18, d * 0.18, 0.01, 16),
    };
  }

  get shardCount(): number {
    return this.shards.length;
  }

  get floatCount(): number {
    return this.floats.length;
  }

  get tracerCount(): number {
    return this.tracers.length;
  }

  /** The object showing target `i` of the round shown, if any. */
  objectFor(i: number): Object3D | undefined {
    return this.targets[i];
  }

  /** Every frame: the round (null for none) at round time `t`, what has been hit, what just happened, each shooter's
   * colour, and how lit it is out there (`figureLight`). */
  update(dt: number, round: { id: string; flights: readonly Flight[] } | null, t: number, broken: ReadonlySet<number>, events: readonly RangeEvent[], colourOf: (id: string) => string, light: number): void {
    this.materials.setLight(light);
    const id = round?.id ?? '';
    if (id !== this.shown) this.rebuild(round);
    round?.flights.forEach((f, i) => {
      const o = this.targets[i];
      const p = broken.has(f.i) ? null : flightAt(f, t);
      o.visible = p !== null;
      if (!p) return;
      o.position.set(p[0], p[1], p[2]);
      if (f.kind !== 'drone') o.rotation.y = 12 * (t - f.at) + f.phase; // a clay spins as it flies
    });
    for (const e of events) {
      if (e.kind === 'shot') this.addTracer(e.o, e.d);
      else {
        const kind = round?.flights[e.target]?.kind ?? 'clay';
        this.addShards(e.at, kind);
        this.addFloat(e.at, e.points, colourOf(e.by));
      }
    }
    this.age(dt);
  }

  private rebuild(round: { id: string; flights: readonly Flight[] } | null): void {
    for (const o of this.targets) this.root.remove(o);
    this.targets = (round?.flights ?? []).map((f) => {
      const o = this.makeTarget(f.kind);
      o.visible = false;
      this.root.add(o);
      return o;
    });
    this.shown = round?.id ?? '';
  }

  /** A clay or gold clay: a shallow disc, tilted as it flies. A drone: a body with four rotors. */
  private makeTarget(kind: TargetKind): Object3D {
    const g = new Group();
    if (kind !== 'drone') {
      const disc = new Mesh(kind === 'gold' ? this.geo.gold : this.geo.clay, this.looks[kind]);
      disc.rotation.x = 0.35;
      g.add(disc);
      return g;
    }
    const size = CONFIG.range.kinds.drone.size;
    g.add(new Mesh(this.geo.body, this.looks.drone));
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arm = new Mesh(this.geo.arm, this.looks.drone);
      arm.position.set((x * size) / 4, 0, (z * size) / 4);
      arm.rotation.y = x * z > 0 ? -Math.PI / 4 : Math.PI / 4;
      const rotor = new Mesh(this.geo.rotor, this.rotor);
      rotor.position.set((x * size) / 2, size * 0.1, (z * size) / 2);
      g.add(arm, rotor);
    }
    return g;
  }

  private addShards(at: readonly number[], kind: TargetKind): void {
    for (let k = 0; k < 7; k++) {
      const mesh = new Mesh(this.shardGeometry, this.looks[kind]);
      mesh.position.set(at[0], at[1], at[2]);
      const a = (k / 7) * Math.PI * 2 + Math.random();
      const v = new Vector3(Math.cos(a) * (1.5 + Math.random() * 2), 1 + Math.random() * 2.5, Math.sin(a) * (1.5 + Math.random() * 2));
      const spin = new Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      this.root.add(mesh);
      this.shards.push({ mesh, v, spin, age: 0 });
    }
  }

  /** "+10" (or 30, 50) in white, tinted with the shooter's colour; one texture per value. */
  private addFloat(at: readonly number[], points: number, colour: string): void {
    if (!this.labels.has(points)) this.labels.set(points, this.label(`+${points}`));
    const sprite = new Sprite(new SpriteMaterial({ map: this.labels.get(points) ?? null, color: colour, transparent: true, depthTest: false }));
    sprite.position.set(at[0], at[1] + 0.4, at[2]);
    sprite.scale.set(2.4, 1.2, 1);
    this.root.add(sprite);
    this.floats.push({ sprite, age: 0 });
  }

  private label(text: string): CanvasTexture | null {
    if (!this.canvas) return null;
    const surface = this.canvas(256, 128);
    const ctx = surface.getContext('2d') as CanvasRenderingContext2D | null; // as makeMatcaps does
    if (!ctx) return null;
    ctx.font = 'bold 88px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 128, 64);
    const texture = new CanvasTexture(surface as unknown as HTMLCanvasElement);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }

  private addTracer(o: readonly number[], d: readonly number[]): void {
    const from = [o[0] + d[0], o[1] + d[1], o[2] + d[2]]; // from a metre out, past the shooter's own animal
    const to = [o[0] + d[0] * 60, o[1] + d[1] * 60, o[2] + d[2] * 60];
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([...from, ...to], 3));
    const line = new Line(geometry, new LineBasicMaterial({ color: CONFIG.range.colours.tracer, transparent: true, opacity: 0.8 }));
    this.root.add(line);
    this.tracers.push({ line, age: 0 });
  }

  /** Shards fall, points rise and fade, tracers fade; each goes once its time is up. */
  private age(dt: number): void {
    const cfg = CONFIG.range;
    this.shards = this.shards.filter((s) => {
      s.age += dt;
      if (s.age >= cfg.shards) {
        this.root.remove(s.mesh);
        return false;
      }
      s.v.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      return true;
    });
    this.floats = this.floats.filter((f) => {
      f.age += dt;
      if (f.age >= cfg.float) {
        this.root.remove(f.sprite);
        f.sprite.material.dispose();
        return false;
      }
      f.sprite.position.y += 1.2 * dt;
      f.sprite.material.opacity = 1 - f.age / cfg.float;
      return true;
    });
    this.tracers = this.tracers.filter((tr) => {
      tr.age += dt;
      if (tr.age >= cfg.tracer) {
        this.root.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as LineBasicMaterial).dispose();
        return false;
      }
      (tr.line.material as LineBasicMaterial).opacity = 0.8 * (1 - tr.age / cfg.tracer);
      return true;
    });
  }
}
