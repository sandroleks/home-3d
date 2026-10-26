import { Color, MeshStandardMaterial, ShaderLib, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { applyLightmap, fadeToward, LightGroups, packBinding, patchFragment, patchVertex, setLightTexture, updatePacks } from '../src/lightmaps';

const base = () => ({ day: new Texture(), dayRange: 4, light: new Texture(), lightRange: 2, intensity: { value: 0.25 }, sky: { value: 0.8 }, fill: { value: new Color(0.1, 0.05, 0) } });

describe('shader patches', () => {
  it('patch the standard material shaders', () => {
    const v = patchVertex(ShaderLib.standard.vertexShader);
    expect(v).toContain('attribute vec2 uv1;');
    expect(v).toContain('vLmUv = uv1;');
    expect(v).toMatch(/#ifndef USE_UV1\s+attribute vec2 uv1;\s+#endif/);
    const f = patchFragment(ShaderLib.standard.fragmentShader);
    expect(f).toContain('uniform sampler2D lmDay;');
    expect(f).toContain('irradiance += ');
    expect(f).toContain('max( lmLightIntensity, lmLightSpill )');
    expect(f).toContain('uniform float lmSkyScale;');
    expect(f).toContain('uniform vec3 lmFill;');
    expect(f).toContain('+ lmFill');
    expect(f).not.toContain('lmPack0');
    expect(f.indexOf('irradiance += (')).toBeGreaterThan(f.indexOf('#include <lights_fragment_maps>'));
  });

  it('adds one block per pack', () => {
    const f = patchFragment(ShaderLib.standard.fragmentShader, 2);
    expect(f).toContain('uniform sampler2D lmPack1;');
    expect(f).toContain('uniform vec3 lmPackTint1[3];');
    expect(f).toContain('pow( texture( lmPack0, vLmUv ).rgb, vec3( 2.2 ) ) * lmPackGain0');
    expect(f).not.toContain('lmPack2');
  });

  it('fails loudly if three.js changes its includes', () => {
    expect(() => patchFragment('void main() {}')).toThrow(/lights_fragment_maps|common/);
  });
});

describe('applyLightmap', () => {
  it('wires uniforms through onBeforeCompile, sharing the intensity, sky and fill objects', () => {
    const m = new MeshStandardMaterial();
    const b = base();
    applyLightmap(m, b, 3);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.lmLightIntensity).toBe(b.intensity);
    expect(shader.uniforms.lmSkyScale).toBe(b.sky);
    expect(shader.uniforms.lmFill).toBe(b.fill);
    expect(shader.uniforms.lmScale.value).toBe(3);
    expect(shader.uniforms.lmDayRange.value).toBe(4);
    expect(m.customProgramCacheKey()).toBe('room-lightmap-v6-0');
    const tex = new Texture();
    setLightTexture(m, tex, 5);
    expect(m.userData.lightmapUniforms.lmLight.value).toBe(tex);
    expect(m.userData.lightmapUniforms.lmLightRange.value).toBe(5);
  });

  it('shares pack uniforms, so a loaded texture or new gains reach every material', () => {
    const pack = packBinding([{ group: 'a', range: 2, tint: [1.2, 1, 0.8] }, { spill: { opening: 1, from: 'b' }, range: 0.5, tint: [1, 1, 1] }]);
    const m1 = new MeshStandardMaterial();
    const m2 = new MeshStandardMaterial();
    applyLightmap(m1, { ...base(), packs: [pack] });
    applyLightmap(m2, { ...base(), packs: [pack] });
    expect(m1.customProgramCacheKey()).toBe('room-lightmap-v6-1');
    expect(m1.userData.lightmapUniforms.lmPack0).toBe(m2.userData.lightmapUniforms.lmPack0);
    expect(pack.tints.value[0].toArray()).toEqual([1.2, 1, 0.8]);
    expect(pack.tints.value[2].toArray()).toEqual([0, 0, 0]);
    updatePacks([pack], (l) => (l.group ? 0.5 : 1));
    expect(m2.userData.lightmapUniforms.lmPackGain0.value.toArray()).toEqual([1, 0.5, 0]);
  });

  it('refuses more packs than the shader takes', () => {
    const packs = [0, 1, 2, 3].map(() => packBinding([]));
    expect(() => applyLightmap(new MeshStandardMaterial(), { ...base(), packs })).toThrow('lamp packs');
  });
});

describe('fading', () => {
  it('moves linearly toward the target and clamps', () => {
    expect(fadeToward(0, 1, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(fadeToward(0.9, 1, 0.2, 0.4)).toBe(1);
    expect(fadeToward(0.3, 0, 0.2, 0.4)).toBe(0);
  });

  it('LightGroups toggles and eases intensity', () => {
    const lights = new LightGroups(['alpha', 'alpha/lamp'], 0.4);
    expect(lights.isOn('alpha')).toBe(false);
    lights.toggle('alpha');
    expect(lights.isOn('alpha')).toBe(true);
    expect(lights.isOn('alpha/lamp')).toBe(false);
    lights.update(0.2);
    expect(lights.uniform('alpha').value).toBeCloseTo(0.5);
    lights.update(1);
    expect(lights.uniform('alpha').value).toBe(1);
    lights.set('alpha/lamp', true);
    lights.set('alpha/lamp', true);
    expect(lights.isOn('alpha/lamp')).toBe(true);
    lights.toggle('nope');
    expect(lights.has('nope')).toBe(false);
  });

  it('LightGroups dims and tones a group for a scene, and keeps both through off and on', () => {
    const lights = new LightGroups(['alpha'], 0.4);
    lights.setScene('alpha', 0.3, 447);
    expect(lights.isOn('alpha')).toBe(true);
    expect(lights.brightness('alpha')).toBeCloseTo(0.3);
    expect(lights.mireds('alpha')).toBe(447);
    lights.update(5);
    expect(lights.uniform('alpha').value).toBeCloseTo(0.3);
    const warm = lights.color('alpha').value;
    expect(warm.r).toBeGreaterThan(warm.b);
    lights.toggle('alpha');
    lights.update(5);
    expect(lights.uniform('alpha').value).toBe(0);
    lights.toggle('alpha');
    lights.update(5);
    expect(lights.uniform('alpha').value).toBeCloseTo(0.3);
    lights.setScene('alpha', 0);
    expect(lights.isOn('alpha')).toBe(false);
    expect(lights.brightness('alpha')).toBeCloseTo(0.3);
    lights.setTone('alpha', 0);
    lights.update(5);
    expect(lights.color('alpha').value.r).toBeCloseTo(1);
  });
});
