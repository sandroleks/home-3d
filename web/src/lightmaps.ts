import { Color, DataTexture, MeshStandardMaterial, Texture, Vector3 } from 'three';
import { CONFIG } from './config';
import type { PackLayer } from './manifest';
import { RGBM_GLSL } from './rgbm';
import { type HueColour, tintFor, toneFor } from './hue';

/** Up to three packed lamp layers in one texture's RGB: each channel is (L / range)^(1/2.2), coloured by its tint. */
export interface PackBinding {
  texture: { value: Texture };
  /** Per channel: range x how much of that light is on right now. */
  gains: { value: Vector3 };
  tints: { value: Vector3[] };
  /** The tints as baked; a scene's colour temperature scales them (applyPacks). */
  baseTints: Vector3[];
  layers: PackLayer[];
}

export interface LightmapBinding {
  day: Texture;
  dayRange: number;
  light: Texture;
  lightRange: number;
  intensity: { value: number };
  /** The switch layer's colour against its bake: white unless a scene changed the colour temperature. */
  lightColor?: { value: Color };
  /** Packed lamp layers: the room's lamps, an open-plan neighbour's, light through the doors (at most CONFIG.maxPacks). */
  packs?: PackBinding[];
  /** Shared by every lightmapped material: how bright the baked sky is right now. */
  sky: { value: number };
  /** Per room: flat bounce light from sun entering its windows. */
  fill: { value: Color };
}

/** Shared by every lightmapped material: the lamp light that's there with the lights off (CONFIG.lightSpill). */
export const LIGHT_SPILL = { value: CONFIG.lightSpill };

export const BLACK_LIGHTMAP = (() => {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

export function packBinding(layers: PackLayer[]): PackBinding {
  const tints = [0, 1, 2].map((i) => (layers[i] ? new Vector3(...layers[i].tint) : new Vector3()));
  return {
    texture: { value: BLACK_LIGHTMAP }, gains: { value: new Vector3() }, tints: { value: tints },
    baseTints: tints.map((t) => t.clone()), layers,
  };
}

// Our own attribute + varying. The uv1 declaration is guarded so it can't collide with three's own
// when a material ever uses texCoord 1 (USE_UV1).
const VERTEX_DECL = /* glsl */ `
#ifndef USE_UV1
attribute vec2 uv1;
#endif
varying vec2 vLmUv;`;

function fragmentDecl(packs: number): string {
  let s = /* glsl */ `
varying vec2 vLmUv;
uniform sampler2D lmDay;
uniform sampler2D lmLight;
uniform float lmDayRange;
uniform float lmLightRange;
uniform float lmLightIntensity;
uniform float lmLightSpill;
uniform vec3 lmLightColor;
uniform float lmScale;
uniform float lmSkyScale;
uniform vec3 lmFill;
${RGBM_GLSL}`;
  for (let p = 0; p < packs; p++) s += `\nuniform sampler2D lmPack${p};\nuniform vec3 lmPackGain${p};\nuniform vec3 lmPackTint${p}[3];`;
  return s;
}

function accumulate(packs: number): string {
  let lamps = '';
  for (let p = 0; p < packs; p++) {
    lamps += /* glsl */ `
	{
		vec3 v = pow( texture( lmPack${p}, vLmUv ).rgb, vec3( 2.2 ) ) * lmPackGain${p};
		lmLamps += lmPackTint${p}[0] * v.x + lmPackTint${p}[1] * v.y + lmPackTint${p}[2] * v.z;
	}`;
  }
  return /* glsl */ `
#if defined( RE_IndirectDiffuse )
	vec3 lmLamps = max( lmLightIntensity, lmLightSpill ) * lmLightColor * rgbmDecode( texture( lmLight, vLmUv ), lmLightRange );${lamps}
	irradiance += ( lmSkyScale * rgbmDecode( texture( lmDay, vLmUv ), lmDayRange ) + lmLamps ) * lmScale + lmFill;
#endif`;
}

function inject(src: string, anchor: string, extra: string): string {
  if (!src.includes(anchor)) throw new Error(`three.js shader is missing ${anchor}; update the lightmap patch`);
  return src.replace(anchor, `${anchor}\n${extra}`);
}

export function patchVertex(src: string): string {
  return inject(inject(src, '#include <common>', VERTEX_DECL), '#include <uv_vertex>', 'vLmUv = uv1;');
}

export function patchFragment(src: string, packs = 0): string {
  return inject(inject(src, '#include <common>', fragmentDecl(packs)), '#include <lights_fragment_maps>', accumulate(packs));
}

export function applyLightmap(material: MeshStandardMaterial, b: LightmapBinding, scale = CONFIG.lightmapScale): void {
  const packs = b.packs ?? [];
  if (packs.length > CONFIG.maxPacks) throw new Error(`${packs.length} lamp packs on one material; the shader takes ${CONFIG.maxPacks}`);
  const uniforms: Record<string, { value: unknown }> = {
    lmDay: { value: b.day },
    lmLight: { value: b.light },
    lmDayRange: { value: b.dayRange },
    lmLightRange: { value: b.lightRange },
    lmLightIntensity: b.intensity,
    lmLightSpill: LIGHT_SPILL,
    lmLightColor: b.lightColor ?? { value: new Color(1, 1, 1) },
    lmScale: { value: scale },
    lmSkyScale: b.sky,
    lmFill: b.fill,
  };
  packs.forEach((p, i) => {
    uniforms[`lmPack${i}`] = p.texture;
    uniforms[`lmPackGain${i}`] = p.gains;
    uniforms[`lmPackTint${i}`] = p.tints;
  });
  material.userData.lightmapUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchVertex(shader.vertexShader);
    shader.fragmentShader = patchFragment(shader.fragmentShader, packs.length);
  };
  material.customProgramCacheKey = () => `room-lightmap-v6-${packs.length}`;
  material.needsUpdate = true;
}

/** Bind the switch layer once it has loaded. */
export function setLightTexture(material: MeshStandardMaterial, texture: Texture, range: number): void {
  const u = material.userData.lightmapUniforms;
  u.lmLight.value = texture;
  u.lmLightRange.value = range;
}

export function fadeToward(current: number, target: number, dt: number, duration: number): number {
  const step = dt / duration;
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step);
}

/**
 * One fading level per light group: each room's wall switch (by room id) and each lamp that switches on its own.
 * A group is on or off, and when on it shines at its brightness (1 = as baked) and colour temperature (mireds, 0 = as
 * baked) or Hue colour; a Hue scene sets them (setScene, setColour). Switching off and on again keeps them.
 */
export class LightGroups {
  private uniforms = new Map<string, { value: number }>();
  private targets = new Map<string, number>();
  private linear = new Map<string, number>();
  private levels = new Map<string, { target: number; current: number }>();
  private colors = new Map<string, { mireds: number; colour: HueColour | null; target: Color; value: Color }>();

  constructor(ids: string[], private duration = CONFIG.lightFadeDuration) {
    for (const id of ids) {
      this.uniforms.set(id, { value: 0 });
      this.targets.set(id, 0);
      this.linear.set(id, 0);
      this.levels.set(id, { target: 1, current: 1 });
      this.colors.set(id, { mireds: 0, colour: null, target: new Color(1, 1, 1), value: new Color(1, 1, 1) });
    }
  }

  uniform(id: string): { value: number } {
    const u = this.uniforms.get(id);
    if (!u) throw new Error(`no light group ${id}`);
    return u;
  }

  /** The group's colour against its bake, for the shaders and glows to multiply by. */
  color(id: string): { value: Color } {
    const c = this.colors.get(id);
    if (!c) throw new Error(`no light group ${id}`);
    return c;
  }

  has(id: string): boolean {
    return this.uniforms.has(id);
  }

  ids(): string[] {
    return [...this.uniforms.keys()];
  }

  isOn(id: string): boolean {
    return this.targets.get(id) === 1;
  }

  /** How bright the group shines when on, 0..1. */
  brightness(id: string): number {
    return this.levels.get(id)?.target ?? 0;
  }

  /** The group's colour temperature in mireds; 0 while it is as baked. */
  mireds(id: string): number {
    return this.colors.get(id)?.mireds ?? 0;
  }

  toggle(id: string): void {
    if (this.has(id)) this.targets.set(id, this.isOn(id) ? 0 : 1);
  }

  set(id: string, on: boolean): void {
    if (this.has(id)) this.targets.set(id, on ? 1 : 0);
  }

  /** On at `brightness` (0..1; 0 switches off and keeps the last brightness), at `mireds` when given (> 0). */
  setScene(id: string, brightness: number, mireds = 0): void {
    if (!this.has(id)) return;
    const b = Math.min(1, Math.max(0, brightness));
    this.targets.set(id, b > 0 ? 1 : 0);
    if (b > 0) this.levels.get(id)!.target = b;
    if (mireds > 0) this.setTone(id, mireds);
  }

  /** The colour temperature alone, in mireds (0: back to as baked). It takes the place of a colour. */
  setTone(id: string, mireds: number): void {
    const c = this.colors.get(id);
    if (!c) return;
    c.mireds = Math.max(0, mireds);
    c.colour = null;
    c.target.copy(toneFor(c.mireds));
  }

  /** The group's Hue colour, while a colour scene set one; null while it shows a colour temperature or as baked. */
  colour(id: string): HueColour | null {
    return this.colors.get(id)?.colour ?? null;
  }

  /** A Hue colour in place of the colour temperature. */
  setColour(id: string, colour: HueColour): void {
    const c = this.colors.get(id);
    if (!c) return;
    c.mireds = 0;
    c.colour = [colour[0], colour[1]];
    c.target.copy(tintFor(colour));
  }

  update(dt: number): void {
    const k = Math.min(1, dt / this.duration);
    for (const [id, u] of this.uniforms) {
      const l = fadeToward(this.linear.get(id)!, this.targets.get(id)!, dt, this.duration);
      this.linear.set(id, l);
      const level = this.levels.get(id)!;
      level.current = fadeToward(level.current, level.target, dt, this.duration);
      u.value = l * l * (3 - 2 * l) * level.current;
      const c = this.colors.get(id)!;
      c.value.lerp(c.target, k);
    }
  }
}

/** Sets every pack's channel gains from how much of each layer's light is on (`level`, 0..1). */
export function updatePacks(packs: PackBinding[], level: (layer: PackLayer) => number): void {
  for (const p of packs) {
    const g = p.gains.value;
    g.set(0, 0, 0);
    p.layers.forEach((l, i) => g.setComponent(i, l.range * level(l)));
  }
}
