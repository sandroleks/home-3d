import { describe, expect, it } from 'vitest';
import { RGBM_GLSL, rgbmDecode } from '../src/rgbm';

describe('rgbm', () => {
  it('decodes rgb * a * range', () => {
    expect(rgbmDecode(0.5, 0.25, 1, 0.5, 8)).toEqual([2, 1, 4]);
  });
  it('exposes the same formula in GLSL', () => {
    expect(RGBM_GLSL).toContain('c.rgb * c.a * range');
  });
});
