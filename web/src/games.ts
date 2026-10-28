import { ChessGame } from './chess-game';
import { CONFIG } from './config';
import type { Seat } from './seats';

/** The games on the dining table. */
export type GameKind = 'chess' | 'backgammon' | 'go';
/** The S chair (the Sala window's side) plays white, the N chair black. */
export type Side = 'white' | 'black';

export const otherSide = (s: Side): Side => (s === 'white' ? 'black' : 'white');

export const END_REASONS = [
  'checkmate', 'stalemate', 'repetition', 'fifty', 'material', 'agreement', 'resigned', 'left', 'single', 'gammon', 'backgammon',
] as const;
export type EndReason = (typeof END_REASONS)[number];
/** How a game ended: who won (null: a draw, or both players gone) and why. A type, not an interface, so it can be
 * sent as JSON. */
export type GameEnd = { winner: Side | null; reason: EndReason };

/**
 * What every game's rules offer the table, the overlay and the network: a list of entries replayed one by one, whose
 * turn it is, and how it ended. An entry is always by the side to move.
 */
export interface GameRules {
  readonly kind: GameKind;
  /** The entries so far: moves, and `resign` (and the game's own, like chess's draw offers). */
  readonly moves: readonly string[];
  turn(): Side;
  /** Adds an entry for the side to move; false, with nothing changed, when it isn't legal now or the game is over. */
  play(entry: string): boolean;
  /** How it ended by its rules, a resignation or an agreement; null while it runs. */
  end(): GameEnd | null;
  /** Games with draw offers: the side whose offer stands, or null. */
  drawOffer?(): Side | null;
  /** Games with check: the side to move is in check. */
  inCheck?(): boolean;
}

/** The table's three places, by slot number: the chairs `Dining chair N<slot>` and `S<slot>`. */
export const SLOTS: readonly { kind: GameKind; title: string; draws: boolean }[] = [
  { kind: 'chess', title: 'Chess', draws: true },
  { kind: 'backgammon', title: 'Backgammon', draws: false },
  { kind: 'go', title: 'Go', draws: false },
];

const SIDE_NAME: Record<Side, string> = { white: 'White', black: 'Black' };
const DRAWN: Partial<Record<EndReason, string>> = {
  stalemate: 'stalemate', repetition: 'threefold repetition', fifty: '50-move rule', material: 'insufficient material', agreement: 'agreed',
};
/** Wins whose reason reads differently from its name (backgammon's single game). */
const WON: Partial<Record<EndReason, string>> = { single: 'single game' };

/** The result line: "White wins: checkmate", "Black wins: White left the table", "White wins: gammon",
 * "Draw: stalemate". */
export function endText(end: GameEnd): string {
  if (end.winner) {
    const loser = SIDE_NAME[otherSide(end.winner)];
    const why = end.reason === 'resigned' ? `${loser} resigned` : end.reason === 'left' ? `${loser} left the table` : WON[end.reason] ?? end.reason;
    return `${SIDE_NAME[end.winner]} wins: ${why}`;
  }
  if (end.reason === 'left') return 'Game over: both players left the table';
  return `Draw: ${DRAWN[end.reason] ?? end.reason}`;
}

/** The games built so far; a slot whose kind has no rules here is just a table place. */
export const RULES: Partial<Record<GameKind, () => GameRules>> = { chess: () => new ChessGame() };

/** A game replayed from its entries; null when the kind has no rules or an entry isn't legal. */
export function replay(kind: GameKind, moves: readonly string[], rules = RULES): GameRules | null {
  const make = rules[kind];
  if (!make) return null;
  const game = make();
  return moves.every((m) => game.play(m)) ? game : null;
}

/** A game chair: its slot, the side it plays, and its spot (x, z). */
export interface Chair { slot: number; side: Side; x: number; z: number }

/** The game chairs among the seats: `Dining chair S<slot>` plays white, `N<slot>` black. */
export function gameChairs(seats: Seat[]): Chair[] {
  return seats.flatMap((s): Chair[] => {
    const m = /^Dining chair ([NS])(\d)$/.exec(s.name);
    if (!m || Number(m[2]) >= SLOTS.length) return [];
    const [x, , z] = s.spots[0].at;
    return [{ slot: Number(m[2]), side: m[1] === 'S' ? 'white' : 'black', x, z }];
  });
}

/** Who sits in a slot's two chairs (peer ids). */
export interface SlotSeats { white: string | null; black: string | null }
/** A seated visitor and where: the local one by `player.seat`, the others by the seating in their poses. */
export interface Sitter { id: string; x: number; z: number }

/** Who sits in each slot's chairs: whoever is seated within `radius` m of the chair's spot. Two on one chair (a race)
 * gives it to the lower id, the same in every browser. */
export function seatedAt(chairs: Chair[], sitters: Sitter[], radius = CONFIG.games.chairRadius): SlotSeats[] {
  const out: SlotSeats[] = SLOTS.map(() => ({ white: null, black: null }));
  for (const c of chairs) {
    const here = sitters.filter((s) => Math.hypot(s.x - c.x, s.z - c.z) < radius).map((s) => s.id).sort();
    out[c.slot][c.side] = here[0] ?? null;
  }
  return out;
}

/** One slot's whole game, as sent: its id (made by the white player's browser), the two players' peer ids, the
 * entries, and how it ended, once it has. */
export type GameMessage = { slot: number; id: string; white: string; black: string; moves: string[]; end?: GameEnd };

const MAX_ENTRIES = 1000;
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isEnd = (v: unknown): v is GameEnd => {
  const e = v as GameEnd | null;
  return !!e && typeof e === 'object' && (e.winner === 'white' || e.winner === 'black' || e.winner === null)
    && (END_REASONS as readonly unknown[]).includes(e.reason);
};

export function isGameMessage(v: unknown): v is GameMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.slot === 'number' && Number.isInteger(m.slot) && m.slot >= 0 && m.slot < SLOTS.length
    && isText(m.id) && isText(m.white) && isText(m.black) && m.white !== m.black
    && Array.isArray(m.moves) && m.moves.length <= MAX_ENTRIES && m.moves.every((e) => typeof e === 'string' && e.length <= 8)
    && (m.end === undefined || isEnd(m.end));
}

/** A slot's game here: the rules replayed so far, and `left` once a player left their chair (worked out here). */
export interface SlotGame { id: string; white: string; black: string; rules: GameRules; left: GameEnd | null }

/** How a slot's game ended: by its rules, a resignation or an agreement, else by a player leaving. */
export function endOf(g: SlotGame): GameEnd | null {
  return g.rules.end() ?? g.left;
}

/** The end when a player is out of their chair: the one still seated wins. */
export function leftEnd(whiteHere: boolean, blackHere: boolean): GameEnd | null {
  if (whiteHere && blackHere) return null;
  return { winner: whiteHere ? 'white' : blackHere ? 'black' : null, reason: 'left' };
}

/**
 * The table's games as this browser sees them. Every frame `update` takes who sits where: a running game whose player
 * left their chair ends (and a player's browser sends it once, so one that timed out on the others' side learns it);
 * coming back from a gap longer than the others wait for a pose ends this visitor's own game, as they saw it; the white
 * player's browser opens a new game when both chairs are taken and none is running. A game from another visitor is
 * taken (`receive`) when it is this slot's game and its entries extend ours and replay legally (or, with the same
 * entries, tell of a leave this browser hasn't seen), when it is a new game for the two visitors in the chairs now, or,
 * ended, to show in a slot with no game yet (a newcomer's); never one this browser has shown in the slot before. One
 * that names players not seen in the chairs yet waits a few seconds for their poses.
 */
export class Games {
  /** Goes up on every change, for the overlay to redraw. */
  version = 0;
  private games: (SlotGame | null)[] = SLOTS.map(() => null);
  private pending: ({ message: GameMessage; at: number } | null)[] = SLOTS.map(() => null);
  /** A new game may open: the slot has had an empty chair since its last game opened here. */
  private armed: boolean[] = SLOTS.map(() => true);
  /** The game ids each slot has shown, so a late copy of an older game never replaces a newer one. */
  private shown: Set<string>[] = SLOTS.map(() => new Set());
  private seats: SlotSeats[] = SLOTS.map(() => ({ white: null, black: null }));
  private now = 0;
  private ticked = false;

  constructor(private selfId: () => string, private newId: () => string, private rules = RULES) {}

  at(slot: number): SlotGame | null {
    return this.games[slot] ?? null;
  }

  /** Who sat in the slot's chairs at the last update. */
  seatsAt(slot: number): SlotSeats {
    return this.seats[slot];
  }

  /** A slot with rules: sitting there makes you a player. */
  playable(slot: number): boolean {
    return !!this.rules[SLOTS[slot].kind];
  }

  /** Where a visitor sits at a playable slot, at the last update. */
  seatOf(id: string): { slot: number; side: Side } | null {
    for (let slot = 0; slot < SLOTS.length; slot++) {
      if (!this.playable(slot)) continue;
      const s = this.seats[slot];
      if (s.white === id) return { slot, side: 'white' };
      if (s.black === id) return { slot, side: 'black' };
    }
    return null;
  }

  /** Every frame, with who sits where and the time (s). Returns the games to send: the ones this browser opened, and
   * its own game once a player left it. */
  update(seats: SlotSeats[], now: number): GameMessage[] {
    const me = this.selfId();
    const away = this.ticked && now - this.now > CONFIG.multiplayer.staleAfter; // the others have dropped this visitor
    this.seats = seats;
    this.now = now;
    this.ticked = true;
    const out: GameMessage[] = [];
    seats.forEach((s, slot) => {
      const make = this.rules[SLOTS[slot].kind];
      if (!make) return;
      const g = this.games[slot];
      if (g && !endOf(g)) {
        const mine = g.white === me || g.black === me;
        const left = away && mine ? leftEnd(g.white !== me, g.black !== me) : leftEnd(s.white === g.white, s.black === g.black);
        if (left) {
          g.left = left;
          if (away && mine) this.armed[slot] = true; // their chair was empty for the others
          this.version++;
          if (mine) out.push(this.message(slot)!);
        }
      }
      const p = this.pending[slot];
      if (p && (this.adopt(p.message) || now - p.at > CONFIG.games.pendingFor)) this.pending[slot] = null;
      if (!s.white || !s.black) this.armed[slot] = true;
      else if (this.armed[slot] && s.white === me && !this.running(slot)) {
        this.show(slot, { id: this.newId(), white: s.white, black: s.black, rules: make(), left: null });
        this.armed[slot] = false;
        out.push(this.message(slot)!);
      }
    });
    return out;
  }

  /** A game from another visitor; returns whether it was taken. */
  receive(m: GameMessage): boolean {
    if (!this.playable(m.slot)) return false;
    const g = this.games[m.slot];
    const taken = g?.id === m.id ? this.extend(g, m) : this.adopt(m);
    if (taken) this.pending[m.slot] = null;
    else if (g?.id !== m.id && !this.shown[m.slot].has(m.id)) this.pending[m.slot] = { message: m, at: this.now };
    return taken;
  }

  /** An entry by this visitor, who must be the slot's player to move. Returns the game to send, or null. */
  play(slot: number, entry: string): GameMessage | null {
    const g = this.games[slot];
    if (!g || endOf(g)) return null;
    const side = g.rules.turn();
    const me = this.selfId();
    if (g[side] !== me || this.seats[slot][side] !== me || !g.rules.play(entry)) return null;
    this.version++;
    return this.message(slot);
  }

  /** A slot's game as sent. */
  message(slot: number): GameMessage | null {
    const g = this.games[slot];
    if (!g) return null;
    const end = endOf(g);
    return { slot, id: g.id, white: g.white, black: g.black, moves: [...g.rules.moves], ...(end ? { end } : {}) };
  }

  /** Every slot's game, for a newcomer (with the flat's state). */
  messages(): GameMessage[] {
    return SLOTS.flatMap((_, slot) => this.message(slot) ?? []);
  }

  private running(slot: number): boolean {
    const g = this.games[slot];
    return !!g && !endOf(g);
  }

  /** More entries for this slot's game; a game its rules ended takes no more, but one a player left still takes a
   * move that was on its way. The same entries can only tell of a leave, taken when this browser has no end yet. */
  private extend(g: SlotGame, m: GameMessage): boolean {
    const have = g.rules.moves;
    if (g.rules.end() || m.moves.length < have.length || have.some((e, i) => m.moves[i] !== e)) return false;
    if (m.moves.length === have.length) {
      if (m.end?.reason !== 'left' || g.left) return false;
      g.left = m.end;
      this.version++;
      return true;
    }
    const rules = replay(g.rules.kind, m.moves, this.rules);
    if (!rules) return false;
    g.rules = rules;
    this.version++;
    return true;
  }

  /** Another game in this slot: a new one for the two in its chairs now (unless one is running), or a finished one
   * where there's no game yet; never one shown here before. Of its `end` only a leave is kept: the rest come from the
   * entries. */
  private adopt(m: GameMessage): boolean {
    const g = this.games[m.slot];
    const s = this.seats[m.slot];
    const forSeated = s.white === m.white && s.black === m.black && !this.running(m.slot);
    if ((!forSeated && !(!g && m.end)) || this.shown[m.slot].has(m.id)) return false;
    const rules = replay(SLOTS[m.slot].kind, m.moves, this.rules);
    if (!rules) return false;
    const left = !rules.end() && m.end?.reason === 'left' ? m.end : null;
    this.show(m.slot, { id: m.id, white: m.white, black: m.black, rules, left });
    return true;
  }

  /** Puts a game in its slot. */
  private show(slot: number, g: SlotGame): void {
    this.games[slot] = g;
    this.shown[slot].add(g.id);
    this.version++;
  }
}
