import { describe, expect, it } from 'vitest';
import { buildBarkNoise, buildBarkNoiseSliced } from './barkNoise';

describe('bark noise, built once', () => {
  it('hands every caller the same texels, byte for byte those of a fresh build', async () => {
    // The build takes no inputs (the slice budget only paces it), so one result serves every call.
    const first = buildBarkNoiseSliced(), again = buildBarkNoiseSliced(2);
    expect(again).toBe(first);
    const a = await first, b = buildBarkNoise();
    expect(a.length).toBe(b.length);
    expect(a.every((x, i) => x === b[i])).toBe(true);
  });
});
