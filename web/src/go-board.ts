import type { BoardView, PanelAction, PanelBoard } from './board-panel';
import type { GameRules, Side } from './games';
import { GoGame, pointName, SIZE } from './go-game';

const SVG = 'http://www.w3.org/2000/svg';
/** The drawing is 10 × 10: the lines run from 1 to 9, a half point of board beyond them. */
const VIEW = SIZE + 1;
/** The star points: C3, G3, E5, C7, G7. */
const STARS = [20, 24, 40, 56, 60];
const COLOURS = { wood: '#d8b077', line: '#3b2c1e', white: '#f8f4ea', black: '#2a2622', edge: '#2a2622' };
export const GO_COPY = { pass: 'Pass', white: 'White', black: 'Black' };
const NAME: Record<Side, string> = { white: GO_COPY.white, black: GO_COPY.black };
const prisoners = (b: number, w: number) => `Prisoners: Black ${b} · White ${w}`;
const passed = (who: string) => `${who} passed. `;

/** A point's column and row on screen (0..8 from the top left), your own side at the bottom: white sees A1 at the
 * bottom left, as on the table from the S chair; black, across the table, sees the board turned round. */
export function pointCell(point: number, you: Side): [number, number] {
  const col = point % SIZE;
  const row = Math.floor(point / SIZE);
  return you === 'white' ? [col, SIZE - 1 - row] : [SIZE - 1 - col, row];
}

/** Go's Pass button: on your move. */
export function canPass({ game, live }: BoardView): boolean {
  return live && game instanceof GoGame;
}

/** The line under the status: who just passed and the prisoners while it runs; once two passes end it, the count. */
export function goInfo({ game, end }: BoardView): string {
  if (!(game instanceof GoGame)) return '';
  if (end?.reason === 'score' && game.end()) {
    const { stones, area, komi, total } = game.score();
    return `Black: stones ${stones.black} + area ${area.black} = ${total.black} · `
      + `White: stones ${stones.white} + area ${area.white} + komi ${komi} = ${total.white}`;
  }
  const who = !end ? game.passed() : null;
  return `${who ? passed(NAME[who]) : ''}${prisoners(game.prisoners('black'), game.prisoners('white'))}`;
}

/**
 * The Go board in the panel, drawn in SVG from your chair: on your move the points you may play show a faint stone
 * under the pointer; click one to place your stone there. The last stone placed is marked.
 */
export class GoBoard implements PanelBoard {
  readonly element: HTMLElement;
  private svg: SVGSVGElement;
  private game: GoGame | null = null;
  private you: Side = 'white';
  private live = false;

  /** `onEntry` takes the entries this board makes: points and `pass`. */
  constructor(private doc: Document, private onEntry: (entry: string) => void) {
    this.element = doc.createElement('div');
    this.element.className = 'go-board';
    this.svg = doc.createElementNS(SVG, 'svg') as SVGSVGElement;
    this.svg.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);
    this.svg.setAttribute('aria-label', 'Go board');
    this.svg.addEventListener('click', (e) => this.click(e));
    this.element.append(this.svg);
  }

  actions(view: BoardView): PanelAction[] {
    return [{ label: GO_COPY.pass, enabled: canPass(view), run: () => this.onEntry('pass') }];
  }

  info(view: BoardView): string {
    return goInfo(view);
  }

  draw(game: GameRules | null, you: Side, live: boolean): void {
    this.game = game instanceof GoGame ? game : null;
    this.you = you;
    this.live = live;
    this.render();
  }

  private click(e: MouseEvent): void {
    const point = (e.target as Element).closest('[data-point]')?.getAttribute('data-point');
    if (this.game && this.live && point) this.onEntry(point);
  }

  private render(): void {
    const g = this.game ?? new GoGame();
    const nodes: SVGElement[] = [];
    const node = (tag: string, attrs: Record<string, string | number>) => {
      const n = this.doc.createElementNS(SVG, tag) as SVGElement;
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      nodes.push(n);
      return n;
    };
    const centre = (point: number) => pointCell(point, this.you).map((c) => c + 1) as [number, number];
    node('rect', { x: 0, y: 0, width: VIEW, height: VIEW, fill: COLOURS.wood });
    for (let i = 1; i <= SIZE; i++) {
      node('line', { x1: 1, y1: i, x2: SIZE, y2: i, stroke: COLOURS.line, 'stroke-width': 0.04 });
      node('line', { x1: i, y1: 1, x2: i, y2: SIZE, stroke: COLOURS.line, 'stroke-width': 0.04 });
    }
    for (const p of STARS) {
      const [cx, cy] = centre(p);
      node('circle', { cx, cy, r: 0.1, fill: COLOURS.line });
    }
    const last = this.game?.lastPoint() ?? null;
    for (let p = 0; p < SIZE * SIZE; p++) {
      const [cx, cy] = centre(p);
      const side = g.at(p);
      if (side) {
        node('circle', { cx, cy, r: 0.47, fill: COLOURS[side], stroke: COLOURS.edge, 'stroke-width': 0.04 });
        if (p === last) node('circle', { cx, cy, r: 0.18, fill: 'none', stroke: COLOURS[side === 'white' ? 'black' : 'white'], 'stroke-width': 0.07 });
      } else if (this.live && g.canPlay(p)) {
        node('circle', { cx, cy, r: 0.47, fill: COLOURS[this.you], 'fill-opacity': 0, class: 'go-hint', 'data-point': pointName(p) });
      }
    }
    this.svg.replaceChildren(...nodes);
  }
}
