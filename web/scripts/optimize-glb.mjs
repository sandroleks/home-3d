// After an export: node scripts/optimize-glb.mjs <file.glb> [...]
//
// Merges identical materials and textures, joins a mesh's primitives that share a material, and turns every image
// into a KTX2 GPU texture (Basis Universal, mipmapped): base colours and glows ETC1S, which the GPU keeps at an
// eighth of the memory of plain RGBA, normal and roughness maps UASTC, which keeps their precision. Meshes stay Draco,
// with the export's precision (lightmap UVs need their 14 bits). Needs `basisu` (brew install basis_universal) and
// `dwebp` (brew install webp) on the PATH. Rewrites each file in place; a file already done is left as it is.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRDracoMeshCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, join as joinPrimitives, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { fillEmpty, readPam, tga } from './fill-empty.mjs';

/** How each texture is used, from the material slots that point at it: 'colour' (sRGB) or 'data' (linear). */
function roles(doc) {
  const out = new Map();
  for (const m of doc.getRoot().listMaterials()) {
    for (const t of [m.getBaseColorTexture(), m.getEmissiveTexture()]) if (t && !out.has(t)) out.set(t, 'colour');
    for (const t of [m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getOcclusionTexture()]) if (t) out.set(t, out.get(t) === 'colour' ? 'colour' : t === m.getNormalTexture() ? 'normal' : 'data');
  }
  return out;
}

/** Baked atlases (albedo_*, normal_*) have empty texels between their islands; tiles and photos don't. */
const isAtlas = (texture) => /^(albedo|normal)_/.test(texture.getName());

function encode(texture, role, dir, i) {
  const ext = texture.getMimeType() === 'image/webp' ? 'webp' : texture.getMimeType() === 'image/png' ? 'png' : 'jpg';
  const src = join(dir, `t${i}.${ext}`);
  const png = join(dir, `t${i}.png`);
  const out = join(dir, `t${i}.ktx2`);
  writeFileSync(src, texture.getImage());
  let input = ext === 'jpg' ? src : png;
  if (ext === 'webp' && isAtlas(texture)) {
    const pam = join(dir, `t${i}.pam`);
    execFileSync('dwebp', ['-quiet', '-pam', src, '-o', pam]);
    input = join(dir, `t${i}.tga`);
    writeFileSync(input, tga(fillEmpty(readPam(readFileSync(pam)))));
  } else if (ext === 'webp') execFileSync('dwebp', ['-quiet', src, '-o', png]);
  const args = role === 'colour'
    ? ['-ktx2', '-etc1s', '-q', '200', '-mipmap', '-file', input, '-output_file', out]
    : ['-ktx2', '-uastc', '-uastc_level', '2', '-uastc_rdo_l', '0.5', '-linear', '-mipmap', ...(role === 'normal' ? ['-normal_map'] : []), '-file', input, '-output_file', out];
  execFileSync('basisu', args, { stdio: 'ignore' });
  return readFileSync(out);
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });

for (const file of process.argv.slice(2)) {
  const before = statSync(file).size;
  const doc = await io.read(file);
  const textures = doc.getRoot().listTextures();
  if (textures.length && textures.every((t) => t.getMimeType() === 'image/ktx2')) {
    console.log(`${file}: already optimised`);
    continue;
  }
  const materials = doc.getRoot().listMaterials().length;
  // Lightmap UVs (TEXCOORD_1) are read by our own shader, not by any material slot: keep every attribute.
  // Materials are told apart by name too: ' @<group>' says which light a glow follows (world.ts glowGroup).
  await doc.transform(dedup({ keepUniqueNames: true }), joinPrimitives({ keepMeshes: true, keepNamed: true }), prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }));
  const role = roles(doc);
  const dir = mkdtempSync(join(tmpdir(), 'optimize-glb-'));
  try {
    doc.getRoot().listTextures().forEach((t, i) => {
      const r = role.get(t) ?? 'colour';
      t.setImage(encode(t, r, dir, i)).setMimeType('image/ktx2');
      const uri = t.getURI();
      if (uri) t.setURI(uri.replace(/\.(webp|png|jpe?g)$/i, '.ktx2'));
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  doc.getRoot().listExtensionsUsed().filter((e) => e.extensionName === EXTTextureWebP.EXTENSION_NAME).forEach((e) => e.dispose());
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
    quantizationBits: { POSITION: 14, NORMAL: 10, COLOR: 8, TEX_COORD: 14, GENERIC: 12 },
  });
  await io.write(file, doc);
  const prims = doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0);
  console.log(`${file}: ${(before / 2 ** 20).toFixed(1)} -> ${(statSync(file).size / 2 ** 20).toFixed(1)} MB, ${materials} -> ${doc.getRoot().listMaterials().length} materials, ${prims} primitives, ${doc.getRoot().listTextures().length} KTX2 textures`);
}
