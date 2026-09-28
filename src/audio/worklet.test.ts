import { describe, expect, it } from 'vitest';
import { bandLevel, findPeak, peakAbs, rms, toneAmplitude } from './analysis';
import { motorHarmonicAmplitude } from './dsp';
import { MOTOR_PARAM_SPECS } from './motorParams';
import { WORKLET_NAME } from './worklet';
import { WorkletHarness } from './workletHarness';

const SR = 48000;
const PAN_CENTRE = Math.SQRT1_2;

function tone(h: WorkletHarness, freq: number, amp: number, seconds = 1): Float32Array {
  h.setMotor(0, freq, amp);
  h.set1('rough', 0);
  const { left } = h.render(h.seconds(seconds));
  return left.subarray(Math.round(0.1 * SR));
}

describe('worklet registration', () => {
  it('registers under its name with the shared k-rate parameter layout', () => {
    const h = new WorkletHarness(SR);
    expect(h.registeredName).toBe(WORKLET_NAME);
    expect(h.descriptors.map((d) => d.name)).toEqual(MOTOR_PARAM_SPECS.map((s) => s.name));
    expect(h.descriptors.every((d) => d.automationRate === 'k-rate')).toBe(true);
  });

  it('is silent with all amplitudes at zero', () => {
    const h = new WorkletHarness(SR);
    const { left, right } = h.render(50);
    expect(peakAbs(left)).toBe(0);
    expect(peakAbs(right)).toBe(0);
  });
});

describe('motor tone', () => {
  it('reproduces the stored harmonics at a table-aligned frequency', () => {
    const h = new WorkletHarness(SR);
    const x = tone(h, 120, 0.5);
    for (const k of [1, 3, 6, 7, 9, 14]) {
      const expected = 0.5 * PAN_CENTRE * h.tableHarmonic(2, k);
      expect(toneAmplitude(x, SR, 120 * k)).toBeCloseTo(expected, 3);
    }
  });

  it('keeps the blade-pass and electrical line ratios of the motor model', () => {
    const h = new WorkletHarness(SR);
    const x = tone(h, 220, 0.5);
    const bp = toneAmplitude(x, SR, 660);
    for (const k of [6, 7, 9, 14]) {
      const want = motorHarmonicAmplitude(k) / motorHarmonicAmplitude(3);
      expect(toneAmplitude(x, SR, 220 * k) / bp).toBeGreaterThan(want * 0.95);
      expect(toneAmplitude(x, SR, 220 * k) / bp).toBeLessThan(want * 1.05);
    }
  });

  it('cross-fading between mip levels leaves the low harmonics untouched', () => {
    const h = new WorkletHarness(SR);
    const aligned = toneAmplitude(tone(h, 120, 0.5), SR, 360);
    const h2 = new WorkletHarness(SR);
    const between = toneAmplitude(tone(h2, 170, 0.5), SR, 510);
    expect(between).toBeCloseTo(aligned, 2);
  });

  it('puts (almost) all energy on harmonic lines, so nothing aliases, from idle to full speed', () => {
    for (const f of [40, 61, 250, 700, 1500, 1900]) {
      const h = new WorkletHarness(SR);
      const x = tone(h, f, 0.6, 0.5);
      const win = x.subarray(0, 12000);
      let lines = 0;
      for (let k = 1; k * f < SR / 2; k++) lines += toneAmplitude(win, SR, k * f) ** 2 / 2;
      expect(lines / rms(win) ** 2).toBeGreaterThan(0.985);
      expect(lines / rms(win) ** 2).toBeLessThan(1.015);
    }
  });

  it('clamps frequencies above the table range instead of aliasing', () => {
    const h = new WorkletHarness(SR);
    const x = tone(h, 5000, 0.5, 0.3);
    expect(peakAbs(x)).toBeLessThan(1.5);
    const bp = findPeak(x, SR, 5500, 6000, 2);
    expect(bp.freq).toBeGreaterThan(3 * 1918.08 - 8);
    expect(bp.freq).toBeLessThan(3 * 1918.08 + 8);
  });

  it('follows a frequency ramp with no clicks', () => {
    const h = new WorkletHarness(SR);
    h.set1('rough', 0);
    const blocks = h.seconds(1);
    const { left } = h.render(blocks, (b, hh) => hh.setMotor(0, 60 + (240 * b) / blocks, 0.4));
    let worst = 0;
    for (let i = 1; i < left.length; i++) worst = Math.max(worst, Math.abs(left[i] - left[i - 1]));
    expect(worst).toBeLessThan(0.4);
    const late = left.subarray(left.length - 1200);
    const bp = findPeak(late, SR, 800, 1000, 2);
    expect(bp.freq).toBeGreaterThan(891 * 0.97);
    expect(bp.freq).toBeLessThan(891 * 1.03);
  });

  it('pans motors by side with the spread parameter and is centred at zero spread', () => {
    const h = new WorkletHarness(SR);
    h.setMotor(0, 150, 0.5);
    h.set1('spread', 1);
    let r = h.render(h.seconds(0.3));
    expect(rms(r.left.subarray(6000))).toBeLessThan(1e-4);
    expect(rms(r.right.subarray(6000))).toBeGreaterThan(0.05);
    const g = new WorkletHarness(SR);
    g.setMotor(2, 150, 0.5);
    g.set1('spread', 1);
    r = g.render(g.seconds(0.3));
    expect(rms(r.right.subarray(6000))).toBeLessThan(1e-4);
    expect(rms(r.left.subarray(6000))).toBeGreaterThan(0.05);
    const c = new WorkletHarness(SR);
    c.setMotor(0, 150, 0.5);
    r = c.render(c.seconds(0.3));
    expect(rms(r.left.subarray(6000))).toBeCloseTo(rms(r.right.subarray(6000)), 5);
  });

  it('flutter modulates the level and roughness smears the upper harmonics', () => {
    const level = (flutter: number): number => {
      const h = new WorkletHarness(SR);
      h.set1('flutter', flutter);
      const x = tone(h, 300, 0.5, 2);
      const win = 480;
      const r: number[] = [];
      for (let i = 0; i + win <= x.length; i += win) r.push(rms(x, i, i + win));
      const mean = r.reduce((a, b) => a + b, 0) / r.length;
      return Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length) / mean;
    };
    expect(level(0.6)).toBeGreaterThan(level(0) + 0.1);
    expect(level(0)).toBeLessThan(0.02);

    const line = (rough: number): number => {
      const h = new WorkletHarness(SR);
      h.setMotor(0, 400, 0.5);
      h.set1('rough', rough);
      const x = h.render(h.seconds(1)).left.subarray(4800);
      return toneAmplitude(x, SR, 4800);
    };
    expect(line(0.02)).toBeLessThan(line(0) * 0.85);
  });
});

describe('noise layers', () => {
  it('whoosh is band-limited around its centre and silent at zero level', () => {
    const h = new WorkletHarness(SR);
    h.set1('noise', 0.3);
    h.set1('noiseFc', 4000);
    const x = h.render(h.seconds(1)).left.subarray(4800);
    expect(rms(x)).toBeGreaterThan(0.02);
    expect(bandLevel(x, SR, 3000, 5500, 24)).toBeGreaterThan(bandLevel(x, SR, 150, 300, 24) * 4);
    expect(bandLevel(x, SR, 3000, 5500, 24)).toBeGreaterThan(bandLevel(x, SR, 14000, 20000, 24) * 4);
    h.set1('noise', 0);
    const quiet = h.render(h.seconds(0.2)).left;
    expect(peakAbs(quiet.subarray(quiet.length - 512))).toBeLessThan(1e-6);
  });

  it('rumble sits below a few hundred Hz with about unit rms per unit level', () => {
    const h = new WorkletHarness(SR);
    h.set1('rumble', 1);
    const x = h.render(h.seconds(4)).left.subarray(9600);
    expect(rms(x)).toBeGreaterThan(0.7);
    expect(rms(x)).toBeLessThan(1.5);
    expect(bandLevel(x, SR, 20, 200, 24)).toBeGreaterThan(bandLevel(x, SR, 2000, 6000, 24) * 30);
  });

  it('stays finite and bounded under wild parameter jumps', () => {
    const h = new WorkletHarness(SR, 5);
    let s = 12345;
    const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const { left, right } = h.render(2000, (b, hh) => {
      if (b % 3 !== 0) return;
      for (let m = 0; m < 4; m++) hh.setMotor(m, rnd() * 2500, rnd() * 0.5);
      hh.set1('noise', rnd() * 0.5);
      hh.set1('noiseFc', 300 + rnd() * 9000);
      hh.set1('flutter', rnd());
      hh.set1('rumble', rnd());
      hh.set1('rough', rnd() * 0.05);
      hh.set1('spread', rnd());
    });
    for (const x of [left, right]) for (let i = 0; i < x.length; i++) expect(Math.abs(x[i])).toBeLessThan(6);
  });
});
