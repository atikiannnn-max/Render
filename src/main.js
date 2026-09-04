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
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.09;
stageEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(24, window.innerWidth / window.innerHeight, 1, 4000);
camera.position.set(112, 76, 282);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 40, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 70;
controls.maxDistance = 560;
controls.maxPolarAngle = 1.52;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
scene.environment = envTexture;
scene.environmentIntensity = 0.42;
pmrem.dispose();

/*
 * Studio lighting, not a single source:
 *  - very large key softbox above-left/front, roughly 3x the cup;
 *  - broad cool fill right/front, 25-40% of key;
 *  - weak top/back source only to separate the rim from the backdrop.
 * No directional/point/sun lights. Shadows come from wide radial gradients.
 */
RectAreaLightUniformsLib.init();

const studioLights = [
  {
    color: 0xffedd6,
    intensity: 3.1,
    width: 520,
    height: 380,
    position: [-300, 330, 170],
    label: "key-softbox",
  },
  {
    color: 0xe8f2ff,
    intensity: 0.55,
    width: 440,
    height: 300,
    position: [300, 190, 310],
    label: "fill-softbox",
  },
  {
    color: 0xfff6e8,
    intensity: 0.55,
    width: 600,
    height: 220,
    position: [0, 420, 80],
    label: "overhead-softbox",
  },
  {
    color: 0xe4ecff,
    intensity: 0.7,
    width: 460,
    height: 340,
    position: [60, 300, -350],
    label: "rim-softbox",
  },
  {
    color: 0xfff4e4,
    intensity: 0.25,
    width: 280,
    height: 200,
    position: [-280, 110, -220],
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
  grad.addColorStop(0, "#7e7c78");
  grad.addColorStop(0.45, "#7b7975");
  grad.addColorStop(0.9, "#6c6a66");
  grad.addColorStop(1, "#615f5c");
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
    color: 0x5d5b57,
    roughness: 0.92,
    metalness: 0,
    clearcoat: 0,
    envMapIntensity: 0.08,
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
  mesh.position.set(x, -0.1, z);
  mesh.scale.set(sx, sz, 1);
  mesh.renderOrder = 1;
  scene.add(mesh);
}

addShadowBlob(0, 0, 145, 145, 0.5);
addShadowBlob(72, 34, 220, 155, 0.3);
addShadowBlob(-90, -40, 290, 190, 0.2);

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
  camera.position.set(112, 76, 282);
  controls.target.set(0, 40, 0);
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
