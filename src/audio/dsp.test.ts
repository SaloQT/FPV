import { describe, expect, it } from 'vitest';
import { peakAbs } from './analysis';
import {
  airAbsorptionCutoff, bladePassFrequency, buildWavetableSet, dopplerFactor, electricalFrequency, harmonicLimit, motorHarmonicAmplitude,
  motorLoudness, radialVelocity, smoothstep, softClipCurve, SPEED_OF_SOUND, tableSpectrum, TWO_PI,
} from './dsp';

describe('doppler', () => {
  it('is unity at rest and follows c/(c - v)', () => {
    expect(dopplerFactor(0)).toBe(1);
    expect(dopplerFactor(20)).toBeCloseTo(SPEED_OF_SOUND / (SPEED_OF_SOUND - 20), 12);
    expect(dopplerFactor(-20)).toBeCloseTo(SPEED_OF_SOUND / (SPEED_OF_SOUND + 20), 12);
  });

  it('a 30 m/s fly-by drops the pitch by about 16 percent from approach to recede', () => {
    const drop = dopplerFactor(-30) / dopplerFactor(30);
    expect(drop).toBeCloseTo((SPEED_OF_SOUND - 30) / (SPEED_OF_SOUND + 30), 12);
    expect(drop).toBeGreaterThan(0.83);
    expect(drop).toBeLessThan(0.85);
  });

  it('stays finite for a source at or beyond the speed of sound', () => {
    expect(Number.isFinite(dopplerFactor(SPEED_OF_SOUND))).toBe(true);
    expect(dopplerFactor(1e6)).toBeCloseTo(10, 6);
  });

  it('radial velocity is the closing speed along the line of sight', () => {
    expect(radialVelocity(0, 0, 0, 10, 0, 0, 100, 0, 0)).toBeCloseTo(10, 12);
    expect(radialVelocity(0, 0, 0, -10, 0, 0, 100, 0, 0)).toBeCloseTo(-10, 12);
    expect(radialVelocity(0, 0, 0, 0, 0, 7, 100, 0, 0)).toBeCloseTo(0, 12);
    expect(radialVelocity(0, 0, 0, 3, 4, 0, 30, 40, 0)).toBeCloseTo(5, 12);
    expect(radialVelocity(5, 5, 5, 9, 9, 9, 5, 5, 5)).toBe(0);
  });
});

describe('air absorption', () => {
  it('reads the ISO table at the 6 dB point', () => {
    // 6 dB over 1.2 km is 5 dB/km, which the table gives at 1 kHz.
    expect(airAbsorptionCutoff(1200)).toBeCloseTo(1000, 3);
    // 6 dB over 262 m is 22.9 dB/km at 4 kHz.
    expect(airAbsorptionCutoff(6000 / 22.9)).toBeCloseTo(4000, 3);
  });

  it('never rises with distance and is bounded', () => {
    let prev = Infinity;
    for (let d = 0.5; d < 8000; d *= 1.15) {
      const f = airAbsorptionCutoff(d);
      expect(f).toBeLessThanOrEqual(prev + 1e-9);
      expect(f).toBeGreaterThanOrEqual(200);
      expect(f).toBeLessThanOrEqual(20000);
      prev = f;
    }
  });

  it('opens fully up close and closes to a few hundred Hz at kilometres', () => {
    expect(airAbsorptionCutoff(2)).toBe(20000);
    expect(airAbsorptionCutoff(100)).toBeGreaterThan(4000);
    expect(airAbsorptionCutoff(100)).toBeLessThan(9000);
    expect(airAbsorptionCutoff(5000)).toBeLessThan(400);
  });
});

describe('motor model helpers', () => {
  it('a 30k rpm rotor has a 1.5 kHz blade pass and a 3.5 kHz electrical frequency', () => {
    const omega = (30000 * TWO_PI) / 60;
    expect(bladePassFrequency(omega)).toBeCloseTo(1500, 6);
    expect(electricalFrequency(omega)).toBeCloseTo(3500, 6);
    expect(bladePassFrequency(omega, 2)).toBeCloseTo(1000, 6);
  });

  it('loudness is a monotonic power law clamped to 0..1', () => {
    expect(motorLoudness(0, 3000)).toBe(0);
    expect(motorLoudness(3000, 3000)).toBe(1);
    expect(motorLoudness(4000, 3000)).toBe(1);
    expect(motorLoudness(-5, 3000)).toBe(0);
    expect(motorLoudness(1500, 3000, 2)).toBeCloseTo(0.25, 12);
    expect(motorLoudness(2000, 3000)).toBeGreaterThan(motorLoudness(1000, 3000));
  });

  it('the blade-pass fundamental is the strongest harmonic', () => {
    const bp = motorHarmonicAmplitude(3);
    for (let h = 1; h < 200; h++) if (h !== 3) expect(motorHarmonicAmplitude(h)).toBeLessThan(bp);
    expect(motorHarmonicAmplitude(7)).toBeGreaterThan(motorHarmonicAmplitude(8));
    expect(motorHarmonicAmplitude(6)).toBeGreaterThan(motorHarmonicAmplitude(9));
  });
});

describe('harmonic limit', () => {
  it('truncates to what fits below Nyquist and respects the cap', () => {
    expect(harmonicLimit(1000, 48000, 1000, 1)).toBe(24);
    expect(harmonicLimit(1000, 48000, 1000, 0.95)).toBe(22);
    expect(harmonicLimit(1000, 48000, 10)).toBe(10);
    expect(harmonicLimit(30000, 48000, 10)).toBe(0);
  });
});

describe('band-limited wavetables', () => {
  const sr = 48000;
  const set = buildWavetableSet((h) => motorHarmonicAmplitude(h), sr);
  const stride = set.size + 1;

  function level(l: number): Float32Array {
    return set.data.subarray(l * stride, l * stride + set.size);
  }

  /** Amplitude of harmonic k of a table cycle (direct DFT bin, no FFT needed). */
  function bin(l: number, k: number): number {
    const t = level(l);
    let re = 0, im = 0;
    for (let i = 0; i < set.size; i++) {
      re += t[i] * Math.cos((TWO_PI * k * i) / set.size);
      im += t[i] * Math.sin((TWO_PI * k * i) / set.size);
    }
    return (2 * Math.hypot(re, im)) / set.size;
  }

  it('covers 30 Hz .. 1.92 kHz in octave levels', () => {
    expect(set.levels).toBe(6);
    expect(set.fMax).toBe(1920);
    expect(set.data.length).toBe(set.levels * stride);
  });

  it('is bounded, finite, DC free and has a matching guard sample', () => {
    for (let l = 0; l < set.levels; l++) {
      const t = level(l);
      let sum = 0;
      for (let i = 0; i < t.length; i++) {
        expect(Number.isFinite(t[i])).toBe(true);
        sum += t[i];
      }
      expect(Math.abs(sum / t.length)).toBeLessThan(1e-4);
      expect(peakAbs(t)).toBeLessThan(1.5);
      expect(peakAbs(t)).toBeGreaterThan(0.5);
      expect(set.data[l * stride + set.size]).toBe(t[0]);
    }
    expect(peakAbs(level(0))).toBeCloseTo(1, 5);
  });

  it('every stored partial stays below Nyquist for the top of its level', () => {
    for (let l = 0; l < set.levels; l++) {
      const fTop = set.fMin * 2 ** (l + 1);
      expect(set.harmonics[l] * fTop).toBeLessThan(sr / 2);
      expect(set.harmonics[l]).toBe(harmonicLimit(fTop, sr, set.size >> 3));
    }
    for (let l = 1; l < set.levels; l++) expect(set.harmonics[l]).toBeLessThanOrEqual(set.harmonics[l - 1]);
  });

  it('contains the harmonics up to the limit and nothing above it', () => {
    const l = 4;
    const top = set.harmonics[l];
    expect(top).toBeGreaterThan(20);
    const k = bin(l, 3) / motorHarmonicAmplitude(3);
    expect(bin(l, 6)).toBeCloseTo(k * motorHarmonicAmplitude(6), 3);
    expect(bin(l, 7)).toBeCloseTo(k * motorHarmonicAmplitude(7), 3);
    expect(bin(l, top)).toBeGreaterThan(0);
    for (let h = top + 1; h < top + 8; h++) expect(bin(l, h)).toBeLessThan(1e-4);
  });
});

describe('soft clip curve', () => {
  const curve = softClipCurve();
  it('is odd, monotonic, bounded and unity at small signal with a 0.5 input gain', () => {
    const n = curve.length;
    expect(curve[(n - 1) / 2]).toBeCloseTo(0, 12);
    for (let i = 0; i < n; i++) {
      expect(curve[i]).toBeCloseTo(-curve[n - 1 - i], 6);
      expect(Math.abs(curve[i])).toBeLessThan(1);
      if (i > 0) expect(curve[i]).toBeGreaterThan(curve[i - 1]);
    }
    const mid = (n - 1) / 2;
    const du = 2 / (n - 1);
    expect((curve[mid + 1] - curve[mid - 1]) / (2 * du) * 0.5).toBeCloseTo(1, 3);
  });
});

describe('smoothstep', () => {
  it('is 0 below, 1 above and 0.5 in the middle', () => {
    expect(smoothstep(1, 3, 0)).toBe(0);
    expect(smoothstep(1, 3, 4)).toBe(1);
    expect(smoothstep(1, 3, 2)).toBeCloseTo(0.5, 12);
  });
});

describe('table spectrum', () => {
  it('resynthesising the coefficients reproduces the table cycle', () => {
    const set = buildWavetableSet((h) => motorHarmonicAmplitude(h), 48000);
    const level = 3;
    const { real, imag } = tableSpectrum(set.data, level * (set.size + 1), set.size, set.harmonics[level]);
    let worst = 0;
    for (let i = 0; i < set.size; i += 37) {
      let y = 0;
      for (let k = 1; k < real.length; k++) {
        const a = (TWO_PI * k * i) / set.size;
        y += real[k] * Math.cos(a) + imag[k] * Math.sin(a);
      }
      worst = Math.max(worst, Math.abs(y - set.data[level * (set.size + 1) + i]));
    }
    expect(worst).toBeLessThan(2e-3);
    expect(real[0]).toBe(0);
    expect(imag[0]).toBe(0);
  });
});
