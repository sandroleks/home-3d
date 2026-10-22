import { DataTexture, Group, LinearFilter, NoColorSpace, Texture, TextureLoader } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config';
import { type CollisionData, type LightmapRef, type Manifest, parseCollision, parseManifest } from './manifest';

export interface LoadedMap { texture: Texture; range: number }
export interface LoadedAssets {
  manifest: Manifest;
  collision: CollisionData;
  scene: Group;
  day: Map<string, LoadedMap>;
  light: Promise<Map<string, LoadedMap>>;
}

/** Mid-grey RGBM (0.5 × π irradiance): flat lighting when a lightmap fails to load. */
export const FALLBACK_LIGHTMAP = (() => {
  const t = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

export function configureLightmap(t: Texture): void {
  t.flipY = false; // glTF UV convention
  t.colorSpace = NoColorSpace; // RGBM data, not colour
  t.premultiplyAlpha = false;
  t.generateMipmaps = false;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadAssets(onProgress: (fraction: number) => void): Promise<LoadedAssets> {
  const base = CONFIG.assetsBase;
  const manifest = parseManifest(await fetchJson(`${base}manifest.json`));
  const collision = parseCollision(await fetchJson(`${base}collision.json`));

  const draco = new DRACOLoader().setDecoderPath(CONFIG.dracoPath);
  const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
  const texLoader = new TextureLoader();

  const dayRefs: LightmapRef[] = [...manifest.chunks.map((c) => c.day), ...manifest.doors.map((d) => d.lightmap)];
  let glbFraction = 0;
  let mapsDone = 0;
  const report = () => onProgress(0.6 * glbFraction + 0.4 * (mapsDone / Math.max(1, dayRefs.length)));

  const loadMap = async (ref: LightmapRef): Promise<LoadedMap> => {
    try {
      const t = await texLoader.loadAsync(base + ref.file);
      configureLightmap(t);
      return { texture: t, range: ref.range };
    } catch (err) {
      console.warn(`Lightmap ${ref.file} failed to load; that surface uses flat lighting.`, err);
      return { texture: FALLBACK_LIGHTMAP, range: 1 };
    }
  };

  const gltfPromise = gltfLoader.loadAsync(`${base}apartment.glb`, (e) => {
    if (e.total) {
      glbFraction = e.loaded / e.total;
      report();
    }
  });
  const dayEntries = await Promise.all(
    dayRefs.map(async (ref) => {
      const m = await loadMap(ref);
      mapsDone++;
      report();
      return [ref.file, m] as const;
    }),
  );
  const gltf = await gltfPromise;
  glbFraction = 1;
  report();

  const lightRefs = manifest.chunks.flatMap((c) => (c.light ? [c.light] : []));
  const light = Promise.all(lightRefs.map(async (ref) => [ref.file, await loadMap(ref)] as const)).then(
    (entries) => new Map(entries),
  );
  return { manifest, collision, scene: gltf.scene, day: new Map(dayEntries), light };
}
