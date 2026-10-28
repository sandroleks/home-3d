import { Color, Mesh, MeshStandardMaterial, Object3D, BoxGeometry, PerspectiveCamera, Vector2, type Vector3 } from 'three';
import type { Seat } from '../src/seats';
import { describe, expect, it } from 'vitest';
import { DoorState } from '../src/doors';
import { activate, findTarget, Interactions, promptFor, setHighlight, type Target } from '../src/interactions';
import { LightGroups } from '../src/lightmaps';
import { MovableState } from '../src/movables';
import type { MovableInfo, ScreenInfo } from '../src/manifest';
import { Screen } from '../src/screens';

const doorInfo = { node: 'Door_1', hinge: [0, 0] as [number, number], dir: [1, 0] as [number, number], width: 0.8, openAngle: 1.5, opening: 1, lightmap: { file: 'x', range: 1 }, packs: [] };
const drawer: MovableInfo = { node: 'Move_front-s3-prep-drawers-0', room: 'cozinha', kind: 'slide', dir: [1, 0, 0], distance: 0.4, lightmap: { file: 'x', range: 1 }, packs: [] };

describe('interactions', () => {
  it('prompts and activates doors', () => {
    const lights = new LightGroups([]);
    const t: Target = { kind: 'door', door: new DoorState(doorInfo), node: new Object3D() };
    expect(promptFor(t, lights)).toBe('Click: open door');
    activate(t, lights);
    expect(promptFor(t, lights)).toBe('Click: close door');
  });

  it('prompts the turntable as a record player', () => {
    const lights = new LightGroups([]);
    const platter: MovableInfo = { node: 'Move_turntable-platter', room: 'sala', kind: 'spin', pivot: [0, 1, 0], axis: [0, -1, 0], rpm: 33.3, lightmap: { file: 'x', range: 1 }, packs: [] };
    const t: Target = { kind: 'movable', movable: new MovableState(platter), node: new Object3D() };
    expect(promptFor(t, lights)).toBe('Click: play a record');
    activate(t, lights);
    expect(promptFor(t, lights, 'Tap')).toBe('Tap: stop the record');
  });

  it('aims through glass that is not itself a target, but not through walls', () => {
    const lights = new LightGroups(['sala']);
    const glass = new Mesh(new BoxGeometry(1, 1, 0.01), new MeshStandardMaterial({ transparent: true, opacity: 0.2 }));
    const wall = new Mesh(new BoxGeometry(1, 1, 0.01), new MeshStandardMaterial());
    glass.position.set(0, 0, -0.5);
    wall.position.set(0, 0, -0.5);
    const node = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    node.position.set(0, 0, -1.5);
    for (const o of [glass, wall, node]) o.updateMatrixWorld();
    const t: Target = { kind: 'switch', room: 'sala', node };
    const camera = new PerspectiveCamera();
    expect(new Interactions(camera, [glass, node], new Map([[node as Object3D, t]]), lights).update()).toBe(t);
    expect(new Interactions(camera, [wall, node], new Map([[node as Object3D, t]]), lights).update()).toBeNull();
  });

  it('prompts the TV for its panel and leaves it as it is; a monitor still switches on and off', () => {
    const lights = new LightGroups([]);
    const stub = (width: number, height: number) => ({ width, height, getContext: () => null });
    const info = (kind: ScreenInfo['kind']): ScreenInfo => ({ node: `Screen_${kind}`, room: 'sala', kind, group: null, center: [0, 1, 0], normal: [0, 0, 1], width: 1, height: 0.5 });
    const tv = new Screen(info('tv'), new Object3D(), stub);
    const t: Target = { kind: 'screen', screen: tv, node: new Object3D() };
    expect(promptFor(t, lights)).toBe('Click: TV');
    expect(promptFor(t, lights, 'Tap')).toBe('Tap: TV');
    activate(t, lights);
    expect(tv.on).toBe(false);
    const monitor = new Screen(info('monitor'), new Object3D(), stub);
    const m: Target = { kind: 'screen', screen: monitor, node: new Object3D() };
    expect(promptFor(m, lights)).toBe('Click: turn screen on');
    activate(m, lights);
    expect(promptFor(m, lights)).toBe('Click: turn screen off');
  });

  it('prompts the wine, which changes nothing shared', () => {
    const lights = new LightGroups([]);
    const t: Target = { kind: 'wine', node: new Object3D() };
    expect(promptFor(t, lights)).toBe('Click: drink some wine');
    expect(promptFor(t, lights, 'Tap')).toBe('Tap: drink some wine');
    expect(() => activate(t, lights)).not.toThrow();
  });

  it('prompts the rifle rack and the Start button, which change nothing shared', () => {
    const lights = new LightGroups([]);
    const range = { armed: false, busy: false, canArm: true };
    const rack: Target = { kind: 'rack', range, node: new Object3D() };
    const button: Target = { kind: 'range-button', range, node: new Object3D() };
    expect(promptFor(rack, lights)).toBe('Click: pick up the rifle');
    expect(promptFor(button, lights, 'Tap')).toBe('Pick up a rifle to play');
    range.armed = true;
    expect(promptFor(rack, lights, 'Tap')).toBe('Tap: put the rifle back');
    expect(promptFor(button, lights)).toBe('Click: start a round');
    range.busy = true;
    expect(promptFor(button, lights)).toBe('A round is on');
    activate(rack, lights);
    activate(button, lights);
    expect(range).toEqual({ armed: true, busy: true, canArm: true });
  });

  it('asks a visitor who cannot pick up the rifle where they stand to step onto the balcony', () => {
    const lights = new LightGroups([]);
    const range = { armed: false, busy: false, canArm: false };
    const rack: Target = { kind: 'rack', range, node: new Object3D() };
    expect(promptFor(rack, lights)).toBe('Step onto the balcony to pick up the rifle');
    expect(promptFor(rack, lights, 'Tap')).toBe('Step onto the balcony to pick up the rifle');
    range.canArm = true;
    expect(promptFor(rack, lights)).toBe('Click: pick up the rifle');
  });

  it('prompts and activates switches', () => {
    const lights = new LightGroups(['sala']);
    const t: Target = { kind: 'switch', room: 'sala', node: new Object3D() };
    expect(promptFor(t, lights)).toBe('Click: turn light on');
    activate(t, lights);
    expect(promptFor(t, lights)).toBe('Click: turn light off');
    expect(promptFor(t, lights, 'Tap')).toBe('Tap: turn light off');
  });

  it('prompts and activates drawers and lamps', () => {
    const lights = new LightGroups(['sala', 'sala/floor-lamp', 'sala/bar-shelves']);
    const d: Target = { kind: 'movable', movable: new MovableState(drawer), node: new Object3D() };
    expect(promptFor(d, lights)).toBe('Click: open drawer');
    activate(d, lights);
    expect(promptFor(d, lights, 'Tap')).toBe('Tap: close drawer');
    const fridge: Target = { kind: 'movable', movable: new MovableState({ ...drawer, node: 'Move_fridge-door-upper', kind: 'hinge' }), node: new Object3D() };
    expect(promptFor(fridge, lights)).toBe('Click: open fridge');
    const lamp: Target = { kind: 'lamp', group: 'sala/floor-lamp', name: 'floor-lamp', node: new Object3D() };
    expect(promptFor(lamp, lights)).toBe('Click: turn floor lamp on');
    activate(lamp, lights);
    expect(lights.isOn('sala/floor-lamp')).toBe(true);
    expect(lights.isOn('sala')).toBe(false);
    expect(promptFor(lamp, lights)).toBe('Click: turn floor lamp off');
    expect(promptFor({ kind: 'lamp', group: 'sala/bar-shelves', name: 'bar-shelves', node: new Object3D() }, lights)).toBe('Click: turn shelf lights on');
  });

  it('finds the target through parent nodes', () => {
    const node = new Object3D();
    const child = new Object3D();
    node.add(child);
    const t: Target = { kind: 'switch', room: 'sala', node };
    const targets = new Map<Object3D, Target>([[node, t]]);
    expect(findTarget(child, targets)).toBe(t);
    expect(findTarget(new Object3D(), targets)).toBeNull();
    expect(findTarget(null, targets)).toBeNull();
  });

  it('highlights by tinting emissive and restores it', () => {
    const mat = new MeshStandardMaterial({ emissive: new Color(0.1, 0.1, 0.1) });
    const mesh = new Mesh(new BoxGeometry(), mat);
    setHighlight(mesh, true);
    expect(mat.emissive.r).toBeGreaterThan(0.1);
    setHighlight(mesh, false);
    expect(mat.emissive.r).toBeCloseTo(0.1);
  });
  it('highlights very dark surfaces less', () => {
    const black = new MeshStandardMaterial({ color: new Color(0.02, 0.02, 0.02) });
    const white = new MeshStandardMaterial({ color: new Color(0.9, 0.9, 0.9) });
    setHighlight(new Mesh(new BoxGeometry(), black), true);
    setHighlight(new Mesh(new BoxGeometry(), white), true);
    expect(white.emissive.r).toBeCloseTo(0.12);
    expect(black.emissive.r).toBeLessThan(0.015);
    expect(black.emissive.r).toBeGreaterThan(0);
  });
  it('click returns the activated target, or null when nothing is aimed at', () => {
    const lights = new LightGroups(['sala']);
    const node = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    node.position.set(0, 0, -1);
    node.updateMatrixWorld();
    const t: Target = { kind: 'switch', room: 'sala', node };
    const camera = new PerspectiveCamera();
    const interactions = new Interactions(camera, [node], new Map([[node as Object3D, t]]), lights);
    expect(interactions.click()).toBeNull();
    interactions.update();
    expect(interactions.click()).toBe(t);
    expect(lights.isOn('sala')).toBe(true);
  });
  it('tap activates what is under the tapped point, not the crosshair', () => {
    const lights = new LightGroups(['sala']);
    const node = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshStandardMaterial());
    node.position.set(0.5, 0, -1); // right of centre
    node.updateMatrixWorld();
    const t: Target = { kind: 'switch', room: 'sala', node };
    const camera = new PerspectiveCamera(90, 1);
    camera.updateMatrixWorld();
    const interactions = new Interactions(camera, [node], new Map([[node as Object3D, t]]), lights);
    expect(interactions.tap(new Vector2(0, 0))).toBeNull();
    expect(lights.isOn('sala')).toBe(false);
    expect(interactions.tap(new Vector2(0.5, 0))).toBe(t);
    expect(lights.isOn('sala')).toBe(true);
  });

  it('offers the seat where the room is hit, and none through a target or past a wall', () => {
    const lights = new LightGroups(['sala']);
    const room = new Mesh(new BoxGeometry(1, 1, 0.01), new MeshStandardMaterial());
    room.position.set(0, 0, -1);
    room.updateMatrixWorld();
    const seat: Seat = { name: 'Sofa', pose: 'sit', min: [-1, -1, -1.1], max: [1, 1, -0.9], spots: [{ at: [0, 0, -1], yaw: 0 }] };
    const marker = new Object3D();
    const finder = (p: Vector3): Target | null => (Math.abs(p.z + 1) < 0.1 ? { kind: 'seat', seat, spot: seat.spots[0], node: marker } : null);
    const camera = new PerspectiveCamera();
    const interactions = new Interactions(camera, [room], new Map(), lights, undefined, finder);
    const t = interactions.update();
    expect(t?.kind).toBe('seat');
    expect(promptFor(t!, lights)).toBe('Click: sit down');
    expect(promptFor({ kind: 'seat', seat: { ...seat, pose: 'lie' }, spot: seat.spots[0], node: marker }, lights, 'Tap')).toBe('Tap: lie down');
    expect(promptFor({ kind: 'seat', seat, spot: null, node: marker }, lights)).toBe('Someone is here');
    expect(interactions.click()).toBe(t); // sitting down is main.ts's
  });
});
