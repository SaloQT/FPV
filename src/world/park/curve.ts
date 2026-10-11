import type { Vec3 } from '../../contracts';
import { add, clamp, cross, distance, dot, mul, sub, unit, wrap, smooth } from './math';
import type { CoasterCurve } from './types';
export const CURVE_STRIDE = 14;
export interface RailSample { pos: Vec3; tangent: Vec3; up: Vec3; curvature: Vec3; bank: number }
export function railSample(): RailSample { return { pos: [0, 0, 0], tangent: [1, 0, 0], up: [0, 1, 0], curvature: [0, 0, 0], bank: 0 }; }

/** Periodic cardinal quintic B-spline. Simple knots give C4 continuity, including jerk at element joins. */
function point(points: Vec3[], i: number, t: number, derivative = 0): Vec3 {
  const out: Vec3 = [0, 0, 0];
  const binomial = [1, -6, 15, -20, 15, -6, 1];
  for (let j = 0; j < 6; j++) {
    const x = t + 5 - j;
    let weight = 0;
    for (let k = 0; k <= 6; k++) if (x > k) weight += binomial[k] * (x - k) ** (5 - derivative);
    weight /= derivative === 0 ? 120 : derivative === 1 ? 24 : 6;
    const p = points[wrap(i + j - 2, points.length)];
    for (let k = 0; k < 3; k++) out[k] += p[k] * weight;
  }
  return out;
}

/** Dense arc table built once. Frames parallel-transport through verticals/inversions without Frenet singularities. */
export function compileCurve(points: Vec3[], stationIndex: number, liftIndex: number, brakeIndex: number, nominalSpeed: number): CoasterCurve {
  const p: Vec3[] = [], derivative: Vec3[] = [], second: Vec3[] = [], marker: number[] = [];
  for (let i = 0; i < points.length; i++) {
    marker[i] = p.length;
    const steps = Math.max(8, Math.ceil(distance(points[i], points[(i + 1) % points.length]) * 2));
    for (let j = 0; j < steps; j++) { p.push(point(points, i, j / steps)); derivative.push(point(points, i, j / steps, 1)); second.push(point(points, i, j / steps, 2)); }
  }
  const n = p.length, data = new Float64Array((n + 1) * CURVE_STRIDE);
  const tangents = derivative.map(d => unit(d));
  let up: Vec3 = [0, 1, 0], s = 0;
  for (let i = 0; i <= n; i++) {
    const j = i % n, t = tangents[j];
    if (i > 0) s += distance(p[j], p[(i - 1) % n]);
    // Projection transport is stable at the sub-metre sampling used here.
    up = unit(sub(up, mul(t, dot(up, t))));
    if (Math.hypot(...up) < 0.5) up = unit(cross(t, [0, 0, 1]));
    const curvature = mul(sub(second[j], mul(t, dot(second[j], t))), 1 / Math.max(dot(derivative[j], derivative[j]), 1e-9));
    const right = unit(cross(t, up));
    // Banking follows centripetal demand; suppress it on inversion elements.
    const desired = clamp(Math.atan2(nominalSpeed * nominalSpeed * dot(curvature, right), 9.80665), -1.05, 1.05);
    const stationBank = smooth(clamp((i - marker[stationIndex]) / (marker[stationIndex + 1] - marker[stationIndex]), 0, 1))
      * (1 - smooth(clamp((i - marker[brakeIndex]) / (n - marker[brakeIndex]), 0, 1)));
    const bank = desired * stationBank * smooth(clamp((up[1] - 0.4) / 0.4, 0, 1)) * (1 - smooth(clamp((Math.abs(t[1]) - 0.25) / 0.4, 0, 1)));
    const u = add(mul(up, Math.cos(bank)), mul(right, Math.sin(bank)));
    const o = i * CURVE_STRIDE;
    data.set([...p[j], ...t, ...u, ...curvature, bank, s], o);
  }
  // Close frame holonomy outside the station. A level loading straight must not inherit a
  // distributed roll correction; the quintic ramp has zero first/second derivatives at both ends.
  const firstUp: Vec3 = [data[6], data[7], data[8]], lastUp: Vec3 = [data[n * CURVE_STRIDE + 6], data[n * CURVE_STRIDE + 7], data[n * CURVE_STRIDE + 8]];
  const firstT = tangents[0];
  const residual = Math.atan2(dot(cross(lastUp, firstUp), firstT), dot(lastUp, firstUp));
  const stationOffset = marker[stationIndex] * CURVE_STRIDE, stationEnd = data[stationOffset + 13];
  const stationT: Vec3 = [data[stationOffset + 3], data[stationOffset + 4], data[stationOffset + 5]];
  const stationUp: Vec3 = [data[stationOffset + 6], data[stationOffset + 7], data[stationOffset + 8]];
  const levelUp = unit(sub([0, 1, 0], mul(stationT, stationT[1])));
  // The transport frame's roll datum belongs to the loading track, not the arbitrary periodic spline seam.
  const stationRoll = Math.atan2(dot(cross(stationUp, levelUp), stationT), dot(stationUp, levelUp));
  for (let i = 0; i <= n; i++) {
    const o = i * CURVE_STRIDE, f = clamp((data[o + 13] - stationEnd) / (s - stationEnd), 0, 1);
    const a = stationRoll + residual * f * f * f * (10 + f * (-15 + 6 * f));
    const t: Vec3 = [data[o + 3], data[o + 4], data[o + 5]], u: Vec3 = [data[o + 6], data[o + 7], data[o + 8]], r = cross(t, u);
    const corrected = add(mul(u, Math.cos(a)), mul(r, Math.sin(a)));
    data.set(corrected, o + 6);
  }
  return { samples: data, count: n + 1, length: s, stationEnd: data[marker[stationIndex] * CURVE_STRIDE + 13], liftEnd: data[marker[liftIndex] * CURVE_STRIDE + 13], brakeStart: data[marker[brakeIndex] * CURVE_STRIDE + 13] };
}

export function sampleRail(curve: CoasterCurve, at: number, out: RailSample): RailSample {
  const s = wrap(at, curve.length), a = curve.samples;
  let lo = 0, hi = curve.count - 1;
  while (hi - lo > 1) { const m = (lo + hi) >>> 1; if (a[m * CURVE_STRIDE + 13] <= s) lo = m; else hi = m; }
  const o = lo * CURVE_STRIDE, e = hi * CURVE_STRIDE, f = (s - a[o + 13]) / Math.max(1e-9, a[e + 13] - a[o + 13]);
  for (let k = 0; k < 3; k++) {
    out.pos[k] = a[o + k] + f * (a[e + k] - a[o + k]);
    out.tangent[k] = a[o + 3 + k] + f * (a[e + 3 + k] - a[o + 3 + k]);
    out.up[k] = a[o + 6 + k] + f * (a[e + 6 + k] - a[o + 6 + k]);
    out.curvature[k] = a[o + 9 + k] + f * (a[e + 9 + k] - a[o + 9 + k]);
  }
  let n = Math.hypot(...out.tangent); for (let k = 0; k < 3; k++) out.tangent[k] /= n || 1;
  const d = dot(out.up, out.tangent); for (let k = 0; k < 3; k++) out.up[k] -= d * out.tangent[k];
  n = Math.hypot(...out.up); for (let k = 0; k < 3; k++) out.up[k] /= n || 1;
  out.bank = a[o + 12] + f * (a[e + 12] - a[o + 12]);
  return out;
}
