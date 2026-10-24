import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { MovableInfo } from '../src/manifest';
import { applyMovable, movableNoun, movableRuntime, MovableState } from '../src/movables';

const lightmap = { file: 'x', range: 1 };
const door: MovableInfo = { node: 'Move_bar-cabinet-door-0', room: 'sala', kind: 'hinge', pivot: [0, 0.5, 0], axis: [0, 1, 0], angle: Math.PI / 2, lightmap, packs: [] };

describe('MovableState', () => {
  it('eases open and shut', () => {
    const s = new MovableState(door, 0.5);
    s.toggle();
    expect(s.isOpen).toBe(true);
    s.update(0.25);
    expect(s.amount).toBeCloseTo(0.5);
    s.update(1);
    expect(s.amount).toBe(1);
    s.toggle();
    s.update(1);
    expect(s.amount).toBe(0);
  });
});

describe('applyMovable', () => {
  it('turns a hinged door about its axis through the node origin', () => {
    const node = new Object3D();
    node.position.set(0, 0.5, 0);
    const m = movableRuntime(new MovableState(door), node);
    m.state.toggle();
    m.state.update(10);
    applyMovable(m);
    node.updateMatrixWorld();
    const free = new Vector3(1, 0, 0).applyMatrix4(node.matrixWorld); // the free edge, 1 m from the hinge
    expect(free.x).toBeCloseTo(0);
    expect(free.z).toBeCloseTo(-1);
    expect(node.position.y).toBe(0.5);
  });
});

describe('movableNoun', () => {
  it('names what the visitor opens', () => {
    expect(movableNoun(door)).toBe('cupboard');
    expect(movableNoun({ ...door, node: 'Move_fridge-door-lower' })).toBe('freezer');
    expect(movableNoun({ ...door, node: 'Move_wardrobe-q01-door-0' })).toBe('wardrobe');
    expect(movableNoun({ ...door, node: 'Move_front-dishwasher-panel' })).toBe('dishwasher');
    expect(movableNoun({ ...door, kind: 'slide', node: 'Move_front-pantry-pull-out' })).toBe('pull-out');
    expect(movableNoun({ ...door, kind: 'slide', node: 'Move_island-front-00' })).toBe('drawer');
  });
});
