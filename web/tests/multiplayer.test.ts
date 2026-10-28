import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Avatars } from '../src/avatars';
import { DoorState } from '../src/doors';
import { LightGroups } from '../src/lightmaps';
import type { GameMessage } from '../src/games';
import type { DoorInfo } from '../src/manifest';
import type { PropMessage } from '../src/props';
import { type MessageKind, Multiplayer, type Room } from '../src/multiplayer';

const door: DoorInfo = { node: 'Door_1', hinge: [0, 0], dir: [0, 1], width: 0.8, openAngle: -1.5, opening: 1, lightmap: { file: 'd', range: 1 }, packs: [] };

interface Sent { kind: MessageKind; data: unknown; to?: string }

function fakeRoom() {
  const sent: Sent[] = [];
  const handlers = new Map<MessageKind, (data: unknown, peerId: string) => void>();
  let join: (id: string) => void = () => {};
  let leave: (id: string) => void = () => {};
  let left = false;
  const streams: { stream: MediaStream; to?: string }[] = [];
  let streamHandler: (stream: MediaStream, peerId: string) => void = () => {};
  const room: Room = {
    selfId: 'me',
    send: (kind, data, to) => void sent.push({ kind, data, ...(to ? { to } : {}) }),
    onMessage: (kind, h) => void handlers.set(kind, h),
    onPeerJoin: (cb) => { join = cb; },
    onPeerLeave: (cb) => { leave = cb; },
    addStream: (stream, to) => void streams.push({ stream, ...(to ? { to } : {}) }),
    onPeerStream: (cb) => { streamHandler = cb; },
    leave: () => { left = true; },
  };
  return {
    room, sent, streams,
    join: (id: string) => join(id),
    leave: (id: string) => leave(id),
    receive: (kind: MessageKind, data: unknown, from: string) => handlers.get(kind)!(data, from),
    stream: (stream: MediaStream, from: string) => streamHandler(stream, from),
    get left() { return left; },
  };
}

function setup(joinedAt = 1000, arrived = joinedAt) {
  const fake = fakeRoom();
  const world = { doors: [{ state: new DoorState(door) }], movables: [], lights: new LightGroups(['sala']), screens: [] };
  const avatars = new Avatars(null);
  let now = 0;
  const changed: string[][] = [];
  const peers: string[][] = [];
  const hosts: string[] = [];
  const games: GameMessage[] = [];
  let running: GameMessage[] = [];
  const propsIn: PropMessage[] = [];
  const leftIds: string[] = [];
  let away: PropMessage[] = [];
  const mp = new Multiplayer(fake.room, world, avatars, 'Ana', {
    now: () => now, onChanged: (k) => void changed.push(k), onPeers: (n) => void peers.push(n), onHost: (h) => void hosts.push(h),
    onGame: (g) => void games.push(g), games: () => running,
    onProp: (m) => void propsIn.push(m), props: () => away, onLeave: (id) => void leftIds.push(id),
  }, joinedAt, arrived);
  return {
    fake, world, avatars, mp, changed, peers, hosts, games, propsIn, leftIds,
    setNow: (t: number) => { now = t; }, setGames: (g: GameMessage[]) => { running = g; }, setAway: (m: PropMessage[]) => { away = m; },
    node: new Object3D(),
  };
}

describe('Multiplayer', () => {
  const voiceLink = (mic: MediaStream | null) => {
    const added: [string, MediaStream][] = [];
    const removed: string[] = [];
    return { mic, added, removed, add: (id: string, s: MediaStream) => void added.push([id, s]), remove: (id: string) => void removed.push(id) };
  };

  it('sends the mic to everyone, and to each peer who joins later', () => {
    const { fake, mp } = setup();
    const mic = {} as MediaStream;
    mp.setVoice(voiceLink(mic));
    expect(fake.streams).toEqual([{ stream: mic }]);
    fake.join('p1');
    expect(fake.streams.at(-1)).toEqual({ stream: mic, to: 'p1' });
    mp.shareMic(); // already shared: not again
    expect(fake.streams).toHaveLength(2);
  });

  it('shares the mic once it arrives after joining', () => {
    const { fake, mp } = setup();
    const link = voiceLink(null);
    mp.setVoice(link);
    expect(fake.streams).toEqual([]);
    const mic = {} as MediaStream;
    link.mic = mic;
    mp.shareMic();
    expect(fake.streams).toEqual([{ stream: mic }]);
  });

  it('listening only, sends nothing but still hears', () => {
    const { fake, mp, avatars } = setup();
    const link = voiceLink(null);
    mp.setVoice(link);
    fake.join('p1');
    expect(fake.streams).toEqual([]);
    const voice = {} as MediaStream;
    fake.stream(voice, 'p2');
    expect(link.added).toEqual([['p2', voice]]);
    expect(avatars.has('p2')).toBe(true); // a stream counts as a sign of life, like any message
  });

  it("drops a peer's voice when it leaves or goes silent", () => {
    const { fake, mp, setNow } = setup();
    const link = voiceLink(null);
    mp.setVoice(link);
    fake.stream({} as MediaStream, 'p1');
    fake.leave('p1');
    expect(link.removed).toEqual(['p1']);
    fake.stream({} as MediaStream, 'p2');
    setNow(100);
    mp.tick();
    expect(link.removed).toEqual(['p1', 'p2']);
  });

  it("brings a timed-out peer's voice back with its animal, but not one who left", () => {
    const { fake, mp, avatars, setNow } = setup();
    const link = voiceLink(null);
    mp.setVoice(link);
    const voice = {} as MediaStream;
    fake.stream(voice, 'p1');
    setNow(100);
    mp.tick(); // a backgrounded tab stops sending poses
    expect(link.removed).toEqual(['p1']);
    expect(avatars.has('p1')).toBe(false);
    fake.receive('pose', [0, 0, 0, 0], 'p1');
    expect(avatars.has('p1')).toBe(true);
    expect(link.added).toEqual([['p1', voice], ['p1', voice]]);
    fake.leave('p1');
    fake.receive('pose', [0, 0, 0, 0], 'p1');
    expect(link.added).toHaveLength(2); // gone for good: Trystero would send a new stream if it came back
  });

  it('lists the people here with their ids', () => {
    const { fake, mp } = setup();
    fake.join('p1');
    fake.receive('hello', { name: 'Rui', since: 2000 }, 'p1');
    expect(mp.people).toEqual([{ id: 'p1', name: 'Rui', arrived: 2000, since: 2000 }]);
  });

  it('is host until someone who arrived earlier says hello, and gets it back when they leave', () => {
    const { fake, mp, hosts } = setup(1000);
    expect(mp.selfId).toBe('me');
    expect(mp.host).toBe('me');
    fake.join('early'); // no hello yet: not a candidate
    expect(mp.host).toBe('me');
    fake.receive('hello', { name: 'Zé', since: 1500, arrived: 1500 }, 'late');
    expect(mp.host).toBe('me');
    expect(hosts).toEqual([]);
    fake.receive('hello', { name: 'Rui', since: 2000, arrived: 500 }, 'early');
    expect(mp.host).toBe('early');
    expect(hosts).toEqual(['early']);
    fake.leave('early');
    expect(mp.host).toBe('me');
    expect(hosts).toEqual(['early', 'me']);
  });
  it('hosts the reloaded page, not its old self, when both are still listed', () => {
    const { fake, mp } = setup(5000);
    fake.receive('hello', { name: 'Rui', since: 500, arrived: 100 }, 'aoldhost');
    fake.receive('hello', { name: 'Rui', since: 2000, arrived: 100 }, 'znewhost');
    expect(mp.host).toBe('znewhost');
  });
  it("takes an older visitor's join time as its arrival", () => {
    const { fake, mp } = setup(1000);
    fake.receive('hello', { name: 'Rui', since: 500 }, 'old');
    expect(mp.host).toBe('old');
  });
  it('hands the host on when the host times out', () => {
    const { fake, mp, hosts, setNow } = setup(1000);
    fake.receive('hello', { name: 'Rui', since: 500, arrived: 500 }, 'old');
    setNow(20);
    mp.tick();
    expect(mp.host).toBe('me');
    expect(hosts).toEqual(['old', 'me']);
  });
  it('a host back from a reload keeps the crown and still asks for the state', () => {
    const { fake, mp } = setup(3000, 500); // joined this page at 3000, first arrived at 500
    fake.receive('hello', { name: 'Rui', since: 1000, arrived: 1000 }, 'p1');
    expect(mp.host).toBe('me');
    expect(fake.sent.at(-1)).toEqual({ kind: 'state', data: { want: 1 }, to: 'p1' });
  });

  it('greets a joining peer, shows it as Guest until its hello, then by name', () => {
    const { fake, avatars, mp, peers } = setup();
    fake.join('p1');
    expect(fake.sent).toEqual([{ kind: 'hello', data: { name: 'Ana', since: 1000, arrived: 1000 }, to: 'p1' }]);
    expect(avatars.has('p1')).toBe(true);
    expect(peers.at(-1)).toEqual(['Guest']);
    fake.receive('hello', { name: '  Rui ', since: 2000 }, 'p1');
    expect(mp.names).toEqual(['Rui']);
    expect(peers.at(-1)).toEqual(['Rui']);
  });
  it('asks a peer who was here first for the state, and not one who came later', () => {
    const { fake } = setup(1000);
    fake.receive('hello', { name: 'Rui', since: 500 }, 'old');
    expect(fake.sent.at(-1)).toEqual({ kind: 'state', data: { want: 1 }, to: 'old' });
    const before = fake.sent.length;
    fake.receive('hello', { name: 'Zé', since: 1500 }, 'young');
    expect(fake.sent.length).toBe(before);
  });
  it('stops asking once it has the whole state or changed something itself', () => {
    const { fake, world } = setup(1000);
    fake.receive('state', { 'door:Door_1': 1, full: 1 }, 'old');
    expect(world.doors[0].state.isOpen).toBe(true);
    fake.receive('hello', { name: 'Rui', since: 500 }, 'old');
    expect(fake.sent.filter((s) => s.kind === 'state')).toEqual([]);
    const other = setup(1000);
    other.mp.broadcast({ 'light:sala': 1 });
    other.fake.receive('hello', { name: 'Rui', since: 500 }, 'old');
    expect(other.fake.sent).toEqual([{ kind: 'state', data: { 'light:sala': 1 } }]);
  });
  it('still asks for the whole state after a click someone made reached it first', () => {
    const { fake, world } = setup(1000);
    fake.receive('state', { 'door:Door_1': 1 }, 'old'); // a delta, not the snapshot
    expect(world.doors[0].state.isOpen).toBe(true);
    fake.receive('hello', { name: 'Rui', since: 500 }, 'old');
    expect(fake.sent.at(-1)).toEqual({ kind: 'state', data: { want: 1 }, to: 'old' });
  });
  it('answers a state request with everything, marked as the whole state', () => {
    const { fake, world } = setup();
    world.lights.set('sala', true);
    fake.receive('state', { want: 1 }, 'p1');
    expect(fake.sent.at(-1)).toEqual({ kind: 'state', data: { 'door:Door_1': 0, 'light:sala': 1, full: 1 }, to: 'p1' });
  });
  it("sends the table's games after the flat's state to a newcomer who asks", () => {
    const { fake, setGames } = setup();
    const chess: GameMessage = { slot: 0, id: 'g1', white: 'me', black: 'p2', moves: ['e2e4'] };
    setGames([chess]);
    fake.receive('state', { want: 1 }, 'p1');
    expect(fake.sent.slice(-2).map((s) => [s.kind, s.to])).toEqual([['state', 'p1'], ['game', 'p1']]);
    expect(fake.sent.at(-1)?.data).toEqual(chess);
  });
  it('passes on well-formed games and broadcasts its own', () => {
    const { fake, mp, games, avatars } = setup();
    const chess: GameMessage = { slot: 0, id: 'g1', white: 'p1', black: 'me', moves: [] };
    fake.receive('game', chess, 'p1');
    fake.receive('game', { slot: 7 }, 'p1');
    expect(games).toEqual([chess]);
    expect(avatars.has('p1')).toBe(true); // a sign of life, like any message
    mp.sendGame({ ...chess, moves: ['e2e4'] });
    expect(fake.sent.at(-1)).toEqual({ kind: 'game', data: { ...chess, moves: ['e2e4'] } });
  });
  it('asks a peer that comes back after timing out who it is, and answers when asked', () => {
    const { fake, mp, setNow } = setup();
    fake.receive('hello', { name: 'Rui', since: 500 }, 'p1');
    setNow(20);
    mp.tick(); // p1's tab was hidden: no poses for 20 s
    expect(mp.names).toEqual([]);
    fake.receive('pose', [0, 0, 0, 0], 'p1');
    expect(fake.sent.at(-1)).toEqual({ kind: 'hello', data: { name: 'Ana', since: 1000, arrived: 1000, ask: 1 }, to: 'p1' });
    fake.receive('hello', { name: 'Rui', since: 500 }, 'p1');
    expect(mp.names).toEqual(['Rui']);
    const n = fake.sent.length;
    fake.receive('hello', { name: 'Rui', since: 500, ask: 1 }, 'p1');
    expect(fake.sent.slice(n).filter((s) => s.kind === 'hello')).toEqual([{ kind: 'hello', data: { name: 'Ana', since: 1000, arrived: 1000 }, to: 'p1' }]);
  });
  it('applies deltas and reports what changed, ignoring junk', () => {
    const { fake, world, changed } = setup();
    fake.receive('state', { 'door:Door_1': 1, 'light:sala': 1 }, 'p1');
    expect(changed).toEqual([['door:Door_1', 'light:sala']]);
    expect(world.doors[0].state.isOpen).toBe(true);
    fake.receive('state', { 'door:Door_1': 1 }, 'p1');
    fake.receive('state', 'nonsense', 'p1');
    fake.receive('state', { 'door:Door_1': 'open' }, 'p1');
    expect(changed).toHaveLength(1);
  });
  it('moves avatars by poses and drops bad ones', () => {
    const { fake, avatars } = setup();
    fake.receive('pose', [1, 2, 0.5, 0.1], 'p1');
    const f = avatars.get('p1')!;
    expect(f.root.visible).toBe(true);
    expect(f.root.position.x).toBe(1);
    fake.receive('pose', [1, 2, 3], 'p1');
    fake.receive('pose', 'x', 'p2');
    expect(avatars.has('p2')).toBe(false);
  });
  it('sends sitting down at once, and seats the other visitors it hears from', () => {
    const { fake, mp, avatars, setNow } = setup();
    mp.sendPose(1, 2, 0.5, 0);
    setNow(0.1);
    mp.sendPose(1, 2, 0.5, 0, [1, 0.47, -1.5708]); // sat down where it stood
    expect(fake.sent.at(-1)).toEqual({ kind: 'pose', data: [1, 2, 0.5, 0, 1, 0.47, -1.571] });
    fake.receive('pose', [0.9, 6.6, 0, 0, 2, 0.53, 0], 'p1');
    expect(avatars.get('p1')!.seating).toEqual([2, 0.53, 0]);
    expect(avatars.occupied(0.9, 6.6)).toBe(true);
  });
  it('sends its pose at the moving rate, then as a heartbeat', () => {
    const { fake, mp, setNow } = setup();
    mp.sendPose(1, 2, 0.5, 0);
    expect(fake.sent).toEqual([{ kind: 'pose', data: [1, 2, 0.5, 0] }]);
    setNow(0.02);
    mp.sendPose(1.1, 2, 0.5, 0); // too soon
    expect(fake.sent).toHaveLength(1);
    setNow(0.1);
    mp.sendPose(1.1, 2, 0.5, 0);
    expect(fake.sent).toHaveLength(2);
    setNow(0.5);
    mp.sendPose(1.1, 2, 0.5, 0); // still: no send yet
    expect(fake.sent).toHaveLength(2);
    setNow(1.2);
    mp.sendPose(1.1, 2, 0.5, 0); // heartbeat
    expect(fake.sent).toHaveLength(3);
  });
  it('removes the departed and the silent, and leaves the room', () => {
    const { fake, avatars, mp, peers, setNow } = setup();
    fake.receive('pose', [0, 0, 0, 0], 'p1');
    fake.receive('pose', [0, 0, 0, 0], 'p2');
    fake.leave('p1');
    expect(avatars.has('p1')).toBe(false);
    expect(peers.at(-1)).toEqual(['Guest']);
    setNow(20);
    mp.tick();
    expect(avatars.has('p2')).toBe(false);
    expect(peers.at(-1)).toEqual([]);
    mp.leave();
    expect(fake.left).toBe(true);
  });
  it('passes on loose things that others move, and only well-formed ones', () => {
    const { fake, propsIn } = setup();
    fake.receive('prop', { id: 'a/tumbler/0', n: 1, by: 'p1', s: 'held' }, 'p1');
    fake.receive('prop', { id: 'a/tumbler/0', n: 'x', by: 'p1', s: 'held' }, 'p1');
    expect(propsIn).toEqual([{ id: 'a/tumbler/0', n: 1, by: 'p1', s: 'held' }]);
  });

  it('sends a newcomer the loose things away from home, with the flat', () => {
    const { fake, setAway } = setup();
    fake.receive('hello', { name: 'Rui', since: 2000 }, 'p1');
    const away: PropMessage = { id: 'a/tumbler/0', n: 2, by: 'me', s: 'rest', parent: null, p: [1, 0, 1], q: [0, 0, 0, 1] };
    setAway([away]);
    fake.receive('state', { want: 1 }, 'p1');
    expect(fake.sent.filter((s) => s.kind === 'prop')).toEqual([{ kind: 'prop', data: away, to: 'p1' }]);
  });

  it('sends a peer back from a timeout the loose things, so it learns its held thing was dropped', () => {
    const { fake, mp, setNow, setAway, leftIds } = setup();
    fake.receive('hello', { name: 'Rui', since: 500 }, 'p1');
    setNow(20);
    mp.tick(); // p1's tab was hidden: it timed out here, and what it held was dropped
    expect(leftIds).toEqual(['p1']);
    const dropped: PropMessage = { id: 'a/tumbler/0', n: 5, by: '', s: 'rest', parent: null, p: [1, 0, 1], q: [0, 0, 0, 1] };
    setAway([dropped]);
    const n = fake.sent.length;
    fake.receive('pose', [0, 0, 0, 0], 'p1');
    expect(fake.sent.slice(n).filter((s) => s.kind === 'prop')).toEqual([{ kind: 'prop', data: dropped, to: 'p1' }]);
    const again = fake.sent.length;
    fake.receive('pose', [0, 0, 0, 0], 'p1'); // already here: not again
    expect(fake.sent.length).toBe(again);
  });

  it('sends a loose thing to everyone', () => {
    const { fake, mp } = setup();
    mp.sendProp({ id: 'a/tumbler/0', n: 1, by: 'me', s: 'held' });
    expect(fake.sent.at(-1)).toEqual({ kind: 'prop', data: { id: 'a/tumbler/0', n: 1, by: 'me', s: 'held' } });
  });

  it('says who left, while their animal is still there', () => {
    const { fake, leftIds, avatars } = setup();
    fake.receive('hello', { name: 'Bo', since: 500 }, 'p1');
    let seen = false;
    const before = avatars.remove.bind(avatars);
    avatars.remove = (id: string) => { seen = leftIds.includes(id); before(id); };
    fake.leave('p1');
    expect(leftIds).toEqual(['p1']);
    expect(seen).toBe(true);
  });
});
