/*
 * The single exterior relief for now: a round, low-raised medallion.
 * Both the geometry (which actually lifts the clay) and the glaze maps read
 * from this same config, so the glossy circle always lands exactly on the bump.
 */

export const MEDALLION = {
  // Radial direction toward the default camera position.
  centerAngle: 1.075,
  centerYFraction: 0.56,
  radiusMm: 14,
  heightMm: 0.52,
};

export function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Returns 0..1 where 1 is the flat top of the medallion and 0 is the wall.
 * `surfaceRadiusMm` is the local radius of the cup at that height.
 */
export function medallionCoverage(angle, yMm, heightMm, surfaceRadiusMm) {
  const arc = angleDelta(angle, MEDALLION.centerAngle) * surfaceRadiusMm;
  const dy = yMm - MEDALLION.centerYFraction * heightMm;
  const distance = Math.hypot(arc, dy);
  const t = distance / MEDALLION.radiusMm;
  if (t <= 0.72) return 1;
  if (t >= 1) return 0;
  const q = (t - 0.72) / 0.28;
  return 1 - q * q * (3 - 2 * q);
}
