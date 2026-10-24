import {
  AdditiveBlending, Box3, type Camera, Color, DataTexture, Group, LinearFilter, Sprite, SpriteMaterial, Vector3,
} from 'three';
import { CONFIG } from './config';
import type { LightGroups } from './lightmaps';
import type { Glow } from './world';

/** A soft round falloff, brightest in the middle and zero at the edge. */
export function haloTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.min(1, Math.hypot(dx, dy));
      const v = Math.exp(-5 * r * r) * (1 - r * r);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * v);
    }
  }
  const t = new DataTexture(data, size, size);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

interface Halo { sprite: Sprite; group: string; centre: Vector3; color: Color; pull: number }

/**
 * A glow around each small glowing fixture (bulbs, lampshades, ceiling diffusers), instead of a screen-wide bloom
 * pass: camera-facing sprites, added on top, hidden by whatever stands in front of them, fading with their lamp.
 * Long or large glowing surfaces (LED strips, screens) get none.
 */
export class Halos {
  readonly root = new Group();
  private halos: Halo[] = [];
  private toCamera = new Vector3();

  constructor(glows: Glow[]) {
    this.root.name = 'Halos';
    const map = haloTexture();
    const box = new Box3();
    const size = new Vector3();
    for (const g of glows) {
      g.mesh.updateWorldMatrix(true, false);
      box.setFromObject(g.mesh);
      if (box.isEmpty()) continue;
      box.getSize(size);
      const extent = Math.max(size.x, size.y, size.z);
      if (extent > CONFIG.halos.maxFixture) continue;
      const centre = box.getCenter(new Vector3());
      const material = new SpriteMaterial({ map, color: 0x000000, blending: AdditiveBlending, depthWrite: false, transparent: true });
      const sprite = new Sprite(material);
      const scale = Math.min(CONFIG.halos.maxSize, Math.max(CONFIG.halos.minSize, extent * CONFIG.halos.size));
      sprite.scale.setScalar(scale);
      sprite.position.copy(centre);
      sprite.renderOrder = 10;
      sprite.visible = false;
      this.root.add(sprite);
      const color = g.material.emissive.clone();
      this.halos.push({ sprite, group: g.group, centre, color, pull: Math.min(0.2, scale * 0.3) });
    }
  }

  get count(): number {
    return this.halos.length;
  }

  /** Brightness follows each halo's light group; each sits a little toward the camera so its own fixture doesn't hide it. */
  update(lights: LightGroups, camera: Camera): void {
    for (const h of this.halos) {
      const level = lights.uniform(h.group).value;
      h.sprite.visible = level > 0.01;
      if (!h.sprite.visible) continue;
      h.sprite.material.color.copy(h.color).multiplyScalar(CONFIG.halos.strength * level);
      this.toCamera.subVectors(camera.position, h.centre).normalize();
      h.sprite.position.copy(h.centre).addScaledVector(this.toCamera, h.pull);
    }
  }
}
