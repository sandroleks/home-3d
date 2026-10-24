import { Camera, Color, Mesh, MeshStandardMaterial, Object3D, Raycaster, Vector2 } from 'three';
import { CONFIG } from './config';
import type { DoorState } from './doors';
import type { LightGroups } from './lightmaps';
import { movableNoun, type MovableState } from './movables';
import type { Screen } from './screens';

export type Target =
  | { kind: 'door'; door: DoorState; node: Object3D }
  | { kind: 'switch'; room: string; node: Object3D }
  | { kind: 'movable'; movable: MovableState; node: Object3D }
  | { kind: 'lamp'; group: string; name: string; node: Object3D }
  | { kind: 'screen'; screen: Screen; node: Object3D };

const HIGHLIGHT = new Color(0.12, 0.12, 0.09);
const CENTER = new Vector2(0, 0);

export function lampName(name: string, names = CONFIG.lampNames): string {
  return names[name] ?? name.replace(/-/g, ' ');
}

/** `verb` is how the visitor uses things: Click with a mouse, Tap on a touch screen. */
export function promptFor(t: Target, lights: LightGroups, verb = 'Click'): string {
  switch (t.kind) {
    case 'door': return t.door.isOpen ? `${verb}: close door` : `${verb}: open door`;
    case 'movable': return `${verb}: ${t.movable.isOpen ? 'close' : 'open'} ${movableNoun(t.movable.info)}`;
    case 'lamp': return `${verb}: turn ${lampName(t.name)} ${lights.isOn(t.group) ? 'off' : 'on'}`;
    case 'screen': {
      const s = t.screen;
      if (!s.isTv) return `${verb}: turn screen ${s.on ? 'off' : 'on'}`;
      return !s.on ? `${verb}: turn TV on` : s.lastChannel ? `${verb}: turn TV off` : `${verb}: next channel`;
    }
    default: return lights.isOn(t.room) ? `${verb}: turn light off` : `${verb}: turn light on`;
  }
}

/** `now`: seconds, for the screens' pictures. */
export function activate(t: Target, lights: LightGroups, now = 0): void {
  switch (t.kind) {
    case 'door': return t.door.toggle();
    case 'movable': return t.movable.toggle();
    case 'lamp': return lights.toggle(t.group);
    case 'screen': return t.screen.click(now);
    default: return lights.toggle(t.room);
  }
}

export function findTarget(hit: Object3D | null, targets: Map<Object3D, Target>): Target | null {
  for (let o: Object3D | null = hit; o; o = o.parent) {
    const t = targets.get(o);
    if (t) return t;
  }
  return null;
}

export function setHighlight(node: Object3D, on: boolean): void {
  node.traverse((o) => {
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!m || !m.emissive) return;
    if (!m.userData.baseEmissive) m.userData.baseEmissive = m.emissive.clone();
    m.emissive.copy(m.userData.baseEmissive);
    if (on) m.emissive.add(HIGHLIGHT);
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
  ) {
    this.raycaster.far = CONFIG.interactDistance;
    (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  }

  /** What's under a point on screen (normalised device coordinates); walls in `pickables` occlude targets behind them. */
  at(point: Vector2): Target | null {
    this.raycaster.setFromCamera(point, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, true)[0];
    return findTarget(hit?.object ?? null, this.targets);
  }

  /** Raycast from the crosshair and highlight what it's on. */
  update(): Target | null {
    const t = this.at(CENTER);
    if (t !== this.current) {
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
