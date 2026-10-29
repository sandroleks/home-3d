import { DataTexture, Group, ImageBitmapLoader, LinearFilter, NoColorSpace, Texture } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { CONFIG } from './config';
import { type Climate, parseClimate } from './climate';
import { type CollisionData, type LightmapRef, type Manifest, parseCollision, parseManifest } from './manifest';
import { parseSeats, type Seat } from './seats';
import { rememberBytes } from './stats';

export interface LoadedMap { texture: Texture; range: number }
export interface LoadedAssets {
  manifest: Manifest;
  collision: CollisionData;
  climate: Climate;
  /** Where visitors can sit and lie; none when the export has no seats.json. */
  seats: Seat[];
  scene: Group;
  day: Map<string, LoadedMap>;
  /** Reflection probes' equirectangular RGBM maps, by file (small: loaded with the day maps). */
  probes: Map<string, LoadedMap>;
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
  rememberBytes(t);
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

/** `prepare` gets each lightmap as it arrives and returns the one to use (phones shrink the large ones); `ktx2` reads
 * the models' GPU-compressed textures (KHR_texture_basisu). */
export async function loadAssets(
  onProgress: (fraction: number) => void, prepare: (m: LoadedMap) => LoadedMap = (m) => m, base = CONFIG.assetsBase,
  ktx2: KTX2Loader | null = null,
): Promise<LoadedAssets> {
  // `base` holds one layout of the flat (layout.ts); the climate and the neighbourhood are the same for every layout.
  const shared = CONFIG.assetsBase;
  const manifest = parseManifest(await fetchJson(`${base}manifest.json`));
  const collision = parseCollision(await fetchJson(`${base}collision.json`));
  const climate = parseClimate(await fetchJson(`${shared}climate.json`));
  const seats = fetchJson(`${base}seats.json`).then(parseSeats, (err) => {
    console.warn('seats.json failed to load; visitors can only sit on the floor.', err);
    return [];
  });

  const draco = new DRACOLoader().setDecoderPath(CONFIG.dracoPath);
  const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
  if (ktx2) gltfLoader.setKTX2Loader(ktx2);
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
  // Not shrunk on phones: they're 256 px wide at most.
  const probeRefs = unique(manifest.probes.flatMap((p) => (p.light ? [p.day, p.light] : [p.day])));
  const probesPromise = Promise.all(probeRefs.map(async (ref) => {
    try {
      const t = new Texture(await bitmapLoader.loadAsync(base + ref.file));
      configureLightmap(t);
      return [ref.file, { texture: t, range: ref.range }] as const;
    } catch (err) {
      console.warn(`Probe ${ref.file} failed to load; that room reflects the stand-in environment.`, err);
      return null;
    }
  }));
  const [gltf, dayEntries, probeEntries] = await Promise.all([gltfPromise, dayMapsPromise, probesPromise]);
  glbFraction = 1;
  report();

  // Packs carry a range per channel, not per file: they load as plain textures (range 1, unused).
  const packFiles = new Set([...manifest.chunks, ...manifest.doors, ...manifest.movables].flatMap((x) => x.packs.map((p) => p.file)));
  const lightRefs = unique([...manifest.chunks.flatMap((c) => (c.light ? [c.light] : [])), ...[...packFiles].map((file) => ({ file, range: 1 }))]);
  const light = Promise.all(lightRefs.map(async (ref) => [ref.file, await loadMap(ref, !packFiles.has(ref.file))] as const)).then(
    (entries) => new Map(entries),
  );
  const probes = new Map(probeEntries.filter((e) => e !== null));
  return { manifest, collision, climate, seats: await seats, scene: gltf.scene, day: new Map(dayEntries), probes, light, surroundings };
}
