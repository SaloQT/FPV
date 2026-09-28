import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../contracts';
import { Rng } from './rng';
import { buildSpline, catmullRomPoint, pathCurvature, pathPointAtS, pathTangent, sampleSplineDense, wrapAngle, yawOf } from './spline';

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function circle(r: number, n: number, y = 5): Vec3[] {
  return Array.from({ length: n }, (_, k) => [r * Math.cos((2 * Math.PI * k) / n), y, r * Math.sin((2 * Math.PI * k) / n)] as Vec3);
}

/** Wiggly open control polygon with 20-40 m legs, like gate positions. */
function wiggle(seed: number, n: number): Vec3[] {
  const rng = new Rng(seed);
  const pts: Vec3[] = [[0, 10, 0]];
  let h = rng.range(0, 6);
  for (let i = 1; i < n; i++) {
    h += rng.range(-0.7, 0.7);
    const l = rng.range(20, 40);
    const p = pts[i - 1];
    pts.push([p[0] + Math.cos(h) * l, p[1] + rng.range(-4, 4), p[2] + Math.sin(h) * l]);
  }
  return pts;
}

describe('centripetal Catmull-Rom', () => {
  it('interpolates the control points and returns the endpoints exactly', () => {
    const ctrl = wiggle(1, 9);
    const p = catmullRomPoint(ctrl[0], ctrl[1], ctrl[2], ctrl[3], 0);
    const q = catmullRomPoint(ctrl[0], ctrl[1], ctrl[2], ctrl[3], 1);
    expect(dist(p, ctrl[1])).toBeLessThan(1e-9);
    expect(dist(q, ctrl[2])).toBeLessThan(1e-9);
  });

  it('is C1 through every control point (open and closed)', () => {
    for (const closed of [false, true]) {
      for (let seed = 1; seed <= 12; seed++) {
        const ctrl = closed ? circle(60, 9).map((p, i) => [p[0] * (1 + 0.15 * Math.sin(i * seed)), p[1] + i, p[2]] as Vec3) : wiggle(seed, 9);
        const { pts, knotIdx } = sampleSplineDense(ctrl, closed, 0.05);
        for (let k = 1; k < ctrl.length - (closed ? 0 : 1); k++) {
          const i = knotIdx[k];
          const a = pts[i - 1];
          const b = pts[i];
          const c = pts[i + 1];
          const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const v: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
          const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
          expect(Math.acos(Math.min(cos, 1))).toBeLessThan(0.05);
        }
      }
    }
  });

  it('has no jumps: consecutive dense samples stay within one step', () => {
    const ctrl = wiggle(4, 12);
    const { pts } = sampleSplineDense(ctrl, false, 0.5);
    for (let i = 1; i < pts.length; i++) expect(dist(pts[i], pts[i - 1])).toBeLessThan(0.51);
  });
});

describe('arc-length resampling', () => {
  it('spaces an open path 1 m apart, ending on the last control point', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const ctrl = wiggle(seed, 8);
      const sp = buildSpline(ctrl, false);
      const pts = sp.points;
      for (let i = 1; i < pts.length - 1; i++) expect(dist(pts[i], pts[i - 1])).toBeGreaterThan(0.97);
      for (let i = 1; i < pts.length - 1; i++) expect(dist(pts[i], pts[i - 1])).toBeLessThan(1.01);
      expect(dist(pts[0], ctrl[0])).toBeLessThan(1e-9);
      expect(dist(pts[pts.length - 1], ctrl[ctrl.length - 1])).toBeLessThan(1.001);
      expect(sp.length).toBeGreaterThan(pts.length - 2);
    }
  });

  it('closes a loop with equal spacing and no repeated point', () => {
    const sp = buildSpline(circle(80, 12), true);
    const n = sp.points.length;
    expect(sp.spacing).toBeGreaterThan(0.98);
    expect(sp.spacing).toBeLessThan(1.02);
    for (let i = 0; i < n; i++) expect(dist(sp.points[i], sp.points[(i + 1) % n])).toBeCloseTo(sp.spacing, 2);
    expect(dist(sp.points[0], sp.points[n - 1])).toBeGreaterThan(0.9);
  });

  it('passes through the control points at the recorded arc lengths', () => {
    const ctrl = wiggle(7, 8);
    const sp = buildSpline(ctrl, false);
    const out: Vec3 = [0, 0, 0];
    ctrl.forEach((c, k) => expect(dist(pathPointAtS(sp, sp.knotS[k], out), c)).toBeLessThan(k === ctrl.length - 1 ? 0.5 : 0.05));
  });

  it('reproduces a circle: radius, curvature and tangent', () => {
    const r = 70;
    const sp = buildSpline(circle(r, 16), true);
    const kappa = pathCurvature(sp.points, true, 2);
    const t: Vec3 = [0, 0, 0];
    for (let i = 0; i < sp.points.length; i += 7) {
      const p = sp.points[i];
      expect(Math.abs(Math.hypot(p[0], p[2]) - r)).toBeLessThan(0.6);
      expect(kappa[i]).toBeGreaterThan(0.8 / r);
      expect(kappa[i]).toBeLessThan(1.2 / r);
      pathTangent(sp.points, i, true, t);
      expect(Math.hypot(...t)).toBeCloseTo(1, 6);
      expect(Math.abs(t[0] * p[0] + t[2] * p[2]) / r).toBeLessThan(0.05);
    }
  });

  it('has zero curvature on a straight line', () => {
    const line: Vec3[] = Array.from({ length: 30 }, (_, i) => [i, 3, 0]);
    for (const k of pathCurvature(line, false, 2)) expect(k).toBeLessThan(1e-6);
  });
});

describe('angles', () => {
  it('yawOf follows the world convention (0 = -Z, positive toward -X)', () => {
    expect(yawOf(0, -1)).toBeCloseTo(0, 9);
    expect(yawOf(-1, 0)).toBeCloseTo(Math.PI / 2, 9);
    expect(yawOf(1, 0)).toBeCloseTo(-Math.PI / 2, 9);
    expect(Math.abs(yawOf(0, 1))).toBeCloseTo(Math.PI, 9);
  });

  it('wrapAngle lands in (-PI, PI]', () => {
    for (const a of [-7, -3.2, 0, 3.2, 7, 100]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI - 1e-12);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
    }
  });
});
