/**
 * Leaf-canopy proxy spheres (vegetation registers one sphere per tree crown) are not opaque: light crossing a crown is attenuated by
 * Beer-Lambert extinction along the chord, so the shadow of a crown is a soft, dappled, partially transparent blob and not a black ellipse.
 * CPU reference of shaders/rt/rt_canopy.wgsl (keep the constants in sync).
 */
import type { RTPrimitive } from '../contracts';

/** Extinction of a leafy crown, 1/m: G (~0.5 projected-area factor) x leaf area density (LAI ~5 over a ~9 m crown, ~0.45 m2/m3). */
export const CANOPY_EXTINCTION = 0.24;
/** Radius fraction (of the crown sphere) inside which the leaf density is full; it falls off to zero at the proxy surface (fluffy rim). */
export const CANOPY_CORE = 0.6;
export const CANOPY_SAMPLES = 4;
/** The density multiplier is CANOPY_GAP_BASE + CANOPY_GAP_SPAN * noise, noise in [0, 1]: mean 1 for a mean noise of 0.5. */
export const CANOPY_GAP_BASE = 0.4;
export const CANOPY_GAP_SPAN = 1.2;
/** World-space size of one leaf clump (noise lattice cell), metres. */
export const CANOPY_CLUMP_M = 0.9;
/** Word 15 of a packed primitive (rt/prims.ts): bit 0 marks a leaf-canopy sphere. */
export const PRIM_FLAG_CANOPY = 1;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** A sphere proxy whose material reads as foliage (dark green, fully rough, non-metal): the crown volume of a tree. Trunks are capsules and stay opaque. */
export function isCanopyProxy(p: RTPrimitive): boolean {
  if (p.type !== 'sphere') return false;
  const [r, g, b] = p.material.albedo;
  return p.material.metalness === 0 && p.material.roughness >= 0.9 && g > r && g > b && g < 0.3 && !p.material.emissive;
}

/** Entry / exit distances of the ray o + t d (|d| = 1) through the sphere, clipped to [0, tMax]; null when the ray misses or the clip is empty. */
export function sphereChord(c: readonly number[], r: number, o: readonly number[], d: readonly number[], tMax: number): [number, number] | null {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const h = b * b - (ox * ox + oy * oy + oz * oz - r * r);
  if (h <= 0) return null;
  const s = Math.sqrt(h);
  const t0 = Math.max(-b - s, 0), t1 = Math.min(-b + s, tMax);
  return t1 > t0 ? [t0, t1] : null;
}

/** Optical depth along the chord: CANOPY_SAMPLES midpoint samples of extinction x (rim falloff) x (clump noise multiplier). */
export function canopyOpticalDepth(
  c: readonly number[], r: number, o: readonly number[], d: readonly number[], tMax: number,
  noise: (x: number, y: number, z: number) => number = () => 0.5,
): number {
  const chord = sphereChord(c, r, o, d, tMax);
  if (!chord) return 0;
  const ds = (chord[1] - chord[0]) / CANOPY_SAMPLES;
  let tau = 0;
  for (let i = 0; i < CANOPY_SAMPLES; i++) {
    const t = chord[0] + ds * (i + 0.5);
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
    const rho = Math.hypot(x - c[0], y - c[1], z - c[2]) / r;
    const leaf = 1 - smoothstep(CANOPY_CORE, 1, rho);
    tau += CANOPY_EXTINCTION * leaf * (CANOPY_GAP_BASE + CANOPY_GAP_SPAN * noise(x / CANOPY_CLUMP_M, y / CANOPY_CLUMP_M, z / CANOPY_CLUMP_M)) * ds;
  }
  return tau;
}

export function canopyTransmittance(
  c: readonly number[], r: number, o: readonly number[], d: readonly number[], tMax: number,
  noise?: (x: number, y: number, z: number) => number,
): number {
  return Math.exp(-canopyOpticalDepth(c, r, o, d, tMax, noise));
}
