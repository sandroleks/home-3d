import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { GameEnd, GameRules, Side } from './games';

/** A move as stored: from, to and the promotion piece, e.g. `e2e4`, `e7e8q`. */
const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn]?)$/;
const sideOf = (c: Color): Side => (c === 'w' ? 'white' : 'black');
const otherSide = (s: Side): Side => (s === 'white' ? 'black' : 'white');
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const BACK_RANK: PieceSymbol[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

/** One of the 32 pieces, followed through the game: `id` is its starting square; `square` is null once it is taken,
 * and `lost` then says how many of its side's pieces went before it (-1 while it is on the board). */
export interface ChessPiece { id: string; color: Color; type: PieceSymbol; square: Square | null; lost: number }

/**
 * Chess by chess.js: a list of entries replayed one by one. An entry is a move in UCI (`e2e4`, `e7e8q`), `resign`,
 * `draw?` (an offer) or `draw!` (accepting the other side's offer), always by the side to move. An offer lapses when
 * the offerer's opponent moves instead.
 */
export class ChessGame implements GameRules {
  readonly kind = 'chess' as const;
  private chess = new Chess();
  private list: string[] = [];
  private played: Move[] = [];
  private offer: Side | null = null;
  private over: GameEnd | null = null;
  private result: GameEnd | null = null;

  get moves(): readonly string[] {
    return this.list;
  }

  turn(): Side {
    return sideOf(this.chess.turn());
  }

  drawOffer(): Side | null {
    return this.offer;
  }

  inCheck(): boolean {
    return this.chess.inCheck();
  }

  end(): GameEnd | null {
    return this.result;
  }

  play(entry: string): boolean {
    if (this.result) return false;
    const side = this.turn();
    if (entry === 'resign') this.over = { winner: otherSide(side), reason: 'resigned' };
    else if (entry === 'draw?') {
      if (this.offer) return false;
      this.offer = side;
    } else if (entry === 'draw!') {
      if (!this.offer || this.offer === side) return false;
      this.over = { winner: null, reason: 'agreement' };
    } else {
      if (!this.move(entry)) return false;
      if (this.offer && this.offer !== side) this.offer = null;
    }
    this.list.push(entry);
    this.result = this.over ?? this.byRules();
    return true;
  }

  /** A legal move in its one canonical spelling (no promotion letter on a move that doesn't promote). */
  private move(uci: string): boolean {
    const m = UCI.exec(uci);
    if (!m) return false;
    let done: Move;
    try {
      done = this.chess.move({ from: m[1], to: m[2], ...(m[3] ? { promotion: m[3] } : {}) });
    } catch {
      return false; // chess.js throws on an illegal move
    }
    if (done.lan !== uci) {
      this.chess.undo();
      return false;
    }
    this.played.push(done);
    return true;
  }

  private byRules(): GameEnd | null {
    const c = this.chess;
    if (c.isCheckmate()) return { winner: otherSide(this.turn()), reason: 'checkmate' };
    if (c.isStalemate()) return { winner: null, reason: 'stalemate' };
    if (c.isInsufficientMaterial()) return { winner: null, reason: 'material' };
    if (c.isThreefoldRepetition()) return { winner: null, reason: 'repetition' };
    if (c.isDrawByFiftyMoves()) return { winner: null, reason: 'fifty' };
    return null;
  }

  /** The piece on a square, if any. */
  pieceAt(square: Square): { color: Color; type: PieceSymbol } | null {
    return this.chess.get(square) ?? null;
  }

  /** Where the piece on `from` can move now, and whether it promotes there (one entry per square). */
  targets(from: Square): { to: Square; promotion: boolean }[] {
    if (this.result) return [];
    const seen = new Map<Square, boolean>();
    for (const m of this.chess.moves({ square: from, verbose: true })) seen.set(m.to, m.isPromotion());
    return [...seen].map(([to, promotion]) => ({ to, promotion }));
  }

  lastMove(): { from: Square; to: Square } | null {
    const m = this.played.at(-1);
    return m ? { from: m.from, to: m.to } : null;
  }

  /** Every piece, followed from the start: castling moves the rook, en passant takes the pawn beside, promotion
   * changes the type. */
  pieces(): ChessPiece[] {
    const all: ChessPiece[] = [];
    FILES.forEach((f, i) => {
      for (const [color, back, pawns] of [['w', '1', '2'], ['b', '8', '7']] as const) {
        all.push({ id: `${f}${back}`, color, type: BACK_RANK[i], square: `${f}${back}` as Square, lost: -1 });
        all.push({ id: `${f}${pawns}`, color, type: 'p', square: `${f}${pawns}` as Square, lost: -1 });
      }
    });
    const on = new Map<string, ChessPiece>(all.map((p) => [p.id, p]));
    const lost = { w: 0, b: 0 };
    const shift = (from: string, to: Square) => {
      const p = on.get(from)!;
      on.delete(from);
      p.square = to;
      on.set(to, p);
      return p;
    };
    for (const m of this.played) {
      const takenAt = m.isEnPassant() ? `${m.to[0]}${m.from[1]}` : m.to;
      const taken = m.captured ? on.get(takenAt) : undefined;
      if (taken) {
        on.delete(takenAt);
        taken.square = null;
        taken.lost = lost[taken.color]++;
      }
      const p = shift(m.from, m.to);
      if (m.promotion) p.type = m.promotion;
      const rank = m.from[1];
      if (m.isKingsideCastle()) shift(`h${rank}`, `f${rank}` as Square);
      if (m.isQueensideCastle()) shift(`a${rank}`, `d${rank}` as Square);
    }
    return all;
  }
}
