import { describe, expect, it } from 'vitest';
import { TWO_PI } from './math3d';
import { Biquad, DEFAULT_RATES, Pt1, Pt2, RpmFilterBank, maxRate, stickToRate } from './fc';
import { stickFor } from './testkit';

const DT = 1 / 4000;

describe('rate curves', () => {
  const r = DEFAULT_RATES;

  it('actual rates: full stick gives superRate (670 roll/pitch, 600 yaw), centre slope is rcRate', () => {
    expect(stickToRate('actual', r.roll, 1)).toBeCloseTo(670, 9);
    expect(stickToRate('actual', r.pitch, 1)).toBeCloseTo(670, 9);
    expect(stickToRate('actual', r.yaw, 1)).toBeCloseTo(600, 9);
    expect(stickToRate('actual', r.roll, 0.01)).toBeCloseTo(0.7 + 600 * 1e-4, 9);
    expect(stickToRate('actual', r.roll, 0)).toBe(0);
    expect(maxRate('actual', r.yaw)).toBeCloseTo(600, 9);
  });

  it('is odd-symmetric, monotonic and clamps out-of-range sticks', () => {
    let prev = -Infinity;
    for (let s = -1; s <= 1.0001; s += 0.05) {
      const v = stickToRate('actual', r.roll, s);
      expect(v).toBeGreaterThan(prev);
      prev = v;
      expect(stickToRate('actual', r.roll, -s)).toBeCloseTo(-v, 9);
    }
    expect(stickToRate('actual', r.roll, 3)).toBe(stickToRate('actual', r.roll, 1));
  });

  it('a 200 deg/s command needs a stick of about 0.52', () => {
    const s = stickFor(200, 'roll');
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(0.55);
    expect(stickToRate('actual', r.roll, s)).toBeCloseTo(200, 3);
  });

  it('betaflight type: 200 deg/s per unit rcRate at the centre, super rate raises the ends', () => {
    const a = { rcRate: 1, superRate: 0.7, expo: 0 };
    expect(stickToRate('betaflight', a, 0.01)).toBeCloseTo((200 * 0.01) / (1 - 0.007), 6);
    expect(stickToRate('betaflight', a, 1)).toBeCloseTo(200 / 0.3, 6);
  });

  it('betaflight type expo blends the stick with its cube: 56.25 deg/s at half stick, odd, monotonic and full-scale at the ends', () => {
    const e = { rcRate: 1, superRate: 0, expo: 0.5 };
    expect(stickToRate('betaflight', e, 0.5)).toBeCloseTo(56.25, 9);
    expect(stickToRate('betaflight', e, -0.5)).toBeCloseTo(-56.25, 9);
    expect(stickToRate('betaflight', e, 1)).toBeCloseTo(200, 9);
    let prev = -Infinity;
    for (let s = -1; s <= 1.0001; s += 0.05) {
      const v = stickToRate('betaflight', e, s);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('quick type reaches the requested max rate at full stick', () => {
    const q = { rcRate: 70, superRate: 670, expo: 0 };
    expect(stickToRate('quick', q, 1)).toBeCloseTo(670, 6);
    expect(stickToRate('quick', q, 0.001)).toBeCloseTo(0.07, 3);
  });

  it('expo softens the centre and the output is clamped to 1998 deg/s', () => {
    const flat = { rcRate: 70, superRate: 670, expo: 0 };
    const soft = { ...flat, expo: 0.5 };
    expect(stickToRate('actual', soft, 0.3)).toBeLessThan(stickToRate('actual', flat, 0.3));
    expect(stickToRate('actual', soft, 1)).toBeCloseTo(670, 9);
    const wild = { rcRate: 3, superRate: 0.9, expo: 0 };
    expect(stickToRate('betaflight', wild, 1)).toBe(1998);
    expect(stickToRate('betaflight', wild, -1)).toBe(-1998);
  });
});

describe('filters', () => {
  const gainAt = (make: () => { apply(x: number): number }, hz: number): number => {
    const f = make();
    const n = Math.round(0.5 / DT);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const y = f.apply(Math.sin(TWO_PI * hz * i * DT));
      if (i > n / 2) peak = Math.max(peak, Math.abs(y));
    }
    return peak;
  };

  it('Pt1 has unity DC gain and about -3 dB at its cutoff', () => {
    const mk = (): Pt1 => {
      const f = new Pt1();
      f.configure(100, DT);
      return f;
    };
    const f = mk();
    for (let i = 0; i < 4000; i++) f.apply(1);
    expect(f.y).toBeCloseTo(1, 6);
    expect(gainAt(mk, 100)).toBeGreaterThan(0.66);
    expect(gainAt(mk, 100)).toBeLessThan(0.73);
    expect(gainAt(mk, 1000)).toBeLessThan(0.12);
  });

  it('Pt2 keeps -3 dB at the requested cutoff and rolls off faster than Pt1', () => {
    const mk = (): Pt2 => {
      const f = new Pt2();
      f.configure(100, DT);
      return f;
    };
    expect(gainAt(mk, 100)).toBeGreaterThan(0.62);
    expect(gainAt(mk, 100)).toBeLessThan(0.74);
    expect(gainAt(mk, 1000)).toBeLessThan(0.03);
  });

  it('biquad notch removes its centre frequency and passes distant ones', () => {
    const mk = (): Biquad => {
      const b = new Biquad();
      b.setNotch(400, 5, DT);
      return b;
    };
    expect(gainAt(mk, 400)).toBeLessThan(0.01);
    expect(gainAt(mk, 100)).toBeGreaterThan(0.97);
    expect(gainAt(mk, 1200)).toBeGreaterThan(0.93);
  });

  it('biquad low-pass is -3 dB at the cutoff for q = 0.707', () => {
    const mk = (): Biquad => {
      const b = new Biquad();
      b.setLowpass(300, Math.SQRT1_2, DT);
      return b;
    };
    expect(gainAt(mk, 300)).toBeGreaterThan(0.68);
    expect(gainAt(mk, 300)).toBeLessThan(0.74);
    expect(gainAt(mk, 30)).toBeGreaterThan(0.99);
  });

  describe('RPM filter bank', () => {
    const cfg = { enabled: true, harmonics: 3, q: 5, minHz: 100, weights: [1, 0.5, 0.25] };
    const gainFor = (c: typeof cfg, motorHz: number, hz: number): number => {
      const bank = new RpmFilterBank(c, 4, 3);
      const omega = [TWO_PI * motorHz, 0, 0, 0];
      const n = Math.round(0.5 / DT);
      let peak = 0;
      for (let i = 0; i < n; i++) {
        bank.update(DT, omega);
        const y = bank.apply(1, 100 * Math.sin(TWO_PI * hz * i * DT));
        if (i > n / 2) peak = Math.max(peak, Math.abs(y) / 100);
      }
      return peak;
    };

    it('removes the motor fundamental and weights the harmonics 1 / 0.5 / 0.25', () => {
      expect(gainFor(cfg, 500, 500)).toBeLessThan(0.05);
      expect(gainFor(cfg, 500, 1000)).toBeGreaterThan(0.4);
      expect(gainFor(cfg, 500, 1000)).toBeLessThan(0.62);
      expect(gainFor(cfg, 400, 1200)).toBeGreaterThan(0.65);
      expect(gainFor(cfg, 400, 1200)).toBeLessThan(0.85);
    });

    it('leaves frequencies away from the motors alone, and is a pass-through when disabled', () => {
      expect(gainFor(cfg, 500, 150)).toBeGreaterThan(0.97);
      expect(gainFor({ ...cfg, enabled: false }, 500, 500)).toBeGreaterThan(0.99);
    });

    it('does not notch below minHz (idle motors)', () => {
      expect(gainFor(cfg, 30, 30)).toBeGreaterThan(0.99);
    });
  });
});
