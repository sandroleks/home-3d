import { describe, expect, it } from 'vitest';
import { DRAW_COPY, type TvPanelInput, tvPanelView } from '../src/draw-panel';
import { beginDrawing, endTurn, finish, newGame, removePlayer, rightGuess, wrongGuess } from '../src/draw-rules';
import { PENCIL, TICK } from '../src/draw-tv';

const ANA = { name: 'Ana', colour: '#e2bc94', you: false };
const RUI = { name: 'Rui', colour: '#a9d4f5', you: true };
const game = () => newGame('g1', [{ id: 'ana', name: 'Ana' }, { id: 'rui', name: 'Rui' }, { id: 'ze', name: 'Zé' }]);
const input = (over: Partial<TvPanelInput> = {}): TvPanelInput => ({
  me: 'rui', tvOn: false, game: null, leftMs: 0, joined: [], youJoined: false, secret: '', choices: [], close: null, ...over,
});

describe('the TV panel', () => {
  it('works the remote while no game shows', () => {
    expect(tvPanelView(input())).toMatchObject({ title: 'TV', power: 'Turn on', remote: true, nextChannel: false, remoteNote: '', game: null });
    expect(tvPanelView(input({ tvOn: true }))).toMatchObject({ power: 'Turn off', remote: true, nextChannel: true });
  });
  it("disables the remote while a game shows, its final scores too", () => {
    expect(tvPanelView(input({ tvOn: true, game: game() }))).toMatchObject({ remote: false, nextChannel: false, remoteNote: 'A game is on' });
    expect(tvPanelView(input({ game: finish(game()) })).remote).toBe(false);
  });
  it('lets two or more who joined start, when no game runs', () => {
    expect(tvPanelView(input())).toMatchObject({ join: 'Join', start: false, lobbyNote: DRAW_COPY.needTwo });
    expect(tvPanelView(input({ joined: [ANA, RUI], youJoined: true }))).toMatchObject({ join: 'Leave', start: true, lobbyNote: '', players: [ANA, RUI] });
    expect(tvPanelView(input({ joined: [ANA, { ...RUI, you: false }] }))).toMatchObject({ start: false, lobbyNote: 'Join to play' });
    expect(tvPanelView(input({ joined: [ANA, RUI], youJoined: true, game: { ...game(), players: [] } }))).toMatchObject({ start: false, lobbyNote: 'A game is on' });
    expect(tvPanelView(input({ joined: [ANA, RUI], youJoined: true, game: finish(game()), me: 'mia' })).start).toBe(true);
  });
  it('lets players at the final scores start the next game, as the lobby does', () => {
    const over = finish(game());
    const at = (over_: Partial<TvPanelInput>) => tvPanelView(input({ game: over, ...over_ })).game?.start;
    expect(at({ joined: [ANA, RUI], youJoined: true })).toBe(true);
    expect(at({ joined: [RUI], youJoined: true })).toBe(false);
    expect(at({ joined: [ANA, { ...RUI, you: false }], youJoined: false })).toBe(false);
    expect(tvPanelView(input({ game: game(), joined: [ANA, RUI], youJoined: true })).game?.start).toBe(false);
  });
  it('shows onlookers the lobby, and players the game', () => {
    expect(tvPanelView(input({ me: 'mia', game: game() }))).toMatchObject({ title: 'TV', game: null, lobbyNote: DRAW_COPY.gameOnJoin });
    expect(tvPanelView(input({ game: game() }))).toMatchObject({ title: 'Draw and guess' });
    expect(tvPanelView(input({ game: removePlayer(game(), 'rui') })).game).toBeNull(); // left the game
  });
});

describe('the game panel', () => {
  it('gives the drawer three words while the others wait', () => {
    const drawer = tvPanelView(input({ me: 'ana', game: game(), leftMs: 14200, choices: ['cat', 'dog', 'horse'] })).game!;
    expect(drawer).toMatchObject({ status: 'Choose a word to draw', choices: ['cat', 'dog', 'horse'], time: '0:15', tools: false, guess: false, word: '' });
    const guesser = tvPanelView(input({ game: game(), choices: ['cat'] })).game!;
    expect(guesser).toMatchObject({ status: 'Ana is choosing a word', choices: [], guess: false });
  });
  it('spells the word out for the drawer, with the tools; blanks and the guess box for the guessers', () => {
    const s = beginDrawing(game(), 'ice cream');
    expect(tvPanelView(input({ me: 'ana', game: s, secret: 'ice cream', leftMs: 80000 })).game).toMatchObject({ word: 'ice cream', status: 'Your turn to draw', tools: true, guess: false, time: '1:20' });
    expect(tvPanelView(input({ game: s, leftMs: 80000 })).game).toMatchObject({ word: '_ _ _   _ _ _ _ _', status: 'Guess the word', tools: false, guess: true });
  });
  it('shows the scores with the pencil and the ticks, the feed with names, and "close!" to its guesser', () => {
    let s = beginDrawing(game(), 'horse');
    s = wrongGuess(s, 'ze', 'cow');
    s = rightGuess(s, 'ze', 80000);
    s = removePlayer(s, 'ze');
    const g = tvPanelView(input({ game: s, close: 'hors' })).game!;
    expect(g.rows).toEqual([
      { name: `${TICK}Zé`, score: 300, drawer: false, here: false },
      { name: `${PENCIL}Ana`, score: 50, drawer: true, here: true },
      { name: 'Rui', score: 0, drawer: false, here: true },
    ]);
    expect(g.feed).toEqual(['Zé: cow', 'Zé guessed it!', 'Zé left']);
    expect(g.close).toBe('"hors" is close!');
    expect(tvPanelView(input({ me: 'ze', game: rightGuess(beginDrawing(game(), 'horse'), 'ze', 1), close: 'hors' })).game).toMatchObject({ close: '', guess: false, status: 'You guessed it!' });
  });
  it('shows the word at the reveal, and the final places at the end', () => {
    const s = endTurn(rightGuess(beginDrawing(game(), 'cat'), 'rui', 80000), 'cat');
    expect(tvPanelView(input({ game: s })).game).toMatchObject({ word: 'cat', status: 'The word was cat. Rui +300, Ana +50', guess: false });
    expect(tvPanelView(input({ game: endTurn(beginDrawing(game(), 'dog'), 'dog') })).game?.status).toBe('The word was dog. Nobody got it');
    const end = tvPanelView(input({ game: finish(s) })).game!;
    expect(end).toMatchObject({ status: 'Final scores', time: '' });
    expect(end.rows.map((r) => r.name)).toEqual(['1. Rui', '2. Ana', '3. Zé']);
  });
});
