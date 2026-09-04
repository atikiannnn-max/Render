import * as THREE from "three";

/*
 * Procedural cup geometry in millimetres.
 *
 * The construction follows the same mental model as the Constructor project:
 * the cup is a parametric shell made of revolved contours, and the walls are
 * cut into printable extrusion layers. Here the layers are real geometry —
 * a fine height grid whose radius swells at every printed loop centre.
 */

export const CUP_PROFILES = {
  mug: [
    [0.0, 0.975],
    [0.045, 1.02],
    [0.14, 0.99],
    [0.35, 0.995],
    [0.62, 0.985],
    [0.8, 0.955],
    [0.91, 0.955],
    [0.965, 0.99],
    [1.0, 1.012],
  ],
  tumbler: [
    [0.0, 0.9],
    [0.08, 0.92],
    [0.35, 0.955],
    [0.7, 0.99],
    [0.94, 1.0],
    [1.0, 0.995],
  ],
  bowl: [
    [0.0, 0.965],
    [0.03, 1.0],
    [0.2, 1.045],
    [0.45, 1.055],
    [0.72, 1.02],
    [0.9, 0.945],
    [1.0, 0.88],
  ],
};

const QUALITY = {
  low: { segments: 96, rowsPerLayer: 4 },
  medium: { segments: 144, rowsPerLayer: 5 },
  high: { segments: 224, rowsPerLayer: 8 },
};

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function smooth01(t) {
  return t * t * (3 - 2 * t);
}

export function profileRadiusAt(profile, t01) {
  const t = clamp(t01, 0, 1);
  const pts = profile;
  if (t <= pts[0][0]) return pts[0][1];
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    const [y0, r0] = pts[i - 1];
    const [y1, r1] = pts[i];
    if (t > y1) continue;
    const k = smooth01((t - y0) / Math.max(1e-6, y1 - y0));
    return r0 + (r1 - r0) * k;
  }
  return pts[pts.length - 1][1];
}

function hash(n) {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function makeRows(h, rowsPerLayer, layerHeight) {
  const rows = Math.max(90, Math.ceil(h / Math.max(0.2, layerHeight)) * rowsPerLayer);
  const out = [];
  for (let i = 0; i <= rows; i++) out.push((h * i) / rows);
  return out;
}

function smoothRows(rows, extraY, eps = 1e-3) {
  if (extraY == null) return rows;
  if (rows.some((y) => Math.abs(y - extraY) < eps)) return rows;
  return [...rows, extraY].sort((a, b) => a - b);
}

function addTri(outward, p0, p1, p2, pos, uv, idx, uv0, uv1, uv2) {
  const ax = pos[p0 * 3], ay = pos[p0 * 3 + 1], az = pos[p0 * 3 + 2];
  const bx = pos[p1 * 3], by = pos[p1 * 3 + 1], bz = pos[p1 * 3 + 2];
  const cx = pos[p2 * 3], cy = pos[p2 * 3 + 1], cz = pos[p2 * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const ok = nx * outward[0] + ny * outward[1] + nz * outward[2] > 0;
  const a = ok ? p0 : p0;
  const b = ok ? p1 : p2;
  const c = ok ? p2 : p1;
  idx.push(a, b, c);
}

function ringGeometry(opts, inner) {
  const {
    height: H,
    diameter: D,
    wallThickness: T,
    bottomThickness: B,
    layerHeight: LH,
    shapeKey,
    showLayers,
    quality,
  } = opts;
  const q = QUALITY[quality];
  const R = D / 2;
  const A = q.segments;
  const profile = CUP_PROFILES[shapeKey] || CUP_PROFILES.mug;

  const rows = smoothRows(makeRows(H, q.rowsPerLayer, LH), inner ? B : null);
  const relevant = inner ? rows.filter((y) => y >= B - 1e-5) : rows;
  if (inner && !relevant.length) return null;

  const yStart = inner ? Math.max(B, relevant[0]) : 0;
  const yEnd = H;

  const pos = [];
  const uv = [];
  const idx = [];

  function radiusAt(y, theta, j) {
    const t01 = y / H;
    const base = R * profileRadiusAt(profile, t01) - (inner ? T : 0);
    const outwardSign = inner ? -1 : 1;

    let off = 0;
    if (showLayers && LH > 0) {
      const phase = y / LH - 0.5;
      const d = phase - Math.round(phase);
      const ridge = 0.5 + 0.5 * Math.cos(Math.PI * 2 * d);
      const loop = Math.round(y / LH);
      const wobble = 1 + (hash(loop * 1.731 + (inner ? 19 : 0)) - 0.5) * 0.34;
      const amp = (0.052 + LH * 0.062) * (inner ? 0.52 : 1);
      off = amp * ridge * wobble;
      const micro = 0.022 * Math.sin(loop * 1.3 + Math.sin(theta * 5 + loop * 0.9));
      off += micro * ridge;
    }

    const lowFreq = 0.018 * Math.sin(y / H * 6.7 + Math.sin(theta * 3 + 1.2) * 1.4);
    const a = theta;
    const radius = Math.max(0.5, base + outwardSign * off + lowFreq);
    return [radius * Math.cos(a), y, radius * Math.sin(a)];
  }

  // Ring vertex rows (vertical wall).
  const rowStart = new Array(relevant.length);
  relevant.forEach((y, ri) => {
    rowStart[ri] = pos.length / 3;
    for (let j = 0; j < A; j++) {
      const theta = (j / A) * Math.PI * 2;
      const p = radiusAt(y, theta, j);
      pos.push(p[0], p[1], p[2]);
      uv.push(j / A, inner ? (y - yStart) / (yEnd - yStart) : y / H);
    }
  });

  // Vertical quads between rows.
  for (let ri = 0; ri < relevant.length - 1; ri++) {
    for (let j = 0; j < A; j++) {
      const jn = (j + 1) % A;
      const a = rowStart[ri] + j;
      const b = rowStart[ri + 1] + j;
      const c = rowStart[ri + 1] + jn;
      const d = rowStart[ri] + jn;
      const p0x = pos[a * 3], p0z = pos[a * 3 + 2];
      const rr = Math.hypot(p0x, p0z) || 1;
      const outward = [
        (inner ? -p0x : p0x) / rr,
        0,
        (inner ? -p0z : p0z) / rr,
      ];
      addTri(outward, a, b, c, pos, uv, idx, 0, 0, 0);
      addTri(outward, a, c, d, pos, uv, idx, 0, 0, 0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  geometry.userData.triCount = idx.length / 3;
  return geometry;
}

function capGeometry(center, ringPts, outward, topUvV = 1) {
  const pos = [...center, ...ringPts.flat()];
  const uv = [[0.5, topUvV]];
  for (let i = 0; i < ringPts.length; i++) {
    const angle = (i / ringPts.length) * Math.PI * 2;
    uv.push([angle / (Math.PI * 2), topUvV]);
  }
  const idx = [];
  for (let i = 1; i < ringPts.length; i++) {
    const j = i + 1 === ringPts.length ? 1 : i + 1;
    addTri(outward, 0, i, j, pos, uv, idx, uv[0], uv[i], uv[j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function bottomCap(opts, outerGeo) {
  const { diameter: D, height: H, shapeKey } = opts;
  const R = D / 2;
  const profile = CUP_PROFILES[shapeKey] || CUP_PROFILES.mug;
  const r0 = R * profileRadiusAt(profile, 0);
  const A = QUALITY[opts.quality].segments;
  const ring = [];
  for (let i = 0; i < A; i++) {
    const th = (i / A) * Math.PI * 2;
    ring.push([Math.cos(th) * r0, 0, Math.sin(th) * r0]);
  }
  return capGeometry([0, 0, 0], ring, [0, -1, 0], 0);
}

function interiorFloor(opts) {
  const {
    diameter: D,
    wallThickness: T,
    bottomThickness: B,
    shapeKey,
  } = opts;
  const profile = CUP_PROFILES[shapeKey] || CUP_PROFILES.mug;
  const t = B / opts.height;
  const innerR = Math.max(0.5, D / 2 * profileRadiusAt(profile, t) - T);
  const ring = [];
  const segments = 128;
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    ring.push([Math.cos(th) * innerR, B, Math.sin(th) * innerR]);
  }
  return capGeometry([0, B, 0], ring, [0, 1, 0], 0);
}

function rimCap(opts) {
  const { diameter: D, height: H, wallThickness: T, shapeKey } = opts;
  const profile = CUP_PROFILES[shapeKey] || CUP_PROFILES.mug;
  const rTop = D / 2 * profileRadiusAt(profile, 1);
  const innerTop = Math.max(0.5, rTop - T);
  const outerRing = [];
  const innerRing = [];
  const segments = 144;
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    outerRing.push([Math.cos(th) * rTop, H, Math.sin(th) * rTop]);
    innerRing.push([Math.cos(th) * innerTop, H, Math.sin(th) * innerTop]);
  }
  const pos = [...outerRing.flat(), ...innerRing.flat()];
  const uv = [];
  for (let i = 0; i < segments * 2; i++) {
    uv.push(i < segments ? (i / segments) : i % segments === 0 ? 0 : (i % segments) / segments, 1);
  }
  const idx = [];
  for (let i = 0; i < segments; i++) {
    const ni = (i + 1) % segments;
    const o0 = i, o1 = ni;
    const i0 = segments + i, i1 = segments + ni;
    // orient upwards
    addTri([0, 1, 0], o0, i0, i1, pos, uv, idx, uv[o0], uv[i0], uv[i1]);
    addTri([0, 1, 0], o0, i1, o1, pos, uv, idx, uv[o0], uv[i1], uv[o1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeCupGeometry(opts) {
  const { handle = true, diameter: D, height: H } = opts;
  const outer = ringGeometry(opts, false);
  const inner = ringGeometry(opts, true);
  const rim = rimCap(opts);
  const bottom = bottomCap(opts);
  const floor = interiorFloor(opts);

  let handleGeo = null;
  let handlePathLength = 0;
  if (handle) {
    const q = QUALITY[opts.quality];
    const R = D / 2;
    const profile = CUP_PROFILES[opts.shapeKey] || CUP_PROFILES.mug;
    const radial = (t01) => R * profileRadiusAt(profile, t01);
    const topY = H * 0.8;
    const botY = H * 0.12;
    const reach = Math.min(D * 0.58, H * 0.48);
    const tubeR = Math.max(5.2, Math.min(9, opts.wallThickness * 1.65 + 2.4));
    const stay = 1.8;
    const rTop = radial(topY / H) + stay + tubeR;
    const rBot = radial(botY / H) + stay + tubeR;
    const outerPeak = Math.max(rTop, rBot) + reach;

    const points = [
      new THREE.Vector3(rTop, topY + 4, 0),
      new THREE.Vector3(rTop + reach * 0.38, topY + 11, 0),
      new THREE.Vector3(outerPeak * 0.92, H * 0.66, 0),
      new THREE.Vector3(outerPeak, H * 0.48, 0),
      new THREE.Vector3(outerPeak * 0.9, H * 0.3, 0),
      new THREE.Vector3(rBot + reach * 0.3, botY - 8, 0),
      new THREE.Vector3(rBot, botY - 3, 0),
    ];
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.5);
    handlePathLength = curve.getLength();
    const tubular = Math.round(clamp(handlePathLength / 0.55, 100, 360));
    const radialSegments = q.segments >= 200 ? 28 : q.segments >= 130 ? 22 : 16;
    handleGeo = new THREE.TubeGeometry(curve, tubular, tubeR, radialSegments, false);
    handleGeo.computeVertexNormals();
    const mid = handleGeo.attributes.position.array.length / 3 / 2 | 0;
    handleGeo.applyMatrix4(new THREE.Matrix4().makeRotationY(-0.92));
    handleGeo.userData.triCount = handleGeo.index.count / 3;
  }

  const triCount =
    (outer?.userData.triCount || 0) +
    (inner?.userData.triCount || 0) +
    (rim?.userData.triCount || 0) +
    (handleGeo?.userData.triCount || 0) +
    (bottom.userData.triCount || 0) +
    (floor.userData.triCount || 0);

  return {
    outer,
    inner,
    rim,
    bottom,
    floor,
    handle: handleGeo,
    handlePathLength,
    triCount,
  };
}

export function disposeGeometryParts(parts) {
  for (const key of ["outer", "inner", "rim", "bottom", "floor", "handle"]) {
    if (parts[key]) parts[key].dispose();
  }
}
