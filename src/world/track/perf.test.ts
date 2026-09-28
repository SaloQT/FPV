import { describe, expect, it } from 'vitest';
import { generateTrack } from './generator';
import type { TrackStyle } from './styles';
import { makeTestSampler } from './testTerrain';
import { validateTrack } from './validate';

const STYLES: TrackStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];
const BUDGET_MS = 300;

describe('performance on a 1024 x 1024 terrain', () => {
  const sampler = makeTestSampler({ seed: 11, resolution: 1024, cellSize: 3 });

  it('generates every style in under 300 ms per track', () => {
    generateTrack({ seed: 0, style: 'race' }, sampler);
    for (const style of STYLES) {
      for (let seed = 1; seed <= 6; seed++) {
        const t0 = performance.now();
        const track = generateTrack({ seed, style }, sampler);
        const ms = performance.now() - t0;
        expect(ms, `${style} seed ${seed}`).toBeLessThan(BUDGET_MS);
        expect(track.gates.length).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('keeps the generated tracks valid at that size', () => {
    for (const style of STYLES) {
      const track = generateTrack({ seed: 2, style }, sampler);
      expect(validateTrack(track, sampler).errors).toEqual([]);
    }
  });
});
