import type { RenderQuality, TerrainData, TrackData } from '../../contracts';
import { PathIndex } from '../../world/track/pathIndex';
import { deriveSeed } from '../../world/track/rng';
import { hash2, smoothstep } from './noise';
import { PlacementRules, type Pick } from './placementRules';
import { COARSE, buildRegion, type Region } from './region';
import { rockAssets } from './rockGen';
import { SpatialHash } from './spatialHash';
import { TerrainFields } from './terrainFields';
import { VARIANT_DEFS, variantPlan } from './variants';

export interface PlacementLimits {
  /** Trees and bushes together. */
  plants: number;
  rocks: number;
}

/** Instance budgets per quality tier; the smaller tiers are prefixes of the larger ones (the walk is nearest-track first). */
export const TIER_LIMITS: Readonly<Record<RenderQuality, PlacementLimits>> = {
  low: { plants: 12000, rocks: 2000 },
  medium: { plants: 16000, rocks: 2600 },
  high: { plants: 20000, rocks: 3200 },
  ultra: { plants: 25000, rocks: 4000 },
};

/** Struct-of-arrays instance list; `variant` indexes VARIANT_DEFS. */
export interface InstanceSet {
  count: number;
  pos: Float32Array;
  scale: Float32Array;
  yaw: Float32Array;
  variant: Uint8Array;
  /** Packed unorm8x4 colour multiplier (decoded as value * 2). */
  tint: Uint32Array;
  /** Terrain normal x and z as two packed snorm16. */
  nrm: Uint32Array;
  /** Horizontal distance to the racing line in metres; Infinity when farther than about 115 m or without a track. */
  pathDist: Float32Array;
}

export interface VegPlacement {
  plants: InstanceSet;
  rocks: InstanceSet;
  trees: number;
  bushes: number;
}

export const REGION_RADIUS = 1000;
/** Rocks are always placed up to this many so that plants avoid the same ground in every tier. */
export const ROCK_CAP = 4000;
/** Trees and bushes stay this far from the racing line; the brief asks for at least 6 m. */
export const PATH_CLEARANCE = 6.5;
const ROCK_PATH_CLEARANCE = 3.5;
/** Cells whose approximate distance exceeds this cannot hold ground within CORRIDOR_WIDTH of the path (the cell grid is off by at most 34 m plus 8%). */
const NEAR_PATH = 115;
const PLANT_CELL = 3;
const ROCK_CELL = 4;
const PLANT_PER_COARSE = COARSE / PLANT_CELL;
const ROCK_PER_COARSE = COARSE / ROCK_CELL;
/** Fraction of candidates kept right at the racing line, rising to 1 at CORRIDOR_WIDTH. */
const CORRIDOR_DENSITY = 0.55;
const CORRIDOR_WIDTH = 70;
const TREE_TRUNK = 0.3;
const BUSH_TRUNK = 0.5;

function makeSet(cap: number): InstanceSet {
  return { count: 0, pos: new Float32Array(cap * 3), scale: new Float32Array(cap), yaw: new Float32Array(cap), variant: new Uint8Array(cap), tint: new Uint32Array(cap), nrm: new Uint32Array(cap), pathDist: new Float32Array(cap) };
}

/** The first n instances (copied), so the arrays hold exactly what is used. */
function take(s: InstanceSet, n: number): InstanceSet {
  return { count: n, pos: s.pos.slice(0, n * 3), scale: s.scale.slice(0, n), yaw: s.yaw.slice(0, n), variant: s.variant.slice(0, n), tint: s.tint.slice(0, n), nrm: s.nrm.slice(0, n), pathDist: s.pathDist.slice(0, n) };
}

const snorm16 = (v: number): number => Math.round(Math.min(Math.max(v, -1), 1) * 32767) & 0xffff;

/** Terrain normal xz from the gradient left in `fields` by the rule that just accepted the candidate. */
function packNormal(gx: number, gz: number): number {
  const inv = 1 / Math.hypot(gx, gz, 1);
  return (snorm16(-gx * inv) | (snorm16(-gz * inv) << 16)) >>> 0;
}

function push(s: InstanceSet, x: number, y: number, z: number, p: Pick, nrm: number, pathDist: number): void {
  const i = s.count++;
  s.pos[i * 3] = x; s.pos[i * 3 + 1] = y; s.pos[i * 3 + 2] = z;
  s.scale[i] = p.scale; s.yaw[i] = p.yaw; s.variant[i] = p.variant; s.tint[i] = p.tint; s.nrm[i] = nrm; s.pathDist[i] = pathDist;
}

/** Ground that stays free of plants and rocks: gate openings, obstacles and the launch pad. */
function buildBlockers(track: TrackData | null, x0: number, z0: number, x1: number, z1: number): SpatialHash {
  const h = new SpatialHash(x0, z0, x1, z1, 32, 64);
  if (!track) return h;
  for (const g of track.gates) h.add(g.pos[0], g.pos[2], 0.5 * Math.hypot(g.width, g.height) + 2, 0);
  for (const o of track.obstacles) {
    h.add(o.pos[0], o.pos[2], o.kind === 'wall' ? 0.5 * Math.hypot(o.size[0], o.size[2]) : Math.max(o.size[0], o.size[2] * 0.5), 0);
  }
  h.add(track.start.pos[0], track.start.pos[2], 8, 0);
  return h;
}

interface Tables {
  /** Horizontal crown radius (m at scale 1) per plant variant, so trees keep their branches out of gates. */
  crown: number[];
  /** Height in metres of each rock mesh at scale 1. */
  rockHeight: number[];
}

let tables: Tables | null = null;

function lookup(): Tables {
  tables ??= {
    crown: VARIANT_DEFS.map((_, v) => { const p = variantPlan(v); return p ? Math.max(p.crownR[0], p.crownR[2]) : 0; }),
    rockHeight: VARIANT_DEFS.map((d) => (d.rock >= 0 ? rockAssets()[d.rock].height : 0)),
  };
  return tables;
}

class Placer {
  readonly fields: TerrainFields;
  readonly rules: PlacementRules;
  readonly blockers: SpatialHash;
  readonly rockHash: SpatialHash;
  readonly plantHash: SpatialHash;
  private readonly index: PathIndex | null;
  private readonly pick: Pick = { variant: 0, scale: 1, yaw: 0, tint: 0 };
  private readonly tables = lookup();
  private readonly sJit: number;
  private readonly sPerm: number;

  constructor(readonly terrain: TerrainData, private readonly track: TrackData | null, readonly region: Region) {
    const seed = deriveSeed(terrain.seed, 0x7e6e);
    this.fields = new TerrainFields(terrain);
    this.rules = new PlacementRules(this.fields, seed);
    this.sJit = deriveSeed(seed, 21) | 0;
    this.sPerm = deriveSeed(seed, 22) | 0;
    const e = (terrain.resolution - 1) * terrain.cellSize;
    const [ox, oz] = terrain.origin;
    this.blockers = buildBlockers(track, ox, oz, ox + e, oz + e);
    this.rockHash = new SpatialHash(ox, oz, ox + e, oz + e, 6, 4096);
    this.plantHash = new SpatialHash(ox, oz, ox + e, oz + e, 9, 8192);
    this.index = track && track.path.length > 0 ? new PathIndex(track.path) : null;
  }

  /** Exact horizontal distance to the racing line when the cell is near it, otherwise Infinity. */
  private pathDistance(x: number, z: number, cellDist: number): number {
    if (!this.index || cellDist > NEAR_PATH) return Infinity;
    this.index.nearestXZ(x, z);
    return this.index.lastDist;
  }

  /** Height of the lowest of five samples under a rock, less the buried fraction of its height. */
  private rockBase(x: number, z: number, radius: number, sink: number, height: number): number {
    const f = this.fields, e = radius * 0.7;
    const low = Math.min(f.height(x, z), f.height(x + e, z), f.height(x - e, z), f.height(x, z + e), f.height(x, z - e));
    return low - sink * height * radius;
  }

  placeRocks(cap: number): InstanceSet {
    const out = makeSet(cap), r = this.region, pick = this.pick, f = this.fields;
    for (const c of r.order) {
      if (out.count >= cap) break;
      const ci = r.i0 + (c % r.nx), cj = r.j0 + Math.floor(c / r.nx), cellDist = r.dist[c];
      const n2 = ROCK_PER_COARSE * ROCK_PER_COARSE, off = Math.floor(hash2(ci, cj, this.sPerm + 1) * n2);
      for (let s = 0; s < n2 && out.count < cap; s++) {
        const k = (s * 7 + off) % n2;
        const cx = ci * ROCK_PER_COARSE + (k % ROCK_PER_COARSE), cz = cj * ROCK_PER_COARSE + Math.floor(k / ROCK_PER_COARSE);
        const x = (cx + 0.1 + 0.8 * hash2(cx, cz, this.sJit + 1)) * ROCK_CELL, z = (cz + 0.1 + 0.8 * hash2(cx, cz, this.sJit + 2)) * ROCK_CELL;
        if (!f.inside(x, z, 6) || !this.rules.rock(cx, cz, x, z, pick)) continue;
        const rad = pick.scale;
        const d = this.pathDistance(x, z, cellDist);
        if (d < ROCK_PATH_CLEARANCE + rad) continue;
        if (this.blockers.overlaps(x, z, rad, 0.5) || this.rockHash.conflicts(x, z, rad, 0, 1.3, 1.3)) continue;
        const nrm = packNormal(f.gx, f.gz);
        const sink = 0.15 + 0.25 * hash2(cx, cz, this.sJit + 3);
        push(out, x, this.rockBase(x, z, rad, sink, this.tables.rockHeight[pick.variant]), z, pick, nrm, d);
        this.rockHash.add(x, z, rad, 0);
      }
    }
    return take(out, out.count);
  }

  placePlants(cap: number): InstanceSet {
    const out = makeSet(cap), r = this.region, pick = this.pick, f = this.fields;
    const n2 = PLANT_PER_COARSE * PLANT_PER_COARSE;
    for (const c of r.order) {
      if (out.count >= cap) break;
      const ci = r.i0 + (c % r.nx), cj = r.j0 + Math.floor(c / r.nx), cellDist = r.dist[c];
      const off = Math.floor(hash2(ci, cj, this.sPerm) * n2);
      for (let s = 0; s < n2 && out.count < cap; s++) {
        const k = (s * 37 + off) % n2;
        const cx = ci * PLANT_PER_COARSE + (k % PLANT_PER_COARSE), cz = cj * PLANT_PER_COARSE + Math.floor(k / PLANT_PER_COARSE);
        const x = (cx + 0.1 + 0.8 * hash2(cx, cz, this.sJit)) * PLANT_CELL, z = (cz + 0.1 + 0.8 * hash2(cx, cz, this.sJit + 7)) * PLANT_CELL;
        if (!f.inside(x, z, 6)) continue;
        const kind = this.rules.plant(cx, cz, x, z, pick);
        if (kind === 0) continue;
        const d = this.pathDistance(x, z, cellDist);
        if (d < PATH_CLEARANCE) continue;
        if (d < CORRIDOR_WIDTH && hash2(cx, cz, this.sJit + 9) >= CORRIDOR_DENSITY + (1 - CORRIDOR_DENSITY) * smoothstep(PATH_CLEARANCE, CORRIDOR_WIDTH, d)) continue;
        const scale = pick.scale, def = VARIANT_DEFS[pick.variant], group = kind - 1;
        if (this.blockers.overlaps(x, z, 0.8 * this.tables.crown[pick.variant] * scale, 1)) continue;
        if (this.rockHash.overlaps(x, z, group === 0 ? TREE_TRUNK : BUSH_TRUNK, 0.3)) continue;
        if (this.plantHash.conflicts(x, z, def.spacing * scale, group, 1, 0.6)) continue;
        const nrm = packNormal(f.gx, f.gz);
        push(out, x, f.height(x, z) - 0.05 * scale, z, pick, nrm, d);
        this.plantHash.add(x, z, def.spacing * scale, group);
      }
    }
    return take(out, out.count);
  }
}

/**
 * Deterministic tree, bush and rock placement for a terrain and track: jittered-grid Poisson-disc sampling gated by the
 * density rules, walked from the racing line outwards so `limits` keeps the nearest ground and smaller tiers are prefixes.
 */
export function placeVegetation(terrain: TerrainData, track: TrackData | null, limits: PlacementLimits): VegPlacement {
  const e = (terrain.resolution - 1) * terrain.cellSize;
  const [ox, oz] = terrain.origin;
  const region = buildRegion(track, [ox + e / 2, oz + e / 2], REGION_RADIUS, [ox, oz, ox + e, oz + e], deriveSeed(terrain.seed, 0x7e6e, 23) | 0);
  const placer = new Placer(terrain, track, region);
  const rocks = placer.placeRocks(ROCK_CAP);
  const plants = placer.placePlants(limits.plants);
  const shown = limits.rocks < rocks.count ? take(rocks, limits.rocks) : rocks;
  let trees = 0;
  for (let i = 0; i < plants.count; i++) if (VARIANT_DEFS[plants.variant[i]].group === 'tree') trees++;
  return { plants, rocks: shown, trees, bushes: plants.count - trees };
}
