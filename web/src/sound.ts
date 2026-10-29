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
  private instruments: GainNode;
  private ambience = new Map<Ambience, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private currentAmbience: Ambience | null = null;
  private loaded = false;
  /** The music plays only while the turntable does. */
  private musicOn = false;
  private musicSource: AudioBufferSourceNode | null = null;
  private lastStep = -1;
  private position = new Vector3();
  /** The shot's burst of noise, made on first use. */
  private shotNoise: AudioBuffer | null = null;

  constructor(camera: Camera) {
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.ctx.resume().catch(() => {});
    const master = this.listener.getInput();
    this.effects = this.bus(CONFIG.audio.effects, master);
    this.steps = this.bus(CONFIG.audio.steps, master);
    this.music = this.bus(0, master);
    this.instruments = this.bus(CONFIG.audio.instruments, master);
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
    this.loaded = true;
    if (this.musicOn) this.startMusic();
  }

  /** Starts the music from the top of the record, or fades it out. Before the files arrive, it starts once they do. */
  setMusic(on: boolean): void {
    if (on === this.musicOn) return;
    this.musicOn = on;
    if (!this.loaded) return;
    if (on) return this.startMusic();
    this.ramp(this.music.gain, 0, CONFIG.audio.musicFade);
    this.musicSource?.stop(this.ctx.currentTime + CONFIG.audio.musicFade);
    this.musicSource = null;
  }

  private startMusic(): void {
    this.musicSource?.stop();
    this.music.gain.cancelScheduledValues(this.ctx.currentTime);
    this.music.gain.setValueAtTime(0, this.ctx.currentTime);
    this.musicSource = this.loop('music', this.music);
    this.ramp(this.music.gain, CONFIG.audio.music, CONFIG.audio.musicFade);
  }

  door(node: Object3D, sound: DoorSound): void {
    this.play(DOOR_FILES[sound], this.effects, node);
  }

  /** A drawer or cupboard: the door sounds, quicker and quieter. */
  movable(node: Object3D, sound: DoorSound, slide: boolean): void {
    this.play(DOOR_FILES[sound], this.effects, node, slide ? 1.5 : 1.25, slide ? 0.45 : 0.6);
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
    (paused ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
  }

  /** The audio context, for the voices. */
  get context(): AudioContext {
    return this.ctx;
  }

  /** Where an instrument at a point (three.js space) is heard from (instrument-sound.ts): a panner there, on the
   * instruments' bus. */
  instrumentInput(at: [number, number, number]): AudioNode {
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.refDistance = CONFIG.instruments.reach;
    [panner.positionX.value, panner.positionY.value, panner.positionZ.value] = at;
    panner.connect(this.instruments);
    return panner;
  }

  /** A bus for the voices into the master, so mute and pause silence them too. */
  voiceOutput(level: number): GainNode {
    return this.bus(level, this.listener.getInput());
  }

  private bus(level: number, to: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = level;
    g.connect(to);
    return g;
  }

  private loop(name: string, to: AudioNode): AudioBufferSourceNode | null {
    const buffer = this.buffers.get(name);
    if (!buffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const [start, end] = loopBounds(buffer.getChannelData(0), Math.round(MAX_LOOP_TRIM * buffer.sampleRate));
    src.loopStart = start / buffer.sampleRate;
    src.loopEnd = end / buffer.sampleRate;
    src.connect(to);
    src.start(0, src.loopStart);
    return src;
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
    const out = at ? this.pannerAt(at.getWorldPosition(this.position), gain) : gain;
    out.connect(to);
    src.start();
  }

  /** `from` placed at a point, through an HRTF panner heard at full level within `ref` metres. */
  private pannerAt(p: Vector3, from: AudioNode, ref = 1): AudioNode {
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.refDistance = ref;
    panner.positionX.value = p.x;
    panner.positionY.value = p.y;
    panner.positionZ.value = p.z;
    from.connect(panner);
    return panner;
  }

  /** A rifle shot, made here rather than loaded: a burst of noise with a fast decay, low-passed. From another
   * shooter's spot, or (null) this visitor's own. */
  shot(at: Vector3 | null): void {
    const s = CONFIG.audio.shot;
    if (!this.shotNoise) {
      const n = Math.round(this.ctx.sampleRate * s.length);
      this.shotNoise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const data = this.shotNoise.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * s.decay));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.shotNoise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = s.cutoff;
    const gain = this.ctx.createGain();
    gain.gain.value = s.level;
    src.connect(filter).connect(gain);
    (at ? this.pannerAt(at, gain, s.reach) : gain).connect(this.effects);
    src.start();
  }

  private ramp(param: AudioParam, value: number, seconds: number): void {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + seconds);
  }
}
