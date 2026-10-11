import { deriveSeed } from '../../world/track/rng';
import { fbm2, hash2, smoothstep, valueNoise2 } from './noise';
import type { TerrainFields } from './terrainFields';
import { KIND } from './meshBuilder';
import { VARIANTS_OF, variantPlan } from './variants';

export const MAX_SLOPE_DEG = 30;
const MAX_TAN = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180);
export const MIN_SOIL = 0.3;
/** Tree and bush spawn density at full wetness is this much above the dry value. */
const WET_BONUS = 1.45;
/** Rivers are drawn where the flow map is above this; nothing grows in them. */
const RIVER_FLOW = 0.85;
export const MIN_TREE_SCALE = 0.32;
export const MAX_TREE_SCALE = 1.5;
/**
 * Most a conifer away from the race line outgrows its placed size, rising as a spire above the broadleaf roof (canopyLayer). It keeps the
 * room of its placed size, so it may stand closer to a neighbour than its drawn scale's spacing.
 */
export const EMERGENT_MAX = 1.3;
/** Share of a species' trees that take its character form (old drooping spruce, crooked pine, veteran oak, weeping birch). */
const CHARACTER_SHARE = 0.16;

export interface Pick {
  variant: number;
  /** Uniform scale for plants; radius in metres for rocks (the rock meshes have a 1 m radius). */
  scale: number;
  yaw: number;
  /** Packed unorm8x4 colour multiplier (decoded as value * 2). */
  tint: number;
  /**
   * A tree's scale factor for its storey in the canopy (canopyLayer), kept out of `scale` so spacing, the spots trees take and their
   * colliders do not depend on it; placement applies it only where trees have no collider.
   */
  layer?: number;
}

const pack = (r: number, g: number, b: number, a: number): number => {
  const q = (v: number): number => Math.round(Math.min(Math.max(v * 0.5, 0), 1) * 255);
  return (q(r) | (q(g) << 8) | (q(b) << 16) | (q(a) << 24)) >>> 0;
};

/** One far-field canopy sample: expected trees per 3 m placement cell, the species and size of a typical tree there. */
export interface Canopy {
  density: number;
  variant: number;
  scale: number;
  tint: number;
}

/** Crowns spread toward their neighbours at most this much wider than the variant's own (tree.wgsl crownSpread). */
export const MAX_CROWN_SPREAD = 1.6;

/**
 * A broadleaf in a closed stand grows its crown out until it meets its neighbours' and they interlock into one roof; one standing in the
 * open keeps its own. The spread (1 to MAX_CROWN_SPREAD) comes from the stand's tree density `dTree` (trees per 3 m cell, so trees stand about
 * 3 / sqrt(dTree) m apart) against the variant's crown radius, and goes into the tint's alpha byte (decoded as value * 2, like the colour);
 * the tree shader widens the crown above the trunk by it. A function of the spot alone, so a smaller tier stays a prefix of a larger one.
 */
function withCrownSpread(tint: number, variant: number, scale: number, dTree: number): number {
  const plan = variantPlan(variant);
  if (!plan || plan.foliage !== KIND.leaf || plan.clusters.length === 0) return tint;
  const spacing = 3 / Math.sqrt(Math.max(dTree, 0.02)), own = Math.max(plan.crownR[0], plan.crownR[2]) * scale;
  const spread = Math.min(Math.max((0.6 * spacing) / Math.max(own, 0.1), 1), MAX_CROWN_SPREAD);
  return ((tint & 0x00ffffff) | (Math.round(spread * 127.5) << 24)) >>> 0;
}

/** Scene-independent density fields and species rules for trees, bushes and rocks; every draw is a hash of the cell, so results do not depend on visit order. */
export class PlacementRules {
  private readonly sStand: number;
  private readonly sLine: number;
  private readonly sBush: number;
  private readonly sConifer: number;
  private readonly sClump: number;
  private readonly sDraw: number;
  private readonly sAge: number;
  private readonly sGlade: number;
  private readonly sBeech: number;
  private readonly lo: number;
  private readonly range: number;
  private readonly water: number;

  constructor(private readonly f: TerrainFields, seed: number) {
    const s = (k: number): number => deriveSeed(seed, k) | 0;
    this.sStand = s(1); this.sLine = s(2); this.sBush = s(3); this.sConifer = s(4); this.sClump = s(5); this.sDraw = s(6); this.sAge = s(7); this.sGlade = s(8); this.sBeech = s(9);
    this.lo = f.data.minHeight;
    this.range = Math.max(f.data.maxHeight - f.data.minHeight, 1);
    this.water = f.data.waterLevel;
  }

  private draw(cx: number, cz: number, k: number): number {
    return hash2(cx, cz, this.sDraw + k * 7919);
  }

  /** Share of conifers among the trees: rises with altitude (`hRel` in 0..1 of the height range) and falls on wet ground. */
  conifer(x: number, z: number, hRel: number, wet: number): number {
    return smoothstep(0, 0.4, hRel + 0.5 * (fbm2(x / 260, z / 260, this.sConifer, 2) - 0.5)) * (1 - 0.35 * wet);
  }

  /** Tree or bush candidate of fine cell (cx, cz) at (x, z). Fills `out` and returns 1 for a tree, 2 for a bush, 0 for none. */
  plant(cx: number, cz: number, x: number, z: number, out: Pick): number {
    const f = this.f;
    const stand = smoothstep(0.42, 0.57, fbm2(x / 380, z / 380, this.sStand, 3));
    const glade = smoothstep(0.62, 0.76, fbm2(x / 85, z / 85, this.sGlade, 2));
    const treeMax = (0.03 + 0.97 * stand) * (1 - 0.88 * glade);
    const bushNoise = smoothstep(0.35, 0.65, fbm2(x / 70, z / 70, this.sBush, 2));
    const bushMax = 0.3 * (0.3 + 0.7 * bushNoise) * (0.4 + 0.6 * stand) * (1 + 0.8 * glade);
    const u = this.draw(cx, cz, 0);
    if (u >= Math.min(0.85, treeMax * WET_BONUS) + bushMax) return 0;

    const soil = f.soil(x, z);
    if (soil <= MIN_SOIL) return 0;
    const tan = f.gradient(x, z);
    if (tan >= MAX_TAN) return 0;
    const h = f.height(x, z);
    if (h < this.water + 0.8) return 0;
    const flow = f.flow(x, z);
    if (flow >= RIVER_FLOW) return 0;
    const hRel = (h - this.lo) / this.range;
    const line = 0.66 + 0.2 * (valueNoise2(x / 140, z / 140, this.sLine) - 0.5);
    if (hRel >= line) return 0;

    const wet = f.wetness(x, z);
    const wetF = 0.55 + 0.9 * wet;
    const base = smoothstep(0.3, 0.55, soil) * (1 - smoothstep(0.3, MAX_TAN, tan)) * (1 - smoothstep(line - 0.14, line, hRel)) * (1 - smoothstep(0.6, RIVER_FLOW, flow));
    const dTree = Math.min(0.85, treeMax * wetF) * base;
    const dBush = bushMax * wetF * base;
    const r2 = this.draw(cx, cz, 1), r3 = this.draw(cx, cz, 2), r4 = this.draw(cx, cz, 3), r5 = this.draw(cx, cz, 4);
    const conifer = this.conifer(x, z, hRel, wet);
    out.yaw = this.draw(cx, cz, 5) * Math.PI * 2;
    const b = 0.85 + 0.3 * r5, hue = (this.draw(cx, cz, 6) - 0.5) * 0.16;
    if (u < dTree) {
      const old = this.draw(cx, cz, 7) < 0.03;
      out.variant = this.species(x, z, r2 < conifer, r3, soil, wet, smoothstep(0.12, 0.55, dTree), old);
      // A few trees in closed stands have died and stand as snags.
      if (this.draw(cx, cz, 8) < 0.006 + 0.02 * smoothstep(0.2, 0.6, dTree)) out.variant = VARIANTS_OF.snag[r2 < conifer ? 0 : 1];
      out.tint = this.crownTint(cx, cz, x, z, r2 < conifer, b, hue);
      // Stands have an age: young ones are all saplings and poles, old ones mostly big trees; every stand mixes sizes and has the odd veteran.
      const age = smoothstep(0.35, 0.65, fbm2(x / 170, z / 170, this.sAge, 2));
      const veteran = old ? 1.25 : 1;
      // A snag stands at the size it died at.
      out.layer = (VARIANTS_OF.snag as readonly number[]).includes(out.variant) ? 1 : this.canopyLayer(cx, cz, r2 < conifer, smoothstep(0.12, 0.55, dTree));
      out.scale = Math.min(Math.max((0.62 + 0.5 * age) * (0.6 + 0.8 * Math.pow(r4, 0.8)) * veteran * (1 - 0.3 * smoothstep(line - 0.25, line, hRel)), MIN_TREE_SCALE), MAX_TREE_SCALE);
      out.tint = withCrownSpread(out.tint, out.variant, out.scale, dTree);
      return 1;
    }
    if (u < dTree + dBush) {
      out.variant = r3 < 0.2 + 0.5 * conifer ? VARIANTS_OF.juniper[0] : VARIANTS_OF.bush[0];
      out.scale = 0.6 + r4;
      out.layer = 1;
      out.tint = pack(b * (1 + hue), b, b * (1 - hue), 1);
      return 2;
    }
    return 0;
  }

  /**
   * Species and growth form of a tree from the draw `r3`: pine on poor dry soil and spruce elsewhere among conifers; birch on wet ground, beech
   * in its own stands on deep drained soil and oak elsewhere among broadleaves. In a closed stand (`closure` near 1) trees are mostly
   * forest-grown, in the open mostly open-grown; a share of them, and every `old` one, takes the species' character form.
   */
  private species(x: number, z: number, conifer: boolean, r3: number, soil: number, wet: number, closure: number, old: boolean): number {
    let list: readonly number[], u: number;
    if (conifer) {
      const pine = 0.15 + 0.7 * (1 - smoothstep(0.3, 0.7, soil)) * (1 - wet);
      list = r3 < pine ? VARIANTS_OF.pine : VARIANTS_OF.spruce;
      u = r3 < pine ? r3 / pine : (r3 - pine) / (1 - pine);
    } else {
      const birch = 0.08 + 0.4 * wet;
      const beech = (1 - birch) * 0.55 * smoothstep(0.48, 0.6, fbm2(x / 300, z / 300, this.sBeech, 2)) * (1 - wet) * smoothstep(0.35, 0.6, soil);
      list = r3 < birch ? VARIANTS_OF.birch : r3 < birch + beech ? VARIANTS_OF.beech : VARIANTS_OF.oak;
      u = r3 < birch ? r3 / birch : r3 < birch + beech ? (r3 - birch) / beech : (r3 - birch - beech) / (1 - birch - beech);
    }
    if (list.length > 2 && (old || u < CHARACTER_SHARE)) return list[2];
    const v = list.length > 2 ? (u - CHARACTER_SHARE) / (1 - CHARACTER_SHARE) : u;
    return v < closure ? list[1] : list[0];
  }

  /**
   * The expected tree density at (x, z) by the same stand, ground and altitude rules as `plant`, without the per-cell draw, so far hills
   * can be dressed with canopy where the fields say forest. (cx, cz) keys the species draws; `out.density` is the tree probability of one 3 m cell.
   */
  canopy(cx: number, cz: number, x: number, z: number, out: Canopy): void {
    const f = this.f;
    out.density = 0;
    const stand = smoothstep(0.42, 0.57, fbm2(x / 380, z / 380, this.sStand, 3));
    const glade = smoothstep(0.62, 0.76, fbm2(x / 85, z / 85, this.sGlade, 2));
    const treeMax = (0.03 + 0.97 * stand) * (1 - 0.88 * glade);
    const soil = f.soil(x, z);
    if (soil <= MIN_SOIL || treeMax < 0.01) return;
    const tan = f.gradient(x, z);
    const h = f.height(x, z);
    const flow = f.flow(x, z);
    if (tan >= MAX_TAN || h < this.water + 0.8 || flow >= RIVER_FLOW) return;
    const hRel = (h - this.lo) / this.range;
    const line = 0.66 + 0.2 * (valueNoise2(x / 140, z / 140, this.sLine) - 0.5);
    if (hRel >= line) return;
    const wet = f.wetness(x, z);
    const base = smoothstep(0.3, 0.55, soil) * (1 - smoothstep(0.3, MAX_TAN, tan)) * (1 - smoothstep(line - 0.14, line, hRel)) * (1 - smoothstep(0.6, RIVER_FLOW, flow));
    out.density = Math.min(0.85, treeMax * (0.55 + 0.9 * wet)) * base;
    const r2 = this.draw(cx, cz, 1), r3 = this.draw(cx, cz, 2), r4 = this.draw(cx, cz, 3), r5 = this.draw(cx, cz, 4);
    const conifer = this.conifer(x, z, hRel, wet);
    const b = 0.85 + 0.3 * r5, hue = (this.draw(cx, cz, 6) - 0.5) * 0.16;
    out.variant = this.species(x, z, r2 < conifer, r3, soil, wet, smoothstep(0.12, 0.55, out.density), false);
    out.tint = this.crownTint(cx, cz, x, z, r2 < conifer, b, hue);
    const age = smoothstep(0.35, 0.65, fbm2(x / 170, z / 170, this.sAge, 2));
    // A card stands for the canopy top, so it takes the emergent conifers' height but not the suppressed trees' (canopyLayer).
    const emergent = r2 < conifer ? 1.05 + (EMERGENT_MAX - 1.05) * this.draw(cx, cz, 17) : 1;
    out.scale = Math.min(Math.max((0.62 + 0.5 * age) * (0.6 + 0.8 * Math.pow(r4, 0.8)) * emergent * (1 - 0.3 * smoothstep(line - 0.25, line, hRel)), MIN_TREE_SCALE), MAX_TREE_SCALE);
  }

  /**
   * A tree's colour multiplier. Seen from above a forest is a patchwork: neighbouring stands differ in shade and hue (age, soil, the mix of
   * species and their health), and within a stand each crown differs again. A stand patch tens of metres across sets a brightness and a
   * yellow-to-blue cast; each tree adds its own on top. Broadleaf crowns differ most (a shaded or sickly crown is a third darker than a
   * vigorous one beside it); conifers' dark needles vary less in hue but still in shade.
   */
  private crownTint(cx: number, cz: number, x: number, z: number, conifer: boolean, b: number, hue: number): number {
    const patch = fbm2(x / 45, z / 45, this.sAge + 9, 2) - 0.5, cast = fbm2(x / 60 + 31, z / 60 - 17, this.sAge + 21, 2) - 0.5;
    const pb = b * (1 + 0.8 * patch) * (conifer ? 0.82 + 0.3 * this.draw(cx, cz, 9) : 0.72 + 0.46 * this.draw(cx, cz, 9));
    const ph = hue * 1.6 + 0.5 * cast;
    return conifer ? pack(pb * (1 + 0.4 * ph), pb, pb * (1 - 0.4 * ph), 1) : pack(pb * (1 + ph), pb, pb * (1 - ph), 1);
  }

  /**
   * Scale factor for a tree's place in the canopy's layers. A closed stand (`closure` near 1) is not one even roof: about a quarter of its
   * trees are suppressed, a storey below their neighbours, which opens dark gaps between the crowns that reach the light; conifers rise as
   * spires above the broadleaf roof (a Norway spruce outgrows an oak by a third).
   */
  private canopyLayer(cx: number, cz: number, conifer: boolean, closure: number): number {
    const suppressed = this.draw(cx, cz, 16) < 0.28 * closure ? 0.62 : 1;
    return suppressed * (conifer ? 1.05 + (EMERGENT_MAX - 1.05) * this.draw(cx, cz, 17) : 1);
  }

  /** Rock candidate of fine cell (cx, cz): steep, bare or stream-side ground, in clumps. Fills `out` (scale = radius) and returns whether one is wanted. */
  rock(cx: number, cz: number, x: number, z: number, out: Pick): boolean {
    const f = this.f;
    const clump = 0.35 + 1.15 * smoothstep(0.42, 0.62, fbm2(x / 50, z / 50, this.sClump, 2));
    const u = this.draw(cx, cz, 10);
    if (u >= 0.6 * clump) return false;
    const h = f.height(x, z);
    if (h < this.water + 0.3) return false;
    const flow = f.flow(x, z);
    if (flow >= 0.9) return false;
    const steep = smoothstep(0.27, 0.7, f.gradient(x, z));
    const bare = 1 - smoothstep(0.22, 0.4, f.soil(x, z));
    const stream = smoothstep(0.3, 0.55, flow) * (1 - smoothstep(0.8, 0.9, flow));
    if (u >= Math.max(0.5 * steep, 0.6 * bare, 0.35 * stream, 0.02) * clump) return false;
    const r = this.draw(cx, cz, 11);
    const size = Math.min(0.3 * Math.pow(1 - this.draw(cx, cz, 12), -0.6), 4);
    const rocks = VARIANTS_OF.rock;
    if (steep > 0.5) out.variant = r < 0.6 ? rocks[3] : rocks[0];
    else if (bare > 0.5) out.variant = r < 0.55 ? rocks[2] : rocks[0];
    else if (stream > 0.4) out.variant = r < 0.7 ? rocks[1] : rocks[2];
    else out.variant = rocks[r < 0.35 ? 0 : r < 0.65 ? 1 : r < 0.85 ? 2 : 3];
    out.scale = size;
    out.yaw = this.draw(cx, cz, 13) * Math.PI * 2;
    const g = 0.8 + 0.4 * this.draw(cx, cz, 14), warm = (this.draw(cx, cz, 15) - 0.5) * 0.12;
    out.tint = pack(g * (1 + warm), g, g * (1 - warm), 1);
    return true;
  }
}
