import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { blobTexture, ContactShadow, solidBox } from '../src/contact-shadow';
import { Box3 } from 'three';
import { CONFIG } from '../src/config';

describe('ContactShadow', () => {
  it('is a soft blob: dark in the middle, clear at the edge', () => {
    const t = blobTexture(16);
    const px = t.image.data as Uint8Array;
    const at = (x: number, y: number) => px[(y * 16 + x) * 4 + 1];
    expect(at(8, 8)).toBeGreaterThan(200);
    expect(at(0, 0)).toBe(0);
    expect(at(0, 8)).toBeLessThan(at(4, 8));
  });

  it('lies flat under the thing, on its parent, sized to its footprint', () => {
    const drawer = new Group();
    drawer.position.set(1, 0.8, 0);
    const mug = new Group();
    mug.add(new Mesh(new BoxGeometry(0.1, 0.12, 0.2).translate(0, 0.06, 0), new MeshBasicMaterial()));
    mug.position.set(0.2, 0, 0);
    drawer.add(mug);
    const s = new ContactShadow();
    s.place(mug, drawer);
    expect(s.mesh.parent).toBe(drawer);
    expect(s.mesh.visible).toBe(true);
    const p = s.mesh.getWorldPosition(new Vector3());
    expect(p.x).toBeCloseTo(1.2);
    expect(p.y).toBeCloseTo(0.8 + CONFIG.contactShadow.lift);
    expect(s.mesh.scale.x).toBeCloseTo(0.1 * CONFIG.contactShadow.spread);
    expect(s.mesh.scale.z).toBeCloseTo(0.2 * CONFIG.contactShadow.spread);
    drawer.position.x = 2; // a drawer sliding takes it along
    expect(s.mesh.getWorldPosition(new Vector3()).x).toBeCloseTo(2.2);
  });

  it('never takes a ray', () => {
    const s = new ContactShadow();
    const root = new Group();
    const thing = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial());
    root.add(thing);
    s.place(thing, root);
    const hits = new Raycaster(new Vector3(0, 1, 0.07), new Vector3(0, -1, 0)).intersectObject(root, true);
    expect(hits.filter((h) => h.object === s.mesh)).toHaveLength(0);
  });

  it('stays out of the box of what it lies under', () => {
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(0.1, 0.3, 0.1).translate(0, 0.15, 0), new MeshBasicMaterial()));
    new ContactShadow().place(root.children[0], root);
    const b = solidBox(root, new Box3());
    expect(b.max.x).toBeCloseTo(0.05);
    expect(new Box3().setFromObject(root).max.x).toBeGreaterThan(0.06); // three's own box takes it in
  });
});
