import { describe, expect, it } from 'vitest';
import { WaterMask } from './waterMask';
// Frozen 562768c implementation, intentionally retaining its original scan.
import { WaterMask as Baseline } from './waterMask.baseline.fixture';

describe('WaterMask exact prefix differential', () => {
  it('preserves degenerate heights, exact thresholds and nonfinite metadata', () => {
    for (const value of [NaN, Infinity, -Infinity, -0, 0, 1, Math.fround(1 / 3)]) {
      for (const n of [0, 1, 9, 17]) {
        const height = new Float32Array(n * n).fill(value);
        for (const water of [NaN, Infinity, -Infinity, value, value + Number.EPSILON, -0, 0]) {
          for (const limits of [[NaN, NaN], [-Infinity, Infinity], [0, 100]]) {
            const args = [height, n, 1, [0, 0] as const, limits[0], limits[1], water] as const;
            const old = new Baseline(...args), next = new WaterMask(...args);
            expect(next.enabled).toBe(old.enabled);
            for (const q of [[0, 0, 0, 0], [-100, -100, 100, 100], [7, 7, 8, 8], [20, 20, 10, 10]]) {
              expect(next.regionBelow(q[0], q[1], q[2], q[3])).toBe(old.regionBelow(q[0], q[1], q[2], q[3]));
            }
          }
        }
      }
    }
  });

  it('matches the frozen scan across heights, water levels, folds and inclusive borders', () => {
    let seed = 0x192783;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
    const special = [NaN, Infinity, -Infinity, -0, 0, 1, -1];
    let comparisons = 0;
    for (const n of [1, 2, 7, 8, 9, 15, 16, 17, 33, 64, 129]) {
      for (let landscape = 0; landscape < 4; landscape++) {
        const heights = Float32Array.from({ length: n * n }, () => landscape === 0 ? 20 : landscape === 1 ? (random() < .1 ? special[Math.floor(random() * special.length)] : 20) : random() * 40 - 20);
        heights[heights.length - 1] = -2;
        for (const level of [-Infinity, Infinity, NaN, -20, -2, -0, 0, 1e-50, 1, 10, 30]) {
          for (const max of [2, 100]) {
            const args = [heights, n, 1.25, [-13, 17] as const, -2, max, level] as const;
            const old = new Baseline(...args), next = new WaterMask(...args);
            expect(next.enabled).toBe(old.enabled);
            const check = (x0: number, z0: number, x1: number, z1: number) => {
              const q = [x0 * 1.25 - 13, z0 * 1.25 + 17, x1 * 1.25 - 13, z1 * 1.25 + 17] as const;
              expect(next.regionBelow(...q)).toBe(old.regionBelow(...q));
              comparisons++;
            };
            for (const x of [-2 * n, -n, -8, -1, -0, 0, 7, 8, n - 1, n, 2 * n]) {
              check(x, x, x, x);
              check(x - .001, x - .001, x + .001, x + .001);
              check(x, 0, x + n, n - 1);
              check(x + 2, x + 2, x, x); // reversed intervals
            }
            check(-n * 10, -n * 10, n * 10, n * 10);
            check(NaN, 0, NaN, 1);
            check(0, NaN, 1, NaN);
            check(0, 0, Infinity, Infinity); // full-period fast path
            check(Infinity, Infinity, 0, 0); // empty interval
            check(-Infinity, -Infinity, Infinity, Infinity); // full period
            for (let j = 0; j < 50; j++) {
              const x = (random() - .5) * n * 10, z = (random() - .5) * n * 10;
              check(x, z, x + random() * n * 3, z + random() * n * 3);
            }
          }
        }
      }
    }
    expect(comparisons).toBeGreaterThan(90000);
  });
});
