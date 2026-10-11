import type { Quat, Vec3 } from '../../contracts';
import { partDistance } from './collision';
import type { BodyPose, ParkPart, PartShape } from './types';

/** A part's convex solid in world space. Every park primitive is convex: box, capped cylinder,
 * capped cone, ellipsoid and triangular prism. Tests below are exact for that solid, not for a
 * bounding volume: GJK decides overlap, the signed distance gives intrusion depth and containment. */
export interface Solid {
  shape: PartShape;
  /** Index into ParkData.parts, or -1 for synthetic solids such as a truncated member. */
  part: number;
  c: Vec3;
  /** World-space unit local axes; column k of the part's rotation. */
  ax: [Vec3, Vec3, Vec3];
  h: Vec3;
}

function rotateQ(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q, [a, b, c] = v;
  const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx];
}
function qmulQ(a: Quat, b: Quat): Quat {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** World transform of a part: body pose (if attached) composed with the part's own frame. */
export function partFrame(part: ParkPart, body?: BodyPose): { pos: Vec3; rot: Quat } {
  if (part.body < 0 || !body) return { pos: [...part.pos], rot: [...part.rot] };
  const p = rotateQ(body.rot, part.pos);
  return { pos: [p[0] + body.pos[0], p[1] + body.pos[1], p[2] + body.pos[2]], rot: qmulQ(body.rot, part.rot) };
}
export function solidOf(part: ParkPart, index: number, body?: BodyPose): Solid {
  const { pos, rot } = partFrame(part, body);
  return { shape: part.shape, part: index, c: pos, ax: [rotateQ(rot, [1, 0, 0]), rotateQ(rot, [0, 1, 0]), rotateQ(rot, [0, 0, 1])], h: [...part.half] };
}
export function toLocal(s: Solid, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]];
  return [dot(d, s.ax[0]), dot(d, s.ax[1]), dot(d, s.ax[2])];
}
export function toWorld(s: Solid, l: Vec3): Vec3 {
  return [s.c[0] + s.ax[0][0] * l[0] + s.ax[1][0] * l[1] + s.ax[2][0] * l[2], s.c[1] + s.ax[0][1] * l[0] + s.ax[1][1] * l[1] + s.ax[2][1] * l[2], s.c[2] + s.ax[0][2] * l[0] + s.ax[1][2] * l[1] + s.ax[2][2] * l[2]];
}
const scratchPart = { shape: 'box', half: [1, 1, 1] } as unknown as ParkPart;
const scratchNormal: Vec3 = [0, 0, 0], scratchLocalNormal: Vec3 = [0, 0, 0];
/** Exact signed Euclidean distance to the solid (negative inside); the same function collision uses. */
export function signedDistance(s: Solid, p: Vec3, normal: Vec3 = scratchNormal): number {
  scratchPart.shape = s.shape; scratchPart.half = s.h;
  const local = toLocal(s, p), n = scratchLocalNormal, d = partDistance(scratchPart, local, n), a = s.ax;
  normal[0] = a[0][0] * n[0] + a[1][0] * n[1] + a[2][0] * n[2]; normal[1] = a[0][1] * n[0] + a[1][1] * n[1] + a[2][1] * n[2]; normal[2] = a[0][2] * n[0] + a[1][2] * n[1] + a[2][2] * n[2];
  return d;
}

/** Support point: the point of the solid furthest along d. */
export function support(s: Solid, d: Vec3): Vec3 {
  const l: Vec3 = [dot(d, s.ax[0]), dot(d, s.ax[1]), dot(d, s.ax[2])], h = s.h, p: Vec3 = [0, 0, 0];
  switch (s.shape) {
    case 'box': p[0] = l[0] < 0 ? -h[0] : h[0]; p[1] = l[1] < 0 ? -h[1] : h[1]; p[2] = l[2] < 0 ? -h[2] : h[2]; break;
    case 'cylinder': { const r = Math.hypot(l[0], l[2]); p[1] = l[1] < 0 ? -h[1] : h[1]; if (r > 1e-300) { p[0] = h[0] * l[0] / r; p[2] = h[0] * l[2] / r; } break; }
    case 'cone': { const r = Math.hypot(l[0], l[2]), rim = r > 1e-300 ? h[0] * r - h[1] * l[1] : -h[1] * l[1];
      if (h[1] * l[1] >= rim) p[1] = h[1]; else { p[1] = -h[1]; if (r > 1e-300) { p[0] = h[0] * l[0] / r; p[2] = h[0] * l[2] / r; } } break; }
    case 'sphere': { const sx = h[0] * l[0], sy = h[1] * l[1], sz = h[2] * l[2], n = Math.hypot(sx, sy, sz); if (n > 1e-300) { p[0] = h[0] * sx / n; p[1] = h[1] * sy / n; p[2] = h[2] * sz / n; } else p[1] = h[1]; break; }
    case 'gable': { p[2] = l[2] < 0 ? -h[2] : h[2]; const apex = h[1] * l[1], left = -h[0] * l[0] - h[1] * l[1], right = h[0] * l[0] - h[1] * l[1];
      if (apex >= left && apex >= right) p[1] = h[1]; else { p[1] = -h[1]; p[0] = right >= left ? h[0] : -h[0]; } break; }
  }
  return toWorld(s, p);
}
/** Exact world AABB from the support function along the coordinate axes. */
export function solidBounds(s: Solid, out = new Float64Array(6), offset = 0): Float64Array {
  for (let k = 0; k < 3; k++) {
    const d: Vec3 = [0, 0, 0]; d[k] = 1; out[offset + 3 + k] = support(s, d)[k]; d[k] = -1; out[offset + k] = support(s, d)[k];
  }
  return out;
}

// ---- GJK: exact convex overlap and separation distance ----
type V = Vec3;
const sub3 = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Closest point to the origin on a simplex; reduces the simplex to the supporting feature. */
function closestOnSimplex(simplex: V[]): V {
  const n = simplex.length;
  if (n === 1) return simplex[0];
  if (n === 2) {
    const [a, b] = simplex, ab = sub3(b, a), t = -dot(a, ab) / (dot(ab, ab) || 1e-300);
    if (t <= 0) { simplex.length = 1; return a; }
    if (t >= 1) { simplex[0] = b; simplex.length = 1; return b; }
    return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  }
  if (n === 3) {
    const [a, b, c] = simplex, ab = sub3(b, a), ac = sub3(c, a), ap: V = [-a[0], -a[1], -a[2]];
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) { simplex.length = 1; return a; }
    const bp: V = [-b[0], -b[1], -b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) { simplex[0] = b; simplex.length = 1; return b; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); simplex.length = 2; return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
    const cp: V = [-c[0], -c[1], -c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) { simplex[0] = c; simplex.length = 1; return c; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); simplex[1] = c; simplex.length = 2; return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); simplex[0] = b; simplex[1] = c; simplex.length = 2; return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; }
    const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
    return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  }
  // Tetrahedron: origin inside, or closest on one of the faces outside which it lies.
  const [a, b, c, d] = simplex;
  const faces: [V, V, V, V][] = [[a, b, c, d], [a, c, d, b], [a, d, b, c], [b, d, c, a]];
  let best: V | null = null, bestDistance = Infinity, bestSet: V[] = [];
  for (const [p, q, r, opposite] of faces) {
    const normal = cross3(sub3(q, p), sub3(r, p)), side = dot(normal, p), other = dot(normal, sub3(opposite, p));
    // The origin lies outside this face when it is on the opposite side from the fourth vertex.
    if (side * other > 0 || (other === 0 && side !== 0)) {
      const set = [p, q, r], point = closestOnSimplex(set), dist = dot(point, point);
      if (dist < bestDistance) { bestDistance = dist; best = point; bestSet = set; }
    }
  }
  if (!best) return [0, 0, 0];
  simplex.length = 0; simplex.push(...bestSet); return best;
}
export interface GjkResult { intersect: boolean; distance: number; /** Closest points when separated. */ pa?: Vec3; pb?: Vec3 }
/** Exact up to `tolerance` metres: overlap, or the separation distance between two convex solids. */
export function gjk(A: Solid, B: Solid, tolerance = 1e-7): GjkResult {
  let v: V = sub3(A.c, B.c); if (dot(v, v) < 1e-24) v = [1, 0, 0];
  const simplex: V[] = [], pointsA = new Map<V, [V, V]>();
  for (let iteration = 0; iteration < 128; iteration++) {
    const negative: V = [-v[0], -v[1], -v[2]], a = support(A, negative), b = support(B, v), w = sub3(a, b);
    const vv = dot(v, v);
    if (vv - dot(v, w) <= tolerance * Math.sqrt(vv) || simplex.some(s => s[0] === w[0] && s[1] === w[1] && s[2] === w[2])) {
      const distance = Math.sqrt(vv); if (distance <= tolerance) return { intersect: true, distance: 0 };
      return { intersect: false, distance, ...closestPoints(simplex, v, pointsA) };
    }
    pointsA.set(w, [a, b]); simplex.push(w);
    v = closestOnSimplex(simplex);
    if (simplex.length === 4 || dot(v, v) <= tolerance * tolerance) return { intersect: true, distance: 0 };
  }
  return { intersect: false, distance: Math.sqrt(dot(v, v)) };
}
function closestPoints(simplex: V[], v: V, map: Map<V, [V, V]>): { pa?: Vec3; pb?: Vec3 } {
  // Barycentric weights of v over the final simplex reconstruct the witness points.
  const n = simplex.length; if (!n) return {};
  let weights: number[];
  if (n === 1) weights = [1];
  else if (n === 2) { const ab = sub3(simplex[1], simplex[0]), t = Math.min(1, Math.max(0, dot(sub3(v, simplex[0]), ab) / (dot(ab, ab) || 1e-300))); weights = [1 - t, t]; }
  else {
    const [a, b, c] = simplex, v0 = sub3(b, a), v1 = sub3(c, a), v2 = sub3(v, a), d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01 || 1e-300;
    const y = (d11 * d20 - d01 * d21) / den, z = (d00 * d21 - d01 * d20) / den; weights = [1 - y - z, y, z];
  }
  const pa: Vec3 = [0, 0, 0], pb: Vec3 = [0, 0, 0];
  simplex.forEach((s, i) => { const pair = map.get(s); if (!pair) return; for (let k = 0; k < 3; k++) { pa[k] += pair[0][k] * weights[i]; pb[k] += pair[1][k] * weights[i]; } });
  return { pa, pb };
}

/** Deepest intrusion of B into A: max over p in B of -signedDistance(A, p), a concave maximisation
 * over a convex set. Frank-Wolfe with its duality gap returns a certified interval [lower, upper]. */
export function intrusion(A: Solid, B: Solid, iterations = 96, enough = Infinity): { lower: number; upper: number; point: Vec3 } {
  // Start at B's point closest to A's centre (its support toward A), then move toward the deepest point.
  // Centre-to-centre is a better start when B's centre is already inside A.
  let p: Vec3 = signedDistance(A, B.c) < 0 ? [...B.c] : support(B, sub3(A.c, B.c)), best = { lower: -Infinity, upper: Infinity, point: p };
  const normal: Vec3 = [0, 0, 0];
  for (let k = 0; k < iterations; k++) {
    const f = -signedDistance(A, p, normal), g: Vec3 = [-normal[0], -normal[1], -normal[2]], s = support(B, g), gap = dot(g, sub3(s, p));
    if (f > best.lower) best = { lower: f, upper: Math.min(best.upper, f + Math.max(0, gap)), point: [...p] }; else best.upper = Math.min(best.upper, f + Math.max(0, gap));
    // `enough` stops once the witness depth exceeds what the caller needs to decide.
    if (gap <= 1e-7 || best.lower > enough) break;
    // Line search on the concave 1D restriction by golden section.
    let lo = 0, hi = 1; const at = (t: number): number => -signedDistance(A, [p[0] + (s[0] - p[0]) * t, p[1] + (s[1] - p[1]) * t, p[2] + (s[2] - p[2]) * t]);
    for (let i = 0; i < 20; i++) { const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618; if (at(m1) < at(m2)) lo = m1; else hi = m2; }
    const t = (lo + hi) / 2; p = [p[0] + (s[0] - p[0]) * t, p[1] + (s[1] - p[1]) * t, p[2] + (s[2] - p[2]) * t];
  }
  const f = -signedDistance(A, p); if (f > best.lower) best = { ...best, lower: f, point: p };
  best.upper = Math.max(best.upper, best.lower);
  return best;
}

/** Maximum of a 1-Lipschitz field over a closed planar circle, certified by branch and bound:
 * the field changes by at most radius*dθ between parameters, so each interval is bounded above. */
export function maxOnCircle(field: (p: Vec3) => number, center: Vec3, u: Vec3, w: Vec3, radius: number, tolerance = 2e-4): { max: number; upper: number; at: Vec3; min: number } {
  const point = (t: number): Vec3 => [center[0] + radius * (Math.cos(t) * u[0] + Math.sin(t) * w[0]), center[1] + radius * (Math.cos(t) * u[1] + Math.sin(t) * w[1]), center[2] + radius * (Math.cos(t) * u[2] + Math.sin(t) * w[2])];
  const count = 32, step = 2 * Math.PI / count;
  let best = -Infinity, at: Vec3 = center, min = Infinity;
  type Interval = { t: number; half: number; value: number };
  const queue: Interval[] = [];
  for (let i = 0; i < count; i++) { const t = (i + 0.5) * step, p = point(t), value = field(p); queue.push({ t, half: step / 2, value }); if (value > best) { best = value; at = p; } min = Math.min(min, value); }
  let upper = -Infinity;
  for (let guard = 0; queue.length && guard < 20000; guard++) {
    const item = queue.pop()!, bound = item.value + radius * item.half;
    if (bound <= best + tolerance) { upper = Math.max(upper, bound); continue; }
    for (const side of [-0.5, 0.5]) { const t = item.t + side * item.half, p = point(t), value = field(p); queue.push({ t, half: item.half / 2, value }); if (value > best) { best = value; at = p; } min = Math.min(min, value); }
  }
  for (const item of queue) upper = Math.max(upper, item.value + radius * item.half);
  return { max: best, upper: Math.max(upper, best), at, min };
}

/** End caps of a capped cylinder (axis = local y), as world circles. */
export function cylinderCaps(s: Solid): { center: Vec3; normal: Vec3; u: Vec3; w: Vec3; radius: number; end: -1 | 1 }[] {
  return ([-1, 1] as const).map(end => ({ center: toWorld(s, [0, end * s.h[1], 0]), normal: end > 0 ? s.ax[1] : [-s.ax[1][0], -s.ax[1][1], -s.ax[1][2]] as Vec3, u: s.ax[0], w: s.ax[2], radius: s.h[0], end }));
}
/** The member with `depth` metres removed from one end (axis = local y for cylinders/cones, any axis for boxes). */
export function truncate(s: Solid, axis: 0 | 1 | 2, end: -1 | 1, depth: number): Solid | null {
  const length = 2 * s.h[axis] - depth; if (length <= 1e-9) return null;
  const h: Vec3 = [...s.h]; h[axis] = length / 2;
  const shift = -end * depth / 2, c: Vec3 = [s.c[0] + s.ax[axis][0] * shift, s.c[1] + s.ax[axis][1] * shift, s.c[2] + s.ax[axis][2] * shift];
  return { ...s, part: -1, c, h };
}
/** Exact vertices of polyhedral solids; curved solids return their rim circles separately. */
export function solidVertices(s: Solid): Vec3[] {
  const h = s.h;
  if (s.shape === 'box') { const out: Vec3[] = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(toWorld(s, [x * h[0], y * h[1], z * h[2]])); return out; }
  if (s.shape === 'gable') { const out: Vec3[] = []; for (const z of [-1, 1]) for (const [x, y] of [[-1, -1], [1, -1], [0, 1]]) out.push(toWorld(s, [x * h[0], y * h[1], z * h[2]])); return out; }
  if (s.shape === 'cone') return [toWorld(s, [0, h[1], 0])];
  return [];
}
/** Max of A's signed distance over B: B is inside A when this is <= 0. Convexity places the maximum
 * of a convex field at B's extreme points: polytope vertices, or the rims of cylinders and cones. */
export function containment(A: Solid, B: Solid, field?: (p: Vec3) => number): { max: number; upper: number; at: Vec3 } {
  const f = field ?? ((p: Vec3) => signedDistance(A, p));
  let max = -Infinity, upper = -Infinity, at: Vec3 = B.c;
  for (const v of solidVertices(B)) { const d = f(v); if (d > max) { max = d; at = v; } upper = Math.max(upper, d); }
  if (B.shape === 'cylinder' || B.shape === 'cone') {
    const rims = B.shape === 'cylinder' ? cylinderCaps(B) : [{ center: toWorld(B, [0, -B.h[1], 0]), u: B.ax[0], w: B.ax[2], radius: B.h[0] }];
    for (const rim of rims) { const r = maxOnCircle(f, rim.center, rim.u, rim.w, rim.radius); if (r.max > max) { max = r.max; at = r.at; } upper = Math.max(upper, r.upper); }
  }
  if (B.shape === 'sphere') {
    // Ellipsoid surface: latitude circles bound the field with the meridian arc length between them.
    const rows = 48, maxH = Math.max(...B.h);
    for (let i = 0; i <= rows; i++) {
      const phi = -Math.PI / 2 + Math.PI * i / rows, cy = Math.sin(phi) * B.h[1], cr = Math.cos(phi);
      // Each latitude ring is an ellipse; sample densely and bound by the local arc length.
      const n = 96;
      for (let j = 0; j < n; j++) { const t = 2 * Math.PI * j / n, p = toWorld(B, [Math.cos(t) * cr * B.h[0], cy, Math.sin(t) * cr * B.h[2]]), d = f(p); if (d > max) { max = d; at = p; } }
      upper = Math.max(upper, max + maxH * Math.PI / Math.min(rows, n));
    }
  }
  return { max, upper: Math.max(upper, max), at };
}
