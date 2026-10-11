/**
 * Packing of RT proxy primitives into the 64-byte records read by shaders/rt/rt_prims.wgsl, plus their world bounds.
 *
 * Record (16 words):
 *   [0..2] centre (obb, sphere, torus) or capsule end a   [3] kind (u32)
 *   [4..6] half extents (obb) / capsule end b / (major, 0, 0) (torus)   [7] radius (sphere, capsule) or minor radius (torus)
 *   [8..11] rotation quaternion (x, y, z, w) local -> world (obb, torus; identity otherwise)
 *   [12] albedo rgb + roughness as 4 x unorm8   [13] emissive.rg as 2 x f16   [14] emissive.b + metalness as 2 x f16   [15] flags (PRIM_FLAG_CANOPY: leaf crown, partially transparent)
 * Torus: the ring lies in the local XZ plane (axis = local +Y).
 * Emissive is a linear radiance factor: the shaders emit `emissive * EMISSIVE_MAX_NITS` (same scale as the G-buffer emissive channel).
 */
import type { RTMaterial, RTPrimitive } from '../contracts';
import { toHalf } from '../half';
import { PRIM_FLAG_CANOPY, isCanopyProxy } from './canopy';

export const PRIM_WORDS = 16;
export const PRIM_BYTES = PRIM_WORDS * 4;
export const PrimKind = { Obb: 0, Capsule: 1, Sphere: 2, Torus: 3, Cylinder: 4, Ellipsoid: 5, Cone: 6, Gable: 7 } as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const unorm8 = (v: number): number => Math.round(clamp01(v) * 255);

function packMaterial(u: Uint32Array, o: number, m: RTMaterial): void {
  const r = m.albedo[0], g = m.albedo[1], b = m.albedo[2], e = m.emissive, er = e?.[0] ?? 0, eg = e?.[1] ?? 0, eb = e?.[2] ?? 0;
  const color = (unorm8(r) | (unorm8(g) << 8) | (unorm8(b) << 16) | (unorm8(m.roughness) << 24)) >>> 0;
  const emissionRG = e ? (toHalf(er) | (toHalf(eg) << 16)) >>> 0 : 0;
  const emissionBMetal = ((e ? toHalf(eb) : 0) | ((m.metalness > 0 ? toHalf(clamp01(m.metalness)) : 0) << 16)) >>> 0;
  u[o + 12] = color; u[o + 13] = emissionRG; u[o + 14] = emissionBMetal;
}

function packRotation(f: Float32Array, o: number, q: readonly number[]): void {
  const n = 1 / (Math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2) || 1);
  f[o] = q[0] * n; f[o + 1] = q[1] * n; f[o + 2] = q[2] * n; f[o + 3] = q[3] * n;
}
function packVector(f: Float32Array, o: number, v: readonly number[]): void {
  f[o] = v[0]; f[o + 1] = v[1]; f[o + 2] = v[2];
}

/** Writes one primitive at word offset `o` (a multiple of 16) of the paired views. */
export function packPrim(f: Float32Array, u: Uint32Array, o: number, p: RTPrimitive): void {
  f[o + 8] = 0; f[o + 9] = 0; f[o + 10] = 0; f[o + 11] = 1;
  f[o + 4] = 0; f[o + 5] = 0; f[o + 6] = 0; f[o + 7] = 0;
  switch (p.type) {
    case 'obb':
      packVector(f, o, p.center); u[o + 3] = PrimKind.Obb; packVector(f, o + 4, p.half); packRotation(f, o + 8, p.rot);
      break;
    case 'cylinder':
    case 'ellipsoid':
    case 'cone':
    case 'gable':
      packVector(f, o, p.center); u[o + 3] = p.type === 'cylinder' ? PrimKind.Cylinder : p.type === 'cone' ? PrimKind.Cone : p.type === 'gable' ? PrimKind.Gable : PrimKind.Ellipsoid; packVector(f, o + 4, p.half); packRotation(f, o + 8, p.rot);
      break;
    case 'capsule':
      packVector(f, o, p.a); u[o + 3] = PrimKind.Capsule; packVector(f, o + 4, p.b); f[o + 7] = p.radius;
      break;
    case 'sphere':
      packVector(f, o, p.center); u[o + 3] = PrimKind.Sphere; f[o + 7] = p.radius;
      break;
    case 'torus':
      packVector(f, o, p.center); u[o + 3] = PrimKind.Torus; f[o + 4] = p.major; f[o + 7] = p.minor; packRotation(f, o + 8, p.rot);
      break;
  }
  packMaterial(u, o, p.material);
  u[o + 15] = isCanopyProxy(p) ? PRIM_FLAG_CANOPY : 0;
}

/** Rotation matrix rows of a unit quaternion (x, y, z, w), written into m[0..8] row-major (local -> world). */
export function quatToMatrix(q: readonly number[], m: Float64Array | number[]): void {
  const [x, y, z, w] = q;
  // The matrix depends on the squared norm: avoid a square root and four divisions for every moving primitive.
  const s = 2 / (x * x + y * y + z * z + w * w || 1);
  m[0] = 1 - s * (y * y + z * z); m[1] = s * (x * y - z * w); m[2] = s * (x * z + y * w);
  m[3] = s * (x * y + z * w); m[4] = 1 - s * (x * x + z * z); m[5] = s * (y * z - x * w);
  m[6] = s * (x * z - y * w); m[7] = s * (y * z + x * w); m[8] = 1 - s * (x * x + y * y);
}

const rot = new Float64Array(9);

/** World AABB of a primitive into out[0..5] = (minx, miny, minz, maxx, maxy, maxz). */
export function primBounds(p: RTPrimitive, out: Float32Array | number[]): void {
  let cx: number, cy: number, cz: number, hx: number, hy: number, hz: number;
  switch (p.type) {
    case 'sphere':
      [cx, cy, cz] = p.center; hx = hy = hz = p.radius;
      break;
    case 'capsule':
      cx = 0.5 * (p.a[0] + p.b[0]); cy = 0.5 * (p.a[1] + p.b[1]); cz = 0.5 * (p.a[2] + p.b[2]);
      hx = 0.5 * Math.abs(p.a[0] - p.b[0]) + p.radius; hy = 0.5 * Math.abs(p.a[1] - p.b[1]) + p.radius; hz = 0.5 * Math.abs(p.a[2] - p.b[2]) + p.radius;
      break;
    case 'obb':
    case 'cylinder':
    case 'ellipsoid':
    case 'cone':
    case 'gable':
    case 'torus': {
      quatToMatrix(p.rot, rot);
      const l = p.type === 'torus' ? [p.major + p.minor, p.minor, p.major + p.minor] : p.half;
      [cx, cy, cz] = p.center;
      hx = Math.abs(rot[0]) * l[0] + Math.abs(rot[1]) * l[1] + Math.abs(rot[2]) * l[2];
      hy = Math.abs(rot[3]) * l[0] + Math.abs(rot[4]) * l[1] + Math.abs(rot[5]) * l[2];
      hz = Math.abs(rot[6]) * l[0] + Math.abs(rot[7]) * l[1] + Math.abs(rot[8]) * l[2];
      break;
    }
  }
  out[0] = cx - hx; out[1] = cy - hy; out[2] = cz - hz;
  out[3] = cx + hx; out[4] = cy + hy; out[5] = cz + hz;
}
