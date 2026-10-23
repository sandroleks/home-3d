import type {} from 'three-mesh-bvh';
import { Mesh, MeshStandardMaterial, Object3D, Quaternion, Scene, Vector3 } from 'three';
import { Collision } from './collision';
import { DoorState } from './doors';
import type { Target } from './interactions';
import { BLACK_LIGHTMAP, RoomLights, setLightTexture } from './lightmaps';
import type { LoadedAssets } from './loader';
import { RoomLocator } from './rooms';
import { prepareMeshes } from './scene-setup';

export interface DoorRuntime { state: DoorState; node: Object3D; base: Quaternion }
export interface World {
  lights: RoomLights;
  doors: DoorRuntime[];
  targets: Map<Object3D, Target>;
  switches: Map<string, Object3D>;
  pickables: Object3D[];
  rooms: RoomLocator;
  collision: Collision;
  lightmapped: MeshStandardMaterial[];
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
  const pendingLight = new Map<string, MeshStandardMaterial[]>();

  for (const chunk of manifest.chunks) {
    const n = node(root, chunk.node);
    const d = day.get(chunk.day.file)!;
    const intensity = chunk.room && lights.has(chunk.room) ? lights.uniform(chunk.room) : { value: 0 };
    const mats = prepareMeshes(n, {
      day: d.texture, dayRange: d.range, light: BLACK_LIGHTMAP, lightRange: 0, intensity,
    });
    lightmapped.push(...mats);
    if (chunk.light) pendingLight.set(chunk.light.file, mats);
    n.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).geometry.computeBoundsTree?.();
    });
    pickables.push(n);
  }

  assets.light.then((maps) => {
    for (const [file, mats] of pendingLight) {
      const m = maps.get(file);
      if (m) for (const mat of mats) setLightTexture(mat, m.texture, m.range);
    }
  }).catch((err) => console.warn('Room light maps failed to bind; lights will stay dark.', err));

  const targets = new Map<Object3D, Target>();
  const doors: DoorRuntime[] = manifest.doors.map((info) => {
    const n = node(root, info.node);
    const d = day.get(info.lightmap.file)!;
    lightmapped.push(...prepareMeshes(n, { day: d.texture, dayRange: d.range, light: BLACK_LIGHTMAP, lightRange: 0, intensity: { value: 0 } }));
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
  return { lights, doors, targets, switches, pickables, rooms: new RoomLocator(manifest.rooms), collision, lightmapped };
}
