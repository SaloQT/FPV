/**
 * Surrogate-assisted prop search (Bayesian optimisation). Every real evaluation (the bench, and optionally a brain flight)
 * is costly next to a surrogate guess, so a Gaussian process learns the design-to-score map from the evaluations so far and
 * picks the next designs to try: it scores thousands of random candidates by expected improvement and only the best few get
 * a real evaluation. The process is deterministic for a given seed.
 *
 * Method: Jones, Schonlau and Welch, "Efficient global optimization of expensive black-box functions", J. Global
 * Optimization 13, 1998 (expected improvement); Rasmussen and Williams, "Gaussian Processes for Machine Learning", 2006.
 */
import { Rng } from '../sim/math3d';
import { bemt, rootStress } from './bemt';
import { benchProp, type BenchReport } from './bench';
import { DEFAULT_PROP, designFromVector, PROP_VARS, vectorFromDesign, type PropDesign, type PropVar } from './design';

/** Tip speed limit as a Mach number at full throttle (the blade tip should stay well under the speed of sound). */
export const MACH_LIMIT = 0.75;
/** Allowed root stress as a multiple of the stock prop's, which is known to survive crashes and full throttle. */
export const STRESS_MARGIN = 1.25;

export interface Metrics {
  bench: BenchReport;
  /** Root stress at full throttle, Pa. */
  stress: number;
  /** Mean brain flight score, s (lower is faster), or NaN when no flight was run. */
  flightScore: number;
  /** Mean battery drawn in the brain flights, mAh, or NaN. */
  flightMah: number;
}

export interface Weights {
  /** Hover efficiency, g per watt. */
  efficiency: number;
  /** Full-throttle thrust to weight. */
  thrustToWeight: number;
  /** Hover endurance. */
  flightTime: number;
  /** Brain lap time (needs a flight evaluator). */
  lapTime: number;
}

export const DEFAULT_WEIGHTS: Weights = { efficiency: 1, thrustToWeight: 1, flightTime: 1, lapTime: 2 };

/** Bench plus root stress for a design; the flight numbers are filled by the caller when a brain is used. */
export function measure(d: PropDesign): Metrics {
  const bench = benchProp(d);
  const omega = bench.tipSpeed / (d.diameter * 0.5);
  const thrust = bemt(d, omega, 0).thrust;
  return { bench, stress: rootStress(d, omega, thrust), flightScore: NaN, flightMah: NaN };
}

/** Constraint violation: 0 when the design is legal, else how far over the limits it is (each as a fraction). */
let stockStress = NaN;
export function stressLimit(): number {
  if (!Number.isFinite(stockStress)) stockStress = measure(DEFAULT_PROP).stress;
  return stockStress * STRESS_MARGIN;
}

export function violation(m: Metrics): number {
  return Math.max(0, m.bench.tipMach / MACH_LIMIT - 1) + Math.max(0, m.stress / stressLimit() - 1);
}

/**
 * The score to minimise: the weighted sum of log ratios against a reference (the default prop), so a 10% gain in any
 * objective counts the same, plus a steep penalty for breaking a constraint.
 */
export function cost(m: Metrics, ref: Metrics, w: Weights): number {
  let c = 0;
  c -= w.efficiency * Math.log(m.bench.gramsPerWattHover / ref.bench.gramsPerWattHover);
  c -= w.thrustToWeight * Math.log(m.bench.thrustToWeight / ref.bench.thrustToWeight);
  c -= w.flightTime * Math.log(m.bench.hoverMinutes / ref.bench.hoverMinutes);
  if (Number.isFinite(m.flightScore) && Number.isFinite(ref.flightScore)) c += w.lapTime * Math.log(m.flightScore / ref.flightScore);
  return c + 20 * violation(m);
}

// ---- Gaussian process ----

/** Matern 5/2 kernel on scaled distance. */
function kern(r: number): number {
  const s = Math.sqrt(5) * r;
  return (1 + s + (s * s) / 3) * Math.exp(-s);
}

function dist(a: readonly number[], b: readonly number[], len: number): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s) / len;
}

/** Lower Cholesky factor of a symmetric positive definite matrix (row-major n x n), or null if it is not positive definite. */
function cholesky(a: Float64Array, n: number): Float64Array | null {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * n + j];
      for (let k = 0; k < j; k++) s -= l[i * n + k] * l[j * n + k];
      if (i === j) {
        if (s <= 1e-12) return null;
        l[i * n + i] = Math.sqrt(s);
      } else l[i * n + j] = s / l[j * n + j];
    }
  }
  return l;
}

function solveLower(l: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * n + k] * y[k];
    y[i] = s / l[i * n + i];
  }
  return y;
}

function solveUpper(l: Float64Array, n: number, y: ArrayLike<number>): Float64Array {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= l[k * n + i] * x[k];
    x[i] = s / l[i * n + i];
  }
  return x;
}

export class GaussianProcess {
  private l!: Float64Array;
  private alpha!: Float64Array;
  private mean = 0;
  private scale = 1;
  private len = 0.5;
  private n = 0;
  private logLik = -Infinity;

  constructor(private readonly noise = 1e-4) {}

  /** Fits to inputs `x` (each in the unit cube) and scores `y`, choosing the length scale by marginal likelihood. */
  fit(x: readonly (readonly number[])[], y: readonly number[]): void {
    this.n = x.length;
    this.xs = x;
    this.mean = y.reduce((a, b) => a + b, 0) / y.length;
    const sd = Math.sqrt(y.reduce((a, b) => a + (b - this.mean) ** 2, 0) / y.length);
    this.scale = sd > 1e-9 ? sd : 1;
    const z = y.map((v) => (v - this.mean) / this.scale);
    this.logLik = -Infinity;
    for (const len of [0.25, 0.4, 0.6, 0.9, 1.4]) this.tryLength(len, z);
  }

  private xs: readonly (readonly number[])[] = [];

  private tryLength(len: number, z: readonly number[]): void {
    const n = this.n;
    const k = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        const v = kern(dist(this.xs[i], this.xs[j], len)) + (i === j ? this.noise : 0);
        k[i * n + j] = v;
        k[j * n + i] = v;
      }
    }
    const l = cholesky(k, n);
    if (!l) return;
    const y = solveLower(l, n, z);
    const alpha = solveUpper(l, n, y);
    let logDet = 0;
    for (let i = 0; i < n; i++) logDet += Math.log(l[i * n + i]);
    let quad = 0;
    for (let i = 0; i < n; i++) quad += z[i] * alpha[i];
    const ll = -0.5 * quad - logDet;
    if (ll > this.logLik) {
      this.logLik = ll;
      this.l = l;
      this.alpha = alpha;
      this.len = len;
    }
  }

  get lengthScale(): number { return this.len; }

  /** Predicted score and its standard deviation at `q`. */
  predict(q: readonly number[]): { mean: number; sd: number } {
    const n = this.n;
    const ks = new Float64Array(n);
    let m = 0;
    for (let i = 0; i < n; i++) {
      ks[i] = kern(dist(q, this.xs[i], this.len));
      m += ks[i] * this.alpha[i];
    }
    const v = solveLower(this.l, n, ks);
    let vv = 0;
    for (let i = 0; i < n; i++) vv += v[i] * v[i];
    return { mean: this.mean + m * this.scale, sd: Math.sqrt(Math.max(1e-12, 1 - vv)) * this.scale };
  }
}

function normCdf(x: number): number {
  // Abramowitz and Stegun 7.1.26 on erf.
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Expected improvement over `best` (lower is better). */
export function expectedImprovement(mean: number, sd: number, best: number): number {
  const z = (best - mean) / sd;
  return (best - mean) * normCdf(z) + sd * normPdf(z);
}

// ---- Search ----

export interface Evaluated {
  id: number;
  /** Optimiser variables in real units (PROP_VARS order). */
  x: number[];
  metrics: Metrics;
  cost: number;
  /** Surrogate guess made before this evaluation (NaN for the starting designs). */
  predicted: number;
  predictedSd: number;
}

export interface SearchOptions {
  seed?: number;
  /** Starting designs before the surrogate takes over (the default prop is always one of them). */
  initial?: number;
  /** Real evaluations in total. */
  budget?: number;
  /** Designs evaluated per surrogate fit. */
  batch?: number;
  /** Random candidates the surrogate screens per batch. */
  screened?: number;
  weights?: Weights;
  /** Variables the search may change; others stay at the default prop. Default: all but the airfoil. */
  free?: readonly PropVar['key'][];
  /** Adds the brain flight numbers to a measured design. */
  flight?: (d: PropDesign, m: Metrics) => Metrics;
  /** Called after every real evaluation. */
  onEval?: (e: Evaluated, done: number, budget: number) => void;
}

/** The airfoil numbers are a material property here, not a design choice, so the search leaves them alone. */
export const DESIGN_KEYS: readonly PropVar['key'][] = ['diameter', 'pitch', 'pitchTilt', 'blades', 'chordRatio', 'chordTaper', 'thicknessRatio'];

export interface SearchResult {
  reference: Metrics;
  evaluated: Evaluated[];
  best: Evaluated;
  weights: Weights;
  /** Root mean square error of the surrogate's guesses against the real scores. */
  surrogateRmse: number;
  /** Correlation between the surrogate's guesses and the real scores. */
  surrogateCorr: number;
}

export function runSearch(opts: SearchOptions = {}): SearchResult {
  const rng = new Rng(opts.seed ?? 1);
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const free = new Set(opts.free ?? DESIGN_KEYS);
  const budget = opts.budget ?? 120;
  const initial = Math.min(budget, opts.initial ?? 24);
  const batch = opts.batch ?? 4;
  const screened = opts.screened ?? 3000;
  const base = vectorFromDesign(DEFAULT_PROP);
  const dims = PROP_VARS.map((v, i) => i).filter((i) => free.has(PROP_VARS[i].key));
  const toUnit = (x: readonly number[]) => dims.map((i) => (x[i] - PROP_VARS[i].min) / (PROP_VARS[i].max - PROP_VARS[i].min));
  const fromUnit = (u: readonly number[]) => {
    const x = base.slice();
    dims.forEach((i, k) => { x[i] = PROP_VARS[i].min + Math.min(1, Math.max(0, u[k])) * (PROP_VARS[i].max - PROP_VARS[i].min); });
    // Snap through the design so integers and ranges are applied.
    return vectorFromDesign(designFromVector(x));
  };
  const full = (d: PropDesign): Metrics => {
    const m = measure(d);
    return opts.flight ? opts.flight(d, m) : m;
  };

  const reference = full(DEFAULT_PROP);
  const evaluated: Evaluated[] = [];
  const evaluate = (x: number[], predicted: number, predictedSd: number) => {
    const d = designFromVector(x, DEFAULT_PROP, `p${evaluated.length}`);
    const m = full(d);
    const e: Evaluated = { id: evaluated.length, x: vectorFromDesign(d), metrics: m, cost: cost(m, reference, w), predicted, predictedSd };
    evaluated.push(e);
    opts.onEval?.(e, evaluated.length, budget);
    return e;
  };

  // Starting designs: the default prop, then a Latin hypercube over the free variables.
  evaluate(base, NaN, NaN);
  const nInit = initial - 1;
  const cols = dims.map(() => {
    const perm = Array.from({ length: nInit }, (_, i) => i);
    for (let i = nInit - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    return perm;
  });
  for (let i = 0; i < nInit; i++) evaluate(fromUnit(dims.map((_, k) => (cols[k][i] + rng.next()) / nInit)), NaN, NaN);

  const gp = new GaussianProcess();
  while (evaluated.length < budget) {
    const xs = evaluated.map((e) => toUnit(e.x));
    gp.fit(xs, evaluated.map((e) => e.cost));
    const best = Math.min(...evaluated.map((e) => e.cost));
    const elite = [...evaluated].sort((a, b) => a.cost - b.cost).slice(0, 5).map((e) => toUnit(e.x));
    // Candidates: half uniform over the box, half near the best designs so far.
    const cands: number[][] = [];
    for (let i = 0; i < screened; i++) {
      if (i % 2 === 0) cands.push(dims.map(() => rng.next()));
      else {
        const c = elite[Math.floor(rng.next() * elite.length)];
        const s = 0.04 + 0.16 * rng.next();
        cands.push(c.map((v) => Math.min(1, Math.max(0, v + s * gauss(rng)))));
      }
    }
    const scored = cands.map((u) => {
      const p = gp.predict(u);
      return { u, p, ei: expectedImprovement(p.mean, p.sd, best) };
    }).sort((a, b) => b.ei - a.ei);
    // Greedy pick of a batch that is not clumped together.
    const picked: typeof scored = [];
    for (const s of scored) {
      if (picked.length >= Math.min(batch, budget - evaluated.length)) break;
      if (picked.every((q) => dist(q.u, s.u, 1) > 0.08)) picked.push(s);
    }
    for (const s of picked) evaluate(fromUnit(s.u), s.p.mean, s.p.sd);
  }

  const guessed = evaluated.filter((e) => Number.isFinite(e.predicted));
  let se = 0;
  for (const e of guessed) se += (e.predicted - e.cost) ** 2;
  const rmse = guessed.length ? Math.sqrt(se / guessed.length) : NaN;
  return { reference, evaluated, best: evaluated.reduce((a, b) => (b.cost < a.cost ? b : a)), weights: w, surrogateRmse: rmse, surrogateCorr: corr(guessed.map((e) => e.predicted), guessed.map((e) => e.cost)) };
}

function gauss(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, rng.next()))) * Math.cos(2 * Math.PI * rng.next());
}

function corr(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(Math.max(1e-18, saa * sbb));
}
