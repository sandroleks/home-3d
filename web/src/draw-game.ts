import { CONFIG } from './config';
import { cleanGuess, judgeGuess, MAX_GUESS } from './draw-match';
import {
  addPlayer, allGuessed, beginDrawing, type DrawPlayer, type DrawState, endTurn, FEED_KINDS, type FeedLine, finish,
  giveHint, herePlayers, MAX_PLAYERS, newGame, nextTurn, PHASES, removePlayer, rightGuess, type TurnPoints, voidTurn,
  wrongGuess,
} from './draw-rules';
import { isStroke, MAX_POINTS, MAX_STROKES, MAX_TOTAL, Sketch, type Stroke } from './draw-sketch';
import { pickChoices } from './draw-words';
import { type Arrival, byArrival, cleanName } from './presence';

/**
 * What a `draw` message carries: a visitor's Join flag; the owner's state; a guess (to the owner only) and its
 * "close!" (to the guesser only); the drawer's strokes, undo, clear, and the whole drawing for a newcomer. `g` and
 * `t` name the game and its turn. Types, not interfaces, so they can be sent as JSON.
 */
export type DrawMessage =
  | { k: 'join'; on: boolean }
  | { k: 'state'; s: DrawState }
  | { k: 'guess'; g: string; t: number; text: string }
  | { k: 'close'; g: string; t: number; text: string }
  | { k: 'stroke'; g: string; t: number; n: number; at: number; c: number; w: number; p: number[] }
  | { k: 'undo'; g: string; t: number; n: number }
  | { k: 'clear'; g: string; t: number }
  | { k: 'sketch'; g: string; t: number; strokes: Stroke[] };

/** A message to send: to everyone, or to one visitor. */
export type DrawOut = { msg: DrawMessage; to?: string };

/** A visitor here (this one included): their name and when they arrived, which orders the players. */
export interface Visitor extends Arrival { name: string }

/** A game's turns are at most this many (every player draws once). */
const MAX_TURNS = MAX_PLAYERS * 2;
/** A takeover jumps the sequence by this much, so a late state from the owner it replaced (a hidden tab still
 * answering) never wins. */
export const TAKEOVER = 1000;

const isText = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isCount = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const isList = (v: unknown, max: number, item: (x: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.length <= max && v.every(item);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isPlayer = (v: unknown) => {
  const p = v as DrawPlayer;
  return isObject(v) && isText(p.id) && typeof p.name === 'string' && p.name.length <= CONFIG.multiplayer.maxNameLength
    && isCount(p.score, 1e6) && typeof p.here === 'boolean' && typeof p.drew === 'boolean';
};
const isLine = (v: unknown) => {
  const l = v as FeedLine;
  return isObject(v) && isText(l.id) && FEED_KINDS.includes(l.kind) && typeof l.text === 'string' && l.text.length <= MAX_GUESS;
};
const isTurnPoints = (v: unknown) => isObject(v) && isText((v as TurnPoints).id) && isCount((v as TurnPoints).points, 1e6);
const isWord = (v: unknown) => typeof v === 'string' && /^[a-z ]{1,32}$/.test(v);
const longest = Math.round(1000 * Math.max(CONFIG.draw.choose, CONFIG.draw.drawing, CONFIG.draw.reveal, CONFIG.draw.end));

/** A well-formed game state, every list bounded. */
export function isDrawState(v: unknown): v is DrawState {
  if (!isObject(v)) return false;
  const s = v as DrawState;
  return isText(s.id) && isCount(s.seq, 1e9) && isText(s.owner) && isText(s.drawer)
    && isList(s.players, MAX_PLAYERS, isPlayer) && isList(s.queue, MAX_PLAYERS, (x) => isText(x))
    && isCount(s.turn, MAX_TURNS) && s.turn >= 1 && PHASES.includes(s.phase)
    && typeof s.left === 'number' && Number.isFinite(s.left) && s.left >= 0 && s.left <= longest
    && typeof s.mask === 'string' && /^[a-z _]{0,32}$/.test(s.mask) && typeof s.word === 'string' && /^[a-z ]{0,32}$/.test(s.word)
    && isList(s.guessed, MAX_PLAYERS, (x) => isText(x)) && isList(s.points, MAX_PLAYERS, isTurnPoints)
    && isList(s.used, MAX_TURNS, isWord) && isList(s.feed, CONFIG.draw.feed, isLine);
}

/** A well-formed `draw` message; anything else is dropped. */
export function isDrawMessage(v: unknown): v is DrawMessage {
  if (!isObject(v)) return false;
  const m = v as Record<string, unknown>;
  if (m.k === 'join') return typeof m.on === 'boolean';
  if (m.k === 'state') return isDrawState(m.s);
  if (!isText(m.g) || !isCount(m.t, MAX_TURNS)) return false;
  switch (m.k) {
    case 'guess':
    case 'close': return isText(m.text, MAX_GUESS);
    case 'stroke': return isCount(m.n, MAX_STROKES - 1) && isCount(m.at, MAX_POINTS * 2) && (m.at as number) % 2 === 0 && isStroke({ c: m.c, w: m.w, p: m.p });
    case 'undo': return isCount(m.n, MAX_STROKES);
    case 'clear': return true;
    case 'sketch': return isList(m.strokes, MAX_STROKES, isStroke) && (m.strokes as Stroke[]).reduce((a, s) => a + s.p.length, 0) <= MAX_TOTAL * 2;
    default: return false;
  }
}

/**
 * Draw and guess as this browser sees it: who said they play (the lobby), the game (`state`), the turn's drawing, and,
 * in the drawer's browser, the secret word. The game is owned by one browser at a time, the drawer's: it runs the
 * clock, gives the hints, judges the guesses, takes in players who join and leave, and sends the state on every
 * change; at the turn's end it sends the state with the next drawer as owner. When the owner is gone, the game's
 * leader (the earliest-arrived player still here) ends that turn with no points and passes the turn on. Everyone
 * else shows what they are sent. `now` is in ms, and times travel as the time left, so clocks needn't agree.
 */
export class DrawGame {
  /** The game shown here: running, or its final scores; null when there is none. */
  state: DrawState | null = null;
  /** The turn's drawing. */
  readonly sketch = new Sketch();
  /** The word, in the drawer's browser only, and the words it may choose from while choosing. */
  secret = '';
  choices: string[] = [];
  /** "close!" for this visitor's last guess this turn (the guess). */
  close: string | null = null;
  /** Goes up whenever the lobby or the game changes, for the panel. */
  version = 0;
  /** This visitor's own Join flag, and the others' who have said they play. */
  private mine = false;
  private others = new Set<string>();
  private deadline = 0;
  private now = 0;
  /** Games shown here that are over, so a late copy never comes back. */
  private finished = new Set<string>();
  /** Where the drawer's next batch of points starts, and when the last went. */
  private cursor = { n: 0, at: 0 };
  private flushed = -Infinity;

  constructor(private selfId: () => string, private newId: () => string, private rand: () => number = Math.random) {}

  /** This visitor has pressed Join. */
  get joined(): boolean {
    return this.mine;
  }

  isJoined(id: string): boolean {
    return id === this.selfId() ? this.mine : this.others.has(id);
  }

  /** A game is being played (not just its final scores showing). */
  get running(): boolean {
    return !!this.state && this.state.phase !== 'end';
  }

  /** Milliseconds left in the phase. */
  timeLeft(): number {
    return this.state ? Math.max(0, this.deadline - this.now) : 0;
  }

  /** This visitor in the game: drawing this turn, guessing, or null when not playing. */
  role(): 'drawer' | 'guesser' | null {
    const s = this.state;
    const me = this.selfId();
    if (!s || s.phase === 'end' || !s.players.some((p) => p.id === me && p.here)) return null;
    return s.drawer === me ? 'drawer' : 'guesser';
  }

  /** The visitors who have pressed Join, in arrival order. */
  playing(visitors: Visitor[]): Visitor[] {
    return visitors.filter((v) => this.isJoined(v.id)).sort(byArrival);
  }

  /** Join or Leave: this visitor's flag, sent to everyone. */
  setJoined(on: boolean): DrawOut[] {
    if (on === this.mine) return [];
    this.mine = on;
    this.version++;
    return [{ msg: { k: 'join', on } }];
  }

  /** Start: with two or more joined (this visitor among them) and no game running, a new game in arrival order. */
  start(visitors: Visitor[], now: number): DrawOut[] {
    this.now = now;
    const players = this.playing(visitors);
    if (this.running || !this.mine || players.length < 2) return [];
    this.set(newGame(this.newId(), players.map((v) => ({ id: v.id, name: cleanName(v.name) }))), now);
    return [this.stateOut()];
  }

  /** The drawer picks one of the three words. */
  choose(word: string, now: number): DrawOut[] {
    this.now = now;
    const s = this.state;
    if (!s || s.owner !== this.selfId() || s.phase !== 'choosing' || !this.choices.includes(word)) return [];
    this.secret = word;
    this.choices = [];
    this.set(beginDrawing(s, word), now);
    return [this.stateOut()];
  }

  /** A guess, sent to the owner alone; it can't be this visitor's own drawing, or a word they already have. */
  guess(text: string): DrawOut[] {
    const s = this.state;
    const me = this.selfId();
    const clean = cleanGuess(text);
    if (!clean || this.role() !== 'guesser' || s!.phase !== 'drawing' || s!.guessed.includes(me)) return [];
    this.close = null;
    return [{ msg: { k: 'guess', g: s!.id, t: s!.turn, text: clean }, to: s!.owner }];
  }

  /** The drawer can draw: their turn's drawing time, in their own browser. */
  get canDraw(): boolean {
    const s = this.state;
    return !!s && s.phase === 'drawing' && s.owner === this.selfId() && s.drawer === this.selfId();
  }

  /** The drawer's pen, in grid units: down starts a stroke, move adds to it. Sent in batches by `update`. */
  penDown(c: number, w: number, x: number, y: number): void {
    if (this.canDraw) this.sketch.begin(c, w, x, y);
  }

  penMove(x: number, y: number): void {
    if (this.canDraw) this.sketch.extend(x, y);
  }

  undo(): DrawOut[] {
    const s = this.state;
    if (!s || !this.canDraw || !this.sketch.undo()) return [];
    const n = this.sketch.strokes.length;
    if (this.cursor.n >= n) this.cursor = { n, at: 0 };
    return [{ msg: { k: 'undo', g: s.id, t: s.turn, n } }];
  }

  clear(): DrawOut[] {
    const s = this.state;
    if (!s || !this.canDraw || !this.sketch.strokes.length) return [];
    this.sketch.clear();
    this.cursor = { n: 0, at: 0 };
    return [{ msg: { k: 'clear', g: s.id, t: s.turn } }];
  }

  /** What a newcomer (or a visitor back after a timeout) needs from here: this visitor's Join, and from the owner the
   * game and the whole drawing. */
  greet(id: string): DrawOut[] {
    const out: DrawOut[] = this.mine ? [{ msg: { k: 'join', on: true }, to: id }] : [];
    const s = this.state;
    if (!s || s.owner !== this.selfId()) return out;
    out.push({ ...this.stateOut(), to: id });
    const strokes = this.sketch.strokes.map((st) => ({ c: st.c, w: st.w, p: [...st.p] }));
    if (strokes.length) out.push({ msg: { k: 'sketch', g: s.id, t: s.turn, strokes }, to: id });
    return out;
  }

  /** A message from visitor `from`. Returns what to send back. */
  receive(m: DrawMessage, from: string, now: number): DrawOut[] {
    this.now = now;
    const s = this.state;
    switch (m.k) {
      case 'join':
        if (m.on) this.others.add(from);
        else this.others.delete(from);
        this.version++;
        return [];
      case 'state':
        this.accept(m.s, now);
        return [];
      case 'guess':
        return this.judge(from, m.g, m.t, m.text, now);
      case 'close':
        if (s && m.g === s.id && m.t === s.turn && from === s.owner) {
          this.close = m.text;
          this.version++;
        }
        return [];
      default:
        if (!s || m.g !== s.id || m.t !== s.turn || from !== s.drawer || from === this.selfId()) return [];
        if (m.k === 'stroke') this.sketch.add(m.n, m.at, m.c, m.w, m.p);
        else if (m.k === 'undo') this.sketch.truncate(m.n);
        else if (m.k === 'clear') this.sketch.clear();
        else this.sketch.replace(m.strokes);
        return [];
    }
  }

  /** Every frame, with everyone here (this visitor included). The owner runs the game; the leader takes over from an
   * owner who has gone; everyone drops the final scores when their time is up. Returns what to send. */
  update(now: number, visitors: Visitor[]): DrawOut[] {
    this.now = now;
    const present = new Set(visitors.map((v) => v.id));
    for (const id of this.others) {
      if (present.has(id)) continue;
      this.others.delete(id);
      this.version++;
    }
    const s = this.state;
    if (!s) return [];
    if (s.phase === 'end') {
      if (now >= this.deadline) this.drop(true);
      return [];
    }
    const me = this.selfId();
    if (s.owner === me) return this.own(now, visitors);
    if (present.has(s.owner)) return [];
    // With no other player of the game in sight, this browser is the one cut off (or the last one): it can't run the
    // game, and must send nothing of it. The game goes from here without being marked over: if the others come back,
    // their greeting brings the real state.
    const others = s.players.filter((p) => p.here && p.id !== s.owner && p.id !== me && present.has(p.id));
    if (!others.length) {
      this.drop(false);
      return [];
    }
    if (this.leader(visitors) === me) return this.takeOver(now);
    return [];
  }

  /** The owner's step: players in and out, the clock, the hints, the end of the turn, and the drawer's points. */
  private own(now: number, visitors: Visitor[]): DrawOut[] {
    const me = this.selfId();
    const out = this.flush(now);
    const before = this.state!;
    let s = before;
    const playing = this.playing(visitors);
    for (const v of playing) s = addPlayer(s, v.id, cleanName(v.name));
    const ids = new Set(playing.map((v) => v.id));
    for (const p of s.players) {
      if (!p.here || ids.has(p.id)) continue;
      if (p.id === s.drawer && (s.phase === 'choosing' || s.phase === 'drawing')) s = voidTurn(s);
      s = removePlayer(s, p.id);
    }
    if (herePlayers(s).length < 2) s = finish(s);
    else if (!ids.has(s.drawer)) s = nextTurn(s); // the drawer, this visitor, left
    if (s.owner === me && s.phase === 'choosing') {
      if (!this.choices.length && !this.secret) this.choices = pickChoices(this.rand, s.used, CONFIG.draw.choices);
      if (now >= this.deadline && this.choices.length) {
        this.secret = this.choices[Math.min(this.choices.length - 1, Math.floor(this.rand() * this.choices.length))];
        this.choices = [];
        s = beginDrawing(s, this.secret);
      }
    } else if (s.owner === me && s.phase === 'drawing') {
      if (!this.secret) s = nextTurn(voidTurn(s)); // the word is lost: no turn to play
      else {
        s = giveHint(s, this.secret, 1 - this.timeLeft() / (CONFIG.draw.drawing * 1000), this.rand);
        if (allGuessed(s) || now >= this.deadline) s = endTurn(s, this.secret);
      }
    } else if (s.owner === me && s.phase === 'reveal' && now >= this.deadline) s = nextTurn(s);
    if (s !== before) {
      this.set(s, now);
      out.push(this.stateOut());
    }
    return out;
  }

  /** The owner has gone: the leader ends the turn with no points and passes it on (or ends the game). */
  private takeOver(now: number): DrawOut[] {
    let s = this.state!;
    if (s.phase === 'choosing' || s.phase === 'drawing') s = voidTurn(s);
    s = removePlayer(s, s.owner);
    s = { ...s, owner: this.selfId(), seq: s.seq + TAKEOVER };
    s = herePlayers(s).length < 2 ? finish(s) : nextTurn(s);
    this.set(s, now);
    return [this.stateOut()];
  }

  /** The earliest-arrived player still here, other than the owner; null when there is none. */
  private leader(visitors: Visitor[]): string | null {
    const s = this.state!;
    const byId = new Map(visitors.map((v) => [v.id, v]));
    const here = s.players.filter((p) => p.here && p.id !== s.owner && byId.has(p.id)).map((p) => byId.get(p.id)!);
    return here.sort(byArrival)[0]?.id ?? null;
  }

  /** The owner judges a guess: "guessed it!" or the feed for everyone, and "close!" to the guesser alone. */
  private judge(from: string, g: string, t: number, text: string, now: number): DrawOut[] {
    const s = this.state;
    if (!s || s.owner !== this.selfId() || s.phase !== 'drawing' || now >= this.deadline || g !== s.id || t !== s.turn || !this.secret) return [];
    if (from === s.drawer || s.guessed.includes(from) || !s.players.some((p) => p.id === from && p.here)) return [];
    const clean = cleanGuess(text);
    if (!clean) return [];
    const verdict = judgeGuess(clean, this.secret);
    this.set(verdict === 'right' ? rightGuess(s, from, this.timeLeft()) : wrongGuess(s, from, clean), now);
    const out = [this.stateOut()];
    if (verdict === 'close') out.push({ msg: { k: 'close', g: s.id, t: s.turn, text: clean }, to: from });
    return out;
  }

  /** The drawer's points since the last batch, every `strokeEvery` seconds. */
  private flush(now: number): DrawOut[] {
    const s = this.state!;
    if (!this.canDraw || now - this.flushed < CONFIG.draw.strokeEvery * 1000) return [];
    this.flushed = now;
    const { parts, next } = this.sketch.since(this.cursor);
    this.cursor = next;
    return parts.map((p) => ({ msg: { k: 'stroke', g: s.id, t: s.turn, ...p } }));
  }

  /** A state from another visitor: the running game's with a higher number, or another game when none runs (a Start,
   * or a newcomer's first), or when both are in their first turn and it was started earlier (two Starts at once). */
  private accept(next: DrawState, now: number): void {
    const cur = this.state;
    if (this.finished.has(next.id)) return;
    const ok = !cur || (cur.id === next.id ? next.seq > cur.seq : cur.phase === 'end' || (cur.turn === 1 && next.turn === 1 && next.id < cur.id));
    if (!ok) return;
    this.set(next, now, true);
  }

  /** Puts a state here. A new turn (or game) starts a new drawing; the deadline follows the state's time left when it
   * came from elsewhere, or when the phase changed. */
  private set(next: DrawState, now: number, sent = false): void {
    const cur = this.state;
    const newTurn = !cur || cur.id !== next.id || cur.turn !== next.turn;
    if (newTurn) {
      if (cur && cur.id !== next.id) this.finished.add(cur.id);
      this.resetTurn();
    }
    if (sent || newTurn || cur!.phase !== next.phase) this.deadline = now + next.left;
    this.state = next;
    this.version++;
  }

  /** A new turn: a blank drawing, no word, no "close!". */
  private resetTurn(): void {
    this.sketch.clear();
    this.cursor = { n: 0, at: 0 };
    this.secret = '';
    this.choices = [];
    this.close = null;
  }

  /** The game goes from here. Only a game that ended (`over`) is remembered as finished, so a late copy never comes
   * back; one nobody here can run may well be shown again when its players are back in sight. */
  private drop(over: boolean): void {
    if (over) this.finished.add(this.state!.id);
    this.state = null;
    this.resetTurn();
    this.version++;
  }

  /** The state to send, with the time left now. */
  private stateOut(): DrawOut {
    return { msg: { k: 'state', s: { ...this.state!, left: Math.round(this.timeLeft()) } } };
  }
}
