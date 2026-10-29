import { Box3, Color, FrontSide, Group, Matrix4, Mesh, MeshMatcapMaterial, type Object3D, Quaternion, Vector3 } from 'three';
import { CONFIG } from './config';
import { ContactShadow } from './contact-shadow';
import type { Matcaps } from './creatures';
import { KINDS, type KindInfo } from './prop-models';
import type { PlacedProp } from './prop-places';
import type { Placement } from './prop-placement';
import { type Flight, fly, type Landing, launch, type Raycast, type Shape } from './prop-physics';

type V3 = [number, number, number];
type V4 = [number, number, number, number];
/** A change to one loose thing, as sent between visitors. `n` counts its changes: the higher wins, then the lower `by`
 * (who made it). A rest's `p` and `q` are in its parent's space (a drawer's node, or the room's when null); a flight's
 * `p` is its middle, `v` its velocity and `w` its spin, in the room's. */
export type PropMessage =
  | { id: string; n: number; by: string; s: 'held' }
  | { id: string; n: number; by: string; s: 'fly'; p: V3; v: V3; w: V3 }
  | { id: string; n: number; by: string; s: 'rest'; parent: string | null; p: V3; q: V4 }
  | { id: string; n: number; by: string; s: 'home' };

const finite = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
export function isPropMessage(v: unknown): v is PropMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  if (typeof m.id !== 'string' || typeof m.by !== 'string' || typeof m.n !== 'number' || !Number.isInteger(m.n) || m.n < 0) return false;
  switch (m.s) {
    case 'held': case 'home': return true;
    case 'fly': return finite(m.p, 3) && finite(m.v, 3) && finite(m.w, 3);
    case 'rest': return (m.parent === null || typeof m.parent === 'string') && finite(m.p, 3) && finite(m.q, 4);
    default: return false;
  }
}

/** Held and flying things are drawn on this layer only (not layer 0), which the crosshair's rays leave out; the camera
 * enables it. */
export const CARRIED_LAYER = 1;

/** What the loose things need from the flat and the visitors. */
export interface PropWorld {
  /** The room: what rests outside a drawer is its child. */
  root: Object3D;
  /** A drawer's node by name (null: not in this layout). */
  node: (name: string) => Object3D | null;
  /** The drawer node a mesh is part of, if any. */
  drawerOf: (o: Object3D) => Object3D | null;
  /** How tall a thing may be inside a drawer (null: not known). */
  drawerHeight?: (node: Object3D) => number | null;
  raycast: Raycast;
  /** How lit a spot is, 0..1. */
  light: (x: number, z: number) => number;
  selfId: () => string;
  /** Where a visitor's hand is, in the room; false while they can't be seen. */
  hand: (id: string, position: Vector3, quaternion: Quaternion) => boolean;
}

const UP = new Vector3(0, 1, 0);
const SIDE = new Vector3(1, 0, 0);
const ONE = new Vector3(1, 1, 1);
const m4 = new Matrix4();
const inv = new Matrix4();
const pos = new Vector3();
const quat = new Quaternion();
const box = new Box3();
const a = new Vector3();
const b = new Vector3();

/** Sets an object's pose in the world, whatever its parent. */
function setWorldPose(o: Object3D, position: Vector3, quaternion: Quaternion): void {
  o.parent!.updateWorldMatrix(true, false);
  m4.compose(position, quaternion, ONE).premultiply(inv.copy(o.parent!.matrixWorld).invert());
  m4.decompose(o.position, o.quaternion, o.scale);
  o.updateMatrixWorld(true);
}
const upright = (yaw: number) => new Quaternion().setFromAxisAngle(UP, yaw);

/** One loose thing: its meshes and materials, where it lives, and its share of the flat's state. */
export class Prop {
  readonly root = new Group();
  readonly info: KindInfo;
  n = 0;
  by = '';
  state: 'rest' | 'held' | 'fly' = 'rest';
  /** Who holds it, or threw it while it flies. */
  holder: string | null = null;
  flight: Flight | null = null;
  /** The last change this visitor took or made, passed on as it was to a newcomer (null: none yet). */
  last: PropMessage | null = null;
  atHome = true;
  /** At home in a stack: what lies on it (several things may), and what it lies on. */
  over: Prop[] = [];
  under: Prop | null = null;
  readonly shape: Shape;
  /** The soft dark patch under it while it rests. */
  readonly shadow = new ContactShadow();
  private materials: { material: MeshMatcapMaterial; base: Color }[] = [];
  private level = -1;

  constructor(readonly place: PlacedProp, matcaps: Matcaps) {
    const info = place.info ?? (place.kind === 'model' ? undefined : KINDS[place.kind]);
    if (!info) throw new Error(`Loose thing ${place.id} comes from the model but has no kind info`);
    this.info = info;
    this.root.name = `Prop_${place.id}`;
    // Loose things are never solid to flights and placement rays; placement keeps them apart with `overlaps`.
    this.root.userData.loose = true;
    for (const part of this.info.parts(place.variant)) {
      const base = new Color(part.look.colour);
      const see = part.look.opacity !== undefined;
      const material = new MeshMatcapMaterial({
        color: base.clone(), matcap: (part.look.gloss ? matcaps.gloss : matcaps.matte) ?? null,
        map: part.look.map ?? null, side: part.look.side ?? FrontSide, transparent: see, opacity: part.look.opacity ?? 1, depthWrite: !see,
      });
      this.materials.push({ material, base });
      const mesh = new Mesh(part.geometry, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
    }
    const [w, h, l] = this.info.size;
    this.shape = { radius: Math.min(CONFIG.props.physics.radiusCap, Math.max(w, h, l) / 2), tips: this.info.tips };
  }

  get id(): string {
    return this.place.id;
  }

  /** Held or flying: drawn on the carried layer only, so the crosshair's rays (layer 0) pass it by. */
  setCarried(on: boolean): void {
    this.root.traverse((o) => o.layers.set(on ? CARRIED_LAYER : 0));
  }

  /** How lit it is, 0..1 (and more for the highlight). */
  setLevel(level: number): void {
    if (Math.abs(level - this.level) < 1e-3) return;
    this.level = level;
    for (const m of this.materials) m.material.color.copy(m.base).multiplyScalar(level);
  }
}

/** Every loose thing in the flat, what this visitor does with them, and what the others did. */
export class Props {
  readonly list: Prop[];
  private byId = new Map<string, Prop>();
  private homes = new Map<Prop, { parent: Object3D; position: Vector3; quaternion: Quaternion }>();
  private lit: Prop | null = null;

  constructor(places: PlacedProp[], private world: PropWorld, matcaps: Matcaps) {
    this.list = places.map((p) => new Prop(p, matcaps));
    for (const p of this.list) {
      this.byId.set(p.id, p);
      const parent = (p.place.node && world.node(p.place.node)) || world.root;
      parent.add(p.root);
      setWorldPose(p.root, p.place.position, p.place.quaternion);
      this.homes.set(p, { parent, position: p.root.position.clone(), quaternion: p.root.quaternion.clone() });
    }
    for (const p of this.list) this.stackHome(p);
  }

  /** What this visitor holds. */
  get held(): Prop | null {
    const me = this.world.selfId();
    return this.list.find((p) => p.state === 'held' && p.holder === me) ?? null;
  }

  /** The top of a stack: picking up any of it takes that one. Where several lie on a thing, the highest is next. */
  top(p: Prop): Prop {
    while (p.over.length) {
      let best = p.over[0];
      let y = box.setFromObject(best.root).max.y;
      for (const q of p.over) {
        const h = box.setFromObject(q.root).max.y;
        if (h > y) { best = q; y = h; }
      }
      p = best;
    }
    return p;
  }

  highlight(p: Prop | null): void {
    this.lit = p;
  }

  /** Whether a box meets anything resting (or flying), the held thing aside. */
  overlaps(test: Box3): boolean {
    return this.list.some((p) => p.state !== 'held' && box.setFromObject(p.root).intersectsBox(test));
  }

  pickUp(p: Prop): PropMessage | null {
    if (this.held) return null;
    const t = this.top(p);
    if (t.state !== 'rest') return null;
    this.bump(t, this.world.selfId());
    this.hold(t, t.by);
    return this.made(t, { id: t.id, n: t.n, by: t.by, s: 'held' });
  }

  place(at: Placement): PropMessage | null {
    const p = this.held;
    if (!p) return null;
    this.bump(p, this.world.selfId());
    this.restAt(p, at.node ?? this.world.root, at.point, upright(at.yaw));
    return this.made(p, this.restMessage(p));
  }

  throw(from: Vector3, velocity: Vector3): PropMessage | null {
    const p = this.held;
    if (!p) return null;
    const spin = new Vector3().crossVectors(UP, velocity);
    if (spin.lengthSq() > 1e-9) spin.setLength(CONFIG.props.throwSpin);
    return this.launchHeld(p, from, velocity, spin);
  }

  drop(from: Vector3): PropMessage | null {
    const p = this.held;
    return p ? this.launchHeld(p, from, new Vector3(), new Vector3()) : null;
  }

  update(dt: number): PropMessage[] {
    const out: PropMessage[] = [];
    const me = this.world.selfId();
    for (const p of this.list) {
      if (p.state === 'held') {
        p.root.visible = !!p.holder && this.world.hand(p.holder, pos, quat);
        if (p.root.visible) setWorldPose(p.root, pos, quat);
      } else if (p.state === 'fly' && p.flight) {
        const step = fly(p.flight, dt, this.world.raycast, p.shape);
        if (step.kind === 'flying') this.poseFlight(p);
        else {
          const mine = p.holder === me;
          const home = step.kind !== 'rest' || !this.land(p, step);
          if (home) this.goHome(p);
          if (mine) {
            this.bump(p, me);
            out.push(this.made(p, home ? { id: p.id, n: p.n, by: p.by, s: 'home' } : this.restMessage(p)));
          }
        }
      }
      if (p.state === 'rest' && p.root.visible && p.root.parent) p.shadow.place(p.root, p.root.parent);
      else p.shadow.hide();
      p.root.getWorldPosition(pos);
      p.setLevel(this.world.light(pos.x, pos.z) * (p.state === 'rest' && ((p.atHome && p.place.front !== '') || p.root.parent !== this.world.root) ? CONFIG.props.insideLight : 1) * (p === this.lit ? CONFIG.props.highlight : 1));
    }
    return out;
  }

  receive(m: PropMessage): boolean {
    const p = this.byId.get(m.id);
    if (!p || !(m.n > p.n || (m.n === p.n && m.by < p.by)) || m.n > p.n + CONFIG.props.maxJump) return false;
    p.n = m.n;
    p.by = m.by;
    p.last = m;
    if (m.s === 'held') this.hold(p, m.by);
    else if (m.s === 'home') this.goHome(p);
    else if (m.s === 'fly') {
      const v = new Vector3(...m.v);
      const most = CONFIG.props.throwSpeed[1] * CONFIG.props.maxSpeedFactor;
      if (v.length() > most) v.setLength(most);
      const w = new Vector3(...m.w);
      const fastest = CONFIG.props.throwSpin * CONFIG.props.maxSpeedFactor;
      if (w.length() > fastest) w.setLength(fastest);
      this.startFlight(p, new Vector3(...m.p), v, w, m.by);
    } else {
      const parent = m.parent === null ? this.world.root : this.world.node(m.parent);
      if (!parent) this.goHome(p); // a drawer of the other kitchen
      else {
        this.detach(p);
        parent.add(p.root);
        p.root.position.set(...m.p);
        p.root.quaternion.set(...m.q);
        if (p.root.quaternion.lengthSq() < 1e-9) p.root.quaternion.identity();
        else p.root.quaternion.normalize();
        p.root.updateMatrixWorld(true);
        this.settle(p);
        if (m.parent === null && !this.supported(p)) this.goHome(p); // nothing under it in this layout
      }
    }
    return true;
  }

  /** For a newcomer: every thing changed since the flat loaded (home again included, so its count is known). Held and
   * flying things as they are now; resting ones as the last change said, so a drawer of the other kitchen is passed on. */
  messages(): PropMessage[] {
    return this.list.filter((p) => p.n > 0).map((p): PropMessage => {
      if (p.state === 'held') return { id: p.id, n: p.n, by: p.by, s: 'held' };
      if (p.state === 'fly' && p.flight) return this.flyMessage(p);
      if (p.last && (p.last.s === 'rest' || p.last.s === 'home') && p.last.n === p.n) return p.last;
      // came to rest from someone else's flight, before their word on where
      return p.atHome ? { id: p.id, n: p.n, by: p.by, s: 'home' } : this.restMessage(p);
    });
  }

  /** A visitor left or timed out: what they held drops where they were. The change is by no one (`''`, below every id),
   * so it wins over the holder's own if their tab comes back and moves it too. */
  leave(id: string, at: Vector3 | null): void {
    for (const p of this.list) {
      if (p.state !== 'held' || p.holder !== id) continue;
      this.bump(p, '');
      const hit = at && this.world.raycast(a.copy(at), b.copy(at).addScaledVector(UP, -3));
      if (hit) this.restAt(p, this.world.drawerOf(hit.object) ?? this.world.root, hit.point, upright(0));
      else this.goHome(p);
      this.made(p, p.atHome ? { id: p.id, n: p.n, by: p.by, s: 'home' } : this.restMessage(p));
    }
  }

  /** Every frame, after the drawers and doors move: hides what rests in a shut drawer, or at home behind a shut front
   * (a cupboard's things are in the room), and shows the rest. Held and flying things are left as they are. */
  hideShut(shut: (node: string) => boolean): void {
    for (const p of this.list) {
      if (p.state !== 'rest') continue;
      const parent = p.root.parent;
      p.root.visible = !(parent && parent !== this.world.root ? shut(parent.name) : p.atHome && shut(p.place.front));
    }
  }

  /** This visitor's id changed (joining gave it one): what it holds or did is theirs under the new id. */
  rename(from: string, to: string): void {
    for (const p of this.list) {
      if (p.holder === from) p.holder = to;
      if (p.by === from) p.by = to;
      if (p.last?.by === from) p.last = { ...p.last, by: to };
    }
  }

  private made(p: Prop, m: PropMessage): PropMessage {
    p.last = m;
    return m;
  }

  private bump(p: Prop, by: string): void {
    p.n += 1;
    p.by = by;
  }

  private hold(p: Prop, holder: string): void {
    this.detach(p);
    p.state = 'held';
    p.holder = holder;
    p.flight = null;
    p.atHome = false;
    this.world.root.attach(p.root);
    p.setCarried(true);
  }

  private launchHeld(p: Prop, from: Vector3, velocity: Vector3, spin: Vector3): PropMessage {
    this.bump(p, this.world.selfId());
    this.startFlight(p, from, velocity, spin, p.by);
    return this.made(p, this.flyMessage(p));
  }

  private flyMessage(p: Prop): PropMessage {
    const f = p.flight!;
    return { id: p.id, n: p.n, by: p.by, s: 'fly', p: f.position.toArray() as V3, v: f.velocity.toArray() as V3, w: f.spin.toArray() as V3 };
  }

  private startFlight(p: Prop, from: Vector3, velocity: Vector3, spin: Vector3, thrower: string): void {
    this.detach(p);
    if (p.root.parent !== this.world.root) this.world.root.attach(p.root);
    p.state = 'fly';
    p.holder = thrower;
    p.atHome = false;
    p.root.visible = true;
    p.flight = launch(from, velocity, spin, p.root.getWorldQuaternion(new Quaternion()));
    p.setCarried(true);
    this.poseFlight(p);
  }

  /** A flight's middle is its ball's; the object's origin is the middle of its base. */
  private poseFlight(p: Prop): void {
    const f = p.flight!;
    pos.copy(UP).applyQuaternion(f.quaternion).multiplyScalar(-p.info.size[1] / 2).add(f.position);
    setWorldPose(p.root, pos, f.quaternion);
  }

  /** Rests where a flight came down; false when that's in a drawer too low for it (it would stick out of it shut). */
  private land(p: Prop, l: Landing): boolean {
    const drawer = this.world.drawerOf(l.support);
    const room = drawer && this.world.drawerHeight?.(drawer);
    if (typeof room === 'number' && room < p.info.size[l.tipped ? 2 : 1]) return false;
    const q = upright(l.yaw);
    const point = l.point.clone();
    if (l.tipped) { // on its side, along its heading
      q.multiply(new Quaternion().setFromAxisAngle(SIDE, Math.PI / 2));
      point.addScaledVector(UP, p.info.size[2] / 2);
    }
    this.restAt(p, drawer ?? this.world.root, point, q);
    return true;
  }

  private restAt(p: Prop, parent: Object3D, point: Vector3, q: Quaternion): void {
    this.detach(p);
    parent.add(p.root);
    setWorldPose(p.root, point, q);
    this.settle(p);
  }

  private settle(p: Prop): void {
    p.state = 'rest';
    p.holder = null;
    p.flight = null;
    p.atHome = false;
    p.root.visible = true;
    p.setCarried(false);
  }

  private goHome(p: Prop): void {
    const home = this.homes.get(p)!;
    this.detach(p);
    home.parent.add(p.root);
    p.root.position.copy(home.position);
    p.root.quaternion.copy(home.quaternion);
    p.root.updateMatrixWorld(true);
    this.settle(p);
    p.atHome = true;
    this.stackHome(p);
    for (const q of this.list) if (q.atHome && q.place.on === p.id) this.stackHome(q);
  }

  /** At home, lie on what it lay on, if that's at home. */
  private stackHome(p: Prop): void {
    const under = p.place.on ? this.byId.get(p.place.on) : undefined;
    if (under && under.atHome && p.under !== under) {
      under.over.push(p);
      p.under = under;
    }
  }

  /** Out of its stack, as it leaves its place: what lies on it is let go too. */
  private detach(p: Prop): void {
    for (const q of p.over) q.under = null;
    p.over = [];
    if (p.under) p.under.over = p.under.over.filter((q) => q !== p);
    p.under = null;
  }

  /** Whether there's a surface just under a resting thing. */
  private supported(p: Prop): boolean {
    box.setFromObject(p.root);
    box.getCenter(pos);
    return !!this.world.raycast(a.set(pos.x, box.max.y + 0.02, pos.z), b.set(pos.x, box.min.y - 0.05, pos.z));
  }

  private restMessage(p: Prop): PropMessage {
    const parent = p.root.parent === this.world.root ? null : p.root.parent?.name ?? null;
    return { id: p.id, n: p.n, by: p.by, s: 'rest', parent, p: p.root.position.toArray() as V3, q: p.root.quaternion.toArray() as V4 };
  }
}
