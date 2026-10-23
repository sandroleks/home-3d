export const COPY = {
  ready: 'Click to explore',
  loadError: "Couldn't load the apartment. Check your connection and try again.",
  mobile: 'Best viewed on desktop. This walkthrough needs a keyboard and mouse.',
  contextLost: 'The 3D view stopped responding. Reload to continue.',
  noWebGL: "Your browser doesn't support WebGL 2, which this walkthrough needs. Try a recent Chrome, Firefox, Safari or Edge.",
  flatLighting: 'Real sun and sky off: the same even daylight at any time.',
};

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

  constructor(private doc: Document) {}

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.doc.getElementById(id) as T;
  }

  setProgress(fraction: number): void {
    this.el('progress-bar').style.width = `${Math.round(fraction * 100)}%`;
  }

  setReady(): void {
    const b = this.el<HTMLButtonElement>('start-button');
    b.disabled = false;
    b.textContent = COPY.ready;
  }

  onStart(cb: () => void): void {
    this.el('start-button').addEventListener('click', cb);
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

  showNotice(text: string): void {
    this.el('start').hidden = true;
    this.el('notice-text').textContent = text;
    this.el('notice').hidden = false;
  }
}
