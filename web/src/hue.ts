import { Color } from 'three';
import { CONFIG } from './config';
import type { LightGroups } from './lightmaps';

/** A Hue scene as the bridge takes it: brightness `bri` 1–254 (0 switches off) and colour temperature `ct` in mireds
 * (1,000,000 / kelvin; 0 leaves the colour as it is). */
export interface HueScene { id: string; name: string; bri: number; ct: number }

/** Hue's own white-light scenes, with the values the Hue app gives them, and off. */
export const HUE_SCENES: readonly HueScene[] = [
  { id: 'bright', name: 'Bright', bri: 254, ct: 366 },
  { id: 'read', name: 'Read', bri: 254, ct: 346 },
  { id: 'concentrate', name: 'Concentrate', bri: 254, ct: 233 },
  { id: 'energize', name: 'Energize', bri: 254, ct: 156 },
  { id: 'relax', name: 'Relax', bri: 144, ct: 447 },
  { id: 'dimmed', name: 'Dimmed', bri: 77, ct: 366 },
  { id: 'nightlight', name: 'Nightlight', bri: 10, ct: 500 },
  { id: 'off', name: 'Off', bri: 0, ct: 0 },
];

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

/** The light groups a scene in `room` sets: the room's switch and its lamps, but not the bias lights of screens. */
export function groupsIn(groups: readonly { id: string; room: string }[], room: string, skip: ReadonlySet<string>): string[] {
  return groups.filter((g) => g.room === room && !skip.has(g.id)).map((g) => g.id);
}

/** The scene these light groups all show right now, if any: what the sun panel marks as chosen. */
export function activeScene(lights: Pick<LightGroups, 'isOn' | 'brightness' | 'mireds'>, ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  const shows = (s: HueScene, id: string) => (s.bri === 0
    ? !lights.isOn(id)
    : lights.isOn(id) && Math.abs(lights.brightness(id) - levelFor(s.bri)) < 1e-3 && lights.mireds(id) === s.ct);
  return HUE_SCENES.find((s) => ids.every((id) => shows(s, id)))?.id ?? null;
}

/** Where scenes go besides the walkthrough: the flat's real Hue bridge, once it is linked (CONFIG.hue). */
export interface HueLink {
  /** `rooms` are walkthrough room ids; CONFIG.hue.rooms maps them to the bridge's rooms. */
  applyScene(rooms: string[], scene: HueScene): void;
}

/** Until the bridge is linked, scenes only change the walkthrough. */
export const NO_HUE_LINK: HueLink = { applyScene() {} };
