import { describe, expect, it } from 'vitest';
import { findPeak, peakAbs, rms, toneAmplitude } from './analysis';
import { addModalRing, CARBON_PLATE_MODES, renderClack, renderCrash, renderTick } from './sampleSynth';

const SR = 48000;

function windowRms(x: Float32Array, t0: number, t1: number): number {
  return rms(x.subarray(Math.round(t0 * SR), Math.round(t1 * SR)));
}

describe('modal ring', () => {
  it('rings at the plate modes and decays 60 dB in t60', () => {
    const x = new Float32Array(SR);
    addModalRing(x, SR, CARBON_PLATE_MODES, 0, 1);
    const len = 4800;
    for (const m of CARBON_PLATE_MODES) {
      const at = toneAmplitude(x, SR, m.freq, 0, len);
      expect(at).toBeGreaterThan(toneAmplitude(x, SR, m.freq * 1.37, 0, len) * 2);
    }
    const single = new Float32Array(SR);
    addModalRing(single, SR, [{ freq: 1000, t60: 0.2, amp: 1 }], 0, 1);
    const peakEarly = peakAbs(single.subarray(0, 480));
    const peakLate = peakAbs(single.subarray(Math.round(0.2 * SR), Math.round(0.2 * SR) + 480));
    expect(peakEarly / peakLate).toBeGreaterThan(300);
    expect(peakEarly / peakLate).toBeLessThan(3000);
  });

  it('starts at the requested time and never writes past the buffer', () => {
    const x = new Float32Array(1000);
    addModalRing(x, SR, [{ freq: 1000, t60: 5, amp: 1 }], 0.01, 1);
    expect(peakAbs(x.subarray(0, 480))).toBe(0);
    expect(peakAbs(x.subarray(500))).toBeGreaterThan(0);
    expect(x.length).toBe(1000);
  });
});

describe('one-shot renderers', () => {
  const crash = renderCrash(SR, 3);
  const clack = renderClack(SR, 4);
  const tick = renderTick(SR, 5);

  it('have the expected lengths and stay within full scale', () => {
    expect(crash.length).toBe(Math.round(1.1 * SR));
    expect(clack.length).toBe(Math.round(0.18 * SR));
    expect(tick.length).toBe(Math.round(0.045 * SR));
    expect(peakAbs(crash)).toBeCloseTo(0.95, 5);
    expect(peakAbs(clack)).toBeCloseTo(0.9, 5);
    expect(peakAbs(tick)).toBeCloseTo(0.9, 5);
    for (const b of [crash, clack, tick]) for (let i = 0; i < b.length; i++) expect(Number.isFinite(b[i])).toBe(true);
  });

  it('are deterministic per seed and differ between seeds', () => {
    expect(Array.from(renderCrash(SR, 3).subarray(0, 200))).toEqual(Array.from(crash.subarray(0, 200)));
    const other = renderCrash(SR, 9);
    let diff = 0;
    for (let i = 0; i < 2000; i++) diff += Math.abs(other[i] - crash[i]);
    expect(diff).toBeGreaterThan(1);
  });

  it('the crash is loud at the hit and dies away', () => {
    expect(windowRms(crash, 0, 0.03)).toBeGreaterThan(windowRms(crash, 0.6, 0.7) * 8);
    expect(windowRms(crash, 0.9, 1.1)).toBeLessThan(windowRms(crash, 0, 0.03) * 0.1);
    expect(crash[crash.length - 1]).toBeCloseTo(0, 2);
  });

  it('the crash carries carbon ringing and a low thud', () => {
    // Each hit is detuned by up to 7 percent, so look for the strongest line near each mode.
    const near = (f: number): number => findPeak(crash, SR, f * 0.92, f * 1.09, f * 0.004, 240, 4320).amp;
    expect(near(1200)).toBeGreaterThan(near(1200 * 1.6) * 2);
    expect(near(5100)).toBeGreaterThan(near(5100 * 1.45) * 2);
    expect(near(2900)).toBeGreaterThan(near(2900 * 1.25) * 0.8);
    expect(toneAmplitude(crash, SR, 80, 0, 4800)).toBeGreaterThan(toneAmplitude(crash, SR, 400, 0, 4800) * 10);
  });

  it('the tick is much shorter and higher than the crash', () => {
    const highShare = (b: Float32Array): number => toneAmplitude(b, SR, 4500, 0, b.length) / (toneAmplitude(b, SR, 400, 0, b.length) + 1e-9);
    expect(tick.length / SR).toBeLessThan(0.05);
    expect(windowRms(tick, 0.03, 0.045)).toBeLessThan(windowRms(tick, 0, 0.005) * 0.3);
    expect(highShare(tick)).toBeGreaterThan(highShare(crash));
  });
});
