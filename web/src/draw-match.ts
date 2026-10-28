/** The longest guess, in characters. */
export const MAX_GUESS = 40;

/** A guess as sent: spaces squeezed, trimmed, cut to `MAX_GUESS`; '' when nothing is left. */
export function cleanGuess(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_GUESS).trim();
}

/** A guess or a word as compared: lowercase, without accents, spaces or hyphens ("Ice-Cream " → "icecream"). */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s-]+/g, '');
}

/** Whether two strings are exactly one edit apart: one letter added, dropped or changed. */
export function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export type Verdict = 'right' | 'close' | 'wrong';

/** A guess against the word: right, close (one edit away, for words of 4 letters or more), or wrong. */
export function judgeGuess(guess: string, word: string): Verdict {
  const g = normalize(guess);
  const w = normalize(word);
  if (!g) return 'wrong';
  if (g === w) return 'right';
  return w.length >= 4 && oneEdit(g, w) ? 'close' : 'wrong';
}

/** The word as the guessers see it: `_` for each letter, spaces kept ("ice cream" → "___ _____"). */
export function maskOf(word: string): string {
  return word.replace(/[^ ]/g, '_');
}

/** The letters a word has (its spaces don't count). */
export function letterCount(word: string): number {
  return word.replace(/ /g, '').length;
}

/** The mask with one more letter of the word shown, picked by `rand` among the hidden ones; the same mask when none is
 * hidden. */
export function revealLetter(mask: string, word: string, rand: () => number): string {
  const hidden = [...mask].flatMap((c, i) => (c === '_' ? [i] : []));
  if (!hidden.length) return mask;
  const i = hidden[Math.min(hidden.length - 1, Math.floor(rand() * hidden.length))];
  return mask.slice(0, i) + word[i] + mask.slice(i + 1);
}

/** How many letters show in a mask. */
export function shownCount(mask: string): number {
  return mask.replace(/[_ ]/g, '').length;
}

/** Letters to show once `share` (0..1) of the drawing time has gone: one per hint time passed, never more than half
 * the word's letters. */
export function hintsDue(share: number, letters: number, at: readonly number[]): number {
  return Math.min(Math.floor(letters / 2), at.filter((a) => share >= a).length);
}

/** Blanks to read: a space between letters, three between words ("___ _____" → "_ _ _   _ _ _ _ _"). */
export function spaced(mask: string): string {
  return [...mask].join(' ');
}
