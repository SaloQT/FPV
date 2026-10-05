/**
 * Path progress for the training reward: each world's centreline resampled to PATH_STEP_M spacing and packed as vec4
 * (x, y, z, arc length from the first sample), the sample each gate spawn and the pad spawn start from, and a TypeScript copy of
 * the env kernel's path search (env.wgsl pathSearch / pathArc) for the checks.
 *
 * Every decision the kernel looks for the nearest sample in a window of PATH_BACK samples behind to PATH_AHEAD ahead of the last
 * one (wrapping on a circuit, clamped on an open track), projects the drone onto that sample's two segments and rewards the
 * change in arc length. The window keeps the search on the right branch where a split-S or a loop passes over itself.
 */
import type { TrackData, Vec3 } from '../../contracts';
import { trackGateFrame } from '../../world/track/gate';

/** Spacing of the packed path samples, metres. */
export const PATH_STEP_M = 1;
/** Search window around the previous sample, in samples. */
export const PATH_BACK = 8;
export const PATH_AHEAD = 40;
/** Largest progress rewarded in one decision, metres (either way). */
export const PATH_MAX_STEP = 10;
/** Floats per packed sample. */
export const PATH_WORDS = 4;

export interface PackedPath {
  /** PATH_WORDS floats per sample: x, y, z, arc length from sample 0. Empty when the track has no usable path. */
  points: Float32Array;
  /** Sample count (0 = no path: the kernel falls back to the straight-line progress term). */
  count: number;
  /** Length of one lap (closed: including the closing edge) or of the run, metres. */
  length: number;
  closed: boolean;
  /** Per gate: the sample a spawn behind that gate starts its search from. */
  gateSample: number[];
  /** The sample a pad spawn starts its search from. */
  startSample: number;
}

const EMPTY: Omit<PackedPath, 'closed' | 'gateSample'> = { points: new Float32Array(0), count: 0, length: 0, startSample: 0 };

/** Arc-length resampling of `path` at `step` metres (a closed path does not repeat its first point). */
export function resamplePath(path: readonly Vec3[], closed: boolean, step = PATH_STEP_M): Vec3[] {
  const n = path.length;
  if (n < 2) return [];
  const edges = closed ? n : n - 1;
  const cum = new Float64Array(edges + 1);
  for (let i = 0; i < edges; i++) {
    const a = path[i], b = path[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const total = cum[edges];
  if (!(total > 1e-6)) return [];
  const count = closed ? Math.max(3, Math.round(total / step)) : Math.max(2, Math.floor(total / step) + 1);
  const ds = closed ? total / count : step;
  const out: Vec3[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = Math.min(k * ds, total);
    while (seg < edges - 1 && cum[seg + 1] < s) seg++;
    const a = path[seg], b = path[(seg + 1) % n];
    const len = cum[seg + 1] - cum[seg];
    const f = len > 1e-9 ? (s - cum[seg]) / len : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  // An open run keeps its true end point
  if (!closed) {
    const e = path[n - 1], l = out[out.length - 1];
    if (Math.hypot(e[0] - l[0], e[1] - l[1], e[2] - l[2]) > 1e-3 * step) out.push([e[0], e[1], e[2]]);
  }
  return out;
}

/** The track's path as the kernel reads it, with the spawn search starts. */
export function packPath(track: TrackData): PackedPath {
  const closed = track.closed;
  const pts = resamplePath(leadIn(track), closed);
  const gateSample = track.gates.map(() => 0);
  if (pts.length < 2) return { ...EMPTY, closed, gateSample };
  const n = pts.length;
  const points = new Float32Array(n * PATH_WORDS);
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += dist(pts[i], pts[i - 1]);
    points.set([pts[i][0], pts[i][1], pts[i][2], s], i * PATH_WORDS);
  }
  const length = closed ? s + dist(pts[n - 1], pts[0]) : s;
  const tangent = (i: number): Vec3 => {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  };
  // A gate's sample is the nearest one where the path runs through the gate forwards: where the path crosses itself (split-S,
  // loop) the other branch can be as close but runs the other way.
  track.gates.forEach((g, k) => {
    const f = trackGateFrame(g).forward;
    let best = -1, bestD = Infinity, any = 0, anyD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = dist(pts[i], g.pos);
      if (d < anyD) { anyD = d; any = i; }
      if (d < bestD) {
        const t = tangent(i);
        if (t[0] * f[0] + t[1] * f[1] + t[2] * f[2] > 0) { bestD = d; best = i; }
      }
    }
    gateSample[k] = best >= 0 && bestD < anyD + 5 ? best : any;
  });
  let startSample = 0, startD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = dist(pts[i], track.start.pos);
    if (d < startD) { startD = d; startSample = i; }
  }
  return { points, count: n, length, closed, gateSample, startSample };
}

/**
 * The centreline the reward follows. An open run's path starts at its first gate, so it gets a lead-in from the pad: without it
 * the whole take-off leg sits before sample 0, where the arc length is clamped to 0 and closing on the first gate earns nothing.
 * A circuit already passes the pad, and a path that starts within a sample of the pad needs no lead-in.
 */
export function leadIn(track: TrackData): Vec3[] {
  const path = track.path ?? [];
  if (track.closed || path.length < 2) return [...path];
  const a = track.start.pos;
  return dist(a, path[0]) > PATH_STEP_M ? [[a[0], a[1], a[2]], ...path] : [...path];
}

function dist(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Sample `i + d`: wrapped on a circuit, clamped on an open track (env.wgsl pathStep). */
export function pathStep(p: PackedPath, i: number, d: number): number {
  const n = p.count;
  const j = i + d;
  return p.closed ? ((j % n) + n) % n : Math.min(Math.max(j, 0), n - 1);
}

/** The nearest sample to `pos` in the window around `from` (env.wgsl pathSearch); the first one wins a tie. */
export function pathSearch(p: PackedPath, from: number, pos: ArrayLike<number>): number {
  let best = from, bestD = Infinity;
  const q = p.points;
  for (let k = -PATH_BACK; k <= PATH_AHEAD; k++) {
    const j = pathStep(p, from, k);
    const dx = pos[0] - q[j * 4], dy = pos[1] - q[j * 4 + 1], dz = pos[2] - q[j * 4 + 2];
    const dd = dx * dx + dy * dy + dz * dz;
    if (dd < bestD) { bestD = dd; best = j; }
  }
  return best;
}

/** Arc length of the point nearest `pos` on the two segments either side of sample `i` (env.wgsl pathArc). */
export function pathArc(p: PackedPath, i: number, pos: ArrayLike<number>): number {
  const q = p.points;
  const cx = q[i * 4], cy = q[i * 4 + 1], cz = q[i * 4 + 2];
  let s = q[i * 4 + 3];
  let best = (pos[0] - cx) ** 2 + (pos[1] - cy) ** 2 + (pos[2] - cz) ** 2;
  const seg = (j: number, ahead: boolean): void => {
    const ax = ahead ? cx : q[j * 4], ay = ahead ? cy : q[j * 4 + 1], az = ahead ? cz : q[j * 4 + 2];
    const vx = (ahead ? q[j * 4] : cx) - ax, vy = (ahead ? q[j * 4 + 1] : cy) - ay, vz = (ahead ? q[j * 4 + 2] : cz) - az;
    const l2 = vx * vx + vy * vy + vz * vz;
    if (l2 <= 1e-12) return;
    const t = Math.min(Math.max(((pos[0] - ax) * vx + (pos[1] - ay) * vy + (pos[2] - az) * vz) / l2, 0), 1);
    const d = (ax + vx * t - pos[0]) ** 2 + (ay + vy * t - pos[1]) ** 2 + (az + vz * t - pos[2]) ** 2;
    if (d < best) {
      best = d;
      const len = Math.sqrt(l2);
      s = ahead ? q[i * 4 + 3] + t * len : q[i * 4 + 3] - (1 - t) * len;
    }
  };
  if (p.closed || i + 1 < p.count) seg(pathStep(p, i, 1), true);
  if (p.closed || i > 0) seg(pathStep(p, i, -1), false);
  return s;
}

/** Arc-length change from `s0` to `s1`, the short way round a circuit, clamped to PATH_MAX_STEP (env.wgsl stepEnvs). */
export function pathDelta(p: PackedPath, s0: number, s1: number): number {
  let d = s1 - s0;
  if (p.closed) {
    if (d > 0.5 * p.length) d -= p.length;
    else if (d < -0.5 * p.length) d += p.length;
  }
  return Math.min(Math.max(d, -PATH_MAX_STEP), PATH_MAX_STEP);
}
