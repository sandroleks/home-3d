import { Mesh, MeshBasicMaterial, Object3D, PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import type { ScreenInfo } from '../src/manifest';
import type { DrawTv } from '../src/draw-tv';
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

  it('turns the TV on and off from the remote, and steps its channels round', () => {
    const { s } = screen('tv');
    s.nextChannel(); // off: nothing
    expect(s.on).toBe(false);
    s.power(0);
    expect([s.on, s.channel]).toEqual([true, 0]);
    for (let i = 1; i < TV_CHANNELS.length; i++) s.nextChannel();
    expect(s.channel).toBe(TV_CHANNELS.length - 1);
    s.nextChannel();
    expect([s.on, s.channel]).toEqual([true, 0]); // round to the first, still on
    s.power(1);
    expect(s.on).toBe(false);
  });

  it('keeps the last picture while a game fades off a dark TV, rather than drawing the channel', () => {
    const calls: string[] = [];
    const returned = { addColorStop() {}, width: 5 };
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop in target) return target[prop];
        return () => {
          calls.push(prop);
          return returned;
        };
      },
      set(target, prop, value) {
        target[prop as string] = value;
        return true;
      },
    });
    const node = new Object3D();
    node.add(new Mesh(new PlaneGeometry(), new MeshBasicMaterial()));
    const s = new Screen(info('tv'), node, (w, h) => ({ width: w, height: h, getContext: () => ctx as unknown as CanvasRenderingContext2D }));
    const game: DrawTv = { phase: 'choosing', drawer: 'Ana', hint: '', word: '', seconds: 15, strokes: [], rows: [], gains: [] };
    s.setGame(game, 0);
    s.update(0, 1, world, false);
    const picture = s.brightness;
    expect(picture).toBeGreaterThan(0);
    s.setGame(null, 1);
    calls.length = 0;
    let t = 1;
    let steps = 0;
    for (; steps < 40 && s.level > 0; steps++) {
      t += 0.05;
      s.update(t, 0.05, world, false);
      expect(calls).toEqual([]);
      expect(s.brightness).toBe(picture);
    }
    expect(steps).toBeGreaterThan(2);
    expect(s.level).toBe(0);
    s.update(t + 0.05, 0.05, world, false);
    expect(calls.length).toBe(0);
  });

  it('shows a game on the TV even while it is off, and goes dark again after', () => {
    const { s, mesh } = screen('tv');
    const off = mesh.material;
    const game: DrawTv = { phase: 'choosing', drawer: 'Ana', hint: '', word: '', seconds: 15, strokes: [], rows: [], gains: [] };
    s.setGame(game, 0);
    expect([s.on, s.lit]).toEqual([false, true]);
    s.update(0, 1, world, false);
    expect(s.level).toBe(1);
    expect(mesh.material).not.toBe(off);
    s.setGame(null, 1);
    s.update(1, 1, world, false);
    expect(s.lit).toBe(false);
    expect(mesh.material).toBe(off);
    const monitor = screen('monitor').s;
    monitor.setGame(game, 0);
    expect(monitor.lit).toBe(false); // games are the TV's
  });

  it('starts dark and white-tinted, for its baked light', () => {
    const { s } = screen('tv');
    expect(s.brightness).toBe(0);
    expect(s.tint.toArray()).toEqual([1, 1, 1]);
  });
});
