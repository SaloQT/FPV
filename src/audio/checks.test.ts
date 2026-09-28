import { describe, expect, it } from 'vitest';
import { CRASH_AT, dbfs, expectedBladePassHz, level, mono } from './checks';

describe('expectedBladePassHz', () => {
  it('is silent while the props are stopped and after the crash', () => {
    expect(expectedBladePassHz(0.5)).toBe(0);
    expect(expectedBladePassHz(1)).toBe(0);
    expect(expectedBladePassHz(CRASH_AT + 0.1)).toBe(0);
  });

  it('follows the rpm ramp, and sounds higher approaching the pilot than receding from it', () => {
    expect(expectedBladePassHz(1.5)).toBeGreaterThan(0);
    const approaching = expectedBladePassHz(6), receding = expectedBladePassHz(8);
    expect(approaching / receding).toBeGreaterThan(1.1);
    expect(approaching / receding).toBeLessThan(1.2);
  });
});

describe('level helpers', () => {
  it('reads full-scale sine as -3 dB rms and 0 dB peak, and averages the channels', () => {
    const sr = 1000;
    const left = new Float32Array(sr), right = new Float32Array(sr);
    for (let i = 0; i < sr; i++) left[i] = right[i] = Math.sin((2 * Math.PI * 50 * i) / sr);
    const m = mono({ left, right, sampleRate: sr, synth: 'worklet', frameSeconds: 0 });
    const l = level(m, sr, 0, 1);
    expect(l.rmsDb).toBeCloseTo(-3.01, 1);
    expect(l.peakDb).toBeCloseTo(0, 1);
    expect(dbfs(0)).toBeLessThan(-100);
  });
});
