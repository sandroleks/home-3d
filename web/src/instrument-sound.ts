import { CONFIG } from './config';
import { type InstrumentInfo, type InstrumentKind, isPlucked, type MusicMessage, STRINGS } from './instruments';

export const midiFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** How each plucked instrument's string sounds: how bright the pluck (0..1), where along the string it is plucked
 * (0..0.5), the seconds it takes to die away by 60 dB, how long the sample is, and how loud it rings just after the
 * pluck (RMS; louder is pushed into the limiter a little, the electric's amp). */
interface StringTone { brightness: number; pick: number; t60: number; seconds: number; level: number }
const STRING_TONES: Record<'electric guitar' | 'bass guitar' | 'ukulele', StringTone> = {
  'electric guitar': { brightness: 0.75, pick: 0.13, t60: 3.2, seconds: 3, level: 0.34 },
  'bass guitar': { brightness: 0.35, pick: 0.2, t60: 4.5, seconds: 3.5, level: 0.3 },
  ukulele: { brightness: 0.85, pick: 0.22, t60: 2, seconds: 2, level: 0.26 },
};

/** A plucked string (Karplus–Strong, with an allpass for the fraction of a sample the period needs, so high notes
 * stay in tune): a burst of filtered noise in a delay line one period long, averaged and damped each time round. */
export function pluck(sampleRate: number, freq: number, tone: StringTone, random = Math.random): Float32Array {
  const length = Math.round(sampleRate * tone.seconds);
  const out = new Float32Array(length);
  const period = sampleRate / freq - 0.5; // the averaging delays half a sample
  const n = Math.max(2, Math.floor(period - 0.1));
  const frac = period - n;
  const c = (1 - frac) / (1 + frac);
  const line = new Float32Array(n);
  let e = 0;
  const smooth = 0.15 + 0.85 * tone.brightness;
  for (let i = 0; i < n; i++) line[i] = e += smooth * (random() * 2 - 1 - e);
  const pick = Math.max(1, Math.round(tone.pick * n)); // plucked off the end: a comb takes out those harmonics
  const excited = line.map((v, i) => v - (i >= pick ? line[i - pick] : 0));
  const mean = excited.reduce((a, v) => a + v, 0) / n;
  for (let i = 0; i < n; i++) line[i] = excited[i] - mean;
  const loss = 10 ** (-3 / (tone.t60 * freq));
  let prev = 0;
  let apIn = 0;
  let apOut = 0;
  let k = 0;
  for (let i = 0; i < length; i++) {
    const x = line[k];
    const avg = 0.5 * (x + prev);
    prev = x;
    apOut = c * avg + apIn - c * apOut;
    apIn = avg;
    line[k] = loss * apOut;
    k = k + 1 === n ? 0 : k + 1;
    out[i] = x;
  }
  // Loud as it rings, not as the noise it starts from (a bright pluck's first spike is many times louder): scaled to
  // `level` over 20..70 ms, and the spike rounded off by a soft limiter.
  const a = Math.round(sampleRate * 0.02);
  const b = Math.min(length, Math.round(sampleRate * 0.07));
  let sum = 0;
  for (let i = a; i < b; i++) sum += out[i] * out[i];
  const gain = tone.level / (Math.sqrt(sum / Math.max(1, b - a)) || 1);
  for (let i = 0; i < length; i++) out[i] = 0.9 * Math.tanh((gain * out[i]) / 0.9);
  fadeOut(out, Math.round(sampleRate * 0.05));
  return out;
}

/** A piano note: the string's partials, slightly sharp the higher they go (a real string's stiffness), two strings a
 * hair apart for the chorus, each partial dying fast at first and then slowly, the high ones sooner; and the hammer's
 * thud. Lower notes ring longer. */
export function pianoTone(sampleRate: number, midi: number, random = Math.random): Float32Array {
  const f = midiFreq(midi);
  const register = Math.min(2.5, Math.max(0.35, 2 ** ((60 - midi) / 24)));
  const seconds = Math.min(5, Math.max(1.2, 3 * register));
  const length = Math.round(sampleRate * seconds);
  const out = new Float32Array(length);
  const stiffness = 0.0001 * 2 ** ((midi - 60) / 20);
  const top = Math.min(sampleRate / 2 - 500, 9000);
  for (let k = 1; k <= 18; k++) {
    const fk = k * f * Math.sqrt(1 + stiffness * k * k);
    if (fk > top) break;
    const amp = (1 / k ** 1.25) * (k === 1 ? 1 : 0.9);
    const fast = Math.exp(-1 / (sampleRate * 0.35 * register / (1 + 0.25 * (k - 1))));
    const slow = Math.exp(-1 / (sampleRate * 2.4 * register / (1 + 0.35 * (k - 1))));
    for (const detune of [1, 1.0007]) {
      const w = (2 * Math.PI * fk * detune) / sampleRate;
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      let re = 1;
      let im = 0;
      let a = 0.65 * amp * 0.5;
      let b = 0.35 * amp * 0.5;
      for (let i = 0; i < length; i++) {
        out[i] += (a + b) * im;
        const r = re * cw - im * sw;
        im = re * sw + im * cw;
        re = r;
        a *= fast;
        b *= slow;
      }
    }
  }
  const thud = Math.round(sampleRate * 0.02);
  let lp = 0;
  for (let i = 0; i < thud && i < length; i++) {
    lp += 0.2 * (random() * 2 - 1 - lp);
    out[i] += 0.25 * lp * (1 - i / thud);
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const attack = Math.round(sampleRate * 0.002);
  for (let i = 0; i < length; i++) out[i] = (0.8 * out[i] / (peak || 1)) * (i < attack ? i / attack : 1);
  fadeOut(out, Math.round(sampleRate * 0.1));
  return out;
}

function fadeOut(out: Float32Array, n: number): void {
  for (let i = 0; i < n && i < out.length; i++) out[out.length - 1 - i] *= i / n;
}

/** A note sounding: who played it, when it ends by itself, and how to stop it sooner (from `at`, in the context's
 * time). */
interface Voice { owner: string; instrument: string; midi: number; started: number; ends: number; held: boolean; stop(at: number, fade: number): void }
type Sounding = Pick<Voice, 'stop' | 'ends'>;

/** The instruments' sound, for this visitor's playing and the others' alike. Samples are made on first use and kept;
 * `prepare` makes an instrument's ahead of time, a few at a time, so the first notes come without a stutter. */
export class InstrumentSound {
  private samples = new Map<string, AudioBuffer>();
  private inputs = new Map<string, AudioNode>();
  private voices: Voice[] = [];

  /** `input`: where an instrument at a point (three.js space) is heard from: a panner on the instruments' bus. */
  constructor(private ctx: AudioContext, private input: (at: [number, number, number]) => AudioNode, private random = Math.random) {}

  /** Plays or lets go of what a message says, on the instrument it names (one of `instruments`). `owner`: whose
   * playing it is, so a visitor leaving lets go of theirs. */
  hear(m: MusicMessage, instruments: readonly InstrumentInfo[], owner: string): void {
    const ins = instruments.find((i) => i.name === m.i);
    if (!ins) return;
    if (m.p) this.moveTo(ins, m.p); // in someone's hands
    if (!m.on) {
      for (const midi of m.n) this.noteOff(ins, midi, owner);
      return;
    }
    m.n.forEach((midi, k) => this.noteOn(ins, midi, owner, (m.d?.[k] ?? 0) / 1000));
  }

  noteOn(ins: InstrumentInfo, midi: number, owner: string, delay = 0): void {
    const at = this.ctx.currentTime + delay;
    this.voices = this.voices.filter((v) => v.ends > this.ctx.currentTime); // rung out
    const plucked = isPlucked(ins.kind);
    for (const v of this.voices) { // the same note again: a string re-plucked, a key struck again
      if (v.instrument === ins.name && v.midi === midi) this.stop(v, at, plucked ? 0.03 : 0.08);
    }
    if (plucked) { // one note a string
      const ringing = this.voices.filter((v) => v.instrument === ins.name);
      for (const v of ringing.slice(0, Math.max(0, ringing.length - STRINGS[ins.kind] + 1))) this.stop(v, at, 0.05);
    }
    const all = this.voices.length - CONFIG.instruments.polyphony + 1;
    for (const v of this.voices.slice(0, Math.max(0, all))) this.stop(v, at, 0.05);
    const out = this.inputFor(ins);
    const voice = ins.kind === 'synth' ? this.synthVoice(midi, at, out) : this.sampleVoice(ins.kind, midi, at, out);
    this.voices.push({ ...voice, owner, instrument: ins.name, midi, started: at, held: !plucked });
  }

  noteOff(ins: InstrumentInfo, midi: number, owner: string): void {
    const at = this.ctx.currentTime;
    for (const v of this.voices) {
      if (v.instrument === ins.name && v.midi === midi && v.owner === owner && v.held) this.stop(v, at, ins.kind === 'synth' ? 0.35 : 0.15);
    }
  }

  /** Lets go of everything a visitor holds (they left), or everything. */
  release(owner?: string): void {
    const at = this.ctx.currentTime;
    for (const v of [...this.voices]) if (owner === undefined || v.owner === owner) this.stop(v, at, 0.2);
  }

  /** Makes an instrument's samples ahead of time, a few notes each tick. */
  prepare(kind: InstrumentKind, notes: readonly number[]): void {
    if (kind === 'synth') return;
    const todo = notes.filter((m) => !this.samples.has(`${kind}:${m}`));
    const step = () => {
      for (const m of todo.splice(0, 3)) this.sample(kind, m);
      if (todo.length) setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  private stop(v: Voice, at: number, fade: number): void {
    v.stop(Math.max(at, v.started), fade);
    this.voices = this.voices.filter((x) => x !== v);
  }

  /** An instrument carried about: its panner follows it. */
  private moveTo(ins: InstrumentInfo, p: [number, number, number]): void {
    const node = this.inputFor(ins) as Partial<PannerNode>;
    if (!node.positionX || !node.positionY || !node.positionZ) return;
    [node.positionX.value, node.positionY.value, node.positionZ.value] = p;
  }

  private inputFor(ins: InstrumentInfo): AudioNode {
    let node = this.inputs.get(ins.name);
    if (!node) {
      node = this.input(ins.at);
      this.inputs.set(ins.name, node);
    }
    return node;
  }

  private sample(kind: InstrumentKind, midi: number): AudioBuffer {
    const key = `${kind}:${midi}`;
    let buffer = this.samples.get(key);
    if (!buffer) {
      const rate = this.ctx.sampleRate;
      const data = kind === 'piano' ? pianoTone(rate, midi, this.random)
        : pluck(rate, midiFreq(midi), STRING_TONES[kind as keyof typeof STRING_TONES], this.random);
      buffer = this.ctx.createBuffer(1, data.length, rate);
      buffer.getChannelData(0).set(data);
      this.samples.set(key, buffer);
    }
    return buffer;
  }

  private sampleVoice(kind: InstrumentKind, midi: number, at: number, out: AudioNode): Sounding {
    const src = this.ctx.createBufferSource();
    const buffer = this.sample(kind, midi);
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = kind === 'bass guitar' ? 1 : 0.7;
    src.connect(gain).connect(out);
    src.start(at);
    let stopped = false;
    return {
      ends: at + buffer.duration,
      stop: (when, fade) => {
        if (stopped) return;
        stopped = true;
        gain.gain.setValueAtTime(gain.gain.value, when);
        gain.gain.linearRampToValueAtTime(0, when + fade);
        src.stop(when + fade + 0.01);
      },
    };
  }

  /** The synth: two sawtooths a few cents apart and a square an octave down, through a resonant low-pass that opens
   * with each note, on an envelope that holds while the key does. */
  private synthVoice(midi: number, at: number, out: AudioNode): Sounding {
    const ends = at + CONFIG.instruments.maxHold; // a release that never comes
    const f = midiFreq(midi);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(Math.min(300 + f, 18000), at);
    filter.frequency.linearRampToValueAtTime(Math.min(3200 + 2 * f, 18000), at + 0.03);
    filter.frequency.setTargetAtTime(Math.min(1100 + 1.5 * f, 18000), at + 0.03, 0.25);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(0.32, at + 0.008);
    amp.gain.setTargetAtTime(0.22, at + 0.008, 0.2);
    const oscs = ([['sawtooth', f, -7, 1], ['sawtooth', f, 7, 1], ['square', f / 2, 0, 0.5]] as const).map(([type, freq, cents, level]) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = cents;
      const g = this.ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(filter);
      o.start(at);
      o.stop(ends);
      return o;
    });
    filter.connect(amp).connect(out);
    let stopped = false;
    return {
      ends,
      stop: (when, fade) => {
        if (stopped) return;
        stopped = true;
        amp.gain.cancelScheduledValues(when);
        amp.gain.setTargetAtTime(0, when, fade / 4);
        for (const o of oscs) o.stop(when + fade + 0.05);
      },
    };
  }
}
