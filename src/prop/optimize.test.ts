import { describe, expect, it } from 'vitest';
import { DEFAULT_PROP } from './design';
import { expectedImprovement, GaussianProcess, measure, runSearch, violation } from './optimize';

describe('gaussian process', () => {
  it('interpolates its training points and is unsure far from them', () => {
    const xs = [[0.1], [0.4], [0.7], [0.95]];
    const ys = xs.map(([x]) => Math.sin(6 * x));
    const gp = new GaussianProcess();
    gp.fit(xs, ys);
    for (let i = 0; i < xs.length; i++) expect(gp.predict(xs[i]).mean).toBeCloseTo(ys[i], 1);
    expect(gp.predict([0.25]).sd).toBeGreaterThan(gp.predict([0.4]).sd);
  });

  it('expected improvement is higher where the mean is lower or the spread larger', () => {
    expect(expectedImprovement(0, 1, 1)).toBeGreaterThan(expectedImprovement(2, 1, 1));
    expect(expectedImprovement(1, 2, 1)).toBeGreaterThan(expectedImprovement(1, 0.5, 1));
  });
});

describe('prop search', () => {
  it('the stock prop is legal', () => {
    expect(violation(measure(DEFAULT_PROP))).toBe(0);
  });

  it('is repeatable, never worse than the stock prop and respects the limits', () => {
    const a = runSearch({ seed: 3, budget: 30, initial: 14, screened: 300 });
    const b = runSearch({ seed: 3, budget: 30, initial: 14, screened: 300 });
    expect(a.evaluated.length).toBe(30);
    expect(a.best.cost).toBe(b.best.cost);
    expect(a.best.cost).toBeLessThanOrEqual(0);
    expect(violation(a.best.metrics)).toBe(0);
  }, 60000);
});
