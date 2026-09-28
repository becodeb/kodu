import fs from 'fs';
export const CHROME = { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
const three = fs.readFileSync('node_modules/three/build/three.module.js');
const threeCore = fs.existsSync('node_modules/three/build/three.core.js') ? fs.readFileSync('node_modules/three/build/three.core.js') : null;
const fontCss = fs.readFileSync('res/plex.css', 'utf8').replace(/url\(/g, 'url(http://localhost:8765/res/');
export async function rutas(ctx) {
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js', (r) => r.fulfill({ body: three, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
  if (threeCore) await ctx.route('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.core.js', (r) => r.fulfill({ body: threeCore, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: fontCss, contentType: 'text/css' }));
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
}
