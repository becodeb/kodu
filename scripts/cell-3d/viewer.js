import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

// A classic, self-contained bundle: works inside opaque sandboxed srcdoc too.
const host = document.querySelector('[data-cell-viewer]');
if (host) start().catch(fallback);
let renderer, model, controls, environment, observer, resizeObserver, composer, ao;
let raf = 0, disposed = false, failed = false;
const listeners = [];
function listen(target, type, fn, options) {
  target.addEventListener(type, fn, options);
  listeners.push(() => target.removeEventListener(type, fn, options));
}
function fallback(error) {
  if (!host || disposed) return;
  failed = true;
  observer?.disconnect(); resizeObserver?.disconnect(); controls?.dispose();
  listeners.forEach(remove=>remove());
  host.dataset.state = 'fallback';
  host.classList.remove('is-3d');
  host.querySelectorAll('.hotspot').forEach(button => {
    button.style.removeProperty('left'); button.style.removeProperty('top');
    button.style.removeProperty('visibility');
  });
  document.getElementById('render-status').textContent = 'Vista ilustrada · podés seguir explorando';
  document.getElementById('scene-controls').hidden = true;
  if (renderer) { renderer.domElement.remove(); renderer.dispose(); }
  ao?.dispose(); composer?.dispose(); environment?.dispose();
  model?.traverse(object=>{if(object.isMesh){object.geometry.dispose();object.material.dispose()}});
  cancelAnimationFrame(raf);
  console.warn('El modelo 3D no está disponible; se conserva la actividad.', error?.message ?? error);
}
async function start() {
  const status = document.getElementById('render-status');
  const buttons = [...host.querySelectorAll('.hotspot')];
  const mobile = matchMedia('(max-width: 640px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // Retain the last frame for Kodu's gallery/export screenshot bridge.
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile.matches ? 1.35 : 1.75));
  renderer.setClearColor(0xf4f1fc, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .88;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Célula animal en 3D. Arrastrá para girar; usá los controles para acercar.');
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.tabIndex = 0;
  renderer.domElement.className = 'cell-canvas';
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(37, 1, .1, 60);
  const homePosition = new THREE.Vector3(.15, 7.6, 7.2);
  const homeTarget = new THREE.Vector3(0, -.1, 0);
  camera.position.copy(homePosition);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(homeTarget);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = .085;
  controls.minDistance = 6;
  controls.maxDistance = 13;
  controls.minPolarAngle = .24;
  controls.maxPolarAngle = 1.20;
  controls.minAzimuthAngle = -1.2;
  controls.maxAzimuthAngle = 1.2;
  controls.rotateSpeed = .65;
  controls.enableZoom = false; // The wheel must continue scrolling the landing.
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  environment = pmrem.fromScene(room, .055);
  scene.environment = environment.texture;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xf1efff, 0x82629f, .55));
  const key = new THREE.DirectionalLight(0xfff5e9, 2.1);
  key.position.set(-4,8,5); scene.add(key);
  key.castShadow = true;
  key.shadow.mapSize.set(1024,1024);
  Object.assign(key.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.5,far:20});
  key.shadow.normalBias = .06;
  key.shadow.bias = -.0003;
  const rim = new THREE.DirectionalLight(0xdedaff, 1.2);
  rim.position.set(4,3,-4); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xb3d5ff, .35);
  fill.position.set(-4,1,-2); scene.add(fill);

  const response = await fetch(new URL(host.dataset.model, document.baseURI), { credentials: 'omit' });
  if (!response.ok) throw new Error('Modelo: HTTP ' + response.status);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  if (disposed) return;
  model = gltf.scene; scene.add(model);
  const anchors = new Map();
  const meshes = [];
  const originals = new Map();
  model.traverse(object => {
    if (object.userData.anchor) anchors.set(object.userData.anchor, object);
    if (!object.isMesh) return;
    meshes.push(object);
    object.material = object.material.clone();
    object.material.envMapIntensity = .32;
    object.material.roughness = Math.max(.34,object.material.roughness);
    if('clearcoat' in object.material) object.material.clearcoat *= .5;
    object.material.side = THREE.DoubleSide;
    object.castShadow = true; object.receiveShadow = true;
    originals.set(object, object.material.emissive.clone());
  });
  const target = new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:mobile.matches ? 2 : 4});
  composer = new EffectComposer(renderer,target);
  ao = new SSAOPass(scene,camera,512,512,16);
  ao.kernelRadius = .28;
  ao.minDistance = .002;
  ao.maxDistance = .18;
  composer.addPass(new RenderPass(scene,camera));
  composer.addPass(ao);
  composer.addPass(new OutputPass());

  let dirty = true, inView = true, holding = false, drawing = false, activeIds = ['nucleo'];
  let lastInput = performance.now(), introStart = performance.now();
  let tween = null, showLabels = true;
  let intro = !reduced.matches;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const labelPoint = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  let pointerDown;
  function requestFrame() {
    dirty = true;
    if (!raf && !drawing && inView && !document.hidden && !disposed && !failed) raf = requestAnimationFrame(draw);
  }
  function renderLabels() {
    const { width, height } = host.getBoundingClientRect();
    const occupied=[];
    for (const button of [...buttons].sort((a,b)=>Number(activeIds.includes(b.dataset.id))-Number(activeIds.includes(a.dataset.id)))) {
      const anchor = anchors.get(button.dataset.id);
      if (!anchor) continue;
      anchor.getWorldPosition(worldPoint);
      labelPoint.copy(worldPoint).project(camera);
      cameraDirection.copy(worldPoint).sub(camera.position).normalize();
      raycaster.set(camera.position, cameraDirection);
      const hits = raycaster.intersectObjects(meshes, false);
      const distance = worldPoint.distanceTo(camera.position);
      const blocked = hits.some(hit => hit.distance < distance - .22 && hit.object.userData.organelle !== button.dataset.id);
      const visible=showLabels && !blocked && Math.abs(labelPoint.x)<=.96 && Math.abs(labelPoint.y)<=.96;
      button.style.visibility = visible ? 'visible' : 'hidden';
      const x = Math.max(button.offsetWidth/2+4, Math.min(width-button.offsetWidth/2-4,(labelPoint.x*.5+.5)*width));
      const initialY = Math.max(20,Math.min(height-20,(-labelPoint.y*.5+.5)*height));
      let y=initialY;
      if(visible){
        const w=button.offsetWidth,h=button.offsetHeight;
        for(const offset of [0,-h-6,h+6,-2*h-12,2*h+12]){
          const candidate=Math.max(h/2+4,Math.min(height-h/2-4,initialY+offset));
          if(!occupied.some(rect=>Math.abs(x-rect.x)<(w+rect.w)/2+4 && Math.abs(candidate-rect.y)<(h+rect.h)/2+4)){y=candidate;break}
        }
        occupied.push({x,y,w,h});
      }
      button.style.left = x+'px'; button.style.top = y+'px';
    }
  }
  function draw(now) {
    raf = 0;
    if(disposed || failed || !inView || document.hidden) return;
    drawing = true;
    if (intro) {
      const t = Math.min((now-introStart)/2400,1);
      camera.position.x = homePosition.x + Math.sin(t*Math.PI)*.65;
      if (t===1) intro = false;
      dirty = true;
    }
    if (tween) {
      const t = reduced.matches ? 1 : Math.min((now-tween.started)/700,1);
      const ease = t*t*(3-2*t);
      controls.target.lerpVectors(tween.fromTarget,tween.toTarget,ease);
      camera.position.lerpVectors(tween.fromPosition,tween.toPosition,ease);
      dirty = true;
      if(t===1)tween=null;
    }
    controls.update();
    if(dirty || holding) {
      composer.render();
      renderLabels();
      host.dataset.frames=String(Number(host.dataset.frames??0)+1);
      dirty=false;
    }
    drawing = false;
    if(intro || tween || holding || now-lastInput<650) raf=requestAnimationFrame(draw);
  }
  function moveTo(target, position) {
    intro=false;
    tween={fromTarget:controls.target.clone(),toTarget:target.clone(),fromPosition:camera.position.clone(),toPosition:position.clone(),started:performance.now()};
    requestFrame();
  }
  function home() { moveTo(homeTarget,homePosition); }
  function highlight(ids, focus=false) {
    activeIds=ids;
    for(const mesh of meshes){
      mesh.material.emissive.copy(originals.get(mesh));
      if(ids.includes(mesh.userData.organelle)) mesh.material.emissive.setHex(0x201131);
      mesh.material.emissiveIntensity=.18;
    }
    if(focus && ids.length===1 && anchors.has(ids[0])){
      const point=anchors.get(ids[0]).getWorldPosition(new THREE.Vector3());
      const target=point.clone().multiplyScalar(.55).add(homeTarget.clone().multiplyScalar(.45));
      const direction=camera.position.clone().sub(controls.target).normalize();
      moveTo(target,target.clone().add(direction.multiplyScalar(8.2)));
    }
    requestFrame();
  }
  listen(controls,'change',requestFrame);
  listen(controls,'start',()=>{holding=true;intro=false;tween=null;lastInput=performance.now();requestFrame()});
  listen(controls,'end',()=>{holding=false;lastInput=performance.now();requestFrame()});
  listen(renderer.domElement,'pointerdown',e=>{pointerDown={x:e.clientX,y:e.clientY}});
  listen(renderer.domElement,'pointerup',e=>{
    if(!pointerDown || Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>6)return;
    const rect=renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects(meshes,false)[0];
    if(hit?.object.userData.organelle) window.dispatchEvent(new CustomEvent('kodu-cell-pick',{detail:{id:hit.object.userData.organelle}}));
  });
  listen(renderer.domElement,'pointercancel',()=>{pointerDown=null;holding=false;lastInput=performance.now();requestFrame()});
  listen(window,'kodu-cell-highlight',event=>highlight(event.detail.ids,event.detail.focus));
  listen(document.getElementById('reset-view'),'click',home);
  function zoom(factor){
    const offset=camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));
    moveTo(controls.target,controls.target.clone().add(offset));
  }
  listen(document.getElementById('zoom-in'),'click',()=>zoom(.85));
  listen(document.getElementById('zoom-out'),'click',()=>zoom(1.17));
  listen(document.getElementById('toggle-labels'),'click',event=>{
    showLabels=!showLabels;event.currentTarget.setAttribute('aria-pressed',String(showLabels));requestFrame();
  });
  listen(renderer.domElement,'keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(event.key))return;
    event.preventDefault();intro=false;tween=null;
    if(event.key==='Home'){home();return}
    if(event.key==='+'||event.key==='-'){zoom(event.key==='+'?.85:1.17);return}
    const spherical=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    if(event.key==='ArrowLeft')spherical.theta-=.12;
    if(event.key==='ArrowRight')spherical.theta+=.12;
    if(event.key==='ArrowUp')spherical.phi-=.10;
    if(event.key==='ArrowDown')spherical.phi+=.10;
    spherical.phi=THREE.MathUtils.clamp(spherical.phi,controls.minPolarAngle,controls.maxPolarAngle);
    spherical.theta=THREE.MathUtils.clamp(spherical.theta,controls.minAzimuthAngle,controls.maxAzimuthAngle);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));requestFrame();
  });
  listen(reduced,'change',()=>{if(reduced.matches)intro=false;requestFrame()});
  listen(document,'visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0}else{lastInput=performance.now();requestFrame()}});
  observer=new IntersectionObserver(entries=>{
    inView=entries[0].isIntersecting;
    if(inView) requestFrame();else{cancelAnimationFrame(raf);raf=0}
  },{rootMargin:'80px'});
  observer.observe(host);
  resizeObserver=new ResizeObserver(()=>{
    const {width,height}=host.getBoundingClientRect();
    if(!width||!height)return;
    camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height,false);composer.setSize(width,height);requestFrame();
  });
  resizeObserver.observe(host);
  listen(renderer.domElement,'webglcontextlost',event=>{event.preventDefault();fallback(new Error('Contexto gráfico interrumpido'))});
  listen(window,'pagehide',event=>{
    if(event.persisted)return;
    disposed=true;cancelAnimationFrame(raf);observer.disconnect();resizeObserver.disconnect();controls.dispose();
    for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose()}
    ao.dispose();composer.dispose();environment.dispose();renderer.dispose();listeners.forEach(remove=>remove());
  });
  document.getElementById('scene-controls').hidden=false;
  host.classList.add('is-3d');host.dataset.state='ready';
  status.textContent='3D interactivo · arrastrá para girar';
  highlight(activeIds);
  requestFrame();
}
