/**
 * Packing of RT proxy primitives into the 64-byte records read by shaders/rt/rt_prims.wgsl, plus their world bounds.
 *
 * Record (16 words):
 *   [0..2] centre (obb, sphere, torus) or capsule end a   [3] kind (u32)
 *   [4..6] half extents (obb) / capsule end b / (major, 0, 0) (torus)   [7] radius (sphere, capsule) or minor radius (torus)
 *   [8..11] rotation quaternion (x, y, z, w) local -> world (obb, torus; identity otherwise)
 *   [12] albedo rgb + roughness as 4 x unorm8   [13] emissive.rg as 2 x f16   [14] emissive.b + metalness as 2 x f16   [15] spare
 * Torus: the ring lies in the local XZ plane (axis = local +Y).
 * Emissive is a linear radiance factor: the shaders emit `emissive * EMISSIVE_MAX_NITS` (same scale as the G-buffer emissive channel).
 */
import type { RTMaterial, RTPrimitive } from '../contracts';
import { toHalf } from '../half';

export const PRIM_WORDS = 16;
export const PRIM_BYTES = PRIM_WORDS * 4;
export const PrimKind = { Obb: 0, Capsule: 1, Sphere: 2, Torus: 3 } as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const unorm8 = (v: number): number => Math.round(clamp01(v) * 255);

function packMaterial(f: Float32Array, u: Uint32Array, o: number, m: RTMaterial): void {
  u[o + 12] = (unorm8(m.albedo[0]) | (unorm8(m.albedo[1]) << 8) | (unorm8(m.albedo[2]) << 16) | (unorm8(m.roughness) << 24)) >>> 0;
  const e = m.emissive;
  u[o + 13] = ((toHalf(e ? e[0] : 0) | (toHalf(e ? e[1] : 0) << 16)) >>> 0);
  u[o + 14] = ((toHalf(e ? e[2] : 0) | (toHalf(clamp01(m.metalness)) << 16)) >>> 0);
  f[o + 15] = 0;
}

function packRotation(f: Float32Array, o: number, q: readonly number[]): void {
  const n = 1 / (Math.hypot(q[0], q[1], q[2], q[3]) || 1);
  f[o] = q[0] * n; f[o + 1] = q[1] * n; f[o + 2] = q[2] * n; f[o + 3] = q[3] * n;
}

/** Writes one primitive at word offset `o` (a multiple of 16) of the paired views. */
export function packPrim(f: Float32Array, u: Uint32Array, o: number, p: RTPrimitive): void {
  f[o + 8] = 0; f[o + 9] = 0; f[o + 10] = 0; f[o + 11] = 1;
  f[o + 4] = 0; f[o + 5] = 0; f[o + 6] = 0; f[o + 7] = 0;
  switch (p.type) {
    case 'obb':
      f.set(p.center, o); u[o + 3] = PrimKind.Obb; f.set(p.half, o + 4); packRotation(f, o + 8, p.rot);
      break;
    case 'capsule':
      f.set(p.a, o); u[o + 3] = PrimKind.Capsule; f.set(p.b, o + 4); f[o + 7] = p.radius;
      break;
    case 'sphere':
      f.set(p.center, o); u[o + 3] = PrimKind.Sphere; f[o + 7] = p.radius;
      break;
    case 'torus':
      f.set(p.center, o); u[o + 3] = PrimKind.Torus; f[o + 4] = p.major; f[o + 7] = p.minor; packRotation(f, o + 8, p.rot);
      break;
  }
  packMaterial(f, u, o, p.material);
}

/** Rotation matrix rows of a unit quaternion (x, y, z, w), written into m[0..8] row-major (local -> world). */
export function quatToMatrix(q: readonly number[], m: Float64Array | number[]): void {
  const [x, y, z, w] = q;
  const n = 1 / Math.hypot(x, y, z, w);
  const qx = x * n, qy = y * n, qz = z * n, qw = w * n;
  m[0] = 1 - 2 * (qy * qy + qz * qz); m[1] = 2 * (qx * qy - qz * qw); m[2] = 2 * (qx * qz + qy * qw);
  m[3] = 2 * (qx * qy + qz * qw); m[4] = 1 - 2 * (qx * qx + qz * qz); m[5] = 2 * (qy * qz - qx * qw);
  m[6] = 2 * (qx * qz - qy * qw); m[7] = 2 * (qy * qz + qx * qw); m[8] = 1 - 2 * (qx * qx + qy * qy);
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
    case 'torus': {
      quatToMatrix(p.rot, rot);
      const l = p.type === 'obb' ? p.half : [p.major + p.minor, p.minor, p.major + p.minor];
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
