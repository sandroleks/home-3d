import { DataTexture, Group, ImageBitmapLoader, LinearFilter, NoColorSpace, Texture } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config';
import { type Climate, parseClimate } from './climate';
import { type CollisionData, type LightmapRef, type Manifest, parseCollision, parseManifest } from './manifest';

export interface LoadedMap { texture: Texture; range: number }
export interface LoadedAssets {
  manifest: Manifest;
  collision: CollisionData;
  climate: Climate;
  scene: Group;
  day: Map<string, LoadedMap>;
  light: Promise<Map<string, LoadedMap>>;
  /** The neighbourhood outside the windows; null when the export has none or it fails to load. */
  surroundings: Promise<Group | null>;
}

/** A pack that fails to load adds no lamp light. */
const BLACK = (() => {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** Mid-grey RGBM (0.5 × π irradiance): flat lighting when a lightmap fails to load. */
export const FALLBACK_LIGHTMAP = (() => {
  const t = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** Once on the GPU a lightmap's decoded pixels aren't needed again (lightmaps never re-upload), and phones run short of memory holding both. */
function releaseImage(t: Texture): void {
  if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
}

export function configureLightmap(t: Texture): void {
  t.flipY = false; // glTF UV convention
  t.colorSpace = NoColorSpace; // RGBM data, not colour
  t.premultiplyAlpha = false;
  t.generateMipmaps = false;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.onUpdate = () => releaseImage(t);
  t.needsUpdate = true;
}

/** One load per file: an atlas or pack is shared by everything in its room. */
export function unique(refs: LightmapRef[]): LightmapRef[] {
  const seen = new Map<string, LightmapRef>();
  for (const r of refs) if (!seen.has(r.file)) seen.set(r.file, r);
  return [...seen.values()];
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** `prepare` gets each lightmap as it arrives and returns the one to use (phones shrink the large ones). */
export async function loadAssets(
  onProgress: (fraction: number) => void, prepare: (m: LoadedMap) => LoadedMap = (m) => m, base = CONFIG.assetsBase,
): Promise<LoadedAssets> {
  // `base` holds one layout of the flat (layout.ts); the climate and the neighbourhood are the same for every layout.
  const shared = CONFIG.assetsBase;
  const manifest = parseManifest(await fetchJson(`${base}manifest.json`));
  const collision = parseCollision(await fetchJson(`${base}collision.json`));
  const climate = parseClimate(await fetchJson(`${shared}climate.json`));

  const draco = new DRACOLoader().setDecoderPath(CONFIG.dracoPath);
  const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
  // ImageBitmapLoader with premultiplyAlpha 'none': browsers may premultiply <img> data (TextureLoader),
  // which destroys the precision of low-alpha RGBM pixels.
  const bitmapLoader = new ImageBitmapLoader().setOptions({
    imageOrientation: 'none',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });

  const dayRefs = unique([...manifest.chunks.map((c) => c.day), ...manifest.doors.map((d) => d.lightmap), ...manifest.movables.map((m) => m.lightmap)]);
  let glbFraction = 0;
  let mapsDone = 0;
  const report = () => onProgress(0.6 * glbFraction + 0.4 * (mapsDone / Math.max(1, dayRefs.length)));

  /** rgbm: false for packs, which aren't RGBM and never need shrinking (half a room's size at most). */
  const loadMap = async (ref: LightmapRef, rgbm = true): Promise<LoadedMap> => {
    try {
      const t = new Texture(await bitmapLoader.loadAsync(base + ref.file));
      configureLightmap(t);
      return rgbm ? prepare({ texture: t, range: ref.range }) : { texture: t, range: ref.range };
    } catch (err) {
      console.warn(`Lightmap ${ref.file} failed to load; that surface uses flat lighting.`, err);
      return { texture: rgbm ? FALLBACK_LIGHTMAP : BLACK, range: 1 };
    }
  };

  // Not part of the first view: the windows show the flat sky until it arrives.
  const surroundings = gltfLoader.loadAsync(`${shared}surroundings.glb`).then(
    (g) => g.scene,
    (err) => {
      console.warn('surroundings.glb failed to load; the windows show only the sky.', err);
      return null;
    },
  );
  const gltfPromise = gltfLoader.loadAsync(`${base}apartment.glb`, (e) => {
    if (e.total) {
      glbFraction = e.loaded / e.total;
      report();
    }
  });
  const dayMapsPromise = Promise.all(
    dayRefs.map(async (ref) => {
      const m = await loadMap(ref);
      mapsDone++;
      report();
      return [ref.file, m] as const;
    }),
  );
  const [gltf, dayEntries] = await Promise.all([gltfPromise, dayMapsPromise]);
  glbFraction = 1;
  report();

  // Packs carry a range per channel, not per file: they load as plain textures (range 1, unused).
  const packFiles = new Set([...manifest.chunks, ...manifest.doors, ...manifest.movables].flatMap((x) => x.packs.map((p) => p.file)));
  const lightRefs = unique([...manifest.chunks.flatMap((c) => (c.light ? [c.light] : [])), ...[...packFiles].map((file) => ({ file, range: 1 }))]);
  const light = Promise.all(lightRefs.map(async (ref) => [ref.file, await loadMap(ref, !packFiles.has(ref.file))] as const)).then(
    (entries) => new Map(entries),
  );
  return { manifest, collision, climate, scene: gltf.scene, day: new Map(dayEntries), light, surroundings };
}
