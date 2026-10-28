import { Color } from 'three';
import { CONFIG } from './config';
import type { LightGroups } from './lightmaps';

/** A light's colour as the bridge takes it: hue 0–65535 round the colour wheel (0 red, 21845 green, 43690 blue) and
 * saturation 0–254. */
export type HueColour = readonly [hue: number, sat: number];

/** A Hue scene as the bridge takes it: brightness `bri` 1–254 (0 switches off) and colour temperature `ct` in mireds
 * (1,000,000 / kelvin; 0 leaves the colour as it is), or for a colour scene `colours`, one per light in turn. */
export interface HueScene { id: string; name: string; bri: number; ct: number; colours?: readonly HueColour[] }

/** Hue's own white-light scenes, with the values the Hue app gives them, then its colour scenes, and off. */
export const HUE_SCENES: readonly HueScene[] = [
  { id: 'bright', name: 'Bright', bri: 254, ct: 366 },
  { id: 'read', name: 'Read', bri: 254, ct: 346 },
  { id: 'concentrate', name: 'Concentrate', bri: 254, ct: 233 },
  { id: 'energize', name: 'Energize', bri: 254, ct: 156 },
  { id: 'relax', name: 'Relax', bri: 144, ct: 447 },
  { id: 'dimmed', name: 'Dimmed', bri: 77, ct: 366 },
  { id: 'nightlight', name: 'Nightlight', bri: 10, ct: 500 },
  { id: 'savanna-sunset', name: 'Savanna sunset', bri: 200, ct: 0, colours: [[4400, 254], [1200, 254], [7800, 240], [63800, 230]] },
  { id: 'tropical-twilight', name: 'Tropical twilight', bri: 160, ct: 0, colours: [[48500, 254], [57800, 240], [44000, 254], [4500, 170]] },
  { id: 'arctic-aurora', name: 'Arctic aurora', bri: 180, ct: 0, colours: [[31500, 254], [24500, 254], [39000, 254], [47000, 220]] },
  { id: 'spring-blossom', name: 'Spring blossom', bri: 220, ct: 0, colours: [[60500, 190], [54000, 150], [17500, 170], [7300, 110]] },
  { id: 'galaxy', name: 'Galaxy', bri: 120, ct: 0, colours: [[45000, 254], [50500, 254], [57000, 240], [40500, 230]] },
  { id: 'off', name: 'Off', bri: 0, ct: 0 },
];

/** The colour a scene gives the `i`th light it sets, or null for a white scene. */
export function colourAt(scene: HueScene, i: number): HueColour | null {
  return scene.colours?.length ? scene.colours[i % scene.colours.length] : null;
}

/** A colour in one number, for the shared state: hue × 256 + saturation. */
export function packColour([hue, sat]: HueColour): number {
  return Math.round(hue) * 256 + Math.round(sat);
}

export function unpackColour(v: number): HueColour {
  return [Math.floor(v / 256), v % 256];
}

export function sceneById(id: string): HueScene | undefined {
  return HUE_SCENES.find((s) => s.id === id);
}

/** The scene after `id` in the list (H steps through them), wrapping round. */
export function nextScene(id: string | null): HueScene {
  const i = HUE_SCENES.findIndex((s) => s.id === id);
  return HUE_SCENES[(i + 1) % HUE_SCENES.length];
}

/** A light's level in the walkthrough for a Hue brightness: 254 is the lamp as baked. */
export function levelFor(bri: number): number {
  return Math.min(1, Math.max(0, bri / 254));
}

/** The colour of a black body at `kelvin`, 0..1 per channel (Tanner Helland's fit to the CIE data). */
export function blackBody(kelvin: number): Color {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new Color(c(r), c(g), c(b));
}

/** A Hue colour at full brightness, 0..1 per channel (hue and saturation as HSV). */
export function hueColour([hue, sat]: HueColour): Color {
  const h = ((hue / 65536) % 1) * 6;
  const s = Math.min(1, Math.max(0, sat / 254));
  const f = (n: number) => {
    const k = (n + h) % 6;
    return 1 - s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return new Color(f(5), f(3), f(1));
}

const luma = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** What to multiply baked lamp light by to show it at `mireds`: the ratio of the two white points, at the same
 * brightness. White (no change) for 0, or at the colour the lamps were baked at. */
export function toneFor(mireds: number, bakedKelvin = CONFIG.hue.bakedKelvin): Color {
  if (mireds <= 0) return new Color(1, 1, 1);
  const want = blackBody(1e6 / mireds);
  const baked = blackBody(bakedKelvin);
  const ratio = new Color(want.r / baked.r, want.g / baked.g, want.b / baked.b);
  return ratio.multiplyScalar(1 / luma(ratio));
}

/** What to multiply baked lamp light by to show it in a Hue colour: like toneFor, the same brightness as the bake, but
 * no channel more than `gain` times the bake's, so deep colours stay deep instead of washing out to white in the tone
 * mapping (and dim, as a Hue bulb's deep blues and reds are). */
export function tintFor(colour: HueColour, bakedKelvin = CONFIG.hue.bakedKelvin, gain = CONFIG.hue.colourGain): Color {
  const want = hueColour(colour);
  const baked = blackBody(bakedKelvin);
  const ratio = new Color(want.r / baked.r, want.g / baked.g, want.b / baked.b);
  const peak = Math.max(ratio.r, ratio.g, ratio.b);
  return ratio.multiplyScalar(Math.min(1 / Math.max(1e-3, luma(ratio)), gain / peak));
}

/** The light groups a scene in `room` sets: the room's switch and its lamps, but not the bias lights of screens. */
export function groupsIn(groups: readonly { id: string; room: string }[], room: string, skip: ReadonlySet<string>): string[] {
  return groups.filter((g) => g.room === room && !skip.has(g.id)).map((g) => g.id);
}

/** The scene these light groups all show right now, if any: what the sun panel shows as chosen. */
export function activeScene(lights: Pick<LightGroups, 'isOn' | 'brightness' | 'mireds' | 'colour'>, ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  const sameColour = (a: HueColour | null, b: HueColour | null) => (a && b ? a[0] === b[0] && a[1] === b[1] : a === b);
  const shows = (s: HueScene, id: string, i: number) => (s.bri === 0
    ? !lights.isOn(id)
    : lights.isOn(id) && Math.abs(lights.brightness(id) - levelFor(s.bri)) < 1e-3 && lights.mireds(id) === s.ct
      && sameColour(lights.colour(id), colourAt(s, i)));
  return HUE_SCENES.find((s) => ids.every((id, i) => shows(s, id, i)))?.id ?? null;
}

/** Where scenes go besides the walkthrough: the flat's real Hue bridge, once it is linked (CONFIG.hue). */
export interface HueLink {
  /** `rooms` are walkthrough room ids; CONFIG.hue.rooms maps them to the bridge's rooms. */
  applyScene(rooms: string[], scene: HueScene): void;
}

/** Until the bridge is linked, scenes only change the walkthrough. */
export const NO_HUE_LINK: HueLink = { applyScene() {} };
