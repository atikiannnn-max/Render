import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

/*
 * Blender path: the cup and its materials are authored in Blender
 * (blender/build_cup.py) and exported to GLB + Draco. Three.js is only the
 * runtime viewer: it loads the asset, lights it and adds studio shadows.
 */

const stageEl = document.getElementById("stage");
let clayId = "stone";
let loadedObject = null;
let loadedTriangles = 0;

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
controls.target.set(0, 36, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 70;
controls.maxDistance = 560;
controls.maxPolarAngle = 1.52;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
scene.environment = envTexture;
scene.environmentIntensity = 0.8;
pmrem.dispose();

/*
 * Studio lighting, not a single source:
 *  - four large softbox area lights around the product;
 *  - warm/cool separation so surfaces don't go flat;
 *  - one low-intensity directional only to keep a very soft shadow shape.
 */
RectAreaLightUniformsLib.init();

const keyLight = new THREE.DirectionalLight(0xfff2e2, 0.85);
keyLight.position.set(-260, 240, -210);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 10;
keyLight.shadow.camera.far = 700;
keyLight.shadow.camera.left = -180;
keyLight.shadow.camera.right = 180;
keyLight.shadow.camera.top = 180;
keyLight.shadow.camera.bottom = -180;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.radius = 9;
scene.add(keyLight);

const studioLights = [
  {
    color: 0xffedd6,
    intensity: 4.2,
    width: 420,
    height: 300,
    position: [-360, 300, -260],
    label: "key-softbox",
  },
  {
    color: 0xe8f2ff,
    intensity: 2.2,
    width: 360,
    height: 250,
    position: [340, 210, 330],
    label: "fill-softbox",
  },
  {
    color: 0xfff6e8,
    intensity: 1.6,
    width: 520,
    height: 180,
    position: [0, 430, 0],
    label: "overhead-softbox",
  },
  {
    color: 0xe4ecff,
    intensity: 2.6,
    width: 360,
    height: 300,
    position: [70, 300, -380],
    label: "rim-softbox",
  },
  {
    color: 0xfff4e4,
    intensity: 0.9,
    width: 280,
    height: 200,
    position: [-300, 120, 300],
    label: "bounce",
  },
];

for (const cfg of studioLights) {
  const light = new THREE.RectAreaLight(cfg.color, cfg.intensity, cfg.width, cfg.height);
  light.position.set(...cfg.position);
  light.lookAt(0, 34, 0);
  light.name = cfg.label;
  scene.add(light);
}

const fillLight = new THREE.HemisphereLight(0xf5ead8, 0x4f4840, 0.55);
scene.add(fillLight);

const cupGroup = new THREE.Group();
cupGroup.scale.setScalar(1000); // GLB is metres; the studio works in millimetres.
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
  new THREE.MeshBasicMaterial({ map: gradientTexture(), side: THREE.BackSide, depthWrite: false })
);
backdrop.position.y = 680;
backdrop.frustumCulled = false;
scene.add(backdrop);

const studioFloor = new THREE.Mesh(
  new THREE.CircleGeometry(2200, 96).rotateX(-Math.PI / 2),
  new THREE.MeshPhysicalMaterial({
    color: 0xe6dccc,
    roughness: 0.62,
    metalness: 0,
    clearcoat: 0.08,
    envMapIntensity: 0.4,
  })
);
studioFloor.position.y = -0.12;
studioFloor.receiveShadow = true;
scene.add(studioFloor);

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

function addShadowBlob(x, z, sx, sz, opacity) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: softShadowTexture(),
      transparent: true,
      opacity,
      depthWrite: false,
    })
  );
  mesh.position.set(x, -0.04, z);
  mesh.scale.set(sx, sz, 1);
  mesh.renderOrder = 1;
  scene.add(mesh);
}

addShadowBlob(0, 0, 92, 92, 0.4);
addShadowBlob(30, 19, 125, 92, 0.24);
addShadowBlob(-36, -10, 175, 120, 0.14);

/* ---------------- GLB loading ---------------- */

const draco = new DRACOLoader();
draco.setDecoderPath(new URL("draco/", window.location.href).href);
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

function disposeLoaded() {
  if (loadedObject) {
    loadedObject.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose();
        for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
          m?.dispose?.();
        }
      }
    });
    cupGroup.remove(loadedObject);
    loadedObject = null;
  }
  loadedTriangles = 0;
}

function loadCup(clay) {
  disposeLoaded();
  const url = new URL(`models/cup-${clay}.glb`, window.location.href).href;
  loader.load(
    url,
    (gltf) => {
      const root = gltf.scene;
      root.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (clay === "stone") {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of materials) {
              // Keep the light clay readable against the light studio backdrop.
              m.color?.multiplyScalar(0.76);
            }
          }
          loadedTriangles += child.geometry.index
            ? child.geometry.index.count / 3
            : child.geometry.attributes.position.count / 3;
        }
      });
      loadedObject = root;
      cupGroup.add(root);
      console.info(`[render] Blender GLB ${clay} · ${Math.round(loadedTriangles / 1000)}k tris`);
    },
    undefined,
    (err) => console.error("[render] GLB load failed", err)
  );
}

/* ---------------- clay picker ---------------- */

document.querySelectorAll(".clay-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.clay === clayId) return;
    clayId = btn.dataset.clay;
    document.querySelectorAll(".clay-btn").forEach((b) => b.classList.toggle("active", b === btn));
    loadCup(clayId);
  });
});

renderer.domElement.addEventListener("dblclick", () => {
  camera.position.set(118, 116, 246);
  controls.target.set(0, 36, 0);
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

requestAnimationFrame(() => loadCup(clayId));

// Debug hook used by automated QA only.
window.__renderDebug = {
  get loaded() {
    return !!loadedObject;
  },
  get triangles() {
    return Math.round(loadedTriangles);
  },
  get clay() {
    return clayId;
  },
  get bbox() {
    if (!loadedObject) return null;
    const box = new THREE.Box3().setFromObject(cupGroup);
    return {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    };
  },
  get materials() {
    const out = [];
    loadedObject?.traverse?.((child) => {
      if (!child.isMesh) return;
      for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
        out.push({
          name: m.name,
          color: m.color ? `#${m.color.getHexString()}` : null,
          map: !!m.map,
          roughness: m.roughness,
          clearcoat: m.clearcoat,
        });
      }
    });
    return out;
  },
  get screenProjection() {
    if (!loadedObject) return null;
    const box = new THREE.Box3().setFromObject(cupGroup);
    const c = box.getCenter(new THREE.Vector3());
    const v = c.clone();
    const clipped = v.project(camera);
    return {
      center: [v.x, v.y, v.z],
      clipped: [clipped.x, clipped.y, clipped.z],
    };
  },
  get rendererInfo() {
    return renderer.info.render;
  },
};
