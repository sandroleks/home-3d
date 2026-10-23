import { Color, Mesh, MeshStandardMaterial, Object3D, BoxGeometry, PerspectiveCamera, Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import { DoorState } from '../src/doors';
import { activate, findTarget, Interactions, promptFor, setHighlight, type Target } from '../src/interactions';
import { RoomLights } from '../src/lightmaps';

const doorInfo = { node: 'Door_1', hinge: [0, 0] as [number, number], dir: [1, 0] as [number, number], width: 0.8, openAngle: 1.5, lightmap: { file: 'x', range: 1 }, lights: [] };

describe('interactions', () => {
  it('prompts and activates doors', () => {
    const lights = new RoomLights([]);
    const t: Target = { kind: 'door', door: new DoorState(doorInfo), node: new Object3D() };
    expect(promptFor(t, lights)).toBe('Click: open door');
    activate(t, lights);
    expect(promptFor(t, lights)).toBe('Click: close door');
  });

  it('prompts and activates switches', () => {
    const lights = new RoomLights(['sala']);
    const t: Target = { kind: 'switch', room: 'sala', node: new Object3D() };
    expect(promptFor(t, lights)).toBe('Click: turn light on');
    activate(t, lights);
    expect(promptFor(t, lights)).toBe('Click: turn light off');
    expect(promptFor(t, lights, 'Tap')).toBe('Tap: turn light off');
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
  it('click returns the activated target, or null when nothing is aimed at', () => {
    const lights = new RoomLights(['sala']);
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
    const lights = new RoomLights(['sala']);
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
});
