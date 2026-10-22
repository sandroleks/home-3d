/** Decode run lengths of alternating 0/1 values that start with 0 (matches raster.rle_encode). */
export function rleDecode(runs: number[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let pos = 0;
  let value = 0;
  for (const run of runs) {
    if (value) out.fill(1, pos, pos + run);
    pos += run;
    value ^= 1;
  }
  if (pos !== length) throw new Error(`RLE covers ${pos} cells, expected ${length}`);
  return out;
}
