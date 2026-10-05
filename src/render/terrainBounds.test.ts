import { describe, expect, it } from 'vitest';
import { buildMaxPyramid, buildTraceBoundsPyramid } from './terrainUpload';

describe('precomputed terrain trace bounds', () => {
  it.each([2, 8, 16])('matches the original four shader reads at every mip and edge for N=%i', n => {
    const height = Float32Array.from({ length: n * n }, (_, i) => Math.sin(i * 1.31) * 70 - 20);
    height[n * n - 1] = 130; // A high boundary vertex must survive every mip.
    const original = height.slice();
    const oldMips = buildMaxPyramid(height, n), bounds = buildTraceBoundsPyramid(height, n);
    expect(bounds.map(m => m.length)).toEqual(oldMips.map(m => m.length));
    for (let mip = 0; mip < bounds.length; mip++) {
      const size = Math.max(1, n >> mip);
      const oldLoad = (x: number, y: number) => oldMips[mip][Math.min(y, size - 1) * size + Math.min(x, size - 1)];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        // This is the previous shader's nodeMax contract, independent of upload layout.
        const expected = Math.max(oldLoad(x, y), oldLoad(x + 1, y), oldLoad(x, y + 1), oldLoad(x + 1, y + 1));
        expect(bounds[mip][y * size + x]).toBe(expected);
      }
    }
    expect(height).toEqual(original);
  });
});
