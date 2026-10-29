import { describe, expect, it } from 'vitest';
import { ManifestError, parseCollision, parseManifest } from '../src/manifest';
import { sampleManifest } from './fixtures';

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    const m = parseManifest(sampleManifest());
    expect(m.rooms.map((r) => r.id)).toEqual(['alpha', 'beta']);
    expect(m.chunks[1].light).toBeNull();
    expect(m.doors[0].hinge).toEqual([3.1, -1.78]);
    expect(m.doors[0].opening).toBe(1);
    expect(m.viewpoints[0].name).toBe('Cam_Sala');
    expect(m.version).toBe(3);
    expect(m.rooms[0].area).toBe(9);
    expect(m.site.timeZone).toBe('Europe/Lisbon');
    expect(m.sky.irradiance).toBeCloseTo(0.6467);
    expect(m.windows[0].normal).toEqual([0, 0, 1]);
    expect(m.groups[1]).toEqual({ id: 'alpha/desk-lamp', room: 'alpha', kind: 'lamp', name: 'desk-lamp', power: 10, target: 'Lamp_alpha-desk-lamp' });
    expect(m.glows).toEqual([{ node: 'Glow_desk-lamp-bulb', group: 'alpha/desk-lamp' }]);
    expect(m.screens[0].kind).toBe('tv');
  });

  it('reads packed lamp layers: a group or a spill through a door', () => {
    const m = parseManifest(sampleManifest());
    expect(m.chunks[0].packs[0].layers[0]).toEqual({ group: 'alpha/desk-lamp', range: 1.5, tint: [1.2, 0.95, 0.7] });
    expect(m.chunks[1].packs[0].layers[0]).toEqual({ spill: { opening: 1, from: 'alpha' }, range: 0.5, tint: [1, 1, 1] });
    const raw = sampleManifest() as { chunks: { packs: { layers: Record<string, unknown>[] }[] }[] };
    raw.chunks[1].packs[0].layers[0] = { range: 1, tint: [1, 1, 1] };
    expect(() => parseManifest(raw)).toThrow('chunks[1].packs[0].layers[0].spill');
  });

  it('reads movables by kind', () => {
    const m = parseManifest(sampleManifest());
    expect(m.movables[0]).toMatchObject({ kind: 'slide', dir: [0, 0, 1], distance: 0.35 });
    expect(m.movables[1]).toMatchObject({ kind: 'hinge', pivot: [4.42, 0.2, -2.55], axis: [0, 1, 0], angle: -1.7 });
    const raw = sampleManifest() as { movables: Record<string, unknown>[] };
    raw.movables[0].kind = 'roll';
    expect(() => parseManifest(raw)).toThrow('movables[0].kind');
    const spin = sampleManifest() as { movables: Record<string, unknown>[] };
    spin.movables[1] = { ...spin.movables[1], kind: 'spin', axis: [0, -1, 0], rpm: 33.333 };
    delete spin.movables[1].angle;
    expect(parseManifest(spin).movables[1]).toMatchObject({ kind: 'spin', axis: [0, -1, 0], rpm: 33.333 });
    const raw2 = sampleManifest() as { movables: Record<string, unknown>[] };
    delete raw2.movables[1].axis;
    expect(() => parseManifest(raw2)).toThrow('movables[1].axis');
  });

  it('reads a sliding door, and none from a hinged one', () => {
    const raw = sampleManifest() as { doors: Record<string, unknown>[] };
    expect(parseManifest(raw).doors[0].slide).toBeUndefined();
    raw.doors[0].slide = { dir: [-1, 0], distance: 0.62 };
    expect(parseManifest(raw).doors[0].slide).toEqual({ dir: [-1, 0], distance: 0.62 });
    raw.doors[0].slide = { dir: [-1, 0] };
    expect(() => parseManifest(raw)).toThrow('doors[0].slide.distance');
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

  it('names a broken window field', () => {
    const bad = sampleManifest() as { windows: { normal: unknown }[] };
    bad.windows[0].normal = [0, 1];
    expect(() => parseManifest(bad)).toThrow('windows[0].normal');
  });

  it('reads the loose things on surfaces', () => {
    const m = parseManifest(sampleManifest());
    expect(m.props).toEqual([{ node: 'Prop_test-mug', name: 'mug', room: 'alpha', size: [0.08, 0.09, 0.08], tips: false }]);
  });

  it('reads the instruments, and none from a manifest without them', () => {
    expect(parseManifest(sampleManifest()).instruments).toEqual([
      { name: 'Piano', kind: 'piano', room: 'alpha', min: [1, 0, -2], max: [2.4, 1, -1.6], at: [1.7, 0.5, -1.8], prop: null },
    ]);
    const loose = sampleManifest() as { instruments: { prop?: unknown }[] };
    loose.instruments[0].prop = 'Prop_test-mug';
    expect(parseManifest(loose).instruments[0].prop).toBe('Prop_test-mug');
    const raw = sampleManifest() as Record<string, unknown>;
    delete raw.instruments;
    expect(parseManifest(raw).instruments).toEqual([]);
    const bad = sampleManifest() as { instruments: { kind: unknown }[] };
    bad.instruments[0].kind = 'harp';
    expect(() => parseManifest(bad)).toThrow('instruments[0].kind');
  });

  it('reads no props from a manifest without them', () => {
    const raw = sampleManifest() as Record<string, unknown>;
    delete raw.props;
    expect(parseManifest(raw).props).toEqual([]);
  });

  it('names a broken prop field', () => {
    const badSize = sampleManifest() as { props: { size: unknown }[] };
    badSize.props[0].size = [0.08, 0.09];
    expect(() => parseManifest(badSize)).toThrow(ManifestError);
    expect(() => parseManifest(badSize)).toThrow('props[0].size');
    const badName = sampleManifest() as { props: { name: unknown }[] };
    badName.props[0].name = 5;
    expect(() => parseManifest(badName)).toThrow('props[0].name');
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
