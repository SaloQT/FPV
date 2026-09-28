import { describe, expect, it } from 'vitest';
import { toneAmplitude } from './analysis';
import { TWO_PI } from './dsp';
import { magnitudeSpectrum, peakBin } from './fft';

function sine(n: number, sr: number, f: number, a = 1): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = a * Math.sin((TWO_PI * f * i) / sr);
  return x;
}

describe('magnitudeSpectrum', () => {
  it('reads the amplitude of a bin-centred sine and agrees with the naive DFT', () => {
    const sr = 48000, n = 2048;
    const f = (100 * sr) / n;
    const x = sine(n, sr, f, 0.5);
    const s = magnitudeSpectrum(x, 0, n);
    expect(s[100]).toBeCloseTo(0.5, 2);
    expect(s[100]).toBeCloseTo(toneAmplitude(x, sr, f), 2);
    expect(s[400]).toBeLessThan(0.001);
  });

  it('locates an off-bin tone to a fraction of a bin', () => {
    const sr = 48000, n = 4096;
    const f = 1234.5;
    const s = magnitudeSpectrum(sine(n, sr, f), 0, n);
    const bin = peakBin(s, 5, n / 2 - 2);
    expect(Math.abs((bin * sr) / n - f)).toBeLessThan(0.1 * (sr / n));
  });

  it('rejects sizes that are not a power of two and pads past the end with silence', () => {
    expect(() => magnitudeSpectrum(new Float32Array(100), 0, 100)).toThrow(RangeError);
    const s = magnitudeSpectrum(new Float32Array(10), 0, 16);
    expect(s).toHaveLength(8);
    expect(Math.max(...s)).toBe(0);
  });
});
