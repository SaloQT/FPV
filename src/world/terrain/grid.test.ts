import { describe, expect, it } from 'vitest';
import { boxBlur, minMax, quantile, relaxBorder, upsample2x } from './grid';

function ramp(n: number, f: (i: number, j: number) => number): Float32Array {
  const a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = f(i, j);
  return a;
}

describe('upsample2x', () => {
  it('doubles the size and keeps every original vertex at twice its index', () => {
    const n = 8;
    const src = ramp(n, (i, j) => Math.sin(i * 1.3) * 5 + j * j);
    const out = upsample2x(src, n);
    expect(out).toHaveLength(4 * n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) expect(out[2 * j * 2 * n + 2 * i]).toBe(src[j * n + i]);
  });

  it('keeps a constant field constant and reproduces a plane away from the clamped edges', () => {
    const n = 12;
    const flat = upsample2x(new Float32Array(n * n).fill(7), n);
    for (const v of flat) expect(v).toBeCloseTo(7, 5);
    const out = upsample2x(ramp(n, (i, j) => 3 * i - 2 * j), n);
    for (let j = 2; j < 2 * n - 4; j++) for (let i = 2; i < 2 * n - 4; i++) expect(out[j * 2 * n + i]).toBeCloseTo(3 * (i / 2) - 2 * (j / 2), 4);
  });

  it('is smooth across new vertices: a bump keeps its peak between the original samples', () => {
    const n = 16;
    const out = upsample2x(ramp(n, (i, j) => Math.exp(-((i - 7.5) ** 2 + (j - 7.5) ** 2) / 8)), n);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, v);
    expect(peak).toBeGreaterThan(0.99);
    expect(peak).toBeLessThan(1.02);
  });
});

describe('boxBlur', () => {
  it('keeps a constant field constant, including at the clamped edges', () => {
    const n = 16;
    const a = new Float32Array(n * n).fill(3);
    boxBlur(a, n, 3, new Float32Array(n * n));
    for (const v of a) expect(v).toBeCloseTo(3, 5);
  });

  it('spreads an impulse into a (2r+1)^2 square of equal weight and does nothing below radius 1', () => {
    const n = 15;
    const a = new Float32Array(n * n);
    a[7 * n + 7] = 49;
    boxBlur(a, n, 0, new Float32Array(n * n));
    expect(a[7 * n + 7]).toBe(49);
    boxBlur(a, n, 3, new Float32Array(n * n));
    expect(a[7 * n + 7]).toBeCloseTo(1, 5);
    expect(a[4 * n + 4]).toBeCloseTo(1, 5);
    expect(a[3 * n + 3]).toBeCloseTo(0, 5);
  });
});

describe('relaxBorder', () => {
  it('copies every edge vertex from its inner neighbour, corners from the diagonal, and leaves the inside alone', () => {
    const n = 8;
    const a = ramp(n, (i, j) => 10 * j + i + 100 * ((i * 7 + j * 13) % 5));
    const before = Float32Array.from(a);
    relaxBorder(a, n);
    for (let k = 1; k < n - 1; k++) {
      expect(a[k]).toBe(before[n + k]);
      expect(a[(n - 1) * n + k]).toBe(before[(n - 2) * n + k]);
      expect(a[k * n]).toBe(before[k * n + 1]);
      expect(a[k * n + n - 1]).toBe(before[k * n + n - 2]);
    }
    expect(a[0]).toBe(before[n + 1]);
    expect(a[n - 1]).toBe(before[n + n - 2]);
    expect(a[(n - 1) * n]).toBe(before[(n - 2) * n + 1]);
    expect(a[n * n - 1]).toBe(before[(n - 2) * n + n - 2]);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) expect(a[j * n + i]).toBe(before[j * n + i]);
  });

  it('flattens a spike on the rim without touching the ground inside', () => {
    const n = 6;
    const a = new Float32Array(n * n);
    a[3] = 500;
    a[2 * n] = -500;
    relaxBorder(a, n);
    expect(a[3]).toBe(0);
    expect(a[2 * n]).toBe(0);
  });
});

describe('quantile and minMax', () => {
  it('finds the quantiles of a ramp to within a histogram bin and returns the value of a flat field', () => {
    const a = new Float32Array(10000);
    for (let k = 0; k < a.length; k++) a[k] = k / (a.length - 1);
    expect(quantile(a, 0.5)).toBeCloseTo(0.5, 2);
    expect(quantile(a, 0.9)).toBeCloseTo(0.9, 2);
    expect(quantile(new Float32Array(50).fill(4), 0.3)).toBe(4);
  });

  it('reports the extremes', () => {
    expect(minMax(Float32Array.from([3, -2, 9, 0.5]))).toEqual([-2, 9]);
  });
});
