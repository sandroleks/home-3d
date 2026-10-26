import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { LightGroups } from '../src/lightmaps';
import { Nanoleaf, panelColor } from '../src/nanoleaf';

const glow = (name: string, group: string, z: number) => {
  const material = new MeshStandardMaterial({ name, emissive: 0xffffff, emissiveIntensity: 6 });
  const mesh = new Mesh(new BoxGeometry(0.2, 0.2, 0.01), material);
  mesh.position.set(3.1, 1.8, z);
  return { group, material, base: 6, baseColor: material.emissive.clone(), mesh };
};

describe('Nanoleaf', () => {
  it('colours stay in the gradient and drift with time', () => {
    const [lo, hi] = CONFIG.nanoleaf.hues;
    const hsl = { h: 0, s: 0, l: 0 };
    for (let t = 0; t < 20; t += 0.7) {
      panelColor(t, 0.3, 0.2).getHSL(hsl);
      expect(hsl.h).toBeGreaterThanOrEqual(lo - 1e-3);
      expect(hsl.h).toBeLessThanOrEqual(hi + 1e-3);
    }
    expect(panelColor(0, 0, 0).equals(panelColor(2, 0, 0))).toBe(false);
    expect(panelColor(1, 0, 0).equals(panelColor(1, 0.4, 0))).toBe(false);
  });

  it('colours its own panels, and tints its light with their average', () => {
    const group = 'quarto-02/nanoleaf';
    const panels = [0, 1, 2].map((i) => glow(`Nanoleaf panel ${i} @${group}`, group, -5.5 - 0.2 * i));
    const other = glow(`LED @${group}`, group, -5);
    const lights = new LightGroups([group], 0.4);
    const n = new Nanoleaf([...panels, other]);
    expect(n.panels).toHaveLength(3);
    expect(n.group).toBe(group);
    n.update(3, lights);
    expect(panels[0].material.emissive.equals(panels[2].material.emissive)).toBe(false);
    expect(other.material.emissive.getHex()).toBe(0xffffff);
    const c = lights.color(group).value;
    expect(Math.max(c.r, c.g, c.b)).toBeCloseTo(1, 5);
    expect(n.has(panels[1])).toBe(true);
    expect(n.has(other)).toBe(false);
    expect(c.b).toBeGreaterThan(c.g * 0.5);
  });

  it('does nothing without panels', () => {
    const lights = new LightGroups(['x'], 0.4);
    const n = new Nanoleaf([]);
    expect(n.group).toBeNull();
    n.update(1, lights);
    expect(lights.color('x').value.getHex()).toBe(0xffffff);
  });
});
