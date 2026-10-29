import {
  BufferAttribute, type BufferGeometry, DataTexture, LinearMipmapLinearFilter, type Mesh, type MeshStandardMaterial, NoColorSpace,
  type Object3D, RepeatWrapping, Vector2,
} from 'three';
import { CONFIG } from './config';

/**
 * Surface detail for plain materials (one flat colour in the model): plaster's mottling, a fabric's weave, the grain of
 * plain wood. A small seamless tile made here at load (a base-colour multiplier around 1, and a normal map from the
 * same heights), box-projected at the material's real scale. The baked light is untouched; the detail shows in the
 * colour, and in the sun and the reflections through its normals.
 */
export type DetailKind = 'plaster' | 'fabric' | 'wood';

/** Which detail a material gets, by name (null: none). */
export function detailFor(name: string): DetailKind | null {
  for (const [kind, re] of Object.entries(CONFIG.details.match) as [DetailKind, RegExp][]) if (re.test(name)) return kind;
  return null;
}

/** A seeded PRNG (mulberry32), so every visitor sees the same tiles. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth noise on a `cells` x `cells` lattice that wraps, sampled at (u, v) in 0..1, about -1..1. */
function lattice(cells: number, seed: number): (u: number, v: number) => number {
  const rnd = random(seed);
  const g = Array.from({ length: cells * cells }, () => rnd() * 2 - 1);
  const at = (i: number, j: number) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
  const s = (t: number) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = s(x - i);
    const fy = s(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** Heights 0..1 over the tile (size x size, wrapping) for a kind of surface. */
export function detailHeights(kind: DetailKind, size: number): Float32Array {
  const h = new Float32Array(size * size);
  const n1 = lattice(8, 11);
  const n2 = lattice(32, 12);
  const n3 = lattice(64, 13);
  const threads = CONFIG.details.threads;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let value: number;
      if (kind === 'plaster') value = 0.55 * n1(u, v) + 0.3 * n2(u, v) + 0.15 * n3(u, v);
      else if (kind === 'fabric') {
        // plain weave: warp and weft crossing over and under, with slubs along the threads
        const a = Math.sin(2 * Math.PI * threads * u);
        const b = Math.sin(2 * Math.PI * threads * v);
        value = 0.7 * a * b + 0.2 * n3(u, v * 0.25) + 0.1 * n2(u, v);
      } else {
        const warp = 0.03 * n1(u, v);
        value = 0.5 * n3(u + warp, v / 16) + 0.35 * n2(u + warp, v / 8) + 0.15 * Math.cos(2 * Math.PI * (u * 6 + n1(u, v) * 0.2));
      }
      h[y * size + x] = value;
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of h) {
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / Math.max(hi - lo, 1e-6);
  return h;
}

function texture(data: Uint8Array, size: number): DataTexture {
  const t = new DataTexture(data, size, size);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

export interface Detail { map: DataTexture; normalMap: DataTexture; mean: number; tile: number; normalScale: number }

/** The tile for a kind: its multiplier (mean `mean`, never above 1) and its normals. */
export function makeDetail(kind: DetailKind, size = 256): Detail {
  const cfg = CONFIG.details.kinds[kind];
  const h = detailHeights(kind, size);
  const colour = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  let sum = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const m = 1 - cfg.depth * (1 - h[i]); // darker in the low parts
      sum += m;
      colour[i * 4] = colour[i * 4 + 1] = colour[i * 4 + 2] = Math.round(m * 255);
      colour[i * 4 + 3] = 255;
      const dx = (h[y * size + ((x + 1) % size)] - h[y * size + ((x + size - 1) % size)]) * 0.5 * cfg.relief;
      const dy = (h[((y + 1) % size) * size + x] - h[((y + size - 1) % size) * size + x]) * 0.5 * cfg.relief;
      const len = Math.hypot(dx, dy, 1);
      normal[i * 4] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      normal[i * 4 + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      normal[i * 4 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      normal[i * 4 + 3] = 255;
    }
  }
  return { map: texture(colour, size), normalMap: texture(normal, size), mean: sum / (size * size), tile: cfg.tile, normalScale: cfg.normalScale };
}

/**
 * UVs for a box projection in the mesh's own space: each vertex takes the two axes across its normal, over `tile`
 * metres, so the tile lies at its real size on every face.
 */
export function boxUvs(geometry: BufferGeometry, tile: number): BufferAttribute {
  const p = geometry.attributes.position;
  const n = geometry.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) [u, v] = [p.getX(i), p.getZ(i)];
    else if (ax >= az) [u, v] = [p.getZ(i), p.getY(i)];
    else [u, v] = [p.getX(i), p.getY(i)];
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  return new BufferAttribute(uv, 2);
}

/** Gives every plain material under root its detail (once per material; each mesh's geometry gets box UVs). */
export function applyDetails(root: Object3D): number {
  const made = new Map<DetailKind, Detail>();
  const done = new Map<BufferGeometry, number>();
  let count = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    const m = mesh.material as MeshStandardMaterial | undefined;
    if (!mesh.isMesh || !m?.isMeshStandardMaterial || m.map || m.normalMap || m.transparent || m.userData.detail) return;
    const kind = detailFor(m.name);
    if (!kind || !mesh.geometry.attributes.normal) return;
    let d = made.get(kind);
    if (!d) made.set(kind, (d = makeDetail(kind)));
    if (done.get(mesh.geometry) !== d.tile) {
      mesh.geometry.setAttribute('uv', boxUvs(mesh.geometry, d.tile));
      done.set(mesh.geometry, d.tile);
    }
    m.map = d.map;
    m.normalMap = d.normalMap;
    m.normalScale = new Vector2(d.normalScale, d.normalScale);
    m.color.multiplyScalar(1 / d.mean);
    m.userData.detail = kind;
    m.needsUpdate = true;
    count++;
  });
  return count;
}
