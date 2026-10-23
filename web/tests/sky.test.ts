import { Color, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { cloudCover, Sky, skyColors } from '../src/sky';
import { Surroundings } from '../src/surroundings';

const hex = (c: string) => new Color(c).getHex();

describe('skyColors', () => {
  it('runs the horizon and zenith from day through sunset to night', () => {
    expect(skyColors(20).horizon.getHex()).toBe(hex(CONFIG.skyColor));
    expect(skyColors(20).zenith.getHex()).toBe(hex(CONFIG.sky.zenith));
    expect(skyColors(0).horizon.getHex()).toBe(hex(CONFIG.sun.sunsetSky));
    expect(skyColors(0).zenith.getHex()).toBe(hex(CONFIG.sky.sunsetZenith));
    expect(skyColors(-6).horizon.getHex()).toBe(hex(CONFIG.sun.nightSky));
    expect(skyColors(-20).zenith.getHex()).toBe(hex(CONFIG.sky.nightZenith));
  });

  it('glows most around a low sun and not at all after twilight', () => {
    const strength = (e: number) => skyColors(e).glow.r + skyColors(e).glow.g + skyColors(e).glow.b;
    expect(strength(2)).toBeGreaterThan(strength(40));
    expect(strength(40)).toBeGreaterThan(0);
    expect(strength(-6)).toBe(0);
  });
});

describe('cloudCover', () => {
  it('scales the month mean and stays within 0 and 1', () => {
    expect(cloudCover(50, 0.6)).toBeCloseTo(0.3);
    expect(cloudCover(0)).toBe(0);
    expect(cloudCover(400, 1)).toBe(1);
  });
});

describe('Sky', () => {
  it('draws behind everything at infinity, untouched by tone mapping', () => {
    const sky = new Sky();
    const m = sky.mesh.material as ShaderMaterial;
    expect(m.depthWrite).toBe(false);
    expect(m.toneMapped).toBe(false);
    expect(sky.mesh.frustumCulled).toBe(false);
    expect(sky.mesh.renderOrder).toBeLessThan(0);
  });

  it('takes the sun, its colour and the cover', () => {
    const sky = new Sky();
    sky.set({ dir: [0, 0.6, -0.8], elevation: 37, cover: 0.3, sunColor: new Color(1, 0.9, 0.8), sunVisible: 0.5 });
    expect(sky.uniforms.sunDir.value.toArray()).toEqual([0, 0.6, -0.8]);
    expect(sky.uniforms.cover.value).toBe(0.3);
    expect(sky.uniforms.sunVisible.value).toBe(0.5);
    expect(sky.uniforms.zenith.value.getHex()).toBe(hex(CONFIG.sky.zenith));
  });

  it('is part of the surroundings scene', () => {
    const s = new Surroundings();
    expect(s.scene.children).toContain(s.sky.mesh);
  });
});
