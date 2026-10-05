// What the charts plot: one series per value taken from an iteration record, the store that keeps them as typed arrays, EMA
// smoothing and axis ticks. Pure logic (no DOM), shared by the page and the tests.

/** Dark-surface categorical slots, in fixed order (validated set; see the dataviz palette). */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

const per = (r) => r.metrics ?? {};
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** Simulated drone-minutes in one iteration: envs x steps decisions at policyHz. */
export function droneMinutes(ctx) {
  const ppo = ctx?.config?.ppo ?? {};
  const hz = ctx?.policyHz || 50;
  return ppo.envs > 0 && ppo.steps > 0 ? (ppo.envs * ppo.steps) / hz / 60 : NaN;
}

/**
 * The charts. Each series: key (unique), label, get(record, ctx, previous record, previous value of this series) -> number
 * (NaN for none), and `smooth: false` for values that must not be averaged (a running best).
 */
export const CHARTS = [
  { id: 'return', title: 'Mean episode return', series: [{ key: 'ret', label: 'Return', get: (r) => (per(r).episodes > 0 ? finite(per(r).meanReturn) : NaN) }] },
  { id: 'crash', title: 'Crash rate', unit: '%', series: [{ key: 'crash', label: 'Crashed episodes', get: (r) => (per(r).episodes > 0 ? (100 * per(r).crashes) / per(r).episodes : NaN) }] },
  { id: 'gates', title: 'Gates per drone-minute', series: [{ key: 'gpm', label: 'Gates', get: (r, ctx) => finite(per(r).gates) / droneMinutes(ctx) }] },
  {
    id: 'laps', title: 'Laps and finishes per iteration', series: [
      { key: 'laps', label: 'Laps', get: (r) => finite(per(r).laps) },
      { key: 'fin', label: 'Finishes', get: (r) => finite(per(r).finishes) },
    ],
  },
  {
    id: 'best', title: 'Best lap', unit: 's', series: [
      { key: 'bestIt', label: 'This iteration', get: (r) => (per(r).bestLap > 0 ? per(r).bestLap : NaN) },
      { key: 'bestRun', label: 'Best so far', smooth: false, get: (r, _c, _p, prev) => { const b = per(r).bestLap > 0 ? per(r).bestLap : NaN; return Number.isNaN(prev) ? b : Number.isNaN(b) ? prev : Math.min(prev, b); } },
    ],
  },
  { id: 'eplen', title: 'Episode length', unit: 's', series: [{ key: 'eplen', label: 'Length', get: (r, ctx) => (per(r).episodes > 0 ? finite(per(r).meanLength) / (ctx?.policyHz || 50) : NaN) }] },
  { id: 'kl', title: 'Approx KL', series: [{ key: 'kl', label: 'KL', get: (r) => finite(per(r).approxKl) }] },
  { id: 'clip', title: 'Clip fraction', series: [{ key: 'clip', label: 'Clipped', get: (r) => finite(per(r).clipFraction) }] },
  { id: 'ploss', title: 'Policy loss', series: [{ key: 'ploss', label: 'Policy', get: (r) => finite(per(r).policyLoss) }] },
  { id: 'vloss', title: 'Value loss', series: [{ key: 'vloss', label: 'Value', get: (r) => finite(per(r).valueLoss) }] },
  {
    id: 'grad', title: 'Gradient norm before clipping', series: [
      { key: 'gA', label: 'Actor', get: (r) => finite(per(r).actorGradNorm) },
      { key: 'gC', label: 'Critic', get: (r) => finite(per(r).criticGradNorm) },
    ],
  },
  {
    id: 'logstd', title: 'Action log std', series: ['Roll', 'Pitch', 'Yaw', 'Throttle'].map((label, k) => ({ key: `ls${k}`, label, get: (r) => finite(per(r).logStd?.[k]) })),
  },
  { id: 'reward', title: 'Reward per step', series: [{ key: 'rps', label: 'Reward', get: (r) => finite(per(r).rewardPerStep) }] },
  { id: 'sps', title: 'Throughput', unit: 'decisions/s', series: [{ key: 'sps', label: 'Decisions/s', get: (r) => finite(r.sps) }] },
  {
    id: 'itms', title: 'Iteration time', unit: 'ms', series: [
      { key: 'wall', label: 'Wall clock', get: (r, _c, p) => (Number.isFinite(per(r).iterMs) ? per(r).iterMs : p ? 1000 * (finite(r.elapsed) - finite(p.elapsed)) : NaN) },
      { key: 'gpu', label: 'GPU', get: (r) => finite(per(r).gpuMs) },
    ],
  },
];

export const ALL_SERIES = CHARTS.flatMap((c) => c.series);

/** Growable Float64Array. */
class Column {
  constructor() { this.a = new Float64Array(256); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new Float64Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  get(i) { return this.a[i]; }
}

/** Iteration records and every series as columns, plus EMA-smoothed copies for the current smoothing weight. */
export class Store {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.records = [];
    this.iters = new Column();
    this.raw = new Map(ALL_SERIES.map((s) => [s.key, new Column()]));
    this.sm = new Map(ALL_SERIES.map((s) => [s.key, new Column()]));
    this.ema = new Map();
    this.weight = 0;
  }

  get length() { return this.records.length; }
  get last() { return this.records[this.records.length - 1] ?? null; }

  /**
   * The event stream URL, always with a resume point: with an empty store the server still backfills every iteration pushed
   * while the page was loading (append drops duplicates). A reconnect resends Last-Event-ID, which the server prefers.
   */
  eventsUrl() { return `/api/events?after=${this.last?.iteration ?? -1}`; }

  /** Adds a record; ignores one that is not newer than the last. Returns true when added. */
  append(rec) {
    if (!rec || !Number.isFinite(rec.iteration)) return false;
    const prev = this.last;
    if (prev && rec.iteration <= prev.iteration) return false;
    const i = this.records.length;
    this.records.push(rec);
    this.iters.push(rec.iteration);
    for (const s of ALL_SERIES) {
      const col = this.raw.get(s.key);
      const before = i > 0 ? col.get(i - 1) : NaN;
      let v;
      try { v = s.get(rec, this.ctx, prev, before); } catch { v = NaN; }
      col.push(Number.isFinite(v) ? v : NaN);
      this.smoothOne(s, i);
    }
    return true;
  }

  /** Debiased EMA (as TensorBoard draws it): NaN values are skipped and keep their gap. */
  smoothOne(s, i) {
    const v = this.raw.get(s.key).get(i);
    const out = this.sm.get(s.key);
    if (s.smooth === false || this.weight <= 0) { out.push(v); return; }
    let st = this.ema.get(s.key);
    if (!st) { st = { acc: 0, n: 0 }; this.ema.set(s.key, st); }
    if (Number.isNaN(v)) { out.push(NaN); return; }
    st.acc = st.acc * this.weight + (1 - this.weight) * v;
    st.n++;
    out.push(st.acc / (1 - this.weight ** st.n));
  }

  /** Recomputes the smoothed columns for weight 0 (raw) .. 0.999. */
  setSmoothing(weight) {
    const w = Math.min(Math.max(Number(weight) || 0, 0), 0.999);
    if (w === this.weight) return;
    this.weight = w;
    this.ema.clear();
    for (const s of ALL_SERIES) {
      this.sm.set(s.key, new Column());
      for (let i = 0; i < this.records.length; i++) this.smoothOne(s, i);
    }
  }

  /** Index of the first record with iteration >= it (length when none). */
  lowerBound(it) {
    const a = this.iters.a;
    let lo = 0, hi = this.iters.n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid] < it) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** Index of the record whose iteration is nearest `it`, or -1 when empty. */
  nearest(it) {
    const n = this.iters.n;
    if (n === 0) return -1;
    const k = this.lowerBound(it);
    if (k === 0) return 0;
    if (k >= n) return n - 1;
    return it - this.iters.a[k - 1] <= this.iters.a[k] - it ? k - 1 : k;
  }

  value(key, i, smoothed = true) {
    return (smoothed ? this.sm : this.raw).get(key)?.get(i) ?? NaN;
  }
}

/** Per pixel column between index a and b (inclusive): min and max of raw, last smoothed, and the x of the column. */
export function decimate(iters, raw, sm, a, b, x0, x1, px) {
  const cols = [];
  const span = x1 - x0 || 1;
  let cur = null;
  for (let i = a; i <= b; i++) {
    const c = Math.floor(((iters[i] - x0) / span) * px);
    if (!cur || cur.c !== c) { cur = { c, it: iters[i], lo: Infinity, hi: -Infinity, s: NaN, i }; cols.push(cur); }
    const r = raw[i];
    if (!Number.isNaN(r)) { if (r < cur.lo) cur.lo = r; if (r > cur.hi) cur.hi = r; }
    if (!Number.isNaN(sm[i])) { cur.s = sm[i]; cur.it = iters[i]; cur.i = i; }
  }
  return cols;
}

/** About `count` round tick values covering lo..hi. */
export function niceTicks(lo, hi, count = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi === lo) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
  const raw = (hi - lo) / Math.max(count, 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out = [];
  // Steps below the float resolution of the values would never move v; the cap guards any other degenerate range.
  if (step <= Math.max(Math.abs(lo), Math.abs(hi)) * 1e-11) return [lo];
  const first = Math.ceil(lo / step);
  for (let k = 0; k < 200; k++) {
    const v = (first + k) * step;
    if (v > hi + step * 1e-9) break;
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return out;
}

/** Decade ticks (log10 space values) covering lo..hi given in log10. */
export function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
    if (e >= lo - 1e-9 && e <= hi + 1e-9) out.push(e);
    if (hi - lo < 3) for (const m of [2, 5]) { const v = e + Math.log10(m); if (v >= lo && v <= hi) out.push(v); }
  }
  return out.sort((a, b) => a - b);
}

/** Short readable number: 1.23M, 45.6k, 0.0123, 3.2e-5. */
export function fmt(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toPrecision(digits)}G`;
  if (a >= 1e6) return `${(v / 1e6).toPrecision(digits)}M`;
  if (a >= 1e4) return `${(v / 1e3).toPrecision(digits)}k`;
  if (a === 0) return '0';
  if (a < 1e-3) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  return String(Number(v.toPrecision(digits)));
}

/** h:mm:ss or m:ss for seconds. */
export function clock(s) {
  if (!Number.isFinite(s)) return '–';
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}
