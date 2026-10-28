import { ChessGame } from './chess-game';
import { CONFIG } from './config';
import type { Seat } from './seats';

/** The games on the dining table. */
export type GameKind = 'chess' | 'backgammon' | 'go';
/** The S chair (the Sala window's side) plays white, the N chair black. */
export type Side = 'white' | 'black';

export const otherSide = (s: Side): Side => (s === 'white' ? 'black' : 'white');

export const END_REASONS = ['checkmate', 'stalemate', 'repetition', 'fifty', 'material', 'agreement', 'resigned', 'left'] as const;
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

/** The result line: "White wins: checkmate", "Black wins: White left the table", "Draw: stalemate". */
export function endText(end: GameEnd): string {
  if (end.winner) {
    const loser = SIDE_NAME[otherSide(end.winner)];
    const why = end.reason === 'resigned' ? `${loser} resigned` : end.reason === 'left' ? `${loser} left the table` : end.reason;
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
 * left their chair ends; the white player's browser opens a new game when both chairs are taken and none is running.
 * A game from another visitor is taken (`receive`) when it is this slot's game and its entries extend ours and replay
 * legally, when it is a new game for the two visitors in the chairs now, or, ended, to show in a slot with no game yet
 * (a newcomer's). One that names players not seen in the chairs yet waits a few seconds for their poses.
 */
export class Games {
  /** Goes up on every change, for the overlay to redraw. */
  version = 0;
  private games: (SlotGame | null)[] = SLOTS.map(() => null);
  private pending: ({ message: GameMessage; at: number } | null)[] = SLOTS.map(() => null);
  /** A new game may open: the slot has had an empty chair since its last game opened here. */
  private armed: boolean[] = SLOTS.map(() => true);
  private seats: SlotSeats[] = SLOTS.map(() => ({ white: null, black: null }));
  private now = 0;

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

  /** Every frame, with who sits where and the time (s). Returns the games this browser opened, to send. */
  update(seats: SlotSeats[], now: number): GameMessage[] {
    this.seats = seats;
    this.now = now;
    const opened: GameMessage[] = [];
    seats.forEach((s, slot) => {
      const make = this.rules[SLOTS[slot].kind];
      if (!make) return;
      const g = this.games[slot];
      if (g && !endOf(g)) {
        const left = leftEnd(s.white === g.white, s.black === g.black);
        if (left) {
          g.left = left;
          this.version++;
        }
      }
      const p = this.pending[slot];
      if (p && (now - p.at > CONFIG.games.pendingFor || this.adopt(p.message))) this.pending[slot] = null;
      if (!s.white || !s.black) this.armed[slot] = true;
      else if (this.armed[slot] && s.white === this.selfId() && !this.running(slot)) {
        this.games[slot] = { id: this.newId(), white: s.white, black: s.black, rules: make(), left: null };
        this.armed[slot] = false;
        this.version++;
        opened.push(this.message(slot)!);
      }
    });
    return opened;
  }

  /** A game from another visitor; returns whether it was taken. */
  receive(m: GameMessage): boolean {
    if (!this.playable(m.slot)) return false;
    const g = this.games[m.slot];
    if (g?.id === m.id) return this.extend(g, m);
    if (this.adopt(m)) return true;
    this.pending[m.slot] = { message: m, at: this.now };
    return false;
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

  /** More entries for this slot's game. A game that has ended here takes no more. */
  private extend(g: SlotGame, m: GameMessage): boolean {
    const have = g.rules.moves;
    if (endOf(g) || m.moves.length <= have.length || have.some((e, i) => m.moves[i] !== e)) return false;
    const rules = replay(g.rules.kind, m.moves, this.rules);
    if (!rules) return false;
    g.rules = rules;
    this.version++;
    return true;
  }

  /** Another game in this slot: a new one for the two in its chairs now (unless one is running), or a finished one
   * where there's no game yet. */
  private adopt(m: GameMessage): boolean {
    const g = this.games[m.slot];
    const s = this.seats[m.slot];
    const forSeated = s.white === m.white && s.black === m.black && !this.running(m.slot);
    if (!forSeated && !(!g && m.end)) return false;
    const rules = replay(SLOTS[m.slot].kind, m.moves, this.rules);
    if (!rules) return false;
    this.games[m.slot] = { id: m.id, white: m.white, black: m.black, rules, left: rules.end() ? null : m.end ?? null };
    this.version++;
    return true;
  }
}
