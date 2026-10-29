import { type Object3D, Vector3 } from 'three';
import type { Visibility } from './manifest';

/**
 * The rooms to draw from `from`: itself, and each room it sees through a set of doors that are all open (manifest
 * `visibility`, worked out by the export). null: draw everything (outside every room, or an export without the table).
 */
export function visibleRooms(vis: Visibility, from: string | null, open: (door: number) => boolean): Set<string> | null {
  if (from === null || !(from in vis)) return null;
  const out = new Set([from]);
  for (const [room, sets] of Object.entries(vis[from])) {
    if (sets.some((doors) => doors.every(open))) out.add(room);
  }
  return out;
}

/** Something drawn only when its room is: a room's chunk, a drawer, a mirror. Several rooms: drawn when any is (a door). */
export interface Culled { object: Object3D; rooms: string[] }
/** Something that moves between rooms (a loose thing): its room is looked up where it is, while it rests. */
export interface Wandering { objects: Object3D[]; resting: () => boolean; locate: (x: number, z: number) => string | null }

const at = new Vector3();

/**
 * Hides the rooms the visitor can't see, with their doors, drawers, mirrors and loose things: fewer draw calls and
 * nothing drawn behind walls. Only `visible` is touched, and only of what was visible: what something else hid stays
 * hidden, and `show()` gives back exactly what this hid. Apply before drawing and show after, each frame, so the
 * rest of the walkthrough always finds things as it left them.
 */
export class RoomCulling {
  private hidden: Object3D[] = [];
  private rooms = new Map<Object3D, { room: string | null; x: number; z: number }>();
  private from: string | null = null;
  private open: (door: number) => boolean = () => true;

  constructor(private vis: Visibility, private fixed: Culled[], private wandering: Wandering[] = []) {}

  /** Draw only what `from` sees; null shows everything. */
  apply(from: string | null, open: (door: number) => boolean): void {
    this.show();
    this.from = from;
    this.open = open;
    const seen = visibleRooms(this.vis, from, open);
    if (!seen) return;
    for (const c of this.fixed) {
      if (c.object.visible && !c.rooms.some((r) => seen.has(r))) this.hide(c.object);
    }
    for (const w of this.wandering) {
      if (!w.resting()) continue;
      const room = this.roomOf(w);
      if (room !== null && !seen.has(room)) for (const o of w.objects) if (o.visible) this.hide(o);
    }
  }

  show(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
  }

  /** Runs `draw` with what `room` sees (a mirror's view), then goes back to the visitor's. */
  seenFrom(room: string | null, draw: () => void): void {
    const [from, open] = [this.from, this.open];
    this.apply(room, open);
    try {
      draw();
    } finally {
      this.apply(from, open);
    }
  }

  private hide(o: Object3D): void {
    o.visible = false;
    this.hidden.push(o);
  }

  private roomOf(w: Wandering): string | null {
    const o = w.objects[0];
    o.getWorldPosition(at);
    const known = this.rooms.get(o);
    if (known && known.x === at.x && known.z === at.z) return known.room;
    const room = w.locate(at.x, at.z);
    this.rooms.set(o, { room, x: at.x, z: at.z });
    return room;
  }
}
