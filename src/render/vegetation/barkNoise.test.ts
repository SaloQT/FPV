import { describe, expect, it } from 'vitest';
import { BARK_NOISE_SIZE, buildBarkNoise } from './barkNoise';

describe('baked bark noise', () => {
  const n = BARK_NOISE_SIZE, data = buildBarkNoise();
  const at = (x: number, y: number, z: number, c: number): number => data[(((z % n) * n + (y % n)) * n + (x % n)) * 4 + c];

  it('fills a cube of four channels with a mid-grey mean and a full spread', () => {
    expect(data.length).toBe(n * n * n * 4);
    for (let c = 0; c < 3; c++) {
      let sum = 0, lo = 255, hi = 0;
      for (let i = c; i < data.length; i += 4 * 7) { sum += data[i]; lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
      expect(sum / Math.ceil(data.length / 28)).toBeGreaterThan(110);
      expect(sum / Math.ceil(data.length / 28)).toBeLessThan(145);
      expect(hi - lo).toBeGreaterThan(180);
    }
  });

  it('wraps seamlessly: a step across the texture edge is no bigger than a step inside it', () => {
    for (let c = 0; c < 4; c++) {
      let inside = 0, edge = 0;
      for (let y = 0; y < n; y += 5) for (let z = 0; z < n; z += 5) {
        inside = Math.max(inside, Math.abs(at(n / 2, y, z, c) - at(n / 2 - 1, y, z, c)), Math.abs(at(y, n / 2, z, c) - at(y, n / 2 - 1, z, c)));
        edge = Math.max(edge, Math.abs(at(0, y, z, c) - at(n - 1, y, z, c)), Math.abs(at(y, 0, z, c) - at(y, n - 1, z, c)), Math.abs(at(y, z, 0, c) - at(y, z, n - 1, c)));
      }
      expect(edge).toBeLessThanOrEqual(inside * 1.5 + 2);
    }
  });
});
