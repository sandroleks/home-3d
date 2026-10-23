import { CONFIG } from './config';
import { STILL, type Stick } from './player';

/** The stick's push for a finger `dx`, `dy` CSS px from where it went down (screen y points down). */
export function stickFrom(dx: number, dy: number, radius = CONFIG.touch.stickRadius): Stick {
  const { deadZone, runPush } = CONFIG.touch;
  const d = Math.hypot(dx, dy);
  const dead = deadZone * radius;
  if (d <= dead) return STILL;
  const push = Math.min(1, (d - dead) / (radius - dead));
  return { forward: (-dy / d) * push, right: (dx / d) * push, run: d > radius * runPush };
}

/** A touch that barely moved and lifted quickly. */
export function isTap(moved: number, ms: number): boolean {
  return moved < CONFIG.touch.tapSlop && ms < CONFIG.touch.tapTime;
}

export interface TouchHandlers {
  stick(s: Stick): void;
  /** CSS px dragged since the last call. */
  look(dx: number, dy: number): void;
  tap(clientX: number, clientY: number): void;
}

interface Finger { role: 'stick' | 'look'; x0: number; y0: number; x: number; y: number; t0: number; moved: number }

/**
 * One finger on the left of `surface` walks with a stick that appears under it; one on the right drags the view.
 * Both work at once. A quick touch that doesn't move is a tap, wherever it lands.
 */
export class TouchControls {
  private fingers = new Map<number, Finger>();

  constructor(private surface: HTMLElement, private ring: HTMLElement, private knob: HTMLElement, private h: TouchHandlers) {
    const r = CONFIG.touch.stickRadius;
    Object.assign(ring.style, { width: `${2 * r}px`, height: `${2 * r}px`, margin: `${-r}px 0 0 ${-r}px` });
    ring.hidden = true;
    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.move(e));
    surface.addEventListener('pointerup', (e) => this.up(e, true));
    surface.addEventListener('pointercancel', (e) => this.up(e, false));
  }

  /** Lets go of every finger (pausing, or the page going to the background). */
  reset(): void {
    this.fingers.clear();
    this.ring.hidden = true;
    this.h.stick(STILL);
  }

  private has(role: Finger['role']): boolean {
    for (const f of this.fingers.values()) if (f.role === role) return true;
    return false;
  }

  private down(e: PointerEvent): void {
    e.preventDefault(); // no emulated mouse events after a tap, no text selection or callout
    const left = e.clientX < this.surface.clientWidth * CONFIG.touch.stickArea;
    const role = left && !this.has('stick') ? 'stick' : this.has('look') ? null : 'look';
    if (!role) return; // a third finger, or a second on the same side
    this.surface.setPointerCapture?.(e.pointerId);
    this.fingers.set(e.pointerId, { role, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, moved: 0 });
    if (role === 'stick') {
      this.ring.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = '';
      this.ring.classList.remove('run');
      this.ring.hidden = false;
    }
  }

  private move(e: PointerEvent): void {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    const dx = e.clientX - f.x;
    const dy = e.clientY - f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    const ox = f.x - f.x0;
    const oy = f.y - f.y0;
    f.moved = Math.max(f.moved, Math.hypot(ox, oy));
    if (f.role === 'look') return this.h.look(dx, dy);
    const s = stickFrom(ox, oy);
    this.h.stick(s);
    const r = CONFIG.touch.stickRadius;
    const k = Math.min(1, r / Math.max(1e-6, Math.hypot(ox, oy))); // the knob stops at the ring
    this.knob.style.transform = `translate(${ox * k}px, ${oy * k}px)`;
    this.ring.classList.toggle('run', s.run);
  }

  private up(e: PointerEvent, lifted: boolean): void {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    if (f.role === 'stick') {
      this.ring.hidden = true;
      this.h.stick(STILL);
    }
    if (lifted && isTap(f.moved, e.timeStamp - f.t0)) this.h.tap(e.clientX, e.clientY);
  }
}
