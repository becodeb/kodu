import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
await build({
  entryPoints: ['scripts/cell-3d/viewer.js'],
  outfile: 'public/demos/assets/cell-3d/visor-v1.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'eof',
});
await copyFile('node_modules/three/LICENSE','public/demos/assets/cell-3d/THREE-LICENSE.txt');
console.log('Visor 3D compilado con Three.js local.');
