import type { TerrainData, TrackData } from '../../contracts';
import { hash2, smoothstep } from './noise';
import { placementSeed, regionSeed } from './placement';
import { PlacementRules, type Canopy } from './placementRules';
import { COARSE, buildRegion } from './region';
import { TerrainFields } from './terrainFields';
import { VARIANTS_OF, VARIANT_DEFS } from './variants';

/** Far-field canopy cards: one billboard per clump of trees, 32 bytes each (layout mirrored by veg_far.wgsl). */
export const FAR_CARD_BYTES = 32;
export const FAR_CARD_WORDS = FAR_CARD_BYTES / 4;
/** Side of a card's cell (m): a card stands for the canopy of the trees in this much ground. */
export const FAR_CELL = 12;
const SUBCELLS = COARSE / FAR_CELL;
/** Tree density (per 3 m cell) below which a cell has no card, and above which it always has one. */
const DENSITY_MIN = 0.03;
const DENSITY_FULL = 0.2;

export interface FarOptions {
  /** Most cards placed (nearest the racing line first). */
  cap: number;
  /** Cards are placed out to this distance from the racing line (m). */
  radius: number;
  /** Cells whose approximate distance to the racing line exceeds this have no real trees; their cards show from `uncoveredNear` on. */
  coveredRing: number;
  /** Camera distance (m) where a card over ground with no real trees shows; cards over covered ground show from the live tree draw distance (near 0). */
  uncoveredNear: number;
}

export interface FarForest {
  count: number;
  /** FAR_CARD_WORDS words per card: x, ground y, z, height, width (floats), tint (u32), near distance (f32, 0 = the tree draw distance), info (u32). */
  words: Uint32Array;
  /** Cards drawn from `uncoveredNear` (no real tree behind them). */
  uncovered: number;
}

/** Species class stored in a card: 0 spruce, 1 pine, 2 oak, 3 birch. */
export function farSpecies(variant: number): number {
  const name = VARIANT_DEFS[variant].name;
  return name.startsWith('spruce') ? 0 : name === 'pine' ? 1 : name.startsWith('oak') ? 2 : 3;
}

/**
 * WGSL defines TONE0..TONE3 (leaf albedo rgb and translucency of spruce, pine, oak, birch): the mean of the species' variants, so the cards
 * follow the tree table instead of repeating its numbers.
 */
export function farToneDefines(): Record<string, string> {
  const out: Record<string, string> = {};
  const groups: readonly (readonly number[])[] = [VARIANTS_OF.spruce, VARIANTS_OF.pine, VARIANTS_OF.oak, VARIANTS_OF.birch];
  groups.forEach((variants, k) => {
    const mean = (f: (d: (typeof VARIANT_DEFS)[number]) => number): number => variants.reduce((t, v) => t + f(VARIANT_DEFS[v]), 0) / variants.length;
    out[`TONE${k}`] = [mean((d) => d.tone[0]), mean((d) => d.tone[1]), mean((d) => d.tone[2]), mean((d) => d.translucency)].map((v) => v.toFixed(4)).join(', ');
  });
  return out;
}

/** info word: species (3 bits) | lobes - 1 (2 bits) | 16-bit random for the lobe layout. */
export const packFarInfo = (species: number, lobes: number, rnd: number): number => (species | ((lobes - 1) << 3) | ((rnd & 0xffff) << 5)) >>> 0;

/**
 * Canopy cards for the ground the real trees do not reach: the same stand, soil, slope and altitude fields as the tree placement
 * sampled on a 12 m grid, one card per cell that holds enough trees, walked from the racing line outwards.
 */
export function placeFarForest(terrain: TerrainData, track: TrackData | null, o: FarOptions): FarForest {
  const fields = new TerrainFields(terrain);
  const rules = new PlacementRules(fields, placementSeed(terrain));
  const e = (terrain.resolution - 1) * terrain.cellSize;
  const [ox, oz] = terrain.origin;
  const region = buildRegion(track, [ox + e / 2, oz + e / 2], o.radius, [ox, oz, ox + e, oz + e], regionSeed(terrain));
  const words = new Uint32Array(o.cap * FAR_CARD_WORDS);
  const f32 = new Float32Array(words.buffer);
  const c: Canopy = { density: 0, variant: 0, scale: 1, tint: 0 };
  let count = 0, uncovered = 0;
  for (const cell of region.order) {
    if (count >= o.cap) break;
    const ci = region.i0 + (cell % region.nx), cj = region.j0 + Math.floor(cell / region.nx);
    const ring = region.dist[cell];
    const far = ring > o.coveredRing;
    for (let s = 0; s < SUBCELLS * SUBCELLS && count < o.cap; s++) {
      const fx = ci * SUBCELLS + (s % SUBCELLS), fz = cj * SUBCELLS + Math.floor(s / SUBCELLS);
      const x = (fx + 0.15 + 0.7 * hash2(fx, fz, 31)) * FAR_CELL, z = (fz + 0.15 + 0.7 * hash2(fx, fz, 32)) * FAR_CELL;
      if (!fields.inside(x, z, 6)) continue;
      rules.canopy(fx, fz, x, z, c);
      if (c.density < DENSITY_MIN) continue;
      const keep = smoothstep(DENSITY_MIN, DENSITY_FULL, c.density);
      if (hash2(fx, fz, 33) >= keep) continue;
      const lobes = 1 + (c.density > 0.12 ? 1 : 0) + (c.density > 0.35 ? 1 : 0);
      const def = VARIANT_DEFS[c.variant];
      const i = count++ * FAR_CARD_WORDS;
      f32[i] = x; f32[i + 1] = fields.height(x, z); f32[i + 2] = z;
      f32[i + 3] = def.height * c.scale * (c.variant >= 3 && c.variant <= 4 ? 0.85 : 1);
      f32[i + 4] = FAR_CELL * (1.05 + 0.4 * hash2(fx, fz, 34));
      words[i + 5] = c.tint;
      f32[i + 6] = far ? o.uncoveredNear : 0;
      words[i + 7] = packFarInfo(farSpecies(c.variant), lobes, Math.floor(hash2(fx, fz, 35) * 65536));
      if (far) uncovered++;
    }
  }
  return { count, words: words.subarray(0, count * FAR_CARD_WORDS), uncovered };
}
