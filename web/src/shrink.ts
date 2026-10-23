import {
  LinearFilter, Mesh, NoBlending, OrthographicCamera, PlaneGeometry, ShaderMaterial, type Texture, WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { LoadedMap } from './loader';
import { RGBM_GLSL } from './rgbm';

/** The power of two to divide a lightmap's size by so it fits in `max`. */
export function shrinkFactor(size: number, max: number): number {
  let f = 1;
  while (size / f > max) f *= 2;
  return f;
}

// Averages each block of source texels as light (decoded), not as RGBM bytes, and re-encodes with the same range.
// Texels outside every UV island are empty (alpha 0) and left out, so island edges don't darken; a block with
// none falls back to the ring around it, growing the islands by a texel as the bake's margin does at full size.
const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float range;
uniform int factor;
${RGBM_GLSL}
void main() {
  ivec2 o = ivec2( gl_FragCoord.xy ) * factor;
  ivec2 last = textureSize( map, 0 ) - 1;
  vec3 sum = vec3( 0.0 );
  float n = 0.0;
  for ( int grow = 0; grow < 2 && n == 0.0; grow ++ ) {
    int lo = grow == 0 ? 0 : - factor / 2;
    int hi = grow == 0 ? factor : factor + factor / 2;
    for ( int y = lo; y < hi; y ++ ) for ( int x = lo; x < hi; x ++ ) {
      vec4 c = texelFetch( map, clamp( o + ivec2( x, y ), ivec2( 0 ), last ), 0 );
      if ( c.a > 0.0 ) { sum += rgbmDecode( c, range ); n += 1.0; }
    }
  }
  if ( n == 0.0 ) { gl_FragColor = vec4( 0.0 ); return; }
  vec3 rgb = sum / n;
  float m = clamp( ceil( max( rgb.r, max( rgb.g, rgb.b ) ) / range * 255.0 ) / 255.0, 1.0 / 255.0, 1.0 );
  gl_FragColor = vec4( rgb / ( m * range ), m );
}`;

let pass: { quad: Mesh; material: ShaderMaterial; camera: OrthographicCamera } | null = null;

/**
 * A smaller copy of an RGBM lightmap, drawn on the GPU, when it's larger than `max` on a side. The original is
 * freed. Phones can't hold the full-size set: halving the 2048 px maps takes their memory from about 290 MB to 140.
 */
export function shrinkLightmap(renderer: WebGLRenderer, map: LoadedMap, max: number): LoadedMap {
  const { width, height } = map.texture.image as { width: number; height: number };
  const factor = shrinkFactor(Math.max(width, height), max);
  if (factor === 1) return map;
  if (!pass) {
    const material = new ShaderMaterial({
      uniforms: { map: { value: null }, range: { value: 1 }, factor: { value: 1 } },
      vertexShader: 'void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    pass = { quad, material, camera: new OrthographicCamera() };
  }
  const target = new WebGLRenderTarget(Math.max(1, width / factor), Math.max(1, height / factor), {
    depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter,
  });
  const u = pass.material.uniforms;
  u.map.value = map.texture;
  u.range.value = map.range;
  u.factor.value = factor;
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(pass.quad, pass.camera);
  renderer.setRenderTarget(previous);
  u.map.value = null;
  map.texture.dispose();
  const texture: Texture = target.texture;
  return { texture, range: map.range };
}
