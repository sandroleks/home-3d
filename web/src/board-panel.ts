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

/** A game's own board in the panel: chess now, backgammon and Go later. */
export interface PanelBoard {
  readonly element: HTMLElement;
  /** Draws the game as `you` sit (your side at the bottom); `live`: your move, so clicks play. */
  draw(game: GameRules | null, you: Side, live: boolean): void;
}

export interface PanelPlayer { name: string; colour: string }

export interface PanelInput {
  you: Side;
  /** The slot's game has draw offers (chess). */
  draws: boolean;
  me: PanelPlayer;
  /** Whoever sits opposite; null for an empty chair. */
  them: PanelPlayer | null;
  /** The slot's game if this visitor plays in it (running or ended); null before one starts. */
  game: GameRules | null;
  end: GameEnd | null;
}

export type DrawButton = 'offer' | 'accept' | 'offered' | null;

/** What the panel says and which buttons work. */
export interface PanelState { status: string; live: boolean; resign: boolean; draw: DrawButton; drawEnabled: boolean }

export function panelState({ you, draws, them, game, end }: PanelInput): PanelState {
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
  let draw: DrawButton = null;
  let drawEnabled = false;
  if (draws) {
    draw = offer === otherSide(you) ? 'accept' : offer === you ? 'offered' : 'offer';
    drawEnabled = live && draw !== 'offered';
  }
  return { status, live, resign: live, draw, drawEnabled };
}

export interface PanelHandlers {
  resign(): void;
  draw(): void;
  stand(): void;
}

/**
 * The overlay a player gets at a game chair: the board in the middle, your opponent above it and you below, whose
 * move it is or how it ended, and the buttons. Names come from other visitors: they are set as text only.
 */
export class BoardPanel {
  private board: PanelBoard | null = null;
  private last = '';
  private onYes: (() => void) | null = null;

  constructor(private doc: Document, handlers: PanelHandlers) {
    this.el('board-resign').addEventListener('click', () => handlers.resign());
    this.el('board-draw').addEventListener('click', () => handlers.draw());
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
    const draw = this.el<HTMLButtonElement>('board-draw');
    draw.hidden = s.draw === null;
    draw.disabled = !s.drawEnabled;
    draw.textContent = s.draw === 'accept' ? GAME_COPY.acceptDraw : s.draw === 'offered' ? GAME_COPY.drawOffered : GAME_COPY.offerDraw;
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
