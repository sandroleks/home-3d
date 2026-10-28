import { BackgammonGame, BAR, OFF, rollEntry } from './backgammon-game';
import type { BoardView, PanelAction, PanelBoard } from './board-panel';
import type { GameRules, Side } from './games';

const SVG = 'http://www.w3.org/2000/svg';
/** The drawing, in checker widths: 12 point columns, the bar (column 6) and the bear-off tray on the right (as white
 * sees it); the top row of points from 0 to 5, the bottom row from 12 up to 7, the dice between. */
export const BOARD_W = 14.2;
const BOARD_H = 12;
const TRAY = 13;
const R = 0.45;
const COLOURS = {
  felt: '#33493b', wood: '#6b4630', tray: '#4e3322', light: '#e8d5b0', dark: '#9c6b4a', white: '#f8f4ea', black: '#2a2622',
  selected: 'rgba(232, 194, 122, 0.55)', target: 'rgba(232, 194, 122, 0.9)', die: '#f8f4ea', pip: '#2a2622',
};
export const BG_COPY = {
  roll: 'Roll',
  opening: 'Opening roll: one die each, the higher starts',
  white: 'White',
  black: 'Black',
};
const tie = (d: number) => `Both rolled ${d}: roll again`;
const starts = (w: number, b: number, who: string) => `White ${w}, Black ${b}: ${who} starts`;
const cantMove = (who: string) => `${who} can't move. `;
const pips = (w: number, b: number) => `Pips: White ${w} · Black ${b}`;
const NAME: Record<Side, string> = { white: BG_COPY.white, black: BG_COPY.black };
/** A die's pips, as (x, y) in a unit square. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]], 2: [[0.27, 0.27], [0.73, 0.73]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]],
};

/** Where one of your points is drawn, seen from your chair: its column's left edge and whether it hangs from the
 * top. White's home board is at the bottom right; black sits across the table, so black sees it all turned round. */
export function pointCell(at: number, you: Side): { x: number; top: boolean } {
  const a = you === 'white' ? at : 25 - at; // white's numbering
  const x = a <= 6 ? 13 - a : a <= 12 ? 12 - a : a <= 18 ? a - 13 : a - 12;
  const top = a > 12;
  return you === 'white' ? { x, top } : { x: BOARD_W - 1 - x, top: !top };
}

/** Backgammon's Roll button: on your turn, before you move. */
export function canRoll({ game, live }: BoardView): boolean {
  return live && game instanceof BackgammonGame && game.phase() !== 'move';
}

/** The line under the status: how to start, a tie, who starts, a turn lost to a roll with no move, the pip counts. */
export function backgammonInfo({ game }: BoardView): string {
  if (!(game instanceof BackgammonGame)) return '';
  const roll = game.lastRoll();
  if (game.phase() === 'opening') return roll ? tie(roll.dice[0]) : BG_COPY.opening;
  if (roll?.side === null && game.dice().length === 2) return starts(roll.dice[0], roll.dice[1], NAME[game.turn()]);
  const stuck = game.blocked();
  return `${stuck ? cantMove(NAME[stuck]) : ''}${pips(game.pips('white'), game.pips('black'))}`;
}

/**
 * The backgammon board in the panel, drawn in SVG as you see it from your chair: Roll, then click one of your
 * checkers (or the bar) to see where it can go with the dice left, and a highlighted point (or the tray) to move it
 * there, one die at a time. The dice of the last roll show between the rows, the used ones faded.
 */
export class BackgammonBoard implements PanelBoard {
  readonly element: HTMLElement;
  private svg: SVGSVGElement;
  private game: BackgammonGame | null = null;
  private drawn = -1;
  private you: Side = 'white';
  private live = false;
  private selected: number | null = null;

  /** `onEntry` takes the entries this board makes: rolls and moves. */
  constructor(private doc: Document, private onEntry: (entry: string) => void, private random: () => number = Math.random) {
    this.element = doc.createElement('div');
    this.element.className = 'backgammon-board';
    this.svg = doc.createElementNS(SVG, 'svg') as SVGSVGElement;
    this.svg.setAttribute('viewBox', `0 0 ${BOARD_W} ${BOARD_H}`);
    this.svg.setAttribute('aria-label', 'Backgammon board');
    this.svg.addEventListener('click', (e) => this.click(e));
    this.element.append(this.svg);
  }

  actions(view: BoardView): PanelAction[] {
    return [{ label: BG_COPY.roll, enabled: canRoll(view), run: () => this.onEntry(rollEntry(this.random)) }];
  }

  info(view: BoardView): string {
    return backgammonInfo(view);
  }

  draw(game: GameRules | null, you: Side, live: boolean): void {
    const g = game instanceof BackgammonGame ? game : null;
    const moves = g?.moves.length ?? -1;
    if (g !== this.game || moves !== this.drawn || !live) this.selected = null;
    this.game = g;
    this.drawn = moves;
    this.you = you;
    this.live = live;
    const from = new Set(live && g ? g.legal().map((m) => m.from) : []);
    if (from.size === 1 && from.has(BAR)) this.selected = BAR; // only the bar can move: it's picked already
    this.render();
  }

  private click(e: MouseEvent): void {
    const at = Number((e.target as Element).closest('[data-at]')?.getAttribute('data-at') ?? NaN);
    const g = this.game;
    if (!g || !this.live || Number.isNaN(at)) return;
    const move = this.selected === null ? undefined : g.legal().find((m) => m.from === this.selected && m.to === at);
    if (move) {
      this.selected = null;
      this.onEntry(move.text);
      return;
    }
    this.selected = at !== this.selected && g.targets(at).length ? at : null;
    this.render();
  }

  private render(): void {
    const g = this.game ?? new BackgammonGame();
    const you = this.you;
    const them: Side = you === 'white' ? 'black' : 'white';
    const targets = this.selected === null ? [] : g.targets(this.selected);
    const flip = (x: number) => (you === 'white' ? x : BOARD_W - x);
    const nodes: SVGElement[] = [];
    const node = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const n = this.doc.createElementNS(SVG, tag) as SVGElement;
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text !== undefined) n.textContent = text;
      nodes.push(n);
      return n;
    };
    const checker = (side: Side, cx: number, cy: number, label?: number) => {
      node('circle', { cx, cy, r: R, fill: COLOURS[side], stroke: COLOURS[side === 'white' ? 'black' : 'white'], 'stroke-width': 0.06 });
      if (label) node('text', { x: cx, y: cy, 'font-size': 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: COLOURS[side === 'white' ? 'black' : 'white'] }, String(label));
    };
    node('rect', { x: 0, y: 0, width: BOARD_W, height: BOARD_H, fill: COLOURS.felt });
    node('rect', { x: flip(6) - (you === 'white' ? 0 : 1), y: 0, width: 1, height: BOARD_H, fill: COLOURS.wood });
    node('rect', { x: you === 'white' ? TRAY : 0, y: 0, width: BOARD_W - TRAY, height: BOARD_H, fill: COLOURS.tray });
    // The 24 points, your own numbering, and the checkers on them (five drawn, the fifth numbered if more)
    for (let at = 1; at <= 24; at++) {
      const { x, top } = pointCell(at, you);
      const tip = top ? 4.8 : BOARD_H - 4.8;
      const base = top ? 0 : BOARD_H;
      node('polygon', { points: `${x},${base} ${x + 1},${base} ${x + 0.5},${tip}`, fill: at % 2 ? COLOURS.dark : COLOURS.light });
      if (at === this.selected) node('rect', { x, y: top ? 0 : BOARD_H - 5.5, width: 1, height: 5.5, fill: COLOURS.selected });
      const step = top ? 0.9 : -0.9;
      const first = top ? R + 0.05 : BOARD_H - R - 0.05;
      for (const side of [you, them]) {
        const n = g.count(side, side === you ? at : 25 - at);
        for (let k = 0; k < Math.min(n, 5); k++) checker(side, x + 0.5, first + k * step, k === 4 && n > 5 ? n : undefined);
      }
      if (targets.includes(at)) node('circle', { cx: x + 0.5, cy: first + Math.min(g.count(you, at), 4) * step, r: 0.18, fill: COLOURS.target });
    }
    // The bar and the tray: your checkers in the half nearer you
    const barX = flip(6.5);
    if (this.selected === BAR) node('rect', { x: barX - 0.5, y: BOARD_H / 2, width: 1, height: BOARD_H / 2, fill: COLOURS.selected });
    for (const side of [you, them]) {
      const n = g.count(side, BAR);
      const dir = side === you ? 1 : -1;
      for (let k = 0; k < Math.min(n, 5); k++) checker(side, barX, BOARD_H / 2 + dir * (0.7 + k * 0.9), k === 4 && n > 5 ? n : undefined);
      const off = g.count(side, OFF);
      const trayX = you === 'white' ? TRAY + 0.1 : 0.1;
      for (let k = 0; k < off; k++) {
        const y = side === you ? BOARD_H - 0.3 * (k + 1) : 0.3 * k + 0.05;
        node('rect', { x: trayX, y, width: BOARD_W - TRAY - 0.2, height: 0.25, rx: 0.05, fill: COLOURS[side], stroke: COLOURS[side === 'white' ? 'black' : 'white'], 'stroke-width': 0.03 });
      }
    }
    if (targets.includes(OFF)) node('rect', { x: you === 'white' ? TRAY : 0, y: BOARD_H / 2, width: BOARD_W - TRAY, height: BOARD_H / 2, fill: COLOURS.selected });
    this.dice(g, node);
    // What a click means: a point, the bar or the tray, in your numbering
    for (let at = 1; at <= 24; at++) {
      const { x, top } = pointCell(at, you);
      node('rect', { x, y: top ? 0 : BOARD_H / 2, width: 1, height: BOARD_H / 2, fill: '#000', 'fill-opacity': 0, 'data-at': at });
    }
    node('rect', { x: barX - 0.5, y: BOARD_H / 2, width: 1, height: BOARD_H / 2, fill: '#000', 'fill-opacity': 0, 'data-at': BAR });
    node('rect', { x: you === 'white' ? TRAY : 0, y: BOARD_H / 2, width: BOARD_W - TRAY, height: BOARD_H / 2, fill: '#000', 'fill-opacity': 0, 'data-at': OFF });
    this.svg.replaceChildren(...nodes);
  }

  /** The last roll's dice in the middle of your right-hand half, the used ones faded (four for a double). */
  private dice(g: BackgammonGame, node: (tag: string, attrs: Record<string, string | number>) => SVGElement): void {
    const roll = g.lastRoll();
    if (!roll) return;
    const [a, b] = roll.dice;
    const all = roll.side !== null && a === b ? [a, a, a, a] : [a, b];
    const left = g.phase() === 'move' ? [...g.dice()] : [];
    const opening = roll.side === null && g.phase() === 'opening';
    all.forEach((d, i) => {
      const unused = opening || left.includes(d);
      if (unused) left.splice(left.indexOf(d), 1);
      const x = 8 + i * 1.2 + (all.length === 2 ? 0.6 : 0);
      const y = BOARD_H / 2 - 0.45;
      node('rect', { x, y, width: 0.9, height: 0.9, rx: 0.15, fill: COLOURS.die, opacity: unused ? 1 : 0.35 });
      for (const [px, py] of PIPS[d]) node('circle', { cx: x + px * 0.9, cy: y + py * 0.9, r: 0.08, fill: COLOURS.pip, opacity: unused ? 1 : 0.35 });
    });
  }
}
