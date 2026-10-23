import { Camera, Color, Mesh, MeshStandardMaterial, Object3D, Raycaster, Vector2 } from 'three';
import { CONFIG } from './config';
import type { DoorState } from './doors';
import type { RoomLights } from './lightmaps';

export type Target =
  | { kind: 'door'; door: DoorState; node: Object3D }
  | { kind: 'switch'; room: string; node: Object3D };

const HIGHLIGHT = new Color(0.12, 0.12, 0.09);
const CENTER = new Vector2(0, 0);

export function promptFor(t: Target, lights: RoomLights): string {
  if (t.kind === 'door') return t.door.isOpen ? 'Click: close door' : 'Click: open door';
  return lights.isOn(t.room) ? 'Click: turn light off' : 'Click: turn light on';
}

export function activate(t: Target, lights: RoomLights): void {
  if (t.kind === 'door') t.door.toggle();
  else lights.toggle(t.room);
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
    private lights: RoomLights,
  ) {
    this.raycaster.far = CONFIG.interactDistance;
    (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  }

  /** Raycast from the crosshair; walls in `pickables` occlude targets behind them. */
  update(): Target | null {
    this.raycaster.setFromCamera(CENTER, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, true)[0];
    const t = findTarget(hit?.object ?? null, this.targets);
    if (t !== this.current) {
      if (this.current) setHighlight(this.current.node, false);
      if (t) setHighlight(t.node, true);
      this.current = t;
    }
    return t;
  }

  /** Activates what the crosshair is on, if anything, and returns it. */
  click(): Target | null {
    if (this.current) activate(this.current, this.lights);
    return this.current;
  }
}
