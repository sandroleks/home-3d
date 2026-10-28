import type { MeshMatcapMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { GoGame, parsePoint } from '../src/go-game';
import { GoSet, pointPosition, prisonerPosition } from '../src/go-set';
import { TableMaterials } from '../src/table-pieces';

const cfg = CONFIG.games.go;
const step = (cfg.size - 2 * cfg.margin) / 8;
const game = (...entries: string[]) => {
  const g = new GoGame();
  for (const e of entries) expect(g.play(e), e).toBe(true);
  return g;
};
const set = () => new GoSet(new TableMaterials({ matte: null, gloss: null }), null);

describe('the Go board on the table', () => {
  it("fits right of the table runner (to x 2.25), clear of the table's rounded end (x 2.72 level with its corners)", () => {
    const [x, z] = CONFIG.games.slots[2];
    expect(x - cfg.size / 2).toBeGreaterThanOrEqual(2.265);
    expect(x + cfg.size / 2).toBeLessThanOrEqual(2.62);
    expect(Math.abs(z - 3.2)).toBeLessThan(0.01);
    expect(cfg.size).toBeGreaterThanOrEqual(0.26);
    // Four rows of prisoners a side stay clear of the runner and well inside the table's edges (z 2.735 and 3.665)
    for (const side of ['white', 'black'] as const) {
      for (let n = 0; n < 36; n++) {
        const [px, pz] = prisonerPosition(side, n);
        expect(x + px - cfg.stone).toBeGreaterThanOrEqual(2.265);
        expect(Math.abs(pz) + cfg.stone).toBeLessThanOrEqual(0.3);
      }
    }
  });
  it('puts row 1 at the S chair (+z) with column A toward -x, the lines a stone apart', () => {
    expect(pointPosition(parsePoint('A1')!)).toEqual([-4 * step, 4 * step]);
    expect(pointPosition(parsePoint('J9')!)).toEqual([4 * step, -4 * step]);
    expect(pointPosition(parsePoint('E5')!)).toEqual([0, 0]);
    expect(4 * step + cfg.stone).toBeLessThanOrEqual(cfg.size / 2);
    expect(step).toBeGreaterThan(2 * cfg.stone);
  });
  it('lines up prisoners in front of whoever took them, nine to a row', () => {
    const [wx, wz] = prisonerPosition('white', 0);
    expect(wx).toBeCloseTo(-4 * step);
    expect(wz - cfg.stone).toBeGreaterThan(cfg.size / 2);
    const [bx, bz] = prisonerPosition('black', 8);
    expect(bx).toBeCloseTo(4 * step);
    expect(bz + cfg.stone).toBeLessThan(-cfg.size / 2);
    expect(prisonerPosition('white', 9)[1]).toBeGreaterThan(wz); // the tenth starts a second row
  });
  it('drops a new stone onto its point', () => {
    const s = set();
    expect(s.root.name).toBe('Go');
    expect(s.stones.size).toBe(0);
    s.show(game('E5'));
    const stone = s.stones.get(0)!;
    expect(stone.name).toBe('Go stone 0');
    expect(stone.position.y).toBeCloseTo(cfg.thickness + cfg.drop);
    s.update(0.1);
    expect(stone.position.y).toBeGreaterThan(cfg.thickness);
    s.update(1);
    expect(stone.position.toArray()).toEqual([0, cfg.thickness, 0]);
  });
  it('lifts a captured stone off to the capturer, and clears the board for a new game', () => {
    const s = set();
    s.show(game('B1', 'A1', 'J9', 'J8'));
    s.update(1);
    s.show(game('B1', 'A1', 'J9', 'J8', 'A2'));
    const taken = s.stones.get(1)!;
    s.update(0.15);
    expect(taken.position.y).toBeGreaterThan(cfg.thickness); // on its way, lifted
    s.update(1);
    const [x, z] = prisonerPosition('black', 0);
    expect(taken.position.toArray()).toEqual([x, 0, z]);
    expect(s.stones.size).toBe(5);
    s.show(null);
    expect(s.stones.size).toBe(0);
    expect(s.root.children.filter((c) => c.name.startsWith('Go stone'))).toHaveLength(0);
  });
  it('shares one geometry, and one material a colour', () => {
    const s = set();
    s.show(game('E5', 'D4', 'C3'));
    const meshes = [...s.stones.values()];
    expect(new Set(meshes.map((m) => m.geometry)).size).toBe(1);
    const mats = meshes.map((m) => m.material as MeshMatcapMaterial);
    expect(mats[0]).toBe(mats[2]);
    expect(mats[0]).not.toBe(mats[1]);
  });
});
