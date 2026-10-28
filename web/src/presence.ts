import type { KeyValueStore } from './audio';
import { CONFIG } from './config';
import type { DoorState } from './doors';
import type { Target } from './interactions';
import type { LightGroups } from './lightmaps';
import type { MovableState } from './movables';
import type { Screen } from './screens';

/** Where a visitor stands and looks: x, z (m), yaw, pitch (radians). */
export type Pose = [number, number, number, number];
/** Sitting or lying: 1 sitting, 2 lying, then the seat's height (m) and the way it faces (yaw). */
export type Seating = [number, number, number];
/** A pose as sent: standing, or with how the visitor sits or lies (x, z are then the seat's spot), and then, while
 * the visitor is drunk, how drunk (0..1; the seating is 0, 0, 0 standing). Visitors from before seats existed drop the
 * longer forms, so they see a seated visitor standing where they last stood; visitors from before the wine drop the
 * drunk form, so a drunk visitor's animal stands still for them until it sobers up. */
export type PoseMessage = Pose | [number, number, number, number, number, number, number] | [number, number, number, number, number, number, number, number];
/** The flat's shared state: "door:<node>", "movable:<node>" → 0 or 1; "light:<group>" → 0 off, else its brightness
 * (1: as baked); "ct:<group>" → its colour temperature in mireds (0: as baked); "screen:<node>" → -1 off, else the channel. */
export type StateMap = Record<string, number>;
/** The parts of the world the shared state is read from and written to. */
export interface StateWorld {
  doors: { state: DoorState }[];
  movables: { state: MovableState }[];
  lights: LightGroups;
  screens: Screen[];
}

const NAME_KEY = 'walkthrough.name';

/** Trimmed and cut to length; blank is the default name. */
export function cleanName(raw: string | null | undefined, max = CONFIG.multiplayer.maxNameLength, fallback = CONFIG.multiplayer.defaultName): string {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return name || fallback;
}

export function loadName(storage: () => KeyValueStore): string {
  try {
    return storage().getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(storage: () => KeyValueStore, name: string): void {
  try {
    storage().setItem(NAME_KEY, name);
  } catch {
    // private mode: the name is just not remembered
  }
}

const ARRIVED_KEY = 'walkthrough.arrived.';

/** When this tab first arrived in the room (ms since 1970), kept across a reload so a host who reloads stays host; a
 * closed tab forgets it. Blocked storage: now. */
export function loadArrived(storage: () => KeyValueStore, room: string, now: number): number {
  try {
    const kept = Number(storage().getItem(ARRIVED_KEY + room));
    if (kept > 0 && Number.isFinite(kept)) return kept;
    storage().setItem(ARRIVED_KEY + room, String(now));
  } catch {
    // private mode: each reload arrives afresh
  }
  return now;
}

/** FNV-1a, so every browser picks the same colour for the same peer. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function colourFor(id: string, palette: readonly string[] = CONFIG.multiplayer.colours): string {
  return palette[hashId(id) % palette.length];
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** `drunk` (0..1) goes to the hundredth: it wears off slowly, and every change is a pose to send. */
export function encodePose(x: number, z: number, yaw: number, pitch: number, seating: Seating | null = null, drunk = 0): PoseMessage {
  const pose: Pose = [round(x), round(z), round(yaw), round(pitch)];
  const d = Math.round(Math.max(0, Math.min(1, drunk)) * 100) / 100;
  if (d > 0) return [...pose, seating?.[0] ?? 0, round(seating?.[1] ?? 0), round(seating?.[2] ?? 0), d];
  return seating ? [...pose, seating[0], round(seating[1]), round(seating[2])] : pose;
}

export function isPose(v: unknown): v is PoseMessage {
  return Array.isArray(v) && (v.length === 4 || v.length === 7 || v.length === 8) && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** The pose, the seating sitting or lying (anything but 1 or 2 is standing), and how drunk (0 sober). */
export function splitPose(m: PoseMessage): { pose: Pose; seating: Seating | null; drunk: number } {
  const n: readonly number[] = m;
  const pose: Pose = [n[0], n[1], n[2], n[3]];
  const seating: Seating | null = n.length >= 7 && (n[4] === 1 || n[4] === 2) ? [n[4], n[5], n[6]] : null;
  return { pose, seating, drunk: n.length === 8 ? Math.max(0, Math.min(1, n[7])) : 0 };
}

export function isStateMap(v: unknown): v is StateMap {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Whether two poses differ by more than rounding, or one sits and the other doesn't. */
export function poseMoved(a: PoseMessage | null, b: PoseMessage): boolean {
  return !a || a.length !== b.length || a.some((v, i) => Math.abs(v - b[i]) > 1e-4);
}

/** Send at the pose rate while moving, else at the idle rate as a heartbeat. */
export function shouldSend(lastSent: number, now: number, moved: boolean, rates: { poseRate: number; idleRate: number } = CONFIG.multiplayer): boolean {
  return now - lastSent >= 1 / (moved ? rates.poseRate : rates.idleRate);
}

/** The signed turn from one angle to another, the short way round. */
export function shortestTurn(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Eases `current` toward `target`: exponential smoothing with time constant `tau` (s), yaw by the shortest turn. */
export function smoothPose(current: Pose, target: Pose, dt: number, tau = CONFIG.multiplayer.smoothing): Pose {
  const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
  return [
    current[0] + (target[0] - current[0]) * k,
    current[1] + (target[1] - current[1]) * k,
    current[2] + shortestTurn(current[2], target[2]) * k,
    current[3] + (target[3] - current[3]) * k,
  ];
}

/** What a click changes in the flat: everything but a seat (where a visitor sits travels with their pose) and the wine
 * (each visitor drinks alone; how drunk they are travels with their pose too). */
export type SharedTarget = Exclude<Target, { kind: 'seat' | 'wine' }>;

/** The shared-state key a click on a target changes. A room's switch is the light group with the room's id. */
export function stateKey(t: SharedTarget): string {
  switch (t.kind) {
    case 'door': return `door:${t.door.info.node}`;
    case 'movable': return `movable:${t.movable.info.node}`;
    case 'lamp': return `light:${t.group}`;
    case 'screen': return `screen:${t.screen.info.node}`;
    default: return `light:${t.room}`;
  }
}

/** The target's state now, in shared form: what to tell the others after a click. */
export function stateValue(t: SharedTarget, lights: LightGroups): number {
  switch (t.kind) {
    case 'door': return t.door.isOpen ? 1 : 0;
    case 'movable': return t.movable.isOpen ? 1 : 0;
    case 'lamp': return lightValue(lights, t.group);
    case 'screen': return t.screen.on ? t.screen.channel : -1;
    default: return lightValue(lights, t.room);
  }
}

/** A light group in shared form: 0 off, else its brightness. */
export function lightValue(lights: LightGroups, id: string): number {
  return lights.isOn(id) ? round(lights.brightness(id)) : 0;
}

export function stateDelta(t: Target, lights: LightGroups): StateMap {
  return t.kind === 'seat' || t.kind === 'wine' ? {} : { [stateKey(t)]: stateValue(t, lights) };
}

/** Everything shared, for a newcomer. */
export function collectState(world: StateWorld): StateMap {
  const out: StateMap = {};
  for (const d of world.doors) out[`door:${d.state.info.node}`] = d.state.isOpen ? 1 : 0;
  for (const m of world.movables) out[`movable:${m.state.info.node}`] = m.state.isOpen ? 1 : 0;
  for (const id of world.lights.ids()) {
    out[`light:${id}`] = lightValue(world.lights, id);
    if (world.lights.mireds(id) > 0) out[`ct:${id}`] = world.lights.mireds(id);
  }
  for (const s of world.screens) out[`screen:${s.info.node}`] = s.on ? s.channel : -1;
  return out;
}

/** Sets the targets a delta names and returns the keys whose state actually changed. Unknown keys are ignored. */
export function applyState(world: StateWorld, delta: StateMap, now: number): string[] {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(delta)) {
    const i = key.indexOf(':');
    if (i < 0) continue;
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    if (kind === 'door' || kind === 'movable') {
      const list: { state: DoorState | MovableState }[] = kind === 'door' ? world.doors : world.movables;
      const s = list.find((d) => d.state.info.node === id)?.state;
      if (!s || s.target === (value ? 1 : 0)) continue;
      s.target = value ? 1 : 0;
    } else if (kind === 'light') {
      if (!world.lights.has(id) || lightValue(world.lights, id) === round(value)) continue;
      if (value > 0) world.lights.setScene(id, value);
      else world.lights.set(id, false);
    } else if (kind === 'ct') {
      if (!world.lights.has(id) || world.lights.mireds(id) === value) continue;
      world.lights.setTone(id, value);
    } else if (kind === 'screen') {
      const s = world.screens.find((sc) => sc.info.node === id);
      if (!s) continue;
      const on = value >= 0;
      if (s.on === on && (!on || s.channel === value)) continue;
      s.set(on, value, now);
    } else continue;
    changed.push(key);
  }
  return changed;
}

export interface PeerInfo { name: string | null; since: number | null; arrived: number | null; lastSeen: number }

/** Who is here: names, when they joined, when they last sent anything. */
export class Peers {
  private table = new Map<string, PeerInfo>();

  constructor(private staleAfter = CONFIG.multiplayer.staleAfter) {}

  get ids(): string[] {
    return [...this.table.keys()];
  }

  has(id: string): boolean {
    return this.table.has(id);
  }

  get(id: string): PeerInfo | undefined {
    return this.table.get(id);
  }

  /** Marks a peer alive; returns true when it is new. */
  seen(id: string, now: number): boolean {
    const p = this.table.get(id);
    if (p) {
      p.lastSeen = now;
      return false;
    }
    this.table.set(id, { name: null, since: null, arrived: null, lastSeen: now });
    return true;
  }

  /** `arrived` is when it first came to the room (a visitor from before hosts sends none: its join time stands in). */
  hello(id: string, name: string, since: number, now: number, arrived = since): void {
    this.seen(id, now);
    const p = this.table.get(id)!;
    p.name = name;
    p.since = since;
    p.arrived = arrived;
  }

  remove(id: string): boolean {
    return this.table.delete(id);
  }

  /** Removes peers silent for too long; returns their ids. */
  prune(now: number): string[] {
    const gone = this.ids.filter((id) => now - this.table.get(id)!.lastSeen > this.staleAfter);
    for (const id of gone) this.table.delete(id);
    return gone;
  }

  /** The names to show, in join order; a peer without a hello yet shows the default name. */
  names(fallback = CONFIG.multiplayer.defaultName): string[] {
    return [...this.table.values()].map((p) => p.name ?? fallback);
  }

  /** Ids, names and arrival and join times, in join order, for showing who is talking and who is host. */
  list(fallback = CONFIG.multiplayer.defaultName): { id: string; name: string; arrived: number | null; since: number | null }[] {
    return [...this.table].map(([id, p]) => ({ id, name: p.name ?? fallback, arrived: p.arrived, since: p.since }));
  }
}

/** A visitor, when it first arrived and when this page joined; both null until its hello. */
export interface Arrival { id: string; arrived: number | null; since: number | null }

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Earliest arrival first. A reloaded host has a new id but keeps its arrival, so on a tie the later join comes first
 * (the old id may linger), then the lower id; those without a hello come last, by id: the same order in every browser. */
export function byArrival(a: Arrival, b: Arrival): number {
  if (a.arrived === null || b.arrived === null) {
    return (a.arrived === null ? 1 : 0) - (b.arrived === null ? 1 : 0) || byId(a.id, b.id);
  }
  return a.arrived - b.arrived || (b.since ?? 0) - (a.since ?? 0) || byId(a.id, b.id);
}

/** The host: whoever arrived first among this visitor and the peers it has a hello from. */
export function hostOf(self: { id: string; arrived: number; since: number }, others: Arrival[]): string {
  return [self, ...others.filter((p) => p.arrived !== null)].sort(byArrival)[0].id;
}
