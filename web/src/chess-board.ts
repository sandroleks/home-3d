import type { PieceSymbol, Square } from 'chess.js';
import type { PanelBoard } from './board-panel';
import { ChessGame } from './chess-game';
import type { GameRules, Side } from './games';

const SVG = 'http://www.w3.org/2000/svg';
/** The filled glyphs for both sides (the fill tells them apart); U+FE0E keeps phones from drawing emoji. */
export const GLYPHS: Record<PieceSymbol, string> = {
  k: '♚︎', q: '♛︎', r: '♜︎', b: '♝︎', n: '♞︎', p: '♟︎',
};
export const PROMOTIONS: readonly [PieceSymbol, string][] = [['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']];
/** The board's squares start this far down the drawing, under a row for the pieces your opponent has taken. */
const TOP = 0.7;
const COLOURS = {
  light: '#e8d5b0', dark: '#9c6b4a', last: 'rgba(232, 194, 122, 0.55)', selected: 'rgba(232, 194, 122, 0.85)',
  check: 'rgba(226, 92, 80, 0.75)', target: 'rgba(18, 17, 15, 0.35)', white: '#f8f4ea', black: '#2a2622',
};

/** A square's column and row on screen (0..7 from the top left), your own side at the bottom. */
export function squareCell(square: string, you: Side): [number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return you === 'white' ? [file, 7 - rank] : [7 - file, rank];
}

export function cellSquare(col: number, row: number, you: Side): Square {
  const [file, rank] = you === 'white' ? [col, 7 - row] : [7 - col, row];
  return `${'abcdefgh'[file]}${rank + 1}` as Square;
}

/**
 * The chessboard in the panel, drawn in SVG: click one of your pieces to see where it can go, then a target to move
 * there; a pawn reaching the last rank asks which piece it becomes. The last move is marked, and the pieces each side
 * has taken line up above (your opponent's) and below (yours) the board.
 */
export class ChessBoard implements PanelBoard {
  readonly element: HTMLElement;
  private svg: SVGSVGElement;
  private picker: HTMLElement;
  private game: ChessGame | null = null;
  private drawn = -1;
  private you: Side = 'white';
  private live = false;
  private selected: Square | null = null;
  private promoting: string | null = null;

  constructor(private doc: Document, private onMove: (uci: string) => void) {
    this.element = doc.createElement('div');
    this.element.className = 'chess-board';
    this.svg = doc.createElementNS(SVG, 'svg') as SVGSVGElement;
    this.svg.setAttribute('viewBox', `0 0 8 ${8 + 2 * TOP}`);
    this.svg.setAttribute('aria-label', 'Chessboard');
    this.svg.addEventListener('click', (e) => this.click(e));
    this.picker = doc.createElement('div');
    this.picker.className = 'promotion';
    this.picker.hidden = true;
    for (const [piece, name] of PROMOTIONS) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = GLYPHS[piece];
      b.setAttribute('aria-label', name);
      b.addEventListener('click', () => {
        const uci = this.promoting;
        this.promoting = null;
        this.picker.hidden = true;
        if (uci) this.onMove(uci + piece);
      });
      this.picker.append(b);
    }
    this.element.append(this.svg, this.picker);
  }

  draw(game: GameRules | null, you: Side, live: boolean): void {
    const g = game instanceof ChessGame ? game : null;
    const moves = g?.moves.length ?? -1;
    if (g !== this.game || moves !== this.drawn || !live) {
      this.selected = null;
      this.promoting = null;
      this.picker.hidden = true;
    }
    this.game = g;
    this.drawn = moves;
    this.you = you;
    this.live = live;
    this.render();
  }

  private click(e: MouseEvent): void {
    const square = (e.target as Element).closest('[data-square]')?.getAttribute('data-square') as Square | null | undefined;
    const g = this.game;
    if (!g || !this.live || !square || this.promoting) return;
    const target = this.selected ? g.targets(this.selected).find((t) => t.to === square) : undefined;
    if (this.selected && target) {
      const uci = `${this.selected}${square}`;
      this.selected = null;
      if (target.promotion) {
        this.promoting = uci;
        this.picker.hidden = false;
        this.render();
      } else this.onMove(uci);
      return;
    }
    const piece = g.pieceAt(square);
    const mine = piece && (piece.color === 'w') === (this.you === 'white');
    this.selected = mine && square !== this.selected ? square : null;
    this.render();
  }

  private render(): void {
    const g = this.game ?? new ChessGame();
    const last = this.game?.lastMove();
    const targets = this.selected ? g.targets(this.selected) : [];
    const turn = g.turn() === 'white' ? 'w' : 'b';
    const nodes: SVGElement[] = [];
    const node = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const n = this.doc.createElementNS(SVG, tag) as SVGElement;
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text !== undefined) n.textContent = text;
      nodes.push(n);
      return n;
    };
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const square = cellSquare(col, row, this.you);
        const rank = Number(square[1]) - 1;
        const file = square.charCodeAt(0) - 97;
        node('rect', { x: col, y: TOP + row, width: 1, height: 1, fill: (file + rank) % 2 === 0 ? COLOURS.dark : COLOURS.light, 'data-square': square });
        const piece = g.pieceAt(square);
        const mark = square === this.selected ? COLOURS.selected
          : square === last?.from || square === last?.to ? COLOURS.last
          : piece?.type === 'k' && piece.color === turn && g.inCheck() ? COLOURS.check : null;
        if (mark) node('rect', { x: col, y: TOP + row, width: 1, height: 1, fill: mark, 'pointer-events': 'none' });
      }
    }
    for (const p of g.pieces()) {
      if (!p.square) continue;
      const [col, row] = squareCell(p.square, this.you);
      this.glyph(node, p.type, p.color, col + 0.5, TOP + row + 0.54, 0.82);
    }
    for (const t of targets) {
      const [col, row] = squareCell(t.to, this.you);
      const full = !!g.pieceAt(t.to);
      node('circle', {
        cx: col + 0.5, cy: TOP + row + 0.5, r: full ? 0.44 : 0.16, fill: full ? 'none' : COLOURS.target,
        stroke: full ? COLOURS.target : 'none', 'stroke-width': 0.08, 'pointer-events': 'none',
      });
    }
    // Taken pieces: your own lost ones by your opponent (above), theirs by you (below)
    const mine = this.you === 'white' ? 'w' : 'b';
    const lost = g.pieces().filter((p) => !p.square).sort((a, b) => a.lost - b.lost);
    for (const [color, y] of [[mine, TOP / 2], [mine === 'w' ? 'b' : 'w', TOP + 8 + TOP / 2]] as const) {
      lost.filter((p) => p.color === color).forEach((p, i) => this.glyph(node, p.type, color, 0.3 + i * 0.45, y + 0.04, 0.5));
    }
    this.svg.replaceChildren(...nodes);
  }

  private glyph(node: (tag: string, attrs: Record<string, string | number>, text?: string) => SVGElement, type: PieceSymbol, color: 'w' | 'b', x: number, y: number, size: number): void {
    node('text', {
      x, y, 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none',
      fill: color === 'w' ? COLOURS.white : COLOURS.black, stroke: color === 'w' ? COLOURS.black : COLOURS.white,
      'stroke-width': size * 0.03, 'paint-order': 'stroke',
    }, GLYPHS[type]);
  }
}
