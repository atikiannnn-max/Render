import * as THREE from "three";

/*
 * All maps are painted once at runtime onto canvases, so the repo ships no
 * binary assets and every glaze preset stays editable in code.
 */

export const CERAMIC_PRESETS = [
  {
    id: "cobalt",
    name: "Cobalt dip",
    clay: [230, 217, 197],
    glaze: [33, 65, 148],
    glazeLight: [72, 111, 206],
    swatch: "linear-gradient(180deg,#e7dcc8 0 30%, #214190 58% 100%)",
  },
  {
    id: "celadon",
    name: "Celadon",
    clay: [222, 211, 188],
    glaze: [124, 169, 147],
    glazeLight: [158, 199, 177],
    swatch: "linear-gradient(180deg,#ded3bd 0 30%, #7ca993 58% 100%)",
  },
  {
    id: "oxblood",
    name: "Oxblood",
    clay: [214, 200, 181],
    glaze: [105, 36, 28],
    glazeLight: [144, 67, 51],
    swatch: "linear-gradient(180deg,#d8c9b6 0 30%, #69241c 58% 100%)",
  },
  {
    id: "cream",
    name: "Cream",
    clay: [200, 158, 113],
    glaze: [238, 226, 198],
    glazeLight: [250, 242, 222],
    swatch: "linear-gradient(180deg,#c89e71 0 30%, #eee2c6 58% 100%)",
  },
  {
    id: "graphite",
    name: "Graphite",
    clay: [190, 180, 162],
    glaze: [43, 47, 53],
    glazeLight: [88, 94, 103],
    swatch: "linear-gradient(180deg,#beb4a2 0 30%, #2b2f35 58% 100%)",
  },
];

const DIMS = {
  low: [512, 320],
  medium: [1024, 512],
  high: [1536, 768],
};

const rand = (u, v, seed = 0) => {
  const s = Math.sin(u * 127.1 + v * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

const pnoise = (u, v, seed = 0) => {
  return (
    Math.sin(u * 6.2831 * 5 + seed) * 0.5 +
    Math.sin(u * 6.2831 * 13 + v * 2.1 + seed * 1.7) * 0.28 +
    Math.sin((u + v * 0.37) * 6.2831 * 29 + seed * 3.1) * 0.12 +
    Math.sin(v * 6.2831 * 2.3 + seed * 2.2) * 0.1
  );
};

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, srgb = false, repeatU = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = repeatU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function paint(w, h, fn) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const u = (px + 0.5) / w;
      // Canvas row 0 is its top. Three.js flips canvas textures by default,
      // so the top row is sampled at v = 1 (the top of the cup).
      const v = 1 - (py + 0.5) / h;
      const i = (py * w + px) * 4;
      const out = fn(u, v, px, py);
      d[i] = out[0];
      d[i + 1] = out[1];
      d[i + 2] = out[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function smoothEdge(x, a, b) {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
}

function outerCoverage(u, yMm, model) {
  const { height: H, glazeDip } = model;
  if (glazeDip <= 0.005) return 0;
  const foot = 4.2;
  if (yMm < foot) return 0;

  const lineMm = H * glazeDip;
  const wave =
    Math.sin(u * 6.2831 * 5 + Math.sin(u * 6.2831 * 13) * 1.4) * 0.012 +
    Math.sin(u * 6.2831 * 17 + 0.7) * 0.006;
  const edgeMm = lineMm + wave * H;
  if (yMm > edgeMm + 1.8) return 0;

  const fromFoot = smoothEdge(yMm, foot, foot + 4);
  const fromTop = 1 - smoothEdge(yMm, edgeMm - 4, edgeMm + 1.8);
  return Math.min(fromFoot, fromTop);
}

function glazeEdgeFactor(u, yMm, H, glazeDip) {
  if (glazeDip <= 0.005) return 0;
  const edge = H * glazeDip;
  const distance = Math.abs(yMm - edge);
  const pool = 1 - Math.min(1, Math.max(0, (distance - 0.8) / 3.2));
  const longWave = 0.6 + 0.4 * Math.sin(u * 6.2831 * 4 + 1.2);
  return pool * longWave;
}

function layerHeight01(yMm, model) {
  if (!model.showLayers || model.layerHeight <= 0) return 0;
  const phase = yMm / model.layerHeight - 0.5;
  const d = phase - Math.round(phase);
  return 0.5 + 0.5 * Math.cos(Math.PI * 2 * d);
}

function layerSlope(yMm, model) {
  if (!model.showLayers || model.layerHeight <= 0) return 0;
  const phase = yMm / model.layerHeight - 0.5;
  const d = phase - Math.round(phase);
  const amp = 0.052 + model.layerHeight * 0.062;
  return -(amp * Math.PI / model.layerHeight) * Math.sin(Math.PI * 2 * d);
}

function clayColorAt(u, v, preset, mix) {
  const c = preset.clay;
  const grain =
    pnoise(u, v, 11) * 0.055 +
    (rand(Math.floor(u * 37), Math.floor(v * 61), 5) - 0.5) * 0.1;
  const speck = (rand(Math.floor(u * 151), Math.floor(v * 97), 3) - 0.5);
  const darkSpeck = Math.abs(speck) > 0.493 ? (speck > 0 ? -0.25 : 0.18) : 0;
  let f = 1 + grain + darkSpeck * (Math.abs(speck) > 0.493 ? 1 : 0);
  f += (1 - mix) * 0.0;
  f = Math.min(1.16, Math.max(0.72, f));
  return [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
}

function glazeColorAt(u, v, preset, extra = 1) {
  const g = preset.glaze;
  const light = preset.glazeLight;
  const mottle = pnoise(u, v, 77) * 0.13;
  const flake = rand(Math.floor(u * 211), Math.floor(v * 173), 9);
  const thin = flake > 0.976 ? (flake > 0.988 ? 0.78 : 1.22) : 1;
  const blueShift = Math.sin((u * 7 + v * 4) * Math.PI * 2) * 0.04;
  const f = 1 + mottle + blueShift + (thin - 1) * 0.35;
  const mixLight = 0.5 + 0.5 * pnoise(u * 3.1, v * 2.7, 4);
  const r = g[0] * (1 - mixLight) + light[0] * mixLight;
  const gg = g[1] * (1 - mixLight) + light[1] * mixLight;
  const b = g[2] * (1 - mixLight) + light[2] * mixLight;
  const k = Math.min(1.22, Math.max(0.76, f * extra));
  return [clamp255(r * k), clamp255(gg * k), clamp255(b * k)];
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function buildBodyMaps(preset, model) {
  const [w, h] = DIMS[model.quality];
  const { height: H, glazeDip, layerHeight: LH } = model;

  const color = paint(w, h, (u, v) => {
    const y = v * H;
    const g = outerCoverage(u, y, model);
    const mix = g * g * (3 - 2 * g);
    let rgb;
    if (mix < 0.03) {
      rgb = clayColorAt(u, v, preset, 0);
    } else if (mix > 0.97) {
      rgb = glazeColorAt(u, v, preset);
    } else {
      const c = clayColorAt(u, v, preset, mix);
      const gl = glazeColorAt(u, v, preset);
      rgb = [c[0] * (1 - mix) + gl[0] * mix, c[1] * (1 - mix) + gl[1] * mix, c[2] * (1 - mix) + gl[2] * mix];
    }
    const edge = glazeEdgeFactor(u, y, H, glazeDip);
    if (edge > 0.01) {
      const k = 1 - edge * 0.18;
      rgb = [clamp255(rgb[0] * k), clamp255(rgb[1] * k), clamp255(rgb[2] * k)];
    }
    return rgb;
  });

  const phys = paint(w, h, (u, v) => {
    const y = v * H;
    const g = outerCoverage(u, y, model);
    const m = g * g * (3 - 2 * g);
    const raw = 0.93 + pnoise(u, v, 23) * 0.05 + rand(Math.floor(u * 113), Math.floor(v * 89), 2) * 0.025;
    const smooth = 0.14 + pnoise(u, v, 29) * 0.05 + (rand(Math.floor(u * 149), Math.floor(v * 127), 8) - 0.5) * 0.05;
    const val = raw * (1 - m) + smooth * m;
    return [clamp255(g * 255), clamp255(val * 255), 128];
  });

  const normal = paint(w, h, (u, v) => {
    const y = v * H;
    const g = outerCoverage(u, y, model);
    const rawWeight = 1;
    const glazedWeight = 0.72;
    const ampStrength = rawWeight * (1 - g) + glazedWeight * g;
    let nY = layerSlope(y, model) * ampStrength * 1.45;
    let nX =
      (pnoise(u, v, 43) * 0.16 +
        (rand(Math.floor(u * 199), Math.floor(v * 173), 6) - 0.5) * 0.15) *
      (0.35 + g * 0.65);
    // glaze drips read as soft vertical streaks on the smooth surface
    const drip = Math.max(0, Math.sin(u * 6.2831 * (9 + Math.floor(v * 20) % 2) + v * 4.5) - 0.83) * 6;
    nX += drip * g * 0.12;
    nX = Math.min(1, Math.max(-1, nX));
    nY = Math.min(1, Math.max(-1, nY));
    const z = Math.sqrt(Math.max(0.04, 1 - nX * nX - nY * nY));
    return [(nX * 0.5 + 0.5) * 255, (nY * 0.5 + 0.5) * 255, z * 255];
  });

  return {
    color: toTexture(color, true),
    phys: toTexture(phys),
    normal: toTexture(normal),
  };
}

function buildInnerMaps(preset, model) {
  const [w, h] = DIMS[model.quality];
  const { height: H, bottomThickness: B } = model;
  const rimRawMm = Math.max(2.4, H * 0.035);

  const color = paint(w, h, (u, v) => {
    const y = B + v * (H - B);
    if (y > H - rimRawMm * 0.55) {
      return clayColorAt(u, v, preset, 1);
    }
    const pooled = 1 - smoothEdge(v, 0, 0.12) * 0.68;
    const wallVary = 1 + pnoise(u, v, 55) * 0.03;
    const streak = Math.sin(u * 6.2831 * 8 + v * 31) * 0.025 + 1;
    return glazeColorAt(u, v, preset, pooled * wallVary * streak);
  });

  const phys = paint(w, h, (u, v) => {
    const y = B + v * (H - B);
    if (y > H - rimRawMm * 0.55) {
      return [0, 244, 128];
    }
    const val = 0.13 + pnoise(u, v, 61) * 0.045 + (rand(Math.floor(u * 127), Math.floor(v * 91), 7) - 0.5) * 0.04;
    return [255, clamp255(val * 255), 128];
  });

  return {
    color: toTexture(color, true),
    phys: toTexture(phys),
  };
}

function buildHandleMaps(preset, model) {
  const [w, h] = DIMS[model.quality];
  const color = paint(w, h, (u, v) => {
    const tickle =
      Math.sin(u * 6.2831 * 7) * 0.12 +
      Math.sin(v * 6.2831 * 3.2 + u * 9) * 0.08;
    const floor = 0.82 + 0.18 * Math.min(1, Math.max(0, 1 - v * 1.7));
    return glazeColorAt(u, v, preset, (1 + tickle * 0.2) * floor);
  });
  const phys = paint(w, h, (u, v) => {
    const val = 0.1 + pnoise(u, v, 71) * 0.04 + (rand(Math.floor(u * 89), Math.floor(v * 67), 11) - 0.5) * 0.05;
    return [255, clamp255(val * 255), 128];
  });
  return {
    color: toTexture(color, true),
    phys: toTexture(phys),
  };
}

export function createCeramicMaps(preset, model) {
  return {
    body: buildBodyMaps(preset, model),
    inner: buildInnerMaps(preset, model),
    handle: buildHandleMaps(preset, model),
  };
}

export function disposeMaps(maps) {
  if (!maps) return;
  for (const group of ["body", "inner", "handle"]) {
    for (const key of ["color", "phys", "normal"]) {
      const t = maps[group]?.[key];
      if (t) t.dispose();
    }
  }
}
