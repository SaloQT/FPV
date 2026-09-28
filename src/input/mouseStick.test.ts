import { describe, expect, it } from 'vitest';
import { FULL_DEFLECTION_PX, MouseStick } from './mouseStick';

function settle(m: MouseStick, seconds: number, centering: number, dt = 1 / 240): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) m.update(dt, centering, 1, false);
}

describe('MouseStick signs and scaling', () => {
  it('mouse right is roll > 0', () => {
    const m = new MouseStick();
    m.addPixels(60, 0);
    m.update(1 / 60, 0.6, 1, false);
    expect(m.x).toBeGreaterThan(0);
    expect(m.y).toBe(0);
  });

  it('mouse up (negative dy) is pitch < 0 (nose up) by default, mouse down is pitch > 0', () => {
    const m = new MouseStick();
    m.addPixels(0, -60);
    m.update(1 / 60, 0.6, 1, false);
    expect(m.y).toBeLessThan(0);
    const d = new MouseStick();
    d.addPixels(0, 60);
    d.update(1 / 60, 0.6, 1, false);
    expect(d.y).toBeGreaterThan(0);
  });

  it('invertY flips the pitch sign', () => {
    const m = new MouseStick();
    m.addPixels(0, -60);
    m.update(1 / 60, 0.6, 1, true);
    expect(m.y).toBeGreaterThan(0);
  });

  it('full deflection takes FULL_DEFLECTION_PX at sensitivity 1 and half the travel at sensitivity 2', () => {
    const a = new MouseStick();
    a.addPixels(FULL_DEFLECTION_PX / 2, 0);
    a.update(1 / 60, 0, 1, false);
    expect(a.x).toBeCloseTo(0.5, 9);
    const b = new MouseStick();
    b.addPixels(FULL_DEFLECTION_PX / 2, 0);
    b.update(1 / 60, 0, 2, false);
    expect(b.x).toBeCloseTo(1, 9);
  });

  it('applies the newest movement in full on the same frame (no smoothing lag)', () => {
    const m = new MouseStick();
    m.addPixels(100, 0);
    m.update(1 / 60, 1, 1, false);
    expect(m.x).toBeCloseTo(100 / FULL_DEFLECTION_PX, 12);
  });

  it('clamps to [-1, 1]', () => {
    const m = new MouseStick();
    m.addPixels(5000, -5000);
    m.update(1 / 60, 0.6, 1, false);
    expect(m.x).toBe(1);
    expect(m.y).toBe(-1);
  });

  it('sums several events per frame', () => {
    const m = new MouseStick();
    m.addPixels(10, 0);
    m.addPixels(20, 0);
    m.addPixels(-5, 0);
    m.update(1 / 60, 0, 1, false);
    expect(m.x).toBeCloseTo(25 / FULL_DEFLECTION_PX, 12);
  });
});

describe('MouseStick spring-back', () => {
  it('returns to centre without overshoot', () => {
    const m = new MouseStick();
    m.addPixels(240, 0);
    m.update(1 / 240, 0.6, 1, false);
    let prev = m.x;
    for (let i = 0; i < 1200; i++) {
      m.update(1 / 240, 0.6, 1, false);
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(prev + 1e-12);
      prev = m.x;
    }
    expect(m.x).toBeLessThan(0.01);
  });

  it('is centred within a second at full centering and slower with less', () => {
    const strong = new MouseStick();
    const weak = new MouseStick();
    strong.addPixels(150, 0);
    weak.addPixels(150, 0);
    strong.update(0, 1, 1, false);
    weak.update(0, 0.3, 1, false);
    settle(strong, 1, 1);
    settle(weak, 1, 0.3);
    expect(strong.x).toBeLessThan(0.02);
    expect(weak.x).toBeGreaterThan(strong.x);
  });

  it('centering 0 holds the stick where the mouse left it', () => {
    const m = new MouseStick();
    m.addPixels(150, -90);
    m.update(1 / 60, 0, 1, false);
    const x = m.x;
    const y = m.y;
    settle(m, 30, 0);
    expect(m.x).toBe(x);
    expect(m.y).toBe(y);
  });

  it('is independent of the frame rate (exact integration)', () => {
    const a = new MouseStick();
    const b = new MouseStick();
    a.addPixels(200, 100);
    b.addPixels(200, 100);
    a.update(1 / 1000, 0.6, 1, false);
    b.update(1 / 1000, 0.6, 1, false);
    for (let i = 0; i < 30; i++) a.update(1 / 30, 0.6, 1, false);
    for (let i = 0; i < 1800; i++) b.update(1 / 1800, 0.6, 1, false);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
  });

  it('reset centres the stick and drops pending movement', () => {
    const m = new MouseStick();
    m.addPixels(100, 100);
    m.reset();
    m.update(1 / 60, 0, 1, false);
    expect([m.x, m.y]).toEqual([0, 0]);
  });
});
