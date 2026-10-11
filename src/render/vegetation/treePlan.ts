import type { Vec3 } from '../../contracts';
import { Rng } from '../../world/track/rng';
import { KIND, add, cross, dot, mul, norm, sub } from './meshBuilder';

const TAU = Math.PI * 2;
const UP: Vec3 = [0, 1, 0];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * A woody segment: centreline, radius at each point, and its branching order (0 trunk or stem, 1 primary limb, 2 secondary, 3 twig).
 * A dead limb is bare grey wood with no leaves; a root runs from the trunk foot out into the ground.
 */
export interface Limb { pts: Vec3[]; radii: number[]; order: number; parent?: Limb; dead?: boolean; root?: boolean }
/** A conifer spray card pair: `c` is its centre, `t` the unit direction of the needle tips, `len` and `width` in metres. */
export interface Frond { c: Vec3; t: Vec3; len: number; width: number; branch: number }
/** A ball of leaf cards (or radial needle tufts) of radius `r` around `c`. */
export interface Cluster { c: Vec3; r: number }

export type Species = 'spruce' | 'pine' | 'oak' | 'birch' | 'beech' | 'snag' | 'bush' | 'juniper';

/** Root flare of a trunk foot: `count` root ridges up to `amp` of the trunk radius proud, fading out over `height` metres; `phase` turns them. */
export interface Flare { count: number; amp: number; height: number; phase: number }

export interface TreePlan {
  species: Species;
  height: number;
  /** Crown ellipsoid: centre and radii, used for shading normals, ambient occlusion and the LOD2 billboards. */
  crownC: Vec3;
  crownR: Vec3;
  /** Trunk radius at breast height (1.3 m), metres at scale 1. */
  trunkRadius: number;
  bark: number;
  limbs: Limb[];
  fronds: Frond[];
  clusters: Cluster[];
  /**
   * How many of the clusters (the first ones) the mid-distance LOD draws below the extreme tier, when the near crown carries more than a
   * mid-distance tree needs; unset, it draws them all.
   */
  midClusters?: number;
  /** Leaf cards per cluster, their half size (m), whether cards radiate from the cluster centre (pine tufts) and the atlas kind. */
  cardsPerCluster: number;
  cardSize: number;
  radial: boolean;
  foliage: number;
  /** Bark rings of the trunk at each LOD (LOD0..2). */
  trunkSides: [number, number, number];
  /** Root flare of the trunk (none for shrubs) and the relative height of the swellings of the trunk and thick limbs (0 for a smooth stem). */
  flare?: Flare;
  gnarl?: number;
}

/** The trunk runs on this far (m) below the ground at its foot, so it still meets the soil on the downhill side of a 30 degree slope. */
export const TRUNK_FOOT = -0.8;
/** Height (m) at which a trunk's radius is quoted (breast height, as foresters measure). */
export const BREAST_HEIGHT = 1.3;

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

/**
 * The extreme tier's fuller crown: a broadleaf also carries leaf clusters along its living branches, not only at the twig ends, so its crown
 * fills in to the density and depth of a real one. The wood and the existing clusters are unchanged; conifers keep their sprays.
 */
export function densify(plan: TreePlan): TreePlan {
  if (plan.foliage !== KIND.leaf || plan.radial || plan.clusters.length === 0) return plan;
  const r = (0.75 * plan.clusters.reduce((t, c) => t + c.r, 0)) / plan.clusters.length;
  // Two clusters along every living secondary and finer branch, and an inner layer along the outer half of each primary limb, so the crown
  // is leafy through its depth as well as at its rim.
  const extra: Cluster[] = [];
  for (const l of plan.limbs) {
    if (l.dead || l.root || l.order < 1) continue;
    for (const s of l.order === 1 ? [0.6, 0.85] : [0.35, 0.75]) extra.push({ c: pointAt(l.pts, s), r: l.order === 1 ? 1.2 * r : r });
  }
  return { ...plan, clusters: [...plan.clusters, ...extra] };
}

/**
 * Ring heights of a trunk from its foot below ground to `top`: close together over the root flare, where the shape changes fastest,
 * then `n` even steps to the top.
 */
export function trunkHeights(top: number, n: number): number[] {
  const ys = [TRUNK_FOOT, -0.15, 0.08, 0.3, 0.6, 1.0];
  const from = 1.0;
  for (let i = 1; i <= n; i++) ys.push(from + ((top - from) * i) / n);
  return ys;
}

/** Breast-height radius with the swelling of the flare (which rises a little above it on big trees) taken out. */
export const breastRadius = (trunk: Limb): number => trunkRadiusAt(trunk, BREAST_HEIGHT);

/** Leaning, wobbling trunk from below the ground up to `height`, swelling into its roots at the foot; `taperPower` above 1 keeps it stout for longer. */
export function trunkLimb(rng: Rng, height: number, r0: number, r1: number, lean: number, wobble: number, n: number, taperPower = 1.25): Limb {
  const az = rng.range(0, TAU);
  const wx = rng.range(0, 100), wz = rng.range(0, 100);
  const pts: Vec3[] = [], radii: number[] = [];
  for (const y of trunkHeights(height, n)) {
    const f = (y - TRUNK_FOOT) / (height - TRUNK_FOOT);
    const h = Math.max(y, 0) / height;
    const bend = lean * h * h;
    pts.push([Math.sin(az) * bend + wobble * Math.sin(f * 6.1 + wx), y, Math.cos(az) * bend + wobble * Math.sin(f * 5.3 + wz)]);
    radii.push((r1 + (r0 - r1) * Math.pow(1 - h, taperPower)) * (1 + 0.35 * Math.exp(-Math.max(y, 0) / 0.45)));
  }
  return { pts, radii, order: 0 };
}

/** The first ring frame of a tube along `pts` (mirrors meshBuilder.tube), so roots can be laid along the flare's ridges. */
function footFrame(pts: readonly Vec3[]): [Vec3, Vec3] {
  const t = norm(sub(pts[1], pts[0]));
  const nx = norm(cross(t, Math.abs(t[1]) < 0.95 ? UP : [1, 0, 0]));
  return [nx, cross(t, nx)];
}

/**
 * Surface roots: one along each root ridge of the flare, leaving the trunk at the ground and diving into it within about a trunk diameter,
 * so the foot of the tree grips the soil instead of standing on it like a post.
 */
/**
 * A log lying on the ground beside a tree: a snag's snapped top, a limb an old tree has shed, or a windthrown neighbour. It is drawn wood
 * only (no collider, no leaves; the near LOD only), half sunk into the litter, with snapped, narrower ends. It draws from its own stream
 * (`seed`), so the rest of the tree grows the same with or without it. `length` and `radius` are in metres at scale 1.
 */
export function fallenLog(seed: number, trunk: Limb, length: number, radius: number): Limb {
  const rng = new Rng(seed);
  const az = rng.range(0, TAU), side = rng.range(0.4, 1.2) * (rng.next() < 0.5 ? -1 : 1);
  const clear = trunkRadiusAt(trunk, 0.3) * 1.6 + radius + rng.range(0.3, 1.0);
  const d: Vec3 = [Math.sin(az), 0, Math.cos(az)], n: Vec3 = [Math.cos(az), 0, -Math.sin(az)];
  const start = add(mul(d, clear), mul(n, side));
  const pts: Vec3[] = [], radii: number[] = [];
  const bow = rng.range(-0.25, 0.25), segs = Math.max(4, Math.round(length / 0.8));
  for (let i = 0; i <= segs; i++) {
    const s = i / segs, r = radius * lerp(1, 0.7, s) * (i === 0 || i === segs ? 0.75 : 1);
    pts.push(add(add(start, mul(d, length * s)), [n[0] * bow * Math.sin(s * Math.PI), r * 0.45, n[2] * bow * Math.sin(s * Math.PI)]));
    radii.push(r);
  }
  return { pts, radii, order: 1, dead: true, parent: trunk };
}

export function surfaceRoots(rng: Rng, trunk: Limb, flare: Flare, reach: number): Limb[] {
  const [nx, bx] = footFrame(trunk.pts), r = trunkRadiusAt(trunk, 0.3), out: Limb[] = [];
  for (let k = 0; k < flare.count; k++) {
    if (rng.next() < 0.25) continue;
    // The draws are the same four per root as before the roots were reshaped, so the rest of the tree grows the same.
    const lengthDraw = (rng.range(0.75, 1.15) - 0.75) / 0.4, wig = rng.range(-1, 1), widthDraw = (rng.range(0.42, 0.55) - 0.42) / 0.13;
    // Roots leave the trunk at irregular angles and are of unequal size, so the foot is no regular star.
    const ang = (TAU * (k + 0.5 - flare.phase + 0.3 * wig)) / flare.count;
    const dir: Vec3 = [nx[0] * Math.cos(ang) + bx[0] * Math.sin(ang), 0, nx[2] * Math.cos(ang) + bx[2] * Math.sin(ang)];
    // A buttress root is broad where it leaves the trunk and is lost in the soil within one to two trunk radii of the flare.
    const d = norm(dir), base = trunkAt(trunk, 0.1), len = Math.min(reach, 0.3 + 1.5 * r) * (0.55 + 0.8 * lengthDraw), side = norm(cross(d, UP));
    const pts: Vec3[] = [], radii: number[] = [];
    const r0 = r * (0.3 + 0.35 * widthDraw);
    for (let i = 0; i <= 6; i++) {
      const s = i / 6, out = r * 0.3 + len * s, rr = r0 * lerp(1, 0.18, Math.pow(s, 0.7));
      // It rises out of the flare as a rounded ridge, runs down along the soil and dives in, narrowing fast. The lower trunk is sheared onto
      // the ground's plane (tree.wgsl footOnSlope), so on a slope the root follows the ground instead of standing out of it.
      const y = rr * lerp(0.3, -0.5, s) - rr * 1.6 * Math.pow(Math.max(0, (s - 0.45) / 0.55), 1.5);
      pts.push(add(add([base[0], y, base[2]], mul(d, out)), mul(side, 0.1 * wig * len * Math.sin(s * 3))));
      radii.push(rr);
    }
    out.push({ pts, radii, order: 1, root: true, parent: trunk });
  }
  return out;
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

/**
 * Dead side branches on a bare stretch of trunk from `y0` to `y1`: thin grey twigs that the shade of the crown above has killed, most of
 * them snapped short, the rest still reaching out and down. `whorls` gives conifer rings of them instead of a scatter.
 */
export function deadBranches(rng: Rng, trunk: Limb, y0: number, y1: number, count: number, reach: number, whorls: boolean): Limb[] {
  const out: Limb[] = [];
  const rings = whorls ? Math.max(1, Math.round(count / 4)) : count;
  for (let k = 0; k < rings; k++) {
    const y = lerp(y0, y1, (k + rng.range(0.2, 0.8)) / rings);
    const per = whorls ? rng.int(3, 5) : 1, off = rng.range(0, TAU);
    for (let j = 0; j < per; j++) {
      const az = off + (TAU * (j + rng.range(-0.2, 0.2))) / per;
      const snapped = rng.next() < 0.75;
      const len = reach * (snapped ? rng.range(0.06, 0.22) : rng.range(0.3, 0.7)) * lerp(1.15, 0.8, (y - y0) / Math.max(y1 - y0, 1e-3));
      const dir = pol(az, rng.range(-0.45, 0.05)), r = trunkRadiusAt(trunk, y);
      const base = add(trunkAt(trunk, y), mul([dir[0], 0, dir[2]], r * 0.6));
      const pts = growBranch(rng, base, dir, len, snapped ? 1 : 3, () => -0.3, 0.5);
      out.push({ pts, radii: taper(Math.min(0.012 + 0.02 * len, r * 0.4), snapped ? 0.009 : 0.003, pts.length), order: 1, dead: true, parent: trunk });
    }
  }
  return out;
}

/** How a spruce has grown: crown reach (fraction of height), where the live crown starts, dead twigs below it, hanging sprays, and lean. */
export interface SpruceForm { reach: number; crownBase: number; deadBelow: boolean; droop: number; lean: number }

/**
 * Whorled spruce: straight trunk, rings of branches that droop and turn up at their tips and shorten toward the top, three needle fronds per
 * branch. A forest-grown one has its live crown high up and a stretch of dead grey twigs below; an open-grown one is green to the ground.
 */
export function sprucePlan(rng: Rng, height: number, form: SpruceForm): TreePlan {
  const trunk = trunkLimb(rng, height, 0.0165 * height + 0.03, 0.02, form.lean, 0.05, 12);
  const limbs: Limb[] = [trunk], fronds: Frond[] = [];
  const y0 = form.crownBase * height, span = 0.985 * height - y0;
  let y = y0, branch = 0;
  while (y < 0.985 * height) {
    const t = (y - y0) / span;
    const nb = t < 0.45 ? 7 : t < 0.8 ? 6 : 5;
    const L = Math.max(0.55, form.reach * height * Math.pow(1 - t, 0.85));
    const off = rng.range(0, TAU);
    for (let k = 0; k < nb; k++) {
      const yy = y + rng.range(-0.1, 0.1);
      const az = off + ((k + rng.range(-0.2, 0.2)) * TAU) / nb;
      const dir = pol(az, lerp(-0.12, 0.75, t * t));
      const base = add(trunkAt(trunk, yy), mul([dir[0], 0, dir[2]], trunkRadiusAt(trunk, yy) * 0.5));
      const len = L * rng.range(0.85, 1.12);
      const pts = growBranch(rng, base, dir, len, 8, (s) => -0.75 * (1 - t) * (1 - s) + 1.1 * s * s * (0.5 + t), 0.2);
      const r = 0.012 + 0.014 * len;
      limbs.push({ pts, radii: taper(r, 0.005, 9), order: 1, parent: trunk });
      for (const s of [0.42, 0.72, 0.97]) {
        const tg = tangentAt(pts, s);
        // Lower sprays hang from their branch (the comb form of old spruces); the tips stay level.
        const hang = form.droop * (1 - t) * (1 - s * 0.6);
        const tip = norm(add(tg, [0, -hang, 0]));
        const flen = Math.max(0.7, len * 0.46);
        fronds.push({ c: add(pointAt(pts, s), mul(tip, flen * 0.15)), t: tip, len: flen, width: flen * 0.95, branch });
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
  if (form.deadBelow) limbs.push(...deadBranches(rng, trunk, 1.2, y0 - 0.3, Math.round((y0 - 1.5) / 1.1) * 2, form.reach * height * 0.55, true));
  const flare: Flare = { count: rng.int(5, 7), amp: 0.55, height: 0.5, phase: rng.next() };
  limbs.push(...surfaceRoots(rng, trunk, flare, 0.4 + 2.2 * trunk.radii[2]));
  // An old spruce stand has windthrown trunks lying in it.
  if (form.droop >= 1) limbs.push(fallenLog(Math.round(height * 997) + 3, trunk, 0.4 * height, 0.009 * height + 0.02));
  const R = form.reach * height * 1.05;
  return {
    species: 'spruce', height, crownC: [0, (y0 + height) / 2 + 0.03 * height, 0], crownR: [R, (height - y0) / 2 + 0.03 * height, R], trunkRadius: breastRadius(trunk),
    bark: KIND.spruceBark, limbs, fronds, clusters: [], cardsPerCluster: 0, cardSize: 0, radial: false, foliage: KIND.needle, trunkSides: [14, 6, 4],
    flare, gnarl: 0.025,
  };
}

/**
 * A Scots pine limb's side branches: two to four leave it between a third of the way out and near its end, rising and spreading, 0.6 to 1.8 m
 * long, and about half fork once more near their tip; every branch end carries a needle clump. That is what makes the clumped, dark crown
 * of a mature pine instead of a few tufts at the ends of bare limbs. The draws come from their own stream (`rng`), so the trunk, the limbs
 * and the clusters at the limb ends grow the same with or without them. `t` is the limb's place up the crown (0 bottom, 1 top).
 */
function pineSecondaries(rng: Rng, limb: Limb, length: number, t: number, limbs: Limb[], clusters: Cluster[]): void {
  const count = rng.int(2, 4), radius = lerp(0.6, 0.45, t);
  for (let k = 0; k < count; k++) {
    const s = lerp(0.3, 0.88, (k + rng.range(0.15, 0.85)) / count), at = pointAt(limb.pts, s), tg = tangentAt(limb.pts, s);
    const side = norm(cross(tg, UP)), flip = k % 2 === 0 ? 1 : -1;
    const dir = norm(add(add(tg, mul(side, flip * rng.range(0.6, 1.1))), [0, rng.range(0.25, 0.6), 0]));
    const len = Math.min(1.8, Math.max(0.6, length * rng.range(0.25, 0.42)));
    const pts = growBranch(rng, at, dir, len, 3, () => 0.35, 0.25);
    const branch: Limb = { pts, radii: taper(0.012 + 0.008 * len, 0.006, pts.length), order: 2, parent: limb };
    limbs.push(branch);
    // A clump at the tip and one along the branch's outer part.
    clusters.push({ c: add(pts[pts.length - 1], [0, 0.1, 0]), r: radius });
    clusters.push({ c: add(pointAt(pts, 0.55), [0, 0.08, 0]), r: radius * 0.85 });
    if (rng.next() < 0.5) {
      // A last fork near the tip, turned the other way: a tuft at the fork and one at its end.
      const fork = growBranch(rng, pointAt(pts, 0.7), norm(add(tangentAt(pts, 0.7), mul(side, -flip * 0.8))), len * 0.45, 2, () => 0.3, 0.2);
      limbs.push({ pts: fork, radii: taper(0.008, 0.005, fork.length), order: 3, parent: branch });
      clusters.push({ c: add(fork[fork.length - 1], [0, 0.08, 0]), r: radius * 0.8 });
      clusters.push({ c: add(fork[0], [0, 0.06, 0]), r: radius * 0.7 });
    }
  }
}

/** How a Scots pine has grown: where its crown starts, how many limbs, how far they reach, trunk lean and crookedness, and dead stubs below. */
export interface PineForm { crownStart: number; limbs: number; spread: number; lean: number; wobble: number; stubs: number }

/**
 * Scots pine: a tall trunk, grey and fissured below and orange-barked above (the bark shader follows the trunk radius), a high crown of
 * long crooked limbs ending in radiating needle tufts, and snapped-off stubs of old lower branches along the bare stretch.
 */
export function pinePlan(rng: Rng, height: number, form: PineForm): TreePlan {
  const trunk = trunkLimb(rng, height, 0.0155 * height + 0.04, 0.02, form.lean, form.wobble, 14, 1.1);
  const limbs: Limb[] = [trunk], clusters: Cluster[] = [];
  const n = form.limbs;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const yy = height * lerp(form.crownStart, 0.96, t) + rng.range(-0.3, 0.3);
    const L = Math.max(1.4, lerp(4.6, 1.6, t) * form.spread * rng.range(0.8, 1.2));
    const dir = pol(rng.range(0, TAU), lerp(0.05, 0.6, t));
    const base = trunkAt(trunk, yy);
    const pts = growBranch(rng, base, dir, L, 6, (s) => 0.35 + 0.5 * s - 0.6 * (1 - t), 0.45 + 0.3 * form.wobble);
    const limb: Limb = { pts, radii: taper(0.03 + 0.012 * L, 0.01, 7), order: 1, parent: trunk };
    limbs.push(limb);
    // Needles clothe the outer part of the limb in small clumps, not one big ball at its end.
    for (const s of [0.55, 0.7, 0.85, 1]) clusters.push({ c: add(pointAt(pts, s), [0, 0.12, 0]), r: lerp(0.65, 0.5, t) });
    pineSecondaries(new Rng(Math.round(height * 977) + 31 * i + 11), limb, L, t, limbs, clusters);
  }
  clusters.push({ c: add(trunkAt(trunk, height), [0, 0.3, 0]), r: 0.9 });
  if (form.stubs > 0) limbs.push(...deadBranches(rng, trunk, 2, height * form.crownStart - 0.5, form.stubs, 1.6, false));
  const crown = crownFrom(clusters.map((c) => c.c), 1);
  const flare: Flare = { count: rng.int(5, 6), amp: 0.32, height: 0.45, phase: rng.next() };
  limbs.push(...surfaceRoots(rng, trunk, flare, 0.3 + 1.8 * trunk.radii[2]));
  return {
    species: 'pine', height, crownC: crown.c, crownR: crown.r, trunkRadius: breastRadius(trunk), bark: KIND.pineBark,
    limbs, fronds: [], clusters, cardsPerCluster: 5, cardSize: 1, radial: true, foliage: KIND.needle, trunkSides: [14, 6, 4],
    flare, gnarl: 0.035,
  };
}
