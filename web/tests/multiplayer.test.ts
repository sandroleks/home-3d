import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Avatars } from '../src/avatars';
import { DoorState } from '../src/doors';
import { LightGroups } from '../src/lightmaps';
import type { DoorInfo } from '../src/manifest';
import { type MessageKind, Multiplayer, type Room } from '../src/multiplayer';

const door: DoorInfo = { node: 'Door_1', hinge: [0, 0], dir: [0, 1], width: 0.8, openAngle: -1.5, opening: 1, lightmap: { file: 'd', range: 1 }, packs: [] };

interface Sent { kind: MessageKind; data: unknown; to?: string }

function fakeRoom() {
  const sent: Sent[] = [];
  const handlers = new Map<MessageKind, (data: unknown, peerId: string) => void>();
  let join: (id: string) => void = () => {};
  let leave: (id: string) => void = () => {};
  let left = false;
  const room: Room = {
    selfId: 'me',
    send: (kind, data, to) => void sent.push({ kind, data, ...(to ? { to } : {}) }),
    onMessage: (kind, h) => void handlers.set(kind, h),
    onPeerJoin: (cb) => { join = cb; },
    onPeerLeave: (cb) => { leave = cb; },
    leave: () => { left = true; },
  };
  return {
    room, sent,
    join: (id: string) => join(id),
    leave: (id: string) => leave(id),
    receive: (kind: MessageKind, data: unknown, from: string) => handlers.get(kind)!(data, from),
    get left() { return left; },
  };
}

function setup(joinedAt = 1000) {
  const fake = fakeRoom();
  const world = { doors: [{ state: new DoorState(door) }], movables: [], lights: new LightGroups(['sala']), screens: [] };
  const avatars = new Avatars(null);
  let now = 0;
  const changed: string[][] = [];
  const peers: string[][] = [];
  const mp = new Multiplayer(fake.room, world, avatars, 'Ana', {
    now: () => now, onChanged: (k) => void changed.push(k), onPeers: (n) => void peers.push(n),
  }, joinedAt);
  return { fake, world, avatars, mp, changed, peers, setNow: (t: number) => { now = t; }, node: new Object3D() };
}

describe('Multiplayer', () => {
  it('greets a joining peer, shows it as Guest until its hello, then by name', () => {
    const { fake, avatars, mp, peers } = setup();
    fake.join('p1');
    expect(fake.sent).toEqual([{ kind: 'hello', data: { name: 'Ana', since: 1000 }, to: 'p1' }]);
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
  it('stops asking once it has a state or changed something itself', () => {
    const { fake, world, mp } = setup(1000);
    fake.receive('state', { 'door:Door_1': 1 }, 'old');
    expect(world.doors[0].state.isOpen).toBe(true);
    fake.receive('hello', { name: 'Rui', since: 500 }, 'old');
    expect(fake.sent.filter((s) => s.kind === 'state')).toEqual([]);
    const other = setup(1000);
    other.mp.broadcast({ 'light:sala': 1 });
    other.fake.receive('hello', { name: 'Rui', since: 500 }, 'old');
    expect(other.fake.sent).toEqual([{ kind: 'state', data: { 'light:sala': 1 } }]);
    void mp;
  });
  it('answers a state request with everything', () => {
    const { fake, world } = setup();
    world.lights.set('sala', true);
    fake.receive('state', { want: 1 }, 'p1');
    expect(fake.sent.at(-1)).toEqual({ kind: 'state', data: { 'door:Door_1': 0, 'light:sala': 1 }, to: 'p1' });
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
});
