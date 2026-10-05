/**
 * The dashboard's trajectory trace: per iteration, T steps x K traced drones, one vec4f each (x, y, z, packed word), laid out
 * [t][e]. The packed word holds the world (bits 0-11), the gate due next (bits 12-23) and the crashed (24), finished (25) and
 * episode-done (26) flags; read it through a Uint32Array view on the same buffer. Traced drone e always flies world e % worlds.
 */

export interface IterationTrace {
  /** Traced drones. */
  K: number;
  /** Steps per iteration. */
  T: number;
  /** K * T * 4 floats, [t][e][x, y, z, word]. */
  data: Float32Array;
}

export const TRACE_WORLD_MASK = 0xfff;
export const TRACE_NEXT_SHIFT = 12;
export const TRACE_CRASHED = 1 << 24;
export const TRACE_FINISHED = 1 << 25;
export const TRACE_DONE = 1 << 26;

/** Default traced drones when the dashboard is on. */
export const DASH_TRACE_ENVS = 256;

export interface TracePoint {
  x: number;
  y: number;
  z: number;
  world: number;
  next: number;
  crashed: boolean;
  finished: boolean;
  done: boolean;
}

/** The packed word env.wgsl writes. */
export function packTraceWord(world: number, next: number, crashed: boolean, finished: boolean, done: boolean): number {
  return ((world & TRACE_WORLD_MASK) | (Math.min(next, TRACE_WORLD_MASK) << TRACE_NEXT_SHIFT) | (crashed ? TRACE_CRASHED : 0)
    | (finished ? TRACE_FINISHED : 0) | (done ? TRACE_DONE : 0)) >>> 0;
}

/** Drone `e` at step `t` of a trace. */
export function tracePoint(tr: IterationTrace, t: number, e: number): TracePoint {
  const o = (t * tr.K + e) * 4;
  const w = new Uint32Array(tr.data.buffer, tr.data.byteOffset, tr.data.length)[o + 3];
  return {
    x: tr.data[o], y: tr.data[o + 1], z: tr.data[o + 2],
    world: w & TRACE_WORLD_MASK, next: (w >>> TRACE_NEXT_SHIFT) & TRACE_WORLD_MASK,
    crashed: (w & TRACE_CRASHED) !== 0, finished: (w & TRACE_FINISHED) !== 0, done: (w & TRACE_DONE) !== 0,
  };
}
