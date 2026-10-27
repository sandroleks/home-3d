import { Box3, Color, Mesh, MeshMatcapMaterial, Object3D, SRGBColorSpace, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildCreature, creaturePalette, eggFront, eggTop, FACE_COLOURS, faceAlong, SPECIES, speciesFor } from '../src/creatures';

const hsl = (c: Color) => {
  const out = { h: 0, s: 0, l: 0 };
  c.getHSL(out, SRGBColorSpace);
  return out;
};
const colours = (c: ReturnType<typeof buildCreature>) => c.tints.map((t) => `#${t.base.getHexString()}`);

describe('creaturePalette', () => {
  it('gives a pastel a cream face with a hint of it, and duskier legs of the same hue', () => {
    const p = creaturePalette('#a9d4f5');
    const body = hsl(p.body);
    const face = hsl(p.face);
    const dark = hsl(p.dark);
    expect(face.l).toBeGreaterThan(body.l);
    expect(face.l).toBeGreaterThan(0.9);
    expect(face.h).toBeCloseTo(body.h, 1);
    expect(dark.l).toBeLessThan(body.l - 0.25);
    expect(dark.h).toBeCloseTo(body.h, 2);
  });
});

describe('the egg', () => {
  it('is 0.84 m tall and its front and top are where the parts sit', () => {
    expect(eggFront(0, 0)).toBeCloseTo(-0.38);
    expect(eggFront(0.5, 0)).toBe(-0);
    expect(eggTop(0)).toBeCloseTo(0.42);
    expect(eggTop(0.12)).toBeLessThan(0.42);
  });
  it('faces a part along a normal', () => {
    const o = new Object3D();
    const n = new Vector3(0.3, -0.4, -0.866).normalize();
    faceAlong(o, n.x, n.y, n.z);
    o.updateMatrixWorld();
    const front = new Vector3(0, 0, -1).applyQuaternion(o.quaternion);
    expect(front.distanceTo(n)).toBeLessThan(1e-6);
  });
});

describe('buildCreature', () => {
  it("gives every animal a mouth that opens: hidden at rest, except the bunny's little open one", () => {
    for (const species of SPECIES) {
      const { mouth } = buildCreature(species, '#a9d4f5');
      expect(mouth.open).toBeGreaterThan(mouth.rest);
      expect(mouth.node.scale.y).toBeCloseTo(mouth.rest);
      expect(mouth.node.visible).toBe(species === 'bunny');
    }
  });

  for (const species of SPECIES) {
    it(`builds a ${species} that stands on the floor, faces -z and casts no shadow`, () => {
      const c = buildCreature(species, '#f7b2c4');
      expect(c.species).toBe(species);
      expect(c.legs).toHaveLength(4);
      expect(c.eyes).toHaveLength(2);
      expect(c.tints.length).toBeGreaterThanOrEqual(8); // body, face, legs, eye white, pupil, mouth, cheeks, nose...
      expect(new Set(c.tints.map((t) => t.material)).size).toBe(c.tints.length); // each material tinted once
      for (const t of c.tints) {
        expect(t.material).toBeInstanceOf(MeshMatcapMaterial);
        expect(t.material.toneMapped).toBe(false);
      }
      expect(colours(c)).toEqual(expect.arrayContaining([FACE_COLOURS.white, FACE_COLOURS.pupil, FACE_COLOURS.blush]));
      c.root.updateMatrixWorld(true);
      const box = new Box3().setFromObject(c.root);
      expect(box.min.y).toBeCloseTo(0, 2); // feet on the floor
      expect(box.max.y).toBeGreaterThan(1.2);
      expect(box.max.y).toBeLessThan(1.8);
      expect(c.top).toBeGreaterThan(box.max.y - 0.1); // the label clears it
      expect(c.top).toBeLessThan(box.max.y + 0.15);
      expect(box.max.x - box.min.x).toBeLessThan(1);
      c.root.traverse((o) => {
        if ((o as Mesh).isMesh) expect(o.castShadow).toBe(false);
      });
      // The eyes and the face are on the front
      for (const e of c.eyes) expect(e.lid.getWorldPosition(new Vector3()).z).toBeLessThan(-0.3);
      expect(c.body.children[1].position.z).toBeLessThan(-0.25);
    });
  }
  it('gives each animal its own expression', () => {
    expect(colours(buildCreature('reindeer', '#e2bc94'))).toContain(FACE_COLOURS.rudolph);
    expect(colours(buildCreature('bear', '#e2bc94'))).toContain(FACE_COLOURS.tongue);
    expect(colours(buildCreature('bunny', '#e2bc94'))).toContain(FACE_COLOURS.bunnyNose);
    const fox = buildCreature('fox', '#ffc4a0');
    expect(fox.wags.some((w) => w.idle > 0.2)).toBe(true); // the wagging tail
    const bunny = buildCreature('bunny', '#cdb6f2');
    expect(bunny.wags.filter((w) => w.axis === 'x')).toHaveLength(2); // floppy ears
  });
  it('makes one eye a little bigger than the other', () => {
    const c = buildCreature('bear', '#b5e5b0');
    const size = (i: number) => (c.eyes[i].lid.children[0] as Mesh).scale.x;
    expect(size(0)).not.toBeCloseTo(size(1), 3);
  });
  it('shares geometry between figures, not materials', () => {
    const a = buildCreature('reindeer', '#e2bc94');
    const b = buildCreature('reindeer', '#a9d4f5');
    const ma = a.body.children[0] as Mesh;
    const mb = b.body.children[0] as Mesh;
    expect(ma.geometry).toBe(mb.geometry);
    expect(ma.material).not.toBe(mb.material);
  });
});

describe('speciesFor', () => {
  it('is stable per id and uses every animal', () => {
    expect(speciesFor('abc')).toBe(speciesFor('abc'));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => speciesFor(`peer-${i}`)));
    expect(seen.size).toBe(SPECIES.length);
  });
});
