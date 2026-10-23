# Sound and Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add door, switch and footstep sounds, per-room ambience and a looping music track to the walkthrough, with an M key to mute.

**Architecture:** CC0 sources are turned into small MP3s by a committed ffmpeg script (`web/scripts/build-audio.sh`). In the viewer, `src/audio.ts` holds the pure decision logic (when a step sounds, which ambience a room gets, what a door sounds like this frame, loop bounds, mute persistence) and is unit-tested. `src/sound.ts` is the Web Audio wiring, built on three.js's `AudioListener` on the camera, with raw buffer sources and panners. `main.ts` connects the two to the frame loop and input.

**Tech Stack:** three.js 0.170.0 (`AudioListener`), Web Audio API, TypeScript 5.6.3, Vitest 5.0.3, ffmpeg (Homebrew, `/opt/homebrew/bin/ffmpeg`) for asset building.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-23-sound-and-music-design.md`.
- No new npm dependencies.
- All audio is CC0 (or generated here) and listed in `web/public/assets/audio/CREDITS.md`.
- MP3 only, in `web/public/assets/audio/`. Total audio about 6 MB or less.
- Audio loads after the start click and is not part of the 30 MB first-view budget.
- `?autostart` (including `?view=` reference renders) creates no sound at all.
- M mutes everything; remembered in `localStorage` under `walkthrough.muted` (`'1'` / `'0'`), every access in try/catch.
- Starting levels: effects 0.8, footsteps 0.35, ambience 0.4, music 0.25. Ambience crossfade 1.5 s, mute fade 0.2 s. Stride 0.7 m walking, 0.9 m running, first step after 0.25 m.
- Ambience: `varanda`, `marquise` → `outdoor`; `cozinha`, `lavandaria` → `kitchen`; everything else and `null` → `room`.
- Commit after each task. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run web commands from `web/`. If `web/node_modules` is missing, run `npm ci` there first.

## Sources (already downloaded, user-approved)

In `/private/tmp/claude-501/-Users-sandrolek-Documents-Projects-Home--claude-worktrees-sounds-background-music-512371/5a5c102e-4209-4aca-88ec-7f4f94a92f2c/scratchpad/audio-src/` (below: `$SRC`), with the Kenney zips unzipped next to themselves:

| Source | Author | Licence | URL |
|---|---|---|---|
| `kenney_rpg-audio/` | Kenney | CC0 | https://kenney.nl/assets/rpg-audio |
| `kenney_impact-sounds/` | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `kenney_ui-audio/` | Kenney | CC0 | https://kenney.nl/assets/ui-audio |
| `in_the_lobby.wav` (104.7 s, designed to loop) | Umplix | CC0 | https://opengameart.org/content/in-the-lobby |
| `park_ambience_birds.wav` (449 s, 48 kHz stereo) | Thimras | CC0 | https://opengameart.org/content/park-ambiences |

BigSoundBank blocks scripted downloads and no CC0 fridge hum or room tone turned up, so the kitchen and room ambience are generated with ffmpeg, and the outdoor loop gets a generated distant-traffic rumble under the birds.

## File Map

- Create `web/scripts/build-audio.sh`: builds every MP3 from `$SRC`.
- Create `web/public/assets/audio/*.mp3` (14 files) and `CREDITS.md`.
- Create `web/src/audio.ts`: pure logic. Create `web/tests/audio.test.ts`.
- Create `web/src/sound.ts`: the `Sound` class.
- Modify `web/src/config.ts`: `roomAmbience`, `audio`.
- Modify `web/src/interactions.ts`: `click()` returns the target.
- Modify `web/src/world.ts`: `switches` map.
- Modify `web/src/ui.ts`, `web/index.html`, `web/src/style.css`: mute icon, M in the controls list.
- Modify `web/src/main.ts`: wiring.
- Modify `README.md`, spec: document sound.

---

### Task 1: Audio files

**Files:**
- Create: `web/scripts/build-audio.sh`
- Create: `web/public/assets/audio/` (door-open, door-close, door-latch, switch, step-1…step-5, ambience-outdoor, ambience-kitchen, ambience-room, music `.mp3`)
- Create: `web/public/assets/audio/CREDITS.md`
- Modify: `docs/superpowers/specs/2026-10-23-sound-and-music-design.md` (Audio files section)

**Interfaces:**
- Produces: file names `door-open`, `door-close`, `door-latch`, `switch`, `step-1`…`step-5`, `ambience-outdoor`, `ambience-kitchen`, `ambience-room`, `music` (all `.mp3`) under `assets/audio/`. Task 3 loads exactly these.

- [ ] **Step 1: Write the build script**

`web/scripts/build-audio.sh`:

```bash
#!/usr/bin/env bash
# Builds web/public/assets/audio/ from the downloaded CC0 sources listed in its CREDITS.md.
# Usage: scripts/build-audio.sh <dir with the unzipped Kenney packs and the two OpenGameArt WAVs>
set -euo pipefail
SRC=${1:?usage: build-audio.sh <source dir>}
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/assets/audio"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

ff() { ffmpeg -v error -y "$@"; }

# One-shot effects: mono (they're placed in space), 96 kbps.
effect() { ff -i "$1" -ac 1 -ar 44100 -c:a libmp3lame -b:a 96k "$OUT/$2.mp3"; }

# A seamless 30 s loop from the first 33 s of a WAV: the last 3 s crossfade into the first 3 s.
seamless() { # <wav> <name> <mono|stereo> <bitrate>
  ff -i "$1" -t 33 -filter_complex "
    [0:a]aformat=sample_rates=44100:channel_layouts=$3,asplit=3[a][b][c];
    [a]atrim=3:30,asetpts=PTS-STARTPTS[mid];
    [b]atrim=30:33,asetpts=PTS-STARTPTS,afade=t=out:d=3[tail];
    [c]atrim=0:3,asetpts=PTS-STARTPTS,afade=t=in:d=3[head];
    [tail][head]amix=inputs=2:normalize=0[xf];
    [mid][xf]concat=n=2:v=0:a=1" -c:a libmp3lame -b:a "$4" "$OUT/$2.mp3"
}

effect "$SRC/kenney_rpg-audio/Audio/doorOpen_1.ogg" door-open
effect "$SRC/kenney_rpg-audio/Audio/creak1.ogg" door-close
effect "$SRC/kenney_rpg-audio/Audio/doorClose_2.ogg" door-latch
effect "$SRC/kenney_ui-audio/Audio/click3.ogg" switch
for i in 0 1 2 3 4; do effect "$SRC/kenney_impact-sounds/Audio/footstep_wood_00$i.ogg" "step-$((i + 1))"; done

# Outdoor: birds from the park recording over a low, distant-traffic rumble.
ff -ss 60 -t 33 -i "$SRC/park_ambience_birds.wav" -f lavfi -t 33 -i "anoisesrc=color=brown:amplitude=0.6:seed=7" \
  -filter_complex "[1:a]lowpass=f=250,volume=0.25,aformat=channel_layouts=stereo[r];[0:a][r]amix=inputs=2:normalize=0" \
  -ar 44100 "$TMP/outdoor.wav"
seamless "$TMP/outdoor.wav" ambience-outdoor stereo 128k

# Kitchen: soft room noise plus a fridge-compressor hum (100 Hz and harmonics).
ff -f lavfi -t 33 -i "anoisesrc=color=pink:amplitude=0.02:seed=3" \
  -f lavfi -t 33 -i "sine=f=100" -f lavfi -t 33 -i "sine=f=200" -f lavfi -t 33 -i "sine=f=300" \
  -filter_complex "[0:a]lowpass=f=1500[n];[1:a]volume=0.05[h1];[2:a]volume=0.025[h2];[3:a]volume=0.01[h3];[n][h1][h2][h3]amix=inputs=4:normalize=0" \
  -ac 1 -ar 44100 "$TMP/kitchen.wav"
seamless "$TMP/kitchen.wav" ambience-kitchen mono 64k

# Room: very quiet, dark noise; the city faintly through the windows.
ff -f lavfi -t 33 -i "anoisesrc=color=brown:amplitude=0.08:seed=5" -af "lowpass=f=600" -ac 1 -ar 44100 "$TMP/room.wav"
seamless "$TMP/room.wav" ambience-room mono 64k

# Music: already a loop.
ff -i "$SRC/in_the_lobby.wav" -ar 44100 -c:a libmp3lame -b:a 128k "$OUT/music.mp3"
```

Then `chmod +x web/scripts/build-audio.sh`.

- [ ] **Step 2: Run it**

Run (from `web/`): `scripts/build-audio.sh "$SRC"`
Expected: no output, exit 0.

- [ ] **Step 3: Check durations, sizes and levels**

Run:
```bash
cd public/assets/audio && du -ch *.mp3 | tail -1 && for f in *.mp3; do printf "%-22s %6.2fs %s\n" "$f" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")" "$(ffmpeg -i "$f" -af volumedetect -f null - 2>&1 | grep -oE 'mean_volume: [-0-9.]+ dB')"; done
```
Expected: total ≤ 6 MB. The three ambience files are ~30 s and music ~104.7 s. Mean volume: ambience-outdoor between -40 and -25 dB, ambience-kitchen between -45 and -30 dB, ambience-room between -50 and -35 dB. If a generated loop falls outside its range, adjust that loop's `amplitude` / `volume` values in the script and rerun Step 2. The bus gains in Task 2 set the final mix.

- [ ] **Step 4: Write `web/public/assets/audio/CREDITS.md`**

```markdown
# Audio credits

Everything here is CC0 (public domain) or generated for this project. Rebuild with `web/scripts/build-audio.sh <source dir>`.

| File | Source | Author | Licence |
|---|---|---|---|
| door-open.mp3 | `doorOpen_1.ogg` from [RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney | CC0 |
| door-close.mp3 | `creak1.ogg` from [RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney | CC0 |
| door-latch.mp3 | `doorClose_2.ogg` from [RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney | CC0 |
| switch.mp3 | `click3.ogg` from [UI Audio](https://kenney.nl/assets/ui-audio) | Kenney | CC0 |
| step-1.mp3 … step-5.mp3 | `footstep_wood_000.ogg` … `footstep_wood_004.ogg` from [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney | CC0 |
| ambience-outdoor.mp3 | 60–93 s of `park_ambience_birds.wav` from [Park Ambiences](https://opengameart.org/content/park-ambiences), mixed with generated brown noise | Thimras | CC0 |
| ambience-kitchen.mp3 | Generated with ffmpeg (pink noise and a 100 Hz hum) | this project | CC0 |
| ambience-room.mp3 | Generated with ffmpeg (filtered brown noise) | this project | CC0 |
| music.mp3 | [In the Lobby](https://opengameart.org/content/in-the-lobby) | Umplix | CC0 |
```

- [ ] **Step 5: Amend the spec's Audio files section**

In `docs/superpowers/specs/2026-10-23-sound-and-music-design.md`, change the bullets so they match what was built: `step-1.mp3` … `step-5.mp3` (Kenney has five wood footsteps), and add: "BigSoundBank blocks scripted downloads and no CC0 fridge hum or room tone was found, so `ambience-kitchen` and `ambience-room` are generated with ffmpeg and `ambience-outdoor` layers generated rumble under CC0 birdsong. The script that builds every file is `web/scripts/build-audio.sh`."

- [ ] **Step 6: Commit**

```bash
git add web/scripts/build-audio.sh web/public/assets/audio docs/superpowers/specs/2026-10-23-sound-and-music-design.md
git commit -m "Audio: CC0 effects, ambience loops and music, with the script that builds them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure audio logic

**Files:**
- Create: `web/src/audio.ts`
- Modify: `web/src/config.ts`
- Test: `web/tests/audio.test.ts`

**Interfaces:**
- Produces (from `src/audio.ts`):
  - `type Ambience = 'outdoor' | 'kitchen' | 'room'`, `const AMBIENCES: readonly Ambience[]`
  - `type DoorSound = 'open' | 'close' | 'latch'`, `interface DoorSnapshot { target: number; progress: number }`
  - `ambienceFor(room: string | null, map?: Record<string, Ambience>): Ambience`
  - `doorSound(prev: DoorSnapshot, now: DoorSnapshot): DoorSound | null` (a `DoorState` is a valid `now`)
  - `class StepTimer { constructor(stride?, runStride?, firstStep?); update(distance: number, running: boolean): boolean }`
  - `nextStep(last: number, count: number, random?: () => number): number`
  - `loopBounds(samples: Float32Array, maxTrim: number, threshold?: number): [number, number]`
  - `loadMuted(storage: () => KeyValueStore): boolean`, `saveMuted(storage: () => KeyValueStore, muted: boolean): void`, where `type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>`
- Produces (from `CONFIG`): `CONFIG.roomAmbience: Record<string, Ambience>`, `CONFIG.audio` with `base, effects, steps, ambience, music, ambienceFade, muteFade, stride, runStride, firstStep`.

- [ ] **Step 1: Write the failing tests**

`web/tests/audio.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/audio.test.ts`
Expected: FAIL, "Failed to resolve import ../src/audio" (or similar).

- [ ] **Step 3: Add the config**

In `web/src/config.ts`, add at the top:

```ts
import type { Ambience } from './audio';
```

and add these entries to `CONFIG` after `roomNames`:

```ts
  /** Rooms whose ambience isn't the default quiet room tone. */
  roomAmbience: { varanda: 'outdoor', marquise: 'outdoor', cozinha: 'kitchen', lavandaria: 'kitchen' } as Record<string, Ambience>,
  audio: {
    base: 'assets/audio/',
    /** Bus levels for one-shot effects, footsteps, room ambience and music. */
    effects: 0.8,
    steps: 0.35,
    ambience: 0.4,
    music: 0.25,
    /** Seconds. */
    ambienceFade: 1.5,
    muteFade: 0.2,
    /** Metres between footsteps, and before the first one after standing still. */
    stride: 0.7,
    runStride: 0.9,
    firstStep: 0.25,
  },
```

- [ ] **Step 4: Write `web/src/audio.ts`**

```ts
import { CONFIG } from './config';

export type Ambience = 'outdoor' | 'kitchen' | 'room';
export const AMBIENCES: readonly Ambience[] = ['outdoor', 'kitchen', 'room'];
export type DoorSound = 'open' | 'close' | 'latch';
export interface DoorSnapshot { target: number; progress: number }
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const MUTE_KEY = 'walkthrough.muted';

export function ambienceFor(room: string | null, map: Record<string, Ambience> = CONFIG.roomAmbience): Ambience {
  return (room !== null && map[room]) || 'room';
}

/** What a door should sound like this frame, given its state last frame. */
export function doorSound(prev: DoorSnapshot, now: DoorSnapshot): DoorSound | null {
  if (now.target !== prev.target) return now.target === 1 ? 'open' : 'close';
  if (now.progress === 0 && prev.progress > 0) return 'latch';
  return null;
}

/** Decides when a footstep sounds from the distance the player actually moved. */
export class StepTimer {
  private travelled = 0;
  private moving = false;

  constructor(
    private stride = CONFIG.audio.stride,
    private runStride = CONFIG.audio.runStride,
    private firstStep = CONFIG.audio.firstStep,
  ) {}

  update(distance: number, running: boolean): boolean {
    if (distance < 1e-4) {
      this.moving = false;
      return false;
    }
    const stride = running ? this.runStride : this.stride;
    if (!this.moving) {
      this.moving = true;
      this.travelled = stride - this.firstStep;
    }
    this.travelled += distance;
    if (this.travelled < stride) return false;
    this.travelled -= stride;
    return true;
  }
}

/** A random index in [0, count) that differs from `last`. */
export function nextStep(last: number, count: number, random = Math.random): number {
  if (last < 0 || last >= count) return Math.floor(random() * count);
  if (count < 2) return 0;
  const i = Math.floor(random() * (count - 1));
  return i >= last ? i + 1 : i;
}

/** The sample range to loop: skips silent encoder padding, at most `maxTrim` samples at each end. */
export function loopBounds(samples: Float32Array, maxTrim: number, threshold = 1e-4): [number, number] {
  let start = 0;
  while (start < maxTrim && start < samples.length && Math.abs(samples[start]) < threshold) start++;
  let end = samples.length;
  while (samples.length - end < maxTrim && end > start && Math.abs(samples[end - 1]) < threshold) end--;
  return [start, end];
}

export function loadMuted(storage: () => KeyValueStore): boolean {
  try {
    return storage().getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(storage: () => KeyValueStore, muted: boolean): void {
  try {
    storage().setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Storage is blocked (private window, site data off): the choice just isn't remembered.
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/audio.test.ts`
Expected: all pass.

- [ ] **Step 6: Run the whole suite and the type check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/audio.ts web/src/config.ts web/tests/audio.test.ts
git commit -m "Audio: footstep timing, room ambience, door sounds, loop bounds and mute persistence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The `Sound` class

**Files:**
- Create: `web/src/sound.ts`

**Interfaces:**
- Consumes: everything Task 2 produces from `src/audio.ts` and `CONFIG.audio`. The file names from Task 1.
- Produces: `class Sound { constructor(camera: Camera); load(): Promise<void>; door(node: Object3D, sound: DoorSound): void; click(node?: Object3D): void; step(): void; setRoom(room: string | null): void; setMuted(muted: boolean): void; setPaused(paused: boolean): void }`. `load()` never rejects.

Notes for the implementer:
- `AudioListener` (three.js) creates or reuses the shared `AudioContext`, and its `getInput()` is the master gain. Added as a child of the camera, it moves the Web Audio listener every frame: `WebGLRenderer.render` calls `camera.updateMatrixWorld()` because the camera has no parent, and that reaches the listener.
- One-shots are raw `AudioBufferSourceNode`s with an optional `PannerNode` at the node's world position. That's cheaper than a `PositionalAudio` object per play, and the doors and switches don't move while a sound plays.
- Construct `Sound` only from a click handler (browsers keep the context suspended otherwise).
- This file isn't unit-tested (vitest runs in Node, where Web Audio doesn't exist). Task 5 checks it in the browser.

- [ ] **Step 1: Write `web/src/sound.ts`**

```ts
import { AudioListener, Vector3, type Camera, type Object3D } from 'three';
import { AMBIENCES, ambienceFor, loopBounds, nextStep, type Ambience, type DoorSound } from './audio';
import { CONFIG } from './config';

const STEP_COUNT = 5;
const DOOR_FILES: Record<DoorSound, string> = { open: 'door-open', close: 'door-close', latch: 'door-latch' };
const FILES = [
  ...Object.values(DOOR_FILES),
  'switch',
  ...Array.from({ length: STEP_COUNT }, (_, i) => `step-${i + 1}`),
  ...AMBIENCES.map((a) => `ambience-${a}`),
  'music',
];
/** MP3 encoders pad both ends with up to ~50 ms of silence; loops skip it. */
const MAX_LOOP_TRIM = 0.1;

/** All of the walkthrough's sound. Create it from a click: browsers only start audio after a user gesture. */
export class Sound {
  private listener = new AudioListener();
  private ctx: AudioContext;
  private effects: GainNode;
  private steps: GainNode;
  private music: GainNode;
  private ambience = new Map<Ambience, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private currentAmbience: Ambience | null = null;
  private lastStep = -1;
  private position = new Vector3();

  constructor(camera: Camera) {
    camera.add(this.listener);
    this.ctx = this.listener.context;
    void this.ctx.resume();
    const master = this.listener.getInput();
    this.effects = this.bus(CONFIG.audio.effects, master);
    this.steps = this.bus(CONFIG.audio.steps, master);
    this.music = this.bus(CONFIG.audio.music, master);
    const ambience = this.bus(CONFIG.audio.ambience, master);
    for (const name of AMBIENCES) this.ambience.set(name, this.bus(0, ambience));
  }

  /** Fetches and decodes every file, then starts the loops. A file that fails stays silent. */
  async load(): Promise<void> {
    await Promise.all(FILES.map(async (name) => {
      try {
        const res = await fetch(`${CONFIG.audio.base}${name}.mp3`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.buffers.set(name, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      } catch (err) {
        console.warn(`Sound ${name} failed to load; it will stay silent.`, err);
      }
    }));
    for (const [name, gain] of this.ambience) this.loop(`ambience-${name}`, gain);
    this.loop('music', this.music);
  }

  door(node: Object3D, sound: DoorSound): void {
    this.play(DOOR_FILES[sound], this.effects, node);
  }

  /** A light switch's click, from the switch itself when there is one. */
  click(node?: Object3D): void {
    this.play('switch', this.effects, node);
  }

  step(): void {
    this.lastStep = nextStep(this.lastStep, STEP_COUNT);
    this.play(`step-${this.lastStep + 1}`, this.steps, undefined, 0.92 + Math.random() * 0.16, 0.8 + Math.random() * 0.2);
  }

  setRoom(room: string | null): void {
    const next = ambienceFor(room);
    if (next === this.currentAmbience) return;
    this.currentAmbience = next;
    for (const [name, gain] of this.ambience) this.ramp(gain.gain, name === next ? 1 : 0, CONFIG.audio.ambienceFade);
  }

  setMuted(muted: boolean): void {
    this.ramp(this.listener.getInput().gain, muted ? 0 : 1, CONFIG.audio.muteFade);
  }

  setPaused(paused: boolean): void {
    void (paused ? this.ctx.suspend() : this.ctx.resume());
  }

  private bus(level: number, to: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = level;
    g.connect(to);
    return g;
  }

  private loop(name: string, to: AudioNode): void {
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const [start, end] = loopBounds(buffer.getChannelData(0), Math.round(MAX_LOOP_TRIM * buffer.sampleRate));
    src.loopStart = start / buffer.sampleRate;
    src.loopEnd = end / buffer.sampleRate;
    src.connect(to);
    src.start(0, src.loopStart);
  }

  private play(name: string, to: AudioNode, at?: Object3D, rate = 1, level = 1): void {
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = level;
    src.connect(gain);
    let out: AudioNode = gain;
    if (at) {
      at.getWorldPosition(this.position);
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.refDistance = 1;
      panner.positionX.value = this.position.x;
      panner.positionY.value = this.position.y;
      panner.positionZ.value = this.position.z;
      gain.connect(panner);
      out = panner;
    }
    out.connect(to);
    src.start();
  }

  private ramp(param: AudioParam, value: number, seconds: number): void {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + seconds);
  }
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/sound.ts
git commit -m "Sound: Web Audio buses, positioned one-shots, ambience crossfades and music loop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire sound into the walkthrough

**Files:**
- Modify: `web/src/interactions.ts` (`click()`)
- Modify: `web/src/world.ts` (`World.switches`)
- Modify: `web/src/ui.ts` (`setMuted`)
- Modify: `web/index.html`, `web/src/style.css`
- Modify: `web/src/main.ts`
- Modify: `README.md`
- Test: `web/tests/interactions.test.ts`

**Interfaces:**
- Consumes: `Sound` (Task 3); `doorSound`, `StepTimer`, `loadMuted`, `saveMuted` (Task 2).
- Produces: `Interactions.click(): Target | null`; `World.switches: Map<string, Object3D>` (room id → switch node); `UI.setMuted(muted: boolean): void`.

- [ ] **Step 1: Write the failing test for `Interactions.click`**

Append to `web/tests/interactions.test.ts`, inside the existing `describe('interactions', ...)` block. Add `Interactions` to the existing import from `'../src/interactions'`, and `PerspectiveCamera` to the import from `'three'`:

```ts
  it('click returns the activated target, or null when nothing is aimed at', () => {
    const lights = new RoomLights(['sala']);
    const node = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    node.position.set(0, 0, -1);
    node.updateMatrixWorld();
    const t: Target = { kind: 'switch', room: 'sala', node };
    const camera = new PerspectiveCamera();
    const interactions = new Interactions(camera, [node], new Map([[node as Object3D, t]]), lights);
    expect(interactions.click()).toBeNull();
    interactions.update();
    expect(interactions.click()).toBe(t);
    expect(lights.isOn('sala')).toBe(true);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/interactions.test.ts`
Expected: FAIL. The first `click()` returns `undefined`, not `null`.

- [ ] **Step 3: Make `click()` return the target**

In `web/src/interactions.ts` replace `click()`:

```ts
  /** Activates what the crosshair is on, if anything, and returns it. */
  click(): Target | null {
    if (this.current) activate(this.current, this.lights);
    return this.current;
  }
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/interactions.test.ts`
Expected: PASS.

- [ ] **Step 5: Expose switch nodes per room**

In `web/src/world.ts`:
- add `switches: Map<string, Object3D>;` to `interface World` after `targets`;
- before the `for (const room of manifest.rooms)` loop add `const switches = new Map<string, Object3D>();`, and inside the loop after `targets.set(...)` add `switches.set(room.id, n);`;
- return it: `return { lights, doors, targets, switches, pickables, rooms: new RoomLocator(manifest.rooms), collision, lightmapped };`

- [ ] **Step 6: Mute icon and the M key in the controls list**

`web/index.html`: after `<li><kbd>L</kbd> toggle this room's light</li>` add

```html
        <li><kbd>M</kbd> mute sound</li>
```

and inside `#hud`, after `<div id="prompt" hidden></div>`, add

```html
      <div id="muted" title="Sound muted (M)" hidden>
        <svg viewBox="0 0 24 24" role="img" aria-label="Sound muted"><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16 9l5 6M21 9l-5 6" /></svg>
      </div>
```

`web/src/style.css`, append:

```css
#muted {
  position: fixed; right: 20px; bottom: 16px; width: 22px; height: 22px; opacity: 0.85;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
}
#muted svg {
  width: 100%; height: 100%; fill: none; stroke: var(--ink); stroke-width: 1.8;
  stroke-linecap: round; stroke-linejoin: round;
}
```

`web/src/ui.ts`, add to `UI` after `setPaused`:

```ts
  setMuted(muted: boolean): void {
    this.el('muted').hidden = !muted;
  }
```

- [ ] **Step 7: Wire it up in `main.ts`**

Imports (keep alphabetical by path like the existing ones):

```ts
import { doorSound, loadMuted, saveMuted, StepTimer } from './audio';
```
after the `three-mesh-bvh` import, and
```ts
import { Sound } from './sound';
```
after `import { Player, vfovFromHfov } from './player';`.

Replace the block from `const interactions = new Interactions(...)` through the end of the `keydown` listener with:

```ts
  const interactions = new Interactions(camera, world.pickables, world.targets, world.lights);
  const autostart = params.has('autostart');
  let started = false;
  let currentRoom: string | null = null;
  let sound: Sound | null = null;
  let muted = loadMuted(() => localStorage);
  const steps = new StepTimer();
  const doorsBefore = world.doors.map((d) => ({ target: d.state.target, progress: d.state.progress }));

  const start = () => {
    ui.hideStart();
    ui.showHud();
    started = true;
    if (autostart) return; // ?autostart and ?view= reference renders stay silent
    sound = new Sound(camera);
    sound.setMuted(muted);
    sound.setRoom(currentRoom);
    ui.setMuted(muted);
    void sound.load();
    canvas.requestPointerLock();
  };
  ui.setReady();
  ui.onStart(start);
  ui.onResume(() => canvas.requestPointerLock());
  if (autostart) start();
  let paused = false;
  document.addEventListener('pointerlockchange', () => {
    paused = started && !autostart && document.pointerLockElement !== canvas;
    ui.setPaused(paused);
    sound?.setPaused(paused);
    if (paused) {
      for (const k of Object.keys(player.keys) as (keyof typeof player.keys)[]) player.keys[k] = false;
    }
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !(autostart || document.pointerLockElement === canvas)) return;
    const t = interactions.click();
    if (t?.kind === 'switch') sound?.click(t.node); // doors sound from the frame loop as they move
  });
  window.addEventListener('keydown', (e) => {
    if (e.repeat || !started || paused) return;
    if (e.code === 'KeyL' && currentRoom && world.lights.has(currentRoom)) {
      world.lights.toggle(currentRoom);
      sound?.click(world.switches.get(currentRoom));
    }
    if (e.code === 'KeyM' && sound) {
      muted = !muted;
      saveMuted(() => localStorage, muted);
      sound.setMuted(muted);
      ui.setMuted(muted);
    }
  });
```

In the animation loop, replace

```ts
    for (const d of world.doors) {
      d.state.update(dt);
      applyDoorRotation(d);
    }
    if (started && !paused) player.update(dt);
```

with

```ts
    world.doors.forEach((d, i) => {
      d.state.update(dt);
      applyDoorRotation(d);
      const before = doorsBefore[i];
      const s = doorSound(before, d.state);
      if (s) sound?.door(d.node, s);
      before.target = d.state.target;
      before.progress = d.state.progress;
    });
    if (started && !paused) {
      const x = player.x;
      const z = player.z;
      player.update(dt);
      if (sound && steps.update(Math.hypot(player.x - x, player.z - z), player.keys.run)) sound.step();
    }
```

and after `currentRoom = world.rooms.locate(...)` add

```ts
    sound?.setRoom(currentRoom);
```

- [ ] **Step 8: Document it in the README**

In `README.md`, change the Controls line to:

```
Controls: WASD to walk, Shift to walk faster, mouse to look, click to open doors and use switches, L toggles the current room's light, M mutes sound, Esc pauses.
```

and add a section before "## Run and test":

```markdown
## Sound

The audio lives in `web/public/assets/audio/`: doors, switches and footsteps from Kenney's CC0 packs, birdsong and music from CC0 OpenGameArt uploads, and two generated room-tone loops. `CREDITS.md` there lists every source. To rebuild the files (needs ffmpeg), download the sources it lists into one folder, unzip the Kenney packs next to their zips, and run `web/scripts/build-audio.sh <folder>`. Levels, fades, footstep spacing and which rooms sound outdoors or like a kitchen are in `CONFIG.audio` and `CONFIG.roomAmbience` (`web/src/config.ts`).
```

- [ ] **Step 9: Tests, types and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds. `dist/assets/audio/` contains the 14 MP3s.

- [ ] **Step 10: Commit**

```bash
git add web/src web/index.html web/tests README.md
git commit -m "Walkthrough: doors, switches, footsteps, room ambience and music; M mutes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Check it in the browser

**Files:** none unless a check fails (then fix where it fails, rerun the relevant tests, and commit the fix).

- [ ] **Step 1: Start the dev server** with the preview tool's `walkthrough` configuration (`.claude/launch.json`), and open `http://localhost:5173/`.

- [ ] **Step 2: Nothing loads before the start click.** `read_network_requests` with `urlPattern: "audio/"` shows no requests.

- [ ] **Step 3: Start, then check loading.** Click "Click to explore". Within a few seconds the network list shows 14 `assets/audio/*.mp3` requests, all 200. `read_console_messages` with `onlyErrors: true` shows no audio errors and no "failed to load" warnings.

- [ ] **Step 4: Check the audio graph runs.** Pointer lock may not engage under automation. If it doesn't, use `?autostart` only for the visual checks, and drive the audio checks through `javascript_tool`. Confirm:
  - the shared context is running: `(await import('/node_modules/.vite/deps/three.js')).AudioContext.getContext().state === 'running'`, or find the context through the listener on the camera;
  - pressing L in the Entrada plays without errors;
  - M toggles `#muted`'s `hidden` and writes `walkthrough.muted` to `localStorage`, and after a reload the icon shows again right after starting.

- [ ] **Step 5: Check `?autostart` stays silent.** Open `/?view=Cam_Sala&autostart`. No `assets/audio/` requests appear.

- [ ] **Step 6: Screenshot** the HUD with the muted icon showing.

- [ ] **Step 7: Ask the user to listen.** Automation can't judge how it sounds, so ask the user to try it (`npm run dev` in `web/`). Ask specifically about: the door, latch and switch choices; footstep loudness; the balcony, kitchen and room ambience levels; and the music level. Tune `CONFIG.audio` or the file picks in `build-audio.sh` from their answers.
