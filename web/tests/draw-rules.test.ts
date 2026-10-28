import { describe, expect, it } from 'vitest';
import {
  addPlayer, allGuessed, beginDrawing, type DrawState, endTurn, finish, giveHint, guessPoints, herePlayers, MAX_PLAYERS,
  newGame, nextTurn, removePlayer, rightGuess, standings, voidTurn, wrongGuess,
} from '../src/draw-rules';

const ANA = { id: 'ana', name: 'Ana' };
const RUI = { id: 'rui', name: 'Rui' };
const ZE = { id: 'ze', name: 'Zé' };
const scores = (s: DrawState) => Object.fromEntries(s.players.map((p) => [p.id, p.score]));

describe('a turn', () => {
  it('starts with the first player choosing, the others queued in order', () => {
    const s = newGame('g1', [ANA, RUI, ZE]);
    expect(s).toMatchObject({ id: 'g1', seq: 1, owner: 'ana', drawer: 'ana', queue: ['rui', 'ze'], turn: 1, phase: 'choosing', left: 15000 });
    expect(s.players.map((p) => [p.id, p.score, p.here, p.drew])).toEqual([['ana', 0, true, true], ['rui', 0, true, false], ['ze', 0, true, false]]);
  });
  it('draws for 80 s with the word as blanks', () => {
    const s = beginDrawing(newGame('g1', [ANA, RUI]), 'ice cream');
    expect(s).toMatchObject({ seq: 2, phase: 'drawing', left: 80000, mask: '___ _____', word: '' });
  });
  it('scores a right guess 300 at the start down to 100 at the end, rounded to 10', () => {
    expect(guessPoints(80000)).toBe(300);
    expect(guessPoints(40000)).toBe(200);
    expect(guessPoints(0)).toBe(100);
    expect(guessPoints(30000)).toBe(180); // 175 rounds up
    expect(guessPoints(90000)).toBe(300);
  });
  it('gives the guesser their points and the drawer 50 for each right guess, once per guesser', () => {
    let s = beginDrawing(newGame('g1', [ANA, RUI, ZE]), 'cat');
    s = rightGuess(s, 'rui', 80000);
    s = rightGuess(s, 'rui', 70000); // already has it
    s = rightGuess(s, 'ana', 70000); // the drawer can't guess
    s = rightGuess(s, 'ze', 40000);
    expect(scores(s)).toEqual({ ana: 100, rui: 300, ze: 200 });
    expect(s.points).toEqual([{ id: 'rui', points: 300 }, { id: 'ana', points: 100 }, { id: 'ze', points: 200 }]);
    expect(s.guessed).toEqual(['rui', 'ze']);
    expect(s.feed).toEqual([{ id: 'rui', kind: 'hit', text: '' }, { id: 'ze', kind: 'hit', text: '' }]);
    expect(allGuessed(s)).toBe(true);
  });
  it('puts wrong guesses in the feed, keeping the last eight lines', () => {
    let s = beginDrawing(newGame('g1', [ANA, RUI]), 'cat');
    for (let i = 0; i < 10; i++) s = wrongGuess(s, 'rui', `dog ${i}`);
    expect(s.feed).toHaveLength(8);
    expect(s.feed[0]).toEqual({ id: 'rui', kind: 'guess', text: 'dog 2' });
    expect(allGuessed(s)).toBe(false);
  });
  it('shows a letter at half time and another at three quarters, at most half the letters', () => {
    const rand = () => 0;
    let s = beginDrawing(newGame('g1', [ANA, RUI]), 'volcano');
    s = giveHint(s, 'volcano', 0.4, rand);
    expect(s.mask).toBe('_______');
    s = giveHint(s, 'volcano', 0.5, rand);
    expect(s.mask).toBe('v______');
    expect(giveHint(s, 'volcano', 0.6, rand)).toBe(s); // nothing more due: the same state
    s = giveHint(s, 'volcano', 0.75, rand);
    expect(s.mask).toBe('vo_____');
    let cat = beginDrawing(newGame('g2', [ANA, RUI]), 'cat');
    cat = giveHint(giveHint(cat, 'cat', 0.5, rand), 'cat', 0.9, rand);
    expect(cat.mask).toBe('c__'); // half of three letters is one
  });
  it('reveals the word with the turn over, and the next player draws', () => {
    let s = rightGuess(beginDrawing(newGame('g1', [ANA, RUI, ZE]), 'cat'), 'rui', 80000);
    s = endTurn(s, 'cat');
    expect(s).toMatchObject({ phase: 'reveal', left: 5000, word: 'cat', mask: 'cat', used: ['cat'] });
    s = nextTurn(s);
    expect(s).toMatchObject({ owner: 'rui', drawer: 'rui', queue: ['ze'], turn: 2, phase: 'choosing', left: 15000, mask: '', word: '', guessed: [], points: [] });
    expect(s.players.find((p) => p.id === 'rui')?.drew).toBe(true);
    expect(scores(s)).toEqual({ ana: 50, rui: 300, ze: 0 });
  });
  it('ends after everyone has drawn once, with the final scores for 15 s', () => {
    let s = newGame('g1', [ANA, RUI]);
    s = nextTurn(endTurn(beginDrawing(s, 'cat'), 'cat'));
    expect(s.drawer).toBe('rui');
    s = nextTurn(endTurn(beginDrawing(s, 'dog'), 'dog'));
    expect(s).toMatchObject({ phase: 'end', left: 15000, used: ['cat', 'dog'] });
    expect(finish(s).phase).toBe('end');
  });
});

describe('joining and leaving', () => {
  it('adds a newcomer to the end of the queue, and a returning player only if they have not drawn', () => {
    let s = newGame('g1', [ANA, RUI]);
    s = addPlayer(s, 'ze', 'Zé');
    expect(s.queue).toEqual(['rui', 'ze']);
    expect(addPlayer(s, 'ze', 'Zé')).toBe(s); // already in
    s = removePlayer(s, 'ana');
    s = addPlayer(s, 'ana', 'Ana');
    expect(s.queue).toEqual(['rui', 'ze']); // Ana drew already
    expect(herePlayers(s).map((p) => p.id)).toEqual(['ana', 'rui', 'ze']);
  });
  it('takes a leaver out of the queue, keeps their score on the board, and says so in the feed', () => {
    let s = rightGuess(beginDrawing(newGame('g1', [ANA, RUI, ZE]), 'cat'), 'rui', 80000);
    s = removePlayer(s, 'rui');
    expect(s.queue).toEqual(['ze']);
    expect(s.players.find((p) => p.id === 'rui')).toMatchObject({ here: false, score: 300 });
    expect(s.feed.at(-1)).toEqual({ id: 'rui', kind: 'left', text: '' });
    expect(removePlayer(s, 'rui')).toBe(s);
  });
  it('ends the game when fewer than two are left to play', () => {
    const s = nextTurn(removePlayer(endTurn(beginDrawing(newGame('g1', [ANA, RUI, ZE]), 'cat'), 'cat'), 'ze'));
    expect(s.drawer).toBe('rui');
    expect(nextTurn(removePlayer(s, 'ana')).phase).toBe('end');
  });
  it("keeps the points already won when a turn's drawer leaves", () => {
    let s = rightGuess(beginDrawing(newGame('g1', [ANA, RUI, ZE]), 'cat'), 'rui', 80000);
    s = nextTurn(removePlayer(voidTurn(s), 'ana'));
    expect(scores(s)).toEqual({ ana: 50, rui: 300, ze: 0 });
    expect(s.points).toEqual([]);
    expect(s).toMatchObject({ drawer: 'rui', turn: 2, phase: 'choosing' });
  });
  it('takes no more than the most players a game holds', () => {
    let s = newGame('g1', Array.from({ length: MAX_PLAYERS }, (_, i) => ({ id: `p${i}`, name: `P${i}` })));
    expect(addPlayer(s, 'late', 'Late')).toBe(s);
    s = removePlayer(s, 'p3');
    expect(addPlayer(s, 'p3', 'P3').players.find((p) => p.id === 'p3')?.here).toBe(true);
  });
});

describe('standings', () => {
  it('ranks by score, ties sharing a place', () => {
    const players = [
      { id: 'a', name: 'A', score: 300, here: true, drew: true }, { id: 'b', name: 'B', score: 500, here: false, drew: true },
      { id: 'c', name: 'C', score: 300, here: true, drew: true }, { id: 'd', name: 'D', score: 0, here: true, drew: false },
    ];
    expect(standings(players).map((p) => [p.id, p.place])).toEqual([['b', 1], ['a', 2], ['c', 2], ['d', 4]]);
  });
});
