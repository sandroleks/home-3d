import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { drawerHeights, fits, FRAMES, levelFrame, placesFor, slug, type PropFrame } from '../src/prop-places';

const fronts = (path: string) =>
  new Set<string>((JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { movables: { node: string }[] }).movables.map((m) => m.node));
const LAYOUTS = {
  open: fronts('../public/assets/manifest.json'),
  wall: fronts('../public/assets/variants/kitchen-wall/manifest.json'),
};
const drawer: PropFrame = {
  source: 'Test drawer', fill: 'cutlery', node: 'Move_test-drawer', front: 'Move_test-drawer', out: [1, 0, 0],
  levels: [{ min: [0, 0.7, 0], max: [0.5, 0.8, 0.45] }],
};

describe('prop places', () => {
  it('turns a level into a frame at its front left corner', () => {
    const f = levelFrame([1, 0, 0], drawer.levels[0]);
    expect(f.inward.x).toBe(-1);
    expect(Math.abs(f.inward.z)).toBe(0);
    expect(f.across.x).toBeCloseTo(0);
    expect(f.across.z).toBeCloseTo(1);
    expect(f.corner.toArray()).toEqual([0.5, 0.7, 0]); // front face at max x, left edge at min z
    expect([f.w, f.d, f.h].map((v) => +v.toFixed(3))).toEqual([0.45, 0.5, 0.1]);
  });

  it('checks that a slot fits its level', () => {
    expect(fits({ kind: 'tumbler', a: 0.05, b: 0.05 }, 0.3, 0.3, 0.2)).toBe(true);
    expect(fits({ kind: 'tumbler', a: 0.02, b: 0.05 }, 0.3, 0.3, 0.2)).toBe(false); // over the side
    expect(fits({ kind: 'wineglass', a: 0.1, b: 0.1 }, 0.3, 0.3, 0.15)).toBe(false); // too tall
    expect(fits({ kind: 'fork', a: 0.1, b: 0.12, yaw: Math.PI / 2 }, 0.3, 0.3, 0.1)).toBe(true); // across, not along
  });

  it('lays a drawer out in the world, stacks included, with stable ids', () => {
    const placed = placesFor(new Set(['Move_test-drawer']), [drawer]);
    expect(placed.length).toBeGreaterThanOrEqual(12);
    expect(placed[0].id).toBe('test-drawer/fork/0');
    expect(placed[0].node).toBe('Move_test-drawer');
    const stacked = placed.filter((p) => p.on);
    expect(stacked.length).toBeGreaterThan(0);
    for (const p of stacked) {
      const under = placed.find((q) => q.id === p.on)!;
      expect(p.position.y).toBeGreaterThan(under.position.y);
    }
    for (const p of placed) { // inside the drawer's box
      expect(p.position.x).toBeLessThanOrEqual(0.5);
      expect(p.position.x).toBeGreaterThanOrEqual(0);
      expect(p.position.y).toBeGreaterThanOrEqual(0.7);
    }
    // its length runs into the drawer: local z turned to -x
    expect(new Vector3(0, 0, 1).applyQuaternion(placed[0].quaternion).x).toBeCloseTo(-1);
  });

  it('leaves out places whose front this layout has not', () => {
    expect(placesFor(new Set(), [drawer])).toEqual([]);
  });

  it('gives drawers their inside height', () => {
    expect(drawerHeights(new Set(['Move_test-drawer']), [drawer]).get('Move_test-drawer')).toBeCloseTo(0.1);
  });

  it('leaves out a stack whose base does not fit', () => {
    // 0.2 deep, 0.3 wide: a plate's 0.27 length can't fit along the depth, so the stack's base is left out
    const shallow: PropFrame = {
      source: 'Shallow drawer', fill: 'plates', node: 'Move_shallow', front: 'Move_shallow', out: [1, 0, 0],
      levels: [{ min: [0, 0.7, 0], max: [0.2, 0.9, 0.3] }],
    };
    const placed = placesFor(new Set(['Move_shallow']), [shallow]);
    expect(placed).toEqual([]);
    const ids = new Set(placed.map((p) => p.id));
    for (const p of placed) if (p.on) expect(ids.has(p.on)).toBe(true);
  });

  it('slugs like the export', () => {
    expect(slug('Island front 00')).toBe('island-front-00');
    expect(slug('Front S1 pull-out')).toBe('front-s1-pull-out');
  });

  it.each(Object.entries(LAYOUTS))('stocks the %s layout from the model', (_, layout) => {
    const placed = placesFor(layout);
    expect(new Set(placed.map((p) => p.id)).size).toBe(placed.length);
    expect(placed.length).toBeGreaterThan(80);
    expect(placed.length).toBeLessThan(220);
    for (const p of placed) if (p.node) expect(layout.has(p.node)).toBe(true);
    for (const f of FRAMES.filter((x) => layout.has(x.front))) {
      expect(placed.some((p) => p.place === f.source), `${f.source} has something in it`).toBe(true);
    }
  });

  it('knows every place in some layout', () => {
    for (const f of FRAMES) expect(LAYOUTS.open.has(f.front) || LAYOUTS.wall.has(f.front), f.front).toBe(true);
  });
});
