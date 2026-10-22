import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { isGlass, makeGlass, prepareMeshes } from '../src/scene-setup';

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
    const binding = { day: new Texture(), dayRange: 2, light: new Texture(), lightRange: 1, intensity: { value: 0 } };
    const lit = prepareMeshes(group, binding);
    expect(lit).toHaveLength(1);
    expect(a.material).not.toBe(shared);
    expect((a.material as MeshStandardMaterial).userData.lightmapUniforms.lmDayRange.value).toBe(2);
    expect((b.material as MeshStandardMaterial).transparent).toBe(true);
  });
});
