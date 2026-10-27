import { type Object3D, Raycaster, Vector3 } from 'three';
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
