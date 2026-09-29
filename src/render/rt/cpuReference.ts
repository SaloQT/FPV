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
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const oax = o[0] - a[0], oay = o[1] - a[1], oaz = o[2] - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * d[0] + bay * d[1] + baz * d[2];
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d[0] * oax + d[1] * oay + d[2] * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const qa = baba - bard * bard;
  const qb = baba * rdoa - baoa * bard;
  const qc = baba * oaoa - baoa * baoa - r * r * baba;
  const h = qb * qb - qa * qc;
  if (h >= 0 && qa > 1e-12) {
    const t = (-qb - Math.sqrt(h)) / qa;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t > T_EPS && t <= tMax ? t : Infinity;
    const cx = y <= 0 ? oax : o[0] - b[0], cy = y <= 0 ? oay : o[1] - b[1], cz = y <= 0 ? oaz : o[2] - b[2];
    const qb2 = d[0] * cx + d[1] * cy + d[2] * cz;
    const h2 = qb2 * qb2 - (cx * cx + cy * cy + cz * cz - r * r);
    if (h2 > 0) {
      const t2 = -qb2 - Math.sqrt(h2);
      return t2 > T_EPS && t2 <= tMax ? t2 : Infinity;
    }
    return Infinity;
  }
  if (baba < 1e-12 || qa <= 1e-12) return hitSphere(a, r, o, d, tMax);
  return Infinity;
}

function toLocal(c: readonly number[], v: readonly number[], out: number[], asDir: boolean): void {
  const x = asDir ? v[0] : v[0] - c[0], y = asDir ? v[1] : v[1] - c[1], z = asDir ? v[2] : v[2] - c[2];
  out[0] = m[0] * x + m[3] * y + m[6] * z;
  out[1] = m[1] * x + m[4] * y + m[7] * z;
  out[2] = m[2] * x + m[5] * y + m[8] * z;
}

const lo = [0, 0, 0], ld = [0, 0, 0];

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
