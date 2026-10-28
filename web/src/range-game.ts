import { CONFIG } from './config';
import { type Arrival, byArrival } from './presence';
import { type Flight, flightAt, schedule, type Vec3 } from './range-flights';
import { type Claim, rayHit, type Standing, standings } from './range-rules';

/** A shooter on a round's board: their id and the name they had. */
export type Shooter = { id: string; name: string };

/**
 * What a `range` message carries: a visitor picking up a rifle or putting it back; a round starting (or, to a
 * newcomer, the round so far, with its shooters and claims); a shot, with the target it hit (−1 for a miss) and `r`
 * '' outside a round. `left` is ms until the round's end, `t` s into the round. Types, so they can be sent as JSON.
 */
export type RangeMessage =
  | { k: 'arm'; on: boolean; name: string }
  | { k: 'start'; r: string; seed: number; left: number; players: Shooter[]; claims: Claim[] }
  | { k: 'shot'; r: string; t: number; o: Vec3; d: Vec3; hit: number };

/** A message to send: to everyone, or to one visitor. */
export type RangeOut = { msg: RangeMessage; to?: string };

/** What the view shows and the sound plays: another's shot (its tracer), and a target breaking, with whose points. */
export type RangeEvent =
  | { kind: 'shot'; by: string; o: Vec3; d: Vec3 }
  | { kind: 'break'; target: number; by: string; points: number; at: Vec3 };

/** Where a round is: counting down, running, or showing its final scores. */
export type Phase = 'countdown' | 'running' | 'end';

interface Round { id: string; seed: number; endsAt: number; flights: Flight[]; players: Map<string, string> }

const MAX_PLAYERS = 16;
const MAX_TARGETS = 200;
const cfg = CONFIG.range;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isName = (v: unknown): v is string => typeof v === 'string' && v.length <= CONFIG.multiplayer.maxNameLength;
const isIndex = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -cfg.countdown && v <= cfg.length + cfg.end;
const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1000);
const isClaim = (v: unknown) => isObject(v) && isIndex(v.target, 0, MAX_TARGETS - 1) && isTime(v.t) && isText(v.by);
const isShooter = (v: unknown) => isObject(v) && isText(v.id) && isName(v.name);

/** A well-formed `range` message, every list bounded; anything else is dropped. */
export function isRangeMessage(v: unknown): v is RangeMessage {
  if (!isObject(v)) return false;
  switch (v.k) {
    case 'arm': return typeof v.on === 'boolean' && isName(v.name);
    case 'start':
      return isText(v.r) && isIndex(v.seed, 0, 2 ** 32 - 1)
        && typeof v.left === 'number' && Number.isFinite(v.left) && v.left >= 0 && v.left <= 1000 * (cfg.countdown + cfg.length)
        && Array.isArray(v.players) && v.players.length <= MAX_PLAYERS && v.players.every(isShooter)
        && Array.isArray(v.claims) && v.claims.length <= MAX_TARGETS && v.claims.every(isClaim);
    case 'shot': {
      if (typeof v.r !== 'string' || v.r.length > 64 || !isTime(v.t) || !isVec(v.o) || !isVec(v.d) || !isIndex(v.hit, -1, MAX_TARGETS - 1)) return false;
      const n = Math.hypot(...(v.d as Vec3));
      return n > 0.9 && n < 1.1;
    }
    default: return false;
  }
}

/**
 * The shooting range as this browser sees it: whether this visitor holds a rifle, who else does, and the round, if
 * one counts down, runs or shows its scores. Every browser makes the same flights from the round's seed; each
 * shooter judges their own shots and sends what they hit, and every browser gives each target to the earliest claim
 * (`winners`), so all agree on the scores. Two starts that cross settle on the lower round id. `now` is in ms; round
 * times are in s from the round's start, negative while it counts down.
 */
export class RangeGame {
  round: Round | null = null;
  claims: Claim[] = [];
  private mine = false;
  private myName = '';
  /** The others holding a rifle, and their names. */
  private others = new Map<string, string>();
  /** Rounds over or given up here, so a late copy never comes back. */
  private finished = new Set<string>();
  private events: RangeEvent[] = [];
  /** Hits on rounds this browser doesn't hold yet, kept (at most `pending`, oldest dropped) until the round arrives. */
  private pending: { msg: Extract<RangeMessage, { k: 'shot' }>; from: string }[] = [];

  constructor(private selfId: () => string, private newId: () => string, private rand: () => number = Math.random, private config = CONFIG.range) {}

  /** This visitor holds a rifle. */
  get armed(): boolean {
    return this.mine;
  }

  /** A round is on: counting down, running, or showing its final scores. */
  get busy(): boolean {
    return this.round !== null;
  }

  /** Picks up a rifle (joining a round that runs, on 0) or puts it back (keeping the points). */
  setArmed(on: boolean, name: string, now: number): RangeOut[] {
    if (on === this.mine) return [];
    this.mine = on;
    this.myName = name;
    if (on) this.join(this.selfId(), name, now);
    return [{ msg: { k: 'arm', on, name } }];
  }

  /** The red button: a new round for everyone holding a rifle, if this visitor holds one and none is on. */
  start(now: number): RangeOut[] {
    if (!this.mine || this.round) return [];
    const players = new Map([[this.selfId(), this.myName], ...this.others]);
    this.begin(this.newId(), Math.floor(this.rand() * 2 ** 32), now + 1000 * (this.config.countdown + this.config.length), players, []);
    return [{ msg: this.startMessage(now) }];
  }

  /** A shot from `o` along `d` (a unit vector): what it hits is this browser's call, at once; the others hear it, hit
   * or miss. Outside a running round it hits nothing. */
  shoot(o: Vec3, d: Vec3, now: number): RangeOut[] {
    const r = this.round;
    const t = this.roundTime(now);
    const live = r !== null && this.phase(now) === 'running';
    const hit = live ? rayHit(r.flights, this.broken(), t, o, d, this.config) : null;
    if (live && hit !== null) {
      this.join(this.selfId(), this.myName, now);
      this.addClaim({ target: hit, t, by: this.selfId() }, true);
    }
    return [{ msg: { k: 'shot', r: live ? r.id : '', t: live ? t : 0, o, d, hit: hit ?? -1 } }];
  }

  /** A message from another visitor. */
  receive(msg: RangeMessage, from: string, now: number): RangeOut[] {
    switch (msg.k) {
      case 'arm':
        if (msg.on) {
          this.others.set(from, msg.name);
          this.join(from, msg.name, now);
        } else this.others.delete(from);
        return [];
      case 'start':
        this.take(msg, now);
        return [];
      case 'shot': {
        this.events.push({ kind: 'shot', by: from, o: msg.o, d: msg.d });
        const r = this.round;
        if (r && msg.r === r.id) this.claimShot(msg, from, true);
        else if (msg.r && msg.hit >= 0 && !this.finished.has(msg.r)) { // a round not heard of yet: keep the hit for it
          this.pending.push({ msg, from });
          if (this.pending.length > this.config.pending) this.pending.shift();
        }
        return [];
      }
    }
  }

  /** A visitor who left: no longer holding a rifle for later rounds. Their place and score in the round that's on
   * stay, and their claims still count. */
  leave(id: string): void {
    this.others.delete(id);
  }

  /** A visitor new here: this visitor's rifle, and from the earliest-arrived visitor (the others needn't), the round
   * so far. */
  greet(id: string, visitors: Arrival[], now: number): RangeOut[] {
    const out: RangeOut[] = [];
    if (this.mine) out.push({ msg: { k: 'arm', on: true, name: this.myName }, to: id });
    const first = visitors.filter((v) => v.id !== id).sort(byArrival)[0];
    if (this.round && this.phase(now) !== 'end' && first?.id === this.selfId()) out.push({ msg: this.startMessage(now), to: id });
    return out;
  }

  /** Every frame: a round whose final scores have shown is over. */
  update(now: number): void {
    if (!this.round || this.roundTime(now) <= this.config.length + this.config.end) return;
    this.finished.add(this.round.id);
    this.round = null;
    this.claims = [];
  }

  /** Seconds into the round (negative while it counts down); 0 with none. */
  roundTime(now: number): number {
    return this.round ? this.config.length - (this.round.endsAt - now) / 1000 : 0;
  }

  /** Where the round is at `now`; null with none. */
  phase(now: number): Phase | null {
    if (!this.round) return null;
    const t = this.roundTime(now);
    return t < 0 ? 'countdown' : t <= this.config.length ? 'running' : 'end';
  }

  /** Seconds until the round stops running. */
  timeLeft(now: number): number {
    return this.round ? Math.max(0, (this.round.endsAt - now) / 1000) : 0;
  }

  /** The targets someone has hit, shattered for everyone whoever wins them. */
  broken(): Set<number> {
    return new Set(this.claims.map((c) => c.target));
  }

  /** The board: every shooter in the round and their points, best first; empty with no round. */
  standings(): Standing[] {
    return this.round ? standings(this.round.players, this.claims, this.round.flights, this.config) : [];
  }

  /** What happened since the last call, for the view and the sound. */
  takeEvents(): RangeEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** A start from another visitor: taken when no round is on (or the one here is showing its scores), merged into
   * the same round, and of two that crossed, the lower id kept. */
  private take(msg: Extract<RangeMessage, { k: 'start' }>, now: number): void {
    if (this.finished.has(msg.r)) return;
    const r = this.round;
    const players = new Map(msg.players.map((p) => [p.id, p.name]));
    if (r && r.id === msg.r) {
      for (const [id, name] of players) if (!r.players.has(id)) r.players.set(id, name);
      for (const c of msg.claims) this.addClaim(c, false);
      return;
    }
    if (r && this.phase(now) !== 'end') {
      const span = 1000 * (this.config.countdown + this.config.length);
      const theirs = now + msg.left - span;
      const ours = r.endsAt - span;
      const apart = Math.abs(theirs - ours) > this.config.crossing;
      if (apart ? theirs > ours : r.id < msg.r) return; // the earlier start stands; pressed at once, the lower id
    }
    if (r) this.finished.add(r.id);
    for (const [id, name] of this.others) if (!players.has(id)) players.set(id, name);
    if (this.mine) players.set(this.selfId(), this.myName);
    this.begin(msg.r, msg.seed, now + msg.left, players, msg.claims);
  }

  private begin(id: string, seed: number, endsAt: number, players: Map<string, string>, claims: readonly Claim[]): void {
    this.round = { id, seed, endsAt, flights: schedule(seed, this.config), players };
    this.claims = [];
    for (const c of claims) this.addClaim(c, false); // a newcomer's catch-up: those already broke, out of sight
    const kept = this.pending.filter((p) => p.msg.r === id);
    this.pending = this.pending.filter((p) => p.msg.r !== id);
    for (const p of kept) this.claimShot(p.msg, p.from, false);
  }

  /** The claim in a shot's hit, if the target was in the air then; its shooter joins the board. */
  private claimShot(msg: Extract<RangeMessage, { k: 'shot' }>, from: string, show: boolean): void {
    const r = this.round;
    const f = r && msg.hit >= 0 ? r.flights[msg.hit] : undefined;
    if (!r || !f || !flightAt(f, msg.t, this.config)) return;
    if (!r.players.has(from)) r.players.set(from, this.others.get(from) ?? CONFIG.multiplayer.defaultName);
    this.addClaim({ target: f.i, t: msg.t, by: from }, show);
  }

  private startMessage(now: number): RangeMessage {
    const r = this.round!;
    return {
      k: 'start', r: r.id, seed: r.seed, left: Math.round(Math.max(0, r.endsAt - now)),
      players: [...r.players].map(([id, name]) => ({ id, name })), claims: this.claims,
    };
  }

  /** Adds a shooter to a round that hasn't ended. */
  private join(id: string, name: string, now: number): void {
    if (this.round && this.phase(now) !== 'end') this.round.players.set(id, name);
  }

  /** Keeps a claim (one per shooter and target); the first on a target breaks it, `show` for everyone to see. */
  private addClaim(c: Claim, show: boolean): void {
    const r = this.round;
    if (!r || !c.by || !r.flights[c.target] || this.claims.some((x) => x.target === c.target && x.by === c.by)) return;
    const first = !this.claims.some((x) => x.target === c.target);
    this.claims.push(c);
    const f = r.flights[c.target];
    const at = flightAt(f, c.t, this.config);
    if (show && first && at) this.events.push({ kind: 'break', target: f.i, by: c.by, points: this.config.kinds[f.kind].points, at });
  }
}

/** The top strip: the countdown, the time left or "Final scores", and the board. */
export interface RangeHud { head: string; final: boolean; rows: (Standing & { you: boolean })[] }

/** What the top strip shows now: the countdown, the time left or "Final scores", and the board with `me` marked; null
 * with no round. */
export function rangeHud(game: RangeGame, now: number, me: string): RangeHud | null {
  const phase = game.phase(now);
  if (!phase) return null;
  const rows = game.standings().map((s) => ({ ...s, you: s.id === me }));
  if (phase === 'countdown') return { head: String(Math.ceil(-game.roundTime(now))), final: false, rows };
  if (phase === 'end') return { head: 'Final scores', final: true, rows };
  const left = Math.ceil(game.timeLeft(now));
  return { head: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, final: false, rows };
}
