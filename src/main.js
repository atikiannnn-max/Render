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
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.9;
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
scene.environmentIntensity = 0.18;
pmrem.dispose();

/*
 * Studio lighting, not a single source:
 *  - very large key softbox above-left/front, roughly 3x the cup;
 *  - broad cool fill right/front, 25-40% of key;
 *  - weak top/back source only to separate the rim from the backdrop.
 * Area lights do not cast shadows in three.js, so one very soft, low-intensity
 * directional "shadow carrier" follows the key light position. It is a
 * technical shadow source, not a visible key.
 */
RectAreaLightUniformsLib.init();

const shadowCarrier = new THREE.DirectionalLight(0xfffbf4, 0.55);
shadowCarrier.position.set(-300, 330, 170);
shadowCarrier.castShadow = true;
shadowCarrier.shadow.mapSize.set(2048, 2048);
shadowCarrier.shadow.camera.near = 10;
shadowCarrier.shadow.camera.far = 800;
shadowCarrier.shadow.camera.left = -220;
shadowCarrier.shadow.camera.right = 220;
shadowCarrier.shadow.camera.top = 220;
shadowCarrier.shadow.camera.bottom = -220;
shadowCarrier.shadow.bias = -0.0002;
shadowCarrier.shadow.radius = 16;
scene.add(shadowCarrier);

const studioLights = [
  {
    color: 0xfff8ef,
    intensity: 3.0,
    width: 560,
    height: 420,
    position: [-300, 330, 170],
    label: "key-softbox",
  },
  {
    color: 0xf4f6f8,
    intensity: 0.95,
    width: 460,
    height: 320,
    position: [300, 190, 310],
    label: "fill-softbox",
  },
  {
    color: 0xffffff,
    intensity: 0.14,
    width: 700,
    height: 260,
    position: [0, 420, 80],
    label: "overhead-softbox",
  },
  {
    color: 0xffffff,
    intensity: 0.3,
    width: 500,
    height: 360,
    position: [60, 300, -350],
    label: "rim-softbox",
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

/* ---------------- seamless curved cyclorama ---------------- */

const cycloramaMat = new THREE.MeshStandardMaterial({
  color: 0x9b9894,
  roughness: 0.94,
  metalness: 0,
  vertexColors: true,
  envMapIntensity: 0.12,
});

function buildCyclorama() {
  // Cross-section (Y,Z): floor -> 90° fillet -> back wall, all one surface.
  const floorFront = 1600;
  const cornerStart = -1700;
  const wallZ = -2000;
  const filletR = 300;
  const wallTop = 1500;
  const halfWidth = 2100;
  const xSegs = 5;
  const pts = [];

  // Floor samples.
  const floorSegs = 36;
  for (let i = 0; i <= floorSegs; i++) {
    const t = i / floorSegs;
    pts.push([floorFront + (cornerStart - floorFront) * t, 0]);
  }
  // Fillet: quarter circle centred at (cornerStart, 0), ending at back wall.
  const filletSegs = 24;
  for (let i = 1; i <= filletSegs; i++) {
    const s = (i / filletSegs) * Math.PI * 0.5;
    pts.push([cornerStart - filletR * Math.sin(s), filletR * (1 - Math.cos(s))]);
  }
  // Back wall.
  const wallSegs = 26;
  for (let i = 1; i <= wallSegs; i++) {
    const t = i / wallSegs;
    pts.push([wallZ, filletR + (wallTop - filletR) * t]);
  }

  const positions = [];
  const colors = [];
  const index = [];
  // Lighting hits the horizontal floor harder than the back wall, so each
  // profile point gets a soft baked light-response factor. No separate
  // material or painted shadow: it is still one continuous cyclorama.
  const ptFactor = new Array(pts.length).fill(0.9);
  const floorCount = 1 + floorSegs;
  for (let i = 0; i < floorCount; i++) ptFactor[i] = 0.44 + 0.08 * (i / floorSegs);
  const wallStart = floorCount + filletSegs;
  for (let i = 1; i <= filletSegs; i++) {
    const t = i / filletSegs;
    ptFactor[floorCount + i - 1] = 0.52 + 0.3 * t;
  }
  for (let i = 0; i < wallSegs; i++) ptFactor[wallStart + i] = 0.94;
  for (let xi = 0; xi <= xSegs; xi++) {
    const x = -halfWidth + (2 * halfWidth * xi) / xSegs;
    for (let pi = 0; pi < pts.length; pi++) {
      positions.push(x, pts[pi][1], pts[pi][0]);
      const f = ptFactor[pi];
      colors.push(f, f, f);
    }
  }
  const stride = pts.length;
  for (let xi = 0; xi < xSegs; xi++) {
    for (let pi = 0; pi < stride - 1; pi++) {
      const a = xi * stride + pi;
      const b = (xi + 1) * stride + pi;
      const c = (xi + 1) * stride + pi + 1;
      const d = xi * stride + pi + 1;
      index.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, cycloramaMat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
}

buildCyclorama();

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
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            // The glazed interior must stay darker than the raw outer clay:
            // lower its diffuse response and mute the bright top-light/environment
            // reflections that otherwise blow out the cavity.
            if (m.name?.startsWith("glaze-")) {
              m.envMapIntensity = 0.22;
              m.clearcoat = 0.62;
              m.roughness = Math.max(m.roughness, 0.18);
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
  lookInside() {
    camera.position.set(0, 220, 120);
    controls.target.set(0, 70, 0);
    controls.update();
  },
};
