/**
 * generateTrack: a pure function of (params, terrain). Up to CANDIDATES layouts are generated from seeds derived from the base
 * seed, each is assembled into gates + a smooth path, validated and scored (score.ts); the cheapest valid one wins. When no
 * candidate at the requested gate count is valid the count steps down (a "fallback rung") until one is. Obstacles are placed on
 * the winner only, and the finished track is validated once more.
 *
 * Style 'custom' builds from params.recipe (sanitised first): the recipe's seed, gate count, laps and difficulty replace the
 * params' own, and the track carries the sanitised recipe.
 */
import type { GeneratedStyle, TerrainSampler, TrackData, TrackParams, TrackRecipe } from '../../contracts';
import { assemble } from './assemble';
import { makeCtx, type Layout, type LayoutCtx, type LayoutProp } from './layout';
import { acroLayout, chainLayout, industrialLayout, technicalLayout } from './layoutChain';
import { raceLayout } from './layoutRace';
import { freestyleLayout, sprintLayout } from './layoutOpen';
import { mountainLayout } from './layoutMountain';
import { placeObstacles } from './placement';
import { chainSpecForRecipe, defaultRecipe, sanitizeRecipe, specForRecipe } from './recipe';
import { Rng, deriveSeed } from './rng';
import { scoreTrack } from './score';
import { pathCurvature } from './spline';
import { findStartPad } from './startPad';
import { FALLBACK_MIN_GATES, STYLE_SPECS, type StyleSpec, type TrackStyle } from './styles';
import { validateTrack } from './validate';

/** Candidates tried at the requested gate count, and how many valid ones are enough to stop early. */
const CANDIDATES = 20;
const ENOUGH_VALID = 4;
/** Candidates per fallback rung (fewer gates), and how many valid ones are enough to stop early. */
const FALLBACK_CANDIDATES = 10;
const FALLBACK_ENOUGH = 2;

/** A custom track: the recipe's chain, with the candidate's own stream jittering what the recipe leaves open. */
function customLayout(c: LayoutCtx): Layout | null {
  return chainLayout(c, chainSpecForRecipe(c.recipe ?? defaultRecipe(), c.rng));
}

const LAYOUTS: Record<TrackStyle, (c: LayoutCtx) => Layout | null> = {
  race: raceLayout,
  freestyle: freestyleLayout,
  mountain: mountainLayout,
  sprint: sprintLayout,
  technical: technicalLayout,
  acro: acroLayout,
  industrial: industrialLayout,
  custom: customLayout,
};

const STYLE_SALT: Record<TrackStyle, number> = { race: 1, freestyle: 2, mountain: 3, sprint: 4, technical: 5, acro: 6, industrial: 7, custom: 8 };

interface Candidate {
  track: TrackData;
  cost: number;
  /** Obstacles the layout asked for (a hairpin's pylon), placed on the winner before the scenery. */
  props: LayoutProp[];
}

interface Request {
  params: TrackParams;
  spec: StyleSpec;
  /** Seed the candidates derive from: the params' seed, or the recipe's for a custom track. */
  seed: number;
  recipe?: TrackRecipe;
  difficulty: number;
  laps: number;
  requested: number;
}

/** One layout -> assembled -> start pad -> validated -> scored, or null when any stage fails. */
function attempt(req: Request, sampler: TerrainSampler, gateCount: number, seed: number): Candidate | null {
  const { params, spec, difficulty } = req;
  const c = makeCtx(sampler, spec, difficulty, gateCount, new Rng(seed), req.recipe);
  const layout = LAYOUTS[params.style](c);
  if (!layout) return null;
  const asm = assemble(c, layout);
  if (!asm) return null;
  const pad = findStartPad(asm.gates, sampler);
  if (!pad) return null;
  const track: TrackData = {
    seed: req.seed,
    style: params.style,
    gates: asm.gates,
    obstacles: [],
    path: asm.path,
    closed: asm.closed,
    length: asm.length,
    start: pad,
    laps: req.laps,
  };
  if (req.recipe) track.recipe = req.recipe;
  const kappa = pathCurvature(track.path, track.closed, 2);
  const v = validateTrack(track, sampler, kappa);
  if (!v.ok) return null;
  return { track, cost: scoreTrack(track, v.stats, kappa, spec, difficulty, req.requested), props: layout.props ?? [] };
}

/** Gate counts to try in order: the request, then progressively fewer down to FALLBACK_MIN_GATES. */
function ladder(requested: number): number[] {
  const rungs = [requested];
  for (const f of [0.8, 0.65, 0.5, 0.35, 0]) {
    const n = f === 0 ? FALLBACK_MIN_GATES : Math.max(FALLBACK_MIN_GATES, Math.round(requested * f));
    if (n < rungs[rungs.length - 1]) rungs.push(n);
  }
  return rungs;
}

function search(req: Request, sampler: TerrainSampler): Candidate | null {
  const { params } = req;
  const rungs = ladder(req.requested);
  for (let r = 0; r < rungs.length; r++) {
    const budget = r === 0 ? CANDIDATES : FALLBACK_CANDIDATES;
    const enough = r === 0 ? ENOUGH_VALID : FALLBACK_ENOUGH;
    let best: Candidate | null = null;
    let valid = 0;
    for (let k = 0; k < budget && valid < enough; k++) {
      const cand = attempt(req, sampler, rungs[r], deriveSeed(req.seed, STYLE_SALT[params.style], r, k));
      if (!cand) continue;
      valid++;
      if (!best || cand.cost < best.cost) best = cand;
    }
    if (best) return best;
  }
  return null;
}

/** Upper bound on laps so an Infinity request stays a valid integer. */
const MAX_LAPS = 99;

/** `v`, or `fallback` when it is missing or NaN (a failed parse); infinities are left for the caller's clamp. */
function orDefault(v: number | undefined, fallback: number): number {
  return v === undefined || Number.isNaN(v) ? fallback : v;
}

/** The request for a custom track: the recipe's seed, gate count, laps and difficulty win over the params' own. */
function customRequest(params: TrackParams): Request {
  const recipe = sanitizeRecipe(params.recipe ?? defaultRecipe());
  const spec = specForRecipe(recipe);
  return { params, spec, seed: recipe.seed, recipe, difficulty: recipe.difficulty, laps: recipe.closed ? recipe.laps : 1, requested: recipe.gateCount };
}

function styleRequest(params: TrackParams, style: GeneratedStyle): Request {
  const spec = STYLE_SPECS[style];
  const difficulty = Math.min(Math.max(orDefault(params.difficulty, 0.5), 0), 1);
  const requested = Math.min(Math.max(Math.round(orDefault(params.gateCount, spec.defaultGates)), spec.minGates), spec.maxGates);
  const laps = Math.min(Math.max(Math.round(orDefault(params.laps, spec.defaultLaps)), 1), MAX_LAPS);
  return { params, spec, seed: params.seed, difficulty, laps, requested };
}

/**
 * Deterministic per (seed, style, gateCount, laps, difficulty, terrain), or per (recipe, terrain) for style 'custom'. Throws only
 * when the terrain has no room for even a 4-gate track.
 */
export function generateTrack(params: TrackParams, sampler: TerrainSampler): TrackData {
  const req = params.style === 'custom' ? customRequest(params) : styleRequest(params, params.style);
  const best = search(req, sampler);
  if (!best) throw new Error(`generateTrack: no valid ${params.style} track fits this terrain (seed ${req.seed})`);
  const track = best.track;
  track.obstacles = placeObstacles(track, sampler, new Rng(deriveSeed(req.seed, STYLE_SALT[params.style], 0x0b57)), best.props);
  if (!validateTrack(track, sampler).ok) track.obstacles = [];
  return track;
}
