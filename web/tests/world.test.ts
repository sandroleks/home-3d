import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { RoomLights } from '../src/lightmaps';
import type { LoadedAssets } from '../src/loader';
import { parseManifest } from '../src/manifest';
import { applyGlows, buildWorld } from '../src/world';
import { sampleManifest } from './fixtures';

describe('applyGlows', () => {
  it('dims a glowing material with its room light', () => {
    const lights = new RoomLights(['sala'], 0.4);
    const material = new MeshStandardMaterial({ emissive: 0xffeecc, emissiveIntensity: 3 });
    const glows = [{ room: 'sala', material, base: 3 }];
    applyGlows(glows, lights);
    expect(material.emissiveIntensity).toBe(0);
    lights.toggle('sala');
    lights.update(1);
    applyGlows(glows, lights);
    expect(material.emissiveIntensity).toBe(3);
  });
});

describe('buildWorld', () => {
  it("binds an open-plan neighbour's lamp layer to a chunk's second slot, on the neighbour's switch", async () => {
    const raw = sampleManifest() as { chunks: Record<string, unknown>[] };
    raw.chunks[1].lights = [{ room: 'alpha', file: 'lightmaps/beta_light-alpha.webp', range: 1.5 }];
    const manifest = parseManifest(raw);
    const root = new Group();
    for (const name of ['Room_alpha', 'Room_beta', 'Room_exterior', 'Door_1', 'Switch_alpha']) {
      const g = new Group();
      g.name = name;
      g.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
      root.add(g);
    }
    const map = () => ({ texture: new Texture(), range: 1 });
    const day = new Map([...manifest.chunks.map((c) => c.day.file), manifest.doors[0].lightmap.file].map((f) => [f, map()]));
    const spill = { texture: new Texture(), range: 1.5 };
    const light = Promise.resolve(new Map([['lightmaps/alpha_light.webp', map()], ['lightmaps/beta_light-alpha.webp', spill]]));
    const collision = { x0: 0, z0: 0, cell: 1, width: 1, height: 1, radius: 0.2, blocked: new Uint8Array(1) };
    const world = buildWorld({ manifest, collision, scene: root, day, light, surroundings: Promise.resolve(null) } as unknown as LoadedAssets, new Scene());
    await light;
    await Promise.resolve();
    const beta = (root.getObjectByName('Room_beta')!.children[0] as Mesh).material as MeshStandardMaterial;
    const u = beta.userData.lightmapUniforms;
    expect(u.lmLight2.value).toBe(spill.texture);
    expect(u.lmLight2Range.value).toBe(1.5);
    expect(u.lmLight2Intensity).toBe(world.lights.uniform('alpha'));
  });
});
