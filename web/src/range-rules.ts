import { CONFIG } from './config';
import { type Flight, flightAt, type Vec3 } from './range-flights';

/** A hit someone claims: which target (its place in the round's schedule), when in the round (s), and by whom. */
export type Claim = { target: number; t: number; by: string };
/** A shooter on the board: their place (ties share one), name and points. */
export interface Standing { id: string; name: string; score: number; place: number }

/** The target a shot from `o` along `d` (a unit vector) hits at round time `t`: the nearest along the line whose hit
 * zone the line passes through, among those in the air and not broken; null for a miss. */
export function rayHit(flights: readonly Flight[], broken: ReadonlySet<number>, t: number, o: Vec3, d: Vec3, cfg = CONFIG.range): number | null {
  let best: number | null = null;
  let nearest = Infinity;
  for (const f of flights) {
    if (broken.has(f.i)) continue;
    const p = flightAt(f, t, cfg);
    if (!p) continue;
    const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const along = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
    if (along <= 0) continue;
    const off = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] - along * along;
    const r = cfg.kinds[f.kind].hit;
    if (off <= r * r && along < nearest) {
      best = f.i;
      nearest = along;
    }
  }
  return best;
}

/** Each claimed target's winner: the earliest claim by round time, ties to the lower id, whatever order they came in. */
export function winners(claims: readonly Claim[]): Map<number, Claim> {
  const won = new Map<number, Claim>();
  for (const c of claims) {
    const w = won.get(c.target);
    if (!w || c.t < w.t || (c.t === w.t && c.by < w.by)) won.set(c.target, c);
  }
  return won;
}

/** The board: every player (on 0 too) and every winner, highest first, then by name; ties share a place. A winner
 * with no name here (they left before this browser heard it) is a guest. */
export function standings(players: ReadonlyMap<string, string>, claims: readonly Claim[], flights: readonly Flight[], cfg = CONFIG.range): Standing[] {
  const score = new Map<string, number>([...players.keys()].map((id) => [id, 0]));
  for (const c of winners(claims).values()) {
    const f = flights[c.target];
    if (f) score.set(c.by, (score.get(c.by) ?? 0) + cfg.kinds[f.kind].points);
  }
  const rows = [...score].map(([id, s]) => ({ id, name: players.get(id) ?? CONFIG.multiplayer.defaultName, score: s }));
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  return rows.map((r) => ({ ...r, place: 1 + rows.filter((x) => x.score > r.score).length }));
}
