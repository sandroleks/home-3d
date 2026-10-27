import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, DoubleSide, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { countWalls, loadVoice, occlusionFor, openMic, rmsOf, saveVoice, smoothTalk, talkLevel, Voices, wallCounter } from '../src/voice';

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

// Just enough of Web Audio for Voices: nodes record what they connect to, params jump straight to their target
class FakeParam {
  value = 0;
  setTargetAtTime(v: number) { this.value = v; }
}
class FakeNode {
  out: unknown[] = [];
  connect(n: unknown) { this.out.push(n); return n; }
  disconnect() { this.out = []; }
}
function fakeAudio() {
  const state = { level: 0 }; // what every analyser hears
  const nodes: FakeNode[] = [];
  const node = <T extends object>(extra: T) => {
    const n = Object.assign(new FakeNode(), extra);
    nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: 0,
    createMediaStreamSource: () => node({ kind: 'source' }),
    createAnalyser: () => node({ kind: 'analyser', fftSize: 2048, getFloatTimeDomainData: (b: Float32Array) => void b.fill(state.level) }),
    createGain: () => node({ kind: 'gain', gain: new FakeParam() }),
    createBiquadFilter: () => node({ kind: 'filter', type: '', frequency: new FakeParam() }),
    createPanner: () => node({
      kind: 'panner', panningModel: '', distanceModel: '', refDistance: 0, rolloffFactor: 0, maxDistance: 0,
      positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(),
    }),
  };
  const out = new FakeNode();
  const elements: { muted: boolean; srcObject: unknown; played: boolean }[] = [];
  const audioElement = () => {
    const e = { muted: false, srcObject: null as unknown, played: false, play: async () => { e.played = true; }, pause: () => {} };
    elements.push(e);
    return e as unknown as HTMLAudioElement;
  };
  const voices = new Voices(ctx as unknown as AudioContext, out as unknown as AudioNode, audioElement);
  const find = (kind: string) => nodes.filter((n) => (n as unknown as { kind: string }).kind === kind) as unknown as Record<string, any>[];
  return { voices, state, out, elements, find };
}
const fakeMic = () => {
  const track = { enabled: true };
  return { track, stream: { getAudioTracks: () => [track] } as unknown as MediaStream };
};

describe('Voices', () => {
  const peer = {} as MediaStream;
  const at = (x: number, z: number) => (_id: string, out: Vector3) => out.set(x, 1.2, z);
  const noWalls = () => 0;

  it('plays a peer through an analyser, a gain, a low-pass and an HRTF panner into the bus', () => {
    const { voices, out, elements, find } = fakeAudio();
    voices.add('p1', peer);
    expect(voices.ids).toEqual(['p1']);
    const [source] = find('source');
    const [gain] = find('gain');
    const [filter] = find('filter');
    const [panner] = find('panner');
    expect(source.out).toEqual([find('analyser')[0], gain]);
    expect(gain.out).toEqual([filter]);
    expect(filter.out).toEqual([panner]);
    expect(panner.out).toEqual([out]);
    expect(filter.type).toBe('lowpass');
    expect(panner).toMatchObject({ panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.5, rolloffFactor: 1.2, maxDistance: 15 });
    expect(gain.gain.value).toBe(0); // silent until its animal is placed
    expect(elements[0]).toMatchObject({ muted: true, srcObject: peer, played: true }); // Chrome only plays it into Web Audio so
  });

  it('places the voice at its animal and muffles it by the walls in between', () => {
    const { voices, find } = fakeAudio();
    voices.add('p1', peer);
    voices.update(0.016, new Vector3(), at(3, -2), () => 2);
    const [panner] = find('panner');
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([3, 1.2, -2]);
    expect(find('gain')[0].gain.value).toBe(0.25);
    expect(find('filter')[0].frequency.value).toBe(900);
  });

  it('checks the walls ten times a second, not every frame', () => {
    const { voices } = fakeAudio();
    voices.add('p1', peer);
    const walls = vi.fn(() => 0);
    for (let i = 0; i < 60; i++) voices.update(1 / 60, new Vector3(), at(1, 1), walls);
    expect(walls.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(walls.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it('stays silent while its animal has no place yet', () => {
    const { voices, find } = fakeAudio();
    voices.add('p1', peer);
    voices.update(0.016, new Vector3(), () => null, noWalls);
    expect(find('gain')[0].gain.value).toBe(0);
  });

  it('opens a mouth with a loud voice and marks it talking for a while after', () => {
    const { voices, state } = fakeAudio();
    voices.add('p1', peer);
    state.level = 0.5;
    for (let i = 0; i < 20; i++) voices.update(0.016, new Vector3(), at(1, 1), noWalls);
    expect(voices.talk('p1')).toBeGreaterThan(0.9);
    expect(voices.talking('p1')).toBe(true);
    state.level = 0;
    for (let i = 0; i < 20; i++) voices.update(0.016, new Vector3(), at(1, 1), noWalls); // 0.32 s of silence
    expect(voices.talking('p1')).toBe(true); // the mouth closed below the mark at ~0.17 s, held 0.5 s from then
    for (let i = 0; i < 40; i++) voices.update(0.016, new Vector3(), at(1, 1), noWalls); // 0.96 s
    expect(voices.talking('p1')).toBe(false);
    expect(voices.talk('p1')).toBeLessThan(0.1);
    expect(voices.talk('nobody')).toBe(0);
  });

  it('removes a peer and tears its sound down', () => {
    const { voices, elements, find } = fakeAudio();
    voices.add('p1', peer);
    voices.remove('p1');
    expect(voices.has('p1')).toBe(false);
    expect(find('source')[0].out).toEqual([]);
    expect(find('panner')[0].out).toEqual([]);
    expect(elements[0].srcObject).toBeNull();
    expect(() => voices.remove('p1')).not.toThrow();
  });

  it('replaces a peer whose stream comes again', () => {
    const { voices, find } = fakeAudio();
    voices.add('p1', peer);
    voices.add('p1', {} as MediaStream);
    expect(voices.ids).toEqual(['p1']);
    expect(find('source')[0].out).toEqual([]); // the first one is torn down
  });

  it('switches the mic on and off, and off while paused', () => {
    const { voices } = fakeAudio();
    expect(voices.micState).toBe('none');
    voices.setMicOn(false); // no mic: nothing to switch
    const { track, stream } = fakeMic();
    voices.setMic(stream);
    expect(voices.mic).toBe(stream);
    expect(voices.micState).toBe('off'); // still switched off from before
    voices.setMicOn(true);
    expect(track.enabled).toBe(true);
    expect(voices.micState).toBe('on');
    voices.setPaused(true);
    expect(track.enabled).toBe(false);
    expect(voices.micState).toBe('on'); // what it goes back to
    voices.setPaused(false);
    expect(track.enabled).toBe(true);
    voices.setMicOn(false);
    expect(track.enabled).toBe(false);
    expect(voices.micState).toBe('off');
  });
});
