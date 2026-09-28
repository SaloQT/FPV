export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Radio-style deadzone: zero inside `dz`, rescaled so full deflection still reaches +-1. */
export function deadzone(v: number, dz: number): number {
  const a = v < 0 ? -v : v;
  if (a <= dz) return 0;
  const r = (a - dz) / (1 - dz);
  return v < 0 ? -r : r;
}

/** Betaflight expo: `expo * v^3 + (1 - expo) * v`; 0 is linear, 1 is fully cubic (soft centre). */
export function expoCurve(v: number, expo: number): number {
  return expo * v * v * v + (1 - expo) * v;
}

/** Deadzone, expo and clamp in one shot for a -1..1 stick value. */
export function shapeStick(v: number, dz: number, expo: number): number {
  return clamp(expoCurve(deadzone(clamp(v, -1, 1), dz), expo), -1, 1);
}
