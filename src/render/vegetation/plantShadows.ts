import type { Vec3 } from '../../contracts';
import type { RTMaterial, RTPrimitive } from '../contracts';
import { plantSurface } from './plantSurfaces';
import { VARIANT_DEFS, variantPlan } from './variants';
import type { Limb, TreePlan } from './treePlan';

/**
 * Ray-traced shadow stand-ins for one drawn tree: opaque capsules along the trunk and thick limbs, and soft canopy spheres fitted to the
 * leaves. The park's explicit plantings and the natural forest both use these, so a tree casts the shadow of the tree that is drawn.
 */

/** Bulk canopy reflectance (leaves, gaps and bark averaged), lower than a single leaf's 0.1 to 0.15 green. */
export const RT_FOLIAGE: RTMaterial = { albedo: [0.045, 0.09, 0.025], roughness: 1, metalness: 0 };
export const RT_WOOD: RTMaterial = { albedo: [0.13, 0.085, 0.05], roughness: 0.95, metalness: 0 };

/** Most capsules one tree gets for its wood, trunk first and then the thickest limbs. */
export const MAX_WOOD_CAPSULES = 10;
/** Most canopy spheres one tree gets. */
export const MAX_CANOPY_SPHERES = 3;
/** A wood capsule thinner than this (metres, after scale) casts no shadow worth tracing. */
const MIN_CAPSULE_RADIUS = 0.015;
/** Primary limbs thinner than this at their base (metres at scale 1) are left to the canopy. */
const MIN_LIMB_RADIUS = 0.05;
const MAX_TRUNK_CHORDS = 6;
const MAX_LIMB_CHORDS = 2;
const MAX_LIMBS = 3;
/** How much of a capsule's radius the true centreline may stray from its axis. */
const SAG_OF_RADIUS = 0.5;
/** How much wider than its thinnest end a chord's widest end may be, as a fraction. */
const TAPER_PER_CHORD = 0.5;
const WOOD_FILL = 0.9;

export interface WoodCapsule { a: Vec3; b: Vec3; radius: number }
export interface CanopySphere { center: Vec3; radius: number }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const d = sub(b, a), l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2));
  return len(sub(p, [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]));
}

/** Breakpoints (indices) of a polyline so that every chord stays within SAG_OF_RADIUS of the thinnest bark it replaces. */
function breakpoints(pts: readonly Vec3[], radii: readonly number[], from: number, to: number, scaleTol: number): number[] {
  const out = [from];
  const split = (i: number, j: number): void => {
    let worst = 0, at = -1, thin = Infinity, thick = 0;
    for (let k = i; k <= j; k++) { thin = Math.min(thin, radii[k]); thick = Math.max(thick, radii[k]); }
    for (let k = i + 1; k < j; k++) { const d = distanceToSegment(pts[k], pts[i], pts[j]); if (d > worst) { worst = d; at = k; } }
    if (at > 0 && worst > Math.max(0.01, SAG_OF_RADIUS * scaleTol * thin)) { split(i, at); split(at, j); }
    // A chord has one radius, so a trunk that tapers a lot within one is cut in half.
    else if (j - i > 1 && thick > (1 + TAPER_PER_CHORD * scaleTol) * thin) { const mid = (i + j) >> 1; split(i, mid); split(mid, j); }
    else out.push(j);
  };
  split(from, to);
  return out;
}

/** Whether one chord from the start of the limb to the point at index end stays within the sag allowance of the bark between. */
function straightEnough(limb: Limb, end: number): boolean {
  let thin = Infinity, worst = 0;
  for (let k = 0; k <= end; k++) thin = Math.min(thin, limb.radii[k]);
  for (let k = 1; k < end; k++) worst = Math.max(worst, distanceToSegment(limb.pts[k], limb.pts[0], limb.pts[end]));
  return worst <= Math.max(0.01, SAG_OF_RADIUS * thin);
}

/** Fewest chords, each within the sag allowance, with the allowance relaxed only as far as needed to respect `max`. */
function fitChords(limb: Limb, from: number, to: number, max: number): WoodCapsule[] {
  let tol = 1, marks = breakpoints(limb.pts, limb.radii, from, to, tol);
  while (marks.length - 1 > max && tol < 64) { tol *= 1.4; marks = breakpoints(limb.pts, limb.radii, from, to, tol); }
  const out: WoodCapsule[] = [];
  for (let m = 1; m < marks.length; m++) {
    let sum = 0, n = 0;
    for (let k = marks[m - 1]; k <= marks[m]; k++) { sum += limb.radii[k]; n++; }
    out.push({ a: limb.pts[marks[m - 1]], b: limb.pts[marks[m]], radius: sum / n * WOOD_FILL });
  }
  return out;
}

/** The wood of one variant at scale 1 in the plant's own frame: chords along the trunk from the ground up, and chords along its thickest limbs. */
export interface WoodFit { trunk: readonly WoodCapsule[]; limbs: readonly WoodCapsule[] }

const woodCache = new Map<number, WoodFit>();

/** Index of a stem's first point less than 20 cm under the ground. */
const groundIndex = (stem: Limb): number => Math.max(0, Math.min(stem.pts.findIndex(p => p[1] >= -0.2), stem.pts.length - 2));

export function woodShadowFit(variant: number): WoodFit {
  let fit = woodCache.get(variant);
  if (fit) return fit;
  const plan = variantPlan(variant)!, stems = plan.limbs.filter(limb => limb.order === 0), limbs: WoodCapsule[] = [];
  // Every stem of a clump casts its shadow; the chord budget is shared between them.
  // The part of a stem below the ground casts nothing: chords start at its first point near the surface.
  const trunk = stems.flatMap(stem => fitChords(stem, groundIndex(stem), stem.pts.length - 1, Math.max(2, Math.floor(MAX_TRUNK_CHORDS / stems.length))));
  // Surface roots lie in the ground and cast no shadow worth a capsule.
  const thick = plan.limbs.filter(limb => limb.order === 1 && !limb.root && limb.radii[0] >= MIN_LIMB_RADIUS).sort((a, b) => b.radii[0] - a.radii[0]).slice(0, MAX_LIMBS);
  for (const limb of thick) {
    // The thick root of the limb, as far as one straight chord stays inside its bark and the bark has not thinned to under about half its base.
    let end = 1;
    while (end + 1 < limb.pts.length && limb.radii[end + 1] >= Math.max(0.03, 0.45 * limb.radii[0]) && straightEnough(limb, end + 1)) end++;
    // A limb that bends at once still gets its first two segments, one chord each.
    if (end === 1 && limb.pts.length > 2 && limb.radii[2] >= Math.max(0.03, 0.45 * limb.radii[0])) end = 2;
    limbs.push(...fitChords(limb, 0, end, MAX_LIMB_CHORDS));
  }
  fit = { trunk, limbs };
  woodCache.set(variant, fit);
  return fit;
}

const yawPoint = (pos: Vec3, yaw: number, local: Vec3, scale: number): Vec3 => {
  const c = Math.cos(yaw), s = Math.sin(yaw), x = local[0] * scale, y = local[1] * scale, z = local[2] * scale;
  return [pos[0] + c * x + s * z, pos[1] + y, pos[2] - s * x + c * z];
};

export interface PlantPlacement { pos: Vec3; yaw: number; scale: number }

/** Opaque capsules for the wood of a placed tree, trunk first and then the thickest limbs (trunk only when `withLimbs` is false), skipping any too thin to matter at this scale. Bushes have none. */
export function plantWoodShadows(variant: number, at: PlantPlacement, withLimbs = true, max = MAX_WOOD_CAPSULES): RTPrimitive[] {
  const out: RTPrimitive[] = [];
  if (VARIANT_DEFS[variant].group !== 'tree') return out;
  const fit = woodShadowFit(variant);
  for (const capsule of withLimbs ? [...fit.trunk, ...fit.limbs] : fit.trunk) {
    if (out.length >= max) break;
    const radius = capsule.radius * at.scale;
    if (radius < MIN_CAPSULE_RADIUS) continue;
    out.push({ type: 'capsule', a: yawPoint(at.pos, at.yaw, capsule.a, at.scale), b: yawPoint(at.pos, at.yaw, capsule.b, at.scale), radius, material: RT_WOOD });
  }
  return out;
}

// ----- canopy -----

const canopyCache = new Map<number, CanopySphere[]>();

/** The old stand-in: one sphere of the same volume as the planned crown ellipsoid, at its centre. */
function crownSphere(plan: TreePlan): CanopySphere {
  return { center: plan.crownC, radius: Math.cbrt(plan.crownR[0] * plan.crownR[1] * plan.crownR[2]) };
}

/** Lloyd's k-means, started from evenly spaced heights, each sphere sized to the spread of its own leaves (a solid ball has mean square radius 3/5 R^2). */
function ballsOf(points: Float32Array, k: number): CanopySphere[] {
  const n = points.length / 3;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, points[i * 3 + 1]); hi = Math.max(hi, points[i * 3 + 1]); }
  const centres: Vec3[] = [];
  for (let c = 0; c < k; c++) {
    const y = lo + (hi - lo) * (c + 0.5) / k;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(points[i * 3 + 1] - y); if (d < bd) { bd = d; best = i; } }
    centres.push([points[best * 3], points[best * 3 + 1], points[best * 3 + 2]]);
  }
  const owner = new Int32Array(n), sums = centres.map(() => [0, 0, 0, 0]);
  const assign = (): void => {
    for (const s of sums) s.fill(0);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = (points[i * 3] - centres[c][0]) ** 2 + (points[i * 3 + 1] - centres[c][1]) ** 2 + (points[i * 3 + 2] - centres[c][2]) ** 2; if (d < bd) { bd = d; bi = c; } }
      owner[i] = bi; const s = sums[bi]; s[0] += points[i * 3]; s[1] += points[i * 3 + 1]; s[2] += points[i * 3 + 2]; s[3]++;
    }
  };
  for (let iteration = 0; iteration < 24; iteration++) { assign(); for (let c = 0; c < k; c++) if (sums[c][3]) centres[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]]; }
  assign();
  const spread = centres.map(() => 0);
  for (let i = 0; i < n; i++) spread[owner[i]] += (points[i * 3] - centres[owner[i]][0]) ** 2 + (points[i * 3 + 1] - centres[owner[i]][1]) ** 2 + (points[i * 3 + 2] - centres[owner[i]][2]) ** 2;
  return centres.map((center, c) => ({ center, radius: Math.sqrt(5 / 3 * spread[c] / Math.max(1, sums[c][3])) })).filter((_, c) => sums[c][3] > 0);
}

/** Points spread evenly over every drawn leaf and needle card, no farther apart than `spacing` metres, so a big flat frond counts for its area and not for its four corners. */
export function denseLeafPoints(variant: number, spacing: number): Float32Array {
  const tris = plantSurface(variant).leafTriangles, out: number[] = [];
  for (let t = 0; t < tris.length; t += 9) {
    const edge = (p: number, q: number): number => Math.hypot(tris[t + p * 3] - tris[t + q * 3], tris[t + p * 3 + 1] - tris[t + q * 3 + 1], tris[t + p * 3 + 2] - tris[t + q * 3 + 2]);
    const n = Math.max(1, Math.min(32, Math.ceil(Math.max(edge(0, 1), edge(1, 2), edge(2, 0)) / spacing)));
    const at = (u: number, v: number): void => { for (let k = 0; k < 3; k++) out.push(tris[t + k] + (tris[t + 3 + k] - tris[t + k]) * u + (tris[t + 6 + k] - tris[t + k]) * v); };
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) { at((i + 1 / 3) / n, (j + 1 / 3) / n); if (i + j < n - 1) at((i + 2 / 3) / n, (j + 2 / 3) / n); }
  }
  return Float32Array.from(out);
}

/** Overlap (intersection over union) between the volume the drawn leaves fill and the volume of the spheres, on a grid of `cell`-metre voxels. */
export function canopyOverlap(points: Float32Array, spheres: readonly CanopySphere[], cell: number): number {
  const key = (x: number, y: number, z: number): number => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  const drawn = new Set<number>();
  for (let i = 0; i < points.length; i += 3) {
    const x = Math.floor(points[i] / cell), y = Math.floor(points[i + 1] / cell), z = Math.floor(points[i + 2] / cell);
    drawn.add(key(x, y, z));
  }
  const filled = new Set<number>();
  for (const s of spheres) {
    const r = Math.ceil(s.radius / cell) + 1, cx = Math.floor(s.center[0] / cell), cy = Math.floor(s.center[1] / cell), cz = Math.floor(s.center[2] / cell);
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.hypot((x + 0.5) * cell - s.center[0], (y + 0.5) * cell - s.center[1], (z + 0.5) * cell - s.center[2]) <= s.radius) filled.add(key(x, y, z));
    }
  }
  let both = 0;
  for (const k of filled) if (drawn.has(k)) both++;
  return both / (filled.size + drawn.size - both || 1);
}

/** A sphere count past the first is kept only if it raises the overlap with the drawn leaves by at least this much. */
const EXTRA_SPHERE_GAIN = 0.05;

/** Canopy spheres of a variant at scale 1 in the plant's frame: the 1-3 spheres whose volume best matches the volume its leaves fill. */
export function canopyShadowFit(variant: number): readonly CanopySphere[] {
  let fit = canopyCache.get(variant);
  if (fit) return fit;
  const plan = variantPlan(variant)!, cell = Math.max(0.05, Math.max(...plan.crownR) / 14), leaves = denseLeafPoints(variant, cell / 2);
  let best: CanopySphere[] = [crownSphere(plan)], score = canopyOverlap(leaves, best, cell);
  const moment = ballsOf(leaves, 1), momentScore = canopyOverlap(leaves, moment, cell);
  if (momentScore > score) { best = moment; score = momentScore; }
  for (let k = 2; k <= MAX_CANOPY_SPHERES; k++) {
    const balls = ballsOf(leaves, k), s = canopyOverlap(leaves, balls, cell);
    if (s >= score + EXTRA_SPHERE_GAIN) { best = balls; score = s; }
  }
  fit = best; canopyCache.set(variant, fit);
  return fit;
}

/** Soft canopy spheres for a placed tree. */
export function plantCanopyShadows(variant: number, at: PlantPlacement): RTPrimitive[] {
  return canopyShadowFit(variant).map(s => ({ type: 'sphere', center: yawPoint(at.pos, at.yaw, s.center, at.scale), radius: s.radius * at.scale, material: RT_FOLIAGE }));
}
