import { describe, expect, it } from 'vitest';
import { toHalf } from '../../render/half';
import { countIsolatedBlack, countNonFiniteHalf, lineCentroid, linearLuma, meanLuminance } from './probes';

function image(width: number, height: number, fill: (x: number, y: number) => number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = fill(x, y);
      rgba.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return rgba;
}

describe('luminance', () => {
  it('decodes sRGB: white is 1, black 0, mid grey 188 is about 0.5', () => {
    expect(linearLuma(image(1, 1, () => 255), 0)).toBeCloseTo(1, 5);
    expect(linearLuma(image(1, 1, () => 0), 0)).toBe(0);
    expect(linearLuma(image(1, 1, () => 188), 0)).toBeCloseTo(0.5, 2);
  });

  it('averages over a region', () => {
    const img = image(4, 2, (x) => (x < 2 ? 255 : 0));
    expect(meanLuminance(img, 4, 2)).toBeCloseTo(0.5, 5);
    expect(meanLuminance(img, 4, 2, { x0: 0, y0: 0, x1: 2, y1: 2 })).toBeCloseTo(1, 5);
  });
});

describe('countIsolatedBlack', () => {
  it('counts a dead pixel inside a lit area but not a black region or border', () => {
    const lit = image(5, 5, (x, y) => (x === 2 && y === 2 ? 0 : 200));
    expect(countIsolatedBlack(lit, 5, 5)).toBe(1);
    expect(countIsolatedBlack(image(5, 5, () => 0), 5, 5)).toBe(0);
    expect(countIsolatedBlack(image(5, 5, (x) => (x < 2 ? 0 : 200)), 5, 5)).toBe(0);
  });
});

describe('lineCentroid', () => {
  it('reports a two pixel line covering columns 59 and 60 at 60', () => {
    const img = image(120, 8, (x) => (x === 59 || x === 60 ? 200 : 20));
    expect(lineCentroid(img, 120, 'x', 60, 8, [0, 8])).toBeCloseTo(60, 5);
  });

  it('sees a half pixel shift', () => {
    const img = image(120, 8, (x) => (x === 60 || x === 61 ? 200 : 20));
    expect(lineCentroid(img, 120, 'x', 60, 8, [0, 8])).toBeCloseTo(61, 5);
  });

  it('measures horizontal lines along the y axis and returns NaN on a flat image', () => {
    const img = image(8, 120, (_, y) => (y === 59 || y === 60 ? 200 : 20));
    expect(lineCentroid(img, 8, 'y', 60, 8, [0, 8])).toBeCloseTo(60, 5);
    expect(lineCentroid(image(120, 8, () => 50), 120, 'x', 60, 8, [0, 8])).toBeNaN();
  });
});

describe('countNonFiniteHalf', () => {
  it('flags Inf and NaN encodings only', () => {
    const data = new Uint16Array([toHalf(1), toHalf(60000), 0x7c00, 0xfc00, 0x7e00, toHalf(0)]);
    expect(countNonFiniteHalf(data)).toBe(3);
  });
});
