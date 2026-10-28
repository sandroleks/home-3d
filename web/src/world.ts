import type {} from 'three-mesh-bvh';
import { Color, Mesh, MeshStandardMaterial, Object3D, Quaternion, Scene, type Texture, Vector3 } from 'three';
import { Collision } from './collision';
import { DoorState, easeInOut } from './doors';
import type { Target } from './interactions';
import { BLACK_LIGHTMAP, LIGHT_SPILL, LightGroups, packBinding, type PackBinding, setLightTexture, updatePacks } from './lightmaps';
import type { LoadedAssets } from './loader';
import type { LightmapRef, Pack, PackLayer } from './manifest';
import { movableRuntime, MovableState, type MovableRuntime } from './movables';
import { RoomLocator } from './rooms';
import { prepareMeshes } from './scene-setup';
import { type CanvasFactory, domCanvas, Screen } from './screens';

export interface DoorRuntime { state: DoorState; node: Object3D; base: Quaternion; position: Vector3 }
/** A glowing material (lampshade, bulb, LED strip) that follows its light group. */
export interface Glow { group: string; material: MeshStandardMaterial; base: number; baseColor: Color; mesh: Mesh }
export interface World {
  root: Object3D;
  lights: LightGroups;
  doors: DoorRuntime[];
  movables: MovableRuntime[];
  screens: Screen[];
  targets: Map<Object3D, Target>;
  switches: Map<string, Object3D>;
  pickables: Object3D[];
  /** What flights hit and things are put on: the rooms, the doors and the drawers and cupboard doors. */
  solids: Object3D[];
  rooms: RoomLocator;
  collision: Collision;
  lightmapped: MeshStandardMaterial[];
  /** Multiplies every baked sky layer; the daylight sets it from the time of day. */
  sky: { value: number };
  /** Per room: flat bounce light from sun entering its windows. */
  fills: Map<string, { value: Color }>;
  glows: Glow[];
  /** Every packed lamp layer, for updatePacks each frame. */
  packs: PackBinding[];
  /** How much of a packed layer's light is on: its group's level, or a spill's door and room. */
  layerLevel: (layer: PackLayer) => number;
  /** Pack channels lit by a screen: their colour follows the picture. */
  screenTints: { tint: Vector3; screen: Screen }[];
  /** Meshes that block sunlight: everything except glass. */
  occluders: Mesh[];
}

const UP = new Vector3(0, 1, 0);
const tmp = new Quaternion();
/** Materials split per light group by the export are named '<material> @<group id>'. */
const GROUP_SUFFIX = / @([^@]+)$/;

function node(root: Object3D, name: string): Object3D {
  const n = root.getObjectByName(name);
  if (!n) throw new Error(`apartment.glb has no node named ${name}`);
  return n;
}

/** A hinged leaf turns about its hinge (the node's origin); a sliding leaf moves along its slide. */
export function applyDoorPose(d: DoorRuntime): void {
  d.node.quaternion.copy(d.base).premultiply(tmp.setFromAxisAngle(UP, d.state.angle));
  const [sx, sz] = d.state.info.slide?.dir ?? [0, 0];
  d.node.position.set(d.position.x + sx * d.state.offset, d.position.y, d.position.z + sz * d.state.offset);
}

/** The group a glowing material follows, from its name. */
export function glowGroup(materialName: string): string | null {
  return GROUP_SUFFIX.exec(materialName)?.[1] ?? null;
}

export function buildWorld(assets: LoadedAssets, scene: Scene, canvas: CanvasFactory = domCanvas): World {
  const { manifest, day } = assets;
  const root = assets.scene;
  scene.add(root);

  const lights = new LightGroups(manifest.groups.map((g) => g.id));
  const lightmapped: MeshStandardMaterial[] = [];
  const pickables: Object3D[] = [];
  const solids: Object3D[] = [];
  const allPacks: PackBinding[] = [];
  /** Lightmaps still loading: file -> what to bind it to. */
  const pending = new Map<string, ((t: { texture: Texture; range: number }) => void)[]>();
  const awaitMap = (file: string, bind: (t: { texture: Texture; range: number }) => void) =>
    pending.set(file, [...(pending.get(file) ?? []), bind]);
  const bindPacks = (packs: Pack[]): PackBinding[] => packs.map((p) => {
    const b = packBinding(p.layers);
    awaitMap(p.file, (m) => { b.texture.value = m.texture; });
    allPacks.push(b);
    return b;
  });

  const sky = { value: 1 };
  const noFill = { value: new Color(0, 0, 0) };
  const off = { value: 0 };
  const fills = new Map(manifest.rooms.map((r) => [r.id, { value: new Color(0, 0, 0) }] as const));
  const glows: Glow[] = [];
  const collectGlows = (n: Object3D) => n.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as MeshStandardMaterial;
    const group = glowGroup(m.name);
    if (group && lights.has(group) && m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0) glows.push({ group, material: m, base: m.emissiveIntensity, baseColor: m.emissive.clone(), mesh });
  });
  const lightmap = (n: Object3D, dayRef: LightmapRef, packs: Pack[], room: string | null, switched: LightmapRef | null) => {
    const d = day.get(dayRef.file)!;
    const hasSwitch = room !== null && switched !== null && lights.has(room);
    const mats = prepareMeshes(n, {
      day: d.texture, dayRange: d.range, light: BLACK_LIGHTMAP, lightRange: 0, intensity: hasSwitch ? lights.uniform(room) : off,
      lightColor: hasSwitch ? lights.color(room) : undefined,
      packs: bindPacks(packs), sky, fill: (room && fills.get(room)) || noFill,
    });
    lightmapped.push(...mats);
    collectGlows(n);
    if (hasSwitch) awaitMap(switched.file, (m) => mats.forEach((mat) => setLightTexture(mat, m.texture, m.range)));
    n.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).geometry.computeBoundsTree?.();
    });
    pickables.push(n);
    return mats;
  };

  for (const chunk of manifest.chunks) {
    const n = node(root, chunk.node);
    lightmap(n, chunk.day, chunk.packs, chunk.room, chunk.light);
    solids.push(n);
  }

  const targets = new Map<Object3D, Target>();
  const doors: DoorRuntime[] = manifest.doors.map((info) => {
    const n = node(root, info.node);
    lightmap(n, info.lightmap, info.packs, null, null);
    solids.push(n);
    const state = new DoorState(info);
    targets.set(n, { kind: 'door', door: state, node: n });
    return { state, node: n, base: n.quaternion.clone(), position: n.position.clone() };
  });

  const movables: MovableRuntime[] = manifest.movables.map((info) => {
    const n = node(root, info.node);
    lightmap(n, info.lightmap, info.packs, null, null);
    solids.push(n);
    const state = new MovableState(info);
    targets.set(n, { kind: 'movable', movable: state, node: n });
    return movableRuntime(state, n);
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

  for (const g of manifest.groups) {
    if (g.kind !== 'lamp' || !g.target) continue;
    const n = node(root, g.target);
    n.visible = false; // an invisible box around the lamp's fixtures, only there to be clicked
    targets.set(n, { kind: 'lamp', group: g.id, name: g.name, node: n });
    pickables.push(n);
  }

  for (const g of manifest.glows) {
    const n = node(root, g.node);
    prepareMeshes(n, null);
    n.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      const m = mesh.material as MeshStandardMaterial;
      if (m.emissive && lights.has(g.group)) glows.push({ group: g.group, material: m, base: m.emissiveIntensity, baseColor: m.emissive.clone(), mesh });
    });
  }

  const screens = manifest.screens.map((info) => {
    const n = node(root, info.node);
    const s = new Screen(info, n, canvas);
    targets.set(n, { kind: 'screen', screen: s, node: n });
    pickables.push(n);
    return s;
  });

  assets.light.then((maps) => {
    for (const [file, binds] of pending) {
      const m = maps.get(file);
      if (m) for (const bind of binds) bind(m);
    }
  }).catch((err) => console.warn('Lamp light maps failed to bind; lamps will stay dark.', err));

  // Light through an open door: how far its leaves are open, times how much of the room behind it is lit.
  const leaves = new Map<number, DoorState[]>();
  for (const d of doors) leaves.set(d.state.info.opening, [...(leaves.get(d.state.info.opening) ?? []), d.state]);
  const roomGroups = new Map<string, { id: string; share: number }[]>();
  for (const g of manifest.groups) roomGroups.set(g.room, [...(roomGroups.get(g.room) ?? []), { id: g.id, share: g.power }]);
  for (const gs of roomGroups.values()) {
    const total = gs.reduce((a, g) => a + g.share, 0) || 1;
    for (const g of gs) g.share /= total;
  }
  // A screen's baked light is for a white picture: it follows the picture's brightness, and its colour (below).
  const screenOf = new Map(screens.filter((s) => s.info.group).map((s) => [s.info.group!, s] as const));
  const layerLevel = (layer: PackLayer): number => {
    const screen = layer.group !== undefined ? screenOf.get(layer.group) : undefined;
    if (screen) return lights.uniform(layer.group!).value * screen.brightness;
    if (layer.group !== undefined) return lights.has(layer.group) ? Math.max(lights.uniform(layer.group).value, LIGHT_SPILL.value) : 0;
    const { opening, from } = layer.spill!;
    const ls = leaves.get(opening) ?? [];
    const open = ls.reduce((a, s) => a + easeInOut(s.progress), 0) / (ls.length || 1);
    const lit = (roomGroups.get(from) ?? []).reduce((a, g) => a + g.share * lights.uniform(g.id).value, 0);
    return open * lit;
  };

  const collision = new Collision(assets.collision, () => doors.map((d) => d.state.segment()));
  const occluders: Mesh[] = [];
  root.traverseVisible((o) => {
    if ((o as Mesh).isMesh && o.castShadow) occluders.push(o as Mesh);
  });
  const screenTints = allPacks.flatMap((p) => p.layers.flatMap((l, i) => {
    const s = l.group !== undefined ? screenOf.get(l.group) : undefined;
    return s ? [{ tint: p.tints.value[i], screen: s }] : [];
  }));
  return {
    root, lights, doors, movables, screens, targets, switches, pickables, solids, rooms: new RoomLocator(manifest.rooms), collision,
    lightmapped, sky, fills, glows, packs: allPacks, layerLevel, screenTints, occluders,
  };
}

/** Lampshades, bulbs and LED strips glow only while their group's light is on, in its colour. */
export function applyGlows(glows: Glow[], lights: LightGroups): void {
  for (const g of glows) {
    g.material.emissiveIntensity = g.base * lights.uniform(g.group).value;
    g.material.emissive.copy(g.baseColor).multiply(lights.color(g.group).value);
  }
}

/** Each frame: every packed lamp layer's gains from its group or door. */
export function applyPacks(world: World): void {
  for (const p of world.packs) {
    p.layers.forEach((l, i) => {
      if (l.group !== undefined && world.lights.has(l.group)) p.tints.value[i].copy(p.baseTints[i]).multiply(colorVector(world.lights.color(l.group).value));
    });
  }
  for (const { tint, screen } of world.screenTints) tint.set(screen.tint.r, screen.tint.g, screen.tint.b);
  updatePacks(world.packs, world.layerLevel);
}

const scratch = new Vector3();
function colorVector(c: Color): Vector3 {
  return scratch.set(c.r, c.g, c.b);
}
