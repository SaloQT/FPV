import type { Vec3 } from '../../contracts';
import { Rng } from '../../world/track/rng';
import { KIND, add, mul, norm } from './meshBuilder';
import { growPath, sprout, taperRadii, type Level, type Tip } from './treeBranch';
import { pol, randomDir, type Cluster, type Frond, type Limb, type TreePlan } from './treePlan';

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function crownOf(points: readonly Vec3[], pad: number): { c: Vec3; r: Vec3 } {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
  }
  return { c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], r: [(x1 - x0) / 2 + pad, (y1 - y0) / 2 + pad, (z1 - z0) / 2 + pad] };
}

/** Random point in the shell of the crown ellipsoid between radius fractions f0 and f1, above `minY`. */
function shellPoint(rng: Rng, c: Vec3, r: Vec3, f0: number, f1: number, minY: number): Vec3 {
  for (let i = 0; i < 12; i++) {
    const d = randomDir(rng), f = lerp(f0, f1, Math.cbrt(rng.next()));
    const p: Vec3 = [c[0] + d[0] * r[0] * f, c[1] + d[1] * r[1] * f, c[2] + d[2] * r[2] * f];
    if (p[1] >= minY) return p;
  }
  return [c[0], Math.max(c[1], minY), c[2]];
}

function foliageFromTips(rng: Rng, tips: readonly Tip[], fillers: number, minFillY: number, shell: [number, number]): { clusters: Cluster[]; c: Vec3; r: Vec3 } {
  const crown = crownOf(tips.map((t) => t.p), 0.8);
  const clusters: Cluster[] = tips.map((t) => ({ c: t.p, r: t.r }));
  const avg = tips.reduce((s, t) => s + t.r, 0) / Math.max(tips.length, 1);
  for (let i = 0; i < fillers; i++) clusters.push({ c: shellPoint(rng, crown.c, crown.r, shell[0], shell[1], minFillY), r: avg * rng.range(0.85, 1.1) });
  return { clusters, ...crown };
}

const OAK_LEVELS: readonly Level[] = [
  { count: 4, start: 0.22, end: 0.88, angle: [0.55, 1.05], length: [0.34, 0.52], segs: 6, bend: 0.3, wobble: 1.5, radius: 0.5, tipRadius: 0.02 },
  { count: 3, start: 0.18, end: 0.92, angle: [0.5, 1.0], length: [0.4, 0.62], segs: 5, bend: 0.1, wobble: 1.5, radius: 0.58, tipRadius: 0.012 },
  { count: 3, start: 0.15, end: 0.95, angle: [0.4, 0.9], length: [0.45, 0.72], segs: 3, bend: -0.1, wobble: 1.2, radius: 0.62, tipRadius: 0.006 },
];

/** Spreading broadleaf: short trunk with a root flare forking into limbs, then secondary and tertiary branches and twigs; leaf clusters at the twig ends. */
export function oakPlan(rng: Rng, height: number): TreePlan {
  const fy = 0.24 * height;
  const az0 = rng.range(0, TAU);
  const n = 14;
  const trunkPts: Vec3[] = Array.from({ length: n + 1 }, (_, i) => {
    const y = -0.3 + ((fy + 0.3) * i) / n, f = Math.max(y, 0) / fy;
    return [Math.sin(az0) * 0.5 * f * f + 0.05 * Math.sin(f * 7), y, Math.cos(az0) * 0.5 * f * f + 0.05 * Math.sin(f * 5)] as Vec3;
  });
  const r0 = 0.022 * height + 0.04;
  const trunk: Limb = { pts: trunkPts, radii: trunkPts.map((p) => lerp(r0, r0 * 0.7, Math.max(p[1], 0) / fy) * (1 + 0.55 * Math.exp(-Math.max(p[1], 0) / 0.5))), order: 0 };
  const limbs: Limb[] = [trunk], tips: Tip[] = [];
  const nl = rng.int(5, 6);
  for (let i = 0; i < nl; i++) {
    const az = az0 + ((i + rng.range(-0.25, 0.25)) * TAU) / nl;
    const low = i % 2 === 1;
    const length = height * (low ? rng.range(0.42, 0.52) : rng.range(0.38, 0.5));
    const from = trunkPts[n - (i % 3)];
    const pts = growPath(rng, from, pol(az, low ? rng.range(0.45, 0.8) : rng.range(1.05, 1.35)), length, 8, (s) => (low ? 0.55 : 0.9) - 1.5 * s, 1.4);
    const limb: Limb = { pts, radii: taperRadii(r0 * 0.45, 0.032, pts.length, 0.8), order: 1 };
    limbs.push(limb);
    sprout(rng, limb, { levels: OAK_LEVELS, order0: 1, tipRadius: { 3: 0.95, 4: 0.7 }, tipFrom: 3, limbs, tips });
  }
  const f = foliageFromTips(rng, tips, 30, trunkPts[n][1] + 0.2, [0.5, 1]);
  return {
    species: 'oak', height, crownC: f.c, crownR: f.r, trunkRadius: r0, bark: KIND.bark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 11, cardSize: 0.25, radial: false, foliage: KIND.leaf, trunkSides: [10, 6, 4],
  };
}

const BIRCH_LEVELS: readonly Level[] = [
  { count: 3, start: 0.25, end: 0.9, angle: [0.5, 0.95], length: [0.4, 0.6], segs: 4, bend: -0.9, wobble: 1.0, radius: 0.55, tipRadius: 0.01 },
  { count: 3, start: 0.2, end: 0.95, angle: [0.45, 0.9], length: [0.4, 0.65], segs: 3, bend: -1.2, wobble: 1.0, radius: 0.6, tipRadius: 0.006 },
];

/** Slim white-barked birch: thin curving trunk, ascending limbs with long drooping twigs and light, sparse leaf clusters. */
export function birchPlan(rng: Rng, height: number): TreePlan {
  const az0 = rng.range(0, TAU);
  const n = 14;
  const r0 = 0.0085 * height + 0.05;
  const pts: Vec3[] = [], radii: number[] = [];
  for (let i = 0; i <= n; i++) {
    const y = -0.3 + ((height + 0.3) * i) / n, h = Math.max(y, 0) / height;
    pts.push([Math.sin(az0) * 0.9 * h * h + 0.16 * Math.sin(h * 5.5), y, Math.cos(az0) * 0.9 * h * h + 0.16 * Math.sin(h * 4.1 + 1)]);
    radii.push(lerp(r0, 0.015, Math.pow(h, 0.8)) * (1 + 0.45 * Math.exp(-Math.max(y, 0) / 0.4)));
  }
  const trunk: Limb = { pts, radii, order: 0 };
  const limbs: Limb[] = [trunk], tips: Tip[] = [{ p: pts[n], r: 0.8, order: 0 }];
  const nb = 10;
  for (let i = 0; i < nb; i++) {
    const t = i / (nb - 1);
    const y = height * lerp(0.36, 0.93, t) + rng.range(-0.25, 0.25);
    const length = Math.max(0.9, lerp(2.8, 0.9, t) * rng.range(0.85, 1.15));
    const f = Math.min(Math.max((y + 0.3) / (height + 0.3), 0), 1) * n, k = Math.min(Math.floor(f), n - 1);
    const bp: Vec3 = [lerp(pts[k][0], pts[k + 1][0], f - k), y, lerp(pts[k][2], pts[k + 1][2], f - k)];
    const path = growPath(rng, bp, pol(rng.range(0, TAU), lerp(0.35, 0.95, t)), length, 5, (s) => 0.5 - 1.7 * s, 0.35);
    const limb: Limb = { pts: path, radii: taperRadii(0.03 + 0.02 * length, 0.008, path.length), order: 1 };
    limbs.push(limb);
    sprout(rng, limb, { levels: BIRCH_LEVELS, order0: 1, tipRadius: { 1: 0.7, 2: 0.6, 3: 0.55 }, tipFrom: 2, limbs, tips });
  }
  const f = foliageFromTips(rng, tips, 8, height * 0.4, [0.6, 1]);
  return {
    species: 'birch', height, crownC: f.c, crownR: f.r, trunkRadius: r0, bark: KIND.birchBark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 9, cardSize: 0.2, radial: false, foliage: KIND.leaf, trunkSides: [8, 5, 4],
  };
}

const BUSH_LEVELS: readonly Level[] = [
  { count: 3, start: 0.3, end: 0.9, angle: [0.5, 1.0], length: [0.4, 0.6], segs: 3, bend: 0.1, wobble: 0.4, radius: 0.6, tipRadius: 0.006 },
];

/** Rounded shrub: a fan of thin stems from the ground that fork once, with leaf clusters at the ends and throughout the volume. */
export function bushPlan(rng: Rng, height: number): TreePlan {
  const limbs: Limb[] = [], tips: Tip[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * TAU + rng.range(-0.3, 0.3);
    const pts = growPath(rng, [0, -0.1, 0], pol(az, rng.range(0.6, 1.2)), height * rng.range(0.42, 0.62), 4, (s) => 0.2 - 0.7 * s, 0.4);
    const limb: Limb = { pts, radii: taperRadii(0.028, 0.006, pts.length), order: 1 };
    limbs.push(limb);
    sprout(rng, limb, { levels: BUSH_LEVELS, order0: 1, tipRadius: { 1: 0.5, 2: 0.4 }, tipFrom: 1, limbs, tips });
  }
  const f = foliageFromTips(rng, tips, 9, 0.25, [0.5, 1]);
  return {
    species: 'bush', height, crownC: f.c, crownR: f.r, trunkRadius: 0.03, bark: KIND.bark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 6, cardSize: 0.17, radial: false, foliage: KIND.leaf, trunkSides: [4, 4, 3],
  };
}

/** Juniper-like conifer shrub: a star of upright needle fronds around a few stubby stems. */
export function juniperPlan(rng: Rng, height: number): TreePlan {
  const limbs: Limb[] = [], fronds: Frond[] = [];
  for (let i = 0; i < 3; i++) {
    const pts = growPath(rng, [0, -0.1, 0], pol(rng.range(0, TAU), 1.3), height * 0.45, 3, 0.2, 0.3);
    limbs.push({ pts, radii: taperRadii(0.03, 0.012, pts.length), order: 1 });
  }
  const nf = 20;
  for (let i = 0; i < nf; i++) {
    const t = norm(pol((i * 2.399963) % TAU, lerp(0.25, 1.25, ((i * 7) % nf) / nf)));
    const flen = height * rng.range(0.65, 0.95);
    fronds.push({ c: add([0, 0.03, 0], mul(t, flen * 0.5)), t, len: flen, width: flen * 0.7, branch: i });
  }
  const R = height * 0.5;
  return {
    species: 'juniper', height, crownC: [0, height * 0.5, 0], crownR: [R, height * 0.55, R], trunkRadius: 0.03, bark: KIND.bark,
    limbs, fronds, clusters: [], cardsPerCluster: 0, cardSize: 0, radial: false, foliage: KIND.needle, trunkSides: [4, 4, 3],
  };
}
