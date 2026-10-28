import { Color, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { HeldRifle, RifleRack } from '../src/range-rack';

describe('the rack and the button', () => {
  it('stand where the config says, and are the targets for the crosshair', () => {
    const range = { armed: false, busy: false, canArm: true };
    const r = new RifleRack(range, null);
    expect(r.rack.position.toArray()).toEqual([CONFIG.range.rack[0], CONFIG.range.floor, CONFIG.range.rack[1]]);
    expect(r.button.position.toArray()).toEqual([CONFIG.range.button[0], CONFIG.range.floor, CONFIG.range.button[1]]);
    expect(r.rackTarget).toMatchObject({ kind: 'rack', node: r.rack });
    expect(r.buttonTarget).toMatchObject({ kind: 'range-button', node: r.button });
    if (r.rackTarget.kind === 'rack') expect(r.rackTarget.range).toBe(range);
  });
  it('lights the button while a round is on', () => {
    const r = new RifleRack({ armed: false, busy: false, canArm: true }, null);
    r.update(0.5, null, false);
    const idle = r.capColour;
    r.update(0.5, null, true);
    expect(r.capColour).not.toBe(idle);
    expect(r.capColour).toBe(new Color(CONFIG.range.colours.lit).getHexString());
  });
});

describe('the rifle in hand', () => {
  it('follows the camera, kicks and flashes on a shot, and settles', () => {
    const held = new HeldRifle(null);
    const camera = new PerspectiveCamera();
    camera.position.set(1, 1.6, -8);
    camera.updateMatrixWorld();
    held.shown = true;
    held.update(0.016, camera, 1);
    const at = new Vector3();
    held.scene.children[0].getWorldPosition(at);
    expect(at.toArray()).toEqual([1, 1.6, -8]);
    held.fire();
    held.update(0.01, camera, 1);
    expect(held.flashing).toBe(true);
    held.update(CONFIG.range.kickTime, camera, 1);
    expect(held.flashing).toBe(false);
  });
});
