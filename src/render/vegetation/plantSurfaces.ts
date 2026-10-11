import type { Vec3 } from '../../contracts';
import { KIND } from './meshBuilder';
import { variantLods, variantPlan } from './variants';

/**
 * What is drawn for one plant variant at scale 1, in the plant's own frame (yaw 0, root at the origin), sampled so a generator can ask
 * "does this tree, as drawn, touch that building?" without building a mesh per tree.
 */
export interface PlantSurface {
  /** Points through the volume of the trunk and the thicker primary limbs: a point on the axis, a ring half way out and a ring at the bark, at stations less than half a radius apart. xyz per point. */
  wood: Float32Array;
  /** Corners and centres of the leaf and needle cards of the full-detail mesh, xyz per point. */
  leaves: Float32Array;
  /** Every leaf and needle card triangle of the full-detail mesh, nine floats (three corners) per triangle. */
  leafTriangles: Float32Array;
}

/** The thinnest primary limb (base radius, metres) that is worth sampling. */
const MIN_LIMB_RADIUS = 0.045;
/** The trunk's root flare swells the drawn bark past the planned radius by up to this fraction. */
const ROOT_FLARE = 1.25;
/** Points below this height (metres at scale 1) are the root sunk into the soil, which is meant to be underground. */
export const ROOT_DEPTH = 0.02;
const MAX_WOOD_POINTS = 24000;
/** Station spacing as a fraction of the bark radius, and the closest and farthest spacing allowed (metres). */
const SPACING = 0.5;
const MIN_STEP = 0.04;
const MAX_STEP = 0.4;
/** Height (metres at scale 1) below which the trunk is sampled at the closest spacing. */
const ROOT_ZONE = 0.8;
const INNER_POINTS = 6;
const BARK_POINTS = 12;

const cache = new Map<number, PlantSurface>();

/** Points through every thick woody segment of a plan: the trunk and its primary limbs, at the radius the bark is drawn at. */
function woodPoints(variant: number): number[] {
  const plan = variantPlan(variant)!, out: number[] = [];
  const limbs = plan.limbs.filter(limb => limb.order === 0 || (limb.order === 1 && limb.radii[0] >= MIN_LIMB_RADIUS));
  const stride = Math.max(1, Math.ceil(limbs.length * 120 * (INNER_POINTS + BARK_POINTS + 1) / MAX_WOOD_POINTS));
  limbs.forEach((limb, li) => {
    if (limb.order === 1 && li % stride) return;
    const flare = limb.order === 0 ? ROOT_FLARE : 1;
    const station = (p: Vec3, tangent: Vec3, radius: number): void => {
      const ref: Vec3 = Math.abs(tangent[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
      const u = [tangent[1] * ref[2] - tangent[2] * ref[1], tangent[2] * ref[0] - tangent[0] * ref[2], tangent[0] * ref[1] - tangent[1] * ref[0]], ul = Math.hypot(u[0], u[1], u[2]) || 1;
      const uu: Vec3 = [u[0] / ul, u[1] / ul, u[2] / ul], w: Vec3 = [tangent[1] * uu[2] - tangent[2] * uu[1], tangent[2] * uu[0] - tangent[0] * uu[2], tangent[0] * uu[1] - tangent[1] * uu[0]];
      const add = (x: number, y: number, z: number): void => { if (y >= ROOT_DEPTH) out.push(x, y, z); };
      add(p[0], p[1], p[2]);
      for (const [count, fraction] of [[INNER_POINTS, 0.5], [BARK_POINTS, 1]] as const) for (let k = 0; k < count; k++) {
        const ang = k / count * Math.PI * 2 + (fraction < 1 ? Math.PI / count : 0), c = Math.cos(ang) * radius * fraction, s = Math.sin(ang) * radius * fraction;
        add(p[0] + uu[0] * c + w[0] * s, p[1] + uu[1] * c + w[1] * s, p[2] + uu[2] * c + w[2] * s);
      }
    };
    for (let i = 0; i + 1 < limb.pts.length; i++) {
      const a = limb.pts[i], b = limb.pts[i + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-6;
      const tangent: Vec3 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length, (b[2] - a[2]) / length];
      // Near the ground the stations are close enough that none can step over a kerb only a few centimetres tall.
      const r0 = limb.radii[i] * flare, r1 = limb.radii[i + 1] * flare, low = limb.order === 0 && Math.min(a[1], b[1]) < ROOT_ZONE;
      const step = low ? MIN_STEP : Math.min(MAX_STEP, Math.max(MIN_STEP, SPACING * Math.min(r0, r1))), n = Math.ceil(length / step);
      for (let k = 0; k < n; k++) { const f = k / n; station([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], tangent, r0 + (r1 - r0) * f); }
      if (i + 2 === limb.pts.length) station(b, tangent, r1);
    }
  });
  return out;
}

/** Every leaf and needle card triangle of the full-detail mesh, as corner positions. */
function leafCorners(variant: number): number[] {
  const mesh = variantLods(variant)[0], out: number[] = [];
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const a = mesh.idx[t], b = mesh.idx[t + 1], c = mesh.idx[t + 2];
    if (mesh.attr[a * 4 + 2] < KIND.leaf) continue;
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) out.push(mesh.pos[v * 3 + k]);
  }
  return out;
}

/** The centre and corners of every second card triangle, which is where a card pokes through a wall first. */
function leafPoints(corners: Float32Array): number[] {
  const out: number[] = [];
  for (let t = 0; t < corners.length; t += 9) {
    if (t / 9 % 2) continue;
    for (let k = 0; k < 3; k++) out.push((corners[t + k] + corners[t + 3 + k] + corners[t + 6 + k]) / 3);
    for (let k = 0; k < 9; k++) out.push(corners[t + k]);
  }
  return out;
}

/** The sampled drawn surface of a plant variant (memoised; deterministic per variant). Rocks have none. */
export function plantSurface(variant: number): PlantSurface {
  let surface = cache.get(variant);
  if (!surface) {
    const wood = Float32Array.from(woodPoints(variant));
    const leafTriangles = Float32Array.from(leafCorners(variant));
    surface = { wood, leaves: Float32Array.from(leafPoints(leafTriangles)), leafTriangles };
    cache.set(variant, surface);
  }
  return surface;
}
