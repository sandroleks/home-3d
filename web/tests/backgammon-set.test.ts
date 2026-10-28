import { Euler, type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { BackgammonGame, BAR, OFF } from '../src/backgammon-game';
import { BackgammonSet, caseLayout, checkerPosition, DIE_FACES, dieRotation } from '../src/backgammon-set';
import { CONFIG } from '../src/config';
import { TableMaterials } from '../src/table-pieces';

const cfg = CONFIG.games.backgammon;
const game = (...entries: string[]) => {
  const g = new BackgammonGame();
  for (const e of entries) expect(g.play(e), e).toBe(true);
  return g;
};
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => new Vector3(x, y, z));
/** The value on a die's top face. */
const top = (rotation: Euler) => DIE_FACES[NORMALS.findIndex((n) => n.clone().applyEuler(rotation).y > 0.9)];
const at = (m: Mesh) => m.position.toArray();

describe('the backgammon case on the table', () => {
  it("fits between the table's fruit bowl (to x 1.58) and its mug and books (from x 1.93), clear of the chessboard", () => {
    const [chess, backgammon] = CONFIG.games.slots.map(([x]) => x);
    expect(backgammon - cfg.width / 2).toBeGreaterThanOrEqual(1.6);
    expect(backgammon + cfg.width / 2).toBeLessThanOrEqual(1.91);
    expect(backgammon - cfg.width / 2).toBeGreaterThan(chess + CONFIG.games.chess.size / 2);
    expect(Math.abs(CONFIG.games.slots[1][1] - 3.2)).toBeLessThan(0.01);
    expect(cfg.depth).toBeLessThanOrEqual(0.4);
  });
  it("lays white's home at the near right (+x, +z) and black's at the far right, each from its own side", () => {
    const [x1, , z1] = checkerPosition('white', 1, 0);
    expect(x1).toBeGreaterThan(0);
    expect(z1).toBeGreaterThan(0);
    const [x24, , z24] = checkerPosition('white', 24, 0);
    expect(x24).toBeCloseTo(x1);
    expect(z24).toBeCloseTo(-z1);
    expect(checkerPosition('black', 1, 0)).toEqual(checkerPosition('white', 24, 0));
    expect(checkerPosition('white', 12, 0)[0]).toBeLessThan(checkerPosition('white', 7, 0)[0]); // 7..12 run left
  });
  it('keeps every point inside the case, a checker apart', () => {
    const { left, right } = caseLayout();
    const xs = Array.from({ length: 12 }, (_, i) => checkerPosition('white', i + 1, 0)[0]).sort((a, b) => a - b);
    expect(xs[0] - cfg.checker).toBeGreaterThanOrEqual(left);
    expect(xs[11] + cfg.checker).toBeLessThanOrEqual(right);
    for (let i = 1; i < 12; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(2 * cfg.checker);
  });
  it('stacks five in a row from the edge, then on top', () => {
    const first = checkerPosition('white', 6, 0);
    const fifth = checkerPosition('white', 6, 4);
    const sixth = checkerPosition('white', 6, 5);
    expect(fifth[2]).toBeLessThan(first[2]); // toward the middle
    expect([sixth[0], sixth[2]]).toEqual([first[0], first[2]]);
    expect(sixth[1]).toBeCloseTo(first[1] + cfg.thickness);
  });
  it("puts each side's bar checkers on the bar in its own half, and borne-off ones in its half of the tray", () => {
    const { bar, tray } = caseLayout();
    const w = checkerPosition('white', BAR, 0);
    const b = checkerPosition('black', BAR, 0);
    expect([w[0], b[0]]).toEqual([bar, bar]);
    expect(w[2]).toBeGreaterThan(0);
    expect(b[2]).toBeLessThan(0);
    expect(w[1]).toBeCloseTo(cfg.base + cfg.wall);
    expect(checkerPosition('white', OFF, 0)[0]).toBe(tray);
    expect(checkerPosition('black', OFF, 3)[2]).toBeLessThan(0);
  });
  it('turns a die to show each value on top', () => {
    for (let v = 1; v <= 6; v++) expect(top(new Euler(...dieRotation(v, 0.7), 'YXZ'))).toBe(v);
  });
});

describe('BackgammonSet', () => {
  const make = () => new BackgammonSet(new TableMaterials({ matte: null, gloss: null }), null);
  it('sets out 30 checkers and two dice, resting in the tray', () => {
    const set = make();
    expect(set.checkers.size).toBe(30);
    expect(at(set.checkers.get(0)!)).toEqual(checkerPosition('white', 6, 0));
    expect(set.dice).toHaveLength(2);
    expect(set.dice[0].position.x).toBeCloseTo(caseLayout().tray);
  });
  it('slides a moved checker to its point', () => {
    const set = make();
    const moved = set.checkers.get(12)!;
    set.show(game('r61', '13/7', '8/7'));
    set.update(0.15);
    expect(moved.position.x).not.toBeCloseTo(checkerPosition('white', 13, 4)[0]); // on its way
    set.update(1);
    expect(at(moved)).toEqual(checkerPosition('white', 7, 0));
    expect(at(set.checkers.get(7)!)).toEqual(checkerPosition('white', 7, 1));
    set.show(null); // a new game: everything goes home
    set.update(1);
    expect(at(moved)).toEqual(checkerPosition('white', 13, 4));
  });
  it("tumbles the dice to the roller's half, showing the roll", () => {
    const set = make();
    set.show(game('r35', '24/21', '13/8', 'r62'));
    set.update(0.2);
    expect(top(set.dice[0].rotation)).toBeUndefined(); // still tumbling
    set.update(1);
    expect(set.dice.map((d) => top(d.rotation))).toEqual([6, 2]);
    for (const d of set.dice) expect(d.position.x).toBeGreaterThan(caseLayout().bar); // white's right
    set.show(game('r35'));
    set.update(1);
    expect(set.dice.map((d) => top(d.rotation))).toEqual([3, 5]);
    expect(set.dice[0].position.x).toBeGreaterThan(caseLayout().bar); // the opening: white's die on white's side
    expect(set.dice[1].position.x).toBeLessThan(caseLayout().bar);
  });
});
