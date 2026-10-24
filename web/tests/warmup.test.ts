import { Color, MeshStandardMaterial, Texture, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { applyLightmap, packBinding } from '../src/lightmaps';
import { lightmapTextures, UploadQueue } from '../src/warmup';

describe('lightmapTextures', () => {
  it('collects base colours and every bound lightmap layer, once each', () => {
    const day = new Texture();
    const light = new Texture();
    const map = new Texture();
    const pack = packBinding([{ group: 'a', range: 1, tint: [1, 1, 1] }]);
    pack.texture.value = new Texture();
    const mats = [0, 1].map(() => {
      const m = new MeshStandardMaterial({ map });
      applyLightmap(m, { day, dayRange: 1, light, lightRange: 1, intensity: { value: 0 }, packs: [pack], sky: { value: 1 }, fill: { value: new Color() } });
      return m;
    });
    const got = lightmapTextures(mats);
    expect(got).toHaveLength(4);
    expect(got).toEqual(expect.arrayContaining([day, light, map, pack.texture.value]));
  });
});

describe('UploadQueue', () => {
  it('uploads a few textures a frame, each once', () => {
    const uploaded: Texture[] = [];
    const renderer = { initTexture: (t: Texture) => uploaded.push(t) } as unknown as WebGLRenderer;
    const q = new UploadQueue(renderer, 2);
    const ts = [new Texture(), new Texture(), new Texture()];
    q.add(ts);
    q.tick();
    expect(uploaded).toEqual(ts.slice(0, 2));
    q.add(ts); // the first two are done: only the third is still waiting
    q.tick();
    q.tick();
    expect(uploaded).toEqual(ts);
    expect(q.pending).toBe(0);
  });
});
