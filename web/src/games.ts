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
