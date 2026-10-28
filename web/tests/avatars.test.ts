import { Sprite, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Avatars, blinkAmount, drawLabel, figureLight, type Googly, stepGoogly } from '../src/avatars';
import type { CanvasFactory } from '../src/screens';

function fakeCanvas() {
  const calls: string[] = [];
  const gradient = { addColorStop: () => {} };
  const ctx = {
    font: '', textAlign: '', textBaseline: '', fillStyle: '' as unknown,
    clearRect: () => calls.push('clear'),
    measureText: (s: string) => ({ width: s.length * 10 }),
    beginPath: () => calls.push('path'),
    roundRect: () => calls.push('rect'),
    fill: () => calls.push('fill'),
    fillText: (s: string) => calls.push(`text:${s}`),
    fillRect: () => {},
    createRadialGradient: () => gradient,
  };
  const factory = ((width: number, height: number) => ({ width, height, getContext: () => ctx })) as unknown as CanvasFactory;
  return { factory, calls };
}

describe('Avatars', () => {
  it('opens its mouth and nods as its visitor talks', () => {
    const a = new Avatars(null);
    const f = a.add('p1', '#ff0000', 'Ana', 'fox');
    a.setPose('p1', [0, 0, 0, 0]);
    a.update(0.016);
    const tilt = f.creature.body.rotation.x;
    expect(f.creature.mouth.node.visible).toBe(false);
    a.setTalk('p1', 1);
    a.update(0.016);
    expect(f.creature.mouth.node.visible).toBe(true);
    expect(f.creature.mouth.node.scale.y).toBeCloseTo(f.creature.mouth.open);
    expect(f.creature.body.rotation.x).toBeCloseTo(tilt + 0.06);
    a.setTalk('p1', 0);
    a.update(0.016);
    expect(f.creature.mouth.node.visible).toBe(false);
    a.setTalk('nobody', 1); // no figure: nothing happens
  });

  it("gives a voice's place: its animal's mouth, once it has a pose", () => {
    const a = new Avatars(null);
    a.add('p1', '#ff0000', 'Ana', 'bear');
    const out = new Vector3();
    expect(a.mouth('p1', out)).toBeNull(); // no pose yet
    a.setPose('p1', [2, -3, 0, 0]);
    const m = a.mouth('p1', out)!;
    expect(m).toBe(out);
    expect(m.x).toBeCloseTo(2, 0);
    expect(m.z).toBeLessThan(-3); // on its front: figures face -z
    expect(m.y).toBeGreaterThan(0.5);
    expect(m.y).toBeLessThan(1.6);
    expect(a.mouth('nobody', out)).toBeNull();
  });

  it('keeps a hidden spare so the warm-up compiles its shaders', () => {
    const a = new Avatars(null);
    expect(a.root.children).toHaveLength(1);
    expect(a.root.children[0].visible).toBe(false);
    expect(a.materials()).toHaveLength(1);
    expect(a.count).toBe(0);
  });
  it('adds a creature that appears at its first pose and eases toward later ones', () => {
    const a = new Avatars(null);
    const f = a.add('p1', '#ff0000', 'Ana', 'bear');
    expect(a.add('p1', '#00ff00', 'Ana')).toBe(f); // once
    expect(f.creature.species).toBe('bear');
    expect(f.root.visible).toBe(false);
    a.setPose('p1', [2, -3, 1, 0.2]);
    expect(f.root.visible).toBe(true);
    expect(f.root.position.x).toBe(2);
    expect(f.root.position.z).toBe(-3);
    expect(f.root.rotation.y).toBe(1);
    expect(f.creature.body.rotation.x).toBeCloseTo(0.07); // tilts toward where the visitor looks, damped
    a.setPose('p1', [4, -3, 1, 0.2]);
    a.update(0.05);
    expect(f.root.position.x).toBeGreaterThan(2);
    expect(f.root.position.x).toBeLessThan(4);
    for (let i = 0; i < 100; i++) a.update(0.05);
    expect(f.root.position.x).toBeCloseTo(4);
  });
  it('sits on the seat, legs out in front, turned the way the seat faces', () => {
    const a = new Avatars(null);
    const f = a.add('p1', '#ff0000', 'Ana', 'bunny');
    a.setPose('p1', [1, 2, 0, 0]);
    const standing = f.creature.body.position.y;
    a.setPose('p1', [0.9, 6.6, 0.3, 0, 1, 0.47, -Math.PI / 2]);
    for (let i = 0; i < 40; i++) a.update(0.05);
    expect(f.sit).toBeCloseTo(1);
    expect(f.root.position.y).toBeCloseTo(0.47);
    expect(f.root.position.x).toBeCloseTo(0.9);
    expect(f.creature.body.position.y).toBeLessThan(standing - 0.3);
    expect(f.creature.legs[3].rotation.x).toBeGreaterThan(1.2); // out forward
    expect(Math.abs(f.root.rotation.y + Math.PI / 2)).toBeLessThan(0.7); // facing the seat's way, head a little toward the look
    expect(f.speed).toBeLessThan(0.05);
    expect(a.occupied(0.9, 6.6)).toBe(true);
    expect(a.occupied(0.9, 7.2)).toBe(false);
  });
  it('lies on its back on the bed and gets up again', () => {
    const a = new Avatars(null);
    const f = a.add('p1', '#ff0000', 'Ana', 'fox');
    a.setPose('p1', [-1.9, -7.3, 0, 0.9, 2, 0.53, -Math.PI / 2]);
    expect(f.lie).toBe(1); // the first pose places it outright
    a.update(0.016);
    expect(f.creature.body.rotation.x).toBeCloseTo(Math.PI / 2, 1); // face up
    expect(f.root.position.y).toBeCloseTo(0.53);
    a.setPose('p1', [-1.9, -7.3, 0, 0]);
    expect(a.occupied(-1.9, -7.3)).toBe(false);
    for (let i = 0; i < 40; i++) a.update(0.05);
    expect(f.lie).toBeLessThan(0.01);
    expect(f.root.position.y).toBeCloseTo(0.53 * f.lie);
    expect(Math.abs(f.creature.body.rotation.x)).toBeLessThan(0.05);
  });
  it('walks its legs while moving and stands still at rest', () => {
    const a = new Avatars(null);
    const f = a.add('p1', '#ff0000', 'Ana', 'reindeer');
    a.setPose('p1', [0, 0, 0, 0]);
    const swings: number[] = [];
    for (let i = 1; i <= 40; i++) {
      a.setPose('p1', [i * 0.07, 0, 0, 0]); // 1.4 m/s at 20 updates a second
      a.update(0.05);
      swings.push(f.creature.legs[0].rotation.x);
    }
    expect(f.speed).toBeGreaterThan(0.8);
    expect(Math.max(...swings)).toBeGreaterThan(0.2);
    expect(Math.min(...swings)).toBeLessThan(-0.2);
    expect(f.creature.legs[1].rotation.x).toBeCloseTo(-f.creature.legs[0].rotation.x); // diagonal pairs
    for (let i = 0; i < 100; i++) a.update(0.05);
    expect(f.speed).toBeLessThan(0.01);
    expect(Math.abs(f.creature.legs[0].rotation.x)).toBeLessThan(0.01);
  });
  it('dims with the light where it stands', () => {
    const a = new Avatars(null);
    const f = a.add('p1', '#ffffff', 'Ana', 'fox');
    a.setPose('p1', [0, 0, 0, 0]);
    for (let i = 0; i < 60; i++) a.update(0.05, () => 0.25);
    expect(f.light).toBeCloseTo(0.25, 2);
    const body = f.creature.tints[0];
    expect(body.material.color.r).toBeCloseTo(body.base.r * 0.25, 2);
  });
  it('labels the figure with its name above its top and redraws on a new name', () => {
    const { factory, calls } = fakeCanvas();
    const a = new Avatars(factory);
    const f = a.add('p1', '#ff0000', 'Guest', 'bunny');
    expect(f.label).toBeInstanceOf(Sprite);
    expect(f.label!.position.y).toBeGreaterThan(f.creature.top);
    expect(f.label!.renderOrder).toBe(10);
    expect(calls).toContain('text:Guest');
    const version = f.label!.material.map!.version;
    a.setName('p1', 'Rui');
    expect(calls).toContain('text:Rui');
    expect(f.label!.material.map!.version).toBe(version + 1); // re-uploaded
  });
  it('lists the seated, at the spot their pose named, not those standing or without a pose', () => {
    const a = new Avatars(null);
    a.add('p1', '#ff0000', 'Ana');
    a.add('p2', '#00ff00', 'Rui');
    a.add('p3', '#0000ff', 'Zé');
    a.setPose('p1', [1.248, 3.886, 0, 0, 1, 0.45, 0]);
    a.setPose('p2', [5, 5, 0, 0]);
    expect(a.seated()).toEqual([{ id: 'p1', x: 1.248, z: 3.886 }]);
  });

  it('removes figures', () => {
    const a = new Avatars(null);
    a.add('p1', '#ff0000', 'Ana');
    a.add('p2', '#00ff00', 'Rui');
    expect(a.count).toBe(2);
    a.remove('p1');
    a.remove('p1');
    expect(a.count).toBe(1);
    expect(a.has('p1')).toBe(false);
    expect(a.root.children).toHaveLength(2); // the spare and p2
    a.setPose('p1', [0, 0, 0, 0]); // gone: ignored
    expect(a.count).toBe(1);
  });
  it('draws a label pill no wider than the canvas', () => {
    const { factory, calls } = fakeCanvas();
    const c = factory(100, 20);
    drawLabel(c.getContext('2d') as CanvasRenderingContext2D, 'A very long name indeed', 100, 20);
    expect(calls).toEqual(['clear', 'path', 'rect', 'fill', 'text:A very long name indeed']);
  });
});

describe('googly eyes and blinking', () => {
  it('springs a pupil toward where it aims, wobbling past it first', () => {
    const g: Googly = { at: [0, 0], vel: [0, 0] };
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      stepGoogly(g, [0.3, 0], [0, 0], 0.016, 80, 3.2, 0.55);
      peak = Math.max(peak, g.at[0]);
    }
    expect(peak).toBeGreaterThan(0.35); // overshoots: it's googly
    expect(g.at[0]).toBeCloseTo(0.3, 2);
  });
  it('stays inside the eye and bounces off its edge', () => {
    const g: Googly = { at: [0, 0], vel: [0, 0] };
    stepGoogly(g, [0, 0], [500, 0], 0.05, 80, 3.2, 0.55);
    stepGoogly(g, [0, 0], [500, 0], 0.05, 80, 3.2, 0.55);
    expect(g.at[0]).toBeLessThanOrEqual(0.55);
  });
  it('shuts and reopens over a blink', () => {
    expect(blinkAmount(-0.1, 0.16)).toBe(0);
    expect(blinkAmount(0.08, 0.16)).toBeCloseTo(1);
    expect(blinkAmount(0.2, 0.16)).toBe(0);
  });
  it('rolls the pupils when it walks and turns, and blinks now and then', () => {
    let n = 0;
    const a = new Avatars(null, () => ((n = (n * 9301 + 49297) % 233280) / 233280)); // repeatable
    const f = a.add('p1', '#a9d4f5', 'Ana', 'bunny');
    a.setPose('p1', [0, 0, 0, 0]);
    let rolled = 0;
    let shut = 1;
    for (let i = 1; i <= 160; i++) {
      a.setPose('p1', [i * 0.07, 0, i * 0.02, 0]);
      a.update(0.05);
      rolled = Math.max(rolled, Math.abs(f.creature.eyes[0].pupil.rotation.x), Math.abs(f.creature.eyes[0].pupil.rotation.y));
      shut = Math.min(shut, f.creature.eyes[0].lid.scale.y);
    }
    expect(rolled).toBeGreaterThan(0.1);
    expect(shut).toBeLessThan(0.5);
    // The two eyes disagree
    expect(f.pupils[0].at).not.toEqual(f.pupils[1].at);
  });
});

describe('figureLight', () => {
  const cfg = { darkest: 0.2, daylight: 1.5 };
  it('is the darkest at night with the lights off and full by day or under a light', () => {
    expect(figureLight(0, 0, cfg)).toBeCloseTo(0.2);
    expect(figureLight(1, 0, cfg)).toBeCloseTo(1);
    expect(figureLight(0, 3, cfg)).toBeCloseTo(1);
    expect(figureLight(0, 0.75, cfg)).toBeCloseTo(0.6);
    expect(figureLight(0.7, 0.3, cfg)).toBeCloseTo(0.2 + 0.8 * 0.7);
  });
});
