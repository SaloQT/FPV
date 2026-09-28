/** Radix-2 FFT for the offline checks and the dev spectrogram (not used at runtime). */
import { TWO_PI } from './dsp';

const hannCache = new Map<number, Float32Array>();

function hann(n: number): Float32Array {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / n);
    hannCache.set(n, w);
  }
  return w;
}

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TWO_PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Hann-windowed amplitude spectrum of x[start, start + n) in bins 0..n/2-1; a bin-centred unit sine reads about 1. */
export function magnitudeSpectrum(x: ArrayLike<number>, start: number, n: number): Float32Array {
  if (n < 2 || (n & (n - 1)) !== 0) throw new RangeError('fft size must be a power of two');
  const re = new Float64Array(n), im = new Float64Array(n);
  const w = hann(n);
  for (let i = 0; i < n; i++) re[i] = (x[start + i] ?? 0) * w[i];
  fftInPlace(re, im);
  const out = new Float32Array(n / 2);
  // The Hann window sums to n / 2, so 4 / n restores the amplitude of a sine.
  for (let k = 0; k < n / 2; k++) out[k] = (Math.hypot(re[k], im[k]) * 4) / n;
  return out;
}

/** Index of the largest bin in [lo, hi], refined to a fractional bin by parabolic interpolation. */
export function peakBin(spectrum: ArrayLike<number>, lo: number, hi: number): number {
  let best = lo;
  for (let k = lo; k <= hi; k++) if (spectrum[k] > spectrum[best]) best = k;
  if (best <= 0 || best >= spectrum.length - 1) return best;
  const a = spectrum[best - 1], b = spectrum[best], c = spectrum[best + 1];
  const denom = a - 2 * b + c;
  return denom === 0 ? best : best + (0.5 * (a - c)) / denom;
}
