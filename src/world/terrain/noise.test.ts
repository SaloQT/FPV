import { describe, expect, it } from 'vitest';
import { Noise2D, Rng, clamp01, hashFloats, hashString, mix, smoothstep } from './noise';

const SLOW = 60000;

describe('Rng', () => {
  it('repeats exactly for the same seed and stream', () => {
    const a = new Rng(1234, 3);
    const b = new Rng(1234, 3);
    for (let k = 0; k < 1000; k++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('gives different sequences for different seeds and different streams', () => {
    const first = (seed: number, stream: number): number[] => {
      const r = new Rng(seed, stream);
      return Array.from({ length: 8 }, () => r.nextU32());
    };
    expect(first(1, 0)).not.toEqual(first(2, 0));
    expect(first(1, 0)).not.toEqual(first(1, 1));
  });

  it('stays in [0, 1) with a near-uniform distribution', () => {
    const r = new Rng(99);
    const bins = new Array<number>(10).fill(0);
    const count = 50000;
    let sum = 0;
    for (let k = 0; k < count; k++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      bins[Math.floor(v * 10)]++;
    }
    expect(sum / count).toBeCloseTo(0.5, 1);
    for (const b of bins) expect(Math.abs(b / count - 0.1)).toBeLessThan(0.01);
  }, SLOW);

  it('range maps into [a, b)', () => {
    const r = new Rng(7);
    for (let k = 0; k < 500; k++) {
      const v = r.range(-3, 5);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(5);
    }
  });

  it('accepts seeds beyond 32 bits and does not collapse them onto their low word', () => {
    const big = new Rng(2 ** 40 + 5);
    const low = new Rng(5);
    expect(big.nextU32()).not.toBe(low.nextU32());
  });
});

describe('Noise2D', () => {
  it('is deterministic per seed and differs between seeds and streams', () => {
    const a = new Noise2D(5);
    const b = new Noise2D(5);
    const c = new Noise2D(6);
    const d = new Noise2D(5, 1);
    let differsSeed = false;
    let differsStream = false;
    for (let k = 0; k < 200; k++) {
      const x = k * 0.37 + 0.1;
      const y = k * 0.11 - 3;
      expect(a.simplex(x, y)).toBe(b.simplex(x, y));
      if (a.simplex(x, y) !== c.simplex(x, y)) differsSeed = true;
      if (a.simplex(x, y) !== d.simplex(x, y)) differsStream = true;
    }
    expect(differsSeed).toBe(true);
    expect(differsStream).toBe(true);
  });

  it('stays within about [-1, 1], has a mean near zero and uses the whole range', () => {
    const n = new Noise2D(42);
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    let count = 0;
    for (let j = 0; j < 200; j++) {
      for (let i = 0; i < 200; i++) {
        const v = n.simplex(i * 0.13, j * 0.13);
        expect(Number.isFinite(v)).toBe(true);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        sum += v;
        count++;
      }
    }
    expect(lo).toBeGreaterThan(-1.1);
    expect(hi).toBeLessThan(1.1);
    expect(lo).toBeLessThan(-0.6);
    expect(hi).toBeGreaterThan(0.6);
    expect(Math.abs(sum / count)).toBeLessThan(0.05);
  });

  it('is continuous: tiny steps change the value tiny amounts', () => {
    const n = new Noise2D(8);
    for (let k = 0; k < 300; k++) {
      const x = k * 0.173;
      const y = k * 0.291 - 20;
      expect(Math.abs(n.simplex(x + 1e-4, y) - n.simplex(x, y))).toBeLessThan(1e-3);
      expect(Math.abs(n.simplex(x, y + 1e-4) - n.simplex(x, y))).toBeLessThan(1e-3);
    }
  });

  it('is zero at the lattice origin and varies at unit scale (correlation length about one)', () => {
    const n = new Noise2D(3);
    expect(n.simplex(0, 0)).toBe(0);
    let far = 0;
    for (let k = 0; k < 200; k++) far += Math.abs(n.simplex(k * 0.5 + 0.3, 0.7) - n.simplex(k * 0.5 + 3.3, 0.7));
    expect(far / 200).toBeGreaterThan(0.1);
  });
});

describe('helpers', () => {
  it('hashFloats is stable, sensitive to a one-bit change, and order dependent', () => {
    const a = Float32Array.of(1, 2, 3, 4);
    expect(hashFloats(a)).toBe(hashFloats(Float32Array.of(1, 2, 3, 4)));
    expect(hashFloats(a)).not.toBe(hashFloats(Float32Array.of(1, 2, 3, 4.0000005)));
    expect(hashFloats(a)).not.toBe(hashFloats(Float32Array.of(2, 1, 3, 4)));
    expect(hashFloats(a.subarray(1))).toBe(hashFloats(Float32Array.of(2, 3, 4)));
  });

  it('hashString separates nearby names', () => {
    expect(hashString('warp')).toBe(hashString('warp'));
    expect(hashString('warp')).not.toBe(hashString('warq'));
  });

  it('clamp01, mix and smoothstep behave', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
    expect(mix(2, 4, 0.25)).toBe(2.5);
    expect(smoothstep(0, 1, -5)).toBe(0);
    expect(smoothstep(0, 1, 5)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(2, 4, 3)).toBe(0.5);
  });
});
