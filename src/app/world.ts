/**
 * World building: terrain, then a track that fits it. `generateTrack` throws when a terrain has no valid layout, so the
 * builder retries with other seeds, then other styles, then another terrain. Pure logic over injected generators.
 */
import type { ProgressFn, RenderQuality, TerrainData, TerrainParams, TerrainSampler, TrackData, TrackParams } from '../contracts';

export type TrackStyle = TrackData['style'];
export const ALL_STYLES: readonly TrackStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];

/** Seeds tried with the requested style before falling back to other styles. */
export const SEED_ATTEMPTS = 8;
/** Seeds tried for each other style. */
export const STYLE_FALLBACK_SEEDS = 2;
/** Terrains generated (seed, seed+1000003, ...) before giving up. */
export const TERRAIN_ATTEMPTS = 3;
const TERRAIN_SEED_STEP = 1000003;

export interface WorldDeps {
  generateTerrain(params: TerrainParams, onProgress?: ProgressFn): Promise<TerrainData>;
  createSampler(data: TerrainData): TerrainSampler;
  generateTrack(params: TrackParams, sampler: TerrainSampler): TrackData;
}

export interface TrackRequest {
  seed: number;
  style: TrackStyle;
  gateCount: number;
  laps: number;
  difficulty: number;
}

export interface WorldRequest extends TrackRequest {
  quality: RenderQuality;
  /** Seed of the terrain when it is not the track seed (a share link to a track that came from the N key); default `seed`. */
  terrainSeed?: number;
}

export interface TrackResult {
  track: TrackData;
  /** The seed and style that finally produced a layout (they differ from the request after a fallback). */
  seed: number;
  style: TrackStyle;
  /** Generator calls made, including the successful one. */
  attempts: number;
  /** The exact parameters the generator was called with for `track` (after the retries): what a share link must carry to rebuild it. */
  request: TrackRequest;
}

export interface World extends TrackResult {
  terrain: TerrainData;
  sampler: TerrainSampler;
  /** Seed of the terrain actually generated (differs from `baseSeed` after a terrain retry). */
  terrainSeed: number;
  /** The seed setting this world was built from; a different setting later means a new world, not just a new track. */
  baseSeed: number;
  quality: RenderQuality;
}

export interface Attempt {
  seed: number;
  style: TrackStyle;
}

/** The order in which (seed, style) pairs are tried on one terrain. */
export function* trackAttempts(seed: number, style: TrackStyle): Generator<Attempt> {
  for (let i = 0; i < SEED_ATTEMPTS; i++) yield { seed: seed + i, style };
  for (const other of ALL_STYLES) {
    if (other === style) continue;
    for (let i = 0; i < STYLE_FALLBACK_SEEDS; i++) yield { seed: seed + i, style: other };
  }
}

/** Generates a track on `sampler`, retrying per `trackAttempts`. Throws an Error listing the failures when nothing fits. */
export function buildTrack(sampler: TerrainSampler, req: TrackRequest, deps: Pick<WorldDeps, 'generateTrack'>): TrackResult {
  const failures: string[] = [];
  let attempts = 0;
  for (const a of trackAttempts(req.seed, req.style)) {
    attempts++;
    try {
      const made = deps.generateTrack({ seed: a.seed, style: a.style, gateCount: req.gateCount, laps: req.laps, difficulty: req.difficulty }, sampler);
      // The laps setting is for circuits: on a point-to-point track the timer would send the pilot back to gate 0 for every extra lap.
      const track = made.closed || made.laps <= 1 ? made : { ...made, laps: 1 };
      return { track, seed: a.seed, style: a.style, attempts, request: { seed: a.seed, style: a.style, gateCount: req.gateCount, laps: req.laps, difficulty: req.difficulty } };
    } catch (e) {
      failures.push(`${a.style}/${a.seed}: ${(e as Error).message}`);
    }
  }
  const err = new Error(`no valid track layout after ${attempts} attempts: ${failures.slice(0, 3).join('; ')}`);
  (err as Error & { failures?: string[] }).failures = failures;
  throw err;
}

/** Terrain (worker-generated, main-thread fallback inside `generateTerrain`) plus track, with fallbacks down to a new terrain. */
export async function buildWorld(req: WorldRequest, deps: WorldDeps, onProgress?: ProgressFn): Promise<World> {
  let lastError: unknown = null;
  const baseSeed = req.terrainSeed ?? req.seed;
  for (let t = 0; t < TERRAIN_ATTEMPTS; t++) {
    const terrainSeed = baseSeed + t * TERRAIN_SEED_STEP;
    const terrain = await deps.generateTerrain({ seed: terrainSeed, quality: req.quality }, (stage, f) => onProgress?.(stage, f * 0.9));
    const sampler = deps.createSampler(terrain);
    try {
      onProgress?.('Placing track', 0.92);
      const res = buildTrack(sampler, { ...req, seed: req.seed + t * TERRAIN_SEED_STEP }, deps);
      return { ...res, terrain, sampler, terrainSeed, baseSeed, quality: req.quality };
    } catch (e) {
      lastError = e;
      console.warn(`world: terrain ${terrainSeed} has no valid track, regenerating terrain`, e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
