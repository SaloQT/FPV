import { describe, expect, it } from 'vitest';
import { qualityProfile } from '../contracts';
import { PROBE_MAX_STRIDE, PROBE_RAY_BUDGET, probeStride } from './probes';

const grid = (tier: 'low' | 'medium' | 'high' | 'ultra'): [number, number] => {
  const p = qualityProfile(tier).probes;
  return [p.dim[0] * p.dim[1] * p.dim[2], p.raysPerProbe];
};

describe('probeStride', () => {
  it('refreshes every probe each frame while the grid fits the budget', () => {
    expect(probeStride(...grid('low'))).toBe(1);
  });

  it('rotates through 1/K of a bigger grid so that the per-frame rays stay within the budget', () => {
    expect(probeStride(...grid('medium'))).toBe(3);
    expect(probeStride(...grid('high'))).toBe(7);
    for (const tier of ['medium', 'high'] as const) {
      const [total, perProbe] = grid(tier);
      expect(Math.ceil(total / probeStride(total, perProbe)) * perProbe).toBeLessThanOrEqual(PROBE_RAY_BUDGET + perProbe);
    }
  });

  it('is capped by the maximum stride (the ultra grid cannot meet the budget)', () => {
    expect(probeStride(...grid('ultra'))).toBe(PROBE_MAX_STRIDE);
  });

  it('scales with the budget and tolerates degenerate ones', () => {
    const [total, perProbe] = grid('high');
    expect(probeStride(total, perProbe, PROBE_RAY_BUDGET * 2)).toBe(4);
    expect(probeStride(total, perProbe, 1e12)).toBe(1);
    expect(probeStride(total, perProbe, 0)).toBe(PROBE_MAX_STRIDE);
    expect(probeStride(total, perProbe, 1, 4)).toBe(4);
  });
});
