import type { Material, Object3D, Texture, WebGLRenderer } from 'three';

/** Frame times (ms) summed up: the mean, the slow tail and the worst. */
export interface Summary { frames: number; mean: number; p95: number; max: number }

export function summarise(samples: number[]): Summary {
  if (samples.length === 0) return { frames: 0, mean: 0, p95: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { frames: samples.length, mean, p95, max: sorted[sorted.length - 1] };
}

/** Bytes a texture takes on the GPU, roughly: compressed data as it is, otherwise 4 bytes a texel (8 for half floats), a third more with mipmaps. */
export function textureBytes(t: Texture): number {
  if (typeof t.userData.gpuBytes === 'number') return t.userData.gpuBytes;
  const mips = (t as Texture & { mipmaps?: { data?: ArrayBufferView }[] }).mipmaps;
  if ((t as Texture & { isCompressedTexture?: boolean }).isCompressedTexture && mips?.length) {
    return mips.reduce((a, m) => a + (m.data?.byteLength ?? 0), 0);
  }
  const img = t.image as { width?: number; height?: number } | null;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  const texel = t.type === 1016 /* HalfFloatType */ ? 8 : 4;
  return w * h * texel * (t.generateMipmaps ? 4 / 3 : 1);
}

/** Notes a texture's size before its image is let go (lightmaps free theirs once uploaded). */
export function rememberBytes(t: Texture): void {
  t.userData.gpuBytes = textureBytes(t);
}

function texturesOf(m: Material, out: Set<Texture>): void {
  for (const v of Object.values(m)) if ((v as Texture | null)?.isTexture) out.add(v as Texture);
  const uniforms = { ...(m as { uniforms?: object }).uniforms, ...m.userData.lightmapUniforms };
  for (const u of Object.values(uniforms) as { value?: unknown }[]) {
    if ((u?.value as Texture | null)?.isTexture) out.add(u.value as Texture);
  }
}

/** Every texture the scenes' materials use, and what they take on the GPU. */
export function sceneTextures(roots: Object3D[]): { count: number; bytes: number } {
  const set = new Set<Texture>();
  for (const root of roots) {
    root.traverse((o) => {
      const m = (o as { material?: Material | Material[] }).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) texturesOf(mat, set);
    });
  }
  let bytes = 0;
  for (const t of set) bytes += textureBytes(t);
  return { count: set.size, bytes };
}

/** The GPU's own time for a frame, where the browser has timer queries (EXT_disjoint_timer_query_webgl2). */
class GpuTimer {
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  last: number | null = null;

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  begin(): void {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    const gl = this.gl;
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift()!;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) this.last = ns / 1e6;
      gl.deleteQuery(q);
    }
  }
}

export interface FrameNumbers { cpu: number; gpu: number | null; calls: number; triangles: number }

/**
 * ?stats: frame time (and the GPU's, where it can be measured), draw calls, triangles, shader programs and texture
 * memory, in a corner. Every render of a frame counts: the surroundings, the mirrors, the shadow map and the flat.
 */
export class FrameStats {
  private cpu: number[] = [];
  private gpu: number[] = [];
  private last = 0;
  private shownAt = 0;
  private textures = { count: 0, bytes: 0 };
  private texturesAt = -Infinity;
  private timer: GpuTimer;
  readonly el: HTMLElement | null;
  latest: FrameNumbers = { cpu: 0, gpu: null, calls: 0, triangles: 0 };
  /** Shown under the numbers: the bench's report once it's done. */
  extra = '';

  constructor(private renderer: WebGLRenderer, private roots: () => Object3D[], doc: Document | null) {
    renderer.info.autoReset = false;
    this.timer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
    this.el = doc ? doc.createElement('div') : null;
    if (this.el && doc) {
      this.el.className = 'frame-stats';
      doc.body.appendChild(this.el);
    }
  }

  begin(now: number): void {
    if (this.last) this.cpu.push(now - this.last);
    this.last = now;
    if (this.cpu.length > 240) this.cpu.shift();
    this.renderer.info.reset();
    this.timer.begin();
  }

  end(now: number): void {
    this.timer.end();
    const r = this.renderer.info.render;
    if (this.timer.last !== null) {
      this.gpu.push(this.timer.last);
      if (this.gpu.length > 240) this.gpu.shift();
    }
    this.latest = { cpu: this.cpu[this.cpu.length - 1] ?? 0, gpu: this.timer.last, calls: r.calls, triangles: r.triangles };
    if (now - this.texturesAt > 2000) {
      this.texturesAt = now;
      this.textures = sceneTextures(this.roots());
    }
    if (this.el && now - this.shownAt > 500) {
      this.shownAt = now;
      this.el.textContent = this.text();
    }
  }

  text(): string {
    const c = summarise(this.cpu);
    const g = summarise(this.gpu);
    const info = this.renderer.info;
    return [
      `frame ${c.mean.toFixed(1)} ms (95% ${c.p95.toFixed(1)}, worst ${c.max.toFixed(1)}) · ${(1000 / Math.max(c.mean, 1e-3)).toFixed(0)} fps`,
      g.frames ? `gpu ${g.mean.toFixed(1)} ms (95% ${g.p95.toFixed(1)})` : 'gpu: no timer queries here',
      `draw calls ${this.latest.calls} · triangles ${(this.latest.triangles / 1000).toFixed(0)}k`,
      `programs ${info.programs?.length ?? 0} · textures ${this.textures.count} ≈ ${(this.textures.bytes / 2 ** 20).toFixed(0)} MB`,
    ].join('\n') + this.extra;
  }
}

export interface BenchStop { name: string; x: number; y: number; z: number; pitch: number }
export interface BenchResult { name: string; cpu: Summary; gpu: Summary; calls: number; triangles: number }

/**
 * ?bench: the same walk every time, for before-and-after numbers. At each stop the view turns a full circle in
 * `seconds`; frames are measured per stop. The first second is a settling run (uploads, first compiles) and isn't kept.
 */
export class Bench {
  private i = -1;
  private t = 0;
  private settling = 1;
  private cpu: number[] = [];
  private gpu: number[] = [];
  private calls = 0;
  private triangles = 0;
  readonly results: BenchResult[] = [];
  done = false;

  constructor(private stops: BenchStop[], private seconds = 4) {}

  /** The pose for this frame, or null once the walk is over. */
  step(dt: number, frame: FrameNumbers): { stop: BenchStop; yaw: number } | null {
    if (this.done) return null;
    if (this.settling > 0) {
      this.settling -= dt;
      return { stop: this.stops[0], yaw: 0 };
    }
    if (this.i >= 0) {
      this.cpu.push(frame.cpu);
      if (frame.gpu !== null) this.gpu.push(frame.gpu);
      this.calls = Math.max(this.calls, frame.calls);
      this.triangles = Math.max(this.triangles, frame.triangles);
    }
    this.t += dt;
    if (this.i < 0 || this.t >= this.seconds) {
      if (this.i >= 0) {
        this.results.push({ name: this.stops[this.i].name, cpu: summarise(this.cpu), gpu: summarise(this.gpu), calls: this.calls, triangles: this.triangles });
      }
      this.i++;
      this.t = 0;
      this.cpu = [];
      this.gpu = [];
      this.calls = 0;
      this.triangles = 0;
      if (this.i >= this.stops.length) {
        this.done = true;
        return null;
      }
    }
    return { stop: this.stops[this.i], yaw: (this.t / this.seconds) * Math.PI * 2 };
  }

  /** One line per stop, then the whole walk. */
  report(): string {
    const all = this.results;
    const mean = (f: (r: BenchResult) => number) => all.reduce((a, r) => a + f(r), 0) / Math.max(1, all.length);
    const rows = all.map((r) => `${r.name.padEnd(14)} cpu ${r.cpu.mean.toFixed(1).padStart(5)} / ${r.cpu.p95.toFixed(1).padStart(5)} ms  gpu ${r.gpu.frames ? r.gpu.mean.toFixed(1).padStart(5) : '    -'} ms  calls ${String(r.calls).padStart(5)}  tris ${(r.triangles / 1000).toFixed(0).padStart(4)}k`);
    rows.push(`${'all'.padEnd(14)} cpu ${mean((r) => r.cpu.mean).toFixed(1).padStart(5)} / ${mean((r) => r.cpu.p95).toFixed(1).padStart(5)} ms  gpu ${mean((r) => r.gpu.mean).toFixed(1).padStart(5)} ms  calls ${mean((r) => r.calls).toFixed(0).padStart(5)}`);
    return rows.join('\n');
  }
}
