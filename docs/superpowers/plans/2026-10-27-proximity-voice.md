# Proximity Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visitors in the walkthrough talk with their voices. Each voice comes from its animal's head, fades with distance, is muffled by walls and closed doors, and opens the animal's mouth.

**Architecture:** Trystero carries each visitor's mic to every peer as a WebRTC media stream, beside the existing data channels. A new `Voices` class (`web/src/voice.ts`) puts each incoming stream through Web Audio: a gain and a low-pass for walls, then an HRTF panner at the animal's mouth, into a bus under `Sound`'s master. Ten times a second per voice, a ray against `world.occluders` counts the walls in between. An analyser on each voice drives the animal's mouth.

**Tech Stack:** TypeScript, three.js 0.170 (Raycaster, Object3D), Web Audio API, Trystero 0.26 (`addStream`, `onPeerStream`), Vitest 5 (node environment, no DOM).

**Spec:** `docs/superpowers/specs/2026-10-27-proximity-voice-design.md`

## Global Constraints

- All commands run from `web/`: tests `npx vitest run <file>`, the full suite `npx vitest run`, types and build `npm run build` (runs `tsc --noEmit` first).
- No new dependencies. Trystero stays at exact version `0.26.0`.
- Code style: match the surrounding files. Two-space indent, single quotes, semicolons, lines up to about 150 characters, a `/** … */` doc comment on each exported function or class, comments in plain sentences.
- Voice never runs with `?autostart` or `?solo`.
- `localStorage` key for the checkbox: `walkthrough.voice` (`'1'` ticked, `'0'` unticked; unset means ticked).
- Mic constraints: `{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }`.
- Panner: HRTF, `distanceModel` `'inverse'`, `refDistance` 1.5, `rolloffFactor` 1.2, `maxDistance` 15.
- Walls table (gain, low-pass cutoff in Hz) for 0, 1, 2 and 3+ walls: `[1, 20000]`, `[0.5, 1800]`, `[0.25, 900]`, `[0.12, 500]`. Hits within 0.3 m of each other count as one wall.
- Occlusion: 10 checks a second per voice, changes ramp over 0.15 s.
- Talk level: noise floor RMS 0.01, full RMS 0.12, rise 0.03 s, fall 0.12 s, shown above 0.25, held for 0.5 s. Nod up to 0.06 rad.
- Copy: checkbox "Talk with your voice"; controls list "mic on or off" next to `V`.
- Occluders are `world.occluders`, the sun's shadow casters: walls, doors, furniture, everything except glass. Voices pass through glass unmuffled. That's accepted, and the spec says so.

---

## File Structure

- `web/src/voice.ts` (create): voice settings storage, opening the mic, the occlusion and talk-level math, the wall counter, and the `Voices` class.
- `web/tests/voice.test.ts` (create): tests for all of the above, using a fake audio context.
- `web/src/config.ts` (modify): `CONFIG.multiplayer.voice`.
- `web/src/sound.ts` (modify): the audio context and a voice bus for `Voices`.
- `web/src/presence.ts` (modify): `Peers.list()`. `web/tests/presence.test.ts` gets its test.
- `web/src/multiplayer.ts` (modify): `Room.addStream` and `Room.onPeerStream`, the `VoiceLink` interface, `Multiplayer.setVoice`, `shareMic` and `people`. `web/tests/multiplayer.test.ts` gets its tests.
- `web/src/creatures.ts` (modify): `Creature.mouth`, an open mouth on each animal, `FACE_COLOURS.mouth`. `web/tests/creatures.test.ts` gets its test.
- `web/src/avatars.ts` (modify): `Figure.talk`, `setTalk`, `mouth()`, the mouth opening and the nod. `web/tests/avatars.test.ts` gets its tests.
- `web/index.html`, `web/src/ui.ts`, `web/src/style.css` (modify): the checkbox, the HUD mic mark, the touch mic button, the controls lists, the speaking mark in the "With …" line.
- `web/src/main.ts` (modify): wiring.
- `README.md`, `docs/superpowers/specs/2026-10-25-multiplayer-design.md`, `docs/superpowers/specs/2026-10-27-proximity-voice-design.md` (modify): docs.

---

### Task 1: Voice config and pure helpers

**Files:**
- Modify: `web/src/config.ts` (inside `multiplayer`, after the `creature` block's closing `},`)
- Create: `web/src/voice.ts`
- Test: `web/tests/voice.test.ts`

**Interfaces:**
- Produces:
  - `CONFIG.multiplayer.voice` with `level`, `refDistance`, `rolloff`, `maxDistance`, `occlusionRate`, `occlusionFade`, `mergeHits`, `walls: [number, number][]`, `talk: { floor, full, rise, fall, shown, hold }`, `nod`.
  - `loadVoice(storage: () => KeyValueStore): boolean`
  - `saveVoice(storage: () => KeyValueStore, on: boolean): void`
  - `openMic(media: Pick<MediaDevices, 'getUserMedia'> | undefined): Promise<MediaStream | null>`
  - `occlusionFor(walls: number, table?: [number, number][]): { gain: number; cutoff: number }`
  - `countWalls(distances: number[], merge: number, cap: number): number`
  - `rmsOf(samples: Float32Array): number`
  - `talkLevel(rms: number, floor: number, full: number): number`
  - `smoothTalk(prev: number, next: number, dt: number, rise: number, fall: number): number`

- [ ] **Step 1: Add the config**

In `web/src/config.ts`, inside `multiplayer: { … }`, after the closing `},` of `creature: { … }`, add:

```ts
    /** Proximity voice (voice.ts): how voices fall off with distance, how walls muffle them, and how a voice opens
     * its animal's mouth. */
    voice: {
      /** The voices' bus, against the other sounds. */
      level: 1,
      /** Metres within which a voice is at full level, how fast it falls off beyond, and where it stops falling. */
      refDistance: 1.5,
      rolloff: 1.2,
      maxDistance: 15,
      /** Wall checks per second per voice, and seconds a change in walls takes to fade in. */
      occlusionRate: 10,
      occlusionFade: 0.15,
      /** Metres within which hits along the ray count as one wall (both faces of it). */
      mergeHits: 0.3,
      /** Gain and low-pass cutoff (Hz) for 0, 1, 2 and 3 or more walls or closed doors in the way. */
      walls: [[1, 20000], [0.5, 1800], [0.25, 900], [0.12, 500]] as [number, number][],
      /** A voice's loudness as a mouth: the RMS of silence and of a full voice, seconds to open and to close, and the
       * level above which the "With …" line marks them talking, held for `hold` seconds. */
      talk: { floor: 0.01, full: 0.12, rise: 0.03, fall: 0.12, shown: 0.25, hold: 0.5 },
      /** Radians the body nods forward at full voice. */
      nod: 0.06,
    },
```

- [ ] **Step 2: Write the failing tests**

Create `web/tests/voice.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { countWalls, loadVoice, occlusionFor, openMic, rmsOf, saveVoice, smoothTalk, talkLevel } from '../src/voice';

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
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run tests/voice.test.ts`
Expected: FAIL, with "Failed to resolve import '../src/voice'".

- [ ] **Step 4: Write the helpers**

Create `web/src/voice.ts`:

```ts
import type { KeyValueStore } from './audio';
import { CONFIG } from './config';

const VOICE_KEY = 'walkthrough.voice';

/** Whether the visitor talks with their voice: on unless they switched it off on the start screen. */
export function loadVoice(storage: () => KeyValueStore): boolean {
  try {
    return storage().getItem(VOICE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveVoice(storage: () => KeyValueStore, on: boolean): void {
  try {
    storage().setItem(VOICE_KEY, on ? '1' : '0');
  } catch {
    // private browsing: not remembered
  }
}

/** The mic, cleaned up for talking; null when refused, missing, or on a page without mic access (not HTTPS). */
export async function openMic(media: Pick<MediaDevices, 'getUserMedia'> | undefined): Promise<MediaStream | null> {
  if (!media) {
    console.warn('No mic access on this page; listening only.');
    return null;
  }
  try {
    return await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    console.warn('No mic; listening only.', err);
    return null;
  }
}

/** How walls in the way muffle a voice: its gain and its low-pass cutoff (Hz). */
export function occlusionFor(walls: number, table: [number, number][] = CONFIG.multiplayer.voice.walls): { gain: number; cutoff: number } {
  const [gain, cutoff] = table[Math.max(0, Math.min(table.length - 1, Math.floor(walls)))];
  return { gain, cutoff };
}

/** Walls along a ray from its hits' distances: hits within `merge` metres of each other are one wall. */
export function countWalls(distances: number[], merge: number, cap: number): number {
  let walls = 0;
  let last = -Infinity;
  for (const d of [...distances].sort((a, b) => a - b)) {
    if (d - last > merge) walls++;
    last = d;
  }
  return Math.min(cap, walls);
}

export function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** A voice's loudness as 0..1: silent at the noise floor, full at a full voice. */
export function talkLevel(rms: number, floor: number, full: number): number {
  return Math.max(0, Math.min(1, (rms - floor) / (full - floor)));
}

/** Eases a mouth toward a new level: `rise` seconds to open, `fall` to close. */
export function smoothTalk(prev: number, next: number, dt: number, rise: number, fall: number): number {
  return prev + (next - prev) * (1 - Math.exp(-dt / (next > prev ? rise : fall)));
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/voice.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/voice.ts tests/voice.test.ts
git commit -m "Voice: config, mic and the occlusion and talk-level math

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Wall counter

**Files:**
- Modify: `web/src/voice.ts`
- Test: `web/tests/voice.test.ts`

**Interfaces:**
- Consumes: `countWalls`, `CONFIG.multiplayer.voice` (Task 1).
- Produces: `wallCounter(occluders: Object3D[], cfg?: typeof CONFIG.multiplayer.voice): (from: Vector3, to: Vector3) => number`. Main passes `world.occluders` (a `Mesh[]` of every shadow caster, already flattened, with BVH bounds trees).

- [ ] **Step 1: Write the failing test**

Add to the top of `web/tests/voice.test.ts`:

```ts
import { BoxGeometry, DoubleSide, Mesh, MeshBasicMaterial, Vector3 } from 'three';
```

Add `wallCounter` to the `../src/voice` import, then add:

```ts
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
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/voice.test.ts -t wallCounter`
Expected: FAIL, with "wallCounter is not a function" or a missing export error.

- [ ] **Step 3: Write the wall counter**

In `web/src/voice.ts`, add at the top:

```ts
import { type Object3D, Raycaster, Vector3 } from 'three';
```

and after `countWalls`:

```ts
/**
 * Counts the walls and closed doors between two points (a listener's ear and a speaker's mouth) with a ray against the
 * occluders. A door's mesh turns as it opens, so an open door is out of the way without any door logic.
 */
export function wallCounter(occluders: Object3D[], cfg = CONFIG.multiplayer.voice): (from: Vector3, to: Vector3) => number {
  const ray = new Raycaster();
  const dir = new Vector3();
  return (from, to) => {
    dir.subVectors(to, from);
    const far = dir.length();
    if (far < 1e-3) return 0;
    ray.set(from, dir.divideScalar(far));
    ray.far = far;
    const hits = ray.intersectObjects(occluders, false).map((h) => h.distance);
    return countWalls(hits, cfg.mergeHits, cfg.walls.length - 1);
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tests/voice.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice.ts tests/voice.test.ts
git commit -m "Voice: count the walls between a listener and a speaker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The `Voices` class and the voice bus

**Files:**
- Modify: `web/src/voice.ts`
- Modify: `web/src/sound.ts` (add two members to `Sound`, after `setPaused`)
- Test: `web/tests/voice.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:
  - `type MicState = 'on' | 'off' | 'none'`
  - `class Voices`:
    - `constructor(ctx: AudioContext, out: AudioNode, audioElement?: (() => HTMLAudioElement) | null, cfg?)`
    - `mic: MediaStream | null` (getter), `setMic(stream: MediaStream | null)`, `micState: MicState` (getter), `setMicOn(on: boolean)`, `setPaused(paused: boolean)`
    - `ids: string[]` (getter), `has(id)`, `add(id: string, stream: MediaStream)`, `remove(id: string)`
    - `talk(id): number`, `talking(id): boolean`
    - `update(dt: number, ear: Vector3, head: (id: string, out: Vector3) => Vector3 | null, walls: (from: Vector3, to: Vector3) => number)`
  - `Sound.context: AudioContext` (getter) and `Sound.voiceOutput(level: number): GainNode`.
  - `Voices` satisfies Task 4's `VoiceLink` (`mic`, `add`, `remove`).

- [ ] **Step 1: Write the failing tests**

Add `Voices` to the `../src/voice` import in `web/tests/voice.test.ts`, then add:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/voice.test.ts -t Voices`
Expected: FAIL, with "Voices is not a constructor" or a missing export error.

- [ ] **Step 3: Write `Voices`**

Append to `web/src/voice.ts`:

```ts
/** The local mic: sending, switched off (sending silence), or none (listening only). */
export type MicState = 'on' | 'off' | 'none';

interface Voice {
  source: AudioNode;
  analyser: AnalyserNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: PannerNode;
  /** Chrome only feeds a remote WebRTC stream into Web Audio while it also plays in a media element. */
  element: HTMLAudioElement | null;
  samples: Float32Array;
  /** How open its animal's mouth is, 0..1. */
  talk: number;
  /** When it was last loud enough to show as talking (seconds of this Voices' time). */
  loudAt: number;
  nextCheck: number;
}

/**
 * The other visitors' voices, and the local mic. Each voice plays from its animal's mouth through an HRTF panner,
 * quieter with distance, and walls and closed doors in between lower and muffle it. Its loudness opens the mouth.
 */
export class Voices {
  private voices = new Map<string, Voice>();
  private stream: MediaStream | null = null;
  private wanted = true;
  private paused = false;
  private time = 0;
  private mouth = new Vector3();

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
    private audioElement: (() => HTMLAudioElement) | null = typeof document === 'undefined' ? null : () => document.createElement('audio'),
    private cfg = CONFIG.multiplayer.voice,
  ) {}

  get mic(): MediaStream | null {
    return this.stream;
  }

  setMic(stream: MediaStream | null): void {
    this.stream = stream;
    this.applyMic();
  }

  get micState(): MicState {
    return !this.stream ? 'none' : this.wanted ? 'on' : 'off';
  }

  /** V: off sends silence, so nothing reconnects and on is instant. */
  setMicOn(on: boolean): void {
    this.wanted = on;
    this.applyMic();
  }

  /** Paused, the mic is off; resuming brings back whatever it was. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyMic();
  }

  private applyMic(): void {
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = this.wanted && !this.paused;
  }

  get ids(): string[] {
    return [...this.voices.keys()];
  }

  has(id: string): boolean {
    return this.voices.has(id);
  }

  add(id: string, stream: MediaStream): void {
    this.remove(id); // a peer's new stream replaces its old one
    const element = this.audioElement?.() ?? null;
    if (element) {
      element.muted = true;
      element.srcObject = stream;
      void element.play().catch(() => {});
    }
    const source = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    const gain = this.ctx.createGain();
    gain.gain.value = 0; // silent until its animal is placed
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.cfg.walls[0][1];
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = this.cfg.refDistance;
    panner.rolloffFactor = this.cfg.rolloff;
    panner.maxDistance = this.cfg.maxDistance;
    source.connect(analyser);
    source.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(this.out);
    this.voices.set(id, {
      source, analyser, gain, filter, panner, element, samples: new Float32Array(analyser.fftSize), talk: 0, loudAt: -Infinity,
      nextCheck: this.time,
    });
  }

  remove(id: string): void {
    const v = this.voices.get(id);
    if (!v) return;
    this.voices.delete(id);
    v.source.disconnect();
    v.panner.disconnect();
    if (v.element) {
      v.element.pause();
      v.element.srcObject = null;
    }
  }

  /** How open a peer's mouth is, 0..1. */
  talk(id: string): number {
    return this.voices.get(id)?.talk ?? 0;
  }

  /** Whether to mark a peer as talking: loud recently, so the mark doesn't flicker between words. */
  talking(id: string): boolean {
    const v = this.voices.get(id);
    return !!v && this.time - v.loudAt < this.cfg.talk.hold;
  }

  /**
   * Every frame: each voice's loudness, its place at its animal's mouth (`head`; null while it has no pose), and now
   * and then the walls between it and the listener's ear.
   */
  update(dt: number, ear: Vector3, head: (id: string, out: Vector3) => Vector3 | null, walls: (from: Vector3, to: Vector3) => number): void {
    this.time += dt;
    const { talk, occlusionRate, occlusionFade } = this.cfg;
    const now = this.ctx.currentTime;
    for (const [id, v] of this.voices) {
      v.analyser.getFloatTimeDomainData(v.samples);
      v.talk = smoothTalk(v.talk, talkLevel(rmsOf(v.samples), talk.floor, talk.full), dt, talk.rise, talk.fall);
      if (v.talk > talk.shown) v.loudAt = this.time;
      const at = head(id, this.mouth);
      if (!at) continue;
      v.panner.positionX.value = at.x;
      v.panner.positionY.value = at.y;
      v.panner.positionZ.value = at.z;
      if (this.time < v.nextCheck) continue;
      v.nextCheck = this.time + 1 / occlusionRate;
      const o = occlusionFor(walls(ear, at), this.cfg.walls);
      // setTargetAtTime's time constant: about 95% of the way there after `occlusionFade`
      v.gain.gain.setTargetAtTime(o.gain, now, occlusionFade / 3);
      v.filter.frequency.setTargetAtTime(o.cutoff, now, occlusionFade / 3);
    }
  }
}
```

- [ ] **Step 4: Give `Sound` a voice bus**

In `web/src/sound.ts`, after `setPaused(…) { … }`, add:

```ts
  /** The audio context, for the voices. */
  get context(): AudioContext {
    return this.ctx;
  }

  /** A bus for the voices into the master, so mute and pause silence them too. */
  voiceOutput(level: number): GainNode {
    return this.bus(level, this.listener.getInput());
  }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/voice.test.ts && npx tsc --noEmit`
Expected: PASS (20 tests), and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/voice.ts src/sound.ts tests/voice.test.ts
git commit -m "Voice: Voices plays each peer from its animal, muffled by walls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Streams through the room and `Multiplayer`

**Files:**
- Modify: `web/src/presence.ts` (`Peers`, after `names()`)
- Modify: `web/src/multiplayer.ts`
- Test: `web/tests/presence.test.ts`, `web/tests/multiplayer.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. `VoiceLink` is structural, so `Voices` (Task 3) fits it.
- Produces:
  - `Peers.list(fallback?: string): { id: string; name: string }[]`
  - `Room.addStream(stream: MediaStream, to?: string): void`
  - `Room.onPeerStream(cb: (stream: MediaStream, peerId: string) => void): void`
  - `interface VoiceLink { readonly mic: MediaStream | null; add(peerId: string, stream: MediaStream): void; remove(peerId: string): void }`
  - `Multiplayer.setVoice(voice: VoiceLink): void`, `Multiplayer.shareMic(): void`, `Multiplayer.people: { id: string; name: string }[]` (getter)

- [ ] **Step 1: Write the failing `Peers.list` test**

In `web/tests/presence.test.ts`, inside the existing `describe('Peers', …)` block (or as a new `describe('Peers.list', …)` if there is none), add:

```ts
  it('lists ids with names, the default until a hello', () => {
    const p = new Peers(15);
    p.seen('a', 0);
    p.hello('b', 'Rui', 100, 0);
    expect(p.list()).toEqual([{ id: 'a', name: 'Guest' }, { id: 'b', name: 'Rui' }]);
  });
```

Make sure `Peers` is in that file's import from `../src/presence`.

- [ ] **Step 2: Write the failing `Multiplayer` tests**

In `web/tests/multiplayer.test.ts`, extend `fakeRoom()` so it records streams and can deliver them. Replace the `room` object and the returned object with:

```ts
  const streams: { stream: MediaStream; to?: string }[] = [];
  let streamHandler: (stream: MediaStream, peerId: string) => void = () => {};
  const room: Room = {
    selfId: 'me',
    send: (kind, data, to) => void sent.push({ kind, data, ...(to ? { to } : {}) }),
    onMessage: (kind, h) => void handlers.set(kind, h),
    onPeerJoin: (cb) => { join = cb; },
    onPeerLeave: (cb) => { leave = cb; },
    addStream: (stream, to) => void streams.push({ stream, ...(to ? { to } : {}) }),
    onPeerStream: (cb) => { streamHandler = cb; },
    leave: () => { left = true; },
  };
  return {
    room, sent, streams,
    join: (id: string) => join(id),
    leave: (id: string) => leave(id),
    receive: (kind: MessageKind, data: unknown, from: string) => handlers.get(kind)!(data, from),
    stream: (stream: MediaStream, from: string) => streamHandler(stream, from),
    get left() { return left; },
  };
```

Then add these tests inside `describe('Multiplayer', …)`:

```ts
  const voiceLink = (mic: MediaStream | null) => {
    const added: [string, MediaStream][] = [];
    const removed: string[] = [];
    return { mic, added, removed, add: (id: string, s: MediaStream) => void added.push([id, s]), remove: (id: string) => void removed.push(id) };
  };

  it('sends the mic to everyone, and to each peer who joins later', () => {
    const { fake, mp } = setup();
    const mic = {} as MediaStream;
    mp.setVoice(voiceLink(mic));
    expect(fake.streams).toEqual([{ stream: mic }]);
    fake.join('p1');
    expect(fake.streams.at(-1)).toEqual({ stream: mic, to: 'p1' });
    mp.shareMic(); // already shared: not again
    expect(fake.streams).toHaveLength(2);
  });

  it('shares the mic once it arrives after joining', () => {
    const { fake, mp } = setup();
    const link = voiceLink(null);
    mp.setVoice(link);
    expect(fake.streams).toEqual([]);
    const mic = {} as MediaStream;
    link.mic = mic;
    mp.shareMic();
    expect(fake.streams).toEqual([{ stream: mic }]);
  });

  it('listening only, sends nothing but still hears', () => {
    const { fake, mp, avatars } = setup();
    const link = voiceLink(null);
    mp.setVoice(link);
    fake.join('p1');
    expect(fake.streams).toEqual([]);
    const voice = {} as MediaStream;
    fake.stream(voice, 'p2');
    expect(link.added).toEqual([['p2', voice]]);
    expect(avatars.has('p2')).toBe(true); // a stream counts as a sign of life, like any message
  });

  it("drops a peer's voice when it leaves or goes silent", () => {
    const { fake, mp, setNow } = setup();
    const link = voiceLink(null);
    mp.setVoice(link);
    fake.stream({} as MediaStream, 'p1');
    fake.leave('p1');
    expect(link.removed).toEqual(['p1']);
    fake.stream({} as MediaStream, 'p2');
    setNow(100);
    mp.tick();
    expect(link.removed).toEqual(['p1', 'p2']);
  });

  it('lists the people here with their ids', () => {
    const { fake, mp } = setup();
    fake.join('p1');
    fake.receive('hello', { name: 'Rui', since: 2000 }, 'p1');
    expect(mp.people).toEqual([{ id: 'p1', name: 'Rui' }]);
  });
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run tests/presence.test.ts tests/multiplayer.test.ts`
Expected: FAIL, with "p.list is not a function" and "mp.setVoice is not a function" (plus type errors in the fake room, which vitest does not check).

- [ ] **Step 4: Add `Peers.list`**

In `web/src/presence.ts`, after `names(…) { … }` in `class Peers`, add:

```ts
  /** Ids and names, in join order, for showing who is talking. */
  list(fallback = CONFIG.multiplayer.defaultName): { id: string; name: string }[] {
    return [...this.table].map(([id, p]) => ({ id, name: p.name ?? fallback }));
  }
```

- [ ] **Step 5: Add streams to `Room` and voices to `Multiplayer`**

In `web/src/multiplayer.ts`:

1. Extend the `Room` interface. After `onPeerLeave(…): void;` add:

```ts
  /** Media (the mic) to one peer, or to everyone here now. */
  addStream(stream: MediaStream, to?: string): void;
  onPeerStream(cb: (stream: MediaStream, peerId: string) => void): void;
```

2. In `trysteroRoom`, after the `onPeerLeave` line, add:

```ts
    addStream: (stream, to) => void Promise.all(room.addStream(stream, to ? { target: to } : undefined)).catch(() => {}),
    onPeerStream: (cb) => { room.onPeerStream = (stream, peerId) => cb(stream, peerId); },
```

3. After the `Hello` type guard, add:

```ts
/** What multiplayer needs from the voices: the mic to send (null when listening only) and where peers' voices go. */
export interface VoiceLink {
  readonly mic: MediaStream | null;
  add(peerId: string, stream: MediaStream): void;
  remove(peerId: string): void;
}
```

4. In `class Multiplayer`, add two fields after `private lastPose: Pose | null = null;`:

```ts
  private voice: VoiceLink | null = null;
  private sharedMic: MediaStream | null = null;
```

5. In the constructor, change the `onPeerJoin` handler to also send the mic:

```ts
    room.onPeerJoin((id) => {
      this.arrive(id);
      room.send('hello', { name, since: this.since }, id);
      if (this.sharedMic) room.addStream(this.sharedMic, id); // Trystero only sends a stream to the peers here when it's added
    });
```

and after `room.onPeerLeave((id) => this.depart(id));` add:

```ts
    room.onPeerStream((stream, id) => {
      this.arrive(id);
      this.voice?.add(id, stream);
    });
```

6. In `depart`, after `this.avatars.remove(id);`, add `this.voice?.remove(id);`.

7. In `tick`, change the loop to:

```ts
    for (const id of gone) {
      this.avatars.remove(id);
      this.voice?.remove(id);
    }
```

8. After `get names()`, add:

```ts
  /** Ids and names of the others here, for marking who is talking. */
  get people(): { id: string; name: string }[] {
    return this.peers.list();
  }

  /** The voices: incoming streams go to them, and their mic goes to everyone. */
  setVoice(voice: VoiceLink): void {
    this.voice = voice;
    this.shareMic();
  }

  /** Sends the mic to everyone here, once it's there; later peers get it as they join. */
  shareMic(): void {
    const mic = this.voice?.mic ?? null;
    if (!mic || mic === this.sharedMic) return;
    this.sharedMic = mic;
    this.room.addStream(mic);
  }
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tests/presence.test.ts tests/multiplayer.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/presence.ts src/multiplayer.ts tests/presence.test.ts tests/multiplayer.test.ts
git commit -m "Voice: send the mic to every peer and hand their voices to Voices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Talking animals

**Files:**
- Modify: `web/src/creatures.ts`
- Modify: `web/src/avatars.ts`
- Test: `web/tests/creatures.test.ts`, `web/tests/avatars.test.ts`

**Interfaces:**
- Consumes: `CONFIG.multiplayer.voice.nod` (Task 1).
- Produces:
  - `Creature.mouth: { node: Object3D; rest: number; open: number }` (the node's `scale.y` runs from `rest` to `open`)
  - `FACE_COLOURS.mouth`
  - `Figure.talk: number`, `Avatars.setTalk(id: string, level: number): void`, `Avatars.mouth(id: string, out: Vector3): Vector3 | null`

- [ ] **Step 1: Write the failing tests**

In `web/tests/creatures.test.ts`, inside `describe('buildCreature', …)`, add (`SPECIES` and `buildCreature` are already imported there; add any that aren't):

```ts
  it('gives every animal a mouth that opens: hidden at rest, except the bunny's little open one', () => {
    for (const species of SPECIES) {
      const { mouth } = buildCreature(species, '#a9d4f5');
      expect(mouth.open).toBeGreaterThan(mouth.rest);
      expect(mouth.node.scale.y).toBeCloseTo(mouth.rest);
      expect(mouth.node.visible).toBe(species === 'bunny');
    }
  });
```

In `web/tests/avatars.test.ts`, add `Vector3` to the `three` import, and inside `describe('Avatars', …)` add:

```ts
  it('opens its mouth and nods as its visitor talks', () => {
    const a = new Avatars(null);
    const f = a.add('p1', '#ff0000', 'Ana', 'fox');
    a.setPose('p1', [0, 0, 0, 0]);
    a.update(0.016);
    const tilt = f.creature.body.rotation.x;
    expect(f.creature.mouth.node.visible).toBe(false);
    a.setTalk('p1', 1);
    a.update(0.016);
    expect(f.creature.mouth.node.visible).toBe(true);
    expect(f.creature.mouth.node.scale.y).toBeCloseTo(f.creature.mouth.open);
    expect(f.creature.body.rotation.x).toBeCloseTo(tilt + 0.06);
    a.setTalk('p1', 0);
    a.update(0.016);
    expect(f.creature.mouth.node.visible).toBe(false);
    a.setTalk('nobody', 1); // no figure: nothing happens
  });

  it("gives a voice's place: its animal's mouth, once it has a pose", () => {
    const a = new Avatars(null);
    a.add('p1', '#ff0000', 'Ana', 'bear');
    const out = new Vector3();
    expect(a.mouth('p1', out)).toBeNull(); // no pose yet
    a.setPose('p1', [2, -3, 0, 0]);
    const m = a.mouth('p1', out)!;
    expect(m).toBe(out);
    expect(m.x).toBeCloseTo(2, 0);
    expect(m.z).toBeLessThan(-3); // on its front: figures face -z
    expect(m.y).toBeGreaterThan(0.5);
    expect(m.y).toBeLessThan(1.6);
    expect(a.mouth('nobody', out)).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/creatures.test.ts tests/avatars.test.ts`
Expected: FAIL, with "Cannot read properties of undefined (reading 'open')" and "a.setTalk is not a function".

- [ ] **Step 3: Give the creatures mouths**

In `web/src/creatures.ts`:

1. Add to `Creature`, after `tints: Tint[];`:

```ts
  /** The open mouth: its `scale.y` runs from `rest` (0 for a closed smile, hidden) to `open` as its visitor talks. */
  mouth: { node: Object3D; rest: number; open: number };
```

2. Add to `FACE_COLOURS`, after `tongue`:

```ts
  mouth: '#5a2630',
```

3. After the `smile` function, add:

```ts
/** A dark open mouth below a smile's line, flat and hidden until its visitor talks. */
function openMouth(face: Object3D, material: MeshMatcapMaterial, y: number, width: number, open: number): Creature['mouth'] {
  const m = onFace(blob(material, [width, open, 0.008]), 0, y, 0.001);
  m.scale.y = 0;
  m.visible = false;
  face.add(m);
  return { node: m, rest: 0, open };
}
```

4. In `buildCreature`, declare `let mouth: Creature['mouth'];` before `if (species === 'reindeer') {`, then:
   - reindeer: after `smile(face, geo.smile, inkM, -0.05);` add `mouth = openMouth(face, material(FACE_COLOURS.mouth), -0.077, 0.034, 0.026);`
   - bear: after `smile(face, geo.smile, inkM, -0.025);` add `mouth = openMouth(face, material(FACE_COLOURS.mouth), -0.052, 0.034, 0.028);`
   - bunny: replace

     ```ts
     face.add(onFace(blob(inkM, [0.036, 0.03, 0.008]), 0, -0.068, 0.001));
     ```

     with

     ```ts
     const little = onFace(blob(inkM, [0.036, 0.03, 0.008]), 0, -0.068, 0.001);
     face.add(little);
     mouth = { node: little, rest: 0.03, open: 0.05 };
     ```
   - fox: after `smile(face, geo.grin, inkM, -0.015);` add `mouth = openMouth(face, material(FACE_COLOURS.mouth), -0.05, 0.05, 0.032);`

5. Change the final `return` to include `mouth`:

```ts
  return { species, root, body, rest: CENTRE, legs, eyes, wags, tints, top, mouth: mouth! };
```

- [ ] **Step 4: Make the avatars talk**

In `web/src/avatars.ts`:

1. Change the three import to add `Vector3`:

```ts
import { CanvasTexture, Group, LinearFilter, type Material, Sprite, SpriteMaterial, SRGBColorSpace, type Vector3 } from 'three';
```

2. Add to `Figure`, after `nextBlink: number;`:

```ts
  /** How loud its visitor is talking, 0..1 (voice.ts): opens the mouth and nods the body. */
  talk: number;
```

3. In `build`, add `talk: 0,` to the `f` literal after `nextBlink: …,`.

4. In `place`, replace

```ts
    creature.body.rotation.x = Math.max(-0.3, Math.min(0.3, f.pose[3] * 0.35));
```

with

```ts
    creature.body.rotation.x = Math.max(-0.3, Math.min(0.3, f.pose[3] * 0.35)) + f.talk * CONFIG.multiplayer.voice.nod;
    const mouth = creature.mouth;
    mouth.node.scale.y = mouth.rest + (mouth.open - mouth.rest) * f.talk;
    mouth.node.visible = mouth.node.scale.y > 1e-3;
```

5. After `setName`, add:

```ts
  /** How loud a visitor is talking, 0..1; the figure shows it from the next update. */
  setTalk(id: string, level: number): void {
    const f = this.figures.get(id);
    if (f) f.talk = Math.max(0, Math.min(1, level));
  }

  /** Where a visitor's voice comes from: their animal's mouth, in world space; null until it has a pose. */
  mouth(id: string, out: Vector3): Vector3 | null {
    const f = this.figures.get(id);
    return f?.root.visible ? f.creature.mouth.node.getWorldPosition(out) : null;
  }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/creatures.test.ts tests/avatars.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/creatures.ts src/avatars.ts tests/creatures.test.ts tests/avatars.test.ts
git commit -m "Voice: animals open their mouths and nod as their visitors talk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Start screen, HUD and wiring

**Files:**
- Modify: `web/index.html`, `web/src/style.css`, `web/src/ui.ts`, `web/src/main.ts`

**Interfaces:**
- Consumes: `loadVoice`, `saveVoice`, `openMic`, `wallCounter`, `Voices`, `MicState` (Tasks 1–3); `Sound.context`, `Sound.voiceOutput` (Task 3); `Multiplayer.setVoice`, `shareMic`, `people` (Task 4); `Avatars.setTalk`, `Avatars.mouth` (Task 5); `world.occluders` (existing, `Mesh[]`).
- Produces: `UI.getVoice(): boolean`, `UI.setVoice(on: boolean)`, `UI.setMic(state: MicState)`, `UI.setPeople(people: { name: string; talking: boolean }[])` (replaces `setPeople(names: string[])`), `TouchBarHandlers.mic`. In the browser, `window.walkthrough.voices` and `window.walkthrough.others` with `?debug`.

There are no unit tests for this task. `ui.ts` and `main.ts` aren't unit-tested in this codebase. `npm run build` checks the types, and Task 7 checks the result in the browser.

- [ ] **Step 1: Markup**

In `web/index.html`:

1. After the `<label class="name-field">…</label>` line, add:

```html
      <label class="voice-field"><input id="voice" type="checkbox" checked /> Talk with your voice</label>
```

2. In the desktop controls list, after `<li><kbd>M</kbd> mute sound</li>`, add:

```html
        <li><kbd>V</kbd> mic on or off</li>
```

3. In both controls lists, change `<li>Anyone else exploring now walks the flat with you</li>` to:

```html
        <li>Anyone else exploring now walks the flat with you, and you can talk</li>
```

4. In the touch list, change `<li>Buttons, top right: date and time (and the kitchen wall), room light, sound, pause</li>` to:

```html
        <li>Buttons, top right: date and time (and the kitchen wall), room light, sound, mic, pause</li>
```

5. In `#touch-bar`, between the `touch-sound` and `touch-pause` buttons, add:

```html
        <button type="button" id="touch-mic" aria-label="Mic" aria-pressed="false" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /><path class="mic-off" d="M4 4l16 16" /></svg>
        </button>
```

6. After the `#muted` div, add:

```html
      <div id="mic" hidden>
        <svg viewBox="0 0 24 24" role="img" aria-label="Mic"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /><path class="mic-off" d="M4 4l16 16" /></svg>
      </div>
```

- [ ] **Step 2: Styles**

In `web/src/style.css`:

1. After the `.name-field input::placeholder` rule, add:

```css
.voice-field { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
.voice-field input { accent-color: var(--accent); }
```

2. Change `#crosshair, #room-name, #people, #prompt, #muted { pointer-events: none; }` to include `#mic`:

```css
#crosshair, #room-name, #people, #prompt, #muted, #mic { pointer-events: none; } /* touches go through to the view */
```

3. After the `#muted svg { … }` rule, add:

```css
#mic {
  position: fixed; right: 50px; bottom: 16px; width: 22px; height: 22px; opacity: 0.85;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
}
#mic svg {
  width: 100%; height: 100%; fill: none; stroke: var(--ink); stroke-width: 1.8;
  stroke-linecap: round; stroke-linejoin: round;
}
#mic:not(.off) .mic-off, #touch-mic[aria-pressed='true'] .mic-off { display: none; }
```

4. After `body.touch #muted { display: none; }`, add:

```css
body.touch #mic { display: none; } /* the bar's mic button shows it */
#touch-bar button[hidden] { display: none; }
```

- [ ] **Step 3: UI methods**

In `web/src/ui.ts`:

1. Add the import at the top:

```ts
import type { MicState } from './voice';
```

2. Add `mic(): void;` to `TouchBarHandlers`, after `mute(): void;`.

3. After `setName`, add:

```ts
  /** The start screen's voice checkbox: whether the start click asks for the mic. */
  getVoice(): boolean {
    return this.el<HTMLInputElement>('voice').checked;
  }

  setVoice(on: boolean): void {
    this.el<HTMLInputElement>('voice').checked = on;
  }

  /** The mic's state, in the corner and on the touch bar: on, off (V), or none (refused or unticked: listening only). */
  setMic(state: MicState): void {
    const label = state === 'on' ? 'Mic on' : state === 'off' ? 'Mic off' : 'No mic: listening only';
    const mark = this.el('mic');
    mark.hidden = false;
    mark.classList.toggle('off', state !== 'on');
    mark.querySelector('svg')?.setAttribute('aria-label', label);
    const b = this.el<HTMLButtonElement>('touch-mic');
    b.hidden = false;
    b.disabled = state === 'none';
    b.setAttribute('aria-pressed', String(state === 'on'));
    b.setAttribute('aria-label', label);
  }
```

4. Replace `setPeople` with:

```ts
  /** Who else is here, under the room name, with a mark after whoever is talking; hidden when alone. */
  setPeople(people: { name: string; talking: boolean }[]): void {
    const p = this.el('people');
    p.hidden = people.length === 0;
    const text = people.length ? `With ${people.map((x) => (x.talking ? `${x.name} 🔊` : x.name)).join(', ')}` : '';
    if (p.textContent !== text) p.textContent = text;
  }
```

5. In `bindTouchBar`, after the `touch-sound` listener, add:

```ts
    this.el('touch-mic').addEventListener('click', () => h.mic());
```

- [ ] **Step 4: Wire it up in `main.ts`**

In `web/src/main.ts`:

1. Add the import after `import { fetchIceServers } from './turn';`:

```ts
import { loadVoice, openMic, saveVoice, Voices, wallCounter } from './voice';
```

2. Find the `?debug` line (`if (params.has('debug')) Object.assign(window, { walkthrough: { … CONFIG, LIGHT_SPILL } });`) and add two getters at the end of the inner object, after `LIGHT_SPILL`:

```ts
get voices() { return voices; }, get others() { return others; },
```

3. After `scene.add(avatars.root);`, add:

```ts
  const ear = new Vector3();
  const wallsBetween = wallCounter(world.occluders); // walls and closed doors between a voice and the listener
```

4. Replace

```ts
  let others: Multiplayer | null = null;
```

with

```ts
  let others: Multiplayer | null = null;
  /** The others' voices and the local mic, once started (not with ?solo). */
  let voices: Voices | null = null;
  const showPeople = () => ui.setPeople((others?.people ?? []).map((p) => ({ name: p.name, talking: voices?.talking(p.id) ?? false })));
```

5. After `ui.setName(loadName(() => localStorage));`, add:

```ts
  ui.setVoice(loadVoice(() => localStorage));
```

6. In `joinOthers`, change the `Multiplayer` hooks' `onPeers: (names) => ui.setPeople(names),` to `onPeers: () => showPeople(),`. After the `others = new Multiplayer(…);` statement, add:

```ts
      if (voices) others.setVoice(voices);
```

7. In `start`, replace `if (!params.has('solo')) void joinOthers();` with:

```ts
    if (!params.has('solo')) {
      const v = (voices = new Voices(sound.context, sound.voiceOutput(CONFIG.multiplayer.voice.level)));
      const talk = ui.getVoice();
      saveVoice(() => localStorage, talk);
      ui.setMic('none');
      // Asked inside the click, the gesture browsers want for the mic; joining doesn't wait for the answer
      void (talk ? openMic(navigator.mediaDevices) : Promise.resolve(null)).then((mic) => {
        v.setMic(mic);
        others?.shareMic();
        ui.setMic(v.micState);
      });
      void joinOthers();
    }
```

8. In `setPausedState`, after `sound?.setPaused(on);`, add:

```ts
    voices?.setPaused(on);
```

9. After `toggleMute`, add:

```ts
  const toggleMic = () => {
    if (!voices?.mic) return;
    voices.setMicOn(voices.micState !== 'on');
    ui.setMic(voices.micState);
  };
```

10. In `ui.bindTouchBar({ … })`, add `mic: toggleMic,` after `mute: toggleMute,`.

11. In the `keydown` listener, after `if (e.code === 'KeyM') toggleMute();`, add:

```ts
    if (e.code === 'KeyV' && !e.metaKey && !e.ctrlKey && !e.altKey) toggleMic();
```

12. In the frame loop, after `avatars.update(dt, avatarLight);`, add:

```ts
    if (voices) {
      voices.update(dt, camera.getWorldPosition(ear), (id, out) => avatars.mouth(id, out), wallsBetween);
      for (const id of voices.ids) avatars.setTalk(id, voices.talk(id));
    }
    if (others) showPeople();
```

- [ ] **Step 5: Check types, tests and build**

Run: `npx vitest run && npm run build`
Expected: every test passes; the build ends with `✓ built in …` (the existing chunk size warning is fine).

- [ ] **Step 6: Commit**

```bash
git add index.html src/style.css src/ui.ts src/main.ts
git commit -m "Voice: the voice checkbox, V and the mic button, and voices in the frame loop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Check it in the browser, and the docs

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-25-multiplayer-design.md`, `docs/superpowers/specs/2026-10-27-proximity-voice-design.md`

**Interfaces:**
- Consumes: the whole feature, and the `?debug` getters from Task 6.

- [ ] **Step 1: Two tabs, one with a tone for a mic**

Start the dev server with the `walkthrough` entry in `.claude/launch.json` (port 5173). Open two tabs at `http://localhost:5173/?debug&room=voice-check`. In each, untick "Talk with your voice", so no mic prompt blocks the check, and click to explore. Each tab should list the other in the "With …" line.

In tab A, give it a 440 Hz tone for a mic:

```js
const ac = new AudioContext();
await ac.resume(); // a context made outside a click starts suspended, and would send silence
const osc = ac.createOscillator();
const dest = ac.createMediaStreamDestination();
osc.connect(dest); osc.start();
walkthrough.voices.setMic(dest.stream);
walkthrough.others.shareMic();
```

- [ ] **Step 2: Tab B hears it, sees the mouth, and walls muffle it**

Bring tab B to the front: a background tab's frame loop is throttled, and `Voices.update` runs in it. Then, after a few seconds:

```js
const v = walkthrough.voices; const id = v.ids[0];
({ id, talk: v.talk(id), talking: v.talking(id) })
```

Expected: one id, `talk` above 0.9, `talking` true, and the "With …" line shows the 🔊 mark. A screenshot of tab B, turned toward A's animal, shows its mouth open.

Then check the walls. In tab B, with A's animal visible in another room through a wall, read the gain and cutoff from the voice's nodes (debug only, through the private map):

```js
const voice = walkthrough.voices['voices'].get(id);
({ gain: voice.gain.gain.value, cutoff: voice.filter.frequency.value })
```

Expected: with a wall between them, the gain is below 1 and the cutoff 1800 Hz or lower. Walk B into A's room and run it again: gain 1, cutoff 20000.

- [ ] **Step 3: V and pause silence the mic**

In tab A, press V: `walkthrough.voices.micState` is `'off'`, and within a second tab B's `talk` is near 0 and its mark is gone. Press V again to turn it back on. Press Esc in A: B goes quiet. Resume A: B hears it again.

- [ ] **Step 4: Update the docs**

1. In `README.md`, under "## Visitors together", after the paragraph that starts "There is no server.", add:

```markdown
Visitors can talk. The start screen's "Talk with your voice" checkbox (on by default, remembered) asks for the mic on the start click; without it, or if the mic is refused, they still hear the others. A voice comes from its animal's mouth, quieter with distance and muffled by walls and closed doors, and the animal's mouth moves with it; the "With …" line marks whoever is talking. V turns the mic off and on (a mic button on touch), M mutes everyone's voices with the other sounds, and pausing turns the mic off. Everyone's mic goes to everyone, so it suits a handful of people. Tuning is in `CONFIG.multiplayer.voice`; the design note is `docs/superpowers/specs/2026-10-27-proximity-voice-design.md`.
```

2. In `docs/superpowers/specs/2026-10-25-multiplayer-design.md`, after the "## TURN" section, add:

```markdown
## Voice

Added 2026-10-27: visitors talk, with their voices placed at their animals and muffled by walls. See `2026-10-27-proximity-voice-design.md`.
```

3. In `docs/superpowers/specs/2026-10-27-proximity-voice-design.md`:
   - Change `**Status:** Approved, not implemented` to `**Status:** Implemented`.
   - In "## Walls and doors", replace the first bullet's "against the occluders: the flat's chunk meshes and the doors' nodes. Switches, lamp boxes and screens are not occluders." with "against `world.occluders`, the meshes that cast the sun's shadows: walls, doors and furniture, everything but glass. Voices pass through glass unmuffled."
   - In "## Files", add to the `main.ts` bullet: "`world.occluders` (unchanged) are the occluders."

- [ ] **Step 5: Final check and commit**

Run: `npx vitest run && npm run build`
Expected: all pass, and the build succeeds.

```bash
git add ../README.md ../docs/superpowers/specs/2026-10-25-multiplayer-design.md ../docs/superpowers/specs/2026-10-27-proximity-voice-design.md
git commit -m "Voice: README and design notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
