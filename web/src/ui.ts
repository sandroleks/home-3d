export const COPY = {
  ready: 'Click to explore',
  loadError: "Couldn't load the apartment. Check your connection and try again.",
  mobile: 'Best viewed on desktop. This walkthrough needs a keyboard and mouse.',
  contextLost: 'The 3D view stopped responding. Reload to continue.',
  noWebGL: "Your browser doesn't support WebGL 2, which this walkthrough needs. Try a recent Chrome, Firefox, Safari or Edge.",
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
}
export interface SunPanelState {
  dayOfYear: number;
  daysInYear: number;
  minutes: number;
  sunrise: number | null;
  sunset: number | null;
  readout: string;
  playing: boolean;
}

export class UI {
  private lastRoom = '';
  private clockTimer: ReturnType<typeof setTimeout> | undefined;

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

  setMuted(muted: boolean): void {
    this.el('muted').hidden = !muted;
  }

  /** Resumes on Keep exploring, or on a click anywhere on the pause screen outside the sun panel. */
  onResume(cb: () => void): void {
    const panel = this.el('sun-panel');
    this.el('pause').addEventListener('click', (e) => {
      if (!panel.contains(e.target as Node)) cb();
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
  }

  /** The HUD's date and time; it brightens briefly whenever it changes. */
  setClock(text: string): void {
    const c = this.el('sun-clock');
    if (c.textContent === text) return;
    c.textContent = text;
    c.classList.add('flash');
    clearTimeout(this.clockTimer);
    this.clockTimer = setTimeout(() => c.classList.remove('flash'), 1500);
  }

  showNotice(text: string): void {
    this.el('start').hidden = true;
    this.el('notice-text').textContent = text;
    this.el('notice').hidden = false;
  }
}
