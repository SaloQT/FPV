/**
 * The world mixes the trainer and the evaluator fly: generator styles in turn, random track-builder recipes, and track files.
 * World k keeps the trainer's long-standing seed (1000 + 7919 k + seed), but its style now cycles through all seven generated
 * styles, and the last worlds / 6 are recipes, so from world 4 on the default mix flies different tracks than before.
 * `styles: CLASSIC_STYLES, recipes: 0` (train.mjs --styles race,freestyle,mountain,sprint --recipes 0) gives the old mix.
 */
import type { GeneratedStyle, TerrainQuality } from '../../contracts';
import { GENERATED_STYLES } from '../../contracts';
import { randomRecipe } from '../../world/track/recipe';
import { parseTrackFile } from './trackFile';
import { buildTrainWorld, type TrainWorld, type WorldSpec } from './worlds';

/** The original four styles (the evaluator's default, so its numbers stay comparable with the published brains). */
export const CLASSIC_STYLES: readonly GeneratedStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];

export interface MixOptions {
  /** World count: style worlds plus recipe worlds. */
  worlds: number;
  seed: number;
  /** Styles in turn (default every generated style). */
  styles?: readonly GeneratedStyle[];
  /** How many of the worlds are random recipes (default a sixth of them, rounded). */
  recipes?: number;
}

/** A comma list of style names, checked against GENERATED_STYLES. */
export function parseStyles(list: string): GeneratedStyle[] {
  const out = list.split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of out) if (!(GENERATED_STYLES as readonly string[]).includes(s)) throw new Error(`unknown style ${s}: use ${GENERATED_STYLES.join(', ')}`);
  if (!out.length) throw new Error('no styles given');
  return out as GeneratedStyle[];
}

/** Default recipe worlds in a mix of `worlds`. */
export function defaultRecipes(worlds: number): number {
  return Math.round(worlds / 6);
}

/** The trainer's worlds: style worlds first (difficulty 0.3..0.7 in turn), then random recipes, each on its own terrain. */
export function trainWorldSpecs(o: MixOptions): WorldSpec[] {
  const styles = o.styles?.length ? o.styles : GENERATED_STYLES;
  const recipes = Math.min(o.worlds, Math.max(0, Math.round(o.recipes ?? defaultRecipes(o.worlds))));
  const specs: WorldSpec[] = [];
  for (let k = 0; k < o.worlds; k++) {
    const seed = 1000 + 7919 * k + o.seed;
    if (k < o.worlds - recipes) specs.push({ seed, style: styles[k % styles.length], difficulty: 0.3 + 0.1 * (k % 5) });
    else specs.push({ seed, recipe: randomRecipe(seed) });
  }
  return specs;
}

/** The evaluator's worlds: seeds far from the trainer's (900001 + 104729 k), styles in turn, then random recipes. */
export function evalWorldSpecs(o: MixOptions): WorldSpec[] {
  const styles = o.styles?.length ? o.styles : CLASSIC_STYLES;
  const recipes = Math.max(0, Math.round(o.recipes ?? 0));
  const specs: WorldSpec[] = [];
  for (let k = 0; k < o.worlds + recipes; k++) {
    const seed = 900001 + 104729 * k + o.seed;
    specs.push(k < o.worlds ? { seed, style: styles[k % styles.length], difficulty: 0.5 } : { seed, recipe: randomRecipe(seed) });
  }
  return specs;
}

/** Terrains tried for one world spec before giving up on it. */
export const WORLD_TERRAIN_ATTEMPTS = 3;
const TERRAIN_STEP = 1000003;

/**
 * Builds a mix world; when its terrain has no valid layout (buildTrack throws after its own seed and style retries) the next
 * terrain seeds are tried. Throws after WORLD_TERRAIN_ATTEMPTS terrains. Track-file worlds are never moved to another terrain.
 */
export function buildMixWorld(spec: WorldSpec): TrainWorld {
  if (spec.track) return buildTrainWorld(spec);
  let last: unknown;
  for (let i = 0; i < WORLD_TERRAIN_ATTEMPTS; i++) {
    try {
      return buildTrainWorld({ ...spec, seed: spec.seed + i * TERRAIN_STEP });
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** A world from a track file's text (TrackData or builder export); `quality` applies when the file does not name one. */
export function trackFileWorld(text: string, opts: { quality?: TerrainQuality; vegetation?: boolean } = {}): TrainWorld {
  const f = parseTrackFile(text);
  const w = buildTrainWorld({ seed: f.terrainSeed ?? f.track.seed, quality: f.quality ?? opts.quality ?? 'low', track: f.track, vegetation: opts.vegetation });
  if (f.terrainSeed === undefined) (w.warnings ??= []).unshift(`no terrainSeed in the file: built on terrain ${f.track.seed} (the track seed)`);
  return w;
}

/** One line about a world for the tools' logs. */
export function describeWorld(w: TrainWorld, k: number): string {
  const t = w.track;
  const feats = new Set(t.gates.map((g) => g.feature).filter(Boolean));
  const kinds = new Set(t.gates.map((g) => g.kind));
  return `world ${k}: ${w.source === 'file' ? 'file ' : ''}${w.style}${w.source === 'recipe' ? ' recipe' : ''}, seed ${w.seed}, ${t.gates.length} gates (${[...kinds].join(' ')})`
    + `${feats.size ? `, features ${[...feats].join(' ')}` : ''}, ${t.closed ? `circuit x${t.laps}` : 'open'}, ${t.path.length} path points, ${w.colliders.length} colliders`;
}
