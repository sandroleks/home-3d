import { BoxGeometry, BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { groundOffsets, prepareSurroundings } from '../src/surroundings';

describe('surroundings', () => {
  it('pushes bigger ground layers further back and leaves the rest alone', () => {
    const offsets = groundOffsets([
      { flat: true, area: 9e6 }, // grass
      { flat: false, area: 100 }, // a building
      { flat: true, area: 1e8 }, // water
      { flat: true, area: 2e4 }, // asphalt
    ]);
    expect(offsets).toEqual([2, 0, 3, 1]);
  });

  it('draws unlit: colour scaled back up, vertex shade on, ground layers offset', () => {
    const ground = new PlaneGeometry(100, 100).rotateX(-Math.PI / 2);
    const house = new BoxGeometry(10, 6, 10);
    for (const g of [ground, house]) {
      g.setAttribute('color', new BufferAttribute(new Float32Array(g.attributes.position.count * 4).fill(0.5), 4));
    }
    const root = new Group();
    const grass: Mesh = new Mesh(ground, new MeshStandardMaterial({ name: 'Ext grass', color: 0x204010 }));
    const wall: Mesh = new Mesh(house, new MeshStandardMaterial({ name: 'Ext wall pink', color: 0x806050 }));
    root.add(grass, wall);
    prepareSurroundings(root);

    const g = grass.material as MeshBasicMaterial;
    const w = wall.material as MeshBasicMaterial;
    expect(g).toBeInstanceOf(MeshBasicMaterial);
    expect(g.vertexColors).toBe(true);
    expect(g.name).toBe('Ext grass');
    expect(w.color.r).toBeCloseTo(new MeshStandardMaterial({ color: 0x806050 }).color.r * CONFIG.surroundingsShadeScale);
    expect(g.polygonOffset).toBe(true);
    expect(g.polygonOffsetFactor).toBe(1);
    expect(w.polygonOffset).toBe(false);
  });
});
