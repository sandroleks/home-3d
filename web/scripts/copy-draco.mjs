// Copies three.js's Draco decoder into public/ so the site has no CDN dependency.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/three/examples/jsm/libs/draco/gltf');
const dest = join(root, 'public/draco');
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Draco decoder copied to ${dest}`);
