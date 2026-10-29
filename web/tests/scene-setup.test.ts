import { BoxGeometry, Color, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { isGlass, makeGlass, prepareMeshes, setAnisotropy } from '../src/scene-setup';

describe('scene setup', () => {
  it('detects glass by name or transmission', () => {
    expect(isGlass(Object.assign(new MeshStandardMaterial(), { name: 'Window Glass' }))).toBe(true);
    expect(isGlass(Object.assign(new MeshPhysicalMaterial(), { transmission: 1 }))).toBe(true);
    expect(isGlass(new MeshStandardMaterial({ name: 'Wall plaster' }))).toBe(false);
  });

  it('makes a cheap transparent glass', () => {
    const g = makeGlass(Object.assign(new MeshStandardMaterial(), { name: 'Glass' }));
    expect(g.transparent).toBe(true);
    expect(g.opacity).toBeLessThan(0.3);
    expect(g.depthWrite).toBe(false);
  });

  it('clones materials per mesh and lightmaps everything except glass', () => {
    const shared = new MeshStandardMaterial({ name: 'Wall plaster' });
    const group = new Group();
    const a = new Mesh(new BoxGeometry(), shared);
    const b = new Mesh(new BoxGeometry(), Object.assign(new MeshStandardMaterial(), { name: 'Glass' }));
    group.add(a, b);
    const binding = { day: new Texture(), dayRange: 2, light: new Texture(), lightRange: 1, intensity: { value: 0 }, sky: { value: 1 }, fill: { value: new Color() } };
    const lit = prepareMeshes(group, binding);
    expect(lit).toHaveLength(1);
    expect(a.material).not.toBe(shared);
    expect((a.material as MeshStandardMaterial).userData.lightmapUniforms.lmDayRange.value).toBe(2);
    expect((b.material as MeshStandardMaterial).transparent).toBe(true);
    expect(a.castShadow).toBe(true);
    expect(a.receiveShadow).toBe(true);
    expect(b.castShadow).toBe(false);
    expect(b.receiveShadow).toBe(false);
  });

  it('sets anisotropic filtering on surface textures, lightmaps aside', () => {
    const map = new Texture();
    const normalMap = new Texture();
    const lm = new Texture();
    const m = new MeshStandardMaterial({ map, normalMap });
    m.userData.lightmapUniforms = { lmDay: { value: lm } };
    const g = new Group();
    g.add(new Mesh(new BoxGeometry(), m));
    setAnisotropy(g, 8);
    expect(map.anisotropy).toBe(8);
    expect(normalMap.anisotropy).toBe(8);
    expect(lm.anisotropy).toBe(1);
  });
});
