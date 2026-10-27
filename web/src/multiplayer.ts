import type { Room as TrysteroRoom } from 'trystero';
import type { Avatars } from './avatars';
import { CONFIG } from './config';
import {
  applyState, cleanName, collectState, colourFor, encodePose, isPose, isStateMap, Peers, type Pose, poseMoved, shouldSend,
  type StateMap, type StateWorld,
} from './presence';

export type MessageKind = 'hello' | 'pose' | 'state';
const KINDS: MessageKind[] = ['hello', 'pose', 'state'];
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

/** `ask`: send yours back (to a peer that timed out here and came back, so its name is lost). */
interface Hello { name: string; since: number; ask?: 1 }
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
  private settled = false;
  private lastSent = -Infinity;
  private lastPose: Pose | null = null;
  private voice: VoiceLink | null = null;
  private sharedMic: MediaStream | null = null;
  /** Each peer's voice until the peer leaves: Trystero won't send it again over a connection that stayed up. */
  private streams = new Map<string, MediaStream>();

  constructor(private room: Room, world: StateWorld, private avatars: Avatars, private name: string, private hooks: MultiplayerHooks, joinedAt = Date.now()) {
    this.since = joinedAt;
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
      this.peers.hello(id, peerName, data.since, hooks.now());
      avatars.setName(id, peerName);
      if (data.ask) this.greet(id);
      if (!this.settled && data.since < this.since) room.send('state', { want: 1 }, id);
      hooks.onPeers(this.peers.names());
    });
    room.onMessage('pose', (data, id) => {
      if (!isPose(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      avatars.setPose(id, data);
    });
    room.onMessage('state', (data, id) => {
      if (!isStateMap(data)) return;
      if (this.arrive(id)) this.greet(id, true);
      if ('want' in data) return room.send('state', { ...collectState(world), full: 1 }, id);
      if ('full' in data) this.settled = true;
      const changed = applyState(world, data, hooks.now());
      if (changed.length) hooks.onChanged(changed);
    });
  }

  get names(): string[] {
    return this.peers.names();
  }

  /** Ids and names of the others here, for marking who is talking. */
  get people(): { id: string; name: string }[] {
    return this.peers.list();
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

  /** Notes a sign of life from a peer; true when the peer is new (or back after a timeout), with its animal and voice. */
  private arrive(id: string): boolean {
    if (!this.peers.seen(id, this.hooks.now())) return false;
    this.avatars.add(id, colourFor(id), CONFIG.multiplayer.defaultName);
    const stream = this.streams.get(id);
    if (stream) this.voice?.add(id, stream);
    this.hooks.onPeers(this.peers.names());
    return true;
  }

  private greet(id: string, ask = false): void {
    this.room.send('hello', ask ? { name: this.name, since: this.since, ask: 1 } : { name: this.name, since: this.since }, id);
  }

  private depart(id: string): void {
    this.streams.delete(id);
    if (!this.peers.remove(id)) return;
    this.avatars.remove(id);
    this.voice?.remove(id);
    this.hooks.onPeers(this.peers.names());
  }

  /** Call every frame with the local pose; it sends at the pose rate while moving and as a heartbeat while still. */
  sendPose(x: number, z: number, yaw: number, pitch: number): void {
    const pose = encodePose(x, z, yaw, pitch);
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

  /** Every frame: drop the silent. */
  tick(): void {
    const gone = this.peers.prune(this.hooks.now());
    for (const id of gone) {
      this.avatars.remove(id);
      this.voice?.remove(id);
    }
    if (gone.length) this.hooks.onPeers(this.peers.names());
  }

  leave(): void {
    this.room.leave();
  }
}
