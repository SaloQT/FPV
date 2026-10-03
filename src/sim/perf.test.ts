import { describe, expect, it } from 'vitest';
import type { StickInput } from '../contracts';
import { QuadPhysics } from './quad';
import { QUAD_5IN_6S } from './presets';
import { DT, flatTerrain, inp } from './testkit';

interface NodeProcess {
  memoryUsage(): { heapUsed: number };
  getBuiltinModule?(id: string): unknown;
}

const proc = (globalThis as unknown as { process?: NodeProcess }).process;

function steps(q: QuadPhysics, input: StickInput, n: number): void {
  for (let i = 0; i < n; i++) q.step(DT, input);
}

/** Wall-clock milliseconds for one simulated second at 4 kHz, best of `trials` after a warm-up. */
function msPerSimSecond(make: () => QuadPhysics, input: StickInput, trials = 6): number {
  const q = make();
  steps(q, inp(), 1); // Arm below armThrottleMax before applying the benchmark throttle.
  expect(q.state.armed).toBe(true);
  steps(q, input, 8000);
  expect(q.state.motorOmega.some((omega) => omega > 100)).toBe(true);
  let best = Infinity;
  for (let t = 0; t < trials; t++) {
    const start = performance.now();
    steps(q, input, 4000);
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

const flying = (): QuadPhysics => {
  const q = new QuadPhysics(QUAD_5IN_6S);
  q.reset([0, 300, 0], 0);
  return q;
};

const cruise = inp({ throttle: 0.4, roll: 0.3, pitch: 0.2, yaw: 0.1 });

describe('performance', () => {
  it('simulates one second at 4 kHz in under 60 ms in a windy flight', () => {
    const ms = msPerSimSecond(flying, cruise);
    console.log(`[perf] flight: ${ms.toFixed(1)} ms per simulated second at 4 kHz (${((ms * 1000) / 4000).toFixed(2)} us per step)`);
    expect(ms).toBeLessThan(60);
  });

  it('stays under 60 ms with the quad skidding across the ground among obstacles', () => {
    const make = (): QuadPhysics => {
      const q = new QuadPhysics(QUAD_5IN_6S, flatTerrain(0));
      q.setColliders([
        { kind: 'box', center: [3, 0.5, -2], half: [1, 0.5, 1], yaw: 0.4 },
        { kind: 'box', center: [-3, 1, 4], half: [0.5, 1, 2], yaw: 1.2 },
      ]);
      q.reset([0, 0.06, 0], 0);
      return q;
    };
    const skid = inp({ throttle: 0.2, pitch: 0.5, roll: 0.3 });
    const ms = msPerSimSecond(make, skid);
    console.log(`[perf] ground contact: ${ms.toFixed(1)} ms per simulated second at 4 kHz`);
    expect(ms).toBeLessThan(60);
  });
});

describe('allocation', () => {
  const gc = ((): (() => void) | null => {
    const v8 = proc?.getBuiltinModule?.('node:v8') as { setFlagsFromString(f: string): void } | undefined;
    const vm = proc?.getBuiltinModule?.('node:vm') as { runInNewContext(code: string): unknown } | undefined;
    if (!v8 || !vm) return null;
    v8.setFlagsFromString('--expose-gc');
    const fn = vm.runInNewContext('gc');
    return typeof fn === 'function' ? (fn as () => void) : null;
  })();

  it.skipIf(gc === null || !proc)('steady-state stepping creates no objects or arrays (heap growth per step stays in the number-boxing range)', () => {
    const q = flying();
    steps(q, inp(), 1);
    expect(q.state.armed).toBe(true);
    const input = cruise;
    steps(q, input, 40000);
    gc!();
    const before = proc!.memoryUsage().heapUsed;
    steps(q, input, 2000);
    const perStep = (proc!.memoryUsage().heapUsed - before) / 2000;
    console.log(`[alloc] ${perStep.toFixed(0)} B per step`);
    // Under vitest's module transform V8 boxes doubles crossing calls (about 1.5 KB/step); a leaked object or array per step would add more.
    expect(perStep).toBeLessThan(3000);
  });
});
