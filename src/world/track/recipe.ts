/**
 * Track-builder recipes (TrackRecipe): limits for the builder's sliders, defaults, sanitising, random recipes for the trainer and
 * the builder's Randomise, a canonical key for leaderboards and share links, and the StyleSpec and chain settings a custom track
 * is generated and validated with.
 *
 * Every number is clamped and quantised to its slider step by sanitizeRecipe, and the generator only ever sees sanitised recipes,
 * so two recipes with the same key always build the same track on the same terrain.
 */
import { TRACK_FEATURES, type GateKind, type ObstacleKind, type TrackData, type TrackFeature, type TrackRecipe } from '../../contracts';
import type { HairpinPylon } from './features';
import type { ChainSpec } from './layoutChain';
import { Rng, deriveSeed } from './rng';
import { STYLE_SPECS, type StyleSpec } from './styles';

export interface RecipeLimit {
  min: number;
  max: number;
  step: number;
}

/** Numeric fields of a recipe (the weights share `weight`). */
export type RecipeNumberKey = 'seed' | 'laps' | 'gateCount' | 'length' | 'difficulty' | 'elevation' | 'twist' | 'obstacles' | 'featureShare';

/** min / max / step of every number in a recipe; `weight` is the range of every kind, feature and object weight. */
export const RECIPE_LIMITS: Readonly<Record<RecipeNumberKey | 'weight', RecipeLimit>> = {
  seed: { min: 0, max: 4294967295, step: 1 },
  laps: { min: 1, max: 10, step: 1 },
  gateCount: { min: 4, max: 40, step: 1 },
  length: { min: 200, max: 3000, step: 10 },
  difficulty: { min: 0, max: 1, step: 0.01 },
  elevation: { min: 0, max: 1, step: 0.01 },
  twist: { min: 0, max: 1, step: 0.01 },
  obstacles: { min: 0, max: 1, step: 0.01 },
  featureShare: { min: 0, max: 1, step: 0.01 },
  weight: { min: 0, max: 1, step: 0.05 },
};

/** Gate kinds a recipe may weight for the plain gates between manoeuvres (start and finish are placed by the generator). */
export const RECIPE_GATE_KINDS: readonly GateKind[] = ['square', 'arch', 'hoop', 'flag', 'dive', 'window', 'ladder', 'tunnel', 'hurdle', 'drop'];
/** Obstacle kinds a recipe may weight for its scenery. */
export const RECIPE_OBJECT_KINDS: readonly ObstacleKind[] = ['tree', 'rock', 'wall', 'pole', 'cone', 'flagpole', 'tower', 'container', 'pillar', 'beam', 'bridge', 'scaffold'];

const NUMBER_KEYS: readonly RecipeNumberKey[] = ['seed', 'laps', 'gateCount', 'length', 'difficulty', 'elevation', 'twist', 'obstacles', 'featureShare'];

export function defaultRecipe(): TrackRecipe {
  return {
    version: 1,
    seed: 1,
    closed: true,
    laps: 3,
    gateCount: 14,
    length: 700,
    difficulty: 0.5,
    elevation: 0.4,
    twist: 0.5,
    obstacles: 0.5,
    gates: { square: 0.6, arch: 0.3, hoop: 0.3, flag: 0.2 },
    features: { 'split-s': 0.6, hairpin: 0.5, ladder: 0.4, tunnel: 0.4, window: 0.4, hurdle: 0.4, slalom: 0.3, 'power-loop': 0.3, dive: 0.3 },
    featureShare: 0.5,
    objects: { tree: 0.5, rock: 0.3, container: 0.3, pillar: 0.2 },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Decimal places of a step (0.01 -> 2), so quantised values print canonically. */
function decimals(step: number): number {
  return step >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

/** `v` clamped to the limit and rounded to its step; `fallback` when it is not a finite number. */
function quantise(v: unknown, lim: RecipeLimit, fallback: number): number {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const c = Math.min(Math.max(x, lim.min), lim.max);
  const q = lim.min + Math.round((c - lim.min) / lim.step) * lim.step;
  return Number(Math.min(q, lim.max).toFixed(decimals(lim.step)));
}

function weights<K extends string>(raw: unknown, keys: readonly K[], fallback: Partial<Record<K, number>>): Partial<Record<K, number>> {
  const src = isRecord(raw) ? (raw as Record<string, unknown>) : (fallback as Record<string, unknown>);
  const out: Partial<Record<K, number>> = {};
  for (const k of keys) {
    const w = quantise(src[k], RECIPE_LIMITS.weight, 0);
    if (w > 0) out[k] = w;
  }
  return out;
}

/** A valid recipe from anything: numbers clamped and quantised, unknown keys and kinds dropped, missing fields defaulted. Never throws. */
export function sanitizeRecipe(raw: unknown): TrackRecipe {
  const d = defaultRecipe();
  const r = isRecord(raw) ? raw : {};
  const num = (k: RecipeNumberKey): number => quantise(r[k], RECIPE_LIMITS[k], d[k]);
  const closed = typeof r.closed === 'boolean' ? r.closed : d.closed;
  return {
    version: 1,
    seed: num('seed') >>> 0,
    closed,
    laps: closed ? num('laps') : 1,
    gateCount: num('gateCount'),
    length: num('length'),
    difficulty: num('difficulty'),
    elevation: num('elevation'),
    twist: num('twist'),
    obstacles: num('obstacles'),
    gates: weights(r.gates, RECIPE_GATE_KINDS, d.gates),
    features: weights(r.features, TRACK_FEATURES, d.features),
    featureShare: num('featureShare'),
    objects: weights(r.objects, RECIPE_OBJECT_KINDS, d.objects),
  };
}

/** JSON with object keys sorted at every level. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isRecord(v)) {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Canonical text of a recipe (sanitised first): equal for recipes that build the same track, different otherwise. */
export function recipeKey(r: TrackRecipe): string {
  return canonical(sanitizeRecipe(r));
}

/** `count` distinct picks from `items`, in a deterministic shuffle. */
function some<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(count, a.length));
}

/** A varied but valid recipe, a pure function of `seed` (the trainer's recipe worlds, the builder's Randomise). */
export function randomRecipe(seed: number): TrackRecipe {
  const rng = new Rng(deriveSeed(seed >>> 0, 0x7ec1));
  const closed = rng.chance(0.6);
  const gateCount = rng.int(8, 22);
  const length = gateCount * rng.range(closed ? 38 : 45, closed ? 62 : 90);
  const gates: Partial<Record<GateKind, number>> = {};
  for (const k of some(rng, ['square', 'arch', 'hoop', 'flag', 'window', 'hurdle', 'ladder', 'dive'] as GateKind[], rng.int(2, 4))) gates[k] = rng.range(0.2, 1);
  if (!gates.square && !gates.arch && !gates.hoop) gates.square = rng.range(0.3, 1);
  const features: Partial<Record<TrackFeature, number>> = {};
  for (const f of some(rng, TRACK_FEATURES, rng.int(2, 5))) features[f] = rng.range(0.2, 1);
  const objects: Partial<Record<ObstacleKind, number>> = {};
  for (const k of some(rng, RECIPE_OBJECT_KINDS, rng.int(2, 4))) objects[k] = rng.range(0.2, 1);
  return sanitizeRecipe({
    version: 1,
    seed: seed >>> 0,
    closed,
    laps: closed ? rng.int(2, 4) : 1,
    gateCount,
    length,
    difficulty: rng.range(0.2, 0.8),
    elevation: rng.range(0.1, 0.9),
    twist: rng.range(0.2, 0.8),
    obstacles: rng.range(0.2, 0.8),
    gates,
    features,
    featureShare: rng.range(0.3, 0.75),
    objects,
  });
}

/** Length a recipe's layout aims for: the wanted length, kept between what its gates need and what they can fill. */
export function recipeLength(r: TrackRecipe): number {
  return Math.min(Math.max(r.length, r.gateCount * 24, 200), r.gateCount * 160, 3200);
}

/** The limits a custom track is generated and validated against (style 'custom'). */
export function specForRecipe(r: TrackRecipe): StyleSpec {
  const len = recipeLength(r);
  return {
    style: 'custom',
    minGates: RECIPE_LIMITS.gateCount.min,
    maxGates: RECIPE_LIMITS.gateCount.max,
    defaultGates: r.gateCount,
    minLength: Math.round(len * 0.5),
    maxLength: Math.round(len * 1.6 + 80),
    closed: r.closed,
    defaultLaps: r.closed ? r.laps : 1,
    corridor: r.closed ? 0.38 : 0.42,
    liftAgl: 1.1 + 1.2 * r.elevation,
    features: true,
  };
}

/** The spec a track is validated against: its style's, or its recipe's for a custom track. */
export function trackSpec(track: Pick<TrackData, 'style' | 'recipe'>): StyleSpec {
  if (track.style === 'custom') return specForRecipe(sanitizeRecipe(track.recipe));
  return STYLE_SPECS[track.style];
}

function pickWeighted<K extends string>(w: Partial<Record<K, number>>, keys: readonly K[], rng: Rng, fallback: K): K {
  let sum = 0;
  for (const k of keys) sum += w[k] ?? 0;
  if (sum <= 0) return fallback;
  let x = rng.next() * sum;
  for (const k of keys) {
    x -= w[k] ?? 0;
    if (x < 0) return k;
  }
  return fallback;
}

/** What a hairpin turns around on this recipe's course: the recipe's objects decide. */
function recipePylon(r: TrackRecipe): HairpinPylon {
  if ((r.objects.pillar ?? 0) > 0) return 'pillar';
  if ((r.objects.wall ?? 0) > 0) return 'wall';
  return 'flagpole';
}

/** Chain settings for a custom track; `rng` jitters the length so the generator's candidates differ. */
export function chainSpecForRecipe(r: TrackRecipe, rng: Rng): ChainSpec {
  return {
    closed: r.closed,
    features: r.features,
    required: [],
    featureShare: r.featureShare,
    plainKind: (g) => pickWeighted(r.gates, RECIPE_GATE_KINDS, g, 'square'),
    twist: r.twist,
    elevation: r.elevation,
    length: recipeLength(r) * rng.range(0.92, 1.08),
    pylon: recipePylon(r),
  };
}
