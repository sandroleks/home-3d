import { Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, type Texture } from 'three';
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
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      return;
    }
    const m = src.clone();
    if (binding) {
      applyLightmap(m, binding);
      lit.push(m);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.material = m;
  });
  return lit;
}

const SURFACE_MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;

/**
 * Anisotropic filtering on every surface texture under root (and a ShaderMaterial's `map`): floors and walls seen along
 * the room stay sharp instead of going to mush. Lightmaps are left alone, they're smooth.
 */
export function setAnisotropy(root: Object3D, level: number): void {
  root.traverse((o) => {
    const mat = (o as Mesh).material as Material | Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const textures = SURFACE_MAPS.map((k) => (m as unknown as Record<string, Texture | null | undefined>)[k]);
      textures.push((m as { uniforms?: { map?: { value?: Texture | null } } }).uniforms?.map?.value);
      for (const t of textures) {
        if (t?.isTexture && t.anisotropy !== level) {
          t.anisotropy = level;
          t.needsUpdate = true;
        }
      }
    }
  });
}
