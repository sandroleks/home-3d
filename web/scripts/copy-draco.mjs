// Copies three.js's Draco decoder and Basis (KTX2) transcoder into public/ so the site has no CDN dependency.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const [from, to, what] of [['draco/gltf', 'draco', 'Draco decoder'], ['basis', 'basis', 'Basis transcoder']]) {
  const dest = join(root, 'public', to);
  mkdirSync(dest, { recursive: true });
  cpSync(join(root, 'node_modules/three/examples/jsm/libs', from), dest, { recursive: true });
  console.log(`${what} copied to ${dest}`);
}
