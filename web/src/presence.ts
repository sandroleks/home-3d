import type { KeyValueStore } from './audio';
import { CONFIG } from './config';
import type { DoorState } from './doors';
import type { Target } from './interactions';
import type { LightGroups } from './lightmaps';
import type { MovableState } from './movables';
import type { Screen } from './screens';

/** Where a visitor stands and looks: x, z (m), yaw, pitch (radians). */
export type Pose = [number, number, number, number];
/** The flat's shared state: "door:<node>", "movable:<node>", "light:<group>" → 0 or 1; "screen:<node>" → -1 off, else the channel. */
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

export function encodePose(x: number, z: number, yaw: number, pitch: number): Pose {
  return [round(x), round(z), round(yaw), round(pitch)];
}

export function isPose(v: unknown): v is Pose {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function isStateMap(v: unknown): v is StateMap {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Whether two poses differ by more than rounding. */
export function poseMoved(a: Pose | null, b: Pose): boolean {
  return !a || a.some((v, i) => Math.abs(v - b[i]) > 1e-4);
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

/** The shared-state key a click on a target changes. A room's switch is the light group with the room's id. */
export function stateKey(t: Target): string {
  switch (t.kind) {
    case 'door': return `door:${t.door.info.node}`;
    case 'movable': return `movable:${t.movable.info.node}`;
    case 'lamp': return `light:${t.group}`;
    case 'screen': return `screen:${t.screen.info.node}`;
    default: return `light:${t.room}`;
  }
}

/** The target's state now, in shared form: what to tell the others after a click. */
export function stateValue(t: Target, lights: LightGroups): number {
  switch (t.kind) {
    case 'door': return t.door.isOpen ? 1 : 0;
    case 'movable': return t.movable.isOpen ? 1 : 0;
    case 'lamp': return lights.isOn(t.group) ? 1 : 0;
    case 'screen': return t.screen.on ? t.screen.channel : -1;
    default: return lights.isOn(t.room) ? 1 : 0;
  }
}

export function stateDelta(t: Target, lights: LightGroups): StateMap {
  return { [stateKey(t)]: stateValue(t, lights) };
}

/** Everything shared, for a newcomer. */
export function collectState(world: StateWorld): StateMap {
  const out: StateMap = {};
  for (const d of world.doors) out[`door:${d.state.info.node}`] = d.state.isOpen ? 1 : 0;
  for (const m of world.movables) out[`movable:${m.state.info.node}`] = m.state.isOpen ? 1 : 0;
  for (const id of world.lights.ids()) out[`light:${id}`] = world.lights.isOn(id) ? 1 : 0;
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
      if (!world.lights.has(id) || world.lights.isOn(id) === !!value) continue;
      world.lights.set(id, !!value);
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

export interface PeerInfo { name: string | null; since: number | null; lastSeen: number }

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
    this.table.set(id, { name: null, since: null, lastSeen: now });
    return true;
  }

  hello(id: string, name: string, since: number, now: number): void {
    this.seen(id, now);
    const p = this.table.get(id)!;
    p.name = name;
    p.since = since;
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
}
