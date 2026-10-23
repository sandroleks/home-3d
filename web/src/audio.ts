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
