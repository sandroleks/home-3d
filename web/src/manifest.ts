import { rleDecode } from './rle';

export interface LightmapRef { file: string; range: number }
export interface Spawn { x: number; z: number; yaw: number }
export interface RoomInfo { id: string; name: string; floor: number[]; switch: string | null; area: number }
/** A room's wall switch (id = the room's id) or a lamp that switches on its own (id `<room>/<name>`). */
export interface GroupInfo {
  id: string;
  room: string;
  kind: 'switch' | 'lamp';
  name: string;
  /** Watts of lamp light, to weigh the group in light that spills through a door. */
  power: number;
  /** The node to click: a wall switch, or an invisible box around a lamp's fixtures. */
  target: string | null;
}
/** Light through an open door: every lamp of room `from`, baked with door `opening` open. */
export interface Spill { opening: number; from: string }
/** One channel of a pack: a lamp group's light, or a spill, as luminance with its own range and tint. */
export interface PackLayer { group?: string; spill?: Spill; range: number; tint: [number, number, number] }
/** Up to four packed lamp layers in one texture. */
export interface Pack { file: string; layers: PackLayer[] }
export interface ChunkInfo {
  node: string;
  room: string | null;
  day: LightmapRef;
  /** The room's wall switch (RGBM). */
  light: LightmapRef | null;
  /** The room's lamps, an open-plan neighbour's, and light through its doors. */
  packs: Pack[];
}
export interface DoorInfo {
  node: string;
  hinge: [number, number];
  dir: [number, number];
  width: number;
  openAngle: number;
  /** The doorway: French doors are two leaves at one opening. */
  opening: number;
  /** A sliding door: the leaf slides `distance` m along `dir` instead of swinging (openAngle is 0). */
  slide?: { dir: [number, number]; distance: number };
  lightmap: LightmapRef;
  /** Lamp light from each room the leaf faces. */
  packs: Pack[];
  /** The rooms on either side (older exports: none). */
  rooms?: string[];
}
/** A drawer (slides `distance` m along `dir`), a cupboard door (turns `angle` about `axis` through `pivot`), or the
 * turntable's platter (turns `rpm` times a minute about `axis` while the record plays). */
export interface MovableInfo {
  node: string;
  room: string;
  kind: 'slide' | 'hinge' | 'spin';
  dir?: [number, number, number];
  distance?: number;
  pivot?: [number, number, number];
  axis?: [number, number, number];
  angle?: number;
  rpm?: number;
  lightmap: LightmapRef;
  packs: Pack[];
}
export type ScreenKind = 'tv' | 'monitor' | 'laptop';
/** A screen: centre and outward normal in three.js space, size in m; `group` is the lamp group it switches with. */
export interface ScreenInfo {
  node: string;
  room: string;
  kind: ScreenKind;
  group: string | null;
  center: [number, number, number];
  normal: [number, number, number];
  width: number;
  height: number;
}
/** A bulb or LED strip: unlit, glowing with its group. */
export interface GlowInfo { node: string; group: string }
export interface Viewpoint { name: string; position: [number, number, number]; yaw: number; pitch: number; hfov: number }
export interface SiteInfo { lat: number; lon: number; timeZone: string; yBearing: number }
/** The baked sky's irradiance on an upward face, and the factor from real W/m² to the scene's light units. */
export interface SkyInfo { irradiance: number; wattsToScene: number }
/** An exterior glass pane in three.js space; the normal points outdoors. */
export interface WindowInfo { room: string; center: [number, number, number]; normal: [number, number, number]; width: number; height: number }
/** A loose thing from the model: its node (origin at the middle of its base), what the prompt calls it, its room, its
 * box (m: width, height, length) and whether it falls over when it lands hard. */
export interface PropInfo { node: string; name: string; room: string | null; size: [number, number, number]; tips: boolean }
/** A room's reflection probes (equirectangular RGBM): seen from `at`, lit by the sky layer and by its wall switch,
 * with the mean radiance of each; `box` is the room's [min, max] in three.js space. */
export interface ProbeInfo {
  room: string;
  at: [number, number, number];
  box: [[number, number, number], [number, number, number]];
  day: LightmapRef;
  dayMean: [number, number, number];
  light: LightmapRef | null;
  lightMean: [number, number, number];
}
/** For each room, the other rooms it can see, each with the sets of doors (indices into `doors`) one of which must be
 * all open; a room missing from it sees everything. */
export type Visibility = Record<string, Record<string, number[][]>>;
export interface Manifest {
  version: 3;
  eyeHeight: number;
  spawn: Spawn;
  rooms: RoomInfo[];
  groups: GroupInfo[];
  chunks: ChunkInfo[];
  doors: DoorInfo[];
  movables: MovableInfo[];
  screens: ScreenInfo[];
  glows: GlowInfo[];
  viewpoints: Viewpoint[];
  site: SiteInfo;
  sky: SkyInfo;
  windows: WindowInfo[];
  props: PropInfo[];
  probes: ProbeInfo[];
  visibility: Visibility;
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
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new ManifestError(`${path}: expected true or false`);
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

function oneOf<T extends string>(v: unknown, options: readonly T[], path: string): T {
  if (!options.includes(v as T)) throw new ManifestError(`${path}: expected one of ${options.join(', ')}`);
  return v as T;
}

function packs(v: unknown, path: string): Pack[] {
  return arr(v, path).map((x, i) => {
    const p = obj(x, `${path}[${i}]`);
    return {
      file: str(p.file, `${path}[${i}].file`),
      layers: arr(p.layers, `${path}[${i}].layers`).map((y, k) => {
        const lp = `${path}[${i}].layers[${k}]`;
        const l = obj(y, lp);
        const layer: PackLayer = { range: num(l.range, `${lp}.range`), tint: vec(l.tint, 3, `${lp}.tint`) as [number, number, number] };
        if (l.group !== undefined) layer.group = str(l.group, `${lp}.group`);
        else {
          const s = obj(l.spill, `${lp}.spill`);
          layer.spill = { opening: num(s.opening, `${lp}.spill.opening`), from: str(s.from, `${lp}.spill.from`) };
        }
        return layer;
      }),
    };
  });
}

const VERSION = 3;

export function parseManifest(json: unknown): Manifest {
  const m = obj(json, 'manifest');
  if (m.version !== VERSION) throw new ManifestError(`version: expected ${VERSION}, got ${String(m.version)}`);
  const spawn = obj(m.spawn, 'spawn');
  return {
    version: VERSION,
    eyeHeight: num(m.eyeHeight, 'eyeHeight'),
    spawn: { x: num(spawn.x, 'spawn.x'), z: num(spawn.z, 'spawn.z'), yaw: num(spawn.yaw, 'spawn.yaw') },
    rooms: arr(m.rooms, 'rooms').map((v, i) => {
      const r = obj(v, `rooms[${i}]`);
      return {
        id: str(r.id, `rooms[${i}].id`),
        name: str(r.name, `rooms[${i}].name`),
        floor: arr(r.floor, `rooms[${i}].floor`).map((x, k) => num(x, `rooms[${i}].floor[${k}]`)),
        switch: strOrNull(r.switch, `rooms[${i}].switch`),
        area: num(r.area, `rooms[${i}].area`),
      };
    }),
    groups: arr(m.groups, 'groups').map((v, i) => {
      const g = obj(v, `groups[${i}]`);
      return {
        id: str(g.id, `groups[${i}].id`),
        room: str(g.room, `groups[${i}].room`),
        kind: oneOf(g.kind, ['switch', 'lamp'] as const, `groups[${i}].kind`),
        name: str(g.name, `groups[${i}].name`),
        power: num(g.power, `groups[${i}].power`),
        target: strOrNull(g.target, `groups[${i}].target`),
      };
    }),
    chunks: arr(m.chunks, 'chunks').map((v, i) => {
      const c = obj(v, `chunks[${i}]`);
      return {
        node: str(c.node, `chunks[${i}].node`),
        room: strOrNull(c.room, `chunks[${i}].room`),
        day: lightmap(c.day, `chunks[${i}].day`),
        light: c.light === null ? null : lightmap(c.light, `chunks[${i}].light`),
        packs: packs(c.packs, `chunks[${i}].packs`),
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
        opening: num(d.opening, `doors[${i}].opening`),
        ...(d.slide === undefined ? {} : (() => {
          const s = obj(d.slide, `doors[${i}].slide`);
          return { slide: { dir: vec(s.dir, 2, `doors[${i}].slide.dir`) as [number, number], distance: num(s.distance, `doors[${i}].slide.distance`) } };
        })()),
        lightmap: lightmap(d.lightmap, `doors[${i}].lightmap`),
        packs: packs(d.packs, `doors[${i}].packs`),
        ...(d.rooms === undefined ? {} : { rooms: arr(d.rooms, `doors[${i}].rooms`).map((r, k) => str(r, `doors[${i}].rooms[${k}]`)) }),
      };
    }),
    movables: arr(m.movables, 'movables').map((v, i) => {
      const p = `movables[${i}]`;
      const x = obj(v, p);
      const kind = oneOf(x.kind, ['slide', 'hinge', 'spin'] as const, `${p}.kind`);
      const turn = () => ({ pivot: vec(x.pivot, 3, `${p}.pivot`) as [number, number, number], axis: vec(x.axis, 3, `${p}.axis`) as [number, number, number] });
      const motion = kind === 'slide'
        ? { dir: vec(x.dir, 3, `${p}.dir`) as [number, number, number], distance: num(x.distance, `${p}.distance`) }
        : kind === 'hinge' ? { ...turn(), angle: num(x.angle, `${p}.angle`) } : { ...turn(), rpm: num(x.rpm, `${p}.rpm`) };
      return {
        node: str(x.node, `${p}.node`), room: str(x.room, `${p}.room`), kind, ...motion,
        lightmap: lightmap(x.lightmap, `${p}.lightmap`), packs: packs(x.packs, `${p}.packs`),
      };
    }),
    screens: arr(m.screens, 'screens').map((v, i) => {
      const p = `screens[${i}]`;
      const s = obj(v, p);
      return {
        node: str(s.node, `${p}.node`),
        room: str(s.room, `${p}.room`),
        kind: oneOf(s.kind, ['tv', 'monitor', 'laptop'] as const, `${p}.kind`),
        group: strOrNull(s.group, `${p}.group`),
        center: vec(s.center, 3, `${p}.center`) as [number, number, number],
        normal: vec(s.normal, 3, `${p}.normal`) as [number, number, number],
        width: num(s.width, `${p}.width`),
        height: num(s.height, `${p}.height`),
      };
    }),
    glows: arr(m.glows, 'glows').map((v, i) => {
      const g = obj(v, `glows[${i}]`);
      return { node: str(g.node, `glows[${i}].node`), group: str(g.group, `glows[${i}].group`) };
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
    site: (() => {
      const s = obj(m.site, 'site');
      return { lat: num(s.lat, 'site.lat'), lon: num(s.lon, 'site.lon'), timeZone: str(s.timeZone, 'site.timeZone'), yBearing: num(s.yBearing, 'site.yBearing') };
    })(),
    sky: (() => {
      const s = obj(m.sky, 'sky');
      return { irradiance: num(s.irradiance, 'sky.irradiance'), wattsToScene: num(s.wattsToScene, 'sky.wattsToScene') };
    })(),
    windows: arr(m.windows, 'windows').map((v, i) => {
      const w = obj(v, `windows[${i}]`);
      return {
        room: str(w.room, `windows[${i}].room`),
        center: vec(w.center, 3, `windows[${i}].center`) as [number, number, number],
        normal: vec(w.normal, 3, `windows[${i}].normal`) as [number, number, number],
        width: num(w.width, `windows[${i}].width`),
        height: num(w.height, `windows[${i}].height`),
      };
    }),
    props: arr(m.props ?? [], 'props').map((v, i) => {
      const p = `props[${i}]`;
      const x = obj(v, p);
      return {
        node: str(x.node, `${p}.node`),
        name: str(x.name, `${p}.name`),
        room: strOrNull(x.room, `${p}.room`),
        size: vec(x.size, 3, `${p}.size`) as [number, number, number],
        tips: bool(x.tips, `${p}.tips`),
      };
    }),
    probes: arr(m.probes ?? [], 'probes').map((v, i) => {
      const p = `probes[${i}]`;
      const x = obj(v, p);
      const box = arr(x.box, `${p}.box`);
      return {
        room: str(x.room, `${p}.room`),
        at: vec(x.at, 3, `${p}.at`) as [number, number, number],
        box: [vec(box[0], 3, `${p}.box[0]`), vec(box[1], 3, `${p}.box[1]`)] as ProbeInfo['box'],
        day: lightmap(x.day, `${p}.day`),
        dayMean: vec(x.dayMean, 3, `${p}.dayMean`) as [number, number, number],
        light: x.light === null ? null : lightmap(x.light, `${p}.light`),
        lightMean: vec(x.lightMean, 3, `${p}.lightMean`) as [number, number, number],
      };
    }),
    visibility: (() => {
      const v = obj(m.visibility ?? {}, 'visibility');
      const out: Visibility = {};
      for (const [room, seen] of Object.entries(v)) {
        out[room] = {};
        for (const [other, sets] of Object.entries(obj(seen, `visibility.${room}`))) {
          out[room][other] = arr(sets, `visibility.${room}.${other}`).map((d, k) =>
            arr(d, `visibility.${room}.${other}[${k}]`).map((n, j) => num(n, `visibility.${room}.${other}[${k}][${j}]`)));
        }
      }
      return out;
    })(),
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
