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
/**
 * The rim radius is perturbed so the shadow is not the ellipse a sphere casts: rho' = rho * (1 - CANOPY_RIM_NOISE * (2 noise - 1) + CANOPY_LOBE * lobe),
 * a clump-scale bump plus a crown-scale lobe pattern (both zero-mean, so the mean crown size is kept).
 */
export const CANOPY_RIM_NOISE = 0.3;
export const CANOPY_LOBE = 0.15;
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

/** Crown-scale lobe pattern in [-1, 1] at the unit offset u = (p - c) / r from the crown centre c; the phase differs per crown. */
export function canopyLobe(u: readonly number[], c: readonly number[]): number {
  const ph = c[0] * 0.73 + c[2] * 1.31;
  return Math.sin(3.3 * u[0] + ph) * Math.sin(2.6 * u[2] + 1.7 * u[1] + ph * 1.3);
}

/**
 * Optical depth along the chord: CANOPY_SAMPLES samples of extinction x (rim falloff) x (clump noise multiplier), the sample inside each of the
 * equal chord segments at fraction `jitter` of it (the shader uses a per-ray random value so the temporal / a-trous passes average the dither;
 * 0.5 is the deterministic midpoint rule).
 */
export function canopyOpticalDepth(
  c: readonly number[], r: number, o: readonly number[], d: readonly number[], tMax: number,
  noise: (x: number, y: number, z: number) => number = () => 0.5, jitter = 0.5,
): number {
  const chord = sphereChord(c, r, o, d, tMax);
  if (!chord) return 0;
  const ds = (chord[1] - chord[0]) / CANOPY_SAMPLES;
  let tau = 0;
  for (let i = 0; i < CANOPY_SAMPLES; i++) {
    const t = chord[0] + ds * (i + jitter);
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
    const n = noise(x / CANOPY_CLUMP_M, y / CANOPY_CLUMP_M, z / CANOPY_CLUMP_M);
    const u = [(x - c[0]) / r, (y - c[1]) / r, (z - c[2]) / r];
    const rho = Math.hypot(u[0], u[1], u[2]) * (1 - CANOPY_RIM_NOISE * (2 * n - 1) + CANOPY_LOBE * canopyLobe(u, c));
    const leaf = 1 - smoothstep(CANOPY_CORE, 1, rho);
    tau += CANOPY_EXTINCTION * leaf * (CANOPY_GAP_BASE + CANOPY_GAP_SPAN * n) * ds;
  }
  return tau;
}

export function canopyTransmittance(
  c: readonly number[], r: number, o: readonly number[], d: readonly number[], tMax: number,
  noise?: (x: number, y: number, z: number) => number, jitter?: number,
): number {
  return Math.exp(-canopyOpticalDepth(c, r, o, d, tMax, noise, jitter));
}
