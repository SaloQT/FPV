// Drone traces: one vec4f per traced drone and policy step (x, y, z, packed bits), [t][e]. Bits of the packed word: world 0-11,
// next gate 12-23, crashed 24, finished 25, done 26 (the step ended the episode; the next step starts from a respawn).
// Pure logic: decoding, per-world tallies, trails across consecutive iterations, the playhead and a fetch cache.

export const BIT_CRASH = 1 << 24;
export const BIT_FINISH = 1 << 25;
export const BIT_DONE = 1 << 26;

/** Wraps the bytes of one trace. */
export function makeTrace(iteration, K, T, buffer) {
  if (!(K > 0 && T > 0) || buffer.byteLength < K * T * 16) throw new Error(`trace ${iteration}: ${buffer.byteLength} bytes for K=${K} T=${T}`);
  return { iteration, K, T, f: new Float32Array(buffer, 0, K * T * 4), u: new Uint32Array(buffer, 0, K * T * 4) };
}

export const worldOf = (bits) => bits & 0xfff;
export const nextOf = (bits) => (bits >>> 12) & 0xfff;

/** Packs a record the way the GPU does (used by the demo and the tests). */
export function packBits(world, next, crashed, finished, done) {
  return ((world & 0xfff) | ((Math.min(next, 0xfff) & 0xfff) << 12) | (crashed ? BIT_CRASH : 0) | (finished ? BIT_FINISH : 0) | (done ? BIT_DONE : 0)) >>> 0;
}

/**
 * Per world over the whole trace: drones seen, gates passed (the next gate moved on within an episode), crashes, finishes and
 * episode ends. Returns an array of length `worlds`.
 */
export function worldTallies(tr, worlds) {
  const out = Array.from({ length: worlds }, () => ({ drones: 0, gates: 0, crashes: 0, finishes: 0, dones: 0 }));
  const { K, T, u } = tr;
  for (let e = 0; e < K; e++) {
    let seen = -1;
    for (let t = 0; t < T; t++) {
      const b = u[(t * K + e) * 4 + 3];
      const w = worldOf(b);
      if (w >= worlds) continue;
      const o = out[w];
      if (w !== seen) { o.drones++; seen = w; }
      if (t > 0) {
        const p = u[((t - 1) * K + e) * 4 + 3];
        if (!(p & BIT_DONE) && worldOf(p) === w && nextOf(p) !== nextOf(b)) o.gates++;
      }
      if (b & BIT_CRASH) o.crashes++;
      if (b & BIT_FINISH) o.finishes++;
      if (b & BIT_DONE) o.dones++;
    }
  }
  return out;
}

/** Traced drones that are in world `w` at step `t` (ascending env index). */
export function dronesInWorld(tr, w, t = 0) {
  const out = [];
  const { K, u } = tr;
  const tt = Math.min(Math.max(t, 0), tr.T - 1);
  for (let e = 0; e < K; e++) if (worldOf(u[(tt * K + e) * 4 + 3]) === w) out.push(e);
  return out;
}

/**
 * Position of drone e at fractional step `t` of `tr`, blended toward the next step (the first step of `next`, when it is the
 * following iteration). No blend across an episode end. Returns [x, y, z, bits].
 */
export function dronePos(tr, e, t, next = null) {
  const T = tr.T, K = tr.K;
  const t0 = Math.min(Math.max(Math.floor(t), 0), T - 1);
  const a = (t0 * K + e) * 4;
  const bits = tr.u[a + 3];
  const f = Math.min(Math.max(t - t0, 0), 1);
  let bx = tr.f[a], by = tr.f[a + 1], bz = tr.f[a + 2];
  if (f > 0 && !(bits & BIT_DONE)) {
    let src = null, b = 0;
    if (t0 + 1 < T) { src = tr; b = ((t0 + 1) * K + e) * 4; }
    else if (next && next.K === K) { src = next; b = e * 4; }
    if (src && worldOf(src.u[b + 3]) === worldOf(bits)) {
      bx += (src.f[b] - bx) * f; by += (src.f[b + 1] - by) * f; bz += (src.f[b + 2] - bz) * f;
    }
  }
  return [bx, by, bz, bits];
}

/**
 * The trail of drone e ending at step floor(t) of the iteration at chain[last]: newest last, at most `steps` points, cut at the
 * last episode end or world change. `chain` holds consecutive iterations' traces (oldest first, nulls end it).
 * Each point: [x, y, z, bits, age in steps].
 */
export function trail(chain, e, t, steps) {
  const pts = [];
  let age = 0;
  for (let c = chain.length - 1; c >= 0 && pts.length < steps; c--) {
    const tr = chain[c];
    if (!tr || e >= tr.K) break;
    const start = c === chain.length - 1 ? Math.min(Math.floor(t), tr.T - 1) : tr.T - 1;
    for (let s = start; s >= 0 && pts.length < steps; s--, age++) {
      const a = (s * tr.K + e) * 4;
      const bits = tr.u[a + 3];
      if (pts.length > 0) {
        const newer = pts[pts.length - 1][3];
        if (bits & BIT_DONE || worldOf(bits) !== worldOf(newer)) return pts.reverse();
      }
      pts.push([tr.f[a], tr.f[a + 1], tr.f[a + 2], bits, age]);
    }
  }
  return pts.reverse();
}

/** Steps where drone e crashed in `chain` up to step t of the last trace, newest within `steps`: [x, y, z, age]. */
export function crashMarks(chain, e, t, steps) {
  const out = [];
  let age = 0;
  for (let c = chain.length - 1; c >= 0 && age < steps; c--) {
    const tr = chain[c];
    if (!tr || e >= tr.K) break;
    const start = c === chain.length - 1 ? Math.min(Math.floor(t), tr.T - 1) : tr.T - 1;
    for (let s = start; s >= 0 && age < steps; s--, age++) {
      const a = (s * tr.K + e) * 4;
      if (tr.u[a + 3] & BIT_CRASH) out.push([tr.f[a], tr.f[a + 1], tr.f[a + 2], age, worldOf(tr.u[a + 3])]);
    }
  }
  return out;
}

/** The kept trace to show for a scrub position: the newest at or before `it`, else the oldest after it, else null. */
export function traceFor(list, it) {
  if (!list.length) return null;
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= it) lo = mid + 1; else hi = mid;
  }
  return lo > 0 ? list[lo - 1] : list[0];
}

/** The kept trace after `it` (or before it with dir -1), or null. */
export function traceStep(list, it, dir = 1) {
  if (!list.length) return null;
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= it) lo = mid + 1; else hi = mid;
  }
  if (dir > 0) return lo < list.length ? list[lo] : null;
  const k = list[lo - 1] === it ? lo - 2 : lo - 1;
  return k >= 0 ? list[k] : null;
}

/**
 * Moves the playhead { it, t } on by `dt` seconds of wall time at `speed` (sim seconds per second). Past the last step it
 * moves to the next kept trace; with none it holds on the last step. Live mode speeds up to catch the newest trace.
 * Returns { it, t, held }.
 */
export function advance(head, dt, { speed = 1, hz = 50, T, list, live = false }) {
  let { it, t } = head;
  let rate = speed;
  if (live && list.length) {
    const newest = list[list.length - 1];
    const behind = list.length - 1 - list.indexOf(it) + (T - t) / T;
    if (newest !== it && behind > 1.5) rate = Math.max(speed, behind);
    if (behind > 6) return { it: newest, t: 0, held: false };
  }
  t += dt * hz * rate;
  while (t >= T) {
    const next = traceStep(list, it, 1);
    if (next === null) return { it, t: T - 1e-6, held: true };
    it = next;
    t -= T;
  }
  return { it, t, held: false };
}

/** LRU of decoded traces with de-duplicated loads. `load(it)` resolves to { K, T, buffer } or null. */
export class TraceCache {
  constructor(load, max = 96) {
    this.load = load;
    this.max = max;
    this.map = new Map();
    this.pending = new Map();
    this.missing = new Set();
  }

  /** The decoded trace when cached (and marks it recent), else null. */
  peek(it) {
    const tr = this.map.get(it);
    if (tr) { this.map.delete(it); this.map.set(it, tr); }
    return tr ?? null;
  }

  async get(it) {
    const hit = this.peek(it);
    if (hit) return hit;
    if (this.missing.has(it)) return null;
    let p = this.pending.get(it);
    if (!p) {
      p = (async () => {
        try {
          const r = await this.load(it);
          if (!r) { this.missing.add(it); return null; }
          const tr = makeTrace(it, r.K, r.T, r.buffer);
          this.map.set(it, tr);
          while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
          return tr;
        } finally {
          this.pending.delete(it);
        }
      })();
      this.pending.set(it, p);
    }
    return p;
  }

  /** Forgets that an iteration had no trace (a later list may have it). */
  forgetMissing() { this.missing.clear(); }
}

/**
 * The traces before and including `it` that are consecutive iterations (it - n + 1 .. it), as far as `cache` has them: what the
 * trails are drawn from. Oldest first.
 */
export function chainOf(cache, it, n) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) out.push(cache.peek(it - k));
  let cut = out.length - 1;
  while (cut > 0 && out[cut - 1]) cut--;
  return out.slice(cut);
}
