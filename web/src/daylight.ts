import {
  AmbientLight, Box3, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, Object3D,
  PCFSoftShadowMap, Raycaster, type Scene, Sphere, Vector3, type WebGLRenderer,
} from 'three';
import type { KeyValueStore } from './audio';
import { type Climate, skyDiffuse, skyScale, sunStrength, typicalIrradiance } from './climate';
import { CONFIG } from './config';
import type { Manifest, WindowInfo } from './manifest';
import { cloudCover } from './sky';
import { solarPosition, sunVector } from './sun';
import type { Surroundings } from './surroundings';
import type { World } from './world';

type Vec3 = [number, number, number];

const WHITE = new Color(1, 1, 1);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** White above 30 degrees, warming toward CONFIG.sun.warmColor at the horizon. */
export function sunColor(elevation: number): Color {
  const t = clamp01((30 - elevation) / 30);
  return WHITE.clone().lerp(new Color(CONFIG.sun.warmColor), t * t);
}

/** The sun's light fades in and out as its disc crosses the horizon. */
export function sunFade(elevation: number): number {
  const t = clamp01((elevation + 0.5) / 1);
  return t * t * (3 - 2 * t);
}

/** Triangles (as flat xyz positions) whose centre lies within `radius` of `centre` on the ground plane. */
export function casterPositions(
  position: ArrayLike<number>, index: ArrayLike<number> | null, centre: [number, number], radius: number,
): Float32Array {
  const count = index ? index.length : position.length / 3;
  const out: number[] = [];
  for (let t = 0; t + 2 < count; t += 3) {
    const v = [0, 1, 2].map((k) => (index ? index[t + k] : t + k));
    const cx = (position[v[0] * 3] + position[v[1] * 3] + position[v[2] * 3]) / 3;
    const cz = (position[v[0] * 3 + 2] + position[v[1] * 3 + 2] + position[v[2] * 3 + 2]) / 3;
    if (Math.hypot(cx - centre[0], cz - centre[1]) > radius) continue;
    for (const i of v) out.push(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
  }
  return new Float32Array(out);
}

/** The pane's centre and four points 35% of the way to its edges. */
export function paneSamples(w: WindowInfo): Vec3[] {
  const [nx, , nz] = w.normal;
  const right: Vec3 = [-nz, 0, nx];
  const du = w.width * 0.35;
  const dv = w.height * 0.35;
  const at = (u: number, v: number): Vec3 => [w.center[0] + right[0] * u, w.center[1] + v, w.center[2] + right[2] * u];
  return [at(0, 0), at(-du, -dv), at(du, -dv), at(-du, dv), at(du, dv)];
}

/** Sunlight through a pane, in scene power units: area x cosine x share not blocked x direct-normal strength. */
export function enteringLight(w: WindowInfo, dir: Vec3, visible: number, strength: number): number {
  const cos = w.normal[0] * dir[0] + w.normal[1] * dir[1] + w.normal[2] * dir[2];
  return cos > 0 ? w.width * w.height * cos * visible * strength : 0;
}

/** The baked sky layer's brightness: the physical scale times the viewer-to-Cycles gain. */
export function gainedSkyScale(scale: number, gain = CONFIG.sun.skyGain): number {
  return scale * gain;
}

const REAL_KEY = 'walkthrough.realLighting';

/** Real lighting is on unless the visitor turned it off. */
export function loadRealLighting(storage: () => KeyValueStore): boolean {
  try {
    return storage().getItem(REAL_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveRealLighting(storage: () => KeyValueStore, on: boolean): void {
  try {
    storage().setItem(REAL_KEY, on ? '1' : '0');
  } catch {
    // Storage is blocked: the choice just isn't remembered.
  }
}

/** Even light everywhere, so corners and windowless rooms keep some light: the day level fading to the night floor over civil twilight. */
export function ambientFor(elevation: number): number {
  const { day, night } = CONFIG.sun.ambient;
  const t = clamp01((elevation + 6) / 16);
  return night + (day - night) * t * t * (3 - 2 * t);
}

/** Room-environment reflections follow the (gained) sky, capped so a bright sky adds no more. */
export function envIntensityFor(gainedScale: number): number {
  return CONFIG.envIntensity * Math.min(gainedScale, 1.5);
}

/** Flat irradiance that the sunlight entering a room adds to all its surfaces. */
export function roomFill(entering: number, area: number, bounce = CONFIG.sun.bounce): number {
  return area > 0 ? (bounce * entering) / area : 0;
}

/**
 * Everything that changes with the date and time: the sun lamp and its shadows, the baked sky's brightness,
 * the bounce fill per room, the colour behind the neighbourhood and the neighbourhood's own lighting.
 */
export class Daylight {
  readonly light = new DirectionalLight();
  readonly ambient = new AmbientLight(CONFIG.sun.ambient.color, 0);
  private real = true;
  private centre = new Vector3();
  private radius: number;
  private distance: number;
  private casters = new Object3D();
  private occluders: Mesh[];
  private raycaster = new Raycaster();
  private seen = -1;
  private dirty = true;

  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    private world: World,
    private manifest: Manifest,
    private climate: Climate,
    private surroundings: Surroundings,
  ) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // redrawn only when the sun or a door moves
    const sphere = new Box3().setFromObject(world.root).getBoundingSphere(new Sphere());
    this.centre.copy(sphere.center);
    this.radius = sphere.radius + 1;
    this.distance = CONFIG.sun.shadowReach + this.radius;
    const l = this.light;
    l.castShadow = true;
    l.shadow.mapSize.set(CONFIG.sun.shadowMapSize, CONFIG.sun.shadowMapSize);
    l.shadow.bias = CONFIG.sun.shadowBias;
    l.shadow.normalBias = CONFIG.sun.shadowNormalBias;
    const cam = l.shadow.camera;
    cam.left = -this.radius;
    cam.right = this.radius;
    cam.top = this.radius;
    cam.bottom = -this.radius;
    cam.near = 0.1;
    cam.far = this.distance + this.radius; // the camera sits `distance` toward the sun, so far casters fit
    cam.updateProjectionMatrix();
    l.target.position.copy(this.centre);
    scene.add(l, l.target, this.ambient, this.casters);
    this.occluders = [...world.occluders];
    (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  }

  /** Shadow-only copies of the neighbourhood within reach: drawn into the shadow map, invisible otherwise. */
  addCasters(root: Object3D): void {
    root.updateMatrixWorld(true);
    const material = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: DoubleSide });
    const size = new Vector3();
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      new Box3().setFromObject(m).getSize(size);
      if (size.y < CONFIG.surroundingsFlatHeight) return; // ground layers cast nothing
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const pos = casterPositions(g.attributes.position.array, g.index?.array ?? null, [this.centre.x, this.centre.z], CONFIG.sun.shadowReach);
      g.dispose();
      if (pos.length === 0) return;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
      geo.computeBoundsTree?.();
      const proxy = new Mesh(geo, material);
      proxy.castShadow = true;
      this.casters.add(proxy);
      this.occluders.push(proxy);
    });
    this.dirty = true;
  }

  /** Real sun and sky for the chosen moment, or (off) the same even daylight at any time. */
  setReal(on: boolean): void {
    if (on === this.real) return;
    this.real = on;
    this.dirty = true;
  }

  isNight(utc: number): boolean {
    const { lat, lon } = this.manifest.site;
    return solarPosition(utc, lat, lon).elevation < -6;
  }

  /** Call every frame; work happens only when the moment changed, the casters arrived or a door moved. */
  update(utc: number, version: number, doorsMoved: boolean): void {
    if (version !== this.seen || this.dirty) {
      this.seen = version;
      this.dirty = false;
      this.apply(utc);
      if (this.light.intensity > 0) this.renderer.shadowMap.needsUpdate = true; // nothing to draw while the sun is down
    } else if (doorsMoved && this.light.intensity > 0) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  private apply(utc: number): void {
    if (!this.real) return this.applyFlat();
    const { site, sky } = this.manifest;
    const sun = solarPosition(utc, site.lat, site.lon);
    const { beam, diffuse } = typicalIrradiance(this.climate, utc);
    const strength = sunStrength(beam, sun.elevation) * sky.wattsToScene * sunFade(sun.elevation);
    const dir = sunVector(sun, site.yBearing);
    const color = sunColor(sun.elevation);

    const l = this.light;
    l.color.copy(color);
    l.intensity = strength;
    l.position.set(this.centre.x + dir[0] * this.distance, this.centre.y + dir[1] * this.distance, this.centre.z + dir[2] * this.distance);

    const d = skyDiffuse(this.climate, utc, sun.elevation, diffuse);
    const scale = gainedSkyScale(skyScale(d, sky.wattsToScene, sky.irradiance));
    this.world.sky.value = scale;
    this.scene.environmentIntensity = envIntensityFor(scale);
    this.ambient.intensity = ambientFor(sun.elevation);

    const month = this.climate.months[new Date(utc).getUTCMonth()];
    this.surroundings.setSky({ dir, elevation: sun.elevation, cover: cloudCover(month.cloudCover), sunColor: color, sunVisible: sunFade(sun.elevation) });
    const s = this.surroundings.light;
    s.sunDir.value.set(dir[0], dir[1], dir[2]);
    s.sunLight.value.copy(color).multiplyScalar(strength);
    s.skyLight.value = d * sky.wattsToScene;

    this.updateFills(dir, strength, color);
  }

  /** No sun indoors, a bright sky through the windows and a stronger ambient; outside, a fixed sunny midday. */
  private applyFlat(): void {
    const f = CONFIG.flatLighting;
    const { site, sky } = this.manifest;
    this.light.intensity = 0;
    this.world.sky.value = f.sky;
    this.scene.environmentIntensity = envIntensityFor(f.sky);
    this.ambient.intensity = f.ambient;
    const dir = sunVector({ elevation: f.outsideSun.elevation, azimuth: f.outsideSun.azimuth }, site.yBearing);
    this.surroundings.setSky({ dir, elevation: f.outsideSun.elevation, cover: CONFIG.sky.flatCloudCover, sunColor: WHITE, sunVisible: 1 });
    const s = this.surroundings.light;
    s.sunDir.value.set(dir[0], dir[1], dir[2]);
    s.sunLight.value.copy(WHITE).multiplyScalar(f.outsideSun.watts * sky.wattsToScene);
    s.skyLight.value = f.outsideSky * sky.wattsToScene;
    for (const fill of this.world.fills.values()) fill.value.setRGB(0, 0, 0);
  }

  private updateFills(dir: Vec3, strength: number, color: Color): void {
    const entering = new Map<string, number>();
    if (strength > 0) {
      const toSun = new Vector3(dir[0], dir[1], dir[2]);
      const origin = new Vector3();
      this.raycaster.far = this.distance;
      for (const w of this.manifest.windows) {
        if (enteringLight(w, dir, 1, 1) === 0) continue;
        const samples = paneSamples(w);
        let open = 0;
        for (const p of samples) {
          origin.set(p[0] + w.normal[0] * 0.05, p[1], p[2] + w.normal[2] * 0.05);
          this.raycaster.set(origin, toSun);
          if (this.raycaster.intersectObjects(this.occluders, false).length === 0) open++;
        }
        entering.set(w.room, (entering.get(w.room) ?? 0) + enteringLight(w, dir, open / samples.length, strength));
      }
    }
    for (const room of this.manifest.rooms) {
      const fill = this.world.fills.get(room.id);
      if (fill) fill.value.copy(color).multiplyScalar(roomFill(entering.get(room.id) ?? 0, room.area));
    }
  }
}
