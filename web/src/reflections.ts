import {
  Box3, Color, CubeCamera, DataUtils, FloatType, HalfFloatType, LinearFilter, Mesh, NoBlending, type Object3D, OrthographicCamera,
  PlaneGeometry, PMREMGenerator, type Scene, ShaderMaterial, type Texture, Vector3, WebGLCubeRenderTarget, WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { CONFIG } from './config';
import type { ProbeBinding } from './lightmaps';
import type { LoadedMap } from './loader';
import type { ProbeInfo } from './manifest';
import { RGBM_GLSL } from './rgbm';

/** Mean of RGB triples in `px` (RGBA; half floats when given as 16-bit). */
export function meanRadiance(px: Uint16Array | Float32Array): Color {
  const half = px instanceof Uint16Array;
  const at = (i: number) => (half ? DataUtils.fromHalfFloat(px[i]) : px[i]);
  let r = 0;
  let g = 0;
  let b = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    r += at(i);
    g += at(i + 1);
    b += at(i + 2);
  }
  return new Color(r / n, g / n, b / n);
}

/** The average radiance a scene shows from its middle: six small faces rendered and read back. */
export function sceneMeanRadiance(renderer: WebGLRenderer, scene: Scene, size = 16): Color {
  const target = new WebGLCubeRenderTarget(size, { type: FloatType }); // RGBA float reads back everywhere WebGL2 renders to it
  const cam = new CubeCamera(0.01, 1000, target);
  cam.update(renderer, scene);
  const px = new Float32Array(size * size * 4);
  const sum = new Color(0, 0, 0);
  for (let face = 0; face < 6; face++) {
    renderer.readRenderTargetPixels(target, 0, 0, size, size, px, face);
    sum.add(meanRadiance(px));
  }
  target.dispose();
  sum.multiplyScalar(1 / 6);
  return sum.r + sum.g + sum.b > 0 ? sum : new Color(1, 1, 1); // a failed read: any level will do, the local light sets it
}

/** A probe binding of one prefiltered map for both layers, with what an average surface would get from it. */
export function probeBinding(day: Texture, light: Texture, dayMean: Color, lightMean: Color, box: Box3 | null, at: Vector3 | null): ProbeBinding {
  return {
    day,
    light: { value: light },
    dayIrradiance: { value: dayMean.clone().multiplyScalar(Math.PI) },
    lightIrradiance: { value: lightMean.clone().multiplyScalar(Math.PI) },
    boxMin: { value: box ? box.min.clone() : new Vector3() },
    boxMax: { value: box ? box.max.clone() : new Vector3() },
    at: { value: at ? at.clone() : new Vector3() },
    boxed: { value: box ? 1 : 0 },
  };
}

/**
 * Until a room has its own probes: the stand-in room environment (`env`, prefiltered from `envScene`) for both the sky
 * and the switch, at infinity. Its own brightness doesn't matter: the local light sets it, times a room's reflectance.
 */
export function standInProbe(renderer: WebGLRenderer, env: Texture, envScene: Object3D & Scene): ProbeBinding {
  const mean = sceneMeanRadiance(renderer, envScene).multiplyScalar(1 / CONFIG.reflections.standInAlbedo);
  return probeBinding(env, env, mean, mean, null, null);
}

/** An RGBM map decoded on the GPU into a half-float copy, the linear radiance PMREMGenerator prefilters. */
function decodeRgbm(renderer: WebGLRenderer, map: LoadedMap): WebGLRenderTarget {
  const { width, height } = map.texture.image as { width: number; height: number };
  const target = new WebGLRenderTarget(width, height, {
    type: HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter,
  });
  const material = new ShaderMaterial({
    uniforms: { map: { value: map.texture }, range: { value: map.range } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
    fragmentShader: `uniform sampler2D map; uniform float range; varying vec2 vUv;${RGBM_GLSL}
void main() { gl_FragColor = vec4( rgbmDecode( texture2D( map, vUv ), range ), 1.0 ); }`,
    blending: NoBlending, depthTest: false, depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(quad, new OrthographicCamera());
  renderer.setRenderTarget(previous);
  material.dispose();
  quad.geometry.dispose();
  map.texture.dispose();
  return target;
}

/** Prefiltered for every roughness (CubeUV), as three's environment lookups take it. */
function prefilter(renderer: WebGLRenderer, pmrem: PMREMGenerator, map: LoadedMap): Texture {
  const flat = decodeRgbm(renderer, map);
  const out = pmrem.fromEquirectangular(flat.texture).texture;
  flat.dispose();
  return out;
}

/** Each room's probes from the export, ready to bind; a room whose maps didn't load is left out (the stand-in). */
export function roomProbes(renderer: WebGLRenderer, infos: ProbeInfo[], maps: Map<string, LoadedMap>): Map<string, ProbeBinding> {
  const out = new Map<string, ProbeBinding>();
  if (infos.length === 0) return out;
  const pmrem = new PMREMGenerator(renderer);
  for (const p of infos) {
    const day = maps.get(p.day.file);
    if (!day) continue;
    const dayTex = prefilter(renderer, pmrem, day);
    const lightMap = p.light ? maps.get(p.light.file) : undefined;
    const lightTex = lightMap ? prefilter(renderer, pmrem, lightMap) : dayTex;
    const box = new Box3(new Vector3(...p.box[0]), new Vector3(...p.box[1]));
    out.set(p.room, probeBinding(dayTex, lightTex, new Color(...p.dayMean), lightMap ? new Color(...p.lightMean) : new Color(0, 0, 0), box, new Vector3(...p.at)));
  }
  pmrem.dispose();
  return out;
}
