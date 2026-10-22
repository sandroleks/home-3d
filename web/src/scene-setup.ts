import { Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D } from 'three';
import { applyLightmap, type LightmapBinding } from './lightmaps';

export function isGlass(m: Material): boolean {
  return /glass|acrylic/i.test(m.name) || ((m as MeshPhysicalMaterial).transmission ?? 0) > 0;
}

export function makeGlass(m: MeshStandardMaterial): MeshStandardMaterial {
  return new MeshStandardMaterial({
    name: m.name,
    color: m.color,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
}

/** Clone each mesh's material (chunks share glTF materials) and attach the chunk's lightmaps. */
export function prepareMeshes(node: Object3D, binding: LightmapBinding | null): MeshStandardMaterial[] {
  const lit: MeshStandardMaterial[] = [];
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as MeshStandardMaterial;
    if (isGlass(src)) {
      mesh.material = makeGlass(src);
      return;
    }
    const m = src.clone();
    if (binding) {
      applyLightmap(m, binding);
      lit.push(m);
    }
    mesh.material = m;
  });
  return lit;
}
