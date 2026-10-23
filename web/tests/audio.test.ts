import { describe, expect, it } from 'vitest';
import {
  ambienceFor, doorSound, loadMuted, loopBounds, nextStep, saveMuted, StepTimer, type KeyValueStore,
} from '../src/audio';

const FRAME = 0.02;

/** Walks `metres` in 2 cm frames and returns the distances at which steps sounded. */
function walk(timer: StepTimer, metres: number, running = false): number[] {
  const steps: number[] = [];
  for (let i = 1; i * FRAME <= metres + 1e-9; i++) if (timer.update(FRAME, running)) steps.push(i * FRAME);
  return steps;
}

function expectNear(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((a, i) => expect(Math.abs(a - expected[i])).toBeLessThan(0.025));
}

describe('StepTimer', () => {
  it('sounds the first step soon after setting off, then once per stride', () => {
    expectNear(walk(new StepTimer(0.7, 0.9, 0.25), 2), [0.26, 0.96, 1.66]);
  });

  it('uses the longer stride when running', () => {
    expectNear(walk(new StepTimer(0.7, 0.9, 0.25), 2, true), [0.26, 1.16]);
  });

  it('starts over after standing still', () => {
    const t = new StepTimer(0.7, 0.9, 0.25);
    expectNear(walk(t, 0.5), [0.26]);
    expect(t.update(0, false)).toBe(false);
    expectNear(walk(t, 0.3), [0.26]);
  });

  it('stays silent when the player is blocked', () => {
    const t = new StepTimer(0.7, 0.9, 0.25);
    for (let i = 0; i < 200; i++) expect(t.update(0, false)).toBe(false);
  });
});

describe('ambienceFor', () => {
  it('maps rooms to their ambience and defaults to room tone', () => {
    expect(ambienceFor('varanda')).toBe('outdoor');
    expect(ambienceFor('marquise')).toBe('outdoor');
    expect(ambienceFor('cozinha')).toBe('kitchen');
    expect(ambienceFor('lavandaria')).toBe('kitchen');
    expect(ambienceFor('sala')).toBe('room');
    expect(ambienceFor(null)).toBe('room');
  });

  it('takes a custom map', () => expect(ambienceFor('sala', { sala: 'outdoor' })).toBe('outdoor'));
});

describe('doorSound', () => {
  it('sounds when a door starts opening or closing', () => {
    expect(doorSound({ target: 0, progress: 0 }, { target: 1, progress: 0.03 })).toBe('open');
    expect(doorSound({ target: 1, progress: 1 }, { target: 0, progress: 0.97 })).toBe('close');
  });

  it('latches when a closing door reaches the frame', () => {
    expect(doorSound({ target: 0, progress: 0.02 }, { target: 0, progress: 0 })).toBe('latch');
  });

  it('is quiet while a door swings or rests', () => {
    expect(doorSound({ target: 1, progress: 0.4 }, { target: 1, progress: 0.43 })).toBeNull();
    expect(doorSound({ target: 1, progress: 1 }, { target: 1, progress: 1 })).toBeNull();
    expect(doorSound({ target: 0, progress: 0 }, { target: 0, progress: 0 })).toBeNull();
  });
});

describe('nextStep', () => {
  it('never repeats the previous step and reaches every other one', () => {
    const seen = new Set<number>();
    for (let r = 0; r < 1; r += 0.01) {
      const i = nextStep(2, 5, () => r);
      expect(i).not.toBe(2);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(5);
      seen.add(i);
    }
    expect([...seen].sort()).toEqual([0, 1, 3, 4]);
  });

  it('can pick any step the first time', () => {
    expect(nextStep(-1, 5, () => 0)).toBe(0);
    expect(nextStep(-1, 5, () => 0.999)).toBe(4);
  });
});

describe('loopBounds', () => {
  it('skips silent padding at both ends', () => {
    expect(loopBounds(new Float32Array([0, 0, 0, 0.5, -0.3, 0.2, 0, 0]), 10)).toEqual([3, 6]);
  });

  it('trims at most maxTrim samples per end', () => {
    expect(loopBounds(new Float32Array([0, 0, 0, 0.5, -0.3, 0.2, 0, 0, 0]), 2)).toEqual([2, 7]);
  });
});

describe('mute persistence', () => {
  const store = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };

  it('remembers the choice', () => {
    const s = store();
    expect(loadMuted(() => s)).toBe(false);
    saveMuted(() => s, true);
    expect(s.data.get('walkthrough.muted')).toBe('1');
    expect(loadMuted(() => s)).toBe(true);
    saveMuted(() => s, false);
    expect(loadMuted(() => s)).toBe(false);
  });

  it('copes with blocked storage', () => {
    const blocked = (): KeyValueStore => { throw new Error('SecurityError'); };
    expect(loadMuted(blocked)).toBe(false);
    expect(() => saveMuted(blocked, true)).not.toThrow();
  });
});
