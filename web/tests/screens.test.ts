import { Mesh, MeshBasicMaterial, Object3D, PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import type { ScreenInfo } from '../src/manifest';
import { TV_CHANNELS } from '../src/screen-content';
import { Screen } from '../src/screens';

const stubCanvas = (width: number, height: number) => ({ width, height, getContext: () => null });
const info = (kind: ScreenInfo['kind']): ScreenInfo => ({ node: `Screen_sala-${kind}`, room: 'sala', kind, group: null, center: [3, 1.2, 6], normal: [-1, 0, 0], width: 1.8, height: 1 });
const world = { hour: 21, minute: 5, day: 24, month: 10, year: 2026 };

function screen(kind: ScreenInfo['kind']) {
  const node = new Object3D();
  const mesh = new Mesh(new PlaneGeometry(), new MeshBasicMaterial());
  node.add(mesh);
  return { s: new Screen(info(kind), node, stubCanvas), mesh };
}

describe('Screen', () => {
  it('steps the TV through its channels, then off', () => {
    const { s } = screen('tv');
    s.click(0);
    expect(s.on).toBe(true);
    for (let i = 1; i < TV_CHANNELS.length; i++) {
      expect(s.lastChannel).toBe(false);
      s.click(i);
      expect(s.on).toBe(true);
    }
    expect(s.lastChannel).toBe(true);
    s.click(9);
    expect(s.on).toBe(false);
    s.click(10);
    expect(s.lastChannel).toBe(false); // back on the first channel
  });

  it('toggles a monitor and swaps the material', () => {
    const { s, mesh } = screen('monitor');
    const off = mesh.material;
    s.click(0);
    s.update(0, 1, world, true);
    expect(s.level).toBe(1);
    expect(mesh.material).not.toBe(off);
    s.click(1);
    s.update(1, 1, world, true);
    expect(s.level).toBe(0);
    expect(mesh.material).toBe(off);
  });

  it('starts dark and white-tinted, for its baked light', () => {
    const { s } = screen('tv');
    expect(s.brightness).toBe(0);
    expect(s.tint.toArray()).toEqual([1, 1, 1]);
  });
});
