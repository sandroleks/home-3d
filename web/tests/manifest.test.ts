import { describe, expect, it } from 'vitest';
import { ManifestError, parseCollision, parseManifest } from '../src/manifest';
import { sampleManifest } from './fixtures';

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    const m = parseManifest(sampleManifest());
    expect(m.rooms.map((r) => r.id)).toEqual(['alpha', 'beta']);
    expect(m.chunks[1].light).toBeNull();
    expect(m.doors[0].hinge).toEqual([3.1, -1.78]);
    expect(m.viewpoints[0].name).toBe('Cam_Sala');
    expect(m.version).toBe(2);
    expect(m.rooms[0].area).toBe(9);
    expect(m.site.timeZone).toBe('Europe/Lisbon');
    expect(m.sky.irradiance).toBeCloseTo(0.6467);
    expect(m.windows[0].normal).toEqual([0, 0, 1]);
  });

  it('reads the lamp layers baked onto a door, and none from an older manifest', () => {
    const raw = sampleManifest() as { doors: Record<string, unknown>[] };
    expect(parseManifest(raw).doors[0].lights).toEqual([]);
    raw.doors[0].lights = [{ room: 'alpha', file: 'lightmaps/door-1_light-alpha.webp', range: 1.5 }];
    expect(parseManifest(raw).doors[0].lights).toEqual([{ room: 'alpha', file: 'lightmaps/door-1_light-alpha.webp', range: 1.5 }]);
    raw.doors[0].lights = [{ file: 'x.webp', range: 1 }];
    expect(() => parseManifest(raw)).toThrow('doors[0].lights[0].room');
  });

  it('reads the lamp layers an open-plan neighbour bakes onto a chunk, and none from an older manifest', () => {
    const raw = sampleManifest() as { chunks: Record<string, unknown>[] };
    expect(parseManifest(raw).chunks[1].lights).toEqual([]);
    raw.chunks[1].lights = [{ room: 'alpha', file: 'lightmaps/beta_light-alpha.webp', range: 1 }];
    expect(parseManifest(raw).chunks[1].lights).toEqual([{ room: 'alpha', file: 'lightmaps/beta_light-alpha.webp', range: 1 }]);
  });

  it('names the path of a broken field', () => {
    const bad = sampleManifest() as { chunks: { day: unknown }[] };
    bad.chunks[0].day = null;
    expect(() => parseManifest(bad)).toThrow(ManifestError);
    expect(() => parseManifest(bad)).toThrow('chunks[0].day');
  });

  it('rejects other versions', () => {
    expect(() => parseManifest({ ...(sampleManifest() as object), version: 1 })).toThrow('version');
  });

  it('names a broken window field', () => {
    const bad = sampleManifest() as { windows: { normal: unknown }[] };
    bad.windows[0].normal = [0, 1];
    expect(() => parseManifest(bad)).toThrow('windows[0].normal');
  });
});

describe('parseCollision', () => {
  it('decodes runs into a grid', () => {
    const c = parseCollision({ x0: 0, z0: 0, cell: 0.1, width: 3, height: 2, radius: 0.2, runs: [1, 1, 3, 1] });
    expect(Array.from(c.blocked)).toEqual([0, 1, 0, 0, 0, 1]);
  });

  it('rejects a grid whose runs do not match its size', () => {
    expect(() => parseCollision({ x0: 0, z0: 0, cell: 0.1, width: 3, height: 3, radius: 0.2, runs: [6] })).toThrow();
  });
});
