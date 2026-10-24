import { describe, expect, it } from 'vitest';
import {
  clockText, dateText, dateTimeText, DesktopContent, type ScreenWorld, type Surface, TV_CHANNELS, TvContent,
} from '../src/screen-content';

interface Call { name: string; args: unknown[] }

/** A surface whose 2D context accepts any call or property and records the calls. */
function recorder(width = 512, height = 288) {
  const calls: Call[] = [];
  const returned = { addColorStop() {}, width: 5 };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        return returned;
      };
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  const surface: Surface = { width, height, getContext: () => ctx as unknown as CanvasRenderingContext2D };
  const texts = () => calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
  const count = (name: string) => calls.filter((c) => c.name === name).length;
  return { surface, calls, texts, count, clear: () => (calls.length = 0) };
}

const EVENING: ScreenWorld = { hour: 21, minute: 5, day: 24, month: 10, year: 2026 };
const NOON: ScreenWorld = { hour: 12, minute: 30, day: 1, month: 7, year: 2026, temperatureC: 26.6 };
const TIMES = [0, 0.1, 0.24, 1.3, 2.6, 59.97, 3600.5];

function expectColour(c: number[]): void {
  expect(c).toHaveLength(3);
  for (const v of c) {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  }
}

describe('text helpers', () => {
  it('writes a 24 h clock with leading zeros', () => {
    expect(clockText(EVENING)).toBe('21:05');
    expect(clockText({ ...EVENING, hour: 7, minute: 3 })).toBe('07:03');
  });
  it('names the weekday and month in Portuguese', () => {
    expect(dateText(EVENING)).toBe('Sáb 24 Out');
    expect(dateText({ ...EVENING, day: 1, month: 1, year: 2026 })).toBe('Qui 1 Jan');
    expect(dateTimeText(EVENING)).toBe('Sáb 24 Out · 21:05');
  });
});

describe('TvContent', () => {
  it('has at least four channels with distinct ids', () => {
    expect(TV_CHANNELS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(TV_CHANNELS.map((c) => c.id)).size).toBe(TV_CHANNELS.length);
  });

  it('steps through the channels, refuses past the last and resets to the first', () => {
    const tv = new TvContent(recorder().surface);
    expect(tv.channel).toBe(0);
    for (let i = 1; i < TV_CHANNELS.length; i++) {
      expect(tv.next()).toBe(true);
      expect(tv.channel).toBe(i);
    }
    expect(tv.next()).toBe(false);
    expect(tv.channel).toBe(TV_CHANNELS.length - 1);
    tv.reset();
    expect(tv.channel).toBe(0);
  });

  it('draws every channel at any time of day without throwing', () => {
    const r = recorder();
    const tv = new TvContent(r.surface);
    let t = 0;
    do {
      for (const dt of TIMES) {
        r.clear();
        for (const world of [EVENING, NOON]) expect(() => tv.draw(t + dt, world)).not.toThrow();
        expect(r.count('fillRect')).toBeGreaterThan(0);
        expectColour(tv.average());
      }
      t += 4000;
    } while (tv.next());
  });

  it('shows the time and date on the weather channel, and the temperature when known', () => {
    const r = recorder();
    const tv = new TvContent(r.surface);
    tv.channel = TV_CHANNELS.findIndex((c) => c.id === 'weather');
    tv.draw(5, EVENING);
    expect(r.texts()).toContain('21:05');
    expect(r.texts()).toContain('Sáb 24 Out');
    expect(r.texts().some((s) => s.includes('°C'))).toBe(false);
    r.clear();
    tv.draw(6, NOON);
    expect(r.texts()).toContain('12:30');
    expect(r.texts()).toContain('27 °C');
  });

  it('shows the channel badge for 2.5 s after a change and a burst of static', () => {
    const r = recorder();
    const tv = new TvContent(r.surface);
    tv.draw(10, EVENING);
    expect(r.texts()).toContain(TV_CHANNELS[0].name);
    tv.next();
    r.clear();
    tv.draw(20, EVENING);
    expect(r.texts()).toContain(TV_CHANNELS[1].name);
    expect(r.texts()).toContain('2');
    const noisy = r.count('fillRect');
    r.clear();
    tv.draw(21, EVENING);
    expect(r.texts()).toContain(TV_CHANNELS[1].name);
    expect(r.count('fillRect')).toBeLessThan(noisy / 4);
    r.clear();
    tv.draw(22.6, EVENING);
    expect(r.texts()).not.toContain(TV_CHANNELS[1].name);
  });

  it('draws the same frame for the same t', () => {
    const a = recorder();
    const b = recorder();
    const ta = new TvContent(a.surface);
    const tb = new TvContent(b.surface);
    for (let i = 0; i < TV_CHANNELS.length; i++) {
      ta.draw(i * 10, EVENING);
      tb.draw(i * 10, EVENING);
      ta.draw(i * 10 + 0.1, EVENING);
      tb.draw(i * 10 + 0.1, EVENING);
      ta.next();
      tb.next();
    }
    expect(a.calls).toEqual(b.calls);
  });

  it('refreshes the average at most every 0.25 s', () => {
    const tv = new TvContent(recorder().surface);
    tv.channel = TV_CHANNELS.findIndex((c) => c.id === 'nature');
    expect(tv.average()).toEqual([0, 0, 0]);
    tv.draw(10, NOON);
    const first = tv.average();
    expectColour(first);
    tv.draw(10.2, NOON);
    expect(tv.average()).toEqual(first);
    tv.draw(40, NOON);
    expect(tv.average()).not.toEqual(first);
  });

  it('is harmless without a 2D context', () => {
    const tv = new TvContent({ width: 512, height: 288, getContext: () => null });
    expect(() => tv.draw(1, EVENING)).not.toThrow();
    expect(tv.next()).toBe(true);
    expect(() => tv.draw(2, EVENING)).not.toThrow();
    expect(tv.average()).toEqual([0, 0, 0]);
  });
});

describe('DesktopContent', () => {
  for (const [variant, w, h] of [['monitor', 512, 288], ['laptop', 384, 240]] as const) {
    it(`draws the ${variant} with the simulated clock in the bar`, () => {
      const r = recorder(w, h);
      const desk = new DesktopContent(r.surface, variant);
      for (const t of TIMES) {
        r.clear();
        expect(() => desk.draw(t, EVENING)).not.toThrow();
        expect(r.texts().some((s) => s.includes('21:05'))).toBe(true);
        expectColour(desk.average());
      }
    });
  }

  it('shows the music player and floor plan on the monitor only', () => {
    const monitor = recorder();
    new DesktopContent(monitor.surface, 'monitor').draw(3, EVENING);
    expect(monitor.texts()).toContain('Música');
    expect(monitor.texts()).toContain('Cozinha');
    const laptop = recorder(384, 240);
    new DesktopContent(laptop.surface, 'laptop').draw(3, EVENING);
    expect(laptop.texts()).not.toContain('Música');
    expect(laptop.texts()).not.toContain('Cozinha');
  });

  it('is harmless without a 2D context', () => {
    const desk = new DesktopContent({ width: 384, height: 240, getContext: () => null }, 'laptop');
    expect(() => desk.draw(1, EVENING)).not.toThrow();
    expect(desk.average()).toEqual([0, 0, 0]);
  });
});
