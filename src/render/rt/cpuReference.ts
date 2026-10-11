/**
 * CPU reference for the RT primitive intersections and BVH traversal (double precision). The shader in shaders/rt/rt_prims.wgsl and
 * rt_bvh.wgsl must agree with it; the dev page's `?test=1` mode compares the two on random rays, and bvh.test.ts uses it to check the
 * builder. Only entry hits count: a ray that starts inside a primitive does not hit it.
 */
import type { Vec3 } from '../../contracts';
import type { RTPrimitive } from '../contracts';
import { NODE_WORDS } from './bvh';
import { quatToMatrix } from './prims';

export const T_EPS = 1e-4;
export const TORUS_STEPS_REF = 512;
/** Must equal TORUS_STEPS in shaders/rt/rt_prims.wgsl. */
export const TORUS_STEPS_SHADER = 32;

const m = new Float64Array(9);

/** Distance along o + t*d (|d| = 1) of the nearest entry hit in (T_EPS, tMax], or Infinity. */
export function intersectPrim(p: RTPrimitive, o: readonly number[], d: readonly number[], tMax: number, torusSteps = TORUS_STEPS_REF): number {
  switch (p.type) {
    case 'sphere': return hitSphere(p.center, p.radius, o, d, tMax);
    case 'capsule': return hitCapsule(p.a, p.b, p.radius, o, d, tMax);
    case 'obb': return hitObb(p.center, p.half, p.rot, o, d, tMax);
    case 'cylinder':
    case 'ellipsoid': return hitRound(p, o, d, tMax);
    case 'cone': return hitCone(p, o, d, tMax);
    case 'gable': return hitGable(p, o, d, tMax);
    case 'torus': return hitTorus(p, o, d, tMax, torusSteps);
  }
}

function hitSphere(c: readonly number[], r: number, o: readonly number[], d: readonly number[], tMax: number): number {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const disc = b * b - (ox * ox + oy * oy + oz * oz - r * r);
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > T_EPS && t <= tMax ? t : Infinity;
}

function hitCapsule(a: readonly number[], b: readonly number[], r: number, o: readonly number[], d: readonly number[], tMax: number): number {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], ox = o[0] - a[0], oy = o[1] - a[1], oz = o[2] - a[2];
  const lengthSq = bx * bx + by * by + bz * bz;
  if (lengthSq < 1e-12) return hitSphere(a, r, o, d, tMax);
  const length = Math.sqrt(lengthSq), ax = bx / length, ay = by / length, az = bz / length;
  const axialOrigin = ox * ax + oy * ay + oz * az, axialDirection = d[0] * ax + d[1] * ay + d[2] * az;
  const insideT = Math.max(0, Math.min(length, axialOrigin)), ix = ox - ax * insideT, iy = oy - ay * insideT, iz = oz - az * insideT;
  if (ix * ix + iy * iy + iz * iz < r * r) return Infinity;
  const rx = ox - ax * axialOrigin, ry = oy - ay * axialOrigin, rz = oz - az * axialOrigin;
  const dx = d[0] - ax * axialDirection, dy = d[1] - ay * axialDirection, dz = d[2] - az * axialDirection, qa = dx * dx + dy * dy + dz * dz;
  if (qa > 0) {
    const closestT = -(rx * dx + ry * dy + rz * dz) / qa, cx = rx + closestT * dx, cy = ry + closestT * dy, cz = rz + closestT * dz;
    const discriminant = r * r - (cx * cx + cy * cy + cz * cz);
    if (discriminant < 0) return Infinity;
    const t = closestT - Math.sqrt(discriminant / qa), y = axialOrigin + t * axialDirection;
    if (y >= 0 && y <= length) return t > T_EPS && t <= tMax ? t : Infinity;
    return hitSphere(y < 0 ? a : b, r, o, d, tMax);
  }
  return Math.min(hitSphere(a, r, o, d, tMax), hitSphere(b, r, o, d, tMax));
}

function toLocal(c: readonly number[], v: readonly number[], out: number[], asDir: boolean): void {
  const x = asDir ? v[0] : v[0] - c[0], y = asDir ? v[1] : v[1] - c[1], z = asDir ? v[2] : v[2] - c[2];
  out[0] = m[0] * x + m[3] * y + m[6] * z;
  out[1] = m[1] * x + m[4] * y + m[7] * z;
  out[2] = m[2] * x + m[5] * y + m[8] * z;
}

const lo = [0, 0, 0], ld = [0, 0, 0];
const gablePlanes = [[0, -1, 0], [2, 1, 0], [-2, 1, 0], [0, 0, 1], [0, 0, -1]];
function hitGable(p: Extract<RTPrimitive, { half: Vec3 }>, o: readonly number[], d: readonly number[], tMax: number): number {
  quatToMatrix(p.rot, m); toLocal(p.center, o, lo, false); toLocal(p.center, d, ld, true);
  let enter = -Infinity, leave = Infinity;
  for (const n of gablePlanes) {
    let numerator = 1, denominator = 0;
    for (let k = 0; k < 3; k++) { numerator -= n[k] * lo[k] / p.half[k]; denominator += n[k] * ld[k] / p.half[k]; }
    if (Math.abs(denominator) < 1e-12) { if (numerator < 0) return Infinity; continue; }
    const at = numerator / denominator;
    if (denominator < 0) enter = Math.max(enter, at); else leave = Math.min(leave, at);
  }
  return enter <= leave && enter > T_EPS && enter <= tMax ? enter : Infinity;
}

/** Closed cone: local apex +half.y, base -half.y. Solve its implicit quadratic and bottom cap. */
function hitCone(p: Extract<RTPrimitive, { half: Vec3 }>, o: readonly number[], d: readonly number[], tMax: number): number {
  quatToMatrix(p.rot, m); toLocal(p.center, o, lo, false); toLocal(p.center, d, ld, true);
  const h = p.half, x = lo[0] / h[0], z = lo[2] / h[2], y = (h[1] - lo[1]) / (2 * h[1]);
  const dx = ld[0] / h[0], dz = ld[2] / h[2], dy = -ld[1] / (2 * h[1]);
  if (y > 0 && y < 1 && x * x + z * z < y * y) return Infinity;
  const a = dx * dx + dz * dz - dy * dy, b = x * dx + z * dz - y * dy, c = x * x + z * z - y * y;
  let best = Infinity;
  const accept = (t: number) => { const at = y + t * dy; if (t > T_EPS && t <= tMax && t < best && at >= 0 && at <= 1) best = t; };
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) accept(-c / (2 * b)); }
  else {
    const disc = b * b - a * c;
    if (disc >= 0) { const q = -b - (b < 0 ? -1 : 1) * Math.sqrt(disc); accept(q / a); if (Math.abs(q) > 1e-20) accept(c / q); }
  }
  if (Math.abs(dy) > 1e-12) { const t = (1 - y) / dy; if ((x + t * dx) ** 2 + (z + t * dz) ** 2 <= 1) accept(t); }
  return best;
}

function hitRound(p: Extract<RTPrimitive, { half: Vec3 }>, o: readonly number[], d: readonly number[], tMax: number): number {
  quatToMatrix(p.rot, m); toLocal(p.center, o, lo, false); toLocal(p.center, d, ld, true);
  const h = p.half, axes = p.type === 'cylinder' ? [0, 2] : [0, 1, 2];
  let a = 0, b = 0, c = -1;
  for (const k of axes) { a += (ld[k] / h[k]) ** 2; b += lo[k] * ld[k] / h[k] ** 2; c += (lo[k] / h[k]) ** 2; }
  if (c < 0 && (p.type === 'ellipsoid' || Math.abs(lo[1]) < h[1])) return Infinity;
  let best = Infinity, disc = b * b - a * c;
  if (a > 1e-14 && disc >= 0) { const t = (-b - Math.sqrt(disc)) / a; if (t > T_EPS && t <= tMax && (p.type === 'ellipsoid' || Math.abs(lo[1] + t * ld[1]) <= h[1])) best = t; }
  if (p.type === 'cylinder' && Math.abs(ld[1]) > 1e-12) for (const side of [-1, 1]) {
    const t = (side * h[1] - lo[1]) / ld[1]; if (t > T_EPS && t <= tMax && t < best && ((lo[0] + t * ld[0]) / h[0]) ** 2 + ((lo[2] + t * ld[2]) / h[2]) ** 2 <= 1) best = t;
  }
  return best;
}

function hitObb(c: readonly number[], half: readonly number[], q: readonly number[], o: readonly number[], d: readonly number[], tMax: number): number {
  quatToMatrix(q, m);
  toLocal(c, o, lo, false);
  toLocal(c, d, ld, true);
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(ld[k]) < 1e-12) {
      if (Math.abs(lo[k]) > half[k]) return Infinity;
      continue;
    }
    const inv = 1 / ld[k];
    const a = (-half[k] - lo[k]) * inv, b = (half[k] - lo[k]) * inv;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 && t0 > T_EPS && t0 <= tMax ? t0 : Infinity;
}

function torusSdf(x: number, y: number, z: number, major: number, minor: number): number {
  const qx = Math.hypot(x, z) - major;
  return Math.hypot(qx, y) - minor;
}

function hitTorus(p: Extract<RTPrimitive, { type: 'torus' }>, o: readonly number[], d: readonly number[], tMax: number, steps: number): number {
  quatToMatrix(p.rot, m);
  toLocal(p.center, o, lo, false);
  toLocal(p.center, d, ld, true);
  const R = p.major + p.minor;
  const b = lo[0] * ld[0] + lo[1] * ld[1] + lo[2] * ld[2];
  const disc = b * b - (lo[0] * lo[0] + lo[1] * lo[1] + lo[2] * lo[2] - R * R);
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  let t = Math.max(-b - sq, T_EPS);
  const tEnd = Math.min(-b + sq, tMax);
  if (torusSdf(lo[0] + ld[0] * t, lo[1] + ld[1] * t, lo[2] + ld[2] * t, p.major, p.minor) < 0) return Infinity;
  for (let i = 0; i < steps; i++) {
    const s = torusSdf(lo[0] + ld[0] * t, lo[1] + ld[1] * t, lo[2] + ld[2] * t, p.major, p.minor);
    if (s < 1e-4 + 1e-5 * t) return t;
    t += s;
    if (t > tEnd) return Infinity;
  }
  return Infinity;
}

export interface CpuHit { t: number; index: number }

export function bruteForce(prims: readonly RTPrimitive[], o: readonly number[], d: readonly number[], tMax: number, torusSteps = TORUS_STEPS_REF): CpuHit {
  let best = { t: Infinity, index: -1 };
  for (let i = 0; i < prims.length; i++) {
    const t = intersectPrim(prims[i], o, d, Math.min(tMax, best.t), torusSteps);
    if (t < best.t) best = { t, index: i };
  }
  return best;
}

function hitBox(f: Float32Array, w: number, o: readonly number[], d: readonly number[], tMax: number): boolean {
  let t0 = 0, t1 = tMax;
  for (let k = 0; k < 3; k++) {
    const inv = 1 / d[k];
    const a = (f[w + k] - o[k]) * inv, b = (f[w + 4 + k] - o[k]) * inv;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1;
}

/** Walks packed nodes from `root` like the shader does; `order` maps a packed primitive slot back to `prims`. */
export function traverseBvh(
  nodesF: Float32Array, nodesU: Uint32Array, root: number, prims: readonly RTPrimitive[], order: ArrayLike<number>, primBase: number,
  o: readonly number[], d: readonly number[], tMax: number,
): CpuHit {
  const best = { t: tMax, index: -1 };
  const stack: number[] = [root];
  while (stack.length) {
    const n = stack.pop() as number;
    const w = n * NODE_WORDS;
    if (!hitBox(nodesF, w, o, d, best.t)) continue;
    const count = nodesU[w + 7];
    if (count === 0) {
      stack.push(nodesU[w + 3] + 1, nodesU[w + 3]);
      continue;
    }
    for (let i = 0; i < count; i++) {
      const slot = nodesU[w + 3] + i;
      const idx = order[slot - primBase];
      const t = intersectPrim(prims[idx], o, d, best.t);
      if (t < best.t) { best.t = t; best.index = idx; }
    }
  }
  return best.index < 0 ? { t: Infinity, index: -1 } : best;
}

export function randomUnit(rand: () => number, out: Vec3 = [0, 0, 0]): Vec3 {
  const z = 2 * rand() - 1, a = 2 * Math.PI * rand(), r = Math.sqrt(1 - z * z);
  out[0] = r * Math.cos(a); out[1] = z; out[2] = r * Math.sin(a);
  return out;
}
