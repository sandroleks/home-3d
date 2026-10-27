import { CONFIG } from './config';

/** Sitting (on a seat or on the floor) or lying (on a bed). */
export type Posture = 'sit' | 'lie';
type Vec3 = [number, number, number];
/** A place to sit or lie: where the body rests (on the seat's surface) and which way it faces (yaw, as the camera's). */
export interface Spot { at: Vec3; yaw: number }
/** A sofa cushion, chair, stool, bench or bed (seats.json, from the export): its box, for clicking, and its spots. */
export interface Seat { name: string; pose: Posture; min: Vec3; max: Vec3; spots: Spot[] }
/** Where a visitor sits or lies: the spot's place and facing. On the floor, `y` is 0 and `yaw` the way they looked. */
export interface Seated { posture: Posture; x: number; y: number; z: number; yaw: number }

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** The seats in seats.json; anything malformed is left out. */
export function parseSeats(data: unknown): Seat[] {
  const list = (data as { seats?: unknown } | null)?.seats;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s): Seat[] => {
    if (!s || typeof s !== 'object') return [];
    const { name, pose, min, max, spots } = s as Record<string, unknown>;
    if (typeof name !== 'string' || (pose !== 'sit' && pose !== 'lie') || !isVec3(min) || !isVec3(max) || !Array.isArray(spots)) return [];
    const ok = spots.filter((p): p is Spot => !!p && isVec3((p as Spot).at) && typeof (p as Spot).yaw === 'number');
    return ok.length ? [{ name, pose, min, max, spots: ok }] : [];
  });
}

/** The seat whose box (grown by `margin` m, and by `above` m upward for a duvet or throw on top) holds a point, e.g.
 * where the crosshair meets a cushion. */
export function seatAt(seats: Seat[], x: number, y: number, z: number, margin = 0.05, above = 0.15): Seat | null {
  return seats.find((s) => x >= s.min[0] - margin && x <= s.max[0] + margin && y >= s.min[1] - margin
    && y <= s.max[1] + above && z >= s.min[2] - margin && z <= s.max[2] + margin) ?? null;
}

/** The free spot nearest to x, z (where the seat was clicked), or null when everyone's taken. */
export function freeSpot(seat: Seat, x: number, z: number, taken: (x: number, z: number) => boolean): Spot | null {
  let best: Spot | null = null;
  let bestD = Infinity;
  for (const s of seat.spots) {
    if (taken(s.at[0], s.at[2])) continue;
    const d = Math.hypot(s.at[0] - x, s.at[2] - z);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export function seatedOn(spot: Spot, posture: Posture): Seated {
  return { posture, x: spot.at[0], y: spot.at[1], z: spot.at[2], yaw: spot.yaw };
}

/** Where the eyes are: above the seat, a little back from its middle (toward the pillows, lying down). */
export function eyeOf(s: Seated, cfg = CONFIG.seats): Vec3 {
  const back = s.posture === 'lie' ? cfg.lieBack : cfg.sitBack;
  return [s.x + Math.sin(s.yaw) * back, s.y + (s.posture === 'lie' ? cfg.lieEye : cfg.sitEye), s.z + Math.cos(s.yaw) * back];
}

/** Where to stand up to: a step in front of the seat (the caller finds the nearest free spot to it). */
export function standPoint(s: Seated, step = CONFIG.seats.standStep): [number, number] {
  if (s.y < 0.05) return [s.x, s.z]; // on the floor: get up where you sat
  return [s.x - Math.sin(s.yaw) * step, s.z - Math.cos(s.yaw) * step];
}

/** In shared form (presence.ts): 1 sitting, 2 lying, then the seat's height and facing. */
export function seatingCode(s: Seated | null): [number, number, number] | null {
  return s ? [s.posture === 'lie' ? 2 : 1, s.y, s.yaw] : null;
}
