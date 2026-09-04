import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { makeCupGeometry, disposeGeometryParts } from "./cupGeometry.js";
import { createCeramicMaps, disposeMaps, getClay } from "./ceramicTextures.js";

const stageEl = document.getElementById("stage");

// Everything except the clay is deliberately fixed for now.
const MODEL = {
  height: 86,
  diameter: 74,
  wallThickness: 4,
  bottomThickness: 5,
  layerHeight: 1.0,
  quality: "medium",
  shapeKey: "mug",
  handle: true,
  showLayers: true,
};

let clayId = "stone";
let currentGeometry = null;
let currentMaps = null;

/* ---------------- renderer / camera ---------------- */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
stageEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 1, 4000);
camera.position.set(118, 116, 246);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, MODEL.height * 0.43, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 70;
controls.maxDistance = 560;
controls.maxPolarAngle = 1.52;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
scene.environment = envTexture;
pmrem.dispose();

/*
 * Shadows:
 *  - one real PCF-soft shadow from the key light;
 *  - several layered radial-gradient shadows under the cup. The gradients are
 *    much blurrier than the shadow map, which gives the "several soft shadows"
 *    studio look from the reference.
 */
const keyLight = new THREE.DirectionalLight(0xfff0da, 2.5);
keyLight.position.set(-185, 250, -165);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 10;
keyLight.shadow.camera.far = 700;
keyLight.shadow.camera.left = -180;
keyLight.shadow.camera.right = 180;
keyLight.shadow.camera.top = 180;
keyLight.shadow.camera.bottom = -180;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.radius = 7;
scene.add(keyLight);

const frontRim = new THREE.DirectionalLight(0xcfe2ff, 0.9);
frontRim.position.set(175, 90, 240);
scene.add(frontRim);

const fillLight = new THREE.HemisphereLight(0xfff2df, 0x6f6557, 0.5);
scene.add(fillLight);

const cupGroup = new THREE.Group();
scene.add(cupGroup);

/* ---------------- studio backdrop ---------------- */

function gradientTexture() {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#fcf7ef");
  grad.addColorStop(0.45, "#f1e9dc");
  grad.addColorStop(0.9, "#d3c6b2");
  grad.addColorStop(1, "#c5b59f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const backdrop = new THREE.Mesh(
  new THREE.CylinderGeometry(1500, 1500, 2600, 48, 1, true),
  new THREE.MeshBasicMaterial({
    map: gradientTexture(),
    side: THREE.BackSide,
    depthWrite: false,
  })
);
backdrop.position.y = 680;
backdrop.frustumCulled = false;
scene.add(backdrop);

const shadowPlane = new THREE.Mesh(
  new THREE.CircleGeometry(1800, 64).rotateX(-Math.PI / 2),
  new THREE.ShadowMaterial({ opacity: 0.3 })
);
shadowPlane.position.y = -0.12;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

function softShadowTexture() {
  const s = 512;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(0,0,0,0.92)");
  grad.addColorStop(0.32, "rgba(0,0,0,0.52)");
  grad.addColorStop(0.68, "rgba(0,0,0,0.16)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

function addShadowBlob(x, z, sx, sz, opacity, scale = 1) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: softShadowTexture(),
      transparent: true,
      opacity,
      depthWrite: false,
    })
  );
  mesh.position.set(x * scale, -0.04, z * scale);
  mesh.scale.set(sx * scale, sz * scale, 1);
  mesh.renderOrder = 1;
  scene.add(mesh);
}

// Contact shadow + two wider offset shadows = the layered soft look.
addShadowBlob(0, 0, 92, 92, 0.4);
addShadowBlob(30, 19, 125, 92, 0.24);
addShadowBlob(-36, -10, 175, 120, 0.14);

/* ---------------- materials ---------------- */

function buildMaterials(maps) {
  const body = new THREE.MeshPhysicalMaterial({
    map: maps.body.color,
    roughnessMap: maps.body.phys,
    clearcoat: 1,
    clearcoatMap: maps.body.phys,
    clearcoatRoughness: 0.1,
    normalMap: maps.body.normal,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.95,
  });

  const glazed = new THREE.MeshPhysicalMaterial({
    map: maps.inner.color,
    roughnessMap: maps.inner.phys,
    clearcoat: 1,
    clearcoatMap: maps.inner.phys,
    clearcoatRoughness: 0.12,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 1.15,
  });

  const handle = new THREE.MeshPhysicalMaterial({
    map: maps.handle.color,
    roughnessMap: maps.handle.phys,
    clearcoat: 1,
    clearcoatMap: maps.handle.phys,
    clearcoatRoughness: 0.1,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 1.2,
  });

  return { body, glazed, handle };
}

function clearCupGroup() {
  while (cupGroup.children.length) {
    const mesh = cupGroup.children[0];
    cupGroup.remove(mesh);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
  }
  if (currentGeometry) disposeGeometryParts(currentGeometry);
  if (currentMaps) disposeMaps(currentMaps);
  currentGeometry = null;
  currentMaps = null;
}

function rebuildCup() {
  clearCupGroup();
  const clay = getClay(clayId);
  const start = performance.now();
  currentGeometry = makeCupGeometry(MODEL);
  currentMaps = createCeramicMaps(clay, MODEL);
  const mats = buildMaterials(currentMaps);

  const { outer, rim, bottom, inner, floor, handle } = currentGeometry;
  const add = (geo, mat, cast = true) => {
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    cupGroup.add(mesh);
  };

  add(outer, mats.body);
  add(rim, mats.body);
  add(bottom, mats.body);
  add(inner, mats.glazed);
  add(floor, mats.glazed);
  add(handle, mats.handle);
  console.info(`[render] ${(currentGeometry.triCount / 1000).toFixed(0)}k tris · ${(performance.now() - start).toFixed(0)} ms`);
}

/* ---------------- clay picker ---------------- */

document.querySelectorAll(".clay-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.clay === clayId) return;
    clayId = btn.dataset.clay;
    document.querySelectorAll(".clay-btn").forEach((b) => b.classList.toggle("active", b === btn));
    rebuildCup();
  });
});

renderer.domElement.addEventListener("dblclick", () => {
  camera.position.set(118, 116, 246);
  controls.target.set(0, MODEL.height * 0.43, 0);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

requestAnimationFrame(rebuildCup);

// Debug hook used by automated QA only.
window.__renderDebug = {
  get triangles() {
    return currentGeometry?.triCount || 0;
  },
  get maps() {
    return !!currentMaps;
  },
  get clay() {
    return clayId;
  },
  get rendererInfo() {
    return renderer.info.render;
  },
};
