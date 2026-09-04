import * as THREE from "three";
import { profileRadiusAt, CUP_PROFILES } from "./cupGeometry.js";
import { MEDALLION, medallionCoverage } from "./medallion.js";

/*
 * Only two clays right now: clean grey-beige and asphalt.
 *
 * The glaze is transparent and glossy: it does not paint a colour over the
 * clay. Instead glazed clay is rendered roughly 30% darker and more saturated,
 * which is how the material behaves when it is wet under a clear glassy coat.
 */

export const CLAYS = [
  {
    id: "stone",
    name: "Серо-бежевая глина",
    rgb: [198, 188, 168],
  },
  {
    id: "asphalt",
    name: "Асфальт",
    rgb: [52, 53, 54],
  },
];

const MAP_W = 1024;
const MAP_H = 512;

function rand(u, v, seed = 0) {
  const s = Math.sin(u * 127.1 + v * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function pnoise(u, v, seed = 0) {
  return (
    Math.sin(u * 6.2831 * 5 + seed) * 0.5 +
    Math.sin(u * 6.2831 * 13 + v * 2.1 + seed * 1.7) * 0.28 +
    Math.sin((u + v * 0.37) * 6.2831 * 29 + seed * 3.1) * 0.12 +
    Math.sin(v * 6.2831 * 2.3 + seed * 2.2) * 0.1
  );
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, srgb = false) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function paint(fn) {
  const canvas = makeCanvas(MAP_W, MAP_H);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(MAP_W, MAP_H);
  const d = img.data;
  for (let py = 0; py < MAP_H; py++) {
    for (let px = 0; px < MAP_W; px++) {
      const u = (px + 0.5) / MAP_W;
      // Canvas top row becomes v = 1 after Three.js flips canvas textures.
      const v = 1 - (py + 0.5) / MAP_H;
      const i = (py * MAP_W + px) * 4;
      const out = fn(u, v);
      d[i] = out[0];
      d[i + 1] = out[1];
      d[i + 2] = out[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function medallionCoverageForTexture(u, yMm, H, D) {
  const t = yMm / H;
  const R = (D / 2) * profileRadiusAt(CUP_PROFILES.mug, t);
  return medallionCoverage(u * Math.PI * 2, yMm, H, R);
}

/**
 * Outer wall glazing: a 1 mm band around the rim and the round relief.
 * Everything else stays raw clay.
 */
function outerGlazeCoverage(u, yMm, H, D) {
  const top = yMm > H - 1.0 ? 1 : 0;
  const relief = medallionCoverageForTexture(u, yMm, H, D);
  return Math.max(top, relief);
}

function rawClay(u, v, clay) {
  const [r, g, b] = clay.rgb;
  const grain =
    pnoise(u, v, 13) * 0.035 +
    (rand(Math.floor(u * 71), Math.floor(v * 83), 4) - 0.5) * 0.07;
  const speck = rand(Math.floor(u * 173), Math.floor(v * 149), 7) - 0.5;
  const hardSpeck = Math.abs(speck) > 0.485 ? (speck > 0 ? -0.12 : 0.08) : 0;
  const f = Math.min(1.1, Math.max(0.84, 1 + grain + hardSpeck));
  return [r * f, g * f, b * f];
}

/** Clear-glass look: no glaze hue, only darken and saturate the clay below. */
function wetClay(u, v, clay, amount = 0.72, saturation = 1.38) {
  const [r, g, b] = rawClay(u, v, clay);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sr = lum + (r - lum) * saturation;
  const sg = lum + (g - lum) * saturation;
  const sb = lum + (b - lum) * saturation;
  const mottle = 1 + pnoise(u * 2.4, v * 3.1, 31) * 0.055;
  const k = amount * mottle;
  return [sr * k, sg * k, sb * k];
}

function buildBodyMaps(clay, model) {
  const { height: H, diameter: D, layerHeight: LH, showLayers } = model;

  const color = paint((u, v) => {
    const y = v * H;
    const g = outerGlazeCoverage(u, y, H, D);
    if (g > 0.03) {
      const wet = wetClay(u, v, clay);
      const raw = rawClay(u, v, clay);
      const s = g * g * (3 - 2 * g);
      return [
        clamp255(raw[0] * (1 - s) + wet[0] * s),
        clamp255(raw[1] * (1 - s) + wet[1] * s),
        clamp255(raw[2] * (1 - s) + wet[2] * s),
      ];
    }
    return rawClay(u, v, clay).map(clamp255);
  });

  const phys = paint((u, v) => {
    const y = v * H;
    const g = outerGlazeCoverage(u, y, H, D);
    const rawRough = 0.91 + pnoise(u, v, 21) * 0.035 + rand(Math.floor(u * 97), Math.floor(v * 71), 2) * 0.025;
    const glassRough = 0.055 + pnoise(u, v, 37) * 0.025 + (rand(Math.floor(u * 131), Math.floor(v * 109), 8) - 0.5) * 0.02;
    const rough = rawRough * (1 - g) + glassRough * g;
    return [clamp255(g * 255), clamp255(rough * 255), 128];
  });

  const normal = paint((u, v) => {
    const y = v * H;
    const g = outerGlazeCoverage(u, y, H, D);
    const layerWeight = 1 - g * 0.45;
    let nY = 0;
    if (showLayers && LH > 0) {
      const phase = y / LH - 0.5;
      const d = phase - Math.round(phase);
      const amp = 0.052 + LH * 0.062;
      nY = -(amp * Math.PI / LH) * Math.sin(Math.PI * 2 * d);
      nY *= layerWeight;
    }
    let nX =
      (pnoise(u, v, 41) * 0.14 +
        (rand(Math.floor(u * 179), Math.floor(v * 157), 5) - 0.5) * 0.12) *
      (0.35 + g * 0.65);
    nX = Math.min(1, Math.max(-1, nX));
    nY = Math.min(1, Math.max(-1, nY * 1.25));
    const z = Math.sqrt(Math.max(0.05, 1 - nX * nX - nY * nY));
    return [(nX * 0.5 + 0.5) * 255, (nY * 0.5 + 0.5) * 255, z * 255];
  });

  return {
    color: toTexture(color, true),
    phys: toTexture(phys),
    normal: toTexture(normal),
  };
}

function buildInnerMaps(clay, model) {
  const { height: H } = model;
  const color = paint((u, v) => {
    // Fully glazed. The very top of the inner wall is the 1 mm rim glaze.
    const pooled = 1 - Math.min(1, v / 0.11) * 0.52;
    const wet = wetClay(u, v, clay, 0.7, 1.42);
    const streak = 1 + Math.sin(u * 6.2831 * 7 + v * 22) * 0.02;
    return [
      clamp255(wet[0] * pooled * streak),
      clamp255(wet[1] * pooled * streak),
      clamp255(wet[2] * pooled * streak),
    ];
  });
  const phys = paint((u, v) => {
    const glassRough = 0.06 + pnoise(u, v, 53) * 0.02;
    return [255, clamp255(glassRough * 255), 128];
  });
  return { color: toTexture(color, true), phys: toTexture(phys) };
}

function buildHandleMaps(clay) {
  const color = paint((u, v) => {
    const wet = wetClay(u, v, clay, 0.72, 1.36);
    return [clamp255(wet[0]), clamp255(wet[1]), clamp255(wet[2])];
  });
  const phys = paint((u, v) => {
    const glassRough = 0.07 + pnoise(u, v, 61) * 0.022;
    return [255, clamp255(glassRough * 255), 128];
  });
  return { color: toTexture(color, true), phys: toTexture(phys) };
}

export function getClay(id) {
  return CLAYS.find((c) => c.id === id) || CLAYS[0];
}

export function createCeramicMaps(clay, model) {
  return {
    body: buildBodyMaps(clay, model),
    inner: buildInnerMaps(clay, model),
    handle: buildHandleMaps(clay),
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
