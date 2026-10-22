import { rleDecode } from './rle';

export interface LightmapRef { file: string; range: number }
export interface Spawn { x: number; z: number; yaw: number }
export interface RoomInfo { id: string; name: string; floor: number[]; switch: string | null }
export interface ChunkInfo { node: string; room: string | null; day: LightmapRef; light: LightmapRef | null }
export interface DoorInfo {
  node: string;
  hinge: [number, number];
  dir: [number, number];
  width: number;
  openAngle: number;
  lightmap: LightmapRef;
}
export interface Viewpoint { name: string; position: [number, number, number]; yaw: number; pitch: number; hfov: number }
export interface Manifest {
  version: 1;
  eyeHeight: number;
  spawn: Spawn;
  rooms: RoomInfo[];
  chunks: ChunkInfo[];
  doors: DoorInfo[];
  viewpoints: Viewpoint[];
}
export interface CollisionData {
  x0: number;
  z0: number;
  cell: number;
  width: number;
  height: number;
  radius: number;
  blocked: Uint8Array;
}

export class ManifestError extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ManifestError(`${path}: expected an object`);
  return v as Obj;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ManifestError(`${path}: expected an array`);
  return v;
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ManifestError(`${path}: expected a number`);
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new ManifestError(`${path}: expected a string`);
  return v;
}
function strOrNull(v: unknown, path: string): string | null {
  return v === null ? null : str(v, path);
}
function vec<N extends number>(v: unknown, n: N, path: string): number[] & { length: N } {
  const a = arr(v, path);
  if (a.length !== n) throw new ManifestError(`${path}: expected ${n} numbers`);
  return a.map((x, i) => num(x, `${path}[${i}]`)) as number[] & { length: N };
}
function lightmap(v: unknown, path: string): LightmapRef {
  const o = obj(v, path);
  return { file: str(o.file, `${path}.file`), range: num(o.range, `${path}.range`) };
}

export function parseManifest(json: unknown): Manifest {
  const m = obj(json, 'manifest');
  if (m.version !== 1) throw new ManifestError(`version: expected 1, got ${String(m.version)}`);
  const spawn = obj(m.spawn, 'spawn');
  return {
    version: 1,
    eyeHeight: num(m.eyeHeight, 'eyeHeight'),
    spawn: { x: num(spawn.x, 'spawn.x'), z: num(spawn.z, 'spawn.z'), yaw: num(spawn.yaw, 'spawn.yaw') },
    rooms: arr(m.rooms, 'rooms').map((v, i) => {
      const r = obj(v, `rooms[${i}]`);
      return {
        id: str(r.id, `rooms[${i}].id`),
        name: str(r.name, `rooms[${i}].name`),
        floor: arr(r.floor, `rooms[${i}].floor`).map((x, k) => num(x, `rooms[${i}].floor[${k}]`)),
        switch: strOrNull(r.switch, `rooms[${i}].switch`),
      };
    }),
    chunks: arr(m.chunks, 'chunks').map((v, i) => {
      const c = obj(v, `chunks[${i}]`);
      return {
        node: str(c.node, `chunks[${i}].node`),
        room: strOrNull(c.room, `chunks[${i}].room`),
        day: lightmap(c.day, `chunks[${i}].day`),
        light: c.light === null ? null : lightmap(c.light, `chunks[${i}].light`),
      };
    }),
    doors: arr(m.doors, 'doors').map((v, i) => {
      const d = obj(v, `doors[${i}]`);
      return {
        node: str(d.node, `doors[${i}].node`),
        hinge: vec(d.hinge, 2, `doors[${i}].hinge`) as [number, number],
        dir: vec(d.dir, 2, `doors[${i}].dir`) as [number, number],
        width: num(d.width, `doors[${i}].width`),
        openAngle: num(d.openAngle, `doors[${i}].openAngle`),
        lightmap: lightmap(d.lightmap, `doors[${i}].lightmap`),
      };
    }),
    viewpoints: arr(m.viewpoints, 'viewpoints').map((v, i) => {
      const p = obj(v, `viewpoints[${i}]`);
      return {
        name: str(p.name, `viewpoints[${i}].name`),
        position: vec(p.position, 3, `viewpoints[${i}].position`) as [number, number, number],
        yaw: num(p.yaw, `viewpoints[${i}].yaw`),
        pitch: num(p.pitch, `viewpoints[${i}].pitch`),
        hfov: num(p.hfov, `viewpoints[${i}].hfov`),
      };
    }),
  };
}

export function parseCollision(json: unknown): CollisionData {
  const c = obj(json, 'collision');
  const width = num(c.width, 'collision.width');
  const height = num(c.height, 'collision.height');
  const runs = arr(c.runs, 'collision.runs').map((x, i) => num(x, `collision.runs[${i}]`));
  return {
    x0: num(c.x0, 'collision.x0'),
    z0: num(c.z0, 'collision.z0'),
    cell: num(c.cell, 'collision.cell'),
    width,
    height,
    radius: num(c.radius, 'collision.radius'),
    blocked: rleDecode(runs, width * height),
  };
}
