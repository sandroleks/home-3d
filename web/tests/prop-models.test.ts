import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { KINDS, type PropKind } from '../src/prop-models';

const kinds = Object.keys(KINDS) as PropKind[];

describe('prop models', () => {
  it('has the seventeen kinds', () => {
    expect(kinds).toHaveLength(17);
  });

  it.each(kinds)('%s fits its size, standing on its origin', (kind) => {
    const { size, parts } = KINDS[kind];
    for (const variant of [0, 1, 2, 5]) {
      const box = new Box3();
      for (const p of parts(variant)) {
        p.geometry.computeBoundingBox();
        box.union(p.geometry.boundingBox!);
      }
      expect(box.min.x).toBeGreaterThanOrEqual(-size[0] / 2 - 1e-3);
      expect(box.max.x).toBeLessThanOrEqual(size[0] / 2 + 1e-3);
      expect(box.min.z).toBeGreaterThanOrEqual(-size[2] / 2 - 1e-3);
      expect(box.max.z).toBeLessThanOrEqual(size[2] / 2 + 1e-3);
      expect(box.min.y).toBeGreaterThanOrEqual(-1e-3);
      expect(box.max.y).toBeLessThanOrEqual(size[1] + 1e-3);
      expect(box.max.y).toBeGreaterThan(size[1] * 0.8); // the size isn't much bigger than the thing
    }
  });

  it('shares geometry between objects of a kind', () => {
    expect(KINDS.tumbler.parts(0)[0].geometry).toBe(KINDS.tumbler.parts(0)[0].geometry);
    expect(KINDS.book.parts(1)[0].geometry).toBe(KINDS.book.parts(3)[0].geometry);
  });

  it('tips only tall things', () => {
    expect(kinds.filter((k) => KINDS[k].tips).sort()).toEqual(['mug', 'oilbottle', 'spicejar', 'tumbler', 'winebottle', 'wineglass']);
  });

  it('names things for the prompt', () => {
    expect(KINDS.wineglass.name).toBe('wine glass');
    expect(KINDS.tumbler.name).toBe('glass');
  });
});
