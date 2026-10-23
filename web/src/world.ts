import type {} from 'three-mesh-bvh';
import { Color, Mesh, MeshStandardMaterial, Object3D, Quaternion, Scene, Vector3 } from 'three';
import { Collision } from './collision';
import { DoorState } from './doors';
import type { Target } from './interactions';
import { BLACK_LIGHTMAP, RoomLights, setLightTexture } from './lightmaps';
import type { LoadedAssets } from './loader';
import { RoomLocator } from './rooms';
import { prepareMeshes } from './scene-setup';

export interface DoorRuntime { state: DoorState; node: Object3D; base: Quaternion }
/** A glowing material (lampshade, screen) that follows its room's light. */
export interface Glow { room: string; material: MeshStandardMaterial; base: number }
export interface World {
  root: Object3D;
  lights: RoomLights;
  doors: DoorRuntime[];
  targets: Map<Object3D, Target>;
  switches: Map<string, Object3D>;
  pickables: Object3D[];
  rooms: RoomLocator;
  collision: Collision;
  lightmapped: MeshStandardMaterial[];
  /** Multiplies every baked sky layer; the daylight sets it from the time of day. */
  sky: { value: number };
  /** Per room: flat bounce light from sun entering its windows. */
  fills: Map<string, { value: Color }>;
  glows: Glow[];
  /** Meshes that block sunlight: everything except glass. */
  occluders: Mesh[];
}

const UP = new Vector3(0, 1, 0);
const tmp = new Quaternion();

function node(root: Object3D, name: string): Object3D {
  const n = root.getObjectByName(name);
  if (!n) throw new Error(`apartment.glb has no node named ${name}`);
  return n;
}

export function applyDoorRotation(d: DoorRuntime): void {
  d.node.quaternion.copy(d.base).premultiply(tmp.setFromAxisAngle(UP, d.state.angle));
}

export function buildWorld(assets: LoadedAssets, scene: Scene): World {
  const { manifest, day } = assets;
  const root = assets.scene;
  scene.add(root);

  const lightRooms = manifest.chunks.filter((c) => c.light && c.room).map((c) => c.room!);
  const lights = new RoomLights(lightRooms);
  const lightmapped: MeshStandardMaterial[] = [];
  const pickables: Object3D[] = [];
  /** Lamp layers waiting for their texture: file -> the materials and which slot it binds to. */
  const pendingLight = new Map<string, { mats: MeshStandardMaterial[]; slot: 1 | 2 }[]>();
  const awaitLight = (file: string, mats: MeshStandardMaterial[], slot: 1 | 2) =>
    pendingLight.set(file, [...(pendingLight.get(file) ?? []), { mats, slot }]);

  const sky = { value: 1 };
  const noFill = { value: new Color(0, 0, 0) };
  const fills = new Map(manifest.rooms.map((r) => [r.id, { value: new Color(0, 0, 0) }] as const));
  const glows: Glow[] = [];

  for (const chunk of manifest.chunks) {
    const n = node(root, chunk.node);
    const d = day.get(chunk.day.file)!;
    const intensity = chunk.room && lights.has(chunk.room) ? lights.uniform(chunk.room) : { value: 0 };
    const mats = prepareMeshes(n, {
      day: d.texture, dayRange: d.range, light: BLACK_LIGHTMAP, lightRange: 0, intensity,
      sky, fill: (chunk.room && fills.get(chunk.room)) || noFill,
    });
    lightmapped.push(...mats);
    if (chunk.room && lights.has(chunk.room)) {
      for (const m of mats) {
        if (m.emissive.r + m.emissive.g + m.emissive.b > 0) glows.push({ room: chunk.room, material: m, base: m.emissiveIntensity });
      }
    }
    if (chunk.light) awaitLight(chunk.light.file, mats, 1);
    n.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).geometry.computeBoundsTree?.();
    });
    pickables.push(n);
  }

  assets.light.then((maps) => {
    for (const [file, uses] of pendingLight) {
      const m = maps.get(file);
      if (m) for (const { mats, slot } of uses) for (const mat of mats) setLightTexture(mat, m.texture, m.range, slot);
    }
  }).catch((err) => console.warn('Room light maps failed to bind; lights will stay dark.', err));

  const targets = new Map<Object3D, Target>();
  const doors: DoorRuntime[] = manifest.doors.map((info) => {
    const n = node(root, info.node);
    const d = day.get(info.lightmap.file)!;
    // Each face of the leaf takes its room's lamps; the two layers are bound once they load.
    const lit = info.lights.filter((l) => lights.has(l.room)).slice(0, 2);
    const intensity = (k: number) => (lit[k] ? lights.uniform(lit[k].room) : { value: 0 });
    const mats = prepareMeshes(n, {
      day: d.texture, dayRange: d.range, light: BLACK_LIGHTMAP, lightRange: 0, intensity: intensity(0),
      light2: { texture: BLACK_LIGHTMAP, range: 0, intensity: intensity(1) }, sky, fill: noFill,
    });
    lightmapped.push(...mats);
    lit.forEach((l, k) => awaitLight(l.file, mats, k === 0 ? 1 : 2));
    const state = new DoorState(info);
    targets.set(n, { kind: 'door', door: state, node: n });
    pickables.push(n);
    return { state, node: n, base: n.quaternion.clone() };
  });

  const switches = new Map<string, Object3D>();
  for (const room of manifest.rooms) {
    if (!room.switch) continue;
    const n = node(root, room.switch);
    prepareMeshes(n, null);
    targets.set(n, { kind: 'switch', room: room.id, node: n });
    switches.set(room.id, n);
    pickables.push(n);
  }

  const collision = new Collision(assets.collision, () => doors.map((d) => d.state.segment()));
  const occluders: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh && o.castShadow) occluders.push(o as Mesh);
  });
  return { root, lights, doors, targets, switches, pickables, rooms: new RoomLocator(manifest.rooms), collision, lightmapped, sky, fills, glows, occluders };
}

/** Lampshades and screens glow only while their room's light is on. */
export function applyGlows(glows: Glow[], lights: RoomLights): void {
  for (const g of glows) g.material.emissiveIntensity = g.base * lights.uniform(g.room).value;
}
