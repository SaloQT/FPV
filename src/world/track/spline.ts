/**
 * Centripetal Catmull-Rom splines (C1, no cusps or self-loops within a segment) and arc-length resampling.
 * A spline goes through every control point; the path is then resampled at a fixed spacing (1 m by default).
 */
import type { Vec3 } from '../../contracts';

export interface SplinePath {
  /** Arc-length resampled centreline. Closed paths do not repeat the first point at the end. */
  points: Vec3[];
  /** Actual spacing between consecutive points (equals the requested spacing for open paths). */
  spacing: number;
  /** Arc length of every control point along the path, metres from points[0]. */
  knotS: number[];
  /** Total length in metres (includes the closing edge for a closed path). */
  length: number;
  closed: boolean;
}

const ALPHA = 0.5;

function knotStep(a: Vec3, b: Vec3): number {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return Math.max(Math.pow(d, ALPHA), 1e-3);
}

function lerp3(a: Vec3, b: Vec3, wa: number, wb: number, out: Vec3): Vec3 {
  out[0] = a[0] * wa + b[0] * wb;
  out[1] = a[1] * wa + b[1] * wb;
  out[2] = a[2] * wa + b[2] * wb;
  return out;
}

const A1: Vec3 = [0, 0, 0];
const A2: Vec3 = [0, 0, 0];
const A3: Vec3 = [0, 0, 0];
const B1: Vec3 = [0, 0, 0];
const B2: Vec3 = [0, 0, 0];

/** Barry-Goldman pyramid on the P1->P2 segment for knots (0, t1, t2, t3) at fraction u in [0, 1]. */
function evalSegment(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t1: number, t2: number, t3: number, u: number, out: Vec3): Vec3 {
  const t = t1 + (t2 - t1) * u;
  lerp3(p0, p1, (t1 - t) / t1, t / t1, A1);
  lerp3(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1), A2);
  lerp3(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2), A3);
  lerp3(A1, A2, (t2 - t) / t2, t / t2, B1);
  lerp3(A2, A3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1), B2);
  return lerp3(B1, B2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1), out);
}

/** Point on the P1->P2 segment (centripetal Catmull-Rom) at fraction u in [0, 1]. */
export function catmullRomPoint(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const t1 = knotStep(p0, p1);
  const t2 = t1 + knotStep(p1, p2);
  return evalSegment(p0, p1, p2, p3, t1, t2, t2 + knotStep(p2, p3), u, out);
}

/** Control point with wrap-around (closed) or mirrored phantom ends (open). */
function ctrlAt(ctrl: Vec3[], i: number, closed: boolean): Vec3 {
  const n = ctrl.length;
  if (closed) return ctrl[((i % n) + n) % n];
  if (i < 0) {
    const a = ctrl[0];
    const b = ctrl[1];
    return [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
  }
  if (i >= n) {
    const a = ctrl[n - 1];
    const b = ctrl[n - 2];
    return [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
  }
  return ctrl[i];
}

/**
 * Dense polyline through the control points plus the polyline index of each control point.
 * `step` is the approximate chord length used to subdivide each segment.
 */
export function sampleSplineDense(ctrl: Vec3[], closed: boolean, step: number): { pts: Vec3[]; knotIdx: number[] } {
  const n = ctrl.length;
  const segs = closed ? n : n - 1;
  const pts: Vec3[] = [];
  const knotIdx: number[] = [];
  for (let s = 0; s < segs; s++) {
    const p0 = ctrlAt(ctrl, s - 1, closed);
    const p1 = ctrl[s];
    const p2 = ctrlAt(ctrl, s + 1, closed);
    const p3 = ctrlAt(ctrl, s + 2, closed);
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const sub = Math.max(4, Math.ceil((chord * 1.15) / step));
    knotIdx.push(pts.length);
    const t1 = knotStep(p0, p1);
    const t2 = t1 + knotStep(p1, p2);
    const t3 = t2 + knotStep(p2, p3);
    for (let k = 0; k < sub; k++) pts.push(evalSegment(p0, p1, p2, p3, t1, t2, t3, k / sub, [0, 0, 0]));
  }
  if (closed) knotIdx.push(pts.length);
  else {
    knotIdx.push(pts.length);
    pts.push([ctrl[n - 1][0], ctrl[n - 1][1], ctrl[n - 1][2]]);
  }
  return { pts, knotIdx };
}

/** Builds the resampled path for control points `ctrl` (needs >= 3 for closed, >= 2 for open); `denseStep` is the polyline step it resamples from. */
export function buildSpline(ctrl: Vec3[], closed: boolean, spacing = 1, denseStep = 0.5): SplinePath {
  const { pts, knotIdx } = sampleSplineDense(ctrl, closed, denseStep);
  const m = pts.length;
  const total = closed ? m : m - 1;
  const cum = new Float64Array(total + 1);
  for (let i = 0; i < total; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % m];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const length = cum[total];
  const count = closed ? Math.max(3, Math.round(length / spacing)) : Math.max(2, Math.floor(length / spacing) + 1);
  const step = closed ? length / count : spacing;
  const points: Vec3[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = k * step;
    while (seg < total - 1 && cum[seg + 1] < s) seg++;
    const a = pts[seg];
    const b = pts[(seg + 1) % m];
    const span = cum[seg + 1] - cum[seg];
    const f = span > 1e-9 ? (s - cum[seg]) / span : 0;
    points.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  if (!closed && length - (count - 1) * spacing > 0.5) {
    const e = pts[m - 1];
    points.push([e[0], e[1], e[2]]);
  }
  const knotS = knotIdx.slice(0, ctrl.length).map((idx) => cum[Math.min(idx, total)]);
  return { points, spacing: step, knotS, length, closed };
}

/** Unit tangent of the polyline at sample `i` (central difference, wraps when closed). */
export function pathTangent(path: Vec3[], i: number, closed: boolean, out: Vec3 = [0, 0, 0]): Vec3 {
  const n = path.length;
  const a = closed ? path[(i - 1 + n) % n] : path[Math.max(i - 1, 0)];
  const b = closed ? path[(i + 1) % n] : path[Math.min(i + 1, n - 1)];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  out[0] = dx / l;
  out[1] = dy / l;
  out[2] = dz / l;
  return out;
}

/** Position on the path at arc length `s` from points[0] (clamped when open, wrapped when closed). */
export function pathPointAtS(sp: SplinePath, s: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const n = sp.points.length;
  let u = s / sp.spacing;
  if (sp.closed) u = ((u % n) + n) % n;
  else u = Math.min(Math.max(u, 0), n - 1);
  const i = Math.min(Math.floor(u), sp.closed ? n - 1 : n - 2);
  const f = u - i;
  const a = sp.points[i];
  const b = sp.points[(i + 1) % n];
  out[0] = a[0] + (b[0] - a[0]) * f;
  out[1] = a[1] + (b[1] - a[1]) * f;
  out[2] = a[2] + (b[2] - a[2]) * f;
  return out;
}

/**
 * Curvature (1/m) at every sample from the circumscribed circle through the points `stride` samples either side
 * (Menger curvature). A stride of 2 filters out resampling jitter while still resolving 3 m radius turns at 1 m spacing.
 */
export function pathCurvature(path: Vec3[], closed: boolean, stride = 2, planar = false): Float32Array {
  const n = path.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let ia = i - stride;
    let ic = i + stride;
    if (closed) {
      ia = ((ia % n) + n) % n;
      ic = ((ic % n) + n) % n;
    } else if (ia < 0 || ic >= n) continue;
    out[i] = menger(path[ia], path[i], path[ic], planar);
  }
  return out;
}

function menger(a: Vec3, b: Vec3, c: Vec3, planar: boolean): number {
  const ay = planar ? 0 : a[1];
  const by = planar ? 0 : b[1];
  const cy = planar ? 0 : c[1];
  const abx = b[0] - a[0];
  const aby = by - ay;
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = cy - ay;
  const acz = c[2] - a[2];
  const bcx = c[0] - b[0];
  const bcy = cy - by;
  const bcz = c[2] - b[2];
  const cx = aby * acz - abz * acy;
  const cyv = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  const area2 = Math.hypot(cx, cyv, cz);
  const d = Math.hypot(abx, aby, abz) * Math.hypot(acx, acy, acz) * Math.hypot(bcx, bcy, bcz);
  return d > 1e-12 ? (2 * area2) / d : 0;
}

/** Heading (yaw, see contracts COORDINATES: 0 faces -Z, positive turns toward -X) of horizontal direction (dx, dz). */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  const t = a % (2 * Math.PI);
  return t > Math.PI ? t - 2 * Math.PI : t <= -Math.PI ? t + 2 * Math.PI : t;
}
