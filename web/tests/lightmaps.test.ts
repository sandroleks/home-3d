import { Color, MeshStandardMaterial, ShaderLib, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { applyLightmap, fadeToward, patchFragment, patchVertex, RoomLights } from '../src/lightmaps';

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
    expect(f).toContain('uniform float lmSkyScale;'); expect(f).toContain('uniform vec3 lmFill;'); expect(f).toContain('+ lmFill');
    expect(f.indexOf('irradiance += (')).toBeGreaterThan(f.indexOf('#include <lights_fragment_maps>'));
  });

  it('fails loudly if three.js changes its includes', () => {
    expect(() => patchFragment('void main() {}')).toThrow(/lights_fragment_maps|common/);
  });
});

describe('applyLightmap', () => {
  it('wires uniforms through onBeforeCompile, sharing the intensity, sky and fill objects', () => {
    const m = new MeshStandardMaterial();
    const intensity = { value: 0.25 };
    const sky = { value: 0.8 };
    const fill = { value: new Color(0.1, 0.05, 0) };
    applyLightmap(m, { day: new Texture(), dayRange: 4, light: new Texture(), lightRange: 2, intensity, sky, fill }, 3);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.lmLightIntensity).toBe(intensity);
    expect(shader.uniforms.lmSkyScale).toBe(sky);
    expect(shader.uniforms.lmFill).toBe(fill);
    expect(shader.uniforms.lmScale.value).toBe(3);
    expect(shader.uniforms.lmDayRange.value).toBe(4);
    expect(m.customProgramCacheKey()).toBe('room-lightmap-v3');
  });
});

describe('fading', () => {
  it('moves linearly toward the target and clamps', () => {
    expect(fadeToward(0, 1, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(fadeToward(0.9, 1, 0.2, 0.4)).toBe(1);
    expect(fadeToward(0.3, 0, 0.2, 0.4)).toBe(0);
  });

  it('RoomLights toggles and eases intensity', () => {
    const lights = new RoomLights(['alpha'], 0.4);
    expect(lights.isOn('alpha')).toBe(false);
    lights.toggle('alpha');
    expect(lights.isOn('alpha')).toBe(true);
    lights.update(0.2);
    expect(lights.uniform('alpha').value).toBeCloseTo(0.5);
    lights.update(1);
    expect(lights.uniform('alpha').value).toBe(1);
    lights.toggle('nope');
    expect(lights.has('nope')).toBe(false);
  });
});
