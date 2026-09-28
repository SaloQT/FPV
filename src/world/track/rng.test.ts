import { describe, expect, it } from 'vitest';
import { Rng, deriveSeed } from './rng';

describe('Rng', () => {
  it('repeats exactly for a seed and differs between seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const xs = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(xs);
  });

  it('stays in range: next in [0, 1), int inclusive, range within bounds', () => {
    const r = new Rng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const u = r.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      const n = r.int(3, 6);
      seen.add(n);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
      const v = r.range(-2, 5);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(5);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('is roughly uniform and gauss is roughly centred with unit spread', () => {
    const r = new Rng(7);
    let sum = 0;
    let g = 0;
    let g2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      sum += r.next();
      const x = r.gauss();
      g += x;
      g2 += x * x;
    }
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
    expect(Math.abs(g / n)).toBeLessThan(0.05);
    expect(Math.sqrt(g2 / n)).toBeGreaterThan(0.9);
    expect(Math.sqrt(g2 / n)).toBeLessThan(1.1);
  });

  it('deriveSeed is stable, salt-sensitive and 32-bit', () => {
    expect(deriveSeed(5, 1, 2)).toBe(deriveSeed(5, 1, 2));
    expect(deriveSeed(5, 1, 2)).not.toBe(deriveSeed(5, 2, 1));
    expect(deriveSeed(5, 1)).not.toBe(deriveSeed(6, 1));
    const s = deriveSeed(123456789, 99);
    expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
  });
});
