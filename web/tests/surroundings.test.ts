import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { groundOffsets, makeSurroundingsLight, prepareSurroundings } from '../src/surroundings';

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

  it('lights every mesh live from shared sun and sky uniforms, keeping colour, texture and ground offsets', () => {
    const root = new Group();
    const grass: Mesh = new Mesh(new PlaneGeometry(100, 100).rotateX(-Math.PI / 2), new MeshStandardMaterial({ name: 'Ext grass', color: 0x204010 }));
    const map = new Texture();
    const wall: Mesh = new Mesh(new BoxGeometry(10, 6, 10), new MeshStandardMaterial({ name: 'Ext wall pink', color: 0x806050, map }));
    root.add(grass, wall);
    const light = makeSurroundingsLight();
    prepareSurroundings(root, light);

    const g = grass.material as ShaderMaterial;
    const w = wall.material as ShaderMaterial;
    expect(g).toBeInstanceOf(ShaderMaterial);
    expect(g.name).toBe('Ext grass');
    expect(g.uniforms.sunDir).toBe(light.sunDir);
    expect(w.uniforms.skyLight).toBe(light.skyLight);
    expect((w.uniforms.color.value as Color).getHex()).toBe(new MeshStandardMaterial({ color: 0x806050 }).color.getHex());
    expect(w.uniforms.map.value).toBe(map);
    expect(w.defines.USE_SURROUNDINGS_MAP).toBe('');
    expect(g.defines.USE_SURROUNDINGS_MAP).toBeUndefined();
    expect(g.polygonOffset).toBe(true);
    expect(g.polygonOffsetFactor).toBe(1);
    expect(w.polygonOffset).toBe(false);
  });
});
