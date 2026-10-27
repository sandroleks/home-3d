import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, DoubleSide, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { countWalls, loadVoice, occlusionFor, openMic, rmsOf, saveVoice, smoothTalk, talkLevel, wallCounter } from '../src/voice';

const store = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return { data, storage: () => ({ getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } }) };
};

describe('loadVoice and saveVoice', () => {
  it('is on unless switched off, and remembers', () => {
    const s = store();
    expect(loadVoice(s.storage)).toBe(true);
    saveVoice(s.storage, false);
    expect(s.data['walkthrough.voice']).toBe('0');
    expect(loadVoice(s.storage)).toBe(false);
    saveVoice(s.storage, true);
    expect(loadVoice(s.storage)).toBe(true);
  });
  it('is on when storage is unavailable', () => {
    const broken = () => { throw new Error('private mode'); };
    expect(loadVoice(broken)).toBe(true);
    expect(() => saveVoice(broken, false)).not.toThrow();
  });
});

describe('openMic', () => {
  it('asks for the mic with echo cancellation, noise suppression and auto gain', async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    expect(await openMic({ getUserMedia })).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  });
  it('is null when refused or unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await openMic({ getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); } })).toBeNull();
    expect(await openMic(undefined)).toBeNull();
  });
});

describe('occlusionFor', () => {
  it('muffles more with every wall, up to three', () => {
    expect(occlusionFor(0)).toEqual({ gain: 1, cutoff: 20000 });
    expect(occlusionFor(1)).toEqual({ gain: 0.5, cutoff: 1800 });
    expect(occlusionFor(2)).toEqual({ gain: 0.25, cutoff: 900 });
    expect(occlusionFor(3)).toEqual({ gain: 0.12, cutoff: 500 });
    expect(occlusionFor(7)).toEqual({ gain: 0.12, cutoff: 500 });
  });
});

describe('countWalls', () => {
  it('counts hits close together as one wall, and caps the count', () => {
    expect(countWalls([], 0.3, 3)).toBe(0);
    expect(countWalls([2.0, 2.15], 0.3, 3)).toBe(1); // both faces of one wall
    expect(countWalls([4.1, 1.0, 1.2, 4.0], 0.3, 3)).toBe(2); // any order
    expect(countWalls([1, 2, 3, 4, 5], 0.3, 3)).toBe(3);
  });
});

describe('wallCounter', () => {
  // A wall 0.2 m thick across the x axis at x = at, 4 m wide and 3 m tall
  const wall = (at: number, doubleSided = false) => {
    const m = new Mesh(new BoxGeometry(0.2, 3, 4), new MeshBasicMaterial({ side: doubleSided ? DoubleSide : undefined }));
    m.position.set(at, 1.5, 0);
    m.updateMatrixWorld();
    return m;
  };
  const ear = new Vector3(0, 1.6, 0);

  it('counts the walls between two points, once each whatever their sides', () => {
    expect(wallCounter([])(ear, new Vector3(5, 1.4, 0))).toBe(0);
    expect(wallCounter([wall(2)])(ear, new Vector3(5, 1.4, 0))).toBe(1);
    expect(wallCounter([wall(2, true)])(ear, new Vector3(5, 1.4, 0))).toBe(1);
    expect(wallCounter([wall(2), wall(4, true)])(ear, new Vector3(5, 1.4, 0))).toBe(2);
  });
  it('ignores walls beyond the speaker or off to the side', () => {
    expect(wallCounter([wall(6)])(ear, new Vector3(5, 1.4, 0))).toBe(0);
    expect(wallCounter([wall(2)])(ear, new Vector3(0, 1.4, 5))).toBe(0);
  });
  it('is zero for a speaker on top of the listener', () => {
    expect(wallCounter([wall(2)])(ear, ear.clone())).toBe(0);
  });
});

describe('talk level', () => {
  it('measures the RMS of a buffer', () => {
    expect(rmsOf(new Float32Array([0, 0, 0, 0]))).toBe(0);
    expect(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });
  it('maps loudness to 0..1 between the noise floor and a full voice', () => {
    expect(talkLevel(0.005, 0.01, 0.12)).toBe(0);
    expect(talkLevel(0.065, 0.01, 0.12)).toBeCloseTo(0.5);
    expect(talkLevel(0.5, 0.01, 0.12)).toBe(1);
  });
  it('opens fast and closes slower', () => {
    const opened = smoothTalk(0, 1, 0.03, 0.03, 0.12);
    const closed = smoothTalk(1, 0, 0.03, 0.03, 0.12);
    expect(opened).toBeCloseTo(1 - Math.exp(-1));
    expect(1 - closed).toBeLessThan(opened);
    expect(smoothTalk(0.4, 0.4, 0.016, 0.03, 0.12)).toBe(0.4);
  });
});
