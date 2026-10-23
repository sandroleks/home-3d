import {
  Box3, Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, Scene, Vector3,
  type WebGLRenderer,
} from 'three';
import { CONFIG } from './config';

/** Flat ground layers (grass, asphalt, water…) lie in one plane; the bigger the layer, the further back it draws. */
export function groundOffsets(layers: { flat: boolean; area: number }[]): number[] {
  const order = layers.map((_, i) => i).filter((i) => layers[i].flat).sort((a, b) => layers[a].area - layers[b].area);
  const out = layers.map(() => 0);
  order.forEach((i, rank) => (out[i] = rank + 1));
  return out;
}

/** Swap the glTF materials for unlit ones: colour × texture × the sun and sky baked into COLOR_0. */
export function prepareSurroundings(root: Object3D): void {
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  const size = new Vector3();
  const offsets = groundOffsets(
    meshes.map((m) => {
      new Box3().setFromObject(m).getSize(size);
      return { flat: size.y < CONFIG.surroundingsFlatHeight, area: size.x * size.z };
    }),
  );
  meshes.forEach((m, i) => {
    const src = m.material as MeshStandardMaterial;
    const color = src.color.clone().multiplyScalar(CONFIG.surroundingsShadeScale);
    m.material = new MeshBasicMaterial({
      name: src.name, color, map: src.map, side: src.side, vertexColors: true,
      polygonOffset: offsets[i] > 0, polygonOffsetFactor: offsets[i], polygonOffsetUnits: offsets[i],
    });
  });
}

/**
 * The neighbourhood outside the windows. It is drawn first, with its own camera reaching kilometres
 * out, then the apartment on top after a depth clear, so the apartment keeps its depth precision.
 */
export class Surroundings {
  readonly scene = new Scene();
  private camera = new PerspectiveCamera();

  constructor(sky: Color) {
    this.scene.background = sky;
  }

  add(root: Object3D): void {
    prepareSurroundings(root);
    this.scene.add(root);
  }

  render(renderer: WebGLRenderer, eye: PerspectiveCamera): void {
    const c = this.camera;
    eye.matrixWorld.decompose(c.position, c.quaternion, c.scale);
    c.fov = eye.fov;
    c.aspect = eye.aspect;
    c.near = CONFIG.surroundingsNear;
    c.far = CONFIG.surroundingsFar;
    c.updateProjectionMatrix();
    renderer.render(this.scene, c);
  }
}
