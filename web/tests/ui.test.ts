import { describe, expect, it } from 'vitest';
import { isTouchOnly } from '../src/ui';

const media = (coarse: boolean, fine: boolean) => (q: string) => ({
  matches: q === '(pointer: coarse)' ? coarse : q === '(pointer: fine)' ? fine : false,
});

describe('isTouchOnly', () => {
  it('flags phones and tablets', () => expect(isTouchOnly(media(true, false))).toBe(true));
  it('allows desktops and touch laptops', () => {
    expect(isTouchOnly(media(false, true))).toBe(false);
    expect(isTouchOnly(media(true, true))).toBe(false);
  });
});
