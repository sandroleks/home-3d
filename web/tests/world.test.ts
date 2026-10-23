import { MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { RoomLights } from '../src/lightmaps';
import { applyGlows } from '../src/world';

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
