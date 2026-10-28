import { spaced } from './draw-match';
import { type DrawState, standings } from './draw-rules';
import { COLOUR_NAMES, ERASER, gridPoint, paintSketch, PALETTE, type Stroke } from './draw-sketch';
import { clock, gainsText, PENCIL, TICK, turnGains } from './draw-tv';

export const DRAW_COPY = {
  tv: 'TV',
  game: 'Draw and guess',
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  gameOn: 'A game is on',
  join: 'Join',
  leave: 'Leave',
  needTwo: 'Two or more players to start',
  joinToPlay: 'Join to play',
  gameOnJoin: 'A game is on. Join to guess, and draw later.',
  chooseWord: 'Choose a word to draw',
  yourTurn: 'Your turn to draw',
  guessIt: 'Guess the word',
  youHaveIt: 'You guessed it!',
  finalScores: 'Final scores',
};
const isChoosing = (name: string) => `${name} is choosing a word`;
const wordWas = (word: string, gains: string) => `The word was ${word}. ${gains}`;
const isClose = (text: string) => `"${text}" is close!`;

/** A visitor in the lobby's list. */
export interface LobbyPlayer { name: string; colour: string; you: boolean }

/** What the TV panel shows, worked out from the game; the panel only puts it on screen. */
export interface TvPanelInput {
  /** This visitor's id. */
  me: string;
  tvOn: boolean;
  /** The game shown on the TV (running, or its final scores), and the time left in its phase. */
  game: DrawState | null;
  leftMs: number;
  /** Who has pressed Join, in arrival order. */
  joined: LobbyPlayer[];
  youJoined: boolean;
  /** In the drawer's browser: the word, and the words to choose from. */
  secret: string;
  choices: string[];
  /** This visitor's last guess, when it was close. */
  close: string | null;
}

export interface TvPanelGame {
  /** The word spelled out for the drawer, blanks for the guessers, the word at the reveal. */
  word: string;
  time: string;
  status: string;
  /** The drawer's three words while choosing. */
  choices: string[];
  /** The canvas takes the drawer's pen, and the tools show. */
  tools: boolean;
  /** The guess box shows. */
  guess: boolean;
  /** Start shows, at the final scores, for a player who may start the next game. */
  start: boolean;
  rows: { name: string; score: number; drawer: boolean; here: boolean }[];
  feed: string[];
  close: string;
}

export interface TvPanelView {
  title: string;
  /** The remote: the On/Off button's label, whether its buttons work, and why not. */
  power: string;
  remote: boolean;
  nextChannel: boolean;
  remoteNote: string;
  /** The lobby: who has joined, Join or Leave, Start, and a line on what's next. */
  players: LobbyPlayer[];
  join: string;
  start: boolean;
  lobbyNote: string;
  /** For a player while the game shows: the game panel instead of the remote and the lobby. */
  game: TvPanelGame | null;
}

/** Works out the TV panel: the remote and the lobby for everyone, the game for its players while it shows. */
export function tvPanelView(i: TvPanelInput): TvPanelView {
  const s = i.game;
  const showing = !!s;
  const running = !!s && s.phase !== 'end';
  const playing = !!s && s.players.some((p) => p.id === i.me && p.here);
  let lobbyNote: string;
  if (running) lobbyNote = i.youJoined ? DRAW_COPY.gameOn : DRAW_COPY.gameOnJoin;
  else if (i.joined.length < 2) lobbyNote = DRAW_COPY.needTwo;
  else lobbyNote = i.youJoined ? '' : DRAW_COPY.joinToPlay;
  return {
    title: playing ? DRAW_COPY.game : DRAW_COPY.tv,
    power: i.tvOn ? DRAW_COPY.turnOff : DRAW_COPY.turnOn,
    remote: !showing,
    nextChannel: !showing && i.tvOn,
    remoteNote: showing ? DRAW_COPY.gameOn : '',
    players: i.joined,
    join: i.youJoined ? DRAW_COPY.leave : DRAW_COPY.join,
    start: !running && i.youJoined && i.joined.length >= 2,
    lobbyNote,
    game: s && playing ? gamePanel(i, s) : null,
  };
}

function gamePanel(i: TvPanelInput, s: DrawState): TvPanelGame {
  const drawer = s.drawer === i.me && s.phase !== 'end';
  const has = s.guessed.includes(i.me);
  const names = new Map(s.players.map((p) => [p.id, p.name]));
  const drawerName = names.get(s.drawer) ?? '';
  let word = '';
  let status: string;
  if (s.phase === 'choosing') status = drawer ? DRAW_COPY.chooseWord : isChoosing(drawerName);
  else if (s.phase === 'drawing') {
    word = drawer ? i.secret : spaced(s.mask);
    status = drawer ? DRAW_COPY.yourTurn : has ? DRAW_COPY.youHaveIt : DRAW_COPY.guessIt;
  } else if (s.phase === 'reveal') {
    word = s.word;
    status = wordWas(s.word, gainsText(turnGains(s), ', '));
  } else status = DRAW_COPY.finalScores;
  return {
    word,
    time: s.phase === 'end' ? '' : clock(Math.ceil(i.leftMs / 1000)),
    status,
    choices: drawer && s.phase === 'choosing' ? i.choices : [],
    tools: drawer && s.phase === 'drawing',
    guess: !drawer && s.phase === 'drawing' && !has,
    start: s.phase === 'end' && i.youJoined && i.joined.length >= 2,
    rows: standings(s.players).map((p) => ({
      name: `${s.phase === 'end' ? `${p.place}. ` : p.id === s.drawer ? PENCIL : s.guessed.includes(p.id) ? TICK : ''}${p.name}`,
      score: p.score, drawer: p.id === s.drawer && s.phase !== 'end', here: p.here,
    })),
    feed: s.feed.map((l) => {
      const name = names.get(l.id) ?? '';
      return l.kind === 'hit' ? `${name} guessed it!` : l.kind === 'left' ? `${name} left` : `${name}: ${l.text}`;
    }),
    close: s.phase === 'drawing' && i.close && !has ? isClose(i.close) : '',
  };
}

export interface TvPanelHandlers {
  power(): void;
  next(): void;
  /** Join, or Leave. */
  join(): void;
  start(): void;
  close(): void;
  /** Esc in the guess box: closes the panel like Esc elsewhere (default: `close`). */
  escape?(): void;
  choose(word: string): void;
  guess(text: string): void;
  /** The drawer's pen on the canvas, in grid units. */
  penDown(colour: number, width: number, x: number, y: number): void;
  penMove(x: number, y: number): void;
  undo(): void;
  clear(): void;
}

/**
 * The TV's panel: the remote and the draw-and-guess lobby, and for a player while a game shows, the game: the drawing
 * (the drawer's pen on it), the word or its blanks, the time, the scores, the feed and the guess box. Names come from
 * other visitors: they are set as text only. Keys typed in the guess box stay there: none reaches the walkthrough.
 */
export class TvPanel {
  /** The pen: a colour of `PALETTE` (`ERASER` for the eraser) and a width of `WIDTHS`. */
  colour = 0;
  width = 0;
  private last = '';
  /** The clock's text, and what the lists last showed, so the buttons and lists are rebuilt only when they change. */
  private time = '';
  private sections = { choices: '', rows: '', feed: '' };
  private painted = { version: -1, w: 0, h: 0 };
  private pen = false;
  private tools = false;

  constructor(private doc: Document, h: TvPanelHandlers) {
    this.el('tv-power').addEventListener('click', () => h.power());
    this.el('tv-next').addEventListener('click', () => h.next());
    this.el('tv-join').addEventListener('click', () => h.join());
    this.el('tv-leave').addEventListener('click', () => h.join());
    this.el('tv-start').addEventListener('click', () => h.start());
    this.el('draw-start').addEventListener('click', () => h.start());
    this.el('tv-close').addEventListener('click', () => h.close());
    this.el('draw-undo').addEventListener('click', () => h.undo());
    this.el('draw-clear').addEventListener('click', () => h.clear());
    this.el('draw-eraser').addEventListener('click', () => this.pick(ERASER));
    this.el('draw-fine').addEventListener('click', () => this.size(0));
    this.el('draw-broad').addEventListener('click', () => this.size(1));
    this.el('draw-colours').replaceChildren(...PALETTE.slice(0, ERASER).map((colour, i) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'draw-colour';
      b.style.background = colour;
      b.setAttribute('aria-label', COLOUR_NAMES[i]);
      b.addEventListener('click', () => this.pick(i));
      return b;
    }));
    this.el('draw-choices').addEventListener('click', (e) => {
      const word = (e.target as HTMLElement).closest('button')?.dataset.word;
      if (word) h.choose(word);
    });
    const input = this.el<HTMLInputElement>('draw-guess-text');
    this.el('draw-guess').addEventListener('submit', (e) => {
      e.preventDefault();
      h.guess(input.value);
      input.value = '';
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing never walks, toggles lights or closes the panel by its letter
      if (e.key === 'Escape') (h.escape ?? h.close)();
    });
    const canvas = this.el<HTMLCanvasElement>('draw-canvas');
    const at = (e: PointerEvent) => gridPoint(e.clientX, e.clientY, canvas.getBoundingClientRect());
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.tools || e.button > 0) return;
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      this.pen = true;
      h.penDown(this.colour, this.width, ...at(e));
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.pen) return;
      const all = e.getCoalescedEvents?.() ?? []; // every point the pointer passed since the last event (none for a synthetic one)
      for (const p of all.length ? all : [e]) h.penMove(...at(p));
    });
    const up = () => { this.pen = false; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    this.pick(0);
    this.size(0);
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.doc.getElementById(id) as T;
  }

  get isOpen(): boolean {
    return !this.el('tv-panel').hidden;
  }

  open(): void {
    this.last = '';
    this.sections = { choices: '', rows: '', feed: '' };
    this.painted.version = -1;
    this.el('tv-panel').hidden = false;
    this.doc.body.classList.add('tv-open');
  }

  close(): void {
    this.pen = false;
    this.el<HTMLInputElement>('draw-guess-text').blur();
    this.el('tv-panel').hidden = true;
    this.doc.body.classList.remove('tv-open');
  }

  /** Puts the view on screen when it changed, and the drawing when it or the canvas's size changed. */
  render(view: TvPanelView, strokes: readonly Stroke[], version: number): void {
    const key = JSON.stringify(view.game ? { ...view, game: { ...view.game, time: '' } } : view); // the clock ticks on its own
    if (key !== this.last) {
      this.last = key;
      this.fill(view);
    }
    if (view.game && view.game.time !== this.time) {
      this.time = view.game.time;
      this.el('draw-time').textContent = this.time;
    }
    if (view.game) this.paint(strokes, version);
  }

  private pick(colour: number): void {
    this.colour = colour;
    this.el('draw-colours').querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === colour)));
    this.el('draw-eraser').setAttribute('aria-pressed', String(colour === ERASER));
  }

  private size(width: number): void {
    this.width = width;
    this.el('draw-fine').setAttribute('aria-pressed', String(width === 0));
    this.el('draw-broad').setAttribute('aria-pressed', String(width === 1));
  }

  private fill(v: TvPanelView): void {
    this.el('tv-title').textContent = v.title;
    this.el('tv-lobby').hidden = !!v.game;
    this.el('draw-game').hidden = !v.game;
    this.el('tv-leave').hidden = !v.game;
    const power = this.el<HTMLButtonElement>('tv-power');
    power.textContent = v.power;
    power.disabled = !v.remote;
    this.el<HTMLButtonElement>('tv-next').disabled = !v.nextChannel;
    this.el('tv-remote-note').textContent = v.remoteNote;
    this.el('tv-players').replaceChildren(...v.players.map((p) => {
      const li = this.doc.createElement('li');
      const dot = this.doc.createElement('i');
      dot.style.background = p.colour;
      const name = this.doc.createElement('span');
      name.textContent = p.you ? `${p.name} (you)` : p.name;
      li.append(dot, name);
      return li;
    }));
    this.el('tv-join').textContent = v.join;
    this.el('tv-leave').textContent = v.join;
    this.el<HTMLButtonElement>('tv-start').disabled = !v.start;
    this.el('tv-lobby-note').textContent = v.lobbyNote;
    const g = v.game;
    this.tools = !!g?.tools;
    if (!this.tools) this.pen = false;
    if (!g) return;
    this.el('draw-word').textContent = g.word;
    this.time = g.time;
    this.el('draw-time').textContent = g.time;
    this.el('draw-status').textContent = g.status;
    const choices = this.el('draw-choices');
    choices.hidden = !g.choices.length;
    if (this.sections.choices !== g.choices.join('|')) choices.replaceChildren(...g.choices.map((word) => {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.dataset.word = word;
      b.textContent = word;
      return b;
    }));
    this.sections.choices = g.choices.join('|');
    this.el('draw-tools').hidden = !g.tools;
    this.el('draw-canvas').classList.toggle('drawing', g.tools);
    const form = this.el('draw-guess');
    const wasHidden = form.hidden;
    form.hidden = !g.guess;
    const touch = this.doc.body.classList.contains('touch'); // on a phone, focusing would pop the keyboard up
    if (wasHidden && g.guess && !touch && this.doc.activeElement === this.doc.body) this.el<HTMLInputElement>('draw-guess-text').focus();
    const rows = JSON.stringify(g.rows);
    if (this.sections.rows !== rows) this.el('draw-scores').replaceChildren(...g.rows.map((r) => {
      const li = this.doc.createElement('li');
      const name = this.doc.createElement('span');
      name.textContent = r.name;
      const score = this.doc.createElement('span');
      score.textContent = String(r.score);
      li.append(name, score);
      li.classList.toggle('drawer', r.drawer);
      li.classList.toggle('gone', !r.here);
      return li;
    }));
    this.sections.rows = rows;
    const feed = g.feed.join('\n');
    if (this.sections.feed !== feed) this.el('draw-feed').replaceChildren(...g.feed.map((line) => {
      const li = this.doc.createElement('li');
      li.textContent = line;
      return li;
    }));
    this.sections.feed = feed;
    this.el<HTMLButtonElement>('draw-start').hidden = !g.start;
    this.el('draw-close').textContent = g.close;
    this.el('draw-close').hidden = !g.close;
  }

  /** Draws the strokes on a white canvas at the screen's resolution. */
  private paint(strokes: readonly Stroke[], version: number): void {
    const canvas = this.el<HTMLCanvasElement>('draw-canvas');
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * ratio);
    const h = Math.round(canvas.clientHeight * ratio);
    if (!w || !h) return;
    if (w === this.painted.w && h === this.painted.h && version === this.painted.version) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.painted = { version, w, h };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    paintSketch(ctx, strokes, 0, 0, w, h);
  }
}
