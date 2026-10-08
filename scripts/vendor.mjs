// Copies the exact Three.js files the viewer needs from node_modules into
// ./vendor/three so the app is served fully offline with no build step.
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'three');
const dst = join(root, 'vendor', 'three');

if (!existsSync(src)) {
  console.warn('[vendor] node_modules/three not found; keeping existing vendor/ copy.');
  process.exit(0);
}

const files = [
  'LICENSE',
  'build/three.module.js',
  'examples/jsm/controls/OrbitControls.js',
  'examples/jsm/renderers/CSS2DRenderer.js',
  'examples/jsm/lines/Line2.js',
  'examples/jsm/lines/LineGeometry.js',
  'examples/jsm/lines/LineMaterial.js',
  'examples/jsm/lines/LineSegments2.js',
  'examples/jsm/lines/LineSegmentsGeometry.js',
];
for (const f of files) {
  mkdirSync(dirname(join(dst, f)), { recursive: true });
  cpSync(join(src, f), join(dst, f));
}
const { version } = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
writeFileSync(join(dst, 'VERSION'), version + '\n');
console.log(`[vendor] copied ${files.length} files from three@${version} -> vendor/three`);
