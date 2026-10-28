import { endText, type GameEnd, type GameRules, otherSide, type Side } from './games';

export const GAME_COPY = {
  waiting: 'Waiting for an opponent',
  settingUp: 'Setting up the board…',
  yourMove: 'Your move',
  yourMoveCheck: 'Your move: check',
  emptyChair: 'Empty chair',
  you: ' (you)',
  white: 'White',
  black: 'Black',
  resign: 'Resign',
  offerDraw: 'Offer draw',
  acceptDraw: 'Accept draw',
  drawOffered: 'Draw offered',
  standUp: 'Stand up',
  standAndResign: 'Stand up and resign?',
  resignGame: 'Resign this game?',
  keepPlaying: 'Keep playing',
};
const theirMove = (name: string) => `${name}'s move`;
const offersDraw = (name: string) => `${name} offers a draw`;

/** What a board's own buttons and line go by: the game as `you` see it, whether it's your move, and how it ended. */
export interface BoardView { game: GameRules | null; you: Side; live: boolean; end: GameEnd | null }

/** A game's own button, between Resign and Stand up: chess's Offer draw, backgammon's Roll. */
export interface PanelAction { label: string; enabled: boolean; run(): void }

/** A game's own board in the panel; each game brings its own, with its own buttons and line. */
export interface PanelBoard {
  readonly element: HTMLElement;
  /** Draws the game as `you` sit (your side at the bottom); `live`: your move, so clicks play. */
  draw(game: GameRules | null, you: Side, live: boolean): void;
  /** The game's own buttons now. */
  actions?(view: BoardView): PanelAction[];
  /** A line of the game's own under the status (backgammon: the opening roll, the pip counts); '' for none. */
  info?(view: BoardView): string;
}

export interface PanelPlayer { name: string; colour: string }

export interface PanelInput {
  you: Side;
  me: PanelPlayer;
  /** Whoever sits opposite; null for an empty chair. */
  them: PanelPlayer | null;
  /** The slot's game if this visitor plays in it (running or ended); null before one starts. */
  game: GameRules | null;
  end: GameEnd | null;
}

/** What the panel says, and whether it's your move and you may resign. */
export interface PanelState { status: string; live: boolean; resign: boolean }

export function panelState({ you, them, game, end }: PanelInput): PanelState {
  const running = !!game && !end;
  const live = running && game.turn() === you;
  const offer = running ? game.drawOffer?.() ?? null : null;
  const name = them?.name ?? GAME_COPY.emptyChair;
  let status: string;
  if (end) status = endText(end);
  else if (!game) status = them ? GAME_COPY.settingUp : GAME_COPY.waiting;
  else if (!live) status = theirMove(name);
  else if (offer === otherSide(you)) status = offersDraw(name);
  else status = game.inCheck?.() ? GAME_COPY.yourMoveCheck : GAME_COPY.yourMove;
  return { status, live, resign: live };
}

export interface PanelHandlers {
  resign(): void;
  stand(): void;
}

/**
 * The overlay a player gets at a game chair: the board in the middle, your opponent above it and you below, whose
 * move it is or how it ended, the game's own line, and the buttons: Resign, the game's own, Stand up. Names come from
 * other visitors: they are set as text only.
 */
export class BoardPanel {
  private board: PanelBoard | null = null;
  private last = '';
  private onYes: (() => void) | null = null;

  constructor(private doc: Document, handlers: PanelHandlers) {
    this.el('board-resign').addEventListener('click', () => handlers.resign());
    this.el('board-stand').addEventListener('click', () => handlers.stand());
    this.el('board-confirm-yes').addEventListener('click', () => {
      const yes = this.onYes;
      this.cancel();
      yes?.();
    });
    this.el('board-confirm-no').addEventListener('click', () => this.cancel());
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.doc.getElementById(id) as T;
  }

  get isOpen(): boolean {
    return !this.el('board-panel').hidden;
  }

  open(title: string, board: PanelBoard): void {
    this.board = board;
    this.last = '';
    this.el('board-title').textContent = title;
    this.el('board-area').replaceChildren(board.element);
    this.el('board-panel').hidden = false;
  }

  close(): void {
    this.cancel();
    this.board = null;
    this.el('board-panel').hidden = true;
  }

  /** Asks before something that can't be undone: `yes` names the button that does it. */
  confirm(question: string, yes: string, onYes: () => void): void {
    this.onYes = onYes;
    this.el('board-confirm-text').textContent = question;
    this.el('board-confirm-yes').textContent = yes;
    this.el('board-confirm').hidden = false;
    this.el('board-buttons').hidden = true;
  }

  private cancel(): void {
    this.onYes = null;
    this.el('board-confirm').hidden = true;
    this.el('board-buttons').hidden = false;
  }

  /** Redraws when something changed: `version` is the games' (it goes up with every move). */
  render(input: PanelInput, version: number): void {
    const key = JSON.stringify([input.you, input.me, input.them, input.end, input.game?.moves.length ?? -1, version]);
    if (key === this.last) return;
    this.last = key;
    const s = panelState(input);
    this.player('board-them', input.them, otherSide(input.you), false);
    this.player('board-me', input.me, input.you, true);
    this.el('board-status').textContent = s.status;
    this.el<HTMLButtonElement>('board-resign').disabled = !s.resign;
    const view: BoardView = { game: input.game, you: input.you, live: s.live, end: input.end };
    const info = this.board?.info?.(view) ?? '';
    this.el('board-info').textContent = info;
    this.el('board-info').hidden = !info;
    this.el('board-actions').replaceChildren(...(this.board?.actions?.(view) ?? []).map((a) => {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      b.disabled = !a.enabled;
      b.addEventListener('click', () => a.run());
      return b;
    }));
    this.board?.draw(input.game, input.you, s.live);
  }

  private player(id: string, p: PanelPlayer | null, side: Side, you: boolean): void {
    const row = this.el(id);
    const dot = row.querySelector('i')!;
    const [name, colour] = row.querySelectorAll('span');
    dot.style.background = p?.colour ?? 'transparent';
    name.textContent = p ? `${p.name}${you ? GAME_COPY.you : ''}` : GAME_COPY.emptyChair;
    colour.textContent = side === 'white' ? GAME_COPY.white : GAME_COPY.black;
  }
}
