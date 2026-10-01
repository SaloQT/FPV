import { describe, expect, it } from 'vitest';
import { FrameLimiter } from './frameLimiter';

/** Runs `seconds` of display refreshes and counts the frames the limiter lets through. */
function simulate(displayHz: number, capHz: number, seconds: number, jitterMs = 0): { frames: number; gaps: number[] } {
  const lim = new FrameLimiter();
  const period = 1000 / displayHz;
  let last = -1;
  const gaps: number[] = [];
  let frames = 0;
  for (let i = 1; i * period <= seconds * 1000; i++) {
    const t = i * period + (((i * 13) % 7) - 3) * jitterMs;
    if (lim.allow(t, capHz, period)) {
      frames++;
      if (last >= 0) gaps.push(t - last);
      last = t;
    }
  }
  return { frames, gaps };
}

describe('FrameLimiter', () => {
  it('lets every refresh through when uncapped', () => {
    expect(simulate(144, 0, 2).frames).toBe(288);
  });

  it('a cap at or above the refresh rate changes nothing', () => {
    expect(simulate(144, 240, 2).frames).toBe(288);
    expect(simulate(60, 60, 2).frames).toBeGreaterThanOrEqual(119);
  });

  it('holds the cap on average: 60 on 144 Hz, 30 on 60 Hz, 120 on 240 Hz', () => {
    expect(simulate(144, 60, 5).frames / 5).toBeGreaterThan(58);
    expect(simulate(144, 60, 5).frames / 5).toBeLessThan(62);
    expect(simulate(60, 30, 5).frames / 5).toBeCloseTo(30, 0);
    expect(simulate(240, 120, 5).frames / 5).toBeCloseTo(120, 0);
  });

  it('holds the cap with timestamp jitter', () => {
    const fps = simulate(165, 60, 10, 0.2).frames / 10;
    expect(fps).toBeGreaterThan(57);
    expect(fps).toBeLessThan(63);
  });

  it('paces evenly: gaps stay within one refresh of the cap period', () => {
    const { gaps } = simulate(144, 60, 5);
    const period = 1000 / 60;
    for (const g of gaps) expect(Math.abs(g - period)).toBeLessThanOrEqual(1000 / 144 + 1e-6);
  });

  it('does not race to catch up after a stall', () => {
    const lim = new FrameLimiter();
    const period = 1000 / 144;
    let t = 0;
    for (let i = 0; i < 30; i++) lim.allow((t += period), 60, period);
    t += 2000;
    let burst = 0;
    for (let i = 0; i < 12; i++) if (lim.allow((t += period), 60, period)) burst++;
    expect(burst).toBeLessThanOrEqual(5);
  });

  it('removing the cap resets the schedule', () => {
    const lim = new FrameLimiter();
    const period = 1000 / 144;
    lim.allow(10, 30, period);
    expect(lim.allow(11, 0, period)).toBe(true);
    expect(lim.allow(20, 30, period)).toBe(true);
  });
});
