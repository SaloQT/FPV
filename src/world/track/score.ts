/**
 * Candidate scoring. Every valid candidate gets a cost (lower is better); the generator keeps the cheapest. Terms, all >= 0:
 *   flow      3.0 x mean over the path of min(k / k0, 2)^2        smooth, evenly curving lines beat twitchy ones (k0 = 1 / target radius)
 *   safety    6.0 x max(0, kMax / k0 - 1)                          the single tightest corner, the one that crashes a pilot
 *   length    2.0 x |L - mid| / half-range                         total length near the middle of the style's allowed range
 *   relief    2.0 x (distance outside [lo, hi]) / (hi - lo)         std-dev of path height wanted inside [lo, hi] for the style
 *   spacing   1.5 x (1 - (minSeparation - 8) / 4), clamped 0..1    stretches of path that pass close to each other are penalised
 *   gates     3.0 x (1 - gates / requested)                        candidates that dropped gates lose to full-size ones
 *   dives     2.0 when a freestyle or mountain track has no dive gate  the signature gate of both styles
 *   variety   1.5 x (1 - distinct features / min(wanted, 4))      feature tracks: several kinds of manoeuvre beat one repeated
 * On feature tracks (StyleSpec.features) flow and safety skip the feature zones, whose tight turns are the point of the feature.
 * Validity (hard limits) is decided by validateTrack; the cost only ranks tracks that already passed.
 */
import type { TrackData, TrackRecipe, TrackStyle } from '../../contracts';
import { MIN_PATH_SEPARATION, SEPARATION_PROBE } from './validateParts';
import type { TrackStats } from './validate';
import { targetTurnRadius, type StyleSpec } from './styles';
import { featureZones } from './validateFeatures';

/** Wanted standard deviation of path height (m) per style: [low, high]. */
const RELIEF: Record<Exclude<TrackStyle, 'custom'>, [number, number]> = {
  race: [1.5, 6],
  freestyle: [4, 15],
  mountain: [10, 40],
  sprint: [0.3, 3],
  technical: [2, 8],
  acro: [5, 18],
  industrial: [2, 8],
};

/** Relief wanted for a track: its style's, or for a custom track a band that rises with the recipe's elevation. */
export function reliefBand(style: TrackStyle, recipe?: TrackRecipe): [number, number] {
  if (style !== 'custom') return RELIEF[style];
  const e = recipe?.elevation ?? 0.4;
  return [0.5 + 6 * e, 4 + 18 * e];
}

/** Distinct manoeuvres a feature track should show off, at most. */
const VARIETY = 4;

export function scoreTrack(track: TrackData, stats: TrackStats, kappa: Float32Array, spec: StyleSpec, difficulty: number, requestedGates: number): number {
  const k0 = 1 / targetTurnRadius(difficulty);
  const zones = spec.features ? featureZones(track) : null;
  let flow = 0;
  let counted = 0;
  let kMax = 0;
  for (let i = 0; i < kappa.length; i++) {
    if (zones && zones.sampleZone[i] >= 0) continue;
    const r = Math.min(kappa[i] / k0, 2);
    flow += r * r;
    counted++;
    if (kappa[i] > kMax) kMax = kappa[i];
  }
  flow /= Math.max(counted, 1);
  let variety = 0;
  if (zones) {
    const kinds = new Set(zones.zones.map((z) => z.feature)).size;
    const wanted = Math.min(VARIETY, Math.max(1, Math.round(track.gates.length / 4)));
    variety = Math.max(1 - kinds / wanted, 0);
  }
  const wantsDive = track.style === 'freestyle' || track.style === 'mountain';
  const mid = (spec.minLength + spec.maxLength) / 2;
  const half = (spec.maxLength - spec.minLength) / 2;
  const [lo, hi] = reliefBand(track.style, track.recipe);
  const outside = Math.max(lo - stats.elevationStd, 0, stats.elevationStd - hi);
  const spacing = Math.min(Math.max(1 - (Math.min(stats.minPathSeparation, SEPARATION_PROBE) - MIN_PATH_SEPARATION) / (SEPARATION_PROBE - MIN_PATH_SEPARATION), 0), 1);
  return (
    3 * flow +
    6 * Math.max((zones ? kMax : stats.maxCurvature) / k0 - 1, 0) +
    2 * (Math.abs(track.length - mid) / half) +
    2 * (outside / (hi - lo)) +
    1.5 * spacing +
    3 * (1 - Math.min(track.gates.length / requestedGates, 1)) +
    (wantsDive && !track.gates.some((g) => g.kind === 'dive') ? 2 : 0) +
    1.5 * variety
  );
}
