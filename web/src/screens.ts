import {
  CanvasTexture, Color, LinearFilter, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D, RectAreaLight,
  SRGBColorSpace, Vector3,
} from 'three';
import { CONFIG } from './config';
import { fadeToward } from './lightmaps';
import type { ScreenInfo } from './manifest';
import { DesktopContent, type ScreenWorld, type Surface, TV_CHANNELS, TvContent } from './screen-content';

export type CanvasFactory = (width: number, height: number) => Surface & { width: number; height: number };

export const domCanvas: CanvasFactory = (width, height) => {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
};

/** A TV, monitor or laptop screen: a dark glossy panel while off, a generated picture (and the light it casts) while on. */
export class Screen {
  on = false;
  /** Fades the picture and its light in and out. */
  level = 0;
  readonly light: RectAreaLight | null;
  private content: TvContent | DesktopContent;
  private texture: CanvasTexture | null = null;
  private onMaterial: MeshBasicMaterial;
  private offMaterial: MeshStandardMaterial;
  private meshes: Mesh[] = [];
  private started = 0;
  private lastDraw = -Infinity;
  private average = new Color();

  constructor(readonly info: ScreenInfo, readonly node: Object3D, canvas: CanvasFactory = domCanvas) {
    const [w, h] = CONFIG.screens.sizes[info.kind] ?? [512, 288];
    const surface = canvas(w, h);
    this.content = info.kind === 'tv' ? new TvContent(surface) : new DesktopContent(surface, info.kind === 'laptop' ? 'laptop' : 'monitor');
    if (typeof HTMLCanvasElement !== 'undefined' && surface instanceof HTMLCanvasElement) {
      this.texture = new CanvasTexture(surface);
      this.texture.colorSpace = SRGBColorSpace;
      this.texture.flipY = false; // glTF UVs run top-down
      this.texture.minFilter = LinearFilter;
      this.texture.generateMipmaps = false;
    }
    this.onMaterial = new MeshBasicMaterial({ name: `${info.kind} picture`, map: this.texture, color: new Color(0, 0, 0) });
    this.offMaterial = new MeshStandardMaterial({ name: `${info.kind} glass`, color: 0x050607, roughness: 0.12, metalness: 0 });
    node.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      (mesh.material as Material).dispose?.();
      mesh.material = this.offMaterial;
      mesh.castShadow = false;
      this.meshes.push(mesh);
    });
    const strength = CONFIG.screens.light[info.kind] ?? 0;
    if (strength > 0) {
      const light = new RectAreaLight(0xffffff, 0, info.width, info.height);
      const c = new Vector3(...info.center);
      const n = new Vector3(...info.normal);
      light.position.copy(c).addScaledVector(n, 0.02);
      light.lookAt(c.clone().add(n));
      this.light = light;
    } else this.light = null;
  }

  get isTv(): boolean {
    return this.info.kind === 'tv';
  }

  /** On the last channel the next click switches the TV off. */
  get lastChannel(): boolean {
    return this.isTv && (this.content as TvContent).channel === TV_CHANNELS.length - 1;
  }

  /** The TV: on, then each channel in turn, then off. The monitor and laptop: on and off. */
  click(t: number): void {
    if (!this.on) {
      this.on = true;
      this.started = t;
      this.lastDraw = -Infinity;
      if (this.isTv) (this.content as TvContent).reset();
    } else if (!this.isTv || !(this.content as TvContent).next()) {
      this.on = false;
    }
  }

  /** t: seconds (monotonic); near: whether the viewer is close enough to keep the picture moving. */
  update(t: number, dt: number, world: ScreenWorld, near: boolean): void {
    this.level = fadeToward(this.level, this.on ? 1 : 0, dt, CONFIG.screens.fade);
    const visible = this.level > 0;
    for (const m of this.meshes) m.material = visible ? this.onMaterial : this.offMaterial;
    if (visible && (near || this.lastDraw === -Infinity) && t - this.lastDraw >= 1 / CONFIG.screens.fps) {
      this.lastDraw = t;
      this.content.draw(t - this.started, world);
      if (this.texture) this.texture.needsUpdate = true;
      const [r, g, b] = this.content.average();
      this.average.setRGB(r, g, b);
    }
    this.onMaterial.color.setScalar(CONFIG.screens.brightness * this.level);
    if (this.light) {
      const strength = CONFIG.screens.light[this.info.kind] ?? 0;
      this.light.color.copy(this.average);
      this.light.intensity = strength * this.level;
    }
  }
}
