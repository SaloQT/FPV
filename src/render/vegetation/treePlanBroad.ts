import type { Vec3 } from '../../contracts';
import { Rng } from '../../world/track/rng';
import { KIND, add, mul, norm } from './meshBuilder';
import { growPath, killLimb, sprout, taperRadii, type Level, type Tip } from './treeBranch';
import { breastRadius, fallenLog, pointAt, pol, randomDir, surfaceRoots, trunkHeights, type Cluster, type Flare, type Frond, type Limb, type TreePlan } from './treePlan';

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

/**
 * Leaf clusters at the branch tips plus `fillers` more. Fillers go in the shell of the crown, or (the share `clump` of them) next to a tip, outward and
 * up from it, so the leaves gather into masses round the branch sprays with sky between them rather than an even shell.
 */
function foliageFromTips(rng: Rng, tips: readonly Tip[], fillers: number, minFillY: number, shell: [number, number], clump = 0): { clusters: Cluster[]; c: Vec3; r: Vec3 } {
  const crown = crownOf(tips.map((t) => t.p), 0.8);
  const clusters: Cluster[] = tips.map((t) => ({ c: t.p, r: t.r }));
  const avg = tips.reduce((s, t) => s + t.r, 0) / Math.max(tips.length, 1);
  for (let i = 0; i < fillers; i++) {
    if (i < fillers * clump && tips.length > 0) {
      const t = tips[rng.int(0, tips.length - 1)];
      const out = norm([t.p[0] - crown.c[0], 0.6 * Math.max(t.p[1] - crown.c[1], 0) + 0.5, t.p[2] - crown.c[2]]);
      // Kept within a cluster's width of the tip, so the leaves hang on the spray's own twigs instead of floating past it.
      const d = norm(add(out, mul(randomDir(rng), 0.9)));
      clusters.push({ c: add(t.p, mul(d, t.r * rng.range(0.35, 0.8))), r: t.r * rng.range(0.85, 1.1) });
    } else clusters.push({ c: shellPoint(rng, crown.c, crown.r, shell[0], shell[1], minFillY), r: avg * rng.range(0.85, 1.1) });
  }
  return { clusters, ...crown };
}

/**
 * A short broadleaf bole from below the ground to the fork at `fy`, curving gently toward `az`, with the root swell at its foot. `r0` is its
 * radius at the ground, `crook` how far it wanders sideways (m).
 */
function bole(fy: number, r0: number, az: number, crook: number, rng: Rng): Limb {
  const wx = rng.range(0, 10), wz = rng.range(0, 10);
  const pts: Vec3[] = trunkHeights(fy, 8).map((y) => {
    const f = Math.max(y, 0) / fy;
    return [Math.sin(az) * crook * f * f + 0.05 * Math.sin(f * 7 + wx), y, Math.cos(az) * crook * f * f + 0.05 * Math.sin(f * 5 + wz)] as Vec3;
  });
  return { pts, radii: pts.map((p) => lerp(r0, r0 * 0.7, Math.max(p[1], 0) / fy) * (1 + 0.55 * Math.exp(-Math.max(p[1], 0) / 0.5))), order: 0 };
}

/**
 * Inner branches die in the shade of the crown and the odd big limb dies or snaps on an old tree: `big` is the chance per primary limb,
 * `small` per secondary branch. Dead wood keeps its main twigs and loses its leaves. The draws come from their own stream (`seed`), so the
 * living crown grows the same whatever dies in it.
 */
function deadwood(seed: number, limbs: Limb[], tips: Tip[], big: number, small: number): void {
  const rng = new Rng(seed);
  // A limb that forks into further limbs (an oak's scaffold) is not killed whole; its arms are, one by one.
  const forks = new Set(limbs.filter((l) => l.order === 1).map((l) => l.parent));
  for (const l of limbs.filter((l) => l.order === 1 && !l.root && !forks.has(l))) if (rng.next() < big) killLimb(limbs, tips, l, 2, rng.next() < 0.6 ? rng.range(0.35, 0.85) : 1);
  for (const l of limbs.filter((l) => l.order === 2 && !l.dead)) if (rng.next() < small) killLimb(limbs, tips, l, 3, rng.next() < 0.5 ? rng.range(0.3, 0.8) : 1);
}

// Branches on an oak's scaffold limbs: crooked secondaries, then the twiggy sprays that carry the leaf masses. The high wobble over few
// segments gives the angular, zig-zag growth of oak wood rather than smooth curves.
const OAK_LEVELS: readonly Level[] = [
  { count: 3, start: 0.25, end: 0.9, angle: [0.6, 1.1], length: [0.4, 0.6], segs: 5, bend: 0.35, wobble: 2.4, radius: 0.55, tipRadius: 0.02 },
  { count: 3, start: 0.2, end: 0.92, angle: [0.5, 1.0], length: [0.42, 0.65], segs: 4, bend: 0.1, wobble: 2.0, radius: 0.58, tipRadius: 0.012 },
  { count: 2, start: 0.3, end: 0.95, angle: [0.4, 0.9], length: [0.5, 0.75], segs: 3, bend: -0.1, wobble: 1.4, radius: 0.62, tipRadius: 0.006 },
];

// Branches off the short first stretch of a scaffold limb, before it forks: long for where they start, reaching up into the middle of the
// crown and out between the arms.
const OAK_INNER: Level = { count: 2, start: 0.4, end: 0.95, angle: [0.6, 1.1], length: [0.9, 1.3], segs: 4, bend: 0.4, wobble: 2.0, radius: 0.45, tipRadius: 0.02 };

// Leaf clusters an oak's mid-distance LOD draws: about what the whole crown had before the near crown was filled out, so the many trees at
// mid distance cost what they did.
const OAK_MID_CLUSTERS = 250;

/** The same items with an evenly strided `n` of them moved to the front, in their order, then the rest. */
function spreadFirst<T>(items: readonly T[], n: number): T[] {
  const first: T[] = [], rest: T[] = [];
  items.forEach((item, i) => (Math.floor(((i + 1) * n) / items.length) > Math.floor((i * n) / items.length) ? first : rest).push(item));
  return [...first, ...rest];
}

/**
 * The radii of a limb whose cross-section holds until it gives off branches, then falls away toward the tip, as the pipe model has it: the
 * wood a limb carries is the sum of the wood of what grows from it.
 */
function heavyRadii(r0: number, r1: number, n: number): number[] {
  return taperRadii(r0, r1, n, 1.7);
}

/** Points of a crooked limb: straight runs with abrupt changes of direction at each node, rising by `bend` (as growPath). */
function crookedPath(rng: Rng, base: Vec3, dir0: Vec3, length: number, segs: number, bend: (s: number) => number, kink: number): Vec3[] {
  return growPath(rng, base, dir0, length, segs, bend, kink * segs * 0.5);
}

/**
 * How an oak has grown. `fork` is where the bole divides (fraction of height), `limbs` the range of primary limbs, `reach` their length,
 * `upright` how steeply they rise, `trunk` the bole's girth, `dead` the share of dead and broken wood, `gnarl` how lumpy the bole is.
 */
export interface OakForm { fork: number; limbs: [number, number]; reach: number; upright: number; trunk: number; dead: number; gnarl: number }

/**
 * Spreading oak: a short stout bole with a root flare forking into crooked limbs, then secondary and tertiary branches and twigs, leaf clusters
 * at the twig ends. Open-grown oaks fork low into a broad crown; forest oaks carry a taller bole and a narrower, higher crown; veterans are
 * squat and thick with dead and snapped limbs (stag-headed).
 */
export function oakPlan(rng: Rng, height: number, form: OakForm): TreePlan {
  const fy = form.fork * height;
  const az0 = rng.range(0, TAU);
  const r0 = (0.028 * height + 0.05) * form.trunk;
  const trunk = bole(fy, r0, az0, 0.5, rng);
  const top = trunk.pts.length - 1;
  const limbs: Limb[] = [trunk], tips: Tip[] = [];
  // The bole divides into a few heavy scaffold limbs; their cross-sections together carry the bole's (pipe model), so each is well over
  // half its girth. Each runs crooked out and up for a stretch, then forks again into two, and those carry the branches and leaf masses.
  const nl = rng.int(form.limbs[0], form.limbs[1]), scaffolds = nl;
  const rFork = r0 * 0.72, weights = Array.from({ length: scaffolds }, () => rng.range(0.8, 1.2)), wsum = weights.reduce((a, b) => a + b, 0);
  const options = { levels: OAK_LEVELS.slice(0, 2), order0: 1, tipRadius: { 3: 0.95 }, tipFrom: 3, limbs, tips };
  for (let i = 0; i < scaffolds; i++) {
    const az = az0 + ((i + rng.range(-0.1, 0.1)) * TAU) / scaffolds;
    const rLimb = rFork * Math.sqrt(weights[i] / wsum) * 1.15;
    const reach = height * form.reach * rng.range(0.6, 0.72) * Math.sqrt(weights[i] / (wsum / scaffolds));
    const from = trunk.pts[top - (i % 2)];
    const elev = rng.range(0.35, 0.7) + 0.6 * form.upright;
    const split = rng.range(0.32, 0.5);
    const pts = crookedPath(rng, from, pol(az, Math.min(elev, 1.45)), reach * split, 4, () => 0.35 + form.upright, 0.55);
    const limb: Limb = { pts, radii: heavyRadii(rLimb, rLimb * 0.8, pts.length), order: 1, parent: trunk };
    limbs.push(limb);
    // Inner branches off the scaffold itself fill the middle and the top of the dome.
    sprout(rng, limb, { ...options, levels: [OAK_INNER, OAK_LEVELS[1]] });
    // The fork: two arms of unequal weight, one rising, one spreading, their girths again adding up to the limb's.
    const tg = norm([pts[4][0] - pts[3][0], pts[4][1] - pts[3][1], pts[4][2] - pts[3][2]]);
    const heading = Math.atan2(tg[0], tg[2]), climb = Math.asin(Math.max(-1, Math.min(1, tg[1])));
    const share = rng.range(0.35, 0.5);
    for (const [k, w] of [[0, 1 - share], [1, share]] as const) {
      const side = (k === 0 ? 1 : -1) * rng.range(0.4, 0.8);
      const armElev = k === 0 ? Math.min(climb + rng.range(0.2, 0.45), 1.3) : Math.max(climb - rng.range(0.3, 0.6), 0.05);
      const dir = pol(heading + side, Math.max(-0.2, Math.min(1.4, armElev)));
      // The spreading arm reaches furthest; the rising one is shorter, so the crown grows wide rather than tall.
      const armLen = reach * (1 - split) * (k === 0 ? rng.range(0.95, 1.1) : rng.range(1.0, 1.2));
      const armPts = crookedPath(rng, pts[4], dir, armLen, 6, (s) => (k === 0 ? 0.4 : 0.45) + form.upright - 0.9 * s, 0.45);
      const rArm = rLimb * 0.8 * Math.sqrt(w) * 1.1;
      const arm: Limb = { pts: armPts, radii: heavyRadii(rArm, 0.03, armPts.length), order: 1, parent: limb };
      limbs.push(arm);
      sprout(rng, arm, options);
    }
  }
  // Leaves grow all along the outer sprays and the secondary branches, not only at their ends, so the masses fill out.
  for (const l of limbs) {
    if (l.order === 3) for (const s of [0.3, 0.55, 0.8]) tips.push({ p: pointAt(l.pts, s), r: 0.85, order: 3, limb: l });
    if (l.order === 2) tips.push({ p: pointAt(l.pts, 0.7), r: 0.9, order: 2, limb: l });
  }
  deadwood(Math.round(height * 977 + form.dead * 131), limbs, tips, form.dead, 0.05 + 0.25 * form.dead);
  const flare: Flare = { count: rng.int(5, 7), amp: 0.75, height: 1.0, phase: rng.next() };
  limbs.push(...surfaceRoots(rng, trunk, flare, 0.5 + 2.5 * r0));
  const f = foliageFromTips(rng, tips, Math.round(420 * (1 - 0.6 * form.dead)), trunk.pts[top][1] + 0.2, [0.45, 0.92], 0.4);
  // An old oak sheds big limbs, which lie under it for years.
  if (form.dead >= 0.3) limbs.push(fallenLog(Math.round(height * 991) + 7, trunk, 0.35 * height, 0.35 * r0));
  // The mid-distance LOD draws an even share of the clusters (as many as the crown had before it was filled out for the near LOD).
  const mid = Math.min(f.clusters.length, OAK_MID_CLUSTERS), clusters = spreadFirst(f.clusters, mid);
  return {
    species: 'oak', height, crownC: f.c, crownR: f.r, trunkRadius: breastRadius(trunk), bark: KIND.bark,
    limbs, fronds: [], clusters, midClusters: mid, cardsPerCluster: 11, cardSize: 0.45, radial: false, foliage: KIND.leaf, trunkSides: [16, 6, 4],
    flare, gnarl: form.gnarl,
  };
}

const BEECH_LEVELS: readonly Level[] = [
  { count: 3, start: 0.25, end: 0.9, angle: [0.4, 0.8], length: [0.42, 0.62], segs: 5, bend: 0.25, wobble: 0.55, radius: 0.55, tipRadius: 0.02 },
  { count: 3, start: 0.2, end: 0.95, angle: [0.55, 1.0], length: [0.4, 0.62], segs: 4, bend: -0.15, wobble: 0.6, radius: 0.58, tipRadius: 0.01 },
  { count: 3, start: 0.2, end: 0.95, angle: [0.6, 1.1], length: [0.45, 0.7], segs: 3, bend: -0.35, wobble: 0.5, radius: 0.6, tipRadius: 0.005 },
];

/** How a beech has grown: where the smooth bole forks (fraction of height) and how far its limbs reach. */
export interface BeechForm { fork: number; reach: number }

/**
 * Beech: a straight, smooth, elephant-grey bole with a broad buttressed foot, forking into several steeply rising limbs whose branches
 * fan out into flat, layered sprays under a domed crown. Forest beeches fork high on a long clean bole; open-grown ones low and wide.
 */
export function beechPlan(rng: Rng, height: number, form: BeechForm): TreePlan {
  const fy = form.fork * height;
  const az0 = rng.range(0, TAU);
  const r0 = 0.02 * height + 0.05;
  const trunk = bole(fy, r0, az0, 0.15, rng);
  const top = trunk.pts.length - 1;
  const limbs: Limb[] = [trunk], tips: Tip[] = [];
  const nl = rng.int(4, 6);
  for (let i = 0; i < nl; i++) {
    const az = az0 + ((i + rng.range(-0.3, 0.3)) * TAU) / nl;
    const length = (height - fy) * rng.range(0.7, 0.95) * (0.55 + form.reach * 0.6);
    const from = trunk.pts[top - (i % 2)];
    const pts = growPath(rng, from, pol(az, rng.range(0.85, 1.25)), length, 8, (s) => 0.35 - 1.2 * s * (1.2 - form.reach), 0.5);
    const limb: Limb = { pts, radii: taperRadii(r0 * 0.5, 0.03, pts.length, 0.75), order: 1, parent: trunk };
    limbs.push(limb);
    sprout(rng, limb, { levels: BEECH_LEVELS, order0: 1, tipRadius: { 2: 0.9, 3: 0.85, 4: 0.7 }, tipFrom: 3, limbs, tips });
  }
  deadwood(Math.round(height * 977 + 17), limbs, tips, 0.03, 0.08);
  const flare: Flare = { count: rng.int(5, 7), amp: 0.42, height: 0.85, phase: rng.next() };
  limbs.push(...surfaceRoots(rng, trunk, flare, 0.5 + 2.5 * r0));
  const f = foliageFromTips(rng, tips, 34, trunk.pts[top][1] + 0.5, [0.55, 1]);
  return {
    species: 'beech', height, crownC: f.c, crownR: f.r, trunkRadius: breastRadius(trunk), bark: KIND.beechBark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 10, cardSize: 0.3, radial: false, foliage: KIND.leaf, trunkSides: [16, 6, 4],
    flare, gnarl: 0.02,
  };
}

const birchLevels = (weep: number): readonly Level[] => [
  { count: 3, start: 0.25, end: 0.9, angle: [0.5, 0.95], length: [0.4, 0.6], segs: 4, bend: -0.9 - 0.6 * weep, wobble: 1.0, radius: 0.55, tipRadius: 0.01 },
  { count: 3, start: 0.2, end: 0.95, angle: [0.45, 0.9], length: [0.4 + 0.25 * weep, 0.65 + 0.35 * weep], segs: 3, bend: -1.2 - 1.6 * weep, wobble: 1.0, radius: 0.6, tipRadius: 0.006 },
];

/** How a birch has grown: how many stems rise from its foot (coppiced or self-sown clumps have two or three) and how much its twigs hang. */
export interface BirchForm { stems: number; weep: number }

/**
 * One slim birch stem from `base`, leaning toward `az` by `lean` (m at the top) and wandering with phase `ph`. A lone stem bows over toward its
 * top; the stems of a clump splay out from the foot and then rise.
 */
function birchStem(height: number, r0: number, az: number, lean: number, base: Vec3, ph: number, splay: boolean): Limb {
  const pts: Vec3[] = [], radii: number[] = [];
  for (const y of trunkHeights(height, 9)) {
    const h = Math.max(y, 0) / height;
    const bow = splay ? h * (2 - h) : h * h;
    pts.push([base[0] + Math.sin(az) * lean * bow + 0.16 * Math.sin(h * 5.5 + ph), y, base[2] + Math.cos(az) * lean * bow + 0.16 * Math.sin(h * 4.1 + 1 + ph)]);
    radii.push(lerp(r0, 0.015, Math.pow(h, 0.8)) * (1 + 0.45 * Math.exp(-Math.max(y, 0) / 0.4)));
  }
  return { pts, radii, order: 0 };
}

/**
 * Slim white-barked birch: thin curving stems, ascending limbs with long drooping twigs and light, sparse leaf clusters. A clump has two or
 * three stems splaying out from one foot; a weeping one (old silver birch) has long curtains of hanging twigs.
 */
export function birchPlan(rng: Rng, height: number, form: BirchForm): TreePlan {
  const az0 = rng.range(0, TAU);
  const r0 = (0.0085 * height + 0.05) * (form.stems > 1 ? 0.78 : 1);
  const levels = birchLevels(form.weep);
  const limbs: Limb[] = [], tips: Tip[] = [];
  const stems: Limb[] = [];
  for (let k = 0; k < form.stems; k++) {
    const az = form.stems > 1 ? az0 + (k * TAU) / form.stems + rng.range(-0.4, 0.4) : az0;
    const h = height * (k === 0 ? 1 : rng.range(0.78, 0.95));
    const lean = form.stems > 1 ? h * rng.range(0.1, 0.18) : 0.9;
    const base: Vec3 = form.stems > 1 ? [Math.sin(az) * r0 * 0.7, 0, Math.cos(az) * r0 * 0.7] : [0, 0, 0];
    const stem = birchStem(h, r0 * (k === 0 ? 1 : 0.85), az, lean, base, form.stems > 1 ? rng.range(0, TAU) : 0, form.stems > 1);
    stems.push(stem); limbs.push(stem);
    tips.push({ p: stem.pts[stem.pts.length - 1], r: 0.8, order: 0, limb: stem });
    const nb = form.stems > 1 ? 7 : 10;
    for (let i = 0; i < nb; i++) {
      const t = i / (nb - 1);
      const y = h * lerp(0.36, 0.93, t) + rng.range(-0.25, 0.25);
      const length = Math.max(0.9, lerp(2.8, 0.9, t) * rng.range(0.85, 1.15) * (form.stems > 1 ? 0.8 : 1));
      // Branches on a clump's stems grow away from the other stems, toward the light.
      const yaw = form.stems > 1 ? az + rng.range(-1.6, 1.6) : rng.range(0, TAU);
      const bp = stemAt(stem, y);
      const path = growPath(rng, bp, pol(yaw, lerp(0.35, 0.95, t)), length, 5, (s) => 0.5 - (1.7 + 1.2 * form.weep) * s, 0.35);
      const limb: Limb = { pts: path, radii: taperRadii(0.03 + 0.02 * length, 0.008, path.length), order: 1, parent: stem };
      limbs.push(limb);
      sprout(rng, limb, { levels, order0: 1, tipRadius: { 1: 0.7, 2: 0.6, 3: 0.55 }, tipFrom: 2, limbs, tips });
    }
  }
  deadwood(Math.round(height * 977 + 29 * form.stems), limbs, tips, 0.03, 0.05);
  const flare: Flare = { count: rng.int(4, 6), amp: 0.25, height: 0.35, phase: rng.next() };
  if (form.stems === 1) limbs.push(...surfaceRoots(rng, stems[0], flare, 0.3 + 1.5 * r0));
  const f = foliageFromTips(rng, tips, 8, height * 0.4, [0.6, 1]);
  return {
    species: 'birch', height, crownC: f.c, crownR: f.r, trunkRadius: breastRadius(stems[0]), bark: KIND.birchBark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 9, cardSize: 0.25, radial: false, foliage: KIND.leaf, trunkSides: [12, 5, 4],
    flare: form.stems === 1 ? flare : { ...flare, amp: 0.12 }, gnarl: 0.02,
  };
}

/** Point on a near-vertical stem at height y. */
function stemAt(stem: Limb, y: number): Vec3 {
  const p = stem.pts;
  let i = 0;
  while (i < p.length - 2 && p[i + 1][1] < y) i++;
  const t = Math.min(Math.max((y - p[i][1]) / Math.max(p[i + 1][1] - p[i][1], 1e-6), 0), 1);
  return [lerp(p[i][0], p[i + 1][0], t), y, lerp(p[i][2], p[i + 1][2], t)];
}

/**
 * How a standing dead tree looks: a conifer trunk snapped at `broken` of the height it grew to, with whorls of dead stubs, or a dead broadleaf's
 * bare crown of snapped limbs.
 */
export interface SnagForm { conifer: boolean; broken: number }

/**
 * A standing dead tree (snag) about `height` metres tall: bark sloughing off grey weathered wood, no leaves. A conifer snag is a tall trunk
 * snapped part way up with rings of dead branch stubs; a broadleaf snag keeps its bole and a few limbs, most of them broken off.
 */
export function snagPlan(rng: Rng, height: number, form: SnagForm): TreePlan {
  const limbs: Limb[] = [], tips: Tip[] = [];
  let trunk: Limb;
  if (form.conifer) {
    const full = height / form.broken, top = height, r0 = 0.0165 * full + 0.05;
    const pts: Vec3[] = [], radii: number[] = [];
    const az = rng.range(0, TAU), wx = rng.range(0, 10);
    for (const y of trunkHeights(top, 10)) {
      const h = Math.max(y, 0) / full;
      pts.push([Math.sin(az) * 0.5 * h * h + 0.04 * Math.sin(h * 9 + wx), y, Math.cos(az) * 0.5 * h * h + 0.04 * Math.cos(h * 7 + wx)]);
      radii.push((0.02 + (r0 - 0.02) * Math.pow(1 - h, 1.2)) * (1 + 0.35 * Math.exp(-Math.max(y, 0) / 0.45)));
    }
    // The snapped top: splintered, narrower than the wood below.
    radii[radii.length - 1] *= 0.4;
    trunk = { pts, radii, order: 0, dead: true };
    limbs.push(trunk);
    for (let y = 1.5; y < top - 0.6; y += rng.range(0.5, 0.9)) {
      const per = rng.int(2, 4), off = rng.range(0, TAU);
      for (let j = 0; j < per; j++) {
        const len = rng.next() < 0.75 ? rng.range(0.1, 0.35) : rng.range(0.6, 1.6) * (1 - y / full);
        const dir = pol(off + (TAU * j) / per + rng.range(-0.3, 0.3), rng.range(-0.5, 0.1));
        const base = stemAt(trunk, y);
        const p = growPath(rng, base, dir, len, len > 0.5 ? 3 : 1, -0.3, 0.4);
        limbs.push({ pts: p, radii: taperRadii(Math.min(0.015 + 0.02 * len, 0.05), 0.006, p.length), order: 1, dead: true, parent: trunk });
      }
    }
  } else {
    // A dead broadleaf has lost its twigs and the ends of its limbs: it stands about three quarters as tall as it grew.
    const full = height / 0.72, fy = full * 0.3, r0 = 0.022 * full + 0.05, az0 = rng.range(0, TAU);
    trunk = { ...bole(fy, r0, az0, 0.4, rng), dead: true };
    limbs.push(trunk);
    const top = trunk.pts.length - 1;
    for (let i = 0; i < 4; i++) {
      const az = az0 + ((i + rng.range(-0.3, 0.3)) * TAU) / 4;
      const pts = growPath(rng, trunk.pts[top - (i % 2)], pol(az, rng.range(0.7, 1.25)), full * rng.range(0.3, 0.5), 7, (s) => 0.6 - 1.2 * s, 1.2);
      const limb: Limb = { pts, radii: taperRadii(r0 * 0.45, 0.03, pts.length, 0.8), order: 1, parent: trunk };
      limbs.push(limb);
      sprout(rng, limb, { levels: OAK_LEVELS.slice(0, 1), order0: 1, tipRadius: {}, tipFrom: 9, limbs, tips });
      killLimb(limbs, tips, limb, 2, rng.next() < 0.7 ? rng.range(0.3, 0.75) : 1);
    }
  }
  const flare: Flare = { count: rng.int(5, 7), amp: 0.4, height: 0.6, phase: rng.next() };
  const roots = surfaceRoots(rng, trunk, flare, 0.4 + 1.8 * trunk.radii[2]);
  for (const r of roots) r.dead = true;
  limbs.push(...roots);
  const crown = crownOf(limbs.filter((l) => !l.root).flatMap((l) => [l.pts[l.pts.length - 1]]), 0.5);
  // The snapped top of a conifer snag, or a fallen limb of a broadleaf one, lies beside it.
  limbs.push(form.conifer
    ? fallenLog(Math.round(height * 983) + 5, trunk, height / form.broken - height, trunk.radii[trunk.radii.length - 1] / 0.4)
    : fallenLog(Math.round(height * 983) + 9, trunk, 0.45 * height, 0.12 + 0.01 * height));
  return {
    species: 'snag', height, crownC: crown.c, crownR: crown.r, trunkRadius: breastRadius(trunk), bark: KIND.deadWood,
    limbs, fronds: [], clusters: [], cardsPerCluster: 0, cardSize: 0, radial: false, foliage: KIND.leaf, trunkSides: [14, 6, 4],
    flare, gnarl: 0.05,
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

