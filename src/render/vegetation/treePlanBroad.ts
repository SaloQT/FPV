import type { Vec3 } from '../../contracts';
import { Rng } from '../../world/track/rng';
import { KIND, add, cross, mul, norm, sub } from './meshBuilder';
import { pointAt, pol, randomDir, tangentAt, type Cluster, type Frond, type Limb, type TreePlan } from './treePlan';

const TAU = Math.PI * 2;
const UP: Vec3 = [0, 1, 0];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function taper(r0: number, r1: number, n: number, power = 1): number[] {
  return Array.from({ length: n }, (_, i) => lerp(r0, r1, Math.pow(i / (n - 1), power)));
}

function grow(rng: Rng, base: Vec3, dir0: Vec3, length: number, segs: number, bend: (s: number) => number, wobble: number): Vec3[] {
  const pts: Vec3[] = [base];
  let d = norm(dir0), p = base;
  for (let i = 1; i <= segs; i++) {
    d = norm(add(add(d, mul(UP, bend(i / segs) / segs)), mul(randomDir(rng), wobble / segs)));
    p = add(p, mul(d, length / segs));
    pts.push(p);
  }
  return pts;
}

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

interface Tip { p: Vec3; r: number }

/** Recursively forks a limb into secondary and twig levels, collecting every branch end as a foliage tip. */
function fork(rng: Rng, limbs: Limb[], tips: Tip[], pts: Vec3[], radii: number[], order: number, twigs: number, tipR: number, droop: number): void {
  limbs.push({ pts, radii, order });
  tips.push({ p: pts[pts.length - 1], r: tipR });
  if (order >= 3) return;
  const at = rng.range(0.5, 0.7), tg = tangentAt(pts, at), base = pointAt(pts, at);
  const remain = (1 - at) * pts.length;
  for (let k = 0; k < twigs; k++) {
    const az = rng.range(0.6, 1.1) * (k === 0 ? 1 : -1);
    const perp = norm(cross(tg, UP));
    const dir = norm(add(mul(tg, Math.cos(az)), mul(perp, Math.sin(az))));
    const length = Math.max(0.8, (1 - at) * len3(pts) * rng.range(0.9, 1.3));
    const sub2 = grow(rng, base, dir, length, Math.max(3, Math.round(remain * 0.8)), (s) => 0.3 - droop * s, 0.5);
    fork(rng, limbs, tips, sub2, taper(radii[Math.floor(at * (radii.length - 1))] * 0.6, 0.015, sub2.length), order + 1, order >= 2 ? 0 : twigs, tipR * 0.8, droop);
  }
}

function len3(pts: readonly Vec3[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) { const d = sub(pts[i], pts[i - 1]); s += Math.hypot(d[0], d[1], d[2]); }
  return s;
}

function foliageFromTips(rng: Rng, tips: readonly Tip[], fillers: number, minFillY: number, shell: [number, number]): { clusters: Cluster[]; c: Vec3; r: Vec3 } {
  const crown = crownOf(tips.map((t) => t.p), 0.8);
  const clusters: Cluster[] = tips.map((t) => ({ c: t.p, r: t.r }));
  const avg = tips.reduce((s, t) => s + t.r, 0) / Math.max(tips.length, 1);
  for (let i = 0; i < fillers; i++) clusters.push({ c: shellPoint(rng, crown.c, crown.r, shell[0], shell[1], minFillY), r: avg * rng.range(0.85, 1.1) });
  return { clusters, ...crown };
}

/** Spreading broadleaf: short trunk forking into limbs, then secondary branches and twigs; dense leaf-card clusters at every end. */
export function oakPlan(rng: Rng, height: number): TreePlan {
  const fy = 0.24 * height;
  const az0 = rng.range(0, TAU);
  const n = 14;
  const trunkPts: Vec3[] = Array.from({ length: n + 1 }, (_, i) => {
    const y = -0.3 + ((fy + 0.3) * i) / n, f = Math.max(y, 0) / fy;
    return [Math.sin(az0) * 0.5 * f * f + 0.05 * Math.sin(f * 7), y, Math.cos(az0) * 0.5 * f * f + 0.05 * Math.sin(f * 5)] as Vec3;
  });
  const r0 = 0.028 * height + 0.05;
  const trunk: Limb = { pts: trunkPts, radii: trunkPts.map((p) => lerp(r0, r0 * 0.72, Math.max(p[1], 0) / fy) * (1 + 0.4 * Math.exp(-Math.max(p[1], 0) / 0.5))), order: 0 };
  const limbs: Limb[] = [trunk], tips: Tip[] = [];
  const top = trunkPts[n];
  const nl = rng.int(5, 6);
  for (let i = 0; i < nl; i++) {
    const az = az0 + ((i + rng.range(-0.25, 0.25)) * TAU) / nl;
    const low = i % 2 === 1;
    const length = height * (low ? rng.range(0.42, 0.52) : rng.range(0.38, 0.5));
    const pts = grow(rng, top, pol(az, low ? rng.range(0.4, 0.75) : rng.range(0.95, 1.25)), length, 7, (s) => (low ? 0.5 : 0.9) - 1.5 * s, 0.5);
    fork(rng, limbs, tips, pts, taper(r0 * 0.5, 0.06, pts.length, 0.8), 1, 2, 1.55, 0.5);
  }
  const f = foliageFromTips(rng, tips, 34, top[1] + 0.2, [0.5, 1]);
  return {
    species: 'oak', height, crownC: f.c, crownR: f.r, trunkRadius: r0, bark: KIND.bark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 30, cardSize: 0.38, radial: false, foliage: KIND.leaf, trunkSides: [8, 6, 4],
  };
}

/** Slim white-barked birch: thin curving trunk, ascending thin limbs with drooping twigs and light, sparse leaf clusters. */
export function birchPlan(rng: Rng, height: number): TreePlan {
  const az0 = rng.range(0, TAU);
  const n = 14;
  const r0 = 0.0085 * height + 0.05;
  const pts: Vec3[] = [], radii: number[] = [];
  for (let i = 0; i <= n; i++) {
    const y = -0.3 + ((height + 0.3) * i) / n, h = Math.max(y, 0) / height;
    pts.push([Math.sin(az0) * 0.9 * h * h + 0.16 * Math.sin(h * 5.5), y, Math.cos(az0) * 0.9 * h * h + 0.16 * Math.sin(h * 4.1 + 1)]);
    radii.push(lerp(r0, 0.015, Math.pow(h, 0.8)) * (1 + 0.3 * Math.exp(-Math.max(y, 0) / 0.4)));
  }
  const trunk: Limb = { pts, radii, order: 0 };
  const limbs: Limb[] = [trunk], tips: Tip[] = [];
  tips.push({ p: pts[n], r: 0.8 });
  const nb = 11;
  for (let i = 0; i < nb; i++) {
    const t = i / (nb - 1);
    const y = height * lerp(0.36, 0.93, t) + rng.range(-0.25, 0.25);
    const length = Math.max(0.9, lerp(2.6, 0.9, t) * rng.range(0.85, 1.15));
    const bp = pointAt(pts, (y + 0.3) / (height + 0.3));
    const branch = grow(rng, bp, pol(rng.range(0, TAU), lerp(0.35, 0.95, t)), length, 5, (s) => 0.5 - 1.7 * s, 0.35);
    fork(rng, limbs, tips, branch, taper(0.03 + 0.02 * length, 0.008, branch.length), 2, 1, 0.75, 0.9);
  }
  const f = foliageFromTips(rng, tips, 8, height * 0.4, [0.6, 1]);
  return {
    species: 'birch', height, crownC: f.c, crownR: f.r, trunkRadius: r0, bark: KIND.birchBark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 15, cardSize: 0.28, radial: false, foliage: KIND.leaf, trunkSides: [7, 5, 4],
  };
}

/** Rounded shrub: a fan of thin stems from the ground and leaf clusters at the ends and throughout the volume. */
export function bushPlan(rng: Rng, height: number): TreePlan {
  const limbs: Limb[] = [], tips: Tip[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * TAU + rng.range(-0.3, 0.3);
    const pts = grow(rng, [0, -0.1, 0], pol(az, rng.range(0.75, 1.3)), height * rng.range(0.55, 0.85), 4, (s) => 0.2 - 0.7 * s, 0.4);
    limbs.push({ pts, radii: taper(0.028, 0.006, pts.length), order: 1 });
    tips.push({ p: pts[pts.length - 1], r: 0.55 });
  }
  const f = foliageFromTips(rng, tips, 9, 0.25, [0.5, 1]);
  return {
    species: 'bush', height, crownC: f.c, crownR: f.r, trunkRadius: 0.03, bark: KIND.bark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 9, cardSize: 0.2, radial: false, foliage: KIND.leaf, trunkSides: [4, 4, 3],
  };
}

/** Juniper-like conifer shrub: a star of upright needle fronds around a few stubby stems. */
export function juniperPlan(rng: Rng, height: number): TreePlan {
  const limbs: Limb[] = [], fronds: Frond[] = [];
  for (let i = 0; i < 3; i++) {
    const pts = grow(rng, [0, -0.1, 0], pol(rng.range(0, TAU), 1.3), height * 0.45, 3, () => 0.2, 0.3);
    limbs.push({ pts, radii: taper(0.03, 0.012, pts.length), order: 1 });
  }
  const n = 20;
  for (let i = 0; i < n; i++) {
    const t = norm(pol((i * 2.399963) % TAU, lerp(0.25, 1.25, ((i * 7) % n) / n)));
    const flen = height * rng.range(0.65, 0.95);
    fronds.push({ c: add([0, 0.03, 0], mul(t, flen * 0.5)), t, len: flen, width: flen * 0.7, branch: i });
  }
  const R = height * 0.5;
  return {
    species: 'juniper', height, crownC: [0, height * 0.5, 0], crownR: [R, height * 0.55, R], trunkRadius: 0.03, bark: KIND.bark,
    limbs, fronds, clusters: [], cardsPerCluster: 0, cardSize: 0, radial: false, foliage: KIND.needle, trunkSides: [4, 4, 3],
  };
}
