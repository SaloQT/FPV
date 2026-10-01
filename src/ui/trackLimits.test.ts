import { describe, expect, it } from 'vitest';
import { generateTrack } from '../world/track/generator';
import { makeTestSampler } from '../world/track/testTerrain';
import { describeStyle, effectiveGates, effectiveLaps, gateRange, lapsApply } from './trackLimits';

const STYLES = ['race', 'freestyle', 'mountain', 'sprint'] as const;

describe('track limits', () => {
  it('clamp the gate count into what the style builds', () => {
    expect(gateRange('sprint')).toEqual({ min: 8, max: 12 });
    expect(effectiveGates('sprint', 20)).toBe(12);
    expect(effectiveGates('sprint', 4)).toBe(8);
    expect(effectiveGates('mountain', 12)).toBe(15);
    expect(effectiveGates('race', 12)).toBe(12);
  });

  it('describe what each style builds', () => {
    expect(describeStyle('race')).toBe('Circuit, 10 to 18 gates, 500 to 900 m a lap');
    expect(describeStyle('sprint')).toBe('Point to point, 8 to 12 gates, 300 to 500 m');
    expect(describeStyle('mountain')).toBe('Point to point, 15 to 25 gates, 1.5 to 3 km');
  });

  it('only circuits take laps', () => {
    expect(lapsApply('race')).toBe(true);
    for (const s of ['freestyle', 'mountain', 'sprint'] as const) {
      expect(lapsApply(s)).toBe(false);
      expect(effectiveLaps(s, 5)).toBe(1);
    }
    expect(effectiveLaps('race', 5)).toBe(5);
  });

  it('agree with what the generator really does', () => {
    const sampler = makeTestSampler({ seed: 3, resolution: 512, cellSize: 3 });
    for (const style of STYLES) {
      for (const asked of [4, 12, 40]) {
        const t = generateTrack({ seed: 2, style, gateCount: asked, laps: 4 }, sampler);
        const want = effectiveGates(style, asked);
        expect(t.gates.length, `${style} asked ${asked}`).toBeLessThanOrEqual(want);
        expect(t.gates.length, `${style} asked ${asked}`).toBeGreaterThanOrEqual(Math.max(4, want - 3));
        expect(t.laps === effectiveLaps(style, 4) || !t.closed, `${style} laps`).toBe(true);
      }
    }
  });
});
