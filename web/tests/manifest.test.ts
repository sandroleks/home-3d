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
  });

  it('names the path of a broken field', () => {
    const bad = sampleManifest() as { chunks: { day: unknown }[] };
    bad.chunks[0].day = null;
    expect(() => parseManifest(bad)).toThrow(ManifestError);
    expect(() => parseManifest(bad)).toThrow('chunks[0].day');
  });

  it('rejects other versions', () => {
    expect(() => parseManifest({ ...(sampleManifest() as object), version: 2 })).toThrow('version');
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
