import { describe, expect, it } from 'vitest';
import { Rng } from '../../world/track/rng';
import { newSample } from './treeLeafShapes';
import { conifer, sprayPainter } from './treeNeedleShapes';

const N = 128;

function rows(paint: (u: number, v: number, o: ReturnType<typeof newSample>) => boolean): { cover: number[]; width: number[]; samples: ReturnType<typeof newSample>[] } {
  const s = newSample(), cover: number[] = [], width: number[] = [], samples: ReturnType<typeof newSample>[] = [];
  for (let y = 0; y < N; y++) {
    let c = 0, lo = N, hi = -1;
    for (let x = 0; x < N; x++) {
      if (!paint((x + 0.5) / N, (y + 0.5) / N, s)) continue;
      c++; lo = Math.min(lo, x); hi = Math.max(hi, x);
      if ((x + y) % 7 === 0) samples.push({ ...s });
    }
    cover.push(c / N);
    width.push(hi >= lo ? (hi - lo) / N : 0);
  }
  return { cover, width, samples };
}

describe('sprayPainter', () => {
  const r = rows(sprayPainter(new Rng(4)));

  it('paints a fine fuzzy spray: a spray-shaped, partly covered tile with gaps between shoots', () => {
    const total = r.cover.reduce((a, b) => a + b, 0) / N;
    expect(total).toBeGreaterThan(0.12);
    expect(total).toBeLessThan(0.6);
    expect(Math.max(...r.cover)).toBeLessThan(0.9);
  });

  it('narrows toward the tip like a conifer branchlet', () => {
    const top = r.width.slice(10, 30).reduce((a, b) => a + b, 0), bottom = r.width.slice(80, 100).reduce((a, b) => a + b, 0);
    expect(bottom).toBeGreaterThan(top * 1.4);
  });

  it('stays inside the tile and keeps the sample fields in range, with paler new growth among the dark needles', () => {
    expect(r.cover[0]).toBe(0);
    expect(r.cover[N - 1]).toBe(0);
    for (const s of r.samples) {
      expect(s.shade).toBeGreaterThan(0);
      expect(s.shade).toBeLessThanOrEqual(1.2);
      expect(s.thin).toBeGreaterThanOrEqual(0);
      expect(s.thin).toBeLessThanOrEqual(1);
      expect(s.open).toBeGreaterThan(0);
      expect(s.open).toBeLessThanOrEqual(1);
    }
    expect(r.samples.some((s) => s.hue > 0.25)).toBe(true);
    expect(r.samples.filter((s) => s.hue < 0.1).length).toBeGreaterThan(r.samples.length * 0.5);
  });
});

describe('conifer silhouette', () => {
  const r = rows(conifer(23));

  it('widens from a point at the top to broad skirts at the bottom, above a narrow trunk', () => {
    expect(r.width[8]).toBeLessThan(0.15);
    expect(r.width[60]).toBeGreaterThan(r.width[30]);
    expect(r.width[100]).toBeGreaterThan(0.5);
    expect(r.width[N - 3]).toBeLessThan(0.1);
  });

  it('is darker toward the middle of each tier than at its rim', () => {
    const inner = r.samples.filter((s) => s.open < 0.45).length, rim = r.samples.filter((s) => s.open > 0.8).length;
    expect(inner).toBeGreaterThan(0);
    expect(rim).toBeGreaterThan(0);
  });

  it('has a ragged, tapering outline with no regular banding: the covered width changes gradually from row to row', () => {
    for (let y = 40; y < 108; y++) expect(Math.abs(r.width[y + 1] - r.width[y])).toBeLessThan(0.12);
    const widths = r.width.slice(30, 108);
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths) * 1.5);
    const ragged = r.cover.slice(50, 110).filter((c, i) => c < r.width[50 + i] * 0.92).length;
    expect(ragged).toBeGreaterThan(15);
  });

  it('is deterministic and puts pale new growth on the branch tips only', () => {
    const again = rows(conifer(23));
    expect(again.cover).toEqual(r.cover);
    const tips = r.samples.filter((s) => s.hue > 0.25), core = r.samples.filter((s) => s.hue < 0.1);
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.reduce((a, s) => a + s.open, 0) / tips.length).toBeGreaterThan(core.reduce((a, s) => a + s.open, 0) / core.length);
  });
});
