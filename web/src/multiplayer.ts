import type { Room as TrysteroRoom } from 'trystero';
import type { Avatars } from './avatars';
import { CONFIG } from './config';
import { type DrawMessage, isDrawMessage } from './draw-game';
import { type GameMessage, isGameMessage } from './games';
import { isPropMessage, type PropMessage } from './props';
import { isRangeMessage, type RangeMessage } from './range-game';
import {
  applyState, cleanName, collectState, colourFor, encodePose, isPose, isStateMap, Peers, type PoseMessage, poseMoved,
  type Seating, shouldSend, type StateMap, type StateWorld, hostOf,
} from './presence';

export type MessageKind = 'hello' | 'pose' | 'state' | 'game' | 'prop' | 'draw' | 'range';
const KINDS: MessageKind[] = ['hello', 'pose', 'state', 'game', 'prop', 'draw', 'range'];
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** What the walkthrough needs from a network: Trystero today, a WebSocket server another day. */
export interface Room {
  selfId: string;
  /** To one peer, or to everyone. */
  send(kind: MessageKind, data: Json, to?: string): void;
  onMessage(kind: MessageKind, handler: (data: unknown, peerId: string) => void): void;
  onPeerJoin(cb: (peerId: string) => void): void;
  onPeerLeave(cb: (peerId: string) => void): void;
  /** Media (the mic) to one peer, or to everyone here now. */
  addStream(stream: MediaStream, to?: string): void;
  onPeerStream(cb: (stream: MediaStream, peerId: string) => void): void;
  leave(): void;
}

export function trysteroRoom(room: TrysteroRoom, selfId: string): Room {
  const actions = new Map(KINDS.map((k) => [k, room.makeAction<Json>(k)] as const));
  return {
    selfId,
    send: (kind, data, to) => void actions.get(kind)!.send(data, to ? { target: to } : undefined).catch(() => {}),
    onMessage: (kind, handler) => { actions.get(kind)!.onMessage = (data, { peerId }) => handler(data, peerId); },
    onPeerJoin: (cb) => { room.onPeerJoin = cb; },
    onPeerLeave: (cb) => { room.onPeerLeave = cb; },
    addStream: (stream, to) => void Promise.all(room.addStream(stream, to ? { target: to } : undefined)).catch(() => {}),
    onPeerStream: (cb) => { room.onPeerStream = (stream, peerId) => cb(stream, peerId); },
    leave: () => void room.leave().catch(() => {}),
  };
}

/** `arrived`: when it first came to the room, which decides the host (an older visitor sends none). `ask`: send yours
 * back (to a peer that timed out here and came back, so its name is lost). */
interface Hello { name: string; since: number; arrived?: number; ask?: 1 }
const isHello = (v: unknown): v is Hello =>
  !!v && typeof v === 'object' && typeof (v as Hello).name === 'string' && typeof (v as Hello).since === 'number';

/** What multiplayer needs from the voices: the mic to send (null when listening only) and where peers' voices go. */
export interface VoiceLink {
  readonly mic: MediaStream | null;
  add(peerId: string, stream: MediaStream): void;
  remove(peerId: string): void;
}

export interface MultiplayerHooks {
  /** Seconds, monotonic. */
  now: () => number;
  /** Shared-state keys another visitor just changed (for the sounds a local click would make). */
  onChanged: (keys: string[]) => void;
  /** The names of everyone else here, whenever that changes. */
  onPeers: (names: string[]) => void;
  /** The host's peer id (this visitor's own when it is host), whenever that changes. */
  onHost?: (hostId: string) => void;
  /** A dining-table game another visitor sent (well-formed; whether to take it is the games' call). */
  onGame?: (game: GameMessage) => void;
  /** The table's games, sent to a newcomer with the flat's state. */
  games?: () => GameMessage[];
  /** A loose thing another visitor moved (well-formed; whether to take it is the props' call). */
  onProp?: (m: PropMessage) => void;
  /** Every loose thing moved since the flat loaded, sent to a newcomer with the flat's state (and to a peer back from a
   * timeout). */
  props?: () => PropMessage[];
  /** Draw and guess: a message from another visitor (well-formed; what to do with it is the game's call). */
  onDraw?: (msg: DrawMessage, from: string) => void;
  /** A visitor new here (or back after timing out), to greet with this visitor's part of draw and guess. */
  onArrive?: (id: string) => void;
  /** A visitor left or timed out (before their animal goes). */
  onLeave?: (id: string) => void;
  /** The shooting range: a message from another visitor (well-formed; what to do with it is the range's call). */
  onRange?: (msg: RangeMessage, from: string) => void;
}

/**
 * The others in the flat. Every visitor owns their own pose and broadcasts it; the flat's state is "last message wins"
 * and always carries the resulting state, so it converges. A newcomer asks the visitors who were here before it (by
 * join time, sent in each hello) for the full state, until it has one (marked `full`: a click someone makes meanwhile
 * is only a delta) or has changed something itself.
 */
export class Multiplayer {
  private peers = new Peers();
  private since: number;
  private lastHost: string;
  private settled = false;
  private lastSent = -Infinity;
  private lastPose: PoseMessage | null = null;
  private voice: VoiceLink | null = null;
  private sharedMic: MediaStream | null = null;
  /** Each peer's voice until the peer leaves: Trystero won't send it again over a connection that stayed up. */
  private streams = new Map<string, MediaStream>();

  constructor(private room: Room, world: StateWorld, private avatars: Avatars, private name: string, private hooks: MultiplayerHooks, joinedAt = Date.now(), private arrived = joinedAt) {
    this.since = joinedAt;
    this.lastHost = room.selfId;
    room.onPeerJoin((id) => {
      this.arrive(id);
      this.greet(id);
      if (this.sharedMic) room.addStream(this.sharedMic, id); // Trystero only sends a stream to the peers here when it's added
    });
    room.onPeerLeave((id) => this.depart(id));
    room.onPeerStream((stream, id) => {
      this.streams.set(id, stream);
      if (!this.arrive(id)) this.voice?.add(id, stream); // a new peer gets its voice in arrive
    });
    room.onMessage('hello', (data, id) => {
      if (!isHello(data)) return;
      this.arrive(id);
      const peerName = cleanName(data.name);
      const arrived = typeof data.arrived === 'number' && Number.isFinite(data.arrived) ? data.arrived : data.since;
      this.peers.hello(id, peerName, data.since, hooks.now(), arrived);
      avatars.setName(id, peerName);
      if (data.ask) this.greet(id);
      if (!this.settled && data.since < this.since) room.send('state', { want: 1 }, id);
      hooks.onPeers(this.peers.names());
      this.checkHost();
    });
    room.onMessage('pose', (data, id) => {
      if (!isPose(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      avatars.setPose(id, data);
    });
    room.onMessage('state', (data, id) => {
      if (!isStateMap(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      if ('want' in data) {
        room.send('state', { ...collectState(world), full: 1 }, id);
        for (const game of hooks.games?.() ?? []) room.send('game', game, id);
        return; // the loose things went to it in arrive
      }
      if ('full' in data) this.settled = true;
      const changed = applyState(world, data, hooks.now());
      if (changed.length) hooks.onChanged(changed);
    });
    room.onMessage('game', (data, id) => {
      if (!isGameMessage(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      hooks.onGame?.(data);
    });
    room.onMessage('prop', (data, id) => {
      if (!isPropMessage(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      hooks.onProp?.(data);
    });
    room.onMessage('draw', (data, id) => {
      if (!isDrawMessage(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      hooks.onDraw?.(data, id);
    });
    room.onMessage('range', (data, id) => {
      if (!isRangeMessage(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      hooks.onRange?.(data, id);
    });
  }

  get names(): string[] {
    return this.peers.names();
  }

  /** Ids, names, arrival and join times of the others here. */
  get people(): { id: string; name: string; arrived: number | null; since: number | null }[] {
    return this.peers.list();
  }

  get selfId(): string {
    return this.room.selfId;
  }

  /** Whoever arrived first: their peer id, or this visitor's own. */
  get host(): string {
    return hostOf({ id: this.room.selfId, arrived: this.arrived, since: this.since }, this.peers.list());
  }

  /** The voices: incoming streams go to them, and their mic goes to everyone. */
  setVoice(voice: VoiceLink): void {
    this.voice = voice;
    this.shareMic();
  }

  /** Sends the mic to everyone here, once it's there; later peers get it as they join. */
  shareMic(): void {
    const mic = this.voice?.mic ?? null;
    if (!mic || mic === this.sharedMic) return;
    this.sharedMic = mic;
    this.room.addStream(mic);
  }

  /** Notes a sign of life from a peer; true when the peer is new (or back after a timeout), with its animal and voice.
   * It's sent the loose things too: one back from a timeout may still hold what was dropped for it here. */
  private arrive(id: string): boolean {
    if (!this.peers.seen(id, this.hooks.now())) return false;
    this.avatars.add(id, colourFor(id), CONFIG.multiplayer.defaultName);
    const stream = this.streams.get(id);
    if (stream) this.voice?.add(id, stream);
    this.hooks.onPeers(this.peers.names());
    for (const m of this.hooks.props?.() ?? []) this.room.send('prop', m as unknown as Json, id);
    this.hooks.onArrive?.(id);
    return true;
  }

  private greet(id: string, ask = false): void {
    const hello = { name: this.name, since: this.since, arrived: this.arrived };
    this.room.send('hello', ask ? { ...hello, ask: 1 } : hello, id);
  }

  /** Tells the hook when someone else is host now (after a hello, a leave or a timeout). */
  private checkHost(): void {
    const host = this.host;
    if (host === this.lastHost) return;
    this.lastHost = host;
    this.hooks.onHost?.(host);
  }

  private depart(id: string): void {
    this.streams.delete(id);
    if (!this.peers.remove(id)) return;
    this.hooks.onLeave?.(id);
    this.avatars.remove(id);
    this.voice?.remove(id);
    this.hooks.onPeers(this.peers.names());
    this.checkHost();
  }

  /** Call every frame with the local pose (and seating, sitting or lying, and how drunk, 0..1); it sends at the pose
   * rate while moving and as a heartbeat while still. */
  sendPose(x: number, z: number, yaw: number, pitch: number, seating: Seating | null = null, drunk = 0): void {
    const pose = encodePose(x, z, yaw, pitch, seating, drunk);
    const now = this.hooks.now();
    if (!shouldSend(this.lastSent, now, poseMoved(this.lastPose, pose))) return;
    this.lastSent = now;
    this.lastPose = pose;
    this.room.send('pose', pose);
  }

  /** Tells the others what a local click changed. */
  broadcast(delta: StateMap): void {
    this.settled = true; // this flat's state is live now: don't take a snapshot from someone who was here first
    this.room.send('state', delta);
  }

  /** Tells the others about a game this visitor opened or moved in. */
  sendGame(game: GameMessage): void {
    this.room.send('game', game);
  }

  /** Tells the others what happened to a loose thing. */
  sendProp(m: PropMessage): void {
    this.room.send('prop', m as unknown as Json);
  }

  /** Draw and guess: to everyone, or (a guess, a "close!", a newcomer's state) to one visitor. */
  sendDraw(msg: DrawMessage, to?: string): void {
    this.room.send('draw', msg, to);
  }

  /** The shooting range: to everyone, or (a newcomer's catch-up) to one visitor. */
  sendRange(msg: RangeMessage, to?: string): void {
    this.room.send('range', msg, to);
  }

  /** Every frame: drop the silent. */
  tick(): void {
    const gone = this.peers.prune(this.hooks.now());
    for (const id of gone) {
      this.hooks.onLeave?.(id);
      this.avatars.remove(id);
      this.voice?.remove(id);
    }
    if (gone.length) {
      this.hooks.onPeers(this.peers.names());
      this.checkHost();
    }
  }

  leave(): void {
    this.room.leave();
  }
}
