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

  setMuted(muted: boolean): void {
    this.el('muted').hidden = !muted;
  }

  onResume(cb: () => void): void {
    this.el('pause').addEventListener('click', cb);
  }

  showNotice(text: string): void {
    this.el('start').hidden = true;
    this.el('notice-text').textContent = text;
    this.el('notice').hidden = false;
  }
}
