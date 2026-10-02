import type { Settings } from '../contracts';
import { qualityProfile, type QualityProfile } from './contracts';
import { probeLimits, probeStride } from './rt/probes';

const MIN_STEPS = 32;
const MIN_PROBE_RAYS = 24;
const MIN_PROBE_DIM = 6;

const evenAtLeast = (v: number, min: number): number => Math.max(min, Math.round(v / 2) * 2);

/**
 * 'Performance 240': the same tier with the budgets that cost the most GPU time cut where temporal accumulation (TAA, probe history,
 * cloud history) hides most of it: one GI ray per pixel, shorter BVH/heightfield walks, a denser-spaced but smaller probe grid that
 * refreshes more often per frame, fewer cloud steps, thinner and nearer grass and one detail octave less. Resolution of the ray
 * targets, reflections, bloom and TAA are kept, and `tier` is kept so the tier-keyed tables (tree LOD, instance counts, stars) match.
 */
export function performanceProfile(base: QualityProfile): QualityProfile {
  const dimScale = 0.75;
  return {
    ...base,
    giRays: 1,
    rtMaxSteps: Math.max(MIN_STEPS, Math.round(base.rtMaxSteps * 0.67)),
    probes: {
      dim: [evenAtLeast(base.probes.dim[0] * dimScale, MIN_PROBE_DIM), evenAtLeast(base.probes.dim[1] * dimScale, MIN_PROBE_DIM), evenAtLeast(base.probes.dim[2] * dimScale, MIN_PROBE_DIM)],
      raysPerProbe: Math.max(MIN_PROBE_RAYS, Math.round(base.probes.raysPerProbe / 2)),
      spacing: Math.round((base.probes.spacing / dimScale) * 2) / 2,
    },
    cloudSteps: Math.max(12, Math.round(base.cloudSteps * 0.6)),
    grassBladesPerM2: Math.round(base.grassBladesPerM2 * 0.65),
    grassDistance: Math.round(base.grassDistance * 0.85),
    detailOctaves: Math.max(2, base.detailOctaves - 1),
  };
}

/** The profile the renderer runs for these settings. */
export function resolveQuality(s: Pick<Settings, 'quality' | 'performance240'>): QualityProfile {
  const base = qualityProfile(s.quality);
  return s.performance240 ? performanceProfile(base) : base;
}

/** True when two profiles ask the modules for exactly the same work. */
export function sameProfile(a: QualityProfile, b: QualityProfile): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Relative GPU cost of a profile at a given render size, in arbitrary units (1 unit is about one million BVH or heightfield steps per
 * frame, with clouds, grass and terrain detail converted at rough per-sample weights). An analytic proxy for ordering tiers and for the
 * tests: it counts what the modules are asked to do, it is not a measurement of any GPU.
 */
export function qualityCostIndex(q: QualityProfile, width = 1920, height = 1080): number {
  const rtPixels = (width / q.rtDivisor) * (height / q.rtDivisor);
  const walk = q.rtMaxSteps * 0.5;
  const gi = rtPixels * q.giRays * walk;
  const shadow = rtPixels * walk * 0.5;
  const spec = q.rtSpecular ? rtPixels * walk : 0;
  const probeCount = q.probes.dim[0] * q.probes.dim[1] * q.probes.dim[2];
  const { rayBudget, maxStride } = probeLimits(q);
  const stride = probeStride(probeCount, q.probes.raysPerProbe, rayBudget, maxStride);
  const probes = Math.ceil(probeCount / stride) * q.probes.raysPerProbe * walk;
  const clouds = (width * height) / 4 * q.cloudSteps * 2;
  const grass = Math.min(Math.PI * q.grassDistance * q.grassDistance * q.grassBladesPerM2, 4_000_000) * 6;
  const detail = width * height * q.detailOctaves * 12;
  return (gi + shadow + spec + probes + clouds + grass + detail) / 1e6;
}
