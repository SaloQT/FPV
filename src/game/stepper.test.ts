import { describe, expect, it } from 'vitest';
import { FixedStepper, MAX_CATCHUP_S } from './stepper';

describe('FixedStepper', () => {
  it('runs one step per dt', () => {
    const s = new FixedStepper(1000);
    expect(s.advance(0.01)).toBe(10);
    expect(s.advance(0.0004)).toBe(0);
    expect(s.advance(0.0007)).toBe(1);
  });

  it('carries the remainder so no time is lost or invented', () => {
    const s = new FixedStepper(4000);
    let steps = 0;
    for (let i = 0; i < 600; i++) steps += s.advance(1 / 60);
    expect(steps).toBe(40000);
  });

  it('gives the right total over irregular frames', () => {
    const s = new FixedStepper(2000);
    let total = 0;
    let steps = 0;
    for (let i = 0; i < 2000; i++) {
      const dt = 0.002 + 0.0015 * Math.sin(i * 0.37);
      total += dt;
      steps += s.advance(dt);
    }
    expect(steps).toBe(Math.floor(total * 2000 + 1e-6));
  });

  it('caps the catch-up after a stall and counts what it dropped', () => {
    const s = new FixedStepper(1000);
    const steps = s.advance(1);
    expect(steps).toBe(Math.round(MAX_CATCHUP_S * 1000));
    expect(s.droppedSteps).toBe(1000 - steps);
    expect(s.accumulator).toBeLessThan(s.dt);
  });

  it('does not count a frame within the cap as dropped', () => {
    const s = new FixedStepper(1000);
    s.advance(0.05);
    expect(s.droppedSteps).toBe(0);
  });

  it('keeps alpha in [0, 1)', () => {
    const s = new FixedStepper(1000);
    for (let i = 0; i < 500; i++) {
      s.advance(0.0003 + (i % 7) * 0.0004);
      expect(s.alpha).toBeGreaterThanOrEqual(0);
      expect(s.alpha).toBeLessThan(1);
    }
    s.advance(0.0005);
    expect(s.alpha).toBeCloseTo(s.accumulator / s.dt, 12);
  });

  it('ignores non-positive and NaN frame times', () => {
    const s = new FixedStepper(1000);
    expect(s.advance(0)).toBe(0);
    expect(s.advance(-1)).toBe(0);
    expect(s.advance(NaN)).toBe(0);
    expect(s.accumulator).toBe(0);
  });

  it('clamps the configured rate', () => {
    const s = new FixedStepper(1e9);
    expect(s.hz).toBeLessThanOrEqual(16000);
    s.setRate(1);
    expect(s.hz).toBeGreaterThanOrEqual(250);
    s.setRate(NaN);
    expect(s.hz).toBeCloseTo(4000, 6);
  });

  it('reset clears the accumulator', () => {
    const s = new FixedStepper(1000);
    s.advance(0.0005);
    s.reset();
    expect(s.alpha).toBe(0);
  });
});
