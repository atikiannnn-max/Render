import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
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
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.9;
stageEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(22, window.innerWidth / window.innerHeight, 1, 4000);
camera.position.set(96, 80, 272);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 43, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 70;
controls.maxDistance = 560;
controls.maxPolarAngle = 1.52;
controls.update();

/*
 * Studio environment: large rectangular emissive softboxes are baked into a
 * PMREM map, so glaze reflections are long rectangles (like studio HDR),
 * not a generic room.
 */
function createStudioEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const roomMat = new THREE.MeshBasicMaterial({ color: 0x2c2b29, side: THREE.BackSide });
  const room = new THREE.Mesh(new THREE.BoxGeometry(18, 11, 18), roomMat);
  envScene.add(room);

  const panels = [
    { color: 0xffffff, w: 5.2, h: 3.8, pos: [-3.4, 3.4, 2.0] },
    { color: 0xffffff, w: 4.0, h: 2.6, pos: [3.4, 2.0, 3.6] },
    { color: 0xffffff, w: 6.5, h: 1.8, pos: [0, 5.1, 0.8] },
    { color: 0xffffff, w: 4.4, h: 2.8, pos: [0.6, 3.2, -4.5] },
  ];
  for (const p of panels) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(p.w, p.h),
      new THREE.MeshBasicMaterial({ color: p.color })
    );
    mesh.position.set(...p.pos);
    mesh.lookAt(0, 0.4, 0);
    envScene.add(mesh);
  }

  // Matte floor/walls keep panels as the only bright reflection shapes.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x3c3b38, side: THREE.DoubleSide })
  );
  floor.position.y = -5;
  envScene.add(floor);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.05).texture;
  pmrem.dispose();
  return tex;
}

scene.environment = createStudioEnvironment(renderer);
scene.environmentIntensity = 0.32;

/*
 * Studio lighting, not a single source:
 *  - very large key softbox above-left/front, roughly 3x the cup;
 *  - broad cool fill right/front, 25-40% of key;
 *  - weak overhead source for the rim/interior.
 *
 * Area lights cannot cast shadow maps in three.js. One low-intensity
 * directional "shadow carrier" follows the key softbox and produces the
 * geometric shadow. VSM shadow maps apply a real Gaussian blur to the shadow
 * depth buffer, which keeps the falloff diffuse instead of graphic.
 */
RectAreaLightUniformsLib.init();

const studioLights = [
  {
    color: 0xfff8ef,
    intensity: 2.8,
    width: 560,
    height: 420,
    position: [-300, 330, 170],
    label: "key-softbox",
  },
  {
    color: 0xf4f6f8,
    intensity: 0.8,
    width: 460,
    height: 320,
    position: [300, 190, 310],
    label: "fill-softbox",
  },
  {
    color: 0xffffff,
    intensity: 0.16,
    width: 700,
    height: 260,
    position: [0, 420, 80],
    label: "overhead-softbox",
  },
];

for (const cfg of studioLights) {
  const light = new THREE.RectAreaLight(cfg.color, cfg.intensity, cfg.width, cfg.height);
  light.position.set(...cfg.position);
  light.lookAt(0, 34, 0);
  light.name = cfg.label;
  scene.add(light);
}

const shadowCarrier = new THREE.DirectionalLight(0xfffaf2, 0.45);
shadowCarrier.position.set(-300, 330, 170);
shadowCarrier.castShadow = true;
shadowCarrier.shadow.mapSize.set(2048, 2048);
shadowCarrier.shadow.camera.near = 10;
shadowCarrier.shadow.camera.far = 900;
shadowCarrier.shadow.camera.left = -150;
shadowCarrier.shadow.camera.right = 150;
shadowCarrier.shadow.camera.top = 150;
shadowCarrier.shadow.camera.bottom = -150;
shadowCarrier.shadow.bias = -0.00008;
shadowCarrier.shadow.normalBias = 0.02;
shadowCarrier.shadow.radius = 16;
shadowCarrier.shadow.blurSamples = 24;
shadowCarrier.shadow.intensity = 1.15;
scene.add(shadowCarrier);

// A narrower, less blurred carrier from the same direction gives the natural
// "darker under the object, lighter farther away" gradient.
const contactCarrier = new THREE.DirectionalLight(0xfff8ee, 0.12);
contactCarrier.position.set(-300, 330, 170);
contactCarrier.castShadow = true;
contactCarrier.shadow.mapSize.set(2048, 2048);
contactCarrier.shadow.camera.near = 10;
contactCarrier.shadow.camera.far = 900;
contactCarrier.shadow.camera.left = -110;
contactCarrier.shadow.camera.right = 110;
contactCarrier.shadow.camera.top = 110;
contactCarrier.shadow.camera.bottom = -110;
contactCarrier.shadow.bias = -0.00008;
contactCarrier.shadow.normalBias = 0.02;
contactCarrier.shadow.radius = 2.2;
contactCarrier.shadow.blurSamples = 8;
contactCarrier.shadow.intensity = 1.6; // contact/AO ~60% darker
scene.add(contactCarrier);

// A second, very strongly blurred shadow layer adds broad diffuse falloff.
const broadShadow = new THREE.DirectionalLight(0xfffbf4, 0.07);
broadShadow.position.set(-300, 330, 170);
broadShadow.castShadow = true;
broadShadow.shadow.mapSize.set(1024, 1024);
broadShadow.shadow.camera.near = 10;
broadShadow.shadow.camera.far = 900;
broadShadow.shadow.camera.left = -240;
broadShadow.shadow.camera.right = 240;
broadShadow.shadow.camera.top = 240;
broadShadow.shadow.camera.bottom = -240;
broadShadow.shadow.bias = -0.00008;
broadShadow.shadow.normalBias = 0.02;
broadShadow.shadow.radius = 26;
broadShadow.shadow.blurSamples = 32;
broadShadow.shadow.intensity = 0.9;
scene.add(broadShadow);

const cupGroup = new THREE.Group();
cupGroup.scale.setScalar(1000); // GLB is metres; the studio works in millimetres.
scene.add(cupGroup);

/* ---------------- matte velvet paper floor ---------------- */
/*
 * The visible receiver is a soft, velvet-like paper disc: roughness 1, no
 * reflection, high sheen. It receives the blurred VSM shadow and slowly fades
 * into the CSS backdrop, so there is no hard floor edge or horizon.
 */

function velvetAlphaTexture() {
  const s = 1024;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgb(255,255,255)");
  g.addColorStop(0.55, "rgb(255,255,255)");
  g.addColorStop(0.8, "rgb(244,244,244)");
  g.addColorStop(1, "rgb(0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function velvetRoughnessTexture() {
  const s = 512;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(s, s);
  const hash = (x, y, seed) => {
    const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = x / s;
      const v = y / s;
      const fibre = hash(Math.floor(u * 190), Math.floor(v * 170), 3);
      const longFibre = Math.sin(y * 0.78 + Math.sin(u * 47.0) * 0.4) * 8;
      const blotch = Math.sin(u * 7.3 + v * 5.1) * 8;
      // Visible but still matte fibre drift: roughness channel around 0.6-0.95.
      const val = 205 + (fibre - 0.5) * 90 + longFibre + blotch;
      const i = (y * s + x) * 4;
      const c0 = Math.min(250, Math.max(130, val));
      img.data[i] = c0;
      img.data[i + 1] = c0;
      img.data[i + 2] = c0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const paperMat = new THREE.MeshPhysicalMaterial({
  color: 0x8d8b86,
  roughness: 1,
  metalness: 0,
  sheen: 1,
  sheenColor: 0x999690,
  sheenRoughness: 1,
  clearcoat: 0,
  envMapIntensity: 0,
  alphaMap: velvetAlphaTexture(),
  roughnessMap: velvetRoughnessTexture(),
  bumpMap: velvetRoughnessTexture(),
  bumpScale: 1.6,
  transparent: true,
});

const paperFloor = new THREE.Mesh(
  new THREE.CircleGeometry(1800, 96).rotateX(-Math.PI / 2),
  paperMat
);
paperFloor.position.y = -0.08;
paperFloor.receiveShadow = true;
scene.add(paperFloor);

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

function offsetAlongNormals(geometry, distance) {
  const g = geometry.clone();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.array[i * 3] += n.array[i * 3] * distance;
    p.array[i * 3 + 1] += n.array[i * 3 + 1] * distance;
    p.array[i * 3 + 2] += n.array[i * 3 + 2] * distance;
  }
  p.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

function offsetRadiallyInward(geometry, distance) {
  const g = geometry.clone();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.array[i * 3];
    const z = p.array[i * 3 + 2];
    const r = Math.hypot(x, z);
    if (r > 1e-8) {
      p.array[i * 3] -= (x / r) * distance;
      p.array[i * 3 + 2] -= (z / r) * distance;
    }
  }
  p.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

function offsetUpward(geometry, distance) {
  const g = geometry.clone();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.array[i * 3 + 1] += distance;
  p.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

function loadCup(clay) {
  disposeLoaded();
  const url = new URL(`models/cup-${clay}.glb`, window.location.href).href;
  loader.load(
    url,
    (gltf) => {
      const root = gltf.scene;
      const byName = {};
      let bodyMatSource = null;
      let coatTex = null;
      root.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.name) byName[child.name] = child;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            if (m.name?.startsWith("body-")) {
              bodyMatSource = m;
              coatTex = m.clearcoatMap || null;
            }
          }
          loadedTriangles += child.geometry.index
            ? child.geometry.index.count / 3
            : child.geometry.attributes.position.count / 3;
        }
      });

      const outer = byName["outer-wall"];
      const inner = byName["inner-wall"];
      const floor = byName["interior-floor"];
      const rim = byName["rim-cap"];

      if (bodyMatSource) {
        // Remove baked clearcoat: glaze now lives in a real thin shell.
        bodyMatSource.clearcoat = 0;
        bodyMatSource.clearcoatMap = null;

        const clayMatte = bodyMatSource.clone();
        clayMatte.clearcoat = 0;
        clayMatte.clearcoatMap = null;
        for (const m of [inner, floor]) {
          if (m) m.material = clayMatte;
        }

        // Clear glaze darkens the clay roughly 2x — it must not become black
        // on light clay. Tint is derived per clay variant.
        const GLASS_TINT =
          clay === "stone" ? new THREE.Color(0xa79f92) : new THREE.Color(0x3f4141);
        const glassMat = new THREE.MeshPhysicalMaterial({
          color: GLASS_TINT,
          transmission: 0.55,
          thickness: 0.00035,
          attenuationColor: GLASS_TINT.clone().multiplyScalar(1.15),
          attenuationDistance: 0.02,
          roughness: 0.16,
          ior: 1.45,
          clearcoat: 1,
          clearcoatRoughness: 0.14,
          envMapIntensity: 0.9,
          transparent: true,
          side: THREE.DoubleSide,
        });

        if (outer) {
          const shellMat = glassMat.clone();
          shellMat.alphaMap = coatTex || null;
          shellMat.alphaTest = 0.04;
          const shell = new THREE.Mesh(offsetAlongNormals(outer.geometry, 0.0003), shellMat);
          shell.name = "glaze-shell-outer";
          root.add(shell);
        }
        if (inner) {
          const shell = new THREE.Mesh(offsetRadiallyInward(inner.geometry, 0.0003), glassMat.clone());
          shell.name = "glaze-shell-inner";
          root.add(shell);
        }
        if (rim) {
          // The top edge of the cup is glazed too: a thin glass layer directly
          // above the rim annulus.
          const shell = new THREE.Mesh(offsetUpward(rim.geometry, 0.0003), glassMat.clone());
          shell.name = "glaze-shell-rim";
          root.add(shell);
        }
        if (floor) {
          // The interior floor should stay calmer: glaze covers it, but with
          // weaker clearcoat/environment response so it does not act as a mirror.
          const floorGlassMat = glassMat.clone();
          floorGlassMat.color = clay === "stone" ? new THREE.Color(0xa79f92) : new THREE.Color(0x3f4141);
          floorGlassMat.transmission = 0.42;
          floorGlassMat.roughness = 0.3;
          floorGlassMat.clearcoat = 0.4;
          floorGlassMat.clearcoatRoughness = 0.25;
          floorGlassMat.envMapIntensity = 0.2;
          const shell = new THREE.Mesh(offsetUpward(floor.geometry, 0.0003), floorGlassMat);
          shell.name = "glaze-shell-floor";
          root.add(shell);
        }
      }
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
  camera.position.set(96, 80, 272);
  controls.target.set(0, 43, 0);
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
