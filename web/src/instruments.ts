import { Matrix4, Vector3 } from 'three';
import { CONFIG } from './config';

/** The instruments visitors can play (`web_instrument` in the model). The sound is made here, in the browser
 * (instrument-sound.ts). The piano, the synth and the drums are played from a panel (instrument-panel.ts) with the
 * computer's keys or the panel's own; the guitars, the bass and the ukuleles are loose things (`prop`), played with the
 * keys while held, walking about. */
export type InstrumentKind = 'piano' | 'synth' | 'electric guitar' | 'bass guitar' | 'ukulele' | 'drums';
export const INSTRUMENT_KINDS: readonly InstrumentKind[] = ['piano', 'synth', 'electric guitar', 'bass guitar', 'ukulele', 'drums'];
/** An instrument from the manifest: its name in the model (it names it to the others too), its box in three.js space
 * (for clicking, or where it hangs), the point it sounds from, and its loose thing's node if it is picked up to play. */
export interface InstrumentInfo {
  name: string;
  kind: InstrumentKind;
  room: string;
  min: [number, number, number];
  max: [number, number, number];
  at: [number, number, number];
  prop?: string | null;
}

/** The instrument whose box (grown by `margin` m) holds a point, e.g. where the crosshair meets the room. */
export function instrumentAt(list: readonly InstrumentInfo[], x: number, y: number, z: number, margin = 0.03): InstrumentInfo | null {
  return list.find((i) => x >= i.min[0] - margin && x <= i.max[0] + margin && y >= i.min[1] - margin
    && y <= i.max[1] + margin && z >= i.min[2] - margin && z <= i.max[2] + margin) ?? null;
}

/** How a guitar, bass or ukulele in hand is held to play, from the hand's pose (holding.ts): across the body, the
 * neck to the left and up, the strings turned up to the player's eyes (CONFIG.instruments.carry). It
 * starts from how the loose thing lies when set down (surface-props.ts): head along -z, strings facing down, the origin
 * the middle of its base, `height` its thickness lying. */
export function carryPose(height: number, c = CONFIG.instruments.carry): Matrix4 {
  const head = new Vector3(...c.neck).normalize();
  const face = new Vector3(...c.face);
  face.addScaledVector(head, -face.dot(head)).normalize();
  const side = new Vector3().crossVectors(head, face);
  const lying = new Matrix4().makeBasis(new Vector3(-1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0));
  const turn = new Matrix4().makeBasis(side, head, face).multiply(lying.transpose());
  return new Matrix4().makeTranslation(...c.at).multiply(turn).multiply(new Matrix4().makeTranslation(0, -height / 2, 0));
}

/** Plucked strings and struck drums ring out by themselves; a key held on the piano or the synth sounds until it is
 * let go. */
export const ringsOut = (kind: InstrumentKind): boolean => kind !== 'piano' && kind !== 'synth';
/** The strings: chords are strummed on them, one note a string. */
export const isPlucked = (kind: InstrumentKind): boolean => ringsOut(kind) && kind !== 'drums';
/** How many notes an instrument that rings out rings at once: one a string; on the drums, a cymbal's tail and the
 * hits over it. */
export const STRINGS: Record<InstrumentKind, number> = { piano: 0, synth: 0, 'electric guitar': 6, 'bass guitar': 4, ukulele: 4, drums: 16 };

/** A pad of the drum kit: what it is, its General MIDI drum note (the note it sends, so a music message carries it
 * like any other), the computer keys that hit it (the first is shown on the pad) and where it sits in the panel
 * (grid column and row, and how many columns it spans), as the drummer sees the kit. */
export interface DrumPad { name: string; midi: number; keys: readonly string[]; at: readonly [number, number, number] }
/** The keys follow the kit: the left hand plays the snare (F, V for a side stick) and the toms (E R) on the left, the
 * right hand the hi-hat (J, U open, N pedal), as a drummer crosses over, and the floor tom (I) and ride (O, P the bell)
 * on the right; the crash is W, the kick Space or B. */
export const DRUM_PADS: readonly DrumPad[] = [
  { name: 'Crash', midi: 49, keys: ['KeyW'], at: [1, 1, 2] },
  { name: 'Tom 1', midi: 50, keys: ['KeyE'], at: [3, 1, 1] },
  { name: 'Tom 2', midi: 47, keys: ['KeyR'], at: [4, 1, 1] },
  { name: 'Ride', midi: 51, keys: ['KeyO'], at: [5, 1, 1] },
  { name: 'Bell', midi: 53, keys: ['KeyP'], at: [6, 1, 1] },
  { name: 'Hi-hat', midi: 42, keys: ['KeyJ'], at: [1, 2, 1] },
  { name: 'Open hat', midi: 46, keys: ['KeyU'], at: [2, 2, 1] },
  { name: 'Snare', midi: 38, keys: ['KeyF'], at: [3, 2, 1] },
  { name: 'Side stick', midi: 37, keys: ['KeyV'], at: [4, 2, 1] },
  { name: 'Floor tom', midi: 43, keys: ['KeyI'], at: [5, 2, 2] },
  { name: 'Hat pedal', midi: 44, keys: ['KeyN'], at: [1, 3, 2] },
  { name: 'Kick', midi: 36, keys: ['Space', 'KeyB'], at: [3, 3, 2] },
];
const HI_HAT = [42, 44, 46];
/** Whether a hit stops a drum still ringing: the hi-hat closing (or struck again) cuts its open ring; the rest ring
 * on over each other. */
export const chokes = (hit: number, ringing: number): boolean => HI_HAT.includes(hit) && HI_HAT.includes(ringing);

/** The keys that play notes, by position (KeyboardEvent.code, so any layout works), as in music apps: the home row
 * the white keys from C, the row above the black ones; 18 keys, C to the F an octave and a half up. */
export const NOTE_KEYS: readonly string[] = [
  'KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL',
  'KeyP', 'Semicolon', 'Quote',
];
/** With an instrument in hand the left hand walks (WASD), so the notes are on the right: the same piano layout from H,
 * the home row the white keys and the row above the black ones, C to B. */
export const HAND_KEYS: readonly string[] = [
  'KeyH', 'KeyU', 'KeyJ', 'KeyI', 'KeyK', 'KeyL', 'KeyP', 'Semicolon', 'BracketLeft', 'Quote', 'BracketRight', 'Backslash',
];
export const CHORD_KEYS: readonly string[] = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'];
export const OCTAVE_DOWN = 'KeyZ';
export const OCTAVE_UP = 'KeyX';
export const STRUM = 'Space';
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const noteName = (midi: number): string => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const isBlack = (midi: number): boolean => BLACK[((midi % 12) + 12) % 12];
const PUNCTUATION: Record<string, string> = { Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\' };
/** What a key's cap shows: its letter, or the character for a punctuation key. */
export const keyLabel = (code: string): string => PUNCTUATION[code] ?? code.replace(/^(Key|Digit)/, '');

/** The C the keys start on, `shift` octaves from the instrument's own. */
export const lowestC = (kind: InstrumentKind, shift: number): number => CONFIG.instruments.base[kind] + 12 * shift;

/** The octave shifts that leave at least one of `keys` on the instrument's range. */
export function shiftLimits(kind: InstrumentKind, keys: readonly string[] = NOTE_KEYS): [number, number] {
  const [lo, hi] = CONFIG.instruments.range[kind];
  const base = CONFIG.instruments.base[kind];
  return [Math.ceil((lo - keys.length + 1 - base) / 12), Math.floor((hi - base) / 12)];
}

/** The note a key of `keys` plays, or null when it isn't one or is off the instrument's range. */
export function noteFor(code: string, kind: InstrumentKind, shift: number, keys: readonly string[] = NOTE_KEYS): number | null {
  const i = keys.indexOf(code);
  if (i < 0) return null;
  const midi = lowestC(kind, shift) + i;
  const [lo, hi] = CONFIG.instruments.range[kind];
  return midi >= lo && midi <= hi ? midi : null;
}

export interface Chord { name: string; notes: number[] }
const CHORD_NAMES = ['C', 'G', 'Am', 'F', 'Dm', 'Em', 'D', 'E'];
/** Open voicings, string by string from the lowest (MIDI); the ukulele's is re-entrant (G C E A). The keyboards play the
 * root under a triad, the bass its root. */
const VOICINGS: Record<InstrumentKind, number[][]> = {
  'electric guitar': [
    [48, 52, 55, 60, 64], [43, 47, 50, 55, 59, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60, 65],
    [50, 57, 62, 65], [40, 47, 52, 55, 59, 64], [50, 57, 62, 66], [40, 47, 52, 56, 59, 64],
  ],
  ukulele: [
    [67, 60, 64, 72], [67, 62, 67, 71], [69, 60, 64, 69], [69, 60, 65, 69],
    [69, 62, 65, 69], [67, 64, 67, 71], [69, 62, 66, 69], [71, 64, 68, 71],
  ],
  'bass guitar': [[36], [43], [45], [41], [38], [40], [38], [40]],
  piano: [
    [48, 60, 64, 67], [43, 59, 62, 67], [45, 60, 64, 69], [41, 60, 65, 69],
    [50, 62, 65, 69], [40, 59, 64, 67], [50, 62, 66, 69], [40, 59, 64, 68],
  ],
  synth: [],
  drums: [],
};
VOICINGS.synth = VOICINGS.piano;

export const chordsFor = (kind: InstrumentKind): Chord[] => VOICINGS[kind].map((notes, i) => ({ name: CHORD_NAMES[i], notes }));

/** The notes worth making ahead (instrument-sound.ts) at an octave: the keys' and the chords'; the drums' pads. */
export function notesToPrepare(kind: InstrumentKind, shift: number, keys: readonly string[] = NOTE_KEYS): number[] {
  if (kind === 'drums') return DRUM_PADS.map((p) => p.midi);
  const notes = keys.map((code) => noteFor(code, kind, shift, keys)).filter((n): n is number => n !== null);
  return [...new Set([...chordsFor(kind).flatMap((c) => c.notes), ...notes])];
}

/** When each note of a chord starts (ms): a plucked chord is strummed, down from the lowest string or (`up`) back
 * up; the keyboards' sound together. */
export function strum(kind: InstrumentKind, notes: readonly number[], up = false): { notes: number[]; delays: number[] } {
  const order = up ? [...notes].reverse() : [...notes];
  const gap = isPlucked(kind) ? CONFIG.instruments.strumGap[kind] : 0;
  return { notes: order, delays: order.map((_, i) => i * gap) };
}

/** Notes played or let go on an instrument, to everyone here and to this visitor's own speakers alike. `d`: each
 * note's delay in ms (a strum); `p`: where it sounds (three.js space), for an instrument in someone's hands. */
export interface MusicMessage { i: string; n: number[]; d?: number[]; on: boolean; p?: [number, number, number] }

const isNote = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 127;
export function isMusicMessage(v: unknown): v is MusicMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as MusicMessage;
  if (typeof m.i !== 'string' || m.i.length > 80 || typeof m.on !== 'boolean') return false;
  if (!Array.isArray(m.n) || m.n.length < 1 || m.n.length > 8 || !m.n.every(isNote)) return false;
  if (m.p !== undefined && !(Array.isArray(m.p) && m.p.length === 3
    && m.p.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1000))) return false;
  return m.d === undefined || (Array.isArray(m.d) && m.d.length === m.n.length
    && m.d.every((d) => typeof d === 'number' && d >= 0 && d <= 1000));
}

/** What the panel shows: the keys with their notes, the chords and what is held down; on the drums, the pads. */
export interface PanelKey { code: string; label: string; note: string; black: boolean; playable: boolean; down: boolean }
export interface PanelPad { code: string; label: string; name: string; at: readonly [number, number, number]; down: boolean }
export interface InstrumentPanelView {
  title: string;
  range: string;
  keys: PanelKey[];
  pads: PanelPad[];
  chords: { label: string; key: string; down: boolean }[];
  canDown: boolean;
  canUp: boolean;
  hint: string;
}

export const INSTRUMENT_COPY = {
  hintPlucked: 'Letter keys play notes, 1–8 strum chords, Space strums again (Shift+Space up), Z and X change octave',
  hintKeys: 'Letter keys play notes, 1–8 play chords, Z and X change octave',
  hintDrums: 'Space kick · F snare · J hi-hat (U open, N pedal) · E R I toms · W crash · O ride, P bell',
  /** With an instrument in hand, what the prompt says when the crosshair is on nothing else. */
  inHand: (chord: string) => `${chord} · 1–8 chords · Space or click strums · H J K L ; ' notes (row above: sharps) · Z X octave · Q drops it`,
};

/** One visitor at one instrument: the octave, the keys and chord held down, and what to send when they change. */
export class Playing {
  shift = 0;
  /** Bumped on every change the panel shows. */
  version = 0;
  /** The last chord picked, for Space. */
  private chord = 0;
  private held = new Map<string, number[]>();

  /** `keys`: the note keys, NOTE_KEYS at a panel, HAND_KEYS with the instrument in hand. */
  constructor(readonly instrument: InstrumentInfo, private send: (m: MusicMessage) => void, readonly keys: readonly string[] = NOTE_KEYS) {}

  get kind(): InstrumentKind {
    return this.instrument.kind;
  }

  /** The chord Space or a click strums. */
  get chordName(): string {
    return chordsFor(this.kind)[this.chord]?.name ?? '';
  }

  /** A click: the last chord strummed again, down (or `up`). */
  strumAgain(up = false): void {
    this.press('Click', this.chordNotes(this.chord), up);
    this.release('Click');
  }

  /** A key going down or up (KeyboardEvent.code). True when it was the instrument's. */
  key(code: string, down: boolean, shiftKey = false): boolean {
    if (this.kind === 'drums') return this.hit(code, down);
    if (code === OCTAVE_DOWN || code === OCTAVE_UP) {
      if (down) this.octave(code === OCTAVE_UP ? 1 : -1);
      return true;
    }
    if (code === STRUM) {
      if (down) this.press(code, this.chordNotes(this.chord), shiftKey);
      else this.release(code);
      return true;
    }
    const c = CHORD_KEYS.indexOf(code);
    if (c >= 0 && c < chordsFor(this.kind).length) {
      if (down) {
        this.chord = c;
        this.press(code, this.chordNotes(c));
      } else this.release(code);
      return true;
    }
    if (!this.keys.includes(code)) return false;
    const note = noteFor(code, this.kind, this.shift, this.keys);
    if (!down) this.release(code);
    else if (note !== null) this.press(code, [note]);
    return true;
  }

  octave(delta: number): void {
    const [lo, hi] = shiftLimits(this.kind, this.keys);
    const next = Math.max(lo, Math.min(hi, this.shift + delta));
    if (next === this.shift) return;
    this.shift = next;
    this.version++;
  }

  /** Lets go of everything held: closing the panel, or the window losing focus. */
  releaseAll(): void {
    for (const code of [...this.held.keys()]) this.release(code);
  }

  view(): InstrumentPanelView {
    if (this.kind === 'drums') {
      return {
        title: this.kind, range: '', keys: [], chords: [], canDown: false, canUp: false, hint: INSTRUMENT_COPY.hintDrums,
        pads: DRUM_PADS.map((p) => ({
          code: p.keys[0], label: keyLabel(p.keys[0]), name: p.name, at: p.at, down: p.keys.some((k) => this.held.has(k)),
        })),
      };
    }
    const [lo, hi] = shiftLimits(this.kind, this.keys);
    const c = lowestC(this.kind, this.shift);
    const plucked = isPlucked(this.kind);
    return {
      title: this.kind,
      range: `${noteName(c)}–${noteName(c + this.keys.length - 1)}`,
      keys: this.keys.map((code, i) => ({
        code, label: keyLabel(code), note: noteName(c + i), black: isBlack(c + i),
        playable: noteFor(code, this.kind, this.shift, this.keys) !== null, down: this.held.has(code),
      })),
      pads: [],
      chords: chordsFor(this.kind).map((ch, i) => ({ label: ch.name, key: CHORD_KEYS[i], down: this.held.has(CHORD_KEYS[i]) })),
      canDown: this.shift > lo,
      canUp: this.shift < hi,
      hint: plucked ? INSTRUMENT_COPY.hintPlucked : INSTRUMENT_COPY.hintKeys,
    };
  }

  /** A pad's key on the drums: a hit going down; nothing to let go of, the drum rings out. */
  private hit(code: string, down: boolean): boolean {
    const pad = DRUM_PADS.find((p) => p.keys.includes(code));
    if (!pad) return false;
    if (down) this.press(code, [pad.midi]);
    else this.release(code);
    return true;
  }

  private chordNotes(i: number): number[] {
    return chordsFor(this.kind)[i]?.notes ?? [];
  }

  private press(code: string, notes: number[], up = false): void {
    if (this.held.has(code) || !notes.length) return; // a key repeating
    this.held.set(code, notes);
    this.version++;
    const s = strum(this.kind, notes, up);
    this.send({ i: this.instrument.name, n: s.notes, ...(s.delays.some((d) => d > 0) ? { d: s.delays } : {}), on: true });
  }

  private release(code: string): void {
    const notes = this.held.get(code);
    if (!notes) return;
    this.held.delete(code);
    this.version++;
    if (!ringsOut(this.kind)) this.send({ i: this.instrument.name, n: notes, on: false }); // strings and drums ring on
  }
}
