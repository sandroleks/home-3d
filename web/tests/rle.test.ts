import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rleDecode } from '../src/rle';

const fixture = JSON.parse(
  readFileSync(new URL('../../shared/fixtures/rle.json', import.meta.url), 'utf8'),
) as { cases: { data: number[]; runs: number[] }[] };

describe('rleDecode', () => {
  it('matches the cases shared with the Python encoder', () => {
    for (const c of fixture.cases) {
      expect(Array.from(rleDecode(c.runs, c.data.length))).toEqual(c.data);
    }
  });

  it('rejects runs that do not cover the grid', () => {
    expect(() => rleDecode([2, 2], 5)).toThrow(/covers 4 cells, expected 5/);
  });
});
