import { describe, expect, it } from 'vitest';
import { qualityProfile, type QualityProfile } from '../contracts';
import { performanceProfile } from '../qualityPresets';
import { PROBE_MAX_STRIDE, PROBE_RAY_BUDGET, probeLimits, probeStride } from './probes';

const tiers = ['low', 'medium', 'high', 'ultra'] as const;
const grid = (q: QualityProfile): [number, number] => [q.probes.dim[0] * q.probes.dim[1] * q.probes.dim[2], q.probes.raysPerProbe];

/** Probe work per frame in BVH / heightfield steps: the rays of the rotating subset times the walk each ray may take. */
function probeCost(q: QualityProfile): number {
  const [total, perProbe] = grid(q);
  const { rayBudget, maxStride } = probeLimits(q);
  return Math.ceil(total / probeStride(total, perProbe, rayBudget, maxStride)) * perProbe * q.rtMaxSteps;
}

describe('probeStride', () => {
  it('refreshes every probe each frame while the grid fits the budget', () => {
    expect(probeStride(1000, 32)).toBe(1);
    expect(probeStride(PROBE_RAY_BUDGET / 64, 64)).toBe(1);
  });

  it('rotates through 1/K of a bigger grid so that the per-frame rays stay within the budget', () => {
    const [total, perProbe] = grid(qualityProfile('high'));
    expect(probeStride(total, perProbe)).toBe(7);
    expect(Math.ceil(total / probeStride(total, perProbe)) * perProbe).toBeLessThanOrEqual(PROBE_RAY_BUDGET + perProbe);
  });

  it('is capped by the maximum stride', () => {
    const [total, perProbe] = grid(qualityProfile('ultra'));
    expect(probeStride(total, perProbe)).toBe(PROBE_MAX_STRIDE);
  });

  it('scales with the budget and tolerates degenerate ones', () => {
    const [total, perProbe] = grid(qualityProfile('high'));
    expect(probeStride(total, perProbe, PROBE_RAY_BUDGET * 2)).toBe(4);
    expect(probeStride(total, perProbe, 1e12)).toBe(1);
    expect(probeStride(total, perProbe, 0)).toBe(PROBE_MAX_STRIDE);
    expect(probeStride(total, perProbe, 1, 4)).toBe(4);
  });
});

describe('probeLimits', () => {
  it('gives High the reference budget and the reference rotation cap', () => {
    expect(probeLimits(qualityProfile('high'))).toEqual({ rayBudget: PROBE_RAY_BUDGET, maxStride: PROBE_MAX_STRIDE });
  });

  it('grows with the profile: Low < Medium < High < Ultra rays per frame', () => {
    const budgets = tiers.map((t) => probeLimits(qualityProfile(t)).rayBudget);
    for (let i = 1; i < budgets.length; i++) expect(budgets[i]).toBeGreaterThan(budgets[i - 1]);
  });

  it('lets a cheap profile rotate longer, never below the reference cap and never beyond 32', () => {
    for (const t of tiers) {
      const { maxStride } = probeLimits(qualityProfile(t));
      expect(maxStride).toBeGreaterThanOrEqual(PROBE_MAX_STRIDE);
      expect(maxStride).toBeLessThanOrEqual(32);
    }
    expect(probeLimits(qualityProfile('low')).maxStride).toBeGreaterThan(probeLimits(qualityProfile('high')).maxStride);
  });

  it('makes Low trace fewer probe rays than its grid holds (it used to refresh the whole grid every frame)', () => {
    const q = qualityProfile('low');
    const [total, perProbe] = grid(q);
    const { rayBudget, maxStride } = probeLimits(q);
    expect(probeStride(total, perProbe, rayBudget, maxStride)).toBeGreaterThan(1);
  });

  it('keeps the per-frame probe rays of every tier within its budget (Ultra is bounded by the rotation cap instead)', () => {
    for (const t of ['low', 'medium', 'high'] as const) {
      const q = qualityProfile(t);
      const [total, perProbe] = grid(q);
      const { rayBudget, maxStride } = probeLimits(q);
      const stride = probeStride(total, perProbe, rayBudget, maxStride);
      expect(Math.ceil(total / stride) * perProbe).toBeLessThanOrEqual(rayBudget + perProbe);
    }
  });

  it('orders the probe cost of the tiers', () => {
    const cost = tiers.map((t) => probeCost(qualityProfile(t)));
    for (let i = 1; i < cost.length; i++) expect(cost[i]).toBeGreaterThan(cost[i - 1]);
  });

  it('makes Performance 240 cost clearly less than the tier it derives from, and Low less than half of High', () => {
    for (const t of tiers) {
      const base = qualityProfile(t);
      expect(probeCost(performanceProfile(base))).toBeLessThan(0.5 * probeCost(base));
    }
    expect(probeCost(qualityProfile('low'))).toBeLessThan(0.5 * probeCost(qualityProfile('high')));
  });

  it('has a floor so that a degenerate profile still gets probe updates', () => {
    expect(probeLimits({ giRays: 0, rtMaxSteps: 1 }).rayBudget).toBe(20_000);
  });
});
