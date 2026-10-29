// Baked atlases' empty texels, filled from their islands, and the raw image formats that carry them between dwebp
// and basisu (scripts/optimize-glb.mjs).

/** RGBA rows top to bottom from a PAM file (dwebp -pam). */
export function readPam(buf) {
  const end = buf.indexOf('ENDHDR\n');
  const head = buf.subarray(0, end).toString();
  const w = Number(/WIDTH (\d+)/.exec(head)[1]);
  const h = Number(/HEIGHT (\d+)/.exec(head)[1]);
  return { w, h, px: new Uint8Array(buf.subarray(end + 7, end + 7 + w * h * 4)) };
}

/** An uncompressed 32-bit TGA, rows top to bottom. */
export function tga({ w, h, px }) {
  const head = Buffer.alloc(18);
  head[2] = 2;
  head.writeUInt16LE(w, 12);
  head.writeUInt16LE(h, 14);
  head[16] = 32;
  head[17] = 0x28; // top-left origin, 8 alpha bits
  const body = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    body[i * 4] = px[i * 4 + 2];
    body[i * 4 + 1] = px[i * 4 + 1];
    body[i * 4 + 2] = px[i * 4];
    body[i * 4 + 3] = px[i * 4 + 3];
  }
  return Buffer.concat([head, body]);
}

/**
 * A baked atlas's empty texels (pure black: nothing was baked there) take the colour of the islands near them
 * (push-pull: averaged down a pyramid of the baked texels, then filled back up). Otherwise mipmaps blend the black into
 * thin islands, and slats seen from across the room go dark.
 */
export function fillEmpty({ w, h, px }) {
  const levels = [];
  let cw = w;
  let ch = h;
  let col = new Float32Array(w * h * 3);
  let wgt = new Float32Array(w * h);
  let empty = 0;
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    if (r | g | b) {
      col.set([r, g, b], i * 3);
      wgt[i] = 1;
    } else empty++;
  }
  if (empty === 0 || empty === w * h) return { w, h, px };
  levels.push({ cw, ch, col, wgt });
  while (cw > 1 && ch > 1) {
    const nw = cw >> 1, nh = ch >> 1;
    const ncol = new Float32Array(nw * nh * 3);
    const nwgt = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sw = 0;
        const acc = [0, 0, 0];
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const j = (y * 2 + dy) * cw + x * 2 + dx;
          const k = wgt[j];
          sw += k;
          for (let c = 0; c < 3; c++) acc[c] += col[j * 3 + c] * k;
        }
        const i = y * nw + x;
        if (sw > 0) for (let c = 0; c < 3; c++) ncol[i * 3 + c] = acc[c] / sw;
        nwgt[i] = Math.min(1, sw);
      }
    }
    [cw, ch, col, wgt] = [nw, nh, ncol, nwgt];
    levels.push({ cw, ch, col, wgt });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    for (let y = 0; y < fine.ch; y++) {
      for (let x = 0; x < fine.cw; x++) {
        const i = y * fine.cw + x;
        if (fine.wgt[i] >= 1) continue;
        const j = Math.min(coarse.ch - 1, y >> 1) * coarse.cw + Math.min(coarse.cw - 1, x >> 1);
        const k = fine.wgt[i];
        for (let c = 0; c < 3; c++) fine.col[i * 3 + c] = fine.col[i * 3 + c] * k + coarse.col[j * 3 + c] * (1 - k);
        fine.wgt[i] = 1;
      }
    }
  }
  const out = new Uint8Array(px);
  const base = levels[0];
  for (let i = 0; i < w * h; i++) {
    if (px[i * 4] | px[i * 4 + 1] | px[i * 4 + 2]) continue;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(base.col[i * 3 + c]);
  }
  return { w, h, px: out };
}
