import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Texture, Vector3 } from 'three';
import type { PropInfo } from '../src/manifest';
import { modelKind, supportsOf, surfacePlaces } from '../src/surface-props';

const info = (node: string, size: [number, number, number], tips = true): PropInfo => ({ node, name: node.replace('Prop_', ''), room: null, size, tips });
const mug = (name = 'Prop_test_mug', material = new MeshStandardMaterial({ color: '#336699', roughness: 0.3 })) => {
  const m = new Mesh(new CylinderGeometry(0.04, 0.04, 0.09).translate(0, 0.045, 0), material);
  m.name = name;
  return m;
};
const box = (x: number, y: number, z: number, w: number, h: number, l: number) => new Box3(new Vector3(x - w / 2, y, z - l / 2), new Vector3(x + w / 2, y + h, z + l / 2));

describe('modelKind', () => {
  it('takes size from the manifest and looks from the materials', () => {
    const map = new Texture();
    const node = new Group();
    node.add(mug('a', new MeshStandardMaterial({ color: '#336699', roughness: 0.3, map })));
    node.add(mug('b', new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, transparent: true, opacity: 0.4 })));
    const { kind, rest } = modelKind(node, info('Prop_test_mug', [0.08, 0.09, 0.08]));
    expect(kind.size).toEqual([0.08, 0.09, 0.08]);
    expect(kind.tips).toBe(true);
    expect(rest.equals(new Group().matrix)).toBe(true);
    const parts = kind.parts(0);
    expect(parts).toHaveLength(2);
    expect(parts[0].look.colour).toBe('#336699');
    expect(parts[0].look.gloss).toBe(true);
    expect(parts[0].look.map).toBe(map);
    expect(parts[0].look.opacity).toBeUndefined();
    expect(parts[1].look.gloss).toBe(false);
    expect(parts[1].look.opacity).toBe(0.4);
    expect(kind.parts(3)[0].geometry).toBe(parts[0].geometry);
  });

  it('lays a long thin thing along z', () => {
    const node = new Mesh(new BoxGeometry(0.004, 0.26, 0.025).translate(0, 0.13, 0), new MeshStandardMaterial());
    const { kind, rest } = modelKind(node, info('Prop_knife', [0.004, 0.26, 0.025]));
    expect(kind.tips).toBe(false);
    expect(kind.size[2]).toBeCloseTo(0.26);
    expect(kind.size[1]).toBeCloseTo(0.004);
    expect(kind.size[0]).toBeCloseTo(0.025);
    const up = new Vector3(0, 1, 0).transformDirection(rest);
    expect(Math.abs(up.z)).toBeCloseTo(1);
    const b = new Box3();
    for (const p of kind.parts(0)) b.union(p.geometry.boundingBox ?? p.geometry.computeBoundingBox() ?? p.geometry.boundingBox!);
    expect(b.min.y).toBeCloseTo(0);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0);
  });
});

describe('modelKind, already flat after the first turn', () => {
  it('needs no extra turn', () => {
    const node = new Mesh(new BoxGeometry(0.03, 0.3, 0.01).translate(0, 0.15, 0), new MeshStandardMaterial());
    const { kind, rest } = modelKind(node, info('Prop_board', [0.03, 0.3, 0.01]));
    expect(kind.size[0]).toBeCloseTo(0.03);
    expect(kind.size[1]).toBeCloseTo(0.01);
    expect(kind.size[2]).toBeCloseTo(0.3);
    expect(Math.abs(new Vector3(0, 1, 0).transformDirection(rest).z)).toBeCloseTo(1);
  });
});

describe('supportsOf', () => {
  it('stacks plates on each other', () => {
    const plates = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, box: box(0, i * 0.014, 0, 0.2, 0.02, 0.2) }));
    const on = supportsOf(plates);
    expect(on.get('p0')).toBeNull();
    for (let i = 1; i < 6; i++) expect(on.get(`p${i}`)).toBe(`p${i - 1}`);
  });
  it('puts bottles and a bucket on a tray', () => {
    const things = [{ id: 'tray', box: box(0, 0, 0, 0.5, 0.02, 0.3) },
      ...[-0.15, -0.05, 0.05, 0.15].map((x, i) => ({ id: `b${i}`, box: box(x, 0.02, 0.05, 0.06, 0.25, 0.06) })),
      { id: 'bucket', box: box(0, 0.02, -0.08, 0.14, 0.15, 0.14) }];
    const on = supportsOf(things);
    expect(on.get('tray')).toBeNull();
    for (const t of things.slice(1)) expect(on.get(t.id)).toBe('tray');
  });
  it('puts fruit in a bowl', () => {
    const on = supportsOf([{ id: 'bowl', box: box(0, 0, 0, 0.3, 0.1, 0.3) }, { id: 'f1', box: box(0.03, 0.03, 0, 0.08, 0.08, 0.08) }, { id: 'f2', box: box(-0.04, 0.04, 0.03, 0.08, 0.08, 0.08) }]);
    expect(on.get('f1')).toBe('bowl');
    expect(on.get('f2')).toBe('bowl');
  });
  it('leaves side-by-side books and neighbours alone', () => {
    const books = [0, 1, 2, 3, 4].map((i) => ({ id: `k${i}`, box: box(i * 0.04, 0, 0, 0.035, 0.22, 0.15) }));
    const beside = [{ id: 'crate', box: box(0, 0, 0, 0.2, 0.1, 0.2) }, { id: 'cup', box: box(0.3, 0.05, 0, 0.08, 0.1, 0.08) }];
    for (const v of supportsOf([...books, ...beside]).values()) expect(v).toBeNull();
  });
});

describe('surfacePlaces', () => {
  it('takes things out of the root as loose places', () => {
    const root = new Object3D();
    const node = mug('Prop_test_mug');
    node.position.set(1, 0.9, -2);
    root.add(node);
    const keep = new Object3D();
    root.add(keep);
    const places = surfacePlaces([info('Prop_test_mug', [0.08, 0.09, 0.08]), info('Prop_missing', [0.1, 0.1, 0.1])], root);
    expect(places).toHaveLength(1);
    expect(node.parent).toBeNull();
    const p = places[0];
    expect(p.id).toBe('surface/test-mug');
    expect(p.kind).toBe('model');
    expect(p.node).toBeNull();
    expect(p.on).toBeNull();
    expect(p.place).toBe('Prop_test_mug');
    expect(p.info?.name).toBe('test_mug');
    expect(p.position.distanceTo(new Vector3(1, 0.9, -2))).toBeLessThan(1e-6);
  });
  it('finds what a thing lies on', () => {
    const root = new Object3D();
    const tray = new Mesh(new BoxGeometry(0.5, 0.02, 0.3).translate(0, 0.01, 0), new MeshStandardMaterial());
    tray.name = 'Prop_tray';
    tray.position.set(0, 1, 0);
    const cup = mug('Prop_cup');
    cup.position.set(0.05, 1.02, 0);
    root.add(tray, cup);
    const places = surfacePlaces([info('Prop_tray', [0.5, 0.02, 0.3]), info('Prop_cup', [0.08, 0.09, 0.08])], root);
    expect(places.find((p) => p.id === 'surface/cup')?.on).toBe('surface/tray');
    expect(places.find((p) => p.id === 'surface/tray')?.on).toBeNull();
  });
});
