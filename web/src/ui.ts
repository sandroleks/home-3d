import { blackBody, type HueScene, hueColour, levelFor } from './hue';
import type { GuestRow } from './guests';
import type { MicState } from './voice';

export const COPY = {
  ready: 'Click to explore',
  readyTouch: 'Tap to explore',
  loadError: "Couldn't load the apartment. Check your connection and try again.",
  contextLost: 'The 3D view stopped responding. Reload to continue.',
  noWebGL: "Your browser doesn't support WebGL 2, which this walkthrough needs. Try a recent Chrome, Firefox, Safari or Edge.",
  flatLighting: 'Real sun and sky off: the same even daylight at any time.',
  kitchenWall: 'Kitchen wall up, as it is now',
  noKitchenWall: "The kitchen-wall version hasn't been exported yet. Open the flat without it instead.",
  chooseScene: 'Choose a scene',
  whiteScenes: 'White',
  colourScenes: 'Colour',
  stand: 'Move to stand up',
};

/** Where a Hue scene goes: the room the visitor is in, or every room. */
export type SceneScope = 'room' | 'home';

/** The scene menu's swatch, as a CSS background: a white scene's colour, dimmed with its brightness; a colour scene's
 * colours round a wheel; dark for off; nothing while no scene is set. */
export function swatch(scene: HueScene | undefined): string {
  if (!scene) return 'transparent';
  const css = (c: { r: number; g: number; b: number }, v: number) => `rgb(${Math.round(c.r * v * 255)}, ${Math.round(c.g * v * 255)}, ${Math.round(c.b * v * 255)})`;
  const v = scene.bri > 0 ? 0.35 + 0.65 * levelFor(scene.bri) : 0.15;
  if (scene.colours?.length) return `conic-gradient(${[...scene.colours, scene.colours[0]].map((c) => css(hueColour(c), v)).join(', ')})`;
  return css(blackBody(scene.ct > 0 ? 1e6 / scene.ct : 2700), v);
}

export function isTouchOnly(matchMedia: (q: string) => { matches: boolean }): boolean {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
}

export interface SunPanelHandlers {
  dayOfYear(n: number): void;
  season(month: number, day: number): void;
  minutes(m: number): void;
  now(): void;
  play(): void;
  real(on: boolean): void;
}
export interface TouchBarHandlers {
  light(): void;
  mute(): void;
  mic(): void;
  /** Sit down on the floor, or get up. */
  sit(): void;
  pause(): void;
}
export interface SunPanelState {
  dayOfYear: number;
  daysInYear: number;
  minutes: number;
  sunrise: number | null;
  sunset: number | null;
  readout: string;
  playing: boolean;
  real: boolean;
}

export class UI {
  private lastRoom = '';
  private lastSitting = false;
  private lastRoomLight: boolean | null | undefined;
  private touch = false;
  private lastGuests = '';
  private sceneList: readonly HueScene[] = [];
  /** The scene the swatch shows ('' for none), null before the first. */
  private swatchFor: string | null = null;

  constructor(private doc: Document) {}

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.doc.getElementById(id) as T;
  }

  setProgress(fraction: number): void {
    this.el('progress-bar').style.width = `${Math.round(fraction * 100)}%`;
  }

  /** Phones and tablets: touch controls on the start screen, a button bar for the keys, the sun panel behind a button. */
  setTouch(): void {
    this.touch = true;
    this.doc.body.classList.add('touch');
  }

  setReady(): void {
    const b = this.el<HTMLButtonElement>('start-button');
    b.disabled = false;
    b.textContent = this.touch ? COPY.readyTouch : COPY.ready;
  }

  onStart(cb: () => void): void {
    const b = this.el<HTMLButtonElement>('start-button');
    b.addEventListener('click', cb);
    this.el('name').addEventListener('keydown', (e) => { // Enter in the name field starts too
      if (e.key === 'Enter' && !b.disabled) cb();
    });
  }

  /** The name field on the start screen: what the other visitors see. */
  getName(): string {
    return this.el<HTMLInputElement>('name').value;
  }

  setName(name: string): void {
    this.el<HTMLInputElement>('name').value = name;
  }

  /** The start screen's voice checkbox: whether the start click asks for the mic. */
  getVoice(): boolean {
    return this.el<HTMLInputElement>('voice').checked;
  }

  setVoice(on: boolean): void {
    this.el<HTMLInputElement>('voice').checked = on;
  }

  /** The mic's state, in the corner and on the touch bar: on, off (V), or none (refused or unticked: listening only). */
  setMic(state: MicState): void {
    const label = state === 'on' ? 'Mic on' : state === 'off' ? 'Mic off' : 'No mic: listening only';
    const mark = this.el('mic');
    mark.hidden = false;
    mark.classList.toggle('off', state !== 'on');
    mark.querySelector('svg')?.setAttribute('aria-label', label);
    const b = this.el<HTMLButtonElement>('touch-mic');
    b.hidden = false;
    b.disabled = state === 'none';
    b.setAttribute('aria-pressed', String(state === 'on'));
    b.setAttribute('aria-label', label);
  }

  /** Who else is here, under the room name, with a mark after whoever is talking; hidden when alone. */
  setPeople(people: { name: string; talking: boolean }[]): void {
    const p = this.el('people');
    p.hidden = people.length === 0;
    const text = people.length ? `With ${people.map((x) => (x.talking ? `${x.name} 🔊` : x.name)).join(', ')}` : '';
    if (p.textContent !== text) p.textContent = text;
  }

  /** The guest list's rows, redrawn only when something in them changed. Names come from other visitors: text only. */
  setGuests(rows: GuestRow[]): void {
    const key = JSON.stringify(rows);
    if (key === this.lastGuests) return;
    this.lastGuests = key;
    this.el('guest-rows').replaceChildren(...rows.map((r) => {
      const li = this.doc.createElement('li');
      const dot = this.doc.createElement('i');
      dot.style.background = r.colour;
      const name = this.doc.createElement('span');
      name.textContent = `${r.name}${r.you ? ' (you)' : ''}${r.host ? ' 👑' : ''}${r.talking ? ' 🔊' : ''}`;
      const room = this.doc.createElement('span');
      room.className = 'room';
      room.textContent = r.room ?? '';
      li.append(dot, name, room);
      return li;
    }));
    this.el('guests-alone').hidden = rows.length > 1;
  }

  get guestsOpen(): boolean {
    return !this.el('guests').hidden;
  }

  /** Shows or hides the guest list; returns whether it is open now. */
  toggleGuests(): boolean {
    const panel = this.el('guests');
    panel.hidden = !panel.hidden;
    this.el('touch-guests').setAttribute('aria-expanded', String(!panel.hidden));
    this.doc.body.classList.toggle('guests-open', !panel.hidden); // the panel shows the people the "With …" line names
    if (!panel.hidden && this.touch) { // on a phone the sun panel and the guest list would overlap: one at a time
      this.doc.body.classList.remove('sun-open');
      this.el('touch-sun').setAttribute('aria-expanded', 'false');
    }
    return !panel.hidden;
  }

  /** A click on the "With …" line (with the mouse free) or the touch bar's people button. */
  onGuests(cb: () => void): void {
    this.el('people').addEventListener('click', cb);
    this.el('touch-guests').addEventListener('click', cb);
  }

  hideStart(): void {
    this.el('start').hidden = true;
  }

  showHud(): void {
    this.el('hud').hidden = false;
  }

  showError(message: string, retry: () => void): void {
    this.el('start').hidden = false; // the error text lives in the start overlay
    this.el('start-button').hidden = true;
    const e = this.el('error');
    e.textContent = message;
    e.hidden = false;
    const r = this.el('retry-button');
    r.hidden = false;
    r.addEventListener('click', retry, { once: true });
  }

  setRoom(name: string): void {
    if (name === this.lastRoom) return;
    this.lastRoom = name;
    this.el('room-name').textContent = name;
  }

  setPrompt(text: string | null): void {
    const p = this.el('prompt');
    p.hidden = !text;
    if (text && p.textContent !== text) p.textContent = text;
  }

  setPaused(paused: boolean): void {
    this.el('pause').hidden = !paused;
  }

  /** While walking the mouse is captured: the sun panel only shows. */
  setWalking(walking: boolean): void {
    this.doc.body.classList.toggle('walking', walking);
    if (walking) (this.doc.activeElement as HTMLElement | null)?.blur?.(); // a focused slider would eat the arrow keys
  }

  /** Tab: the mouse is free for the sun panel while the keys keep walking. */
  setCursor(cursor: boolean): void {
    this.doc.body.classList.toggle('cursor', cursor);
    if (!cursor) (this.doc.activeElement as HTMLElement | null)?.blur?.();
  }

  setMuted(muted: boolean): void {
    this.el('muted').hidden = !muted;
    this.el('touch-sound').setAttribute('aria-pressed', String(muted));
  }

  /** The touch bar's buttons: what L, M and Esc do with a keyboard, and the sun panel shown or hidden. */
  bindTouchBar(h: TouchBarHandlers): void {
    this.el('touch-light').addEventListener('click', () => h.light());
    this.el('touch-sound').addEventListener('click', () => h.mute());
    this.el('touch-mic').addEventListener('click', () => h.mic());
    this.el('touch-sit').addEventListener('click', () => h.sit());
    this.el('touch-pause').addEventListener('click', () => h.pause());
    const sun = this.el('touch-sun');
    sun.addEventListener('click', () => {
      const open = this.doc.body.classList.toggle('sun-open');
      sun.setAttribute('aria-expanded', String(open));
      if (open && this.touch) { // on a phone the sun panel and the guest list would overlap: one at a time
        this.el('guests').hidden = true;
        this.doc.body.classList.remove('guests-open');
        this.el('touch-guests').setAttribute('aria-expanded', 'false');
      }
    });
  }

  /** The current room's light on the touch bar: null when the room has none. */
  /** Sitting or lying: the touch bar's sit button shows it pressed. */
  setSitting(on: boolean): void {
    if (on === this.lastSitting) return;
    this.lastSitting = on;
    const b = this.el<HTMLButtonElement>('touch-sit');
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Stand up' : 'Sit on the floor');
  }

  setRoomLight(on: boolean | null): void {
    if (on === this.lastRoomLight) return;
    this.lastRoomLight = on;
    const b = this.el<HTMLButtonElement>('touch-light');
    b.disabled = on === null;
    b.setAttribute('aria-pressed', String(on === true));
  }

  /** Resumes on Keep exploring or a click on the pause veil (the sun panel sits above it, outside #pause). */
  onResume(cb: () => void): void {
    const pause = this.el('pause');
    pause.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button')) cb(); // the button has its own listener
    });
    this.el('resume-button').addEventListener('click', cb);
  }

  bindSunPanel(h: SunPanelHandlers): void {
    const date = this.el<HTMLInputElement>('sun-date');
    date.addEventListener('input', () => h.dayOfYear(Number(date.value)));
    const time = this.el<HTMLInputElement>('sun-time');
    time.addEventListener('input', () => h.minutes(Number(time.value)));
    for (const b of this.doc.querySelectorAll<HTMLButtonElement>('[data-season]')) {
      const [month, day] = (b.dataset.season ?? '').split('-').map(Number);
      b.addEventListener('click', () => h.season(month, day));
    }
    this.el('sun-now').addEventListener('click', () => h.now());
    this.el('sun-play').addEventListener('click', () => h.play());
    const real = this.el<HTMLInputElement>('sun-real');
    real.addEventListener('change', () => h.real(real.checked));
    // A slider left focused would also take the arrow keys the visitor walks with
    this.el('sun-panel').addEventListener('pointerup', () => {
      if (this.doc.body.classList.contains('cursor')) (this.doc.activeElement as HTMLElement | null)?.blur?.();
    });
  }

  setSunPanel(s: SunPanelState): void {
    const date = this.el<HTMLInputElement>('sun-date');
    date.max = String(s.daysInYear);
    if (date.value !== String(s.dayOfYear)) date.value = String(s.dayOfYear);
    const time = this.el<HTMLInputElement>('sun-time');
    const minutes = String(Math.min(1435, Math.round(s.minutes / 5) * 5));
    if (time.value !== minutes) time.value = minutes;
    const mark = (id: string, m: number | null) => {
      const el = this.el(id);
      el.hidden = m === null;
      if (m !== null) el.style.left = `${(m / 1435) * 100}%`;
    };
    mark('sun-rise', s.sunrise);
    mark('sun-set', s.sunset);
    this.el('sun-readout').textContent = s.readout;
    this.el('sun-play').textContent = s.playing ? 'Pause' : 'Play';
    this.el<HTMLInputElement>('sun-real').checked = s.real;
    this.el<HTMLFieldSetElement>('sun-controls').disabled = !s.real;
  }

  /** The date and time at the top of the sun panel. */
  setClock(text: string): void {
    const c = this.el('sun-clock');
    if (c.textContent !== text) c.textContent = text;
  }

  /** The kitchen wall checkbox in the sun panel, and a note on the start screen while the wall is up. */
  setKitchenWall(wall: boolean): void {
    this.el<HTMLInputElement>('kitchen-wall').checked = wall;
    const note = this.el('layout-note');
    note.hidden = !wall;
    note.textContent = wall ? COPY.kitchenWall : '';
  }

  onKitchenWall(cb: (wall: boolean) => void): void {
    const box = this.el<HTMLInputElement>('kitchen-wall');
    box.addEventListener('change', () => cb(box.checked));
  }

  /** The Hue scene menu: the white scenes, the colour scenes, then off. Choosing one sets it in this room or the whole
   * home, as the scope menu says. */
  bindScenes(scenes: readonly HueScene[], cb: (id: string, scope: SceneScope) => void): void {
    const menu = this.el<HTMLSelectElement>('scene');
    const scope = this.el<HTMLSelectElement>('scene-scope');
    const option = (value: string, text: string) => {
      const o = this.doc.createElement('option');
      o.value = value;
      o.textContent = text;
      return o;
    };
    const none = option('', COPY.chooseScene);
    none.hidden = true;
    const group = (label: string, list: readonly HueScene[]) => {
      const g = this.doc.createElement('optgroup');
      g.label = label;
      g.append(...list.map((s) => option(s.id, s.name)));
      return g;
    };
    menu.append(
      none,
      group(COPY.whiteScenes, scenes.filter((s) => s.bri > 0 && !s.colours)),
      group(COPY.colourScenes, scenes.filter((s) => s.bri > 0 && s.colours)),
      ...scenes.filter((s) => s.bri === 0).map((s) => option(s.id, s.name)),
    );
    this.sceneList = scenes;
    menu.addEventListener('change', () => {
      if (menu.value) cb(menu.value, scope.value === 'home' ? 'home' : 'room');
      menu.blur(); // the keys walk again, rather than picking scenes by their first letter
    });
    scope.addEventListener('change', () => scope.blur());
  }

  /** The scene menu shows the scene while it's still what's set in the room the visitor is in. */
  setScenes(active: string | null): void {
    const menu = this.el<HTMLSelectElement>('scene');
    const value = active ?? '';
    if (menu.value === value && this.swatchFor === value) return;
    menu.value = value;
    this.swatchFor = value;
    this.el('scene-swatch').style.background = swatch(this.sceneList.find((s) => s.id === active));
  }

  showNotice(text: string): void {
    this.el('start').hidden = true;
    this.el('notice-text').textContent = text;
    this.el('notice').hidden = false;
  }
}
