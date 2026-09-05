import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.25;
document.getElementById('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(22, innerWidth / innerHeight, 1, 4000);
camera.position.set(90, 91, 265);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 43, 0);
controls.enableDamping = true;
controls.minDistance = 145;
controls.maxDistance = 450;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.update();
let pending = false;
let frames = 0;
function invalidate() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    controls.update();
    renderer.render(scene, camera);
    frames++;
  });
}
controls.addEventListener('change', invalidate);

// One prefiltered studio environment; no realtime shadow-map passes.
const studio = new THREE.Scene();
studio.background = new THREE.Color(0x68635b);
const panels = [
  { p: [-4, 4, 4], w: 2.6, h: 6, power: 7 },
  { p: [4, 2, 3], w: 2, h: 4, power: 3 },
  { p: [1, 4, -4], w: 1.4, h: 5, power: 5 },
  { p: [0, 6, 0], w: 4, h: 3, power: 3 },
];
for (const cfg of panels) {
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(cfg.w, cfg.h),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(cfg.power), side: THREE.DoubleSide }));
  panel.position.set(...cfg.p);
  panel.lookAt(0, 0, 0);
  studio.add(panel);
}
const pmrem = new THREE.PMREMGenerator(renderer);
const environment = pmrem.fromScene(studio, 0.025);
scene.environment = environment.texture;
scene.environmentIntensity = 0.7;
pmrem.dispose();
studio.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
RectAreaLightUniformsLib.init();
for (const cfg of [
  { p: [-150, 180, 120], w: 150, h: 230, i: 4, c: 0xfff3df },
  { p: [180, 130, 160], w: 190, h: 240, i: 1.6, c: 0xe9efff },
  { p: [70, 180, -180], w: 110, h: 240, i: 3, c: 0xfff7e9 },
]) {
  const light = new THREE.RectAreaLight(cfg.c, cfg.i, cfg.w, cfg.h);
  light.position.set(...cfg.p);
  light.lookAt(0, 40, 0);
  scene.add(light);
}

function shadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(35,29,23,0.6)');
  g.addColorStop(0.3, 'rgba(35,29,23,0.36)');
  g.addColorStop(0.65, 'rgba(35,29,23,0.12)');
  g.addColorStop(1, 'rgba(35,29,23,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
const shadowMap = shadowTexture();
for (const [x,z,w,h,opacity] of [[0,0,87,87,0.8],[20,-9,175,115,0.45],[-26,12,160,100,0.24]]) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({
    map: shadowMap, transparent: true, opacity, depthWrite: false, toneMapped: false,
  }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x,-0.1,z); scene.add(mesh);
}

// Shared repeatable microrelief, independent from glaze normals.
const size = 256;
const grainData = new Uint8Array(size * size * 4);
let seed = 9137;
for (let i=0; i<size*size; i++) {
  seed = (1664525 * seed + 1013904223) >>> 0;
  const r = seed / 4294967296;
  const value = r < 0.035 ? 45 : 115 + r * 65;
  grainData.set([value,value,value,255],i*4);
}
const grain = new THREE.DataTexture(grainData,size,size);
grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
grain.repeat.set(9,3);
grain.magFilter = THREE.LinearFilter;
grain.minFilter = THREE.LinearMipmapLinearFilter;
grain.generateMipmaps = true; grain.needsUpdate = true;

let clayId = 'stone';
let root = null;
let triangles = 0;
const materials = [];
function setClay(id) {
  clayId = id;
  for (const {material, glazed} of materials) {
    material.color.set(id === 'stone' ? (glazed ? 0xb8a589 : 0xc7b598) : (glazed ? 0x343939 : 0x515350));
  }
  document.querySelectorAll('.clay-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.clay === id);
    b.setAttribute('aria-pressed', String(b.dataset.clay === id));
  });
  invalidate();
}
const draco = new DRACOLoader();
draco.setDecoderPath(new URL('draco/', location.href).href);
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
loader.load(new URL('models/cup-stone.glb', location.href).href, gltf => {
  root = gltf.scene;
  root.scale.setScalar(1000);
  const oldMaterials = new Set();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const old = mesh.material;
    oldMaterials.add(old);
    const outer = mesh.name === 'outer-wall';
    const glazed = ['inner-wall','interior-floor','rim-cap'].includes(mesh.name);
    // Preserve the actual relief mask embedded in the source asset.
    const mask = outer ? old.clearcoatMap : null;
    const mat = new THREE.MeshPhysicalMaterial({
      roughness: glazed ? 0.23 : 0.83,
      metalness: 0,
      clearcoat: glazed || mask ? 1 : 0,
      clearcoatMap: mask,
      clearcoatRoughness: 0.085,
      bumpMap: grain,
      bumpScale: glazed ? 0.000009 : 0.000065,
      envMapIntensity: 1,
    });
    if (outer && mask) {
      // Smooth the glaze response independently of the porous substrate.
      mat.roughnessMap = old.roughnessMap;
    }
    mesh.material = mat;
    materials.push({material:mat,glazed});
    const pos = mesh.geometry.attributes.position;
    if (outer || mesh.name === 'inner-wall') {
      // The checked-in GLB has a shallow sinusoidal bead; reshape it once.
      for (let i=0; i<pos.count; i++) {
        const x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i);
        const r=Math.hypot(x,z);
        const phase=y*1000;
        const ridge=0.5-0.5*Math.cos(phase*Math.PI*2);
        const relief=THREE.MathUtils.smoothstep(r,0.0372,0.03785);
        const delta=outer ? 0.00014*ridge*(1-relief)-0.000075*ridge*relief : 0.000045*ridge;
        if(r>0) pos.setXYZ(i,x*(r+delta)/r,y,z*(r+delta)/r);
      }
      pos.needsUpdate=true;
      mesh.geometry.computeVertexNormals();
    }
    triangles += mesh.geometry.index ? mesh.geometry.index.count/3 : pos.count/3;
  });
  for (const mat of oldMaterials) mat.dispose();
  scene.add(root);
  setClay(clayId);
  draco.dispose();
}, undefined, error => {
  console.error(error);
  document.querySelector('.hint').textContent='Не удалось загрузить модель — обновите страницу';
});
document.querySelectorAll('.clay-btn').forEach(b => b.addEventListener('click',()=>setClay(b.dataset.clay)));
renderer.domElement.addEventListener('dblclick',()=>{
  camera.position.set(90,91,265); controls.target.set(0,43,0); controls.update(); invalidate();
});
window.addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight); invalidate();
});
window.__renderDebug = {
  get loaded(){return !!root;}, get triangles(){return triangles;}, get clay(){return clayId;},
  get frames(){return frames;}, get rendererInfo(){return renderer.info.render;},
};
invalidate();
