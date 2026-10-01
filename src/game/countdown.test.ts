import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_FROM, COUNTDOWN_GO_HOLD_S, COUNTDOWN_LEAD_S, COUNTDOWN_STEP_S, createCountdownSnapshot, StartCountdown,
} from './countdown';

const TOTAL = COUNTDOWN_LEAD_S + COUNTDOWN_FROM * COUNTDOWN_STEP_S + COUNTDOWN_GO_HOLD_S;

function run(c: StartCountdown, seconds: number, dt: number): { at: number; beep: number }[] {
  const beeps: { at: number; beep: number }[] = [];
  const n = Math.round(seconds / dt);
  for (let i = 1; i <= n; i++) {
    const b = c.advance(dt);
    if (b >= 0) beeps.push({ at: i * dt, beep: b });
  }
  return beeps;
}

describe('StartCountdown', () => {
  it('is idle until started and ignores time', () => {
    const c = new StartCountdown();
    expect(c.active).toBe(false);
    expect(c.locked).toBe(false);
    expect(c.advance(1)).toBe(-1);
    expect(c.active).toBe(false);
  });

  it('beeps 3, 2, 1, GO once each, one second apart after the lead-in', () => {
    const c = new StartCountdown();
    c.start();
    const beeps = run(c, TOTAL + 0.5, 1 / 60);
    expect(beeps.map((b) => b.beep)).toEqual([3, 2, 1, 0]);
    beeps.forEach((b, i) => expect(b.at).toBeCloseTo(COUNTDOWN_LEAD_S + i * COUNTDOWN_STEP_S, 1));
  });

  it('keeps the arming lock until GO, then lifts it while GO is still shown', () => {
    const c = new StartCountdown();
    c.start();
    run(c, COUNTDOWN_LEAD_S + 2.5, 0.01);
    expect(c.locked).toBe(true);
    run(c, 0.6, 0.01);
    expect(c.locked).toBe(false);
    expect(c.active).toBe(true);
    const s = c.snapshot(createCountdownSnapshot());
    expect(s).toMatchObject({ active: true, locked: false, value: 0 });
    run(c, COUNTDOWN_GO_HOLD_S, 0.01);
    expect(c.active).toBe(false);
  });

  it('reports the number on screen and how far through it we are', () => {
    const c = new StartCountdown();
    const s = createCountdownSnapshot();
    c.start();
    c.advance(0.5);
    expect(c.snapshot(s)).toMatchObject({ active: true, locked: true, value: -1 });
    expect(s.fraction).toBeCloseTo(0.5, 9);
    c.advance(1);
    expect(c.snapshot(s).value).toBe(3);
    expect(s.fraction).toBeCloseTo(0.5, 9);
    c.advance(1);
    expect(c.snapshot(s).value).toBe(2);
    c.advance(1);
    expect(c.snapshot(s).value).toBe(1);
    c.advance(1);
    expect(c.snapshot(s).value).toBe(0);
  });

  it('still beeps every number and GO when a frame spans more than one step', () => {
    const c = new StartCountdown();
    c.start();
    const beeps: number[] = [];
    for (const dt of [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]) {
      const b = c.advance(dt);
      if (b >= 0) beeps.push(b);
    }
    expect(beeps).toEqual([3, 2, 1, 0]);
  });

  it('cancel stops it at once and start begins again from the lead-in', () => {
    const c = new StartCountdown();
    c.start();
    run(c, 2.2, 0.01);
    c.cancel();
    expect(c.active).toBe(false);
    expect(c.locked).toBe(false);
    expect(c.snapshot(createCountdownSnapshot()).value).toBe(-1);
    c.start();
    expect(c.locked).toBe(true);
    expect(c.snapshot(createCountdownSnapshot()).value).toBe(-1);
    expect(run(c, TOTAL + 0.2, 0.01).map((b) => b.beep)).toEqual([3, 2, 1, 0]);
  });
});
