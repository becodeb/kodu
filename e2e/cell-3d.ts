import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { buildPreviewDocument } from '../src/lib/preview.ts';

const base = process.env.KODU_BASE_URL ?? 'http://localhost:3002';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL ?? 'msedge'});
const page = await browser.newPage({viewport:{width:1200,height:950},reducedMotion:'reduce'});
page.setDefaultTimeout(30000);
const errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
await mkdir('output/cell-3d',{recursive:true});
try {
  const response=await page.goto(base+'/p/kodu-ejemplo-celula');
  assert.equal(response?.status(),200);
  const html=await response!.text();
  console.log('3D: página recibida');
  const host=page.locator('[data-cell-viewer]');
  await page.locator('[data-state="ready"]').waitFor({timeout:60000});
  await page.waitForTimeout(1000);
  // A ready flag is insufficient: verify the WebGL canvas actually has pixels.
  const coverage=await page.locator('canvas').evaluate((canvas:HTMLCanvasElement)=>{
    const copy=document.createElement('canvas');copy.width=64;copy.height=64;
    const ctx=copy.getContext('2d')!;ctx.drawImage(canvas,0,0,64,64);
    const data=ctx.getImageData(0,0,64,64).data;
    let opaque=0;for(let i=3;i<data.length;i+=4)if(data[i]>100)opaque++;
    return opaque/4096;
  });
  assert(coverage>.25,'El modelo debe ocupar una parte visible del canvas, cobertura: '+coverage);
  console.log('3D: canvas verificado',coverage);
  const box=(await page.locator('canvas').boundingBox())!;
  const capture=()=>page.screenshot({clip:box});
  const before=await capture();
  await page.mouse.move(box.x+box.width*.45,box.y+box.height*.6);
  await page.mouse.down();await page.mouse.move(box.x+box.width*.67,box.y+box.height*.52,{steps:12});await page.mouse.up();
  await page.waitForTimeout(1000);
  assert(!before.equals(await capture()),'Arrastrar debe cambiar la cámara');
  console.log('3D: giro verificado');
  await page.locator('#structure').selectOption('golgi');
  await page.locator('#reset-view').click();await page.waitForTimeout(800);
  // Pick real geometry after hiding its projected label, not a DOM hotspot.
  const nucleus=(await page.locator('[data-id="nucleo"]').boundingBox())!;
  await page.locator('#toggle-labels').click();
  await page.mouse.click(nucleus.x+nucleus.width/2,nucleus.y+nucleus.height/2);
  assert.equal(await page.locator('#organelle-name').innerText(),'Núcleo');
  assert.equal(await page.locator('#toggle-labels').getAttribute('aria-pressed'),'false');
  console.log('3D: selección geométrica verificada');
  for(const [id,name] of Object.entries({mitocondria:'Mitocondria',golgi:'Aparato de Golgi',reticulo:'Retículo rugoso',lisosoma:'Lisosoma',membrana:'Membrana plasmática'})){
    await page.locator('#structure').selectOption(id);
    assert.equal(await page.locator('#organelle-name').innerText(),name);
  }
  await page.locator('#reset-view').click();await page.waitForTimeout(800);
  const normal=await capture();
  await page.locator('#zoom-in').click();await page.waitForTimeout(800);
  assert(!normal.equals(await capture()),'Zoom debe cambiar el encuadre');
  await page.locator('canvas').focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(800);
  const frames=await host.getAttribute('data-frames');await page.waitForTimeout(1000);
  assert.equal(await host.getAttribute('data-frames'),frames,'Sin interacción no debe renderizar continuamente');
  console.log('3D: zoom, teclado y reposo verificados');
  assert.equal(await page.evaluate(async()=>{try{await fetch('/api/projects');return false}catch{return true}}),true,'La CSP debe bloquear acceso a la API');
  await page.locator('#reset-view').click();await page.locator('#toggle-labels').click();
  await page.locator('#structure').selectOption('nucleo');await page.locator('#reset-view').click();
  await page.waitForTimeout(800);
  await page.screenshot({path:'output/cell-3d/desktop.png',fullPage:true});
  await page.screenshot({clip:box,path:'output/cell-3d/model.png'});
  for(const width of [390,768]){
    await page.setViewportSize({width,height:844});await page.waitForTimeout(600);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(width===390)await page.screenshot({path:'output/cell-3d/mobile.png',fullPage:true});
  }
  // Same opaque sandbox and bridge as the editor. Must not require allow-same-origin.
  await page.goto(base);
  await page.evaluate(src=>{
    document.body.innerHTML='';const f=document.createElement('iframe');
    f.id='sandbox-test';f.setAttribute('sandbox','allow-scripts');f.style.cssText='width:1100px;height:900px';f.srcdoc=src;document.body.append(f);
  },buildPreviewDocument(html));
  const frame=page.frameLocator('#sandbox-test');
  await frame.locator('[data-state="ready"]').waitFor({timeout:60000});
  console.log('3D: sandbox verificado');
  await frame.locator('#structure').selectOption('golgi');
  assert.equal(await frame.locator('#organelle-name').innerText(),'Aparato de Golgi');
  if(process.env.KODU_CAPTURE_QA==='1'){
    const capture=await page.evaluate<{error?:string;dataUrl?:string}>(`new Promise(resolve=>{
      const timeout=setTimeout(()=>resolve({error:'Tiempo de captura agotado'}),45000);
      const receive=(event)=>{
        if(event.data?.type!=='__kodu_capture_result__')return;
        clearTimeout(timeout);window.removeEventListener('message',receive);resolve(event.data);
      };
      window.addEventListener('message',receive);
      document.querySelector('#sandbox-test').contentWindow.postMessage({type:'__kodu_capture_request__',id:'3d-test'},'*');
    })`);
    assert(!capture.error,capture.error ?? 'La captura debe completarse');assert(capture.dataUrl?.startsWith('data:image/webp;base64,'));
    await writeFile('output/cell-3d/editor-capture.webp',Buffer.from(capture.dataUrl!.split(',')[1],'base64'));
    console.log('3D: captura del editor verificada');
  }
  const asset=await page.request.get(base+'/recursos/celula/modelo-v1.glb');
  assert.equal(asset.headers()['access-control-allow-origin'],'*');
  assert.equal((await page.request.get(base+'/recursos/celula/package.json')).status(),404);
  // Asset failure retains an illustrated activity with fully working controls.
  await page.route('**/recursos/celula/modelo-v1.glb',route=>route.abort());
  await page.goto(base+'/p/kodu-ejemplo-celula');
  await page.locator('[data-state="fallback"]').waitFor();
  assert(await page.locator('.model>img').isVisible());
  await page.locator('[data-id="mitocondria"]').click();
  assert.equal(await page.locator('#organelle-name').innerText(),'Mitocondria');
  await page.unroute('**/recursos/celula/modelo-v1.glb');
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:any,...args:any[]){
      if(String(type).includes('webgl'))return null;
      return original.apply(this,[type,...args] as any);
    } as typeof original;
  });
  await page.goto(base+'/p/kodu-ejemplo-celula');
  await page.locator('[data-state="fallback"]').waitFor();
  assert(await page.locator('.model>img').isVisible());
  assert.deepEqual(errors,[]);
  console.log('OK: píxeles 3D, giro, selección, zoom, teclado, reposo, móvil, CSP, sandbox del editor y fallback sin modelo/WebGL.');
} finally {await browser.close()}
