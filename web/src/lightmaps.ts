import { type Color, DataTexture, MeshStandardMaterial, Texture } from 'three';
import { CONFIG } from './config';
import { RGBM_GLSL } from './rgbm';

export interface LightmapBinding {
  day: Texture;
  dayRange: number;
  light: Texture;
  lightRange: number;
  intensity: { value: number };
  /** A second lamp layer: a door's leaf is lit from the rooms on both sides. Chunks leave it out. */
  light2?: { texture: Texture; range: number; intensity: { value: number } };
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

// Our own attribute + varying. The uv1 declaration is guarded so it can't collide with three's own
// when a material ever uses texCoord 1 (USE_UV1).
const VERTEX_DECL = /* glsl */ `
#ifndef USE_UV1
attribute vec2 uv1;
#endif
varying vec2 vLmUv;`;

const FRAGMENT_DECL = /* glsl */ `
varying vec2 vLmUv;
uniform sampler2D lmDay;
uniform sampler2D lmLight;
uniform float lmDayRange;
uniform float lmLightRange;
uniform float lmLightIntensity;
uniform float lmLightSpill;
uniform sampler2D lmLight2;
uniform float lmLight2Range;
uniform float lmLight2Intensity;
uniform float lmScale;
uniform float lmSkyScale;
uniform vec3 lmFill;
${RGBM_GLSL}`;

const ACCUMULATE = /* glsl */ `
#if defined( RE_IndirectDiffuse )
	irradiance += ( lmSkyScale * rgbmDecode( texture( lmDay, vLmUv ), lmDayRange )
		+ max( lmLightIntensity, lmLightSpill ) * rgbmDecode( texture( lmLight, vLmUv ), lmLightRange )
		+ max( lmLight2Intensity, lmLightSpill ) * rgbmDecode( texture( lmLight2, vLmUv ), lmLight2Range ) ) * lmScale
		+ lmFill;
#endif`;

function inject(src: string, anchor: string, extra: string): string {
  if (!src.includes(anchor)) throw new Error(`three.js shader is missing ${anchor}; update the lightmap patch`);
  return src.replace(anchor, `${anchor}\n${extra}`);
}

export function patchVertex(src: string): string {
  return inject(inject(src, '#include <common>', VERTEX_DECL), '#include <uv_vertex>', 'vLmUv = uv1;');
}

export function patchFragment(src: string): string {
  return inject(inject(src, '#include <common>', FRAGMENT_DECL), '#include <lights_fragment_maps>', ACCUMULATE);
}

export function applyLightmap(material: MeshStandardMaterial, b: LightmapBinding, scale = CONFIG.lightmapScale): void {
  const uniforms = {
    lmDay: { value: b.day },
    lmLight: { value: b.light },
    lmDayRange: { value: b.dayRange },
    lmLightRange: { value: b.lightRange },
    lmLightIntensity: b.intensity,
    lmLightSpill: LIGHT_SPILL,
    lmLight2: { value: b.light2?.texture ?? BLACK_LIGHTMAP },
    lmLight2Range: { value: b.light2?.range ?? 0 },
    lmLight2Intensity: b.light2?.intensity ?? { value: 0 },
    lmScale: { value: scale },
    lmSkyScale: b.sky,
    lmFill: b.fill,
  };
  material.userData.lightmapUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchVertex(shader.vertexShader);
    shader.fragmentShader = patchFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => 'room-lightmap-v4';
  material.needsUpdate = true;
}

/** Bind a lamp layer once it has loaded: slot 2 is a door's second room. */
export function setLightTexture(material: MeshStandardMaterial, texture: Texture, range: number, slot: 1 | 2 = 1): void {
  const u = material.userData.lightmapUniforms;
  u[slot === 1 ? 'lmLight' : 'lmLight2'].value = texture;
  u[slot === 1 ? 'lmLightRange' : 'lmLight2Range'].value = range;
}

export function fadeToward(current: number, target: number, dt: number, duration: number): number {
  const step = dt / duration;
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step);
}

export class RoomLights {
  private uniforms = new Map<string, { value: number }>();
  private targets = new Map<string, number>();
  private linear = new Map<string, number>();

  constructor(roomIds: string[], private duration = CONFIG.lightFadeDuration) {
    for (const id of roomIds) {
      this.uniforms.set(id, { value: 0 });
      this.targets.set(id, 0);
      this.linear.set(id, 0);
    }
  }

  uniform(id: string): { value: number } {
    const u = this.uniforms.get(id);
    if (!u) throw new Error(`no light for room ${id}`);
    return u;
  }

  has(id: string): boolean {
    return this.uniforms.has(id);
  }

  isOn(id: string): boolean {
    return this.targets.get(id) === 1;
  }

  toggle(id: string): void {
    if (this.has(id)) this.targets.set(id, this.isOn(id) ? 0 : 1);
  }

  update(dt: number): void {
    for (const [id, u] of this.uniforms) {
      const l = fadeToward(this.linear.get(id)!, this.targets.get(id)!, dt, this.duration);
      this.linear.set(id, l);
      u.value = l * l * (3 - 2 * l);
    }
  }
}
