import { describe, expect, it } from 'vitest';
import { localSolarHours, SimClock } from '../game/clock';
import { DEG } from '../game/units';
import {
  bootTime, CYCLE_SCALES, cycleScaleAt, dayLength, describeScale, nearestCycleIndex, skyPhase, skyReadout, timePatch,
  type TimeChoice,
} from './clockModel';

const choice = (over: Partial<TimeChoice> = {}): TimeChoice => ({ timeMode: 'cycle', cycleScale: 60, fixedHour: 14.5, ...over });
const LON = 8;
const NOON_MS = Date.UTC(2026, 5, 21, 12, 0, 0) - (LON / 15) * 3600000;

describe('cycle scales', () => {
  it('span 1x to 1000x in 1-2-5 steps', () => {
    expect(CYCLE_SCALES[0]).toBe(1);
    expect(CYCLE_SCALES[CYCLE_SCALES.length - 1]).toBe(1000);
    for (let i = 1; i < CYCLE_SCALES.length; i++) expect(CYCLE_SCALES[i]).toBeGreaterThan(CYCLE_SCALES[i - 1]);
  });

  it('snap to the nearest step on a log axis and clamp the slider index', () => {
    expect(nearestCycleIndex(1)).toBe(0);
    expect(nearestCycleIndex(60)).toBe(CYCLE_SCALES.indexOf(50));
    expect(nearestCycleIndex(3600)).toBe(CYCLE_SCALES.length - 1);
    expect(nearestCycleIndex(0.2)).toBe(0);
    expect(cycleScaleAt(-3)).toBe(1);
    expect(cycleScaleAt(99)).toBe(1000);
    expect(cycleScaleAt(3.4)).toBe(10);
  });

  it('say how long a day lasts', () => {
    expect(dayLength(1)).toBe('24 h');
    expect(dayLength(10)).toBe('2.4 h');
    expect(dayLength(100)).toBe('14 min');
    expect(dayLength(1000)).toBe('86 s');
    expect(describeScale(1)).toContain('real speed');
    expect(describeScale(500)).toBe('500x  ·  a day in 3 min');
  });
});

describe('time modes reach the clock', () => {
  it('fixed freezes the live time, whatever the stale setting says', () => {
    const p = timePatch(choice({ timeMode: 'fixed' }), 123456, 999999);
    expect(p).toEqual({ timeMs: 123456, timeScale: 0 });
  });

  it('real time jumps to the wall clock at the real rate', () => {
    expect(timePatch(choice({ timeMode: 'real' }), 123456, 999999)).toEqual({ timeMs: 999999, timeScale: 1 });
  });

  it('a day cycle continues from the live time at the chosen speed', () => {
    expect(timePatch(choice({ timeMode: 'cycle', cycleScale: 200 }), 123456, 999999)).toEqual({ timeMs: 123456, timeScale: 200 });
  });

  it('a patch drives SimClock to the right hour after a minute of real time', () => {
    const clock = new SimClock(NOON_MS, 1);
    const p = timePatch(choice({ timeMode: 'cycle', cycleScale: 600 }), NOON_MS, 0);
    clock.set(p.timeMs, p.timeScale);
    for (let i = 0; i < 60; i++) clock.advance(1);
    expect(localSolarHours(clock.timeMs, LON)).toBeCloseTo(12 + 10, 6);
    const frozen = timePatch(choice({ timeMode: 'fixed' }), clock.timeMs, 0);
    clock.set(frozen.timeMs, frozen.timeScale);
    clock.advance(30);
    expect(localSolarHours(clock.timeMs, LON)).toBeCloseTo(22, 6);
  });

  it('boots a saved fixed hour on the default date, real time on the wall clock, and a cycle from the default start', () => {
    const base = Date.UTC(2026, 5, 21, 6, 30, 0);
    const fixed = bootTime(choice({ timeMode: 'fixed', fixedHour: 21.25 }), base, LON, 5);
    expect(fixed.timeScale).toBe(0);
    expect(localSolarHours(fixed.timeMs, LON)).toBeCloseTo(21.25, 9);
    expect(new Date(fixed.timeMs + (LON / 15) * 3600000).getUTCDate()).toBe(21);
    expect(bootTime(choice({ timeMode: 'real' }), base, LON, 5)).toEqual({ timeMs: 5, timeScale: 1 });
    expect(bootTime(choice({ timeMode: 'cycle', cycleScale: 10 }), base, LON, 5)).toEqual({ timeMs: base, timeScale: 10 });
  });
});

describe('sky phase', () => {
  it('follows the sun elevation bands', () => {
    expect(skyPhase(48 * DEG)).toBe('day');
    expect(skyPhase(6 * DEG)).toBe('day');
    expect(skyPhase(3 * DEG)).toBe('golden hour');
    expect(skyPhase(-0.5 * DEG)).toBe('golden hour');
    expect(skyPhase(-3 * DEG)).toBe('civil twilight');
    expect(skyPhase(-9 * DEG)).toBe('nautical twilight');
    expect(skyPhase(-15 * DEG)).toBe('astronomical twilight');
    expect(skyPhase(-30 * DEG)).toBe('night');
  });
});

describe('skyReadout', () => {
  it('reads the clock and the sun by day', () => {
    const r = skyReadout(14 + 32 / 60, { sunElevation: 48 * DEG, moonElevation: -10 * DEG, moonIlluminatedFraction: 0.5 });
    expect(r.text).toBe('14:32  sun 48°');
    expect(r.phase).toBe('day');
  });

  it('names the twilight and shows a negative sun', () => {
    const r = skyReadout(20.7, { sunElevation: -3 * DEG, moonElevation: 10 * DEG, moonIlluminatedFraction: 0.5 });
    expect(r.text).toBe('20:42  sun -3°  ·  civil twilight');
  });

  it('switches to the moon at night, with its phase', () => {
    const r = skyReadout(2 + 10 / 60, { sunElevation: -40 * DEG, moonElevation: 31 * DEG, moonIlluminatedFraction: 0.62 });
    expect(r.text).toBe('02:10  moon 31°, 62% lit');
  });

  it('says so when neither body is up', () => {
    const r = skyReadout(23.5, { sunElevation: -40 * DEG, moonElevation: -5 * DEG, moonIlluminatedFraction: 0.1 });
    expect(r.body).toBe('moon below the horizon');
  });
});
