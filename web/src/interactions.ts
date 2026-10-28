import { Camera, Color, Mesh, MeshStandardMaterial, Object3D, Raycaster, Vector2, type Vector3 } from 'three';
import { CONFIG } from './config';
import type { DoorState } from './doors';
import type { LightGroups } from './lightmaps';
import { movableNoun, type MovableState } from './movables';
import type { Screen } from './screens';
import type { Seat, Spot } from './seats';

export type Target =
  | { kind: 'door'; door: DoorState; node: Object3D }
  | { kind: 'switch'; room: string; node: Object3D }
  | { kind: 'movable'; movable: MovableState; node: Object3D }
  | { kind: 'lamp'; group: string; name: string; node: Object3D }
  | { kind: 'screen'; screen: Screen; node: Object3D }
  /** Somewhere to sit or lie, part of the room's mesh: `spot` is the free place nearest the crosshair, null if all are
   * taken; `node` is a stand-in with nothing to highlight. */
  | { kind: 'seat'; seat: Seat; spot: Spot | null; node: Object3D }
  /** The bottle of red in the kitchen (wine.ts): a sip is the visitor's own, never shared. */
  | { kind: 'wine'; node: Object3D };

/** The seat at a point where the crosshair meets the room, if any. */
export type SeatFinder = (point: Vector3) => Target | null;

const HIGHLIGHT = new Color(0.12, 0.12, 0.09);
const tint = new Color();
const CENTER = new Vector2(0, 0);

export function lampName(name: string, names = CONFIG.lampNames): string {
  return names[name] ?? name.replace(/-/g, ' ');
}

/** `verb` is how the visitor uses things: Click with a mouse, Tap on a touch screen. */
export function promptFor(t: Target, lights: LightGroups, verb = 'Click'): string {
  switch (t.kind) {
    case 'door': return t.door.isOpen ? `${verb}: close door` : `${verb}: open door`;
    case 'movable':
      if (t.movable.info.kind === 'spin') return `${verb}: ${t.movable.isOpen ? 'stop the record' : 'play a record'}`;
      return `${verb}: ${t.movable.isOpen ? 'close' : 'open'} ${movableNoun(t.movable.info)}`;
    case 'lamp': return `${verb}: turn ${lampName(t.name)} ${lights.isOn(t.group) ? 'off' : 'on'}`;
    case 'seat': return t.spot ? `${verb}: ${t.seat.pose === 'lie' ? 'lie down' : 'sit down'}` : 'Someone is here';
    case 'wine': return `${verb}: drink some wine`;
    case 'screen': {
      const s = t.screen;
      if (!s.isTv) return `${verb}: turn screen ${s.on ? 'off' : 'on'}`;
      return !s.on ? `${verb}: turn TV on` : s.lastChannel ? `${verb}: turn TV off` : `${verb}: next channel`;
    }
    default: return lights.isOn(t.room) ? `${verb}: turn light off` : `${verb}: turn light on`;
  }
}

/** `now`: seconds, for the screens' pictures. Sitting down and drinking are the player's (main.ts). */
export function activate(t: Target, lights: LightGroups, now = 0): void {
  switch (t.kind) {
    case 'seat': return;
    case 'wine': return;
    case 'door': return t.door.toggle();
    case 'movable': return t.movable.toggle();
    case 'lamp': return lights.toggle(t.group);
    case 'screen': return t.screen.click(now);
    default: return lights.toggle(t.room);
  }
}

/** Glass and other see-through surfaces don't hide what's behind them. */
function seeThrough(o: Object3D): boolean {
  const m = (o as Mesh).material as MeshStandardMaterial | undefined;
  return !!m && !Array.isArray(m) && m.transparent;
}

export function findTarget(hit: Object3D | null, targets: Map<Object3D, Target>): Target | null {
  for (let o: Object3D | null = hit; o; o = o.parent) {
    const t = targets.get(o);
    if (t) return t;
  }
  return null;
}

/** Tints what the crosshair is on. Dark surfaces get less, in proportion: the tone mapping lifts near-black so much that
 * the full tint turns a black record light grey. */
export function setHighlight(node: Object3D, on: boolean): void {
  node.traverse((o) => {
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!m || !m.emissive) return;
    if (!m.userData.baseEmissive) m.userData.baseEmissive = m.emissive.clone();
    m.emissive.copy(m.userData.baseEmissive);
    const c = m.color;
    const strength = c ? Math.min(1, 4 * (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b)) : 1;
    if (on) m.emissive.add(tint.copy(HIGHLIGHT).multiplyScalar(strength));
  });
}

export class Interactions {
  current: Target | null = null;
  private raycaster = new Raycaster();

  constructor(
    private camera: Camera,
    private pickables: Object3D[],
    private targets: Map<Object3D, Target>,
    private lights: LightGroups,
    private now: () => number = () => performance.now() / 1000,
    private seats: SeatFinder | null = null,
  ) {
    this.raycaster.far = CONFIG.interactDistance;
  }

  /** What's under a point on screen (normalised device coordinates); walls in `pickables` occlude targets behind them,
   * glass doesn't (the record under the turntable's lid, a sliding leaf behind the fixed panel). Where the room itself
   * is hit, it may be a seat. */
  at(point: Vector2): Target | null {
    this.raycaster.setFromCamera(point, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.pickables, true)) {
      const t = findTarget(hit.object, this.targets);
      if (t) return t;
      if (!seeThrough(hit.object)) return this.seats?.(hit.point) ?? null;
    }
    return null;
  }

  /** Raycast from the crosshair and highlight what it's on. */
  update(): Target | null {
    const t = this.at(CENTER);
    if (t !== this.current) { // a seat is a new target every frame, with nothing to highlight
      if (this.current) setHighlight(this.current.node, false);
      if (t) setHighlight(t.node, true);
      this.current = t;
    }
    return t;
  }

  /** Activates what the crosshair is on, if anything, and returns it. */
  click(): Target | null {
    if (this.current) activate(this.current, this.lights, this.now());
    return this.current;
  }

  /** Activates what's under a tapped point, if anything, and returns it. */
  tap(point: Vector2): Target | null {
    const t = this.at(point);
    if (t) activate(t, this.lights, this.now());
    return t;
  }
}
