import { DataTexture, HalfFloatType, Mesh, MeshStandardMaterial, PlaneGeometry, Scene, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { Bench, rememberBytes, sceneTextures, summarise, textureBytes } from '../src/stats';

const frame = (cpu: number) => ({ cpu, gpu: cpu / 2, calls: 100, triangles: 1000 });

describe('summarise', () => {
  it('gives the mean, the 95th percentile and the worst', () => {
    const s = summarise(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(s.frames).toBe(100);
    expect(s.mean).toBeCloseTo(50.5);
    expect(s.p95).toBe(96);
    expect(s.max).toBe(100);
    expect(summarise([]).frames).toBe(0);
  });
});

describe('texture memory', () => {
  it('counts 4 bytes a texel, 8 for half floats, a third more with mipmaps', () => {
    const t = new DataTexture(new Uint8Array(16 * 16 * 4), 16, 16);
    t.generateMipmaps = false;
    expect(textureBytes(t)).toBe(1024);
    t.generateMipmaps = true;
    expect(textureBytes(t)).toBeCloseTo(1024 * 4 / 3);
    const h = new DataTexture(new Uint16Array(16 * 16 * 4), 16, 16, undefined, HalfFloatType);
    h.generateMipmaps = false;
    expect(textureBytes(h)).toBe(2048);
  });

  it('remembers a size from before the image was let go', () => {
    const t = new DataTexture(new Uint8Array(8 * 8 * 4), 8, 8);
    t.generateMipmaps = false;
    rememberBytes(t);
    t.image = { width: 0, height: 0 } as unknown as Texture['image'];
    expect(textureBytes(t)).toBe(256);
  });

  it('finds each texture once, in materials and in lightmap uniforms', () => {
    const map = new DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
    map.generateMipmaps = false;
    const lm = new DataTexture(new Uint8Array(2 * 2 * 4), 2, 2);
    lm.generateMipmaps = false;
    const scene = new Scene();
    for (let i = 0; i < 2; i++) {
      const m = new MeshStandardMaterial({ map });
      m.userData.lightmapUniforms = { lmDay: { value: lm } };
      scene.add(new Mesh(new PlaneGeometry(), m));
    }
    expect(sceneTextures([scene])).toEqual({ count: 2, bytes: 64 + 16 });
  });
});

describe('Bench', () => {
  const stops = [{ name: 'a', x: 0, y: 1.6, z: 0, pitch: 0 }, { name: 'b', x: 1, y: 1.6, z: 1, pitch: 0.1 }];

  it('settles, then turns a full circle at each stop and measures each on its own', () => {
    const b = new Bench(stops, 1);
    for (let i = 0; i < 10; i++) b.step(0.1, frame(99)); // the settling second, not kept
    const poses: { name: string; yaw: number }[] = [];
    let pose = b.step(0.1, frame(99));
    while (pose) {
      poses.push({ name: pose.stop.name, yaw: pose.yaw });
      pose = b.step(0.1, frame(pose.stop.name === 'a' ? 10 : 20));
    }
    expect(b.done).toBe(true);
    expect(poses[0]).toEqual({ name: 'a', yaw: 0 });
    expect(poses.some((p) => p.name === 'b')).toBe(true);
    expect(Math.max(...poses.filter((p) => p.name === 'a').map((p) => p.yaw))).toBeGreaterThan(Math.PI * 1.5);
    expect(b.results.map((r) => r.name)).toEqual(['a', 'b']);
    expect(b.results[0].cpu.mean).toBeCloseTo(10);
    expect(b.results[1].cpu.mean).toBeCloseTo(20);
    expect(b.results[1].gpu.mean).toBeCloseTo(10);
    expect(b.report().split('\n')).toHaveLength(3);
  });
});
