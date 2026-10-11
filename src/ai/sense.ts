/**
 * Obstacle sensing: the observation slots OBS.rays and OBS.near (spec.ts). src/ai/gpu/sense.wgsl builds the same values on
 * the GPU through world.wgsl's box grid; obscheck compares the two.
 *
 * Range rays leave the quad's centre in fixed body directions over the FPV camera's view and report 1 - d / SENSE_RANGE for the
 * first surface within SENSE_RANGE: the physics ground (terrain plus the start pad) or a collider. The ground is sampled at
 * SENSE_MARCH fixed distances (1 m apart near the quad, 2.75 m at range) and the first sample under it is refined by bisection, so
 * a ridge narrower than a gap can slip between samples. A ray only sees what it passes through: a thin post between two rays is
 * found by the side slots instead.
 *
 * Sides: for each side of the quad (sideOf), the collider whose surface comes nearest within NEAR_RANGE on that side (1 cm
 * apart counts as a tie, see NEAR_TIE_PER_M), as the unit vector to its closest point in body axes and 1 - d / NEAR_RANGE.
 * Flying through a gate, its posts and bars each land on their own side.
 */
import type { ObstacleCollider } from '../contracts';
import { NEAR_RANGE, NEAR_SIDES, OBS, SENSE_COLS, SENSE_RANGE, SENSE_ROWS, SENSE_STEP_DEG, SENSE_TILT_DEG } from './spec';

/** Ground samples along a ray, and the bisection steps that refine the first one under the ground. */
export const SENSE_MARCH = 16;
export const SENSE_REFINE = 6;
/**
 * Side slots compare distances in steps of 1 / NEAR_TIE_PER_M m, the lower collider index winning within a step: a quad on a
 * gate's centreline (where the game respawns it) is as near one post as the other, and f32 rounding would pick either.
 */
export const NEAR_TIE_PER_M = 100;
/** A ray direction component below this counts as parallel to a box face. */
export const SENSE_PARALLEL = 1e-6;

/** Distance of ground sample k (1..SENSE_MARCH) along a ray; exact in f32, so the GPU samples the same points. */
export function marchAt(k: number): number {
  return (SENSE_RANGE * (k * (k + SENSE_MARCH))) / (2 * SENSE_MARCH * SENSE_MARCH);
}

/** Ray directions in body axes (x right, y up, -z forward), three per ray, rows from the top and each row left to right. */
export function senseDirs(): Float64Array {
  const out = new Float64Array(SENSE_ROWS * SENSE_COLS * 3);
  const deg = Math.PI / 180, tilt = SENSE_TILT_DEG * deg;
  // Camera axes: forward tilted up from the nose, its up, and the body's right
  const fy = Math.sin(tilt), fz = -Math.cos(tilt), uy = Math.cos(tilt), uz = Math.sin(tilt);
  for (let r = 0; r < SENSE_ROWS; r++) {
    for (let c = 0; c < SENSE_COLS; c++) {
      const el = ((SENSE_ROWS - 1) / 2 - r) * SENSE_STEP_DEG * deg, az = (c - (SENSE_COLS - 1) / 2) * SENSE_STEP_DEG * deg;
      const k = (r * SENSE_COLS + c) * 3, h = Math.cos(el);
      out[k] = h * Math.sin(az);
      out[k + 1] = h * Math.cos(az) * fy + Math.sin(el) * uy;
      out[k + 2] = h * Math.cos(az) * fz + Math.sin(el) * uz;
    }
  }
  return out;
}

const DIRS = senseDirs();
/** Floats per collider: centre, half extents, cos and sin of the yaw, bounding radius. */
const W = 9;

/** What the sensors see: the physics ground and the colliders. */
export interface SenseWorld {
  readonly groundAt: (x: number, z: number) => number;
  readonly colliders: readonly ObstacleCollider[];
  readonly boxes: Float64Array;
  /** Scratch: the colliders within reach of the quad this decision. */
  readonly reach: Int32Array;
}

export function senseWorld(colliders: readonly ObstacleCollider[], groundAt: (x: number, z: number) => number): SenseWorld {
  const boxes = new Float64Array(colliders.length * W);
  colliders.forEach((c, i) => {
    boxes.set([c.center[0], c.center[1], c.center[2], c.half[0], c.half[1], c.half[2], Math.cos(c.yaw), Math.sin(c.yaw),
      Math.hypot(c.half[0], c.half[1], c.half[2])], i * W);
  });
  return { groundAt, colliders, boxes, reach: new Int32Array(colliders.length) };
}

// Ray-box entry interval, shared by `slab` and `rayBox` (allocation-free).
let lo = 0, hi = 0;

/** Clips [lo, hi] to where the ray is between a box's faces on one axis: origin `o`, direction `u`, half extent `h`. */
function slab(o: number, u: number, h: number): void {
  if (Math.abs(u) < SENSE_PARALLEL) {
    if (Math.abs(o) > h) { lo = 1; hi = 0; }
    return;
  }
  const a = (-h - o) / u, b = (h - o) / u;
  lo = Math.max(lo, Math.min(a, b));
  hi = Math.min(hi, Math.max(a, b));
}

/** Where the ray p + t d (t in [0, tMax]) enters the box at `o` in `b`, or tMax when it misses (CollisionWorld's box frame). */
export function rayBox(b: Float64Array, o: number, px: number, py: number, pz: number, dx: number, dy: number, dz: number, tMax: number): number {
  const rx = px - b[o], ry = py - b[o + 1], rz = pz - b[o + 2], c = b[o + 6], s = b[o + 7];
  lo = 0;
  hi = tMax;
  slab(c * rx - s * rz, c * dx - s * dz, b[o + 3]);
  slab(ry, dy, b[o + 4]);
  slab(s * rx + c * rz, s * dx + c * dz, b[o + 5]);
  return lo <= hi ? lo : tMax;
}

/** Where the ray p + t d first meets the ground within SENSE_RANGE, or SENSE_RANGE. */
export function groundHit(groundAt: (x: number, z: number) => number, px: number, py: number, pz: number, dx: number, dy: number, dz: number): number {
  let t0 = 0, f0 = py - groundAt(px, pz);
  if (f0 <= 0) return 0;
  for (let k = 1; k <= SENSE_MARCH; k++) {
    let t1 = marchAt(k), f1 = py + dy * t1 - groundAt(px + dx * t1, pz + dz * t1);
    if (f1 > 0) {
      t0 = t1;
      f0 = f1;
      continue;
    }
    for (let i = 0; i < SENSE_REFINE; i++) {
      const tm = 0.5 * (t0 + t1), fm = py + dy * tm - groundAt(px + dx * tm, pz + dz * tm);
      if (fm > 0) { t0 = tm; f0 = fm; } else { t1 = tm; f1 = fm; }
    }
    return t0 + ((t1 - t0) * f0) / (f0 - f1);
  }
  return SENSE_RANGE;
}

/**
 * The side of the quad a body-axes direction is on: the axis it leans along most (x before y before z on a tie), 0 right (+x),
 * 1 left, 2 up (+y), 3 down, 4 back (+z), 5 front.
 */
export function sideOf(x: number, y: number, z: number): number {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) return x >= 0 ? 0 : 1;
  if (ay >= az) return y >= 0 ? 2 : 3;
  return z >= 0 ? 4 : 5;
}

const nearK = new Float64Array(NEAR_SIDES), nearD = new Float64Array(NEAR_SIDES), nearI = new Int32Array(NEAR_SIDES), nearU = new Float64Array(NEAR_SIDES * 3);

/**
 * Writes the range rays and the nearest colliders into `out` at OBS.rays and OBS.near. `rot` is the body -> world rotation,
 * row-major (quatToMat3).
 */
export function sense(w: SenseWorld, pos: ArrayLike<number>, rot: ArrayLike<number>, out: Float32Array | Float64Array): void {
  const px = pos[0], py = pos[1], pz = pos[2], b = w.boxes;
  let n = 0;
  for (let i = 0, o = 0; o < b.length; i++, o += W) {
    const ex = b[o] - px, ey = b[o + 1] - py, ez = b[o + 2] - pz, r = SENSE_RANGE + b[o + 8];
    if (ex * ex + ey * ey + ez * ez <= r * r) w.reach[n++] = i;
  }
  for (let k = 0; k < DIRS.length / 3; k++) {
    const bx = DIRS[k * 3], by = DIRS[k * 3 + 1], bz = DIRS[k * 3 + 2];
    const dx = rot[0] * bx + rot[1] * by + rot[2] * bz, dy = rot[3] * bx + rot[4] * by + rot[5] * bz, dz = rot[6] * bx + rot[7] * by + rot[8] * bz;
    let t = groundHit(w.groundAt, px, py, pz, dx, dy, dz);
    for (let j = 0; j < n; j++) {
      const o = w.reach[j] * W, ex = b[o] - px, ey = b[o + 1] - py, ez = b[o + 2] - pz;
      // Skip boxes whose bounding sphere the ray misses
      const along = ex * dx + ey * dy + ez * dz, r = b[o + 8];
      if (along < -r || along > t + r || ex * ex + ey * ey + ez * ez - along * along > r * r) continue;
      t = rayBox(b, o, px, py, pz, dx, dy, dz, t);
    }
    out[OBS.rays + k] = 1 - t / SENSE_RANGE;
  }
  nearK.fill(Infinity);
  nearI.fill(-1);
  for (let j = 0; j < n; j++) {
    const i = w.reach[j], o = i * W, c = b[o + 6], s = b[o + 7];
    const rx = px - b[o], ry = py - b[o + 1], rz = pz - b[o + 2];
    // Box-local offset of the quad, and from it to the closest point of the box
    const lx = c * rx - s * rz, lz = s * rx + c * rz;
    const vx = clamp(lx, b[o + 3]) - lx, vy = clamp(ry, b[o + 4]) - ry, vz = clamp(lz, b[o + 5]) - lz;
    const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (d >= NEAR_RANGE) continue;
    // Unit vector in world axes (the inverse of the box rotation), then body axes (the transpose of `rot`)
    const k = d > 1e-6 ? 1 / d : 0, x = (c * vx + s * vz) * k, y = vy * k, z = (-s * vx + c * vz) * k;
    const ux = rot[0] * x + rot[3] * y + rot[6] * z, uy = rot[1] * x + rot[4] * y + rot[7] * z, uz = rot[2] * x + rot[5] * y + rot[8] * z;
    const side = sideOf(ux, uy, uz);
    const key = Math.floor(d * NEAR_TIE_PER_M);
    if (!(key < nearK[side] || (key === nearK[side] && i < nearI[side]))) continue;
    nearK[side] = key;
    nearD[side] = d;
    nearI[side] = i;
    nearU[side * 3] = ux;
    nearU[side * 3 + 1] = uy;
    nearU[side * 3 + 2] = uz;
  }
  for (let m = 0; m < NEAR_SIDES; m++) {
    const o = OBS.near + m * 4, seen = nearI[m] >= 0;
    out[o] = seen ? nearU[m * 3] : 0;
    out[o + 1] = seen ? nearU[m * 3 + 1] : 0;
    out[o + 2] = seen ? nearU[m * 3 + 2] : 0;
    out[o + 3] = seen ? 1 - nearD[m] / NEAR_RANGE : 0;
  }
}

function clamp(v: number, h: number): number {
  return v > h ? h : v < -h ? -h : v;
}
