import { describe, expect, it } from 'vitest';
import {
  cleanGuess, hintsDue, judgeGuess, letterCount, maskOf, normalize, oneEdit, revealLetter, shownCount, spaced,
} from '../src/draw-match';
import { DRAW_WORDS, pickChoices } from '../src/draw-words';

/** A fixed sequence of "random" numbers, repeating. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('the word list', () => {
  it('has a few hundred words, no duplicates', () => {
    expect(DRAW_WORDS.length).toBeGreaterThanOrEqual(300);
    expect(new Set(DRAW_WORDS).size).toBe(DRAW_WORDS.length);
  });
  it('is lowercase, one or two words of plain letters, short enough to draw and to show as blanks', () => {
    for (const w of DRAW_WORDS) {
      expect(w, w).toMatch(/^[a-z]+( [a-z]+)?$/);
      expect(w.length, w).toBeGreaterThanOrEqual(2);
      expect(w.length, w).toBeLessThanOrEqual(16);
    }
  });
  it('offers three different words, none used before', () => {
    const words = ['cat', 'dog', 'owl', 'bee', 'ant'];
    expect(pickChoices(seq(0), [], 3, words)).toEqual(['cat', 'dog', 'owl']);
    expect(pickChoices(seq(0.99), ['ant'], 3, words)).toEqual(['bee', 'owl', 'dog']);
    expect(pickChoices(seq(0), ['cat', 'dog', 'owl'], 3, words)).toEqual(['bee', 'ant']);
    const three = pickChoices(Math.random, []);
    expect(new Set(three).size).toBe(3);
    for (const w of three) expect(DRAW_WORDS).toContain(w);
  });
});

describe('guessing', () => {
  it('cleans a guess: spaces squeezed and trimmed, at most 40 characters', () => {
    expect(cleanGuess('  ice   cream ')).toBe('ice cream');
    expect(cleanGuess('   ')).toBe('');
    expect(cleanGuess('x'.repeat(50))).toHaveLength(40);
  });
  it('ignores case, accents, spaces and hyphens', () => {
    expect(normalize(' Ice-Cream ')).toBe('icecream');
    expect(normalize('Crème Brûlée')).toBe('cremebrulee');
    expect(judgeGuess('VOLCANO', 'volcano')).toBe('right');
    expect(judgeGuess(' volcanó ', 'volcano')).toBe('right');
    expect(judgeGuess('ice-cream', 'ice cream')).toBe('right');
    expect(judgeGuess('icecream', 'ice cream')).toBe('right');
  });
  it('says close one edit away, for words of four letters or more', () => {
    expect(judgeGuess('volcan', 'volcano')).toBe('close');
    expect(judgeGuess('volcanos', 'volcano')).toBe('close');
    expect(judgeGuess('vulcano', 'volcano')).toBe('close');
    expect(judgeGuess('vulcan', 'volcano')).toBe('wrong');
    expect(judgeGuess('bat', 'cat')).toBe('wrong'); // three letters: no "close"
    expect(judgeGuess('bear', 'pear')).toBe('close');
    expect(judgeGuess('', 'cat')).toBe('wrong');
  });
  it('counts one edit exactly', () => {
    expect(oneEdit('abc', 'abc')).toBe(false);
    expect(oneEdit('abc', 'abd')).toBe(true);
    expect(oneEdit('abc', 'ab')).toBe(true);
    expect(oneEdit('ab', 'xab')).toBe(true);
    expect(oneEdit('abc', 'bca')).toBe(false);
    expect(oneEdit('abcd', 'ab')).toBe(false);
  });
});

describe('the blanks', () => {
  it('hides the letters and keeps the spaces', () => {
    expect(maskOf('ice cream')).toBe('___ _____');
    expect(spaced('___ _____')).toBe('_ _ _   _ _ _ _ _');
    expect(letterCount('ice cream')).toBe(8);
  });
  it('shows one hidden letter at a time', () => {
    const once = revealLetter('___', 'cat', seq(0.5));
    expect(once).toBe('_a_');
    expect(shownCount(once)).toBe(1);
    expect(revealLetter(once, 'cat', seq(0))).toBe('ca_');
    expect(revealLetter('cat', 'cat', seq(0))).toBe('cat');
    expect(revealLetter('___ __', 'ice ox', seq(0.99))).toBe('___ _x');
  });
  it('gives a letter at half time and another at three quarters, never more than half the letters', () => {
    const at = [0.5, 0.75];
    expect(hintsDue(0.49, 7, at)).toBe(0);
    expect(hintsDue(0.5, 7, at)).toBe(1);
    expect(hintsDue(0.8, 7, at)).toBe(2);
    expect(hintsDue(0.8, 3, at)).toBe(1);
    expect(hintsDue(1, 1, at)).toBe(0);
  });
});
