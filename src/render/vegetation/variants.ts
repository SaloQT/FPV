import type { Vec3 } from '../../contracts';
import { Rng } from '../../world/track/rng';
import type { MeshData } from './meshBuilder';
import { rockAssets } from './rockGen';
import { runSliced, runSync, type Steps } from './slices';
import { buildTreeLods } from './treeGen';
import { beechPlan, birchPlan, bushPlan, juniperPlan, oakPlan, snagPlan } from './treePlanBroad';
import { densify, pinePlan, sprucePlan, type TreePlan } from './treePlan';

export const LOD_COUNT = 3;
export const VARIANT_COUNT = 22;
export const DRAW_COUNT = VARIANT_COUNT * LOD_COUNT;
export const FIRST_ROCK = 18;
export const isRockVariant = (v: number): boolean => VARIANT_DEFS[v].group === 'rock';

export type VariantGroup = 'tree' | 'bush' | 'rock';

export interface VariantDef {
  name: string;
  group: VariantGroup;
  /** Height parameter of the plan in metres at instance scale 1; squat crowns (oaks) build to about 0.8 of it. */
  height: number;
  /** Minimum spacing radius (m) for Poisson placement at scale 1; a pair keeps half the sum of both. */
  spacing: number;
  seed: number;
  plan: ((rng: Rng) => TreePlan) | null;
  /** Rock shape index, -1 for plants. */
  rock: number;
  swayHz: number;
  /** Lateral crown displacement as a fraction of height per m/s of wind. */
  swayStrength: number;
  /** Leaf-card wobble amplitude in metres. */
  flutter: number;
  /** Leaf (or base rock) albedo of the unpainted green: the atlas multiplies it by a shade of 0.5-1 and a hue ramp, so painted leaves land at 0.04-0.15 per channel (conifer needles at 0.04-0.08). */
  tone: Vec3;
  translucency: number;
  /** LOD0 and LOD1 hand-over distances as multiples of the bounding radius. */
  lodRatio: [number, number];
}

// `lod` is the near and mid LOD hand-over as multiples of the bounding radius. The oaks use less than the default: their wide crowns give
// them a big radius, so they hand over at the distances they did with narrower crowns (near about 40-50 m, mid about 135-185 m at scale 1).
const tree = (name: string, height: number, spacing: number, seed: number, plan: (rng: Rng) => TreePlan, sway: [number, number, number], tone: Vec3, translucency: number, lod: [number, number] = [4.5, 16]): VariantDef => ({
  name, group: 'tree', height, spacing, seed, plan, rock: -1, swayHz: sway[0], swayStrength: sway[1], flutter: sway[2], tone, translucency, lodRatio: lod,
});
const bush = (name: string, height: number, spacing: number, seed: number, plan: (rng: Rng) => TreePlan, sway: [number, number, number], tone: Vec3, translucency: number): VariantDef => ({
  ...tree(name, height, spacing, seed, plan, sway, tone, translucency), group: 'bush', lodRatio: [28, 80],
});
const rock = (name: string, shape: number, tone: Vec3): VariantDef => ({
  name, group: 'rock', height: 1, spacing: 0.9, seed: shape, plan: null, rock: shape, swayHz: 0, swayStrength: 0, flutter: 0, tone, translucency: 0, lodRatio: [30, 90],
});

/**
 * Plants first, then rocks; the order is the shader's variant index. Every tree species comes in growth forms (VARIANTS_OF lists them as
 * open-grown, forest-grown, then a character form): open-grown trees keep low limbs and broad crowns, forest-grown ones a long bare bole
 * under a high, narrow crown, and the third is the odd one out (an old drooping spruce, a crooked pine, a stag-headed veteran oak, a
 * weeping birch; for birch the open-grown form is a clump of stems). Snags are standing dead trees. Variants 0-7 keep the species they had
 * before the growth forms were added (spruce, spruce, pine, oak, oak, birch, bush, juniper), because the theme park plants them by index.
 */
export const VARIANT_DEFS: readonly VariantDef[] = [
  tree('spruce open', 18, 3.2, 0x5a01, (r) => sprucePlan(r, 18, { reach: 0.31, crownBase: 0.1, deadBelow: false, droop: 0.5, lean: 0.35 }), [0.45, 0.003, 0.03], [0.03, 0.075, 0.043], 0.3),
  tree('spruce forest', 22, 3.2, 0x5a02, (r) => sprucePlan(r, 22, { reach: 0.22, crownBase: 0.38, deadBelow: true, droop: 0.3, lean: 0.25 }), [0.42, 0.003, 0.03], [0.032, 0.079, 0.046], 0.3),
  tree('pine forest', 19.5, 4.2, 0x5a0a, (r) => pinePlan(r, 19.5, { crownStart: 0.6, limbs: 14, spread: 0.9, lean: 0.9, wobble: 0.1, stubs: 7 }), [0.36, 0.0042, 0.03], [0.042, 0.088, 0.046], 0.3),
  tree('oak open', 20, 5.2, 0x5a04, (r) => oakPlan(r, 20, { fork: 0.17, limbs: [4, 6], reach: 1, upright: 0.1, trunk: 1, dead: 0.04, gnarl: 0.07 }), [0.33, 0.0028, 0.04], [0.058, 0.12, 0.038], 0.45, [3.0, 10.8]),
  tree('oak forest', 25, 5.2, 0x5a05, (r) => oakPlan(r, 25, { fork: 0.42, limbs: [4, 5], reach: 0.55, upright: 0.5, trunk: 0.85, dead: 0.12, gnarl: 0.05 }), [0.31, 0.0028, 0.04], [0.064, 0.126, 0.04], 0.45, [3.8, 13.5]),
  tree('birch', 16, 3.6, 0x5a06, (r) => birchPlan(r, 16, { stems: 1, weep: 0 }), [0.65, 0.006, 0.04], [0.07, 0.135, 0.044], 0.5),
  bush('bush', 1.6, 1.7, 0x5a07, (r) => bushPlan(r, 1.6), [1.1, 0.004, 0.04], [0.052, 0.105, 0.036], 0.45),
  bush('juniper', 1.3, 1.6, 0x5a08, (r) => juniperPlan(r, 1.3), [0.9, 0.004, 0.03], [0.036, 0.078, 0.05], 0.3),
  tree('spruce old', 21, 3.4, 0x5a09, (r) => sprucePlan(r, 21, { reach: 0.28, crownBase: 0.24, deadBelow: true, droop: 1, lean: 0.55 }), [0.42, 0.003, 0.03], [0.028, 0.07, 0.044], 0.3),
  tree('pine open', 17, 4.2, 0x5a03, (r) => pinePlan(r, 17, { crownStart: 0.4, limbs: 20, spread: 1.25, lean: 1.4, wobble: 0.22, stubs: 3 }), [0.38, 0.0042, 0.03], [0.04, 0.085, 0.046], 0.3),
  tree('pine crooked', 18.5, 4.2, 0x5a0b, (r) => pinePlan(r, 18.5, { crownStart: 0.55, limbs: 16, spread: 1.05, lean: 3.2, wobble: 0.45, stubs: 4 }), [0.38, 0.0045, 0.03], [0.038, 0.082, 0.046], 0.3),
  tree('oak veteran', 16, 5.4, 0x5a0c, (r) => oakPlan(r, 16, { fork: 0.2, limbs: [4, 5], reach: 1, upright: 0.25, trunk: 1.55, dead: 0.4, gnarl: 0.12 }), [0.3, 0.0024, 0.04], [0.06, 0.118, 0.038], 0.45, [3.2, 11.4]),
  tree('birch clump', 15, 3.6, 0x5a0d, (r) => birchPlan(r, 15, { stems: 3, weep: 0.2 }), [0.68, 0.006, 0.04], [0.068, 0.132, 0.046], 0.5),
  tree('birch weeping', 17, 3.8, 0x5a0e, (r) => birchPlan(r, 17, { stems: 1, weep: 1 }), [0.62, 0.006, 0.04], [0.072, 0.138, 0.044], 0.5),
  tree('beech open', 22, 5.4, 0x5a0f, (r) => beechPlan(r, 22, { fork: 0.22, reach: 0.9 }), [0.32, 0.0026, 0.04], [0.062, 0.13, 0.036], 0.5),
  tree('beech forest', 30, 5.2, 0x5a10, (r) => beechPlan(r, 30, { fork: 0.46, reach: 0.5 }), [0.3, 0.0026, 0.04], [0.058, 0.126, 0.036], 0.5),
  tree('snag conifer', 14, 3.2, 0x5a11, (r) => snagPlan(r, 14, { conifer: true, broken: 0.68 }), [0.3, 0.0012, 0], [0.05, 0.05, 0.05], 0),
  tree('snag broadleaf', 10, 4.2, 0x5a12, (r) => snagPlan(r, 10, { conifer: false, broken: 1 }), [0.3, 0.0015, 0], [0.05, 0.05, 0.05], 0),
  rock('angular rock', 0, [0.3, 0.29, 0.27]),
  rock('round boulder', 1, [0.27, 0.26, 0.24]),
  rock('flat slab', 2, [0.34, 0.31, 0.27]),
  rock('tall chunk', 3, [0.28, 0.27, 0.26]),
];

export const VARIANTS_OF = {
  spruce: [0, 1, 8], pine: [9, 2, 10], oak: [3, 4, 11], birch: [12, 5, 13], beech: [14, 15], snag: [16, 17], bush: [6], juniper: [7], rock: [18, 19, 20, 21],
} as const;

const plans: (TreePlan | null)[] = [];

/** The skeleton of a plant variant (memoised; deterministic per variant), null for rocks. */
export function variantPlan(v: number): TreePlan | null {
  if (plans[v] === undefined) {
    const def = VARIANT_DEFS[v];
    plans[v] = def.plan ? def.plan(new Rng(def.seed)) : null;
  }
  return plans[v];
}

/**
 * Numbers the layout reads (m at scale 1): horizontal crown radius, the crown top placement scales by, the top of the foliage, and the
 * breast-height trunk radius placement scales by.
 */
export interface LayoutCrown { crown: number; top: number; crownTop: number; trunk: number }

// The crowns as they were when the race worlds' layout was settled (2026-10-11). Placement keep-outs, scale limits and trunk collider
// heights read these instead of the drawn crown, so a crown can be reshaped without moving a tree or a collider. Change one only when
// the layout itself is meant to change, and list it with the gameplay changes. The three oaks were updated the same day for their
// thicker trunks and wider, low-forked crowns, and the three spruces for their wider crowns (reach 0.31 / 0.22 / 0.28, open-grown Norway
// spruce being about 0.65-0.7 as wide as tall; docs/history/2026-10-session.md lists what moved).
const LAYOUT_CROWNS: Readonly<Record<string, LayoutCrown>> = {
  'spruce open': { crown: 5.859, top: 18, crownTop: 19.080000000000002, trunk: 0.30883139247709107 },
  'spruce forest': { crown: 5.082, top: 22, crownTop: 23.32, trunk: 0.377444239994894 },
  'pine forest': { crown: 4.393045984979251, top: 19.5, crownTop: 21.20899818302396, trunk: 0.3283538095866827 },
  'oak open': { crown: 12.502572382502073, top: 17.078635186435562, crownTop: 17.878635186435563, trunk: 0.5620898659787166 },
  'oak forest': { crown: 6.641321776589879, top: 20.117748555532, crownTop: 20.917748555532, trunk: 0.6493176001043693 },
  'birch': { crown: 3.084935198612871, top: 16, crownTop: 16.8, trunk: 0.16848571985520766 },
  'bush': { crown: 1.4690340919623504, top: 0.8350295910028345, crownTop: 1.6350295910028345, trunk: 0.03 },
  'juniper': { crown: 0.65, top: 1.3, crownTop: 1.3650000000000002, trunk: 0.03 },
  'spruce old': { crown: 6.174000000000001, top: 21, crownTop: 22.26, trunk: 0.3602933508782565 },
  'pine open': { crown: 6.285019408290031, top: 17, crownTop: 19.191156080352815, trunk: 0.2879465857800804 },
  'pine crooked': { crown: 4.9702813842218525, top: 18.5, crownTop: 20.15712573015106, trunk: 0.3121957574180043 },
  'oak veteran': { crown: 7.832299420369366, top: 14.45869608727261, crownTop: 15.258696087272611, trunk: 0.7058441811910107 },
  'birch clump': { crown: 3.91888379796249, top: 15, crownTop: 15.8, trunk: 0.12497559580035739 },
  'birch weeping': { crown: 3.1643255418795455, top: 17, crownTop: 17.8, trunk: 0.17733318163026734 },
  'beech open': { crown: 10.793974798978384, top: 24.521950810134815, crownTop: 25.321950810134815, trunk: 0.47127364135457145 },
  'beech forest': { crown: 8.220815614264287, top: 26.422206824240074, crownTop: 27.222206824240075, trunk: 0.6704354070159076 },
  'snag conifer': { crown: 1.3487823613608731, top: 13.7, crownTop: 14.5, trunk: 0.37281647716976973 },
  'snag broadleaf': { crown: 3.0837791071140916, top: 9.774308380852892, crownTop: 10.574308380852893, trunk: 0.3363964276945343 },
};

/** The layout's crown numbers of a plant variant, null for rocks. */
export function layoutCrown(v: number): LayoutCrown | null {
  return VARIANT_DEFS[v].plan ? LAYOUT_CROWNS[VARIANT_DEFS[v].name] ?? null : null;
}

export interface VariantAsset {
  def: VariantDef;
  lods: [MeshData, MeshData, MeshData];
  /** Mesh extent above its origin (top of the tallest LOD0 vertex). */
  height: number;
  /** Bounding sphere centre height (about the vertical axis through the origin) and radius, covering every LOD. */
  centreY: number;
  radius: number;
}

function bounds(lods: readonly MeshData[]): { height: number; centreY: number; radius: number } {
  let y0 = Infinity, y1 = -Infinity;
  for (const m of lods) for (let i = 0; i < m.vertexCount; i++) { y0 = Math.min(y0, m.pos[i * 3 + 1]); y1 = Math.max(y1, m.pos[i * 3 + 1]); }
  const cy = (y0 + y1) / 2;
  let r = 0;
  for (const m of lods) for (let i = 0; i < m.vertexCount; i++) r = Math.max(r, Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1] - cy, m.pos[i * 3 + 2]));
  return { height: y1, centreY: cy, radius: r };
}

/** The three LOD meshes of a plant variant at the budgeted tiers (memoised: placement's park checks and the ray-traced canopy fit read them too). */
const lodCache: ([MeshData, MeshData, MeshData] | undefined)[] = [];
export function variantLods(v: number): [MeshData, MeshData, MeshData] {
  return (lodCache[v] ??= buildTreeLods(variantPlan(v) as TreePlan, VARIANT_DEFS[v].seed));
}

/** Hands meshes already built elsewhere (the disk cache, the worker threads) to variantLods, so they are not built again. */
export function seedVariantLods(assets: readonly VariantAsset[]): void {
  assets.forEach((asset, v) => { if (asset.def.plan && asset.lods.length === 3) lodCache[v] ??= asset.lods as [MeshData, MeshData, MeshData]; });
}

/** `dense` builds the extreme tier's fuller crowns (treeGen.ts FoliageOptions, densify()); the plans, and so placement and colliders, are the same. */
function* variantSteps(dense = false, prebuilt?: readonly (VariantAsset | null)[]): Steps<VariantAsset[]> {
  const rocks = rockAssets();
  yield;
  const out: VariantAsset[] = [];
  for (let v = 0; v < VARIANT_DEFS.length; v++) {
    const def = VARIANT_DEFS[v];
    if (def.rock >= 0) {
      const r = rocks[def.rock];
      out.push({ def, lods: r.lods, height: r.height, centreY: r.centreY, radius: r.radius });
    } else out.push(prebuilt?.[v] ?? treeAsset(v, dense));
    yield;
  }
  return out;
}

/** One tree variant's three LOD meshes and bounding sphere (the tree build workers call this for their share, treeBuildPool.ts). */
export function treeAsset(v: number, dense = false): VariantAsset {
  const def = VARIANT_DEFS[v], plan = variantPlan(v) as TreePlan;
  const lods = dense ? buildTreeLods(densify(plan), def.seed, undefined, { dense }) : variantLods(v);
  return { def, lods, ...bounds(lods) };
}

/** Generates every variant's three LOD meshes and bounding spheres (about 0.4 s of CPU). */
export function buildVariantAssets(dense = false): VariantAsset[] {
  return runSync(variantSteps(dense));
}

/** The same assets generated in slices with an event-loop yield between them (see slices.ts); `prebuilt` holds trees already built elsewhere, by variant. */
export function buildVariantAssetsSliced(budgetMs = 8, yieldFn?: () => Promise<void>, dense = false, prebuilt?: readonly (VariantAsset | null)[]): Promise<VariantAsset[]> {
  return runSliced(variantSteps(dense, prebuilt), budgetMs, yieldFn);
}
