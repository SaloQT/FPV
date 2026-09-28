import { describe, expect, it } from 'vitest';
import { localSolarHours, SimClock, TIME_STEP_MINUTES, withLocalSolarHours } from './clock';

const NOON_UTC = Date.UTC(2026, 5, 21, 12, 0, 0);

describe('SimClock', () => {
  it('advances by real time times the scale', () => {
    const c = new SimClock(NOON_UTC, 60);
    c.advance(2);
    expect(c.timeMs).toBe(NOON_UTC + 120000);
  });

  it('a zero scale freezes time', () => {
    const c = new SimClock(NOON_UTC, 0);
    c.advance(10);
    expect(c.timeMs).toBe(NOON_UTC);
  });

  it('nudges by minutes in either direction', () => {
    const c = new SimClock(NOON_UTC);
    c.nudge(TIME_STEP_MINUTES);
    expect(c.timeMs).toBe(NOON_UTC + 15 * 60000);
    c.nudge(-2 * TIME_STEP_MINUTES);
    expect(c.timeMs).toBe(NOON_UTC - 15 * 60000);
  });

  it('set replaces time and scale', () => {
    const c = new SimClock(0);
    c.set(NOON_UTC, 10);
    expect([c.timeMs, c.timeScale]).toEqual([NOON_UTC, 10]);
  });
});

describe('local solar time', () => {
  it('equals UTC on the prime meridian and shifts one hour per 15 degrees east', () => {
    expect(localSolarHours(NOON_UTC, 0)).toBeCloseTo(12);
    expect(localSolarHours(NOON_UTC, 15)).toBeCloseTo(13);
    expect(localSolarHours(NOON_UTC, -90)).toBeCloseTo(6);
  });

  it('wraps past midnight', () => {
    expect(localSolarHours(Date.UTC(2026, 0, 1, 23, 0, 0), 30)).toBeCloseTo(1);
  });

  it('withLocalSolarHours keeps the local day and round-trips', () => {
    const t = withLocalSolarHours(NOON_UTC, 8, 6.5);
    expect(localSolarHours(t, 8)).toBeCloseTo(6.5);
    expect(Math.abs(t - NOON_UTC)).toBeLessThan(24 * 3600000);
  });

  it('clamps out-of-range hours', () => {
    expect(withLocalSolarHours(NOON_UTC, 0, -3)).toBe(Date.UTC(2026, 5, 21));
    expect(withLocalSolarHours(NOON_UTC, 0, 99)).toBe(Date.UTC(2026, 5, 22));
  });
});
