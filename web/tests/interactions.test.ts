import { Color, Mesh, MeshStandardMaterial, Object3D, BoxGeometry, PerspectiveCamera, Quaternion, Vector2, Vector3 } from 'three';
import { Prop } from '../src/props';
import type { Seat } from '../src/seats';
import { describe, expect, it } from 'vitest';
import { DoorState } from '../src/doors';
import { activate, findTarget, Interactions, promptFor, setHighlight, type Target } from '../src/interactions';
import { LightGroups } from '../src/lightmaps';
import { MovableState } from '../src/movables';
import type { MovableInfo } from '../src/manifest';

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

  it('prompts a loose thing to be picked up, and leaves the picking up to the caller', () => {
    const lights = new LightGroups([]);
    const prop = new Prop({ id: 'a/wineglass/0', kind: 'wineglass', variant: 0, node: null, position: new Vector3(), quaternion: new Quaternion(), on: null, place: 'A' }, { matte: null, gloss: null });
    const t: Target = { kind: 'prop', prop, node: prop.root };
    expect(promptFor(t, lights)).toBe('Click: pick up wine glass');
    expect(promptFor(t, lights, 'Tap')).toBe('Tap: pick up wine glass');
    activate(t, lights);
    expect(prop.state).toBe('rest');
  });
});
