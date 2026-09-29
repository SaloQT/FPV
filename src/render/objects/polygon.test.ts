import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonArea, triangulate, type Pt } from './polygon';

const circle = (cx: number, cy: number, r: number, n: number, cw = false): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = ((cw ? -i : i) / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
  });

const star = (n: number, r0: number, r1: number): Pt[] =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? r1 : r0;
    return [r * Math.cos(a), r * Math.sin(a)] as Pt;
  });

function check(outline: Pt[], holes: Pt[][]): void {
  const t = triangulate(outline, holes);
  let area = 0;
  for (let i = 0; i < t.triangles.length; i += 3) {
    const a = t.points[t.triangles[i]], b = t.points[t.triangles[i + 1]], c = t.points[t.triangles[i + 2]];
    const ta = polygonArea([a, b, c]);
    expect(ta).toBeGreaterThan(0);
    area += ta;
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
    expect(pointInPolygon(cx, cy, outline)).toBe(true);
    for (const h of holes) expect(pointInPolygon(cx, cy, h)).toBe(false);
  }
  const expected = Math.abs(polygonArea(outline)) - holes.reduce((s, h) => s + Math.abs(polygonArea(h)), 0);
  expect(area).toBeCloseTo(expected, 9);
}

describe('triangulate', () => {
  it('fills a square exactly', () => {
    check([[0, 0], [1, 0], [1, 1], [0, 1]], []);
  });

  it('accepts clockwise input', () => {
    check([[0, 0], [0, 1], [1, 1], [1, 0]], []);
  });

  it('fills a concave L shape', () => {
    check([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], []);
  });

  it('fills a star', () => {
    check(star(7, 0.4, 1), []);
  });

  it('leaves one hole open', () => {
    check([[0, 0], [4, 0], [4, 4], [0, 4]], [[[1, 1], [1, 3], [3, 3], [3, 1]]]);
  });

  it('handles several holes of mixed shape', () => {
    check(circle(0, 0, 5, 48), [circle(-2, 0, 0.8, 12), circle(2, 1, 0.9, 16, true), star(5, 0.3, 0.7).map(([x, y]) => [x + 0.5, y - 2.5] as Pt)]);
  });

  it('handles a plate outline with many slots', () => {
    const outline = star(4, 1.6, 4);
    const holes = [0, 1, 2, 3].map((k) => circle(1.4 * Math.cos((k * Math.PI) / 2), 1.4 * Math.sin((k * Math.PI) / 2), 0.35, 10));
    check(outline, [...holes, circle(0, 0, 0.5, 14)]);
  });
});
