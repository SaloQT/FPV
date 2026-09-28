/** Small signal-analysis helpers for the offline audio checks (Node tests and the headless dev page). */
import { TWO_PI } from './dsp';

export function rms(x: ArrayLike<number>, start = 0, end = x.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return end > start ? Math.sqrt(s / (end - start)) : 0;
}

export function peakAbs(x: ArrayLike<number>, start = 0, end = x.length): number {
  let m = 0;
  for (let i = start; i < end; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}

/** Boxcar average then keep every `factor`-th sample: a cheap decimator for looking at the low end of a spectrum. */
export function decimate(x: ArrayLike<number>, factor: number): Float32Array {
  const n = Math.floor(x.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += x[i * factor + k];
    out[i] = s / factor;
  }
  return out;
}

/** Amplitude of the sinusoid at `freq` in x[start, end), measured with a Hann window (a unit sine reads ~1). */
export function toneAmplitude(x: ArrayLike<number>, sampleRate: number, freq: number, start = 0, end = x.length): number {
  const n = end - start;
  const w = (TWO_PI * freq) / sampleRate;
  const c = Math.cos(w), s = Math.sin(w);
  let re = 0, im = 0, wsum = 0;
  let cr = 1, ci = 0;
  for (let i = 0; i < n; i++) {
    const win = 0.5 - 0.5 * Math.cos((TWO_PI * i) / (n - 1));
    const v = x[start + i] * win;
    re += v * cr;
    im -= v * ci;
    wsum += win;
    const t = cr * c - ci * s;
    ci = cr * s + ci * c;
    cr = t;
  }
  return (2 * Math.hypot(re, im)) / wsum;
}

/** Strongest tone between fLo and fHi, scanning in `stepHz` steps. */
export function findPeak(
  x: ArrayLike<number>, sampleRate: number, fLo: number, fHi: number, stepHz: number, start = 0, end = x.length,
): { freq: number; amp: number } {
  let best = { freq: fLo, amp: 0 };
  for (let f = fLo; f <= fHi; f += stepHz) {
    const a = toneAmplitude(x, sampleRate, f, start, end);
    if (a > best.amp) best = { freq: f, amp: a };
  }
  return best;
}

/** Mean tone amplitude over [fLo, fHi], for comparing band levels (noise colour, low-pass behaviour). */
export function bandLevel(x: ArrayLike<number>, sampleRate: number, fLo: number, fHi: number, bins = 16, start = 0, end = x.length): number {
  let s = 0;
  for (let k = 0; k < bins; k++) {
    const a = toneAmplitude(x, sampleRate, fLo + ((fHi - fLo) * (k + 0.5)) / bins, start, end);
    s += a * a;
  }
  return Math.sqrt(s / bins);
}
