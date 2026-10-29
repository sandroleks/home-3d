import { BoxGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { parseClimate } from '../src/climate';
import { CONFIG } from '../src/config';
import {
  ambientFor, casterPositions, Daylight, enteringLight, loadRealLighting, saveRealLighting, envIntensityFor, gainedSkyScale, paneSamples, roomFill, sunColor, sunFade,
} from '../src/daylight';
import { type Manifest, parseManifest, type WindowInfo } from '../src/manifest';
import { cloudCover } from '../src/sky';
import { fromLocal, solarPosition, sunVector } from '../src/sun';
import { Surroundings } from '../src/surroundings';
import type { World } from '../src/world';
import { sampleManifest } from './fixtures';

const pane: WindowInfo = { room: 'sala', center: [0, 1.5, 0], normal: [0, 0, 1], width: 2, height: 1 };

describe('colours', () => {
  it('keeps a high sun white and warms it at the horizon', () => {
    expect(sunColor(45).getHex()).toBe(0xffffff);
    expect(sunColor(0).getHex()).toBe(new Color(CONFIG.sun.warmColor).getHex());
    expect(sunFade(1)).toBe(1);
    expect(sunFade(-1)).toBe(0);
    expect(sunFade(0)).toBeCloseTo(0.5);
  });
});

describe('casterPositions', () => {
  it('keeps triangles whose centre is within the radius, indexed or not', () => {
    const near = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const far = [300, 0, 0, 301, 0, 0, 300, 1, 0];
    expect(Array.from(casterPositions([...near, ...far], null, [0, 0], 200))).toEqual(near);
    const indexed = casterPositions([...near, ...far], [3, 4, 5, 0, 1, 2], [300, 0], 10);
    expect(Array.from(indexed)).toEqual(far);
  });
});

describe('windows', () => {
  it('samples the centre and four inner points on the pane', () => {
    const s = paneSamples(pane);
    expect(s).toHaveLength(5);
    expect(s[0]).toEqual([0, 1.5, 0]);
    for (const p of s) expect(p[2]).toBe(0);
    expect(Math.max(...s.map((p) => Math.abs(p[0])))).toBeCloseTo(0.7);
    expect(Math.max(...s.map((p) => Math.abs(p[1] - 1.5)))).toBeCloseTo(0.35);
  });

  it('counts light entering by area, angle, visibility and strength', () => {
    expect(enteringLight(pane, [0, 0, 1], 1, 4)).toBeCloseTo(8);
    expect(enteringLight(pane, [0, Math.SQRT1_2, Math.SQRT1_2], 0.6, 4)).toBeCloseTo(2 * Math.SQRT1_2 * 0.6 * 4);
    expect(enteringLight(pane, [0, 0, -1], 1, 4)).toBe(0);
  });

  it('spreads it over the floor', () => {
    expect(roomFill(8, 20, 0.2)).toBeCloseTo(0.08);
    expect(roomFill(8, 0, 0.2)).toBe(0);
  });
});

describe('sky calibration', () => {
  it('applies the sky gain', () => {
    expect(gainedSkyScale(2)).toBeCloseTo(2 * CONFIG.sun.skyGain);
    expect(gainedSkyScale(0)).toBe(0);
  });

  it('scales the environment with the gained sky and caps it', () => {
    expect(envIntensityFor(0)).toBe(0);
    expect(envIntensityFor(0.5)).toBeCloseTo(CONFIG.envIntensity * 0.5);
    expect(envIntensityFor(10)).toBeCloseTo(CONFIG.envIntensity * 1.5);
  });
});

// Daylight itself, without WebGL: only the renderer is stubbed. Shadows are not drawn here, so the
// shadow map's contents (and the real GPU path) are covered by looking at the page, not by these tests.
const TZ = 'Europe/Lisbon';
const SUMMER_EVENING = fromLocal({ year: 2026, month: 6, day: 21, hour: 18, minute: 0 }, TZ);
const NIGHT = fromLocal({ year: 2026, month: 1, day: 1, hour: 2, minute: 0 }, TZ);

/** Constant light all day: 100 W/m² beam, 50 diffuse, so any sun above the horizon has something to deliver. */
const climate = () => parseClimate({
  months: Array.from({ length: 12 }, (_, m) => ({
    month: m + 1, sunshineHours: 5, cloudCover: 40,
    hours: Array.from({ length: 24 }, (_, h) => ({ utcHour: h + 0.5, gb: 100, gd: 50, gcs: 200 })),
  })),
});

function setup(blockSun: boolean) {
  const manifest = parseManifest(sampleManifest());
  const dir = sunVector(solarPosition(SUMMER_EVENING, manifest.site.lat, manifest.site.lon), manifest.site.yBearing);
  const horizontal = Math.hypot(dir[0], dir[2]);
  // A pane facing the sun's compass direction, at the origin.
  const window = { room: 'alpha', center: [0, 1.5, 0], normal: [dir[0] / horizontal, 0, dir[2] / horizontal], width: 1, height: 1 };
  const m: Manifest = { ...manifest, windows: [window as Manifest['windows'][0]] };

  const root = new Group();
  root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  const occluders: Mesh[] = [];
  if (blockSun) {
    const plate = new Mesh(new PlaneGeometry(20, 20), new MeshBasicMaterial({ side: DoubleSide }));
    plate.position.set(dir[0] * 2, 1.5 + dir[1] * 2, dir[2] * 2);
    plate.lookAt(0, 1.5, 0);
    plate.updateMatrixWorld(true);
    occluders.push(plate);
  }
  const fills = new Map(m.rooms.map((r) => [r.id, { value: new Color(0, 0, 0) }] as const));
  const world = { root, sky: { value: 1 }, fills, occluders } as unknown as World;
  const renderer = { shadowMap: {} } as unknown as WebGLRenderer;
  const scene = new Scene();
  const surroundings = new Surroundings();
  const daylight = new Daylight(renderer, scene, world, m, climate(), surroundings);
  const internals = daylight as unknown as { casters: Group; occluders: Mesh[] };
  return { daylight, renderer, world, fills, scene, internals, surroundings, dir };
}

const drawn = (r: WebGLRenderer) => (r.shadowMap as { needsUpdate?: boolean }).needsUpdate === true;
const reset = (r: WebGLRenderer) => { (r.shadowMap as { needsUpdate?: boolean }).needsUpdate = false; };

describe('Daylight.update', () => {
  it('applies on the first call and then only when the version, the casters or a door change', () => {
    const { daylight, renderer, world } = setup(false);
    daylight.update(SUMMER_EVENING, 1, false);
    expect(drawn(renderer)).toBe(true);
    expect(daylight.light.intensity).toBeGreaterThan(0);
    expect(world.sky.value).toBeGreaterThan(0);

    reset(renderer);
    world.sky.value = -1; // a sentinel: an apply would overwrite it
    daylight.update(SUMMER_EVENING, 1, false);
    expect(drawn(renderer)).toBe(false);
    expect(world.sky.value).toBe(-1);

    daylight.update(SUMMER_EVENING, 1, true); // a door moved: redraw shadows, nothing else
    expect(drawn(renderer)).toBe(true);
    expect(world.sky.value).toBe(-1);

    reset(renderer);
    daylight.addCasters(new Group());
    daylight.update(SUMMER_EVENING, 1, false);
    expect(world.sky.value).toBeGreaterThan(0);
    expect(drawn(renderer)).toBe(true);

    reset(renderer);
    daylight.update(SUMMER_EVENING + 10 * 60000, 2, false);
    expect(drawn(renderer)).toBe(true);
  });

  it('redraws the shadows during a time-lapse only once the sun has moved shadowStep degrees', () => {
    const { daylight, renderer, world } = setup(false);
    daylight.update(SUMMER_EVENING, 1, false);
    reset(renderer);
    world.sky.value = -1;
    daylight.update(SUMMER_EVENING + 20000, 2, false); // 20 s of sun: about 0.08 degrees
    expect(drawn(renderer)).toBe(false);
    expect(world.sky.value).toBeGreaterThan(0); // the light itself still follows the clock
    daylight.update(SUMMER_EVENING + 3 * 60000, 3, false); // 3 min: about 0.75 degrees
    expect(drawn(renderer)).toBe(true);
  });

  it('redraws the shadows at sunrise even if the sun is back where it was (doors may have moved)', () => {
    const { daylight, renderer } = setup(false);
    daylight.update(SUMMER_EVENING, 1, false);
    daylight.update(NIGHT, 2, false);
    reset(renderer);
    daylight.update(SUMMER_EVENING, 3, false);
    expect(drawn(renderer)).toBe(true);
  });

  it('takes the sun out of the lights while it is down', () => {
    const { daylight } = setup(false);
    daylight.update(SUMMER_EVENING, 1, false);
    expect(daylight.light.visible).toBe(true);
    daylight.update(NIGHT, 2, false);
    expect(daylight.light.visible).toBe(false);
  });

  it('does not redraw the shadow map while the sun is down', () => {
    const { daylight, renderer } = setup(false);
    daylight.update(NIGHT, 1, false);
    expect(daylight.light.intensity).toBe(0);
    expect(drawn(renderer)).toBe(false);
    daylight.update(NIGHT, 1, true);
    expect(drawn(renderer)).toBe(false);
    daylight.update(SUMMER_EVENING, 2, false); // the first apply with light draws again
    expect(drawn(renderer)).toBe(true);
  });
});

describe('Daylight.apply', () => {
  it('goes dark at night: no sun, no sky, no fill', () => {
    const { daylight, world, fills, scene } = setup(false);
    daylight.update(NIGHT, 1, false);
    expect(daylight.light.intensity).toBe(0);
    expect(world.sky.value).toBe(0);
    expect(scene.environmentIntensity).toBe(0);
    for (const f of fills.values()) expect(f.value.toArray()).toEqual([0, 0, 0]);
  });

  it('keeps the night ambient after dark and the day ambient in daylight', () => {
    const { daylight } = setup(false);
    daylight.update(NIGHT, 1, false);
    expect(daylight.ambient.intensity).toBeCloseTo(CONFIG.sun.ambient.night);
    daylight.update(SUMMER_EVENING, 2, false);
    expect(daylight.ambient.intensity).toBeGreaterThan(CONFIG.sun.ambient.night);
  });

  it('fills a room whose window faces the sun', () => {
    const { daylight, fills } = setup(false);
    daylight.update(SUMMER_EVENING, 1, false);
    const f = fills.get('alpha')!.value;
    expect(f.r + f.g + f.b).toBeGreaterThan(0);
    expect(fills.get('beta')!.value.r).toBe(0);
  });

  it('gives no fill when something stands between the pane and the sun', () => {
    const { daylight, fills } = setup(true);
    daylight.update(SUMMER_EVENING, 1, false);
    expect(daylight.light.intensity).toBeGreaterThan(0);
    expect(fills.get('alpha')!.value.toArray()).toEqual([0, 0, 0]);
  });
});

describe('Daylight sky', () => {
  it('puts the sun where the sun light comes from, with the month\'s clouds, and hides it at night', () => {
    const { daylight, surroundings, dir } = setup(false);
    const u = surroundings.sky.uniforms;
    daylight.update(SUMMER_EVENING, 1, false);
    expect(u.sunDir.value.toArray().map((v) => +v.toFixed(6))).toEqual(dir.map((v) => +v.toFixed(6)));
    expect(u.sunVisible.value).toBe(1);
    expect(u.cover.value).toBeCloseTo(cloudCover(40));
    expect(u.sunColor.value.getHex()).toBe(daylight.light.color.getHex());
    daylight.update(NIGHT, 2, false);
    expect(u.sunVisible.value).toBe(0);
  });

  it('shows a fixed sun and cloud cover with real lighting off', () => {
    const { daylight, surroundings } = setup(false);
    daylight.setReal(false);
    daylight.update(NIGHT, 1, false);
    const u = surroundings.sky.uniforms;
    expect(u.sunVisible.value).toBe(1);
    expect(u.cover.value).toBe(CONFIG.sky.flatCloudCover);
    expect(u.sunDir.value.y).toBeCloseTo(Math.sin((CONFIG.flatLighting.outsideSun.elevation * Math.PI) / 180));
  });
});

describe('real lighting off', () => {
  it('lights every moment the same: no sun, the flat sky and ambient, no fill', () => {
    const { daylight, world, fills, renderer } = setup(false);
    daylight.update(SUMMER_EVENING, 1, false);
    reset(renderer);
    daylight.setReal(false);
    daylight.update(SUMMER_EVENING, 1, false); // same moment: the switch alone re-applies
    expect(daylight.light.intensity).toBe(0);
    expect(drawn(renderer)).toBe(false);
    expect(world.sky.value).toBe(CONFIG.flatLighting.sky);
    expect(daylight.ambient.intensity).toBe(CONFIG.flatLighting.ambient);
    for (const f of fills.values()) expect(f.value.toArray()).toEqual([0, 0, 0]);
    daylight.update(NIGHT, 2, false);
    expect(world.sky.value).toBe(CONFIG.flatLighting.sky);
    daylight.setReal(true);
    daylight.update(NIGHT, 2, false);
    expect(world.sky.value).toBe(0);
  });

  it('remembers the choice, defaulting to on', () => {
    const store = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(loadRealLighting(storage)).toBe(true);
    saveRealLighting(storage, false);
    expect(loadRealLighting(storage)).toBe(false);
    const blocked = () => { throw new Error('blocked'); };
    expect(loadRealLighting(blocked)).toBe(true);
    expect(() => saveRealLighting(blocked, false)).not.toThrow();
  });
});

describe('ambientFor', () => {
  it('runs from the night floor below civil twilight to the day level above 10 degrees', () => {
    expect(ambientFor(-20)).toBe(CONFIG.sun.ambient.night);
    expect(ambientFor(-6)).toBe(CONFIG.sun.ambient.night);
    expect(ambientFor(10)).toBeCloseTo(CONFIG.sun.ambient.day);
    expect(ambientFor(40)).toBeCloseTo(CONFIG.sun.ambient.day);
    expect(ambientFor(2)).toBeGreaterThan(CONFIG.sun.ambient.night);
    expect(ambientFor(2)).toBeLessThan(CONFIG.sun.ambient.day);
  });
});

describe('Daylight.addCasters', () => {
  const box = (x: number, h: number, w = 10) => {
    const m = new Mesh(new BoxGeometry(w, h, w), new MeshBasicMaterial());
    m.position.set(x, h / 2, 0);
    return m;
  };

  it('skips ground layers and meshes beyond the shadow reach, and adds near buildings', () => {
    const { daylight, internals } = setup(false);
    const before = internals.occluders.length;
    const root = new Group();
    root.add(box(20, 0.001, 100)); // flat ground, thinner than surroundingsFlatHeight
    root.add(box(CONFIG.sun.shadowReach + 500, 10)); // too far to matter
    root.add(box(20, 10)); // a neighbour
    daylight.addCasters(root);
    expect(internals.casters.children).toHaveLength(1);
    expect(internals.occluders).toHaveLength(before + 1);
    expect((internals.casters.children[0] as Mesh).castShadow).toBe(true);
  });
});

describe('Daylight.isNight', () => {
  it('is true only when the sun is more than 6 degrees down', () => {
    const { daylight } = setup(false);
    expect(daylight.isNight(NIGHT)).toBe(true);
    expect(daylight.isNight(SUMMER_EVENING)).toBe(false);
    expect(daylight.isNight(fromLocal({ year: 2026, month: 6, day: 21, hour: 21, minute: 30 }, TZ))).toBe(false); // sun still near the horizon
  });
});
