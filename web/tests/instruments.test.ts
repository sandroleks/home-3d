import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { InstrumentSound, midiFreq, pianoTone, pluck } from '../src/instrument-sound';
import { Vector3 } from 'three';
import {
  carryPose, chordsFor, HAND_KEYS, type InstrumentInfo, INSTRUMENT_KINDS, instrumentAt, isMusicMessage, keyLabel,
  type MusicMessage, NOTE_KEYS, noteFor, noteName, notesToPrepare, Playing, shiftLimits, strum,
} from '../src/instruments';

const info = (kind: InstrumentInfo['kind'], name: string = kind): InstrumentInfo =>
  ({ name, kind, room: 'quarto-03', min: [1, 0, -1], max: [2, 1, -0.5], at: [1.5, 0.5, -0.75] });

/** A seeded random, so the noise a pluck starts from is the same every run. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** The lag (samples) near `expect` at which the signal best matches itself: its period. */
function period(x: Float32Array, from: number, expected: number): number {
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.floor(expected * 0.8); lag <= Math.ceil(expected * 1.2); lag++) {
    let sum = 0;
    for (let i = from; i < from + 4000; i++) sum += x[i] * x[i + lag];
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  return bestLag;
}

describe('instruments', () => {
  it('finds the instrument whose box holds a point', () => {
    const list = [info('piano'), { ...info('synth'), min: [3, 0, 0] as [number, number, number], max: [4, 1, 1] as [number, number, number] }];
    expect(instrumentAt(list, 1.5, 0.5, -0.7)?.kind).toBe('piano');
    expect(instrumentAt(list, 2.02, 0.5, -0.7)?.kind).toBe('piano'); // just outside: the margin
    expect(instrumentAt(list, 3.5, 0.9, 0.5)?.kind).toBe('synth');
    expect(instrumentAt(list, 2.5, 0.5, 0)).toBeNull();
  });

  it('plays notes from the home row up, by position, within each instrument', () => {
    expect(noteFor('KeyA', 'piano', 0)).toBe(60);
    expect(noteFor('KeyW', 'piano', 0)).toBe(61);
    expect(noteFor('Quote', 'piano', 0)).toBe(77);
    expect(noteFor('KeyA', 'piano', 1)).toBe(72);
    expect(noteFor('KeyB', 'piano', 0)).toBeNull();
    expect(noteFor('KeyA', 'bass guitar', 0)).toBe(36);
    expect(noteFor('KeyA', 'bass guitar', -1)).toBeNull(); // C1: under the bass's low E
    expect(noteFor('KeyD', 'bass guitar', -1)).toBe(28); // E1, the bass's lowest
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C♯4');
    expect(keyLabel('Semicolon')).toBe(';');
    expect(keyLabel('KeyA')).toBe('A');
  });

  it('shifts octaves only while some key stays on the instrument', () => {
    for (const kind of INSTRUMENT_KINDS) {
      const [lo, hi] = shiftLimits(kind);
      for (const s of [lo, hi]) expect(NOTE_KEYS.some((k) => noteFor(k, kind, s) !== null)).toBe(true);
      expect(NOTE_KEYS.some((k) => noteFor(k, kind, lo - 1) !== null)).toBe(false);
      expect(NOTE_KEYS.some((k) => noteFor(k, kind, hi + 1) !== null)).toBe(false);
    }
    expect(shiftLimits('ukulele')).toEqual([-1, 2]); // C3 up to C6: the ukulele's C4..C6 on part of the keys
  });

  it('has eight chords that fit each instrument, one note a string', () => {
    for (const kind of INSTRUMENT_KINDS) {
      const chords = chordsFor(kind);
      expect(chords.map((c) => c.name)).toEqual(['C', 'G', 'Am', 'F', 'Dm', 'Em', 'D', 'E']);
      const [lo, hi] = CONFIG.instruments.range[kind];
      for (const c of chords) for (const n of c.notes) expect(n >= lo && n <= hi).toBe(true);
    }
    expect(chordsFor('electric guitar').every((c) => c.notes.length <= 6)).toBe(true);
    expect(chordsFor('ukulele').every((c) => c.notes.length === 4)).toBe(true);
    expect(chordsFor('ukulele')[0].notes).toEqual([67, 60, 64, 72]); // C: 0003, G string first
    expect(chordsFor('bass guitar')[2].notes).toEqual([45]);
    expect(new Set(chordsFor('piano')[2].notes.map((n) => n % 12))).toEqual(new Set([9, 0, 4])); // A minor
  });

  it('strums plucked chords string by string, down or up, and sounds keyboard chords together', () => {
    const gap = CONFIG.instruments.strumGap['electric guitar'];
    expect(strum('electric guitar', [40, 47, 52])).toEqual({ notes: [40, 47, 52], delays: [0, gap, 2 * gap] });
    expect(strum('electric guitar', [40, 47, 52], true).notes).toEqual([52, 47, 40]);
    expect(strum('piano', [48, 60, 64]).delays).toEqual([0, 0, 0]);
  });

  it('makes ahead the notes of the keys and the chords', () => {
    const notes = notesToPrepare('ukulele', 0);
    expect(notes).toContain(60);
    expect(notes).toContain(72);
    expect(new Set(notes).size).toBe(notes.length);
  });

  it('accepts only well-formed music messages', () => {
    expect(isMusicMessage({ i: 'Studio piano', n: [60, 64], on: true })).toBe(true);
    expect(isMusicMessage({ i: 'Studio ukulele 0', n: [67, 60], d: [0, 22], on: true })).toBe(true);
    expect(isMusicMessage({ i: 'x', n: [], on: true })).toBe(false);
    expect(isMusicMessage({ i: 'x', n: [128], on: true })).toBe(false);
    expect(isMusicMessage({ i: 'x', n: [60.5], on: true })).toBe(false);
    expect(isMusicMessage({ i: 'x', n: [60], d: [0, 1], on: true })).toBe(false);
    expect(isMusicMessage({ i: 'x', n: [60], on: 'yes' })).toBe(false);
    expect(isMusicMessage({ i: 'x'.repeat(81), n: [60], on: true })).toBe(false);
    expect(isMusicMessage(null)).toBe(false);
    expect(isMusicMessage({ i: 'x', n: [60], on: true, p: [1.2, 1.1, -0.4] })).toBe(true);
    expect(isMusicMessage({ i: 'x', n: [60], on: true, p: [1, 2] })).toBe(false);
    expect(isMusicMessage({ i: 'x', n: [60], on: true, p: [1, 2, Infinity] })).toBe(false);
  });
});

describe('Playing', () => {
  const play = (kind: InstrumentInfo['kind']) => {
    const sent: MusicMessage[] = [];
    return { p: new Playing(info(kind, `Studio ${kind}`), (m) => sent.push(m)), sent };
  };

  it('plays a key while it is held on the piano, once however long it repeats', () => {
    const { p, sent } = play('piano');
    expect(p.key('KeyA', true)).toBe(true);
    p.key('KeyA', true);
    expect(sent).toEqual([{ i: 'Studio piano', n: [60], on: true }]);
    expect(p.view().keys[0].down).toBe(true);
    p.key('KeyA', false);
    expect(sent[1]).toEqual({ i: 'Studio piano', n: [60], on: false });
    expect(p.key('KeyB', true)).toBe(false); // not the instrument's
  });

  it('lets a key go with the note it played, after the octave changed', () => {
    const { p, sent } = play('synth');
    p.key('KeyA', true);
    p.key('KeyX', true);
    p.key('KeyA', false);
    expect(sent.map((m) => [m.n, m.on])).toEqual([[[48], true], [[48], false]]);
    p.key('KeyA', true);
    expect(sent[2].n).toEqual([60]);
  });

  it('lets plucked strings ring: no note-off, and chords strum', () => {
    const { p, sent } = play('electric guitar');
    p.key('KeyA', true);
    p.key('KeyA', false);
    expect(sent).toHaveLength(1);
    p.key('Digit2', true); // G
    expect(sent[1].n).toEqual(chordsFor('electric guitar')[1].notes);
    expect(sent[1].d?.[1]).toBe(CONFIG.instruments.strumGap['electric guitar']);
    p.key('Digit2', false);
    p.key('Space', true, true); // G again, up
    expect(sent[2].n).toEqual([...chordsFor('electric guitar')[1].notes].reverse());
  });

  it('stays within the octaves the instrument has', () => {
    const { p } = play('ukulele');
    p.key('KeyZ', true);
    p.key('KeyZ', true);
    expect(p.shift).toBe(-1);
    expect(p.view().canDown).toBe(false);
    expect(p.view().keys.filter((k) => k.playable).map((k) => k.note)).toEqual(['C4', 'C♯4', 'D4', 'D♯4', 'E4', 'F4']);
    p.octave(5);
    expect(p.shift).toBe(2);
    expect(p.view().canUp).toBe(false);
  });

  it('plays in hand from the keys right of WASD, which walk', () => {
    const sent: MusicMessage[] = [];
    const p = new Playing(info('ukulele', 'Uke'), (m) => sent.push(m), HAND_KEYS);
    expect(p.key('KeyW', true)).toBe(false); // walking
    expect(p.key('KeyA', true)).toBe(false);
    expect(p.key('KeyH', true)).toBe(true);
    expect(sent[0].n).toEqual([60]);
    expect(noteFor('Backslash', 'ukulele', 0, HAND_KEYS)).toBe(71);
    expect(keyLabel('Backslash')).toBe('\\');
    expect(p.view().keys.map((k) => k.label).join('')).toBe("HUJIKLP;[']\\");
    p.key('Digit3', true);
    p.key('Digit3', false);
    p.strumAgain(); // a click: Am again
    expect(sent[2].n).toEqual(chordsFor('ukulele')[2].notes);
    expect(p.chordName).toBe('Am');
    p.strumAgain(); // and again: a click never sticks
    expect(sent).toHaveLength(4);
  });

  it('lets go of everything when the panel closes', () => {
    const { p, sent } = play('piano');
    p.key('KeyA', true);
    p.key('Digit1', true);
    p.releaseAll();
    expect(sent.filter((m) => !m.on).flatMap((m) => m.n).sort()).toEqual([48, 60, 60, 64, 67].sort());
    expect(p.view().keys.some((k) => k.down)).toBe(false);
  });
});

describe('carryPose', () => {
  it('holds a guitar across the body: neck left and up, strings out and up, its middle where the config says', () => {
    const c = { neck: [-1, 0, 0] as [number, number, number], face: [0, 0, -1] as [number, number, number], at: [-0.3, -0.2, 0] as [number, number, number] };
    const m = carryPose(0.1, c);
    const dir = (v: Vector3) => v.clone().transformDirection(m);
    expect(dir(new Vector3(0, 0, -1)).toArray().map((x) => +x.toFixed(6))).toEqual([-1, 0, 0]); // the head, lying along -z
    expect(dir(new Vector3(0, -1, 0)).toArray().map((x) => +x.toFixed(6))).toEqual([0, 0, -1]); // the strings, lying face down
    expect(new Vector3(0, 0.05, 0).applyMatrix4(m).toArray().map((x) => +x.toFixed(6))).toEqual([-0.3, -0.2, 0]); // its middle
    const tilted = carryPose(0.1); // the config's: neck up, strings up
    expect(new Vector3(0, 0, -1).transformDirection(tilted).y).toBeGreaterThan(0.2);
    expect(new Vector3(0, -1, 0).transformDirection(tilted).y).toBeGreaterThan(0.2);
  });
});

describe('instrument tones', () => {
  it('plucks a string in tune, high and low', () => {
    const rate = 48000;
    for (const midi of [40, 64, 81]) {
      const f = midiFreq(midi);
      const x = pluck(rate, f, { brightness: 0.8, pick: 0.15, t60: 2, seconds: 1, level: 0.3 }, seeded());
      const expected = rate / f;
      const lag = period(x, 2000, expected);
      expect(Math.abs(lag - expected)).toBeLessThan(1);
      expect(peak(x)).toBeLessThan(0.9); // the limiter
      const rms = Math.sqrt(x.slice(960, 3360).reduce((s, v) => s + v * v, 0) / 2400);
      expect(rms).toBeGreaterThan(0.22); // rings at about its level (a little under, through the limiter)
      expect(Math.abs(x[x.length - 1])).toBe(0); // faded out: no click at the end
    }
  });

  it('dies away over its decay time', () => {
    const rate = 48000;
    const x = pluck(rate, 220, { brightness: 0.8, pick: 0.15, t60: 0.5, seconds: 1, level: 0.3 }, seeded());
    const rms = (a: number, b: number) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
    expect(rms(24000, 26400) / rms(0, 2400)).toBeLessThan(0.01); // 0.5 s later: under -40 dB
  });

  it('makes a piano note at its pitch, longer in the bass', () => {
    const rate = 48000;
    const a4 = pianoTone(rate, 69, seeded());
    expect(Math.abs(period(a4, 4800, rate / 440) - rate / 440)).toBeLessThan(1);
    expect(pianoTone(rate, 36, seeded()).length).toBeGreaterThan(a4.length);
    expect(peak(a4)).toBeCloseTo(0.8, 2);
  });
});

/** Just enough of an AudioContext to follow the voices: what started and when each was told to stop. */
class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  stops: number[] = [];
  started = 0;
  createBuffer(_c: number, length: number) {
    return { duration: length / this.sampleRate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    return {
      buffer: null, connect: (n: unknown) => n, start: () => { this.started++; },
      stop: (at: number) => this.stops.push(at),
    };
  }
  createGain() {
    return { gain: param(), connect: (n: unknown) => n };
  }
  createBiquadFilter() {
    return { type: '', Q: param(), frequency: param(), connect: (n: unknown) => n };
  }
  createOscillator() {
    return {
      type: '', frequency: param(), detune: param(), connect: (n: unknown) => n, start: () => { this.started++; },
      stop: (at: number) => this.stops.push(at),
    };
  }
}
function param() {
  return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} };
}

describe('InstrumentSound', () => {
  const setup = () => {
    const ctx = new FakeContext();
    const s = new InstrumentSound(ctx as unknown as AudioContext, () => ({}) as AudioNode, seeded());
    return { ctx, s };
  };

  it('rings one note a string: a seventh on the guitar stops the oldest', () => {
    const { ctx, s } = setup();
    const g = info('electric guitar');
    for (const m of [40, 45, 50, 55, 59, 64]) s.noteOn(g, m, 'me');
    expect(ctx.stops).toHaveLength(0);
    s.noteOn(g, 67, 'me');
    expect(ctx.stops).toHaveLength(1);
  });

  it("re-plucks the same note, and lets go only of the owner's held keys", () => {
    const { ctx, s } = setup();
    const piano = info('piano');
    s.noteOn(piano, 60, 'me');
    s.noteOn(piano, 64, 'them');
    s.noteOff(piano, 64, 'me'); // not theirs to let go
    expect(ctx.stops).toHaveLength(0);
    s.noteOff(piano, 64, 'them');
    expect(ctx.stops).toHaveLength(1);
    s.noteOn(piano, 60, 'me'); // struck again: the first stops
    expect(ctx.stops).toHaveLength(2);
    s.release('me');
    expect(ctx.stops).toHaveLength(3);
  });

  it("hears a message on the instrument it names, at each note's delay", () => {
    const { ctx, s } = setup();
    s.hear({ i: 'Studio synth', n: [48, 52], on: true }, [info('synth', 'Studio synth')], 'them');
    expect(ctx.started).toBe(6); // three oscillators a note
    s.hear({ i: 'Studio harp', n: [48], on: true }, [info('synth', 'Studio synth')], 'them');
    expect(ctx.started).toBe(6);
  });

  it('sounds an instrument in hand from where the message says it is', () => {
    const ctx = new FakeContext();
    const panner = { positionX: param(), positionY: param(), positionZ: param() };
    const s = new InstrumentSound(ctx as unknown as AudioContext, () => panner as unknown as AudioNode, seeded());
    const uke = info('ukulele', 'Uke');
    s.hear({ i: 'Uke', n: [67], on: true, p: [1, 1.2, 0.4] }, [uke], 'them');
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([1, 1.2, 0.4]);
    s.hear({ i: 'Uke', n: [69], on: true, p: [3, 1.2, -2] }, [uke], 'them'); // they walked on
    expect(panner.positionX.value).toBe(3);
  });
});
