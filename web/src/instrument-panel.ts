import type { InstrumentPanelView } from './instruments';

export interface InstrumentPanelHandlers {
  /** A key or chord button pressed or let go: the computer key it stands for (KeyboardEvent.code). */
  key: (code: string, down: boolean) => void;
  octave: (delta: number) => void;
  close: () => void;
}

/** The panel for playing an instrument (index.html, #instrument-panel): chords, the keys with the computer keys that
 * play them, the octave buttons. It shows a view (instruments.ts) and passes on what is pressed. */
export class InstrumentPanel {
  private shown = '';
  private keys: HTMLButtonElement[] = [];
  private chords: HTMLButtonElement[] = [];

  constructor(private doc: Document, private h: InstrumentPanelHandlers) {
    this.el('instrument-close').addEventListener('click', () => h.close());
    this.el('instrument-down').addEventListener('click', () => h.octave(-1));
    this.el('instrument-up').addEventListener('click', () => h.octave(1));
  }

  get isOpen(): boolean {
    return !this.el('instrument-panel').hidden;
  }

  /** `inHand`: an instrument held on a touch screen, played walking about: the panel at the top, Drop to let go. */
  open(inHand: boolean): void {
    this.shown = '';
    const panel = this.el('instrument-panel');
    panel.classList.toggle('in-hand', inHand);
    this.el('instrument-close').textContent = inHand ? 'Drop' : 'Close';
    panel.hidden = false;
  }

  close(): void {
    this.el('instrument-panel').hidden = true;
  }

  render(v: InstrumentPanelView): void {
    const layout = `${v.title}|${v.range}|${v.chords.map((c) => c.label).join()}`;
    if (layout !== this.shown) {
      this.shown = layout;
      this.el('instrument-title').textContent = v.title;
      this.el('instrument-range').textContent = v.range;
      this.el('instrument-hint').textContent = v.hint;
      this.build(v);
    }
    v.keys.forEach((k, i) => {
      this.keys[i].classList.toggle('down', k.down);
      this.keys[i].disabled = !k.playable;
    });
    v.chords.forEach((c, i) => this.chords[i].classList.toggle('down', c.down));
    this.el<HTMLButtonElement>('instrument-down').disabled = !v.canDown;
    this.el<HTMLButtonElement>('instrument-up').disabled = !v.canUp;
  }

  private build(v: InstrumentPanelView): void {
    const whites = v.keys.filter((k) => !k.black).length;
    const w = 100 / whites;
    let white = 0;
    this.keys = v.keys.map((k) => {
      const b = this.button(k.code, `${k.note} (${k.label})`);
      b.className = `ikey ${k.black ? 'black' : 'white'}`;
      b.style.left = `${k.black ? white * w - w * 0.3 : white * w}%`;
      b.style.width = `${k.black ? w * 0.6 : w}%`;
      b.innerHTML = `<span></span><small></small>`;
      b.querySelector('span')!.textContent = k.label;
      b.querySelector('small')!.textContent = k.black ? '' : k.note;
      if (!k.black) white++;
      return b;
    });
    this.el('instrument-keys').replaceChildren(...this.keys);
    this.chords = v.chords.map((c) => {
      const b = this.button(c.key, `${c.label} chord (${c.key.replace('Digit', '')})`);
      b.innerHTML = `<span></span><small></small>`;
      b.querySelector('span')!.textContent = c.label;
      b.querySelector('small')!.textContent = c.key.replace('Digit', '');
      return b;
    });
    this.el('instrument-chords').replaceChildren(...this.chords);
  }

  /** A button that plays while it's held, by mouse or finger (each finger its own). */
  private button(code: string, label: string): HTMLButtonElement {
    const b = this.doc.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    let down = false;
    const up = () => {
      if (!down) return;
      down = false;
      this.h.key(code, false);
    };
    b.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      down = true;
      this.h.key(code, true);
    });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    return b;
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.doc.getElementById(id) as T;
  }
}
