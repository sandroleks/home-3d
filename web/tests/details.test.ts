import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { applyDetails, boxUvs, detailFor, detailHeights, makeDetail } from '../src/details';

describe('details', () => {
  it('match plain materials by name', () => {
    expect(detailFor('Wall plaster')).toBe('plaster');
    expect(detailFor('Ceiling')).toBe('plaster');
    expect(detailFor('Sofa boucle oat')).toBe('fabric');
    expect(detailFor('Duvet oat')).toBe('fabric');
    expect(detailFor('Drawer box birch')).toBe('wood');
    expect(detailFor('Brass')).toBeNull();
  });

  it('make heights that wrap around the tile', () => {
    for (const kind of ['plaster', 'fabric', 'wood'] as const) {
      const n = 64;
      const h = detailHeights(kind, n);
      let inner = 0;
      let seam = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n - 1; x++) inner += Math.abs(h[y * n + x + 1] - h[y * n + x]);
        seam += Math.abs(h[y * n] - h[y * n + n - 1]);
      }
      expect(seam / n).toBeLessThan((inner / (n * (n - 1))) * 2.5);
    }
  });

  it('keep the colour: a multiplier no higher than 1, and its mean noted', () => {
    const d = makeDetail('fabric', 32);
    const px = d.map.image.data as Uint8Array;
    expect(Math.max(...px)).toBeLessThanOrEqual(255);
    expect(d.mean).toBeGreaterThan(1 - CONFIG.details.kinds.fabric.depth);
    expect(d.mean).toBeLessThan(1);
  });

  it('project a box at real size', () => {
    const g = new BoxGeometry(2, 1, 1);
    const uv = boxUvs(g, 0.5);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      lo = Math.min(lo, uv.getX(i));
      hi = Math.max(hi, uv.getX(i));
    }
    expect(hi - lo).toBeCloseTo(4); // 2 m over 0.5 m tiles
  });

  it('give a plain material its tile and leave textured ones alone', () => {
    const plain = new MeshStandardMaterial({ name: 'Wall plaster', color: new Color(0.5, 0.5, 0.5) });
    const textured = new MeshStandardMaterial({ name: 'Ceiling', map: new Texture() });
    const g = new Group();
    g.add(new Mesh(new BoxGeometry(), plain), new Mesh(new BoxGeometry(), textured));
    expect(applyDetails(g)).toBe(1);
    expect(plain.map).not.toBeNull();
    expect(plain.normalMap).not.toBeNull();
    expect(plain.color.r).toBeGreaterThan(0.5); // brightened by the tile's mean, so the average stays
    expect(applyDetails(g)).toBe(0); // once
  });
});
