import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  makeCupGeometry,
  disposeGeometryParts,
  CUP_PROFILES,
} from "./cupGeometry.js";
import {
  CERAMIC_PRESETS,
  createCeramicMaps,
  disposeMaps,
} from "./ceramicTextures.js";

const stageEl = document.getElementById("stage");
const fpsEl = document.getElementById("fps");
const toastEl = document.getElementById("toast");

const state = {
  presetIndex: 0,
  model: {
    height: 86,
    diameter: 74,
    wallThickness: 4,
    bottomThickness: 5,
    layerHeight: 1.0,
    glazeDip: 0.68,
    quality: "medium",
    shapeKey: "mug",
    handle: true,
    showLayers: true,
  },
  spinning: true,
};

let currentGeometry = null;
let currentMaps = null;
let rebuildTimer = 0;

/* ---------------- renderer + scene ---------------- */

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
camera.position.set(132, 116, 244);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, state.model.height * 0.43, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.7;
controls.minDistance = 70;
controls.maxDistance = 560;
controls.maxPolarAngle = 1.5;
controls.update();

// PMREM studio environment gives the glaze its believable reflections.
const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = new RoomEnvironment();
const envTexture = pmrem.fromScene(roomEnv, 0.035).texture;
scene.environment = envTexture;
pmrem.dispose();

// Warm key light that casts the clay's soft contact shadow.
const keyLight = new THREE.DirectionalLight(0xfff0da, 2.6);
keyLight.position.set(180, 250, 150);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 10;
keyLight.shadow.camera.far = 700;
keyLight.shadow.camera.left = -180;
keyLight.shadow.camera.right = 180;
keyLight.shadow.camera.top = 180;
keyLight.shadow.camera.bottom = -180;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.radius = 6;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xbdd8ff, 0.85);
rimLight.position.set(-160, 80, -230);
scene.add(rimLight);

const fillLight = new THREE.HemisphereLight(0xfff2df, 0x6f6557, 0.45);
scene.add(fillLight);

const cupGroup = new THREE.Group();
scene.add(cupGroup);

/* ---------------- studio backdrop / plinth ---------------- */

function gradientTexture() {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#fbf7ef");
  grad.addColorStop(0.45, "#f2ebdf");
  grad.addColorStop(0.9, "#d6c9b6");
  grad.addColorStop(1, "#c8b9a4");
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

const shadowMat = new THREE.ShadowMaterial({ opacity: 0.34 });
const shadowPlane = new THREE.Mesh(
  new THREE.CircleGeometry(1800, 64).rotateX(-Math.PI / 2),
  shadowMat
);
shadowPlane.position.y = -0.05;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

const plinth = new THREE.Mesh(
  new THREE.CylinderGeometry(128, 132, 10, 96),
  new THREE.MeshPhysicalMaterial({
    color: 0xdbd3c7,
    roughness: 0.74,
    metalness: 0,
    clearcoat: 0.1,
    envMapIntensity: 0.35,
  })
);
plinth.position.y = -5;
plinth.receiveShadow = true;
scene.add(plinth);

/* ---------------- materials ---------------- */

function buildMaterials(maps) {
  const body = new THREE.MeshPhysicalMaterial({
    map: maps.body.color,
    roughnessMap: maps.body.phys,
    clearcoat: 1,
    clearcoatMap: maps.body.phys,
    clearcoatRoughness: 0.11,
    normalMap: maps.body.normal,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.92,
    side: THREE.FrontSide,
  });

  const inner = new THREE.MeshPhysicalMaterial({
    map: maps.inner.color,
    roughnessMap: maps.inner.phys,
    clearcoat: 1,
    clearcoatMap: maps.inner.phys,
    clearcoatRoughness: 0.13,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 1.05,
    side: THREE.FrontSide,
  });

  const handle = new THREE.MeshPhysicalMaterial({
    map: maps.handle.color,
    roughnessMap: maps.handle.phys,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 1.15,
    side: THREE.FrontSide,
  });

  return { body, inner, handle };
}

function clearCupGroup() {
  while (cupGroup.children.length) {
    const mesh = cupGroup.children[0];
    cupGroup.remove(mesh);
    if (mesh.material) {
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    }
  }
  if (currentGeometry) disposeGeometryParts(currentGeometry);
  if (currentMaps) disposeMaps(currentMaps);
  currentGeometry = null;
  currentMaps = null;
}

function rebuildCup(showToast = false) {
  if (showToast) toast("Building cup…");
  clearCupGroup();

  const preset = CERAMIC_PRESETS[state.presetIndex];
  const start = performance.now();
  currentGeometry = makeCupGeometry(state.model);
  currentMaps = createCeramicMaps(preset, state.model);
  const mats = buildMaterials(currentMaps);

  const { outer, inner, rim, bottom, floor, handle } = currentGeometry;
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
  add(inner, mats.inner);
  add(floor, mats.inner);
  add(handle, mats.handle);

  const done = performance.now() - start;
  console.info(`[render] geometry ${(currentGeometry.triCount / 1000).toFixed(0)}k tris · build ${done.toFixed(0)} ms`);
  if (showToast) {
    setTimeout(
      () => toast(`Ready · ${(currentGeometry.triCount / 1000).toFixed(0)}k triangles`),
      30
    );
  }
}

function scheduleRebuild(showToast = false) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => rebuildCup(showToast), showToast ? 0 : 150);
}

/* ---------------- UI ---------------- */

const presetWrap = document.getElementById("presets");
CERAMIC_PRESETS.forEach((p, i) => {
  const b = document.createElement("button");
  b.className = "swatch" + (i === 0 ? " active" : "");
  b.style.background = p.swatch;
  b.title = p.name;
  b.addEventListener("click", () => {
    state.presetIndex = i;
    document.querySelectorAll(".swatch").forEach((el, j) => el.classList.toggle("active", i === j));
    rebuildCup(true);
  });
  presetWrap.appendChild(b);
});

function bindRange(id, outId, key, format, rebuild = true) {
  const input = document.getElementById(id);
  const out = document.getElementById(outId);
  const render = () => {
    out.textContent = format(Number(input.value));
  };
  input.addEventListener("input", () => {
    state.model[key] = Number(input.value);
    render();
    if (rebuild) scheduleRebuild();
  });
  render();
}

bindRange("glaze", "glazeOut", "glazeDip", (v) => `${v}%`, true);
bindRange("layer", "layerOut", "layerHeight", (v) => `${v.toFixed(2)} mm`, true);
bindRange("height", "heightOut", "height", (v) => `${v} mm`, true);
bindRange("diameter", "diameterOut", "diameter", (v) => `${v} mm`, true);
bindRange("wall", "wallOut", "wallThickness", (v) => `${v.toFixed(1)} mm`, true);

// Slider uses percents; store fraction.
document.getElementById("glaze").addEventListener("input", (e) => {
  state.model.glazeDip = Number(e.target.value) / 100;
});

document.querySelectorAll("#qualitySeg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#qualitySeg button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.model.quality = btn.dataset.quality;
    rebuildCup(true);
  });
});

const spinBtn = document.getElementById("toggleSpin");
spinBtn.addEventListener("click", () => {
  state.spinning = !state.spinning;
  controls.autoRotate = state.spinning;
  spinBtn.textContent = state.spinning ? "Pause spin" : "Resume spin";
});

document.getElementById("resetView").addEventListener("click", () => {
  camera.position.set(132, 116, 244);
  controls.target.set(0, state.model.height * 0.43, 0);
  controls.update();
});

document.getElementById("snapshot").addEventListener("click", () => {
  toast("Rendering 4K snapshot…");
  const prevW = renderer.domElement.width;
  const prevH = renderer.domElement.height;
  renderer.setPixelRatio(1);
  renderer.setSize(3840, 2160, false);
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = "render-ceramic-cup.png";
  a.click();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(prevW / renderer.getPixelRatio(), prevH / renderer.getPixelRatio(), false);
  toast("Snapshot saved");
});

renderer.domElement.addEventListener("dblclick", () => {
  camera.position.set(132, 116, 244);
  controls.target.set(0, state.model.height * 0.43, 0);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}

/* ---------------- animation loop ---------------- */

let frames = 0;
let lastFpsTime = performance.now();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - lastFpsTime > 700) {
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - lastFpsTime))} fps`;
    frames = 0;
    lastFpsTime = now;
  }
});

// Initial build after one frame so the toast/layout is ready.
requestAnimationFrame(() => {
  rebuildCup();
});

// Debug hook used by automated QA only.
window.__renderDebug = {
  get triangles() {
    return currentGeometry?.triCount || 0;
  },
  get maps() {
    return !!currentMaps;
  },
  get state() {
    return state;
  },
  get rendererInfo() {
    return renderer.info.render;
  },
};
