import { Box3, Color, Vector3 } from 'three';
import { CONFIG } from './config';
import type { LightGroups } from './lightmaps';
import type { Glow } from './world';

/** A Nanoleaf panel's lit face: its glow, and where it sits on the wall (m: along it, and up). */
interface Panel { glow: Glow; along: number; up: number }

const PANEL_MATERIAL = /^Nanoleaf panel \d+/;

/** The colour of the panel at (`along`, `up`) on the wall at time `t` (s): a gradient between CONFIG.nanoleaf.hues
 * that drifts across the panels. */
export function panelColor(t: number, along: number, up: number, out = new Color()): Color {
  const { hues, speed, spread, saturation, lightness } = CONFIG.nanoleaf;
  const w = 0.5 + 0.5 * Math.sin(t * speed + (along + 0.6 * up) * spread);
  return out.setHSL(hues[0] + (hues[1] - hues[0]) * w, saturation, lightness);
}

/**
 * The office's Nanoleaf panels (blender/tools/nanoleaf.py): each lit face its own colour, moving through a gradient,
 * and the light they cast on the wall and the desk (baked white) tinted with their average colour, its strongest
 * channel at full (coloured LEDs give less light than white). Brightness and on/off stay with their lamp group, so a
 * click or a Hue scene still switches and dims them. They get no halo: nine overlapping ones wash the colours out.
 */
export class Nanoleaf {
  readonly panels: Panel[];
  readonly group: string | null;
  private colour = new Color();
  private sum = new Color();

  constructor(glows: Glow[]) {
    const mine = glows.filter((g) => PANEL_MATERIAL.test(g.material.name));
    const box = new Box3();
    const centres = mine.map((g) => {
      g.mesh.updateWorldMatrix(true, false);
      return box.setFromObject(g.mesh).getCenter(new Vector3());
    });
    // Along the wall: the horizontal axis the panels spread over most.
    const spread = (k: 'x' | 'z') => Math.max(...centres.map((c) => c[k])) - Math.min(...centres.map((c) => c[k]));
    const axis = centres.length && spread('x') > spread('z') ? 'x' : 'z';
    this.panels = mine.map((glow, i) => ({ glow, along: centres[i][axis], up: centres[i].y }));
    this.group = mine[0]?.group ?? null;
  }

  /** Whether a glow is one of the panels. */
  has(glow: Glow): boolean {
    return this.panels.some((p) => p.glow === glow);
  }

  update(t: number, lights: LightGroups): void {
    if (!this.group || !lights.has(this.group)) return;
    this.sum.setRGB(0, 0, 0);
    for (const p of this.panels) {
      panelColor(t, p.along, p.up, this.colour);
      p.glow.material.emissive.copy(this.colour).multiplyScalar(CONFIG.nanoleaf.glow);
      this.sum.add(this.colour);
    }
    const peak = Math.max(this.sum.r, this.sum.g, this.sum.b);
    if (peak > 0) lights.color(this.group).value.copy(this.sum).multiplyScalar(1 / peak);
  }
}
