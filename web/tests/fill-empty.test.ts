import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs build script, no types
import { fillEmpty, readPam, tga } from '../scripts/fill-empty.mjs';

const image = (w: number, h: number, at: (x: number, y: number) => [number, number, number]) => {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([...at(x, y), 255], (y * w + x) * 4);
  return { w, h, px };
};

describe('fillEmpty', () => {
  it('fills black texels from the islands near them and leaves baked texels as they are', () => {
    // a 2 px wood-coloured slat down the middle of a black 16 x 16 atlas
    const img = image(16, 16, (x) => (x === 7 || x === 8 ? [180, 140, 90] : [0, 0, 0]));
    const out = fillEmpty(img);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        expect([out.px[i], out.px[i + 1], out.px[i + 2]]).toEqual([180, 140, 90]);
      }
    }
  });

  it('leaves an image with nothing empty, or nothing baked, alone', () => {
    const full = image(4, 4, () => [10, 20, 30]);
    expect(fillEmpty(full).px).toEqual(full.px);
    const none = image(4, 4, () => [0, 0, 0]);
    expect(fillEmpty(none).px).toEqual(none.px);
  });
});

describe('raw images', () => {
  it('reads a PAM and writes a top-left TGA in BGRA', () => {
    const head = Buffer.from('P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n');
    const img = readPam(Buffer.concat([head, Buffer.from([1, 2, 3, 255, 4, 5, 6, 255])]));
    expect([img.w, img.h, [...img.px]]).toEqual([2, 1, [1, 2, 3, 255, 4, 5, 6, 255]]);
    const t: Buffer = tga(img);
    expect(t.readUInt16LE(12)).toBe(2);
    expect(t[17] & 0x20).toBe(0x20);
    expect([...t.subarray(18, 22)]).toEqual([3, 2, 1, 255]);
  });
});
