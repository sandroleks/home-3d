import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { DoorState } from '../src/doors';
import type { Target } from '../src/interactions';
import { LightGroups } from '../src/lightmaps';
import type { DoorInfo, MovableInfo, ScreenInfo } from '../src/manifest';
import { MovableState } from '../src/movables';
import {
  applyState, byArrival, cleanName, collectState, colourFor, encodePose, hashId, hostOf, isPose, isStateMap, loadArrived, loadName, Peers, poseMoved, saveName, splitPose,
  shortestTurn, shouldSend, smoothPose, stateDelta, stateKey, stateValue,
} from '../src/presence';
import { Screen } from '../src/screens';

const door = (node: string): DoorInfo => ({ node, hinge: [0, 0], dir: [0, 1], width: 0.8, openAngle: -1.5, opening: 1, lightmap: { file: 'd', range: 1 }, packs: [] });
const movable = (node: string, kind: MovableInfo['kind'] = 'slide'): MovableInfo => ({ node, room: 'sala', kind, dir: [0, 0, 1], distance: 0.3, lightmap: { file: 'm', range: 1 }, packs: [] });
const stubCanvas = (width: number, height: number) => ({ width, height, getContext: () => null });
const screenInfo = (node: string, kind: ScreenInfo['kind']): ScreenInfo => ({ node, room: 'sala', kind, group: null, center: [0, 1, 0], normal: [0, 0, 1], width: 1, height: 0.5 });

function world() {
  return {
    doors: [{ state: new DoorState(door('Door_1')) }],
    movables: [{ state: new MovableState(movable('Move_drawer')) }, { state: new MovableState(movable('Move_platter', 'spin')) }],
    lights: new LightGroups(['sala', 'sala/floor-lamp']),
    screens: [new Screen(screenInfo('Screen_tv', 'tv'), new Object3D(), stubCanvas), new Screen(screenInfo('Screen_monitor', 'monitor'), new Object3D(), stubCanvas)],
  };
}

describe('names and colours', () => {
  it('trims, squashes spaces, cuts to length and falls back to Guest', () => {
    expect(cleanName('  Ana   Maria  ')).toBe('Ana Maria');
    expect(cleanName('')).toBe('Guest');
    expect(cleanName(null)).toBe('Guest');
    expect(cleanName('x'.repeat(40), 24)).toHaveLength(24);
    expect(cleanName('abcdef ghij', 7)).toBe('abcdef');
  });
  it('remembers the name and survives a broken storage', () => {
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(loadName(storage)).toBe('');
    saveName(storage, 'Rui');
    expect(loadName(storage)).toBe('Rui');
    const broken = () => { throw new Error('no storage'); };
    expect(loadName(broken)).toBe('');
    expect(() => saveName(broken, 'x')).not.toThrow();
  });
  it('hashes ids stably and spreads them over the palette', () => {
    expect(hashId('abc')).toBe(hashId('abc'));
    expect(hashId('abc')).not.toBe(hashId('abd'));
    const palette = ['a', 'b', 'c'];
    const picks = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((id) => colourFor(id, palette)));
    expect(picks.size).toBeGreaterThan(1);
    for (const c of picks) expect(palette).toContain(c);
  });
});

describe('poses', () => {
  it('rounds to millimetres and validates', () => {
    const p = encodePose(1.23456, -2.00049, 0.1, 0.0004);
    expect(p).toEqual([1.235, -2, 0.1, 0]);
    expect(isPose(p)).toBe(true);
    expect(isPose([1, 2, 3])).toBe(false);
    expect(isPose([1, 2, 3, 'x'])).toBe(false);
    expect(isPose([1, 2, 3, NaN])).toBe(false);
    expect(isPose({ x: 1 })).toBe(false);
  });
  it('adds sitting or lying, and reads it back', () => {
    const p = encodePose(1, 2, 0.5, 0, [1, 0.4712, -1.5708]);
    expect(p).toEqual([1, 2, 0.5, 0, 1, 0.471, -1.571]);
    expect(isPose(p)).toBe(true);
    expect(isPose([1, 2, 3, 4, 1])).toBe(false);
    expect(splitPose(p)).toEqual({ pose: [1, 2, 0.5, 0], seating: [1, 0.471, -1.571] });
    expect(splitPose([1, 2, 0.5, 0]).seating).toBeNull();
    expect(splitPose([1, 2, 0.5, 0, 7, 0, 0]).seating).toBeNull(); // not a posture this version knows
  });
  it('counts sitting down or standing up as moving', () => {
    expect(poseMoved([0, 0, 0, 0], [0, 0, 0, 0, 1, 0.45, 0])).toBe(true);
    expect(poseMoved([0, 0, 0, 0, 1, 0.45, 0], [0, 0, 0, 0, 1, 0.45, 0])).toBe(false);
  });
  it('knows when a pose moved', () => {
    expect(poseMoved(null, [0, 0, 0, 0])).toBe(true);
    expect(poseMoved([0, 0, 0, 0], [0, 0, 0, 0])).toBe(false);
    expect(poseMoved([0, 0, 0, 0], [0, 0.001, 0, 0])).toBe(true);
  });
  it('sends fast while moving and slowly while still', () => {
    const rates = { poseRate: 10, idleRate: 1 };
    expect(shouldSend(0, 0.05, true, rates)).toBe(false);
    expect(shouldSend(0, 0.1, true, rates)).toBe(true);
    expect(shouldSend(0, 0.5, false, rates)).toBe(false);
    expect(shouldSend(0, 1, false, rates)).toBe(true);
  });
  it('turns the short way round', () => {
    expect(shortestTurn(0, 1)).toBeCloseTo(1);
    expect(shortestTurn(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(shortestTurn(-3, 3)).toBeCloseTo(-(2 * Math.PI - 6));
  });
  it('smooths toward the target and lands on it with a large step', () => {
    const a = smoothPose([0, 0, 0, 0], [1, 2, 1, 0.5], 0.1, 0.1);
    for (let i = 0; i < 4; i++) {
      expect(a[i]).toBeGreaterThan(0);
      expect(a[i]).toBeLessThan([1, 2, 1, 0.5][i]);
    }
    expect(a[0]).toBeCloseTo(1 - Math.exp(-1));
    const b = smoothPose([0, 0, 3, 0], [1, 2, -3, 0.5], 10, 0.1);
    expect(b[0]).toBeCloseTo(1);
    expect(b[2]).toBeCloseTo(-3 + 2 * Math.PI, 3); // the short way: past pi, not back through zero
    expect(smoothPose([0, 0, 0, 0], [1, 1, 1, 1], 0.1, 0)).toEqual([1, 1, 1, 1]);
  });
});

describe('shared state', () => {
  it('keys and values follow the target', () => {
    const w = world();
    const node = new Object3D();
    const d: Target = { kind: 'door', door: w.doors[0].state, node };
    const m: Target = { kind: 'movable', movable: w.movables[0].state, node };
    const l: Target = { kind: 'lamp', group: 'sala/floor-lamp', name: 'floor-lamp', node };
    const sw: Target = { kind: 'switch', room: 'sala', node };
    const sc: Target = { kind: 'screen', screen: w.screens[0], node };
    expect(stateKey(d)).toBe('door:Door_1');
    expect(stateKey(m)).toBe('movable:Move_drawer');
    expect(stateKey(l)).toBe('light:sala/floor-lamp');
    expect(stateKey(sw)).toBe('light:sala');
    expect(stateKey(sc)).toBe('screen:Screen_tv');
    expect(stateValue(d, w.lights)).toBe(0);
    w.doors[0].state.toggle();
    expect(stateDelta(d, w.lights)).toEqual({ 'door:Door_1': 1 });
    w.lights.toggle('sala');
    expect(stateValue(sw, w.lights)).toBe(1);
    expect(stateValue(sc, w.lights)).toBe(-1);
    w.screens[0].click(0);
    w.screens[0].click(1);
    expect(stateValue(sc, w.lights)).toBe(1);
  });
  it('collects everything and validates maps', () => {
    const w = world();
    expect(collectState(w)).toEqual({
      'door:Door_1': 0, 'movable:Move_drawer': 0, 'movable:Move_platter': 0, 'light:sala': 0, 'light:sala/floor-lamp': 0,
      'screen:Screen_tv': -1, 'screen:Screen_monitor': -1,
    });
    expect(isStateMap({ 'door:x': 1 })).toBe(true);
    expect(isStateMap({ 'door:x': 'open' })).toBe(false);
    expect(isStateMap([1])).toBe(false);
    expect(isStateMap(null)).toBe(false);
  });
  it('applies a delta, reports what changed and ignores the unknown', () => {
    const w = world();
    const changed = applyState(w, { 'door:Door_1': 1, 'movable:Move_platter': 1, 'light:sala': 1, 'screen:Screen_tv': 2, 'screen:Screen_monitor': 0, 'door:Door_9': 1, 'light:nope': 1, 'what:ever': 1, nokey: 1 }, 5);
    expect(changed).toEqual(['door:Door_1', 'movable:Move_platter', 'light:sala', 'screen:Screen_tv', 'screen:Screen_monitor']);
    expect(w.doors[0].state.isOpen).toBe(true);
    expect(w.movables[1].state.isOpen).toBe(true);
    expect(w.lights.isOn('sala')).toBe(true);
    expect(w.screens[0].on).toBe(true);
    expect(w.screens[0].channel).toBe(2);
    expect(w.screens[1].on).toBe(true);
    // The same again changes nothing
    expect(applyState(w, { 'door:Door_1': 1, 'light:sala': 1, 'screen:Screen_tv': 2 }, 6)).toEqual([]);
    // Off again, and a channel change on its own
    expect(applyState(w, { 'screen:Screen_tv': 0, 'screen:Screen_monitor': -1, 'door:Door_1': 0 }, 7)).toEqual(['screen:Screen_tv', 'screen:Screen_monitor', 'door:Door_1']);
    expect(w.screens[0].channel).toBe(0);
    expect(w.screens[1].on).toBe(false);
    expect(w.doors[0].state.isOpen).toBe(false);
  });
  it('round-trips through collect and apply', () => {
    const a = world();
    a.doors[0].state.toggle();
    a.lights.set('sala/floor-lamp', true);
    a.screens[0].click(0);
    const b = world();
    applyState(b, collectState(a), 1);
    expect(collectState(b)).toEqual(collectState(a));
  });
});

describe('Peers', () => {
  it('lists ids with names, the default until a hello', () => {
    const p = new Peers(15);
    p.seen('a', 0);
    p.hello('b', 'Rui', 100, 0);
    expect(p.list()).toEqual([{ id: 'a', name: 'Guest', arrived: null }, { id: 'b', name: 'Rui', arrived: 100 }]);
  });
  it('tracks arrivals, hellos, names and departures', () => {
    const peers = new Peers(15);
    expect(peers.seen('a', 0)).toBe(true);
    expect(peers.seen('a', 1)).toBe(false);
    expect(peers.names('Guest')).toEqual(['Guest']);
    peers.hello('b', 'Rui', 123, 2);
    peers.hello('a', 'Ana', 100, 2);
    expect(peers.names()).toEqual(['Ana', 'Rui']);
    expect(peers.get('b')?.since).toBe(123);
    expect(peers.remove('a')).toBe(true);
    expect(peers.remove('a')).toBe(false);
    expect(peers.ids).toEqual(['b']);
  });
  it('prunes the silent', () => {
    const peers = new Peers(15);
    peers.seen('a', 0);
    peers.seen('b', 10);
    expect(peers.prune(14)).toEqual([]);
    expect(peers.prune(16)).toEqual(['a']);
    expect(peers.ids).toEqual(['b']);
  });

  it('shares a dimmed, toned light and applies it', () => {
    const w = world();
    w.lights.setScene('sala', 0.567, 447);
    const state = collectState(w);
    expect(state['light:sala']).toBe(0.567);
    expect(state['ct:sala']).toBe(447);
    expect(state['ct:sala/floor-lamp']).toBeUndefined();
    const other = world();
    expect(applyState(other, { 'light:sala': 0.567, 'ct:sala': 447 }, 1)).toEqual(['light:sala', 'ct:sala']);
    expect(other.lights.brightness('sala')).toBeCloseTo(0.567);
    expect(other.lights.mireds('sala')).toBe(447);
    expect(applyState(other, { 'light:sala': 0.567, 'ct:sala': 447 }, 2)).toEqual([]);
    expect(applyState(other, { 'light:sala': 0 }, 3)).toEqual(['light:sala']);
    expect(other.lights.isOn('sala')).toBe(false);
  });
});

describe('the host', () => {
  it('keeps an arrival time apart from the join time, the join time when none is given', () => {
    const p = new Peers(15);
    p.hello('a', 'Ana', 900, 0, 300);
    p.hello('b', 'Rui', 800, 0);
    expect(p.get('a')).toMatchObject({ since: 900, arrived: 300 });
    expect(p.get('b')).toMatchObject({ since: 800, arrived: 800 });
  });
  it('orders by arrival, ties by id, those without a hello last', () => {
    const list = [{ id: 'c', arrived: null }, { id: 'b', arrived: 200 }, { id: 'a', arrived: 200 }, { id: 'd', arrived: 100 }];
    expect([...list].sort(byArrival).map((p) => p.id)).toEqual(['d', 'a', 'b', 'c']);
  });
  it('is whoever arrived first, ties to the lower id', () => {
    expect(hostOf({ id: 'me', arrived: 1000 }, [])).toBe('me');
    expect(hostOf({ id: 'me', arrived: 1000 }, [{ id: 'p1', arrived: 2000 }])).toBe('me');
    expect(hostOf({ id: 'me', arrived: 1000 }, [{ id: 'p1', arrived: 2000 }, { id: 'p2', arrived: 500 }])).toBe('p2');
    expect(hostOf({ id: 'me', arrived: 1000 }, [{ id: 'aa', arrived: 1000 }])).toBe('aa');
  });
  it("doesn't count a peer without a hello", () => {
    expect(hostOf({ id: 'me', arrived: 1000 }, [{ id: 'p1', arrived: null }])).toBe('me');
  });
  it('remembers the arrival per room, and copes with broken storage', () => {
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(loadArrived(storage, 'party', 1000)).toBe(1000);
    expect(store.get('walkthrough.arrived.party')).toBe('1000');
    expect(loadArrived(storage, 'party', 5000)).toBe(1000); // a reload keeps it
    expect(loadArrived(storage, 'other', 6000)).toBe(6000); // another room starts afresh
    const broken = () => { throw new Error('no storage'); };
    expect(loadArrived(broken, 'party', 7000)).toBe(7000);
  });
});
