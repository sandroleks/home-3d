import { describe, expect, it } from 'vitest';
import { assetsFor, kitchenFrom, saveCarry, takeCarry, urlFor } from '../src/layout';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('kitchen layout', () => {
  it('reads ?kitchen=wall, and anything else is the open plan', () => {
    expect(kitchenFrom(new URLSearchParams('kitchen=wall'))).toBe('wall');
    expect(kitchenFrom(new URLSearchParams('kitchen=WALL'))).toBe('open');
    expect(kitchenFrom(new URLSearchParams(''))).toBe('open');
  });

  it('loads the wall from its own export', () => {
    expect(assetsFor('open')).toBe('assets/');
    expect(assetsFor('wall')).toBe('assets/variants/kitchen-wall/');
  });

  it('switches the query, keeping the rest', () => {
    expect(urlFor('https://x.test/?room=us', 'wall')).toBe('https://x.test/?room=us&kitchen=wall');
    expect(urlFor('https://x.test/?kitchen=wall&room=us', 'open')).toBe('https://x.test/?room=us');
  });
});

describe('carry over the reload', () => {
  it('is read once', () => {
    const s = store();
    saveCarry(() => s, { x: 1, z: 2, yaw: 0.5, pitch: -0.1, utc: 1e12, state: { 'light:sala': 1 } });
    expect(takeCarry(() => s)).toEqual({ x: 1, z: 2, yaw: 0.5, pitch: -0.1, utc: 1e12, state: { 'light:sala': 1 } });
    expect(takeCarry(() => s)).toBeNull();
  });

  it('ignores anything malformed', () => {
    const s = store();
    s.setItem('walkthrough.carry', '{"x":1}');
    expect(takeCarry(() => s)).toBeNull();
    s.setItem('walkthrough.carry', 'not json');
    expect(takeCarry(() => s)).toBeNull();
  });

  it('survives blocked storage', () => {
    const blocked = () => { throw new Error('blocked'); };
    expect(() => saveCarry(blocked, { x: 0, z: 0, yaw: 0, pitch: 0, utc: 0, state: {} })).not.toThrow();
    expect(takeCarry(blocked)).toBeNull();
  });
});
