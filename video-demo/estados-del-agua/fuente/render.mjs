import { chromium } from 'playwright';
import fs from 'fs';
import { CHROME, rutas } from './common.mjs';
const [,, mode, a, b, out = 'frames'] = process.argv;
const FPS = 60;
const browser = await chromium.launch(CHROME);
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await rutas(ctx);
async function mkPage() {
  const page = await ctx.newPage();
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.log('[err]', e.message));
  await page.goto('http://localhost:8765/scene.html');
  await page.evaluate(() => window.ready);
  return page;
}
fs.mkdirSync(mode === 'stills' ? b : out, { recursive: true });
if (mode === 'stills') {
  const page = await mkPage();
  for (const t of a.split(',').map(Number)) {
    await page.evaluate((t) => window.render(t), t);
    await page.screenshot({ path: `${b}/t_${t.toFixed(2).padStart(6, '0')}.png` });
  }
} else if (mode === 'events') {
  const page = await mkPage();
  fs.writeFileSync('events.json', JSON.stringify(await page.evaluate(() => window.EVENTS)));
} else {
  const f0 = +a, f1 = +b, W = 4;
  const pages = await Promise.all(Array.from({ length: W }, mkPage));
  let next = f0;
  await Promise.all(pages.map(async (page) => {
    while (next < f1) {
      const f = next++;
      await page.evaluate((t) => window.render(t), f / FPS);
      await page.screenshot({ path: `${out}/f_${String(f).padStart(5, '0')}.png` });
      if (f % 300 === 0) console.log('frame', f);
    }
  }));
}
await browser.close();
