import {
  type Camera, type Material, Mesh, type MeshStandardMaterial, type Object3D, PlaneGeometry, type Scene, type Texture,
  type WebGLRenderer, type WebGLRenderTarget,
} from 'three';

/**
 * Compile now every shader the walkthrough can need later, so nothing stalls mid-walk: hidden things (halos, the
 * screens' pictures) and the variants a mirror's render target needs (another colour space). Uses the browser's
 * parallel shader compile where it has one; the main thread only queues the work.
 */
export function warmUpShaders(renderer: WebGLRenderer, scene: Scene, camera: Camera, extra: Material[], targets: WebGLRenderTarget[]): Promise<unknown> {
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      o.visible = true;
      hidden.push(o);
    }
  });
  const stand = extra.map((m) => new Mesh(new PlaneGeometry(), m));
  for (const m of stand) scene.add(m);
  const previous = renderer.getRenderTarget();
  const jobs: Promise<unknown>[] = [renderer.compileAsync(scene, camera)];
  for (const t of targets) {
    renderer.setRenderTarget(t);
    jobs.push(renderer.compileAsync(scene, camera));
  }
  renderer.setRenderTarget(previous);
  for (const m of stand) {
    scene.remove(m);
    m.geometry.dispose();
  }
  for (const o of hidden) o.visible = false;
  return Promise.all(jobs);
}

/** Every texture the lightmapped materials use: base colours, and the day, switch and lamp layers bound so far. */
export function lightmapTextures(materials: MeshStandardMaterial[]): Texture[] {
  const out = new Set<Texture>();
  for (const m of materials) {
    if (m.map) out.add(m.map);
    for (const u of Object.values(m.userData.lightmapUniforms ?? {}) as { value: unknown }[]) {
      if ((u.value as Texture | null)?.isTexture) out.add(u.value as Texture);
    }
  }
  return [...out];
}

/**
 * Uploads textures to the GPU a few per frame, before they're first seen: three.js otherwise uploads each one the
 * first time a room comes into view, a visible hitch for a 2048 px lightmap.
 */
export class UploadQueue {
  private queue: Texture[] = [];
  private done = new Set<Texture>();

  constructor(private renderer: WebGLRenderer, private perFrame = 2) {}

  add(textures: Texture[]): void {
    for (const t of textures) if (!this.done.has(t)) this.queue.push(t);
  }

  get pending(): number {
    return this.queue.length;
  }

  tick(): void {
    for (let i = 0; i < this.perFrame && this.queue.length; i++) {
      const t = this.queue.shift()!;
      if (this.done.has(t)) continue;
      this.done.add(t);
      this.renderer.initTexture(t);
    }
  }
}
