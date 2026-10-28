import { CONFIG } from './config';
import { hintsDue, letterCount, maskOf, revealLetter, shownCount } from './draw-match';

/** A turn's phases, then the final scores. */
export type DrawPhase = 'choosing' | 'drawing' | 'reveal' | 'end';
export const PHASES: readonly DrawPhase[] = ['choosing', 'drawing', 'reveal', 'end'];
/** Someone who has played in this game: `here` while still in it (a player who left keeps their score on the board),
 * `drew` once they have had their turn. */
export type DrawPlayer = { id: string; name: string; score: number; here: boolean; drew: boolean };
/** A line of the guess feed: a wrong guess, "guessed it!", or "left". */
export type FeedKind = 'guess' | 'hit' | 'left';
export const FEED_KINDS: readonly FeedKind[] = ['guess', 'hit', 'left'];
export type FeedLine = { id: string; kind: FeedKind; text: string };
/** Points won this turn, by player. */
export type TurnPoints = { id: string; points: number };

/**
 * A game of draw and guess, as its owner (the drawer's browser) holds and sends it. The secret word is never in it
 * until the reveal: `mask` is what the guessers see. A type, not an interface, so it can be sent as JSON.
 */
export type DrawState = {
  /** The game's id (made by the browser that pressed Start), and its sequence number: each change counts one up. */
  id: string;
  seq: number;
  /** Whose browser holds and sends the game now (the drawer's while a turn is played), and who draws this turn. */
  owner: string;
  drawer: string;
  /** Everyone who has played, in the order they came into the game. */
  players: DrawPlayer[];
  /** Who draws after this turn, in order. */
  queue: string[];
  /** 1 for the first turn, then up by one each turn. */
  turn: number;
  phase: DrawPhase;
  /** Milliseconds left in the phase when it was made or sent: each browser keeps its own deadline from it. */
  left: number;
  /** The word as blanks (`_`), with the hints' letters and its spaces; the whole word at the reveal. */
  mask: string;
  /** The word, from the reveal on; '' before. */
  word: string;
  /** Who has the word this turn. */
  guessed: string[];
  points: TurnPoints[];
  /** The words drawn so far, never offered again. */
  used: string[];
  /** The last lines of the guess feed. */
  feed: FeedLine[];
};

/** At most this many players in a game. */
export const MAX_PLAYERS = 32;

const ms = (s: number) => Math.round(s * 1000);
/** A change: a new state, one up in sequence. */
const bump = (s: DrawState, change: Partial<DrawState>): DrawState => ({ ...s, ...change, seq: s.seq + 1 });
const pushFeed = (feed: FeedLine[], line: FeedLine): FeedLine[] => [...feed, line].slice(-CONFIG.draw.feed);

/** A new game: `players` in drawing order (arrival order), the first choosing a word. */
export function newGame(id: string, players: { id: string; name: string }[]): DrawState {
  const first = players[0].id;
  return {
    id, seq: 1, owner: first, drawer: first,
    players: players.slice(0, MAX_PLAYERS).map((p) => ({ id: p.id, name: p.name, score: 0, here: true, drew: p.id === first })),
    queue: players.slice(1, MAX_PLAYERS).map((p) => p.id),
    turn: 1, phase: 'choosing', left: ms(CONFIG.draw.choose), mask: '', word: '', guessed: [], points: [], used: [], feed: [],
  };
}

/** The drawer has chosen: the drawing time starts, the word shows as blanks. */
export function beginDrawing(s: DrawState, word: string): DrawState {
  return bump(s, { phase: 'drawing', left: ms(CONFIG.draw.drawing), mask: maskOf(word) });
}

/** A right guess's points with `left` ms of the drawing time to go: `most` at the start, `least` at the end, linear,
 * rounded to `step`. */
export function guessPoints(left: number, total = ms(CONFIG.draw.drawing)): number {
  const { most, least, step } = CONFIG.draw;
  const share = Math.max(0, Math.min(1, left / total));
  return Math.round((least + (most - least) * share) / step) * step;
}

function award(s: DrawState, id: string, points: number): Pick<DrawState, 'players' | 'points'> {
  const players = s.players.map((p) => (p.id === id ? { ...p, score: p.score + points } : p));
  const had = s.points.find((p) => p.id === id);
  const turn = had ? s.points.map((p) => (p.id === id ? { id, points: p.points + points } : p)) : [...s.points, { id, points }];
  return { players, points: turn };
}

/** A player has the word with `left` ms to go: points for them and for the drawer, "guessed it!" in the feed. */
export function rightGuess(s: DrawState, id: string, left: number): DrawState {
  if (s.phase !== 'drawing' || id === s.drawer || s.guessed.includes(id)) return s;
  const withGuesser = { ...s, ...award(s, id, guessPoints(left)) };
  return bump(s, { ...award(withGuesser, s.drawer, CONFIG.draw.drawer), guessed: [...s.guessed, id], feed: pushFeed(s.feed, { id, kind: 'hit', text: '' }) });
}

/** A wrong guess, for the feed. */
export function wrongGuess(s: DrawState, id: string, text: string): DrawState {
  return bump(s, { feed: pushFeed(s.feed, { id, kind: 'guess', text }) });
}

/** One more letter of `word` when one is due with `share` (0..1) of the drawing time gone. */
export function giveHint(s: DrawState, word: string, share: number, rand: () => number): DrawState {
  if (s.phase !== 'drawing' || shownCount(s.mask) >= hintsDue(share, letterCount(word), CONFIG.draw.hints)) return s;
  return bump(s, { mask: revealLetter(s.mask, word, rand) });
}

/** The players still in the game. */
export function herePlayers(s: DrawState): DrawPlayer[] {
  return s.players.filter((p) => p.here);
}

/** Every player here but the drawer has the word (and there is at least one). */
export function allGuessed(s: DrawState): boolean {
  const guessers = herePlayers(s).filter((p) => p.id !== s.drawer);
  return guessers.length > 0 && guessers.every((p) => s.guessed.includes(p.id));
}

/** The turn is over: the word shows to all, with the turn's points. */
export function endTurn(s: DrawState, word: string): DrawState {
  return bump(s, { phase: 'reveal', left: ms(CONFIG.draw.reveal), word, mask: word, used: [...s.used, word] });
}

/** The turn stops early (its drawer left): no more points, the ones already won stay, and nothing is revealed. */
export function voidTurn(s: DrawState): DrawState {
  return bump(s, { points: [] });
}

/** The final scores, for `CONFIG.draw.end` seconds. */
export function finish(s: DrawState): DrawState {
  return bump(s, { phase: 'end', left: ms(CONFIG.draw.end), queue: [] });
}

/** The next player in the queue draws, and their browser owns the game; with nobody left to draw, or fewer than two
 * players, the game ends. */
export function nextTurn(s: DrawState): DrawState {
  const here = new Set(herePlayers(s).map((p) => p.id));
  const queue = s.queue.filter((id) => here.has(id));
  if (here.size < 2 || !queue.length) return finish(s);
  const [drawer, ...rest] = queue;
  return bump(s, {
    owner: drawer, drawer, queue: rest, turn: s.turn + 1, phase: 'choosing', left: ms(CONFIG.draw.choose),
    mask: '', word: '', guessed: [], points: [], players: s.players.map((p) => (p.id === drawer ? { ...p, drew: true } : p)),
  });
}

/** A player joins: new, or back after leaving. Someone who hasn't drawn yet goes to the end of the queue. */
export function addPlayer(s: DrawState, id: string, name: string): DrawState {
  const p = s.players.find((q) => q.id === id);
  if (p?.here || (!p && s.players.length >= MAX_PLAYERS)) return s;
  const players = p ? s.players.map((q) => (q.id === id ? { ...q, here: true } : q)) : [...s.players, { id, name, score: 0, here: true, drew: false }];
  const queue = p?.drew || s.queue.includes(id) || s.drawer === id ? s.queue : [...s.queue, id];
  return bump(s, { players, queue });
}

/** A player leaves: out of the queue, their score stays on the board, "left" in the feed. */
export function removePlayer(s: DrawState, id: string): DrawState {
  if (!s.players.some((p) => p.id === id && p.here)) return s;
  return bump(s, {
    players: s.players.map((p) => (p.id === id ? { ...p, here: false } : p)),
    queue: s.queue.filter((q) => q !== id),
    feed: pushFeed(s.feed, { id, kind: 'left', text: '' }),
  });
}

/** Highest score first; ties share a place (1, 1, 3), in the order they came into the game. */
export function standings(players: readonly DrawPlayer[]): (DrawPlayer & { place: number })[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted.map((p) => ({ ...p, place: sorted.findIndex((q) => q.score === p.score) + 1 }));
}
