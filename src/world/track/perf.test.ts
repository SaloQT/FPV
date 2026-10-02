import { describe, expect, it } from 'vitest';
import { generateTrack } from './generator';
import type { TrackStyle } from './styles';
import { makeTestSampler } from './testTerrain';
import { validateTrack } from './validate';

const STYLES: TrackStyle[] = ['race', 'freestyle', 'mountain', 'sprint'];
/** Process CPU time, not wall clock: a test run in parallel with other CPU-bound jobs waits for a core without using one. */
const BUDGET_CPU_MS = 500;
const REPEATS = 3;

interface CpuTimes { user: number; system: number }
const nodeProcess = (globalThis as unknown as { process: { cpuUsage(previous?: CpuTimes): CpuTimes } }).process;

function cpuMs(fn: () => void): number {
  const before = nodeProcess.cpuUsage();
  fn();
  const d = nodeProcess.cpuUsage(before);
  return (d.user + d.system) / 1000;
}

describe('performance on a 1024 x 1024 terrain', () => {
  const sampler = makeTestSampler({ seed: 11, resolution: 1024, cellSize: 3 });

  it('generates every style in under 500 ms of CPU time per track (best of three, so a busy machine does not fail it)', () => {
    generateTrack({ seed: 0, style: 'race' }, sampler);
    for (const style of STYLES) {
      for (let seed = 1; seed <= 6; seed++) {
        let best = Infinity;
        let gates = 0;
        for (let r = 0; r < REPEATS; r++) {
          best = Math.min(best, cpuMs(() => { gates = generateTrack({ seed, style }, sampler).gates.length; }));
          if (best < BUDGET_CPU_MS / 4) break;
        }
        expect(best, `${style} seed ${seed}`).toBeLessThan(BUDGET_CPU_MS);
        expect(gates).toBeGreaterThanOrEqual(6);
      }
    }
  }, 120_000);

  it('keeps the generated tracks valid at that size', () => {
    for (const style of STYLES) {
      const track = generateTrack({ seed: 2, style }, sampler);
      expect(validateTrack(track, sampler).errors).toEqual([]);
    }
  });
});
