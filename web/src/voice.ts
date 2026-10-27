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

  /** Off sends silence, so nothing reconnects and on is instant (V, or the touch mic button). */
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
    let source: MediaStreamAudioSourceNode;
    try {
      source = this.ctx.createMediaStreamSource(stream);
    } catch (err) {
      console.warn(`Could not play the voice of ${id}.`, err); // e.g. a stream without audio tracks
      return;
    }
    const element = this.audioElement?.() ?? null;
    if (element) {
      element.muted = true;
      element.srcObject = stream;
      void element.play().catch(() => {});
    }
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
