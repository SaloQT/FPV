import type { Vec3 } from '../../contracts';
import { Rng } from '../../world/track/rng';
import { KIND, add, cross, dot, mul, norm, sub } from './meshBuilder';

const TAU = Math.PI * 2;
const UP: Vec3 = [0, 1, 0];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A woody segment: centreline, radius at each point, and its branching order (0 trunk, 1 primary limb, 2 secondary, 3 twig). */
export interface Limb { pts: Vec3[]; radii: number[]; order: number }
/** A conifer spray card pair: `c` is its centre, `t` the unit direction of the needle tips, `len` and `width` in metres. */
export interface Frond { c: Vec3; t: Vec3; len: number; width: number; branch: number }
/** A ball of leaf cards (or radial needle tufts) of radius `r` around `c`. */
export interface Cluster { c: Vec3; r: number }

export type Species = 'spruce' | 'pine' | 'oak' | 'birch' | 'bush' | 'juniper';

export interface TreePlan {
  species: Species;
  height: number;
  /** Crown ellipsoid: centre and radii, used for shading normals, ambient occlusion and the LOD2 billboards. */
  crownC: Vec3;
  crownR: Vec3;
  trunkRadius: number;
  bark: number;
  limbs: Limb[];
  fronds: Frond[];
  clusters: Cluster[];
  /** Leaf cards per cluster, their half size (m), whether cards radiate from the cluster centre (pine tufts) and the atlas kind. */
  cardsPerCluster: number;
  cardSize: number;
  radial: boolean;
  foliage: number;
  /** Bark rings of the trunk at each LOD (LOD0..2). */
  trunkSides: [number, number, number];
}

export function pol(yaw: number, elev: number): Vec3 {
  const c = Math.cos(elev);
  return [c * Math.sin(yaw), Math.sin(elev), c * Math.cos(yaw)];
}

/** Rodrigues rotation of `v` about the unit axis `k`. */
export function rotAxis(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, v) * (1 - c);
  const kv = cross(k, v);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}

/** Random unit vector, uniform on the sphere. */
export function randomDir(rng: Rng): Vec3 {
  const y = rng.range(-1, 1), a = rng.range(0, TAU), r = Math.sqrt(1 - y * y);
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

export function pointAt(pts: readonly Vec3[], s: number): Vec3 {
  const f = Math.min(Math.max(s, 0), 1) * (pts.length - 1);
  const i = Math.min(Math.floor(f), pts.length - 2), t = f - i;
  return [lerp(pts[i][0], pts[i + 1][0], t), lerp(pts[i][1], pts[i + 1][1], t), lerp(pts[i][2], pts[i + 1][2], t)];
}

export function tangentAt(pts: readonly Vec3[], s: number): Vec3 {
  const i = Math.min(Math.floor(Math.min(Math.max(s, 0), 1) * (pts.length - 1)), pts.length - 2);
  return norm(sub(pts[i + 1], pts[i]));
}

/** Point on a near-vertical trunk at world height y. */
export function trunkAt(trunk: Limb, y: number): Vec3 {
  const p = trunk.pts;
  let i = 0;
  while (i < p.length - 2 && p[i + 1][1] < y) i++;
  const t = Math.min(Math.max((y - p[i][1]) / Math.max(p[i + 1][1] - p[i][1], 1e-6), 0), 1);
  return [lerp(p[i][0], p[i + 1][0], t), y, lerp(p[i][2], p[i + 1][2], t)];
}

export function trunkRadiusAt(trunk: Limb, y: number): number {
  const p = trunk.pts;
  let i = 0;
  while (i < p.length - 2 && p[i + 1][1] < y) i++;
  const t = Math.min(Math.max((y - p[i][1]) / Math.max(p[i + 1][1] - p[i][1], 1e-6), 0), 1);
  return lerp(trunk.radii[i], trunk.radii[i + 1], t);
}

/** Slightly leaning, wobbling trunk from just below ground (y = -0.3) up to `height`, with a root flare. */
function trunkLimb(rng: Rng, height: number, r0: number, r1: number, lean: number, wobble: number, n: number): Limb {
  const az = rng.range(0, TAU);
  const wx = rng.range(0, 100), wz = rng.range(0, 100);
  const pts: Vec3[] = [], radii: number[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, y = -0.3 + (height + 0.3) * f;
    const h = Math.max(y, 0) / height;
    const bend = lean * h * h;
    pts.push([Math.sin(az) * bend + wobble * Math.sin(f * 6.1 + wx), y, Math.cos(az) * bend + wobble * Math.sin(f * 5.3 + wz)]);
    radii.push((r1 + (r0 - r1) * Math.pow(1 - h, 1.25)) * (1 + 0.35 * Math.exp(-Math.max(y, 0) / 0.45)));
  }
  return { pts, radii, order: 0 };
}

/** Integrates a branch centreline: the direction is nudged by `bend(s)` (vertical bias, +up) and random wobble at every step. */
function growBranch(rng: Rng, base: Vec3, dir0: Vec3, length: number, segs: number, bend: (s: number) => number, wobble: number): Vec3[] {
  const pts: Vec3[] = [base];
  let d = norm(dir0), p = base;
  for (let i = 1; i <= segs; i++) {
    const s = i / segs;
    d = norm(add(add(d, mul(UP, bend(s) / segs)), mul(randomDir(rng), wobble / segs)));
    p = add(p, mul(d, length / segs));
    pts.push(p);
  }
  return pts;
}

function taper(r0: number, r1: number, n: number, power = 1): number[] {
  return Array.from({ length: n }, (_, i) => lerp(r0, r1, Math.pow(i / (n - 1), power)));
}

function crownFrom(points: readonly Vec3[], pad: number): { c: Vec3; r: Vec3 } {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
  }
  return { c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], r: [(x1 - x0) / 2 + pad, (y1 - y0) / 2 + pad, (z1 - z0) / 2 + pad] };
}

/** Whorled spruce: straight trunk, rings of drooping branches that shorten toward the top, three needle fronds per branch. */
export function sprucePlan(rng: Rng, height: number, reach: number): TreePlan {
  const trunk = trunkLimb(rng, height, 0.0165 * height + 0.03, 0.02, 0.35, 0.05, 12);
  const limbs: Limb[] = [trunk], fronds: Frond[] = [];
  const y0 = 0.13 * height, span = 0.855 * height;
  let y = y0, branch = 0;
  while (y < 0.985 * height) {
    const t = (y - y0) / span;
    const nb = t < 0.45 ? 7 : t < 0.8 ? 6 : 5;
    const L = Math.max(0.55, reach * height * Math.pow(1 - t, 0.85));
    const off = rng.range(0, TAU);
    for (let k = 0; k < nb; k++) {
      const yy = y + rng.range(-0.1, 0.1);
      const az = off + ((k + rng.range(-0.2, 0.2)) * TAU) / nb;
      const dir = pol(az, lerp(-0.12, 0.75, t * t));
      const base = add(trunkAt(trunk, yy), mul([dir[0], 0, dir[2]], trunkRadiusAt(trunk, yy) * 0.5));
      const pts = growBranch(rng, base, dir, L, 8, (s) => -0.75 * (1 - t) * (1 - s) + 1.1 * s * s * (0.5 + t), 0.2);
      const r = 0.012 + 0.014 * L;
      limbs.push({ pts, radii: taper(r, 0.005, 9), order: 1 });
      for (const s of [0.42, 0.72, 0.97]) {
        const tg = tangentAt(pts, s);
        const flen = Math.max(0.7, L * 0.46);
        fronds.push({ c: add(pointAt(pts, s), mul(tg, flen * 0.15)), t: tg, len: flen, width: flen * 0.95, branch });
      }
      branch++;
    }
    y += 0.8 * lerp(1, 0.42, t);
  }
  for (let i = 0; i < 4; i++) {
    const az = (i / 4) * TAU + rng.range(0, 0.6);
    const tg = norm(add(mul(UP, 3), pol(az, 0.2)));
    fronds.push({ c: add(trunkAt(trunk, height - 0.45), mul(tg, 0.5)), t: tg, len: 1.4, width: 1.1, branch });
  }
  const R = reach * height * 1.05;
  return {
    species: 'spruce', height, crownC: [0, 0.56 * height, 0], crownR: [R, 0.46 * height, R], trunkRadius: trunk.radii[1], bark: KIND.bark,
    limbs, fronds, clusters: [], cardsPerCluster: 0, cardSize: 0, radial: false, foliage: KIND.needle, trunkSides: [8, 6, 4],
  };
}

/** Scots pine: tall bare trunk, a sparse high crown of long limbs ending in radiating needle tufts. */
export function pinePlan(rng: Rng, height: number): TreePlan {
  const trunk = trunkLimb(rng, height, 0.0155 * height + 0.04, 0.02, 1.6, 0.12, 14);
  const limbs: Limb[] = [trunk], clusters: Cluster[] = [];
  const n = 17;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const yy = height * lerp(0.55, 0.96, t) + rng.range(-0.3, 0.3);
    const L = Math.max(1.4, lerp(4.6, 1.6, t) * rng.range(0.85, 1.15));
    const dir = pol(rng.range(0, TAU), lerp(0.05, 0.6, t));
    const base = trunkAt(trunk, yy);
    const pts = growBranch(rng, base, dir, L, 6, (s) => 0.35 + 0.5 * s - 0.6 * (1 - t), 0.45);
    limbs.push({ pts, radii: taper(0.03 + 0.012 * L, 0.01, 7), order: 1 });
    for (const s of [0.62, 0.86, 1]) clusters.push({ c: add(pointAt(pts, s), [0, 0.15, 0]), r: lerp(1.15, 0.8, t) });
  }
  clusters.push({ c: add(trunkAt(trunk, height), [0, 0.3, 0]), r: 0.9 });
  const crown = crownFrom(clusters.map((c) => c.c), 1);
  return {
    species: 'pine', height, crownC: crown.c, crownR: crown.r, trunkRadius: trunk.radii[1], bark: KIND.pineBark,
    limbs, fronds: [], clusters, cardsPerCluster: 9, cardSize: 1, radial: true, foliage: KIND.needle, trunkSides: [8, 6, 4],
  };
}
