import { Box3, DataTexture, Matrix4, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { CONFIG } from './config';

/** A soft round falloff in the green channel, for alphaMap: dark in the middle, gone at the edge. */
export function blobTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.min(1, Math.hypot(dx, dy));
      const a = Math.round(255 * (1 - r * r) ** 2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = a;
      data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size);
  t.needsUpdate = true;
  return t;
}

let shared: { geometry: PlaneGeometry; material: MeshBasicMaterial } | null = null;

function parts(): { geometry: PlaneGeometry; material: MeshBasicMaterial } {
  shared ??= {
    geometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    material: new MeshBasicMaterial({
      name: 'Contact shadow', color: 0x000000, alphaMap: blobTexture(), transparent: true, opacity: CONFIG.contactShadow.opacity,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false,
    }),
  };
  return shared;
}

const box = new Box3();

/** The box around what's under `o`, its contact shadows left out (they're flat patches on the surface, not in the way). */
export function solidBox(o: Object3D, out: Box3): Box3 {
  out.makeEmpty();
  o.updateWorldMatrix(true, true);
  o.traverse((c) => {
    if ((c as Mesh).isMesh && c.name !== 'Contact shadow') out.expandByObject(c, false);
  });
  return out;
}
const centre = new Vector3();
const m4 = new Matrix4();
const inv = new Matrix4();
const flat = new Quaternion();

/**
 * The darkening right under a small thing that stands on something: the loose things and the table's pieces are drawn
 * without the baked light and the sun's shadow, and without it they float. A soft blob on the surface below, sized to
 * the thing's footprint; it never takes the crosshair or a flight.
 */
export class ContactShadow {
  readonly mesh: Mesh;
  private at = new Vector3(NaN, NaN, NaN);
  private turn = new Quaternion();
  private on: Object3D | null = null;

  constructor() {
    const { geometry, material } = parts();
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'Contact shadow';
    this.mesh.raycast = () => {};
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  /** Under `thing` (posed in the world), on `parent`'s surface: the shadow follows a drawer as it slides. `spread`: how far
   * past the footprint it reaches (×); a flat board wants less than a mug. */
  place(thing: Object3D, parent: Object3D, spread: number = CONFIG.contactShadow.spread): void {
    if (this.on === parent && this.mesh.parent === parent && this.at.equals(thing.position) && this.turn.equals(thing.quaternion)) {
      this.mesh.visible = true;
      return;
    }
    this.on = parent;
    this.at.copy(thing.position);
    this.turn.copy(thing.quaternion);
    if (this.mesh.parent !== parent) parent.add(this.mesh);
    thing.updateWorldMatrix(true, true);
    box.makeEmpty();
    thing.traverse((o) => {
      if ((o as Mesh).isMesh && o !== this.mesh) box.expandByObject(o, false);
    });
    if (box.isEmpty()) {
      this.mesh.visible = false;
      return;
    }
    box.getCenter(centre);
    const s = spread;
    const w = Math.max(0.02, (box.max.x - box.min.x) * s);
    const l = Math.max(0.02, (box.max.z - box.min.z) * s);
    m4.compose(centre.set(centre.x, box.min.y + CONFIG.contactShadow.lift, centre.z), flat, new Vector3(w, 1, l));
    parent.updateWorldMatrix(true, false);
    m4.premultiply(inv.copy(parent.matrixWorld).invert());
    m4.decompose(this.mesh.position, this.mesh.quaternion, this.mesh.scale);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
