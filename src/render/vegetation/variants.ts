import type { Vec3 } from '../../contracts';
import { Rng } from '../../world/track/rng';
import type { MeshData } from './meshBuilder';
import { rockAssets } from './rockGen';
import { buildTreeLods } from './treeGen';
import { juniperPlan, birchPlan, bushPlan, oakPlan } from './treePlanBroad';
import { pinePlan, sprucePlan, type TreePlan } from './treePlan';

export const LOD_COUNT = 3;
export const VARIANT_COUNT = 12;
export const DRAW_COUNT = VARIANT_COUNT * LOD_COUNT;
export const FIRST_ROCK = 8;

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

const tree = (name: string, height: number, spacing: number, seed: number, plan: (rng: Rng) => TreePlan, sway: [number, number, number], tone: Vec3, translucency: number): VariantDef => ({
  name, group: 'tree', height, spacing, seed, plan, rock: -1, swayHz: sway[0], swayStrength: sway[1], flutter: sway[2], tone, translucency, lodRatio: [4.5, 16],
});
const bush = (name: string, height: number, spacing: number, seed: number, plan: (rng: Rng) => TreePlan, sway: [number, number, number], tone: Vec3, translucency: number): VariantDef => ({
  ...tree(name, height, spacing, seed, plan, sway, tone, translucency), group: 'bush', lodRatio: [28, 80],
});
const rock = (name: string, shape: number, tone: Vec3): VariantDef => ({
  name, group: 'rock', height: 1, spacing: 0.9, seed: shape, plan: null, rock: shape, swayHz: 0, swayStrength: 0, flutter: 0, tone, translucency: 0, lodRatio: [30, 90],
});

/** Variants 0-7 are plants, 8-11 rocks; the order is the shader's variant index. */
export const VARIANT_DEFS: readonly VariantDef[] = [
  tree('spruce A', 18, 3.2, 0x5a01, (r) => sprucePlan(r, 18, 0.19), [0.45, 0.003, 0.03], [0.03, 0.075, 0.043], 0.3),
  tree('spruce B', 22, 3.4, 0x5a02, (r) => sprucePlan(r, 22, 0.17), [0.42, 0.003, 0.03], [0.032, 0.079, 0.046], 0.3),
  tree('pine', 19.5, 4.2, 0x5a03, (r) => pinePlan(r, 19.5), [0.38, 0.0042, 0.03], [0.04, 0.085, 0.046], 0.3),
  tree('oak A', 15, 5.2, 0x5a04, (r) => oakPlan(r, 15), [0.33, 0.0028, 0.09], [0.058, 0.12, 0.038], 0.45),
  tree('oak B', 17, 5.4, 0x5a05, (r) => oakPlan(r, 17), [0.31, 0.0028, 0.09], [0.064, 0.126, 0.04], 0.45),
  tree('birch', 13, 3.6, 0x5a06, (r) => birchPlan(r, 13), [0.65, 0.006, 0.1], [0.07, 0.135, 0.044], 0.5),
  bush('bush', 1.6, 1.7, 0x5a07, (r) => bushPlan(r, 1.6), [1.1, 0.004, 0.06], [0.052, 0.105, 0.036], 0.45),
  bush('juniper', 1.3, 1.6, 0x5a08, (r) => juniperPlan(r, 1.3), [0.9, 0.004, 0.03], [0.036, 0.078, 0.05], 0.3),
  rock('angular rock', 0, [0.3, 0.29, 0.27]),
  rock('round boulder', 1, [0.27, 0.26, 0.24]),
  rock('flat slab', 2, [0.34, 0.31, 0.27]),
  rock('tall chunk', 3, [0.28, 0.27, 0.26]),
];

export const VARIANTS_OF = { spruce: [0, 1], pine: [2], oak: [3, 4], birch: [5], bush: [6], juniper: [7], rock: [8, 9, 10, 11] } as const;

const plans: (TreePlan | null)[] = [];

/** The skeleton of a plant variant (memoised; deterministic per variant), null for rocks. */
export function variantPlan(v: number): TreePlan | null {
  if (plans[v] === undefined) {
    const def = VARIANT_DEFS[v];
    plans[v] = def.plan ? def.plan(new Rng(def.seed)) : null;
  }
  return plans[v];
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

/** Generates every variant's three LOD meshes and bounding spheres (about 0.1 s of CPU). */
export function buildVariantAssets(): VariantAsset[] {
  const rocks = rockAssets();
  return VARIANT_DEFS.map((def, v) => {
    if (def.rock >= 0) {
      const r = rocks[def.rock];
      return { def, lods: r.lods, height: r.height, centreY: r.centreY, radius: r.radius };
    }
    const lods = buildTreeLods(variantPlan(v) as TreePlan, def.seed);
    return { def, lods, ...bounds(lods) };
  });
}
