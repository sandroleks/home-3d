import {
  CustomBlending, HalfFloatType, LinearFilter, NoBlending, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector2,
  WebGLRenderTarget, type Camera, type Scene, type Texture, type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CONFIG } from './config';

const MIPS = 5;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** What is brighter than the threshold, with a soft knee, from linear HDR. */
const BRIGHT = /* glsl */ `
uniform sampler2D map;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(map, vUv).rgb;
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-5);
  float w = max(soft, b - threshold) / max(b, 1e-5);
  gl_FragColor = vec4(c * w, 1.0);
}`;

/** A 9-tap separable Gaussian along `dir` (in texels). */
const BLUR = /* glsl */ `
uniform sampler2D map;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(map, vUv).rgb * 0.2270270270;
  c += texture2D(map, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(map, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(map, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(map, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

/** The apartment over the already drawn outside view: premultiplied HDR plus bloom, tone-mapped by the renderer. */
const COMPOSITE = /* glsl */ `
uniform sampler2D scene;
${Array.from({ length: MIPS }, (_, i) => `uniform sampler2D mip${i};`).join('\n')}
uniform float strength;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(scene, vUv);
  vec3 bloom = ${Array.from({ length: MIPS }, (_, i) => `texture2D(mip${i}, vUv).rgb`).join(' + ')};
  gl_FragColor = vec4(s.rgb + bloom * (strength / ${MIPS}.0), s.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function target(depth = false, samples = 0): WebGLRenderTarget {
  return new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: depth, samples });
}

/**
 * Renders a frame with bloom. The outside view goes straight to the screen as before (the sky isn't tone-mapped);
 * the apartment renders into a half-float target cleared to transparent; what is brighter than the threshold is
 * blurred down a chain of half-size targets; then the apartment and its bloom are drawn over the outside view.
 */
export class Bloom {
  private hdr: WebGLRenderTarget;
  private bright = target();
  private mips: { a: WebGLRenderTarget; b: WebGLRenderTarget }[] = [];
  private quad = new FullScreenQuad();
  private brightMat = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: BRIGHT, uniforms: { map: { value: null }, threshold: { value: 0 }, knee: { value: 0 } }, depthTest: false, depthWrite: false, blending: NoBlending });
  private blurMat = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: BLUR, uniforms: { map: { value: null }, dir: { value: new Vector2() } }, depthTest: false, depthWrite: false, blending: NoBlending });
  private compositeMat: ShaderMaterial;
  private size = new Vector2();

  constructor(private renderer: WebGLRenderer, private scale = 1, samples = 4) {
    this.hdr = target(true, samples);
    for (let i = 0; i < MIPS; i++) this.mips.push({ a: target(), b: target() });
    const uniforms: Record<string, { value: unknown }> = { scene: { value: this.hdr.texture }, strength: { value: CONFIG.bloom.strength } };
    this.mips.forEach((m, i) => { uniforms[`mip${i}`] = { value: m.a.texture }; });
    this.compositeMat = new ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: COMPOSITE, uniforms, depthTest: false, depthWrite: false, toneMapped: true,
      transparent: true, blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor, blendDstAlpha: OneMinusSrcAlphaFactor,
    });
  }

  private resize(): void {
    const s = this.renderer.getDrawingBufferSize(new Vector2());
    if (s.equals(this.size)) return;
    this.size.copy(s);
    this.hdr.setSize(s.x, s.y);
    let w = Math.max(1, Math.round(s.x * this.scale / 2));
    let h = Math.max(1, Math.round(s.y * this.scale / 2));
    this.bright.setSize(w, h);
    for (const m of this.mips) {
      m.a.setSize(w, h);
      m.b.setSize(w, h);
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
    }
  }

  private pass(material: ShaderMaterial, to: WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(to);
    this.quad.render(this.renderer);
  }

  private blur(from: Texture, m: { a: WebGLRenderTarget; b: WebGLRenderTarget }): void {
    const u = this.blurMat.uniforms;
    u.map.value = from;
    u.dir.value.set(1 / m.a.width, 0);
    this.pass(this.blurMat, m.b);
    u.map.value = m.b.texture;
    u.dir.value.set(0, 1 / m.a.height);
    this.pass(this.blurMat, m.a);
  }

  render(outside: () => void, scene: Scene, camera: Camera): void {
    const r = this.renderer;
    this.resize();
    r.setRenderTarget(null);
    r.clear();
    outside();
    const clearAlpha = r.getClearAlpha();
    r.setRenderTarget(this.hdr);
    r.setClearAlpha(0);
    r.clear();
    r.render(scene, camera);
    r.setClearAlpha(clearAlpha);

    this.brightMat.uniforms.map.value = this.hdr.texture;
    this.brightMat.uniforms.threshold.value = CONFIG.bloom.threshold;
    this.brightMat.uniforms.knee.value = CONFIG.bloom.knee;
    this.pass(this.brightMat, this.bright);
    let from: Texture = this.bright.texture;
    for (const m of this.mips) {
      this.blur(from, m);
      from = m.a.texture;
    }
    this.compositeMat.uniforms.strength.value = CONFIG.bloom.strength;
    this.pass(this.compositeMat, null);
  }

  dispose(): void {
    for (const t of [this.hdr, this.bright, ...this.mips.flatMap((m) => [m.a, m.b])]) t.dispose();
    this.quad.dispose();
  }
}
