import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { LightGroups } from '../src/lightmaps';
import type { LoadedAssets } from '../src/loader';
import { parseManifest } from '../src/manifest';
import { applyMovable } from '../src/movables';
import { applyGlows, applyPacks, buildWorld, glowGroup } from '../src/world';
import { sampleManifest } from './fixtures';

const stubCanvas = (width: number, height: number) => ({ width, height, getContext: () => null });

function build() {
  const manifest = parseManifest(sampleManifest());
  const root = new Group();
  const names = ['Room_alpha', 'Room_beta', 'Room_exterior', 'Door_1', 'Switch_alpha', 'Move_cabinet-drawer', 'Move_cabinet-door',
    'Screen_beta-tv', 'Glow_desk-lamp-bulb', 'Lamp_alpha-desk-lamp'];
  for (const name of names) {
    const g = new Group();
    g.name = name;
    const glowing = name === 'Room_alpha' || name.startsWith('Glow_');
    const material = new MeshStandardMaterial({ name: glowing ? 'Lamp glow @alpha/desk-lamp' : 'Plaster', emissive: glowing ? 0xffeecc : 0, emissiveIntensity: 2 });
    g.add(new Mesh(new BoxGeometry(1, 1, 1), material));
    root.add(g);
  }
  const map = () => ({ texture: new Texture(), range: 1 });
  const files = [...manifest.chunks.map((c) => c.day.file), manifest.doors[0].lightmap.file, manifest.movables[0].lightmap.file];
  const day = new Map(files.map((f) => [f, map()]));
  const pack = map();
  const light = Promise.resolve(new Map([['lightmaps/alpha_light.webp', map()], ['lightmaps/alpha_pack0.webp', pack], ['lightmaps/beta_pack0.webp', map()]]));
  const collision = { x0: 0, z0: 0, cell: 1, width: 1, height: 1, radius: 0.2, blocked: new Uint8Array(1) };
  const assets = { manifest, collision, scene: root, day, light, surroundings: Promise.resolve(null) } as unknown as LoadedAssets;
  const world = buildWorld(assets, new Scene(), stubCanvas);
  return { world, root, light, pack };
}

describe('applyGlows', () => {
  it('dims a glowing material with its group', () => {
    const lights = new LightGroups(['sala/floor-lamp'], 0.4);
    const material = new MeshStandardMaterial({ emissive: 0xffeecc, emissiveIntensity: 3 });
    const glows = [{ group: 'sala/floor-lamp', material, base: 3 }];
    applyGlows(glows, lights);
    expect(material.emissiveIntensity).toBe(0);
    lights.toggle('sala/floor-lamp');
    lights.update(1);
    applyGlows(glows, lights);
    expect(material.emissiveIntensity).toBe(3);
  });

  it('reads the group from the material name', () => {
    expect(glowGroup('Linen shade @quarto-01/bedside-left')).toBe('quarto-01/bedside-left');
    expect(glowGroup('Opal diffuser @sala')).toBe('sala');
    expect(glowGroup('Oak')).toBeNull();
  });
});

describe('buildWorld', () => {
  it('binds packed lamp layers once they load', async () => {
    const { world, root, light, pack } = build();
    await light;
    await Promise.resolve();
    const alpha = (root.getObjectByName('Room_alpha')!.children[0] as Mesh).material as MeshStandardMaterial;
    expect(alpha.userData.lightmapUniforms.lmPack0.value).toBe(pack.texture);
    expect(world.packs).toHaveLength(2);
  });

  it('glows chunk shades and bulbs with their lamp group, not the room switch', () => {
    const { world } = build();
    expect(world.glows.map((g) => g.group)).toEqual(['alpha/desk-lamp', 'alpha/desk-lamp']);
  });

  it('weighs spill through a door by how open it is and how lit the room behind it is', () => {
    const { world } = build();
    const spill = world.packs[1];
    world.lights.toggle('alpha');
    world.lights.update(10);
    applyPacks(world);
    expect(spill.gains.value.x).toBe(0); // door shut
    world.doors[0].state.toggle();
    world.doors[0].state.update(10);
    applyPacks(world);
    expect(spill.gains.value.x).toBeCloseTo(0.5 * 100 / 110); // range x alpha's share of the room's lamp power
    const own = world.packs[0];
    expect(own.gains.value.x).toBeCloseTo(1.5 * 0.02); // the desk lamp is off: only the spill floor
  });

  it('makes lamp boxes invisible click targets, and drawers and screens targets', () => {
    const { world, root } = build();
    const box = root.getObjectByName('Lamp_alpha-desk-lamp')!;
    expect(box.visible).toBe(false);
    expect(world.targets.get(box)).toMatchObject({ kind: 'lamp', group: 'alpha/desk-lamp', name: 'desk-lamp' });
    expect(world.targets.get(root.getObjectByName('Move_cabinet-drawer')!)?.kind).toBe('movable');
    expect(world.targets.get(root.getObjectByName('Screen_beta-tv')!)?.kind).toBe('screen');
    expect(world.occluders.some((m) => m.parent === box)).toBe(false);
  });

  it('slides a drawer out along its direction', () => {
    const { world } = build();
    const drawer = world.movables[0];
    drawer.state.toggle();
    drawer.state.update(10);
    applyMovable(drawer);
    expect(drawer.node.position.z).toBeCloseTo(0.35);
  });
});
