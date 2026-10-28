import { describe, expect, it } from 'vitest';
import { Drunk, STEADY, viewFilter, wobbleAt } from '../src/drunk';
import { sipPose, WineBottle } from '../src/wine';
import { CONFIG } from '../src/config';

describe('getting drunk', () => {
  it('adds up sips to a most, and the effects top out at fully drunk', () => {
    const d = new Drunk({ sip: 0.25, max: 1.5, soberRate: 0.01 });
    expect(d.strength).toBe(0);
    for (let i = 0; i < 4; i++) d.sip();
    expect(d.level).toBeCloseTo(1);
    expect(d.strength).toBeCloseTo(1);
    for (let i = 0; i < 10; i++) d.sip();
    expect(d.level).toBeCloseTo(1.5);
    expect(d.strength).toBe(1);
  });
  it('wears off steadily and stops at sober', () => {
    const d = new Drunk({ sip: 0.5, max: 1.5, soberRate: 0.01 });
    d.sip();
    d.update(10);
    expect(d.level).toBeCloseTo(0.4);
    d.update(100);
    expect(d.level).toBe(0);
  });
  it('takes three minutes from fully drunk to sober as configured', () => {
    const d = new Drunk();
    d.level = 1;
    d.update(179);
    expect(d.level).toBeGreaterThan(0);
    d.update(2);
    expect(d.level).toBe(0);
  });
});

describe('blacking out', () => {
  const blackout = { sips: 10, window: 120, fade: 1, hold: 4, wake: 2 };
  it('blacks out on the eleventh sip within the window, fully drunk', () => {
    const d = new Drunk({ sip: 0.25, max: 1.5, soberRate: 0.01, blackout });
    for (let i = 0; i < 10; i++) {
      expect(d.sip()).toBe(false);
      d.update(5);
    }
    expect(d.darkness).toBe(0);
    expect(d.sip()).toBe(true);
    expect(d.level).toBe(1.5);
    expect(d.passedOut).toBe(true);
  });
  it("doesn't count sips older than the window", () => {
    const d = new Drunk({ sip: 0.25, max: 1.5, soberRate: 0.01, blackout });
    for (let i = 0; i < 30; i++) {
      expect(d.sip()).toBe(false);
      d.update(13); // ten sips span 117 s: always at most ten in two minutes
    }
  });
  it('fades to black, stays out, then comes to and can drink again', () => {
    const d = new Drunk({ sip: 0.25, max: 1.5, soberRate: 0.01, blackout });
    for (let i = 0; i < 10; i++) d.sip();
    d.sip();
    d.update(0.5);
    expect(d.darkness).toBeCloseTo(0.5);
    d.update(1);
    expect(d.darkness).toBe(1);
    expect(d.passedOut).toBe(true);
    d.update(4); // 5.5 s in: coming to
    expect(d.passedOut).toBe(false);
    expect(d.darkness).toBeCloseTo(0.75);
    d.update(2);
    expect(d.darkness).toBe(0);
    expect(d.sip()).toBe(false); // the count started over
  });
});

describe('the drunk view', () => {
  it('stays steady and sharp sober', () => {
    expect(wobbleAt(12.3, 0)).toEqual(STEADY);
    expect(viewFilter(12.3, 0)).toBe('');
  });
  it('wobbles within its amplitudes, more the drunker', () => {
    const cfg = CONFIG.wine.wobble;
    let most = 0;
    for (let t = 0; t < 60; t += 0.1) {
      const w = wobbleAt(t, 1);
      expect(Math.abs(w.roll)).toBeLessThanOrEqual(cfg.roll + 1e-9);
      expect(Math.abs(w.yaw)).toBeLessThanOrEqual(cfg.yaw + 1e-9);
      expect(Math.abs(w.pitch)).toBeLessThanOrEqual(cfg.pitch + 1e-9);
      expect(Math.abs(w.side)).toBeLessThanOrEqual(cfg.side + 1e-9);
      most = Math.max(most, Math.abs(w.roll));
      expect(Math.abs(wobbleAt(t, 0.5).roll)).toBeCloseTo(Math.abs(w.roll) / 2);
    }
    expect(most).toBeGreaterThan(cfg.roll * 0.5);
  });
  it('blurs up to the configured radius', () => {
    const px = (s: string) => Number(/blur\(([\d.]+)px\)/.exec(s)![1]);
    for (let t = 0; t < 5; t += 0.25) {
      expect(px(viewFilter(t, 1, 0, 3))).toBeLessThanOrEqual(3);
      expect(px(viewFilter(t, 1, 0, 3))).toBeGreaterThanOrEqual(2.1); // the pulse dips to 70%
    }
    expect(px(viewFilter(0, 0.5, 0, 3))).toBeLessThan(1.5);
  });
  it('darkens to black as you black out, sober or not', () => {
    expect(viewFilter(0, 0, 1)).toBe('brightness(0.000)');
    expect(viewFilter(0, 0, 0.25)).toBe('brightness(0.750)');
    expect(viewFilter(0, 1, 0.5)).toMatch(/^blur\([\d.]+px\) brightness\(0\.500\)$/);
  });
});

describe('the wine bottle', () => {
  it('lifts and tips over a sip and stands back down', () => {
    expect(sipPose(0)).toEqual({ lift: 0, tip: 0 });
    expect(sipPose(1)).toEqual({ lift: 0, tip: 0 });
    const mid = sipPose(0.5);
    expect(mid.lift).toBeGreaterThan(0.05);
    expect(mid.tip).toBeGreaterThan(0.5);
  });
  it('stands on the kitchen counter and is its own target', () => {
    const w = new WineBottle(null);
    expect(w.root.position.toArray()).toEqual([CONFIG.wine.at[0], CONFIG.wine.counterTop, CONFIG.wine.at[1]]);
    expect(w.target).toEqual({ kind: 'wine', node: w.root });
    w.sip(0, 4.3); // from the island, toward +x
    w.update(0.5, 1, false);
    let tipped = false;
    w.root.traverse((o) => { if (o.rotation.x > 0.5) tipped = true; });
    expect(tipped).toBe(true);
    w.update(1, 1, false);
    w.root.traverse((o) => expect(o.rotation.x).toBe(0));
  });
});
