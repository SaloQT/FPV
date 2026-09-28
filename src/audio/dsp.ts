/** Pure audio maths (no WebAudio types) so every rule here is unit-tested in Node. */

export const SPEED_OF_SOUND = 343;
export const TWO_PI = Math.PI * 2;
/** Tri-blade props and 14-pole (7 pole pair) 12N motors: the 5 inch freestyle standard. */
export const BLADES = 3;
export const POLE_PAIRS = 7;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** One-pole smoothing factor for time constant `tau` at step `dt` (1 = no smoothing). */
export function smoothingAlpha(dt: number, tau: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

// ───────────────────────────── Propagation ─────────────────────────────

const MAX_RADIAL_MACH = 0.9;

/** Pitch ratio heard from a moving source: `vRadial` is the source speed toward the listener (m/s, negative = receding). */
export function dopplerFactor(vRadial: number, c = SPEED_OF_SOUND): number {
  const v = clamp(vRadial, -MAX_RADIAL_MACH * c, MAX_RADIAL_MACH * c);
  return c / (c - v);
}

/** Speed of a source at p with velocity v toward a stationary listener at l (positive when closing). */
export function radialVelocity(
  px: number, py: number, pz: number, vx: number, vy: number, vz: number, lx: number, ly: number, lz: number,
): number {
  const dx = lx - px, dy = ly - py, dz = lz - pz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return d < 1e-6 ? 0 : (vx * dx + vy * dy + vz * dz) / d;
}

// ISO 9613-1 atmospheric absorption, 20 C, 70 % relative humidity.
const ABSORB_HZ = [125, 250, 500, 1000, 2000, 4000, 8000];
const ABSORB_DB_KM = [0.4, 1.3, 2.8, 5.0, 9.0, 22.9, 76.6];
const LOG_HZ = ABSORB_HZ.map(Math.log);
const LOG_ABSORB = ABSORB_DB_KM.map(Math.log);
/** A one-pole-ish low-pass is 3 dB down at its cutoff and ~12 dB down an octave above, so the cutoff sits at the 6 dB point. */
const ABSORB_KNEE_DB = 6;
export const MIN_CUTOFF_HZ = 200;
export const MAX_CUTOFF_HZ = 20000;

/** Low-pass cutoff (Hz) that mimics air absorption over `distanceM`: the frequency at which absorption reaches 6 dB. */
export function airAbsorptionCutoff(distanceM: number): number {
  const target = Math.log((ABSORB_KNEE_DB * 1000) / Math.max(distanceM, 1));
  const n = LOG_ABSORB.length;
  let f: number;
  if (target <= LOG_ABSORB[0]) return MIN_CUTOFF_HZ;
  if (target >= LOG_ABSORB[n - 1]) {
    const slope = (LOG_HZ[n - 1] - LOG_HZ[n - 2]) / (LOG_ABSORB[n - 1] - LOG_ABSORB[n - 2]);
    f = Math.exp(LOG_HZ[n - 1] + (target - LOG_ABSORB[n - 1]) * slope);
  } else {
    let i = 0;
    while (target >= LOG_ABSORB[i + 1]) i++;
    const t = (target - LOG_ABSORB[i]) / (LOG_ABSORB[i + 1] - LOG_ABSORB[i]);
    f = Math.exp(LOG_HZ[i] + t * (LOG_HZ[i + 1] - LOG_HZ[i]));
  }
  return clamp(f, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ);
}

// ───────────────────────────── Motor/prop model ─────────────────────────────

export function mechanicalFrequency(omega: number): number {
  return omega / TWO_PI;
}

/** Blade-pass frequency in Hz for a rotor turning at `omega` rad/s. */
export function bladePassFrequency(omega: number, blades = BLADES): number {
  return (blades * omega) / TWO_PI;
}

/** Electrical (commutation) frequency in Hz: pole pairs times mechanical rev/s. */
export function electricalFrequency(omega: number, polePairs = POLE_PAIRS): number {
  return (polePairs * omega) / TWO_PI;
}

/** Thrust-like loudness 0..1 of one motor: (omega / omegaMax)^exponent. */
export function motorLoudness(omega: number, omegaMax: number, exponent = 2.2): number {
  return Math.pow(clamp01(omega / omegaMax), exponent);
}

/** Relative amplitude of the h-th harmonic of the mechanical frequency (h = 1 is the once-per-rev imbalance). */
export function motorHarmonicAmplitude(h: number, blades = BLADES, polePairs = POLE_PAIRS): number {
  let a = h === 1 ? 0.05 : 0.02 / Math.sqrt(h);
  if (h % blades === 0) a += 1 / Math.pow(h / blades, 0.9);
  if (h % polePairs === 0) a += 0.3 / Math.pow(h / polePairs, 1.2);
  return a;
}

// ───────────────────────────── Band-limited wavetables ─────────────────────────────

/**
 * Mip-mapped single-cycle tables. Level l serves fundamentals in [fMin*2^l, fMin*2^(l+1)) and holds only the
 * harmonics that stay below Nyquist for the top of that range, so reading it can never alias.
 */
export interface WavetableSet {
  /** Samples per cycle; each level is followed by one guard sample (a copy of sample 0) for interpolation. */
  readonly size: number;
  readonly levels: number;
  readonly fMin: number;
  /** Highest fundamental the set is alias-free for. */
  readonly fMax: number;
  /** Number of harmonics stored in each level. */
  readonly harmonics: Int32Array;
  readonly data: Float32Array;
}

export interface WavetableOptions {
  size?: number;
  fMin?: number;
  levels?: number;
  /** Fraction of Nyquist the highest stored partial may reach. */
  guard?: number;
}

/** How many harmonics of `f0` fit below `guard * Nyquist`, capped at `cap`. */
export function harmonicLimit(f0: number, sampleRate: number, cap: number, guard = 0.95): number {
  return Math.max(0, Math.min(cap, Math.floor((guard * 0.5 * sampleRate) / f0)));
}

/** Deterministic quasi-random phase (0..1 cycles) per harmonic: keeps the crest factor low without random state. */
function harmonicPhase(h: number): number {
  const x = h * h * 0.1234567 + h * 0.6180339887;
  return x - Math.floor(x);
}

export function buildWavetableSet(amp: (h: number) => number, sampleRate: number, opts: WavetableOptions = {}): WavetableSet {
  const size = opts.size ?? 4096;
  const fMin = opts.fMin ?? 30;
  const levels = opts.levels ?? 6;
  const guard = opts.guard ?? 0.95;
  const stride = size + 1;
  const mask = size - 1;
  const sine = new Float32Array(size);
  for (let i = 0; i < size; i++) sine[i] = Math.sin((TWO_PI * i) / size);
  const harmonics = new Int32Array(levels);
  const data = new Float32Array(levels * stride);
  for (let l = 0; l < levels; l++) {
    const count = harmonicLimit(fMin * 2 ** (l + 1), sampleRate, size >> 3, guard);
    harmonics[l] = count;
    const base = l * stride;
    for (let h = 1; h <= count; h++) {
      const a = amp(h);
      const shift = Math.round(harmonicPhase(h) * size);
      for (let i = 0; i < size; i++) data[base + i] += a * sine[(h * i + shift) & mask];
    }
    data[base + size] = data[base];
  }
  let peak = 0;
  for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(data[i]));
  const k = peak > 0 ? 1 / peak : 1;
  for (let i = 0; i < data.length; i++) data[i] *= k;
  return { size, levels, fMin, fMax: fMin * 2 ** levels, harmonics, data };
}

/** Odd-symmetric soft clipper sampled over [-1, 1]; pair it with a 0.5 input gain so small signals pass at unity. */
export function softClipCurve(points = 2049): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = Math.tanh(2 * ((2 * i) / (points - 1) - 1));
  return curve;
}

/** Direct DFT of one table cycle into PeriodicWave-style cosine/sine coefficients (index 0, DC, stays 0). */
export function tableSpectrum(data: Float32Array, offset: number, size: number, count: number): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(count + 1);
  const imag = new Float32Array(count + 1);
  const mask = size - 1;
  const quarter = size >> 2;
  const sine = new Float32Array(size);
  for (let i = 0; i < size; i++) sine[i] = Math.sin((TWO_PI * i) / size);
  for (let k = 1; k <= count; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < size; i++) {
      const j = (k * i) & mask;
      re += data[offset + i] * sine[(j + quarter) & mask];
      im += data[offset + i] * sine[j];
    }
    real[k] = (2 * re) / size;
    imag[k] = (2 * im) / size;
  }
  return { real, imag };
}
